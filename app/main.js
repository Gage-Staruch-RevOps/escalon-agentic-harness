// Agentic Harness: an Electron window around the local harness server (app/web/server.mjs).
// First run shows a short profile form (who Claude works for) and installs the harness; after that it opens the live map.
// Local only: the server binds 127.0.0.1 and every request needs the per-launch token the page carries.
const { app, BrowserWindow, ipcMain, Notification, shell, Menu, dialog, nativeImage } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const REPO = path.resolve(__dirname, '..');
const H = path.join(os.homedir(), '.claude', 'harness');
const DATA = path.join(H, 'app-data');
const PORT = Number(process.env.HARNESS_PORT) || 4777;
const BASE = `http://127.0.0.1:${PORT}`;
let win = null, server = null, alertOffset = 0, updateWaiting = 0;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.setName('Agentic Harness');

const ping = () => new Promise((ok) => { const r = http.get(`${BASE}/api/ping`, (res) => { res.resume(); ok(res.statusCode === 200); }); r.on('error', () => ok(false)); r.setTimeout(800, () => { r.destroy(); ok(false); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  if (await ping()) return; // already running (for example `npm run web`)
  server = spawn(process.execPath, [path.join(REPO, 'app', 'web', 'server.mjs'), String(PORT)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logf = path.join(DATA, 'server.log');
  fs.mkdirSync(DATA, { recursive: true });
  const out = fs.createWriteStream(logf, { flags: 'a' }); server.stdout.pipe(out); server.stderr.pipe(out);
  for (let i = 0; i < 60; i++) { if (await ping()) return; await sleep(250); }
  throw new Error(`The local server did not start. Details in ${logf}`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#1C2960', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // stay on the local server; anything else opens in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(BASE) && !url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('close', (e) => { if (process.platform === 'darwin' && !app.isQuitting) { e.preventDefault(); win.hide(); } });
}

async function openMap() {
  try { await startServer(); await win.loadURL(BASE + '/'); }
  catch (e) { dialog.showErrorBox('Agentic Harness', e.message); }
}

// ---------- first run ----------
const hasProfile = () => fs.existsSync(path.join(H, 'user.json')) && fs.existsSync(path.join(H, '.installed-from'));
ipcMain.handle('setup:fields', async () => {
  const lib = await import(path.join(REPO, 'setup', 'lib.mjs'));
  return { fields: lib.FIELDS, saved: lib.readUser() || {} };
});
ipcMain.handle('setup:install', async (_e, { user, library }) => {
  const lib = await import(path.join(REPO, 'setup', 'lib.mjs'));
  const errs = lib.checkUser(user || {}); if (errs.length) return { ok: false, error: errs.join(' ') };
  const lines = [];
  try {
    lib.install({ user, library: false, log: (l) => { lines.push(l); win?.webContents.send('setup:log', l); } });
    if (library) fetchLibrary();
    await openMap();
    return { ok: true, log: lines };
  } catch (e) { return { ok: false, error: e.message, log: lines }; }
});

// the public library is large: fetch it in the background after setup, then rebuild the map
function fetchLibrary() {
  const p = spawn(process.execPath, [path.join(REPO, 'setup', 'library.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
  notify('Downloading the skill library', 'This runs in the background and takes several minutes.', '');
  p.on('exit', (code) => { notify(code ? 'Skill library download stopped' : 'Skill library ready', code ? 'Run npm run library in the harness folder to try again.' : 'Every public skill is now routed. The map has been rebuilt.', ''); if (!code) win?.webContents.reload(); });
}

// ---------- alerts: the server appends one JSON line per alert ----------
function notify(title, body, session) {
  win?.webContents.send('alert:sound', /approval|question/i.test(title) ? 'needs-you' : 'heads-up');
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => { win.show(); win.focus(); win.webContents.executeJavaScript(`window.openAlert && window.openAlert(${JSON.stringify(String(session || ''))})`).catch(() => {}); });
  n.show();
}
function watchAlerts() {
  const f = path.join(DATA, 'alerts.jsonl');
  try { alertOffset = fs.statSync(f).size; } catch { alertOffset = 0; }
  setInterval(() => {
    let size = 0; try { size = fs.statSync(f).size; } catch { return; }
    if (size < alertOffset) alertOffset = 0;
    if (size === alertOffset) return;
    const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(size - alertOffset); fs.readSync(fd, buf, 0, buf.length, alertOffset); fs.closeSync(fd); alertOffset = size;
    for (const line of buf.toString('utf8').split('\n')) { try { const a = JSON.parse(line); notify(a.title, a.body, a.session); } catch {} }
  }, 3000);
}

// ---------- page messages (badge, attention) ----------
ipcMain.on('native', (_e, m) => {
  if (!m || typeof m !== 'object') return;
  if ('badge' in m) { if (process.platform === 'darwin') app.dock.setBadge(m.badge ? String(m.badge) : ''); else app.setBadgeCount(Number(m.badge) || 0); }
  if (m.attention && win && !win.isFocused()) { if (process.platform === 'darwin') app.dock.bounce('informational'); else win.flashFrame(true); }
});

// ---------- updates from GitHub ----------
function checkUpdates(manual = false) {
  execFile(process.execPath, [path.join(REPO, 'setup', 'update.mjs'), '--check'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, out) => {
    const n = err && err.code === 10 ? parseInt(out, 10) || 1 : 0;
    if (n && n !== updateWaiting) win?.webContents.send('update:available', n);
    updateWaiting = n; buildMenu();
    if (manual) dialog.showMessageBox(win, { message: n ? `${n} harness update(s) waiting.` : err && err.code !== 10 ? 'Could not reach GitHub.' : 'The harness is up to date.' });
  });
}
function runUpdate() {
  execFile(process.execPath, [path.join(REPO, 'setup', 'update.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, out, errOut) => {
    if (err) return dialog.showErrorBox('Update failed', String(errOut || out || err.message).trim());
    updateWaiting = 0; buildMenu();
    dialog.showMessageBox(win, { message: 'Harness updated.', detail: 'New Claude Code sessions use it now. The app will restart.' }).then(() => { app.relaunch(); app.isQuitting = true; app.quit(); });
  });
}
ipcMain.on('update:run', () => runUpdate());

function buildMenu() {
  const harness = { label: 'Harness', submenu: [
    { label: updateWaiting ? `Install ${updateWaiting} update(s)` : 'Check for updates', click: () => (updateWaiting ? runUpdate() : checkUpdates(true)) },
    { label: 'Download skill library', click: () => fetchLibrary() },
    { type: 'separator' },
    { label: 'Edit my profile', click: () => win.loadFile(path.join(__dirname, 'setup.html')) },
    { label: 'Open harness folder', click: () => shell.openPath(H) },
    { label: 'Open skill tree (repo)', click: () => shell.openPath(path.join(REPO, 'skills')) },
  ] };
  const tpl = process.platform === 'darwin'
    ? [{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, harness, { role: 'windowMenu' }]
    : [{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, harness, { role: 'windowMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const icon = path.join(__dirname, 'build', 'icon.png');
  if (process.platform === 'darwin' && fs.existsSync(icon)) app.dock.setIcon(nativeImage.createFromPath(icon));
  createWindow(); buildMenu(); watchAlerts();
  if (hasProfile()) await openMap(); else await win.loadFile(path.join(__dirname, 'setup.html'));
  // Smoke test for CI and maintainers: HARNESS_SMOKE=/path/shot.png npm start saves a screenshot after load, then quits.
  if (process.env.HARNESS_SMOKE) { setTimeout(async () => { fs.writeFileSync(process.env.HARNESS_SMOKE, (await win.webContents.capturePage()).toPNG()); app.isQuitting = true; app.quit(); }, 6000); return; }
  setTimeout(() => checkUpdates(), 20e3); setInterval(() => checkUpdates(), 6 * 3600e3);
});
app.on('activate', () => { if (win) win.show(); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { if (server) server.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
