#!/usr/bin/env node
// Agentic Harness editor: a local-only server that serves the brain and lets the user edit their harness and skills.
//   node server.mjs [port]      (the Electron shell starts it; `npm run web` runs it alone for a browser)
// Safety: binds 127.0.0.1 only; checks Host and Origin; every request needs this launch's random token;
// writes only inside the user's own folders and the company skill tree (never plugins, Anthropic account skills, vendored or library copies);
// backs up every file before overwriting; validates JSON; rebuilds the harness index and logs each change.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildData, renderPage } from './build.mjs';
import { HOME, H, TREE, SKILLS, TASKS, HERE, DATA, TZ } from './paths.mjs';

const HISTORY = path.join(DATA, 'history');
const PORT = Number(process.argv[2]) || 4777;
const TOKEN = crypto.randomBytes(24).toString('hex');
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// ---------- what may be edited ----------
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const under = (p, root) => p === root || p.startsWith(root + path.sep);
const READ_ROOTS = [H, TREE, SKILLS, TASKS, path.join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')].map(real);
function editPolicy(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'No file.' };
  const p = real(raw.replace(/^~(?=\/|$)/, HOME));
  if (!/\.(md|json|txt)$/i.test(p)) return { ok: false, reason: 'Only .md, .json and .txt files can be edited here.', path: p };
  if (fs.existsSync(p) && !fs.statSync(p).isFile()) return { ok: false, reason: 'Not a file.', path: p };
  const ro = (reason) => ({ ok: false, reason, path: p });
  if (under(p, path.join(HOME, 'Library', 'Application Support', 'Claude'))) return ro('Installed plugin skill (company plugins are maintained by their owner). Read only.');
  if (under(p, path.join(SKILLS, 'synced'))) return ro('Anthropic account skill, synced from your Claude account. Read only.');
  if (under(p, path.join(H, '30-library')) || under(p, path.join(H, '20-account'))) return ro('Library copy, rebuilt from its source. Use "Fork to my skills" to make an editable copy.');
  if (under(p, path.join(TREE, '_archive')) || under(p, path.join(TREE, '_dist'))) return ro('Archive or packaged copy. Read only.');
  if (under(p, TREE)) return { ok: true, path: p };
  if (under(p, path.join(H, '00-core')) || under(p, path.join(H, 'notes')) || under(p, path.join(H, '10-mine')) || under(p, path.join(H, '05-playbooks'))) return { ok: true, path: p };
  if (['triggers.json', 'sources.json', 'CHANGELOG.md'].some((f) => p === path.join(H, f))) return { ok: true, path: p };
  if (under(p, TASKS) && path.basename(p) === 'SKILL.md') return { ok: true, path: p };
  if (under(p, SKILLS)) {
    const dir = path.join(SKILLS, path.relative(SKILLS, p).split(path.sep)[0]);
    if (fs.existsSync(path.join(dir, '.harness-promoted'))) return ro('Promoted copy of a library skill; rebuilt by the harness. Fork it instead.');
    return { ok: true, path: p };
  }
  return ro('Outside your editable folders.');
}

// Opens a folder or a claude:// link with the operating system's default handler.
const openWith = (args, cb) => { const t = args[0]; if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '""', t], cb); else if (process.platform === 'darwin') execFile('/usr/bin/open', [t], cb); else execFile('xdg-open', [t], cb); };

// ---------- helpers ----------
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
function backup(p) {
  if (!fs.existsSync(p)) return null;
  fs.mkdirSync(HISTORY, { recursive: true });
  const b = path.join(HISTORY, `${new Date().toISOString().replace(/[:.]/g, '-')}__${path.relative(HOME, p).replace(/[\\/]/g, '__')}`);
  fs.copyFileSync(p, b);
  return b;
}
function logChange(line) {
  const f = path.join(H, 'CHANGELOG.md');
  let s; try { s = fs.readFileSync(f, 'utf8'); } catch { return; }
  const head = `### ${today()}\n`;
  if (!s.includes(head)) s = s.replace('## Log\n\n', `## Log\n\n${head}\n`);
  s = s.replace(head, `${head}- ${line}\n`);
  fs.writeFileSync(f, s);
}
function rebuild({ tests = false } = {}) {
  lastSelfWrite = Date.now();
  const out = [];
  try { out.push(execFileSync(process.execPath, [path.join(H, 'bin', 'build.mjs'), 'index'], { encoding: 'utf8' }).trim()); }
  catch (e) { out.push('index rebuild failed: ' + (e.stderr || e.message)); }
  if (tests) {
    try { out.push(execFileSync(process.execPath, [path.join(H, 'bin', 'test-route.mjs')], { encoding: 'utf8' }).trim().split('\n').pop()); }
    catch (e) { out.push(((e.stdout || '') + '').split('\n').filter((l) => /FAIL|missing|failed/.test(l)).join('\n') || 'routing tests failed'); }
  }
  return out.join('\n');
}
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- actions ----------
// Files view: browse the skill folders as a tree. Listing is limited to these roots; contents go through /api/file.
const TEXT_FILE = /\.(md|json|txt|py|sh|mjs|js|ts|tsx|yaml|yml|csv|html|css|xml|toml|sql|cls|tmpl)$/i;
const FILE_ROOTS = [
  { label: 'Skill tree', path: TREE, note: 'Company and team skills (harness repo)' },
  { label: 'Core rules', path: path.join(H, '00-core'), note: 'Loaded into every session' },
  { label: 'Project notes', path: path.join(H, 'notes'), note: 'One note per project' },
  { label: 'Playbooks', path: path.join(H, '05-playbooks'), note: 'Common jobs' },
  { label: 'My skills', path: path.join(H, '10-mine'), note: 'Personal and forked skills' },
  { label: 'Scheduled tasks', path: TASKS, note: 'Unattended runs' },
  { label: 'Installed skills', path: SKILLS, note: 'What Claude Code loads by name' },
  { label: 'Library', path: path.join(H, '30-library'), note: 'Read only baseline' },
];
function inFileRoots(p) { return FILE_ROOTS.some((r) => under(p, real(r.path))); }
function listDir(raw) {
  const p = real(String(raw || '').replace(/^~(?=\/|$)/, HOME));
  if (!inFileRoots(p) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('Not a folder in the skill tree.');
  const out = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const f = path.join(p, e.name); let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.isDirectory()) { let n = 0; try { n = fs.readdirSync(f).filter((x) => !x.startsWith('.')).length; } catch {} out.push({ name: e.name, path: f, dir: true, n, link: e.isSymbolicLink() }); }
    else out.push({ name: e.name, path: f, dir: false, size: st.size, text: TEXT_FILE.test(e.name) });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  return out;
}
const actions = {
  'GET /api/tree': (q) => q.get('path') ? { path: real(String(q.get('path')).replace(/^~(?=\/|$)/, HOME)), items: listDir(q.get('path')) } : { roots: FILE_ROOTS.filter((r) => fs.existsSync(r.path)).map((r) => ({ label: r.label, note: r.note, path: real(r.path) })) },
  'GET /api/find': (q) => { // file-name search across the editable roots (the library is skipped: use the graph search for it)
    const term = String(q.get('q') || '').toLowerCase().trim(); if (term.length < 2) return { items: [] };
    const hits = []; const walk = (d, depth) => { if (hits.length >= 60 || depth > 7) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) { if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_archive') continue; const f = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name.toLowerCase().includes(term)) hits.push({ name: e.name, path: f, dir: true }); walk(f, depth + 1); }
        else if (e.isFile() && (e.name.toLowerCase().includes(term) || (e.name === 'SKILL.md' && path.basename(d).toLowerCase().includes(term)))) hits.push({ name: e.name, path: f, dir: false, text: TEXT_FILE.test(e.name) });
        if (hits.length >= 60) return; } };
    for (const r of FILE_ROOTS.slice(0, 6)) walk(real(r.path), 0);
    return { items: hits.map((h) => ({ ...h, where: path.dirname(h.path).replace(HOME, '~') })) };
  },
  'POST /api/newfile': (b) => {
    const dir = real(String(b.dir || '')), name = String(b.name || '').trim();
    if (!inFileRoots(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Pick a folder in the skill tree first.');
    if (!/^[\w][\w .-]{0,80}\.(md|json|txt)$/.test(name)) throw new Error('Name it like notes.md (letters, numbers, dashes; .md, .json or .txt).');
    const p = path.join(dir, name); if (fs.existsSync(p)) throw new Error('That file already exists.');
    const pol = editPolicy(p); if (!pol.ok) throw Object.assign(new Error(pol.reason || 'This folder is read only.'), { code: 403 });
    const folder = path.basename(dir);
    fs.writeFileSync(p, name === 'SKILL.md' ? '---\nname: ' + folder + '\ndescription: Say what this skill does and when to use it.\n---\n\n# ' + folder + '\n' : name.endsWith('.json') ? '{}\n' : '');
    logChange('App: new file `' + p.replace(HOME, '~') + '`');
    return { ok: true, path: p };
  },
  'POST /api/newfolder': (b) => {
    const dir = real(String(b.dir || '')), name = String(b.name || '').trim();
    if (!inFileRoots(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Pick a folder in the skill tree first.');
    if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(name)) throw new Error('Name it in kebab-case, e.g. month-end-close.');
    const p = path.join(dir, name); if (fs.existsSync(p)) throw new Error('That folder already exists.');
    const pol = editPolicy(path.join(p, 'SKILL.md')); if (!pol.ok) throw Object.assign(new Error(pol.reason || 'This folder is read only.'), { code: 403 });
    fs.mkdirSync(p); logChange('App: new folder `' + p.replace(HOME, '~') + '`');
    return { ok: true, path: p };
  },
  'GET /api/data': () => buildData(),
  'GET /api/file': (q) => {
    const pol = editPolicy(q.get('path'));
    let text = null;
    // Contents only for skill and harness files (editable or read-only ones), never anything else on the Mac.
    const isMemory = !!pol.path && /\/\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$/.test(pol.path);
    const readable = pol.path && TEXT_FILE.test(pol.path) && (isMemory || READ_ROOTS.some((r) => under(pol.path, r)));
    let tooBig = false;
    if (readable && fs.existsSync(pol.path) && fs.statSync(pol.path).isFile()) { if (fs.statSync(pol.path).size > 600000) tooBig = true; else text = fs.readFileSync(pol.path, 'utf8'); }
    return { path: pol.path, editable: pol.ok && !tooBig, reason: tooBig ? 'File is too large to open here.' : pol.reason || null, text };
  },
  'POST /api/file': (b) => {
    const pol = editPolicy(b.path);
    if (!pol.ok) throw Object.assign(new Error(pol.reason), { code: 403 });
    if (typeof b.text !== 'string') throw new Error('No text.');
    if (pol.path.endsWith('.json')) JSON.parse(b.text); // refuse broken JSON
    if (pol.path.endsWith('SKILL.md') && !/^---\nname:\s*\S+[\s\S]*?\ndescription:\s*\S[\s\S]*?\n---/.test(b.text)) throw new Error('SKILL.md needs frontmatter with name and description.');
    const bak = backup(pol.path);
    fs.writeFileSync(pol.path, b.text);
    logChange(`App edit: \`${pol.path.replace(HOME, '~')}\``);
    const isRouting = /triggers\.json$|chains\.md$/.test(pol.path);
    return { ok: true, backup: bak, log: rebuild({ tests: isRouting }) };
  },
  'POST /api/skill': (b) => {
    const name = slug(b.name), area = String(b.area || '');
    if (!name || name.length < 3) throw new Error('Name it in kebab-case, e.g. month-end-close.');
    if (!/^\d\d-[\w-]+$/.test(area) || ['60-design-eng', '61-salesforce-vendor'].includes(area) || !fs.existsSync(path.join(TREE, area))) throw new Error('Pick one of your skill tree areas.');
    const desc = String(b.description || '').replace(/\s+/g, ' ').trim();
    if (desc.length < 20) throw new Error('Description: what it does, when to use it, when not (20+ characters).');
    const dir = path.join(TREE, area, name);
    if (fs.existsSync(dir)) throw new Error(`${area}/${name} already exists.`);
    const layer = String(b.layer || 'L3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n## Purpose\n${String(b.purpose || 'EDIT: two lines on the job and the outcome.')}\n\n## Layer and dependencies\n- Layer: ${layer}\n- Depends on: ${String(b.depends || 'none')}\n\n## Procedure\n1. EDIT:\n\n## Gates (all must pass before delivery)\n- [ ] EDIT:\n\n## Changelog\n- ${today()} v1.0: created from the RevOps Agentic Harness.\n`);
    const reg = path.join(TREE, '00-router', 'skill-router', 'references', 'registry.md');
    if (b.intent && fs.existsSync(reg)) {
      backup(reg);
      let r = fs.readFileSync(reg, 'utf8');
      const sec = '## Added from the Brain (sort into the tree)';
      const row = `| ${String(b.intent).replace(/\|/g, '/')} | ${name} | ${layer} | local \`${area}/${name}\` |`;
      if (!r.includes(sec)) r = r.replace('## Precedence', `${sec}\n| Intent | Skill(s) | Layer | Where |\n|---|---|---|---|\n${row}\n\n## Precedence`);
      else r = r.replace(`${sec}\n| Intent | Skill(s) | Layer | Where |\n|---|---|---|---|\n`, `$&${row}\n`);
      fs.writeFileSync(reg, r);
    }
    logChange(`App: new skill \`${area}/${name}\`${b.intent ? ' with a registry row' : ''}`);
    return { ok: true, path: path.join(dir, 'SKILL.md'), log: rebuild() };
  },
  'POST /api/trigger': (b) => {
    const f = path.join(H, 'triggers.json');
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (b.action === 'remove') {
      const i = Number(b.index);
      if (!(i >= 0 && i < t.rules.length)) throw new Error('No such rule.');
      backup(f); const [gone] = t.rules.splice(i, 1);
      fs.writeFileSync(f, JSON.stringify(t, null, 2) + '\n');
      logChange(`App: removed routing rule \`${gone.match}\``);
      return { ok: true, log: rebuild({ tests: true }) };
    }
    const words = String(b.words || '').split(',').map((w) => w.trim()).filter(Boolean);
    const match = b.match ? String(b.match) : words.length ? `\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})\\b` : '';
    if (!match) throw new Error('Give the words that should route here.');
    new RegExp(match, 'i'); // refuse a broken pattern
    if (!b.skill) throw new Error('No skill.');
    const rule = { match, skills: [String(b.skill)] };
    if (b.chain) rule.chain = String(b.chain).toUpperCase();
    if (b.note) rule.notes = [String(b.note)];
    backup(f); t.rules.unshift(rule);
    fs.writeFileSync(f, JSON.stringify(t, null, 2) + '\n');
    logChange(`App: routing rule \`${match}\` -> ${b.skill}${rule.chain ? ` (${rule.chain})` : ''}`);
    return { ok: true, log: rebuild({ tests: true }) };
  },
  'POST /api/fork': (b) => {
    const name = String(b.name || '');
    if (!/^[\w.-]+$/.test(name)) throw new Error('Bad skill name.');
    const out = execFileSync(process.execPath, [path.join(H, 'bin', 'fork.mjs'), name], { encoding: 'utf8' }).trim();
    logChange(`App: forked library skill \`${name}\` into 10-mine`);
    return { ok: true, log: out + '\n' + rebuild() };
  },
};

// ---------- live: event stream, folder watchers, activity log ----------
let lastSelfWrite = 0;
const clients = new Set();
const broadcast = (ev) => { const msg = `data: ${JSON.stringify(ev)}\n\n`; for (const r of clients) { try { r.write(msg); } catch {} } };
setInterval(() => { for (const r of clients) { try { r.write(': ping\n\n'); } catch {} } }, 25000);

const ACTIVITY = path.join(H, '.cache', 'activity.jsonl');
const IGNORE = [/\/30-library\//, /\/20-account\//, /\/90-quarantine\//, /\/\.cache\//, /\/index\.json$/, /\/INDEX\.md$/, /\/SOURCES\.md$/, /\/\.DS_Store$/, /\/_archive\//, /\/_dist\//, /\.bak-/, /\/\.history\//, /\/synced\//, /~$/, /\.swp$/];
const REINDEX = /(SKILL\.md|\/00-core\/.+\.md|\/notes\/.+\.md|triggers\.json|sources\.json|chains\.md|registry\.md|\/05-playbooks\/.+\.md)$/;
let pending = new Set(), timer = null, indexing = false;
function onChange(root, rel) {
  if (!rel) return;
  const p = path.join(root, String(rel));
  if (p === ACTIVITY) return readActivity();
  if (IGNORE.some((re) => re.test(p))) return;
  pending.add(p);
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
}
function flush() {
  const paths = [...pending].map(real); pending = new Set();
  const needIndex = paths.some((p) => REINDEX.test(p)) && Date.now() - lastSelfWrite > 4000;
  if (!needIndex || indexing) return broadcast({ type: 'files', paths, reindexed: false });
  indexing = true;
  broadcast({ type: 'indexing', paths });
  execFile(process.execPath, [path.join(H, 'bin', 'build.mjs'), 'index'], { encoding: 'utf8' }, (err, out) => {
    indexing = false;
    broadcast({ type: 'files', paths, reindexed: !err, log: err ? String(err.message).split('\n')[0] : String(out).trim().split('\n').pop() });
  });
}
for (const root of [TREE, H, TASKS, SKILLS]) {
  try { fs.watch(root, { recursive: true }, (_e, rel) => onChange(root, rel)); } catch (e) { console.log(`not watching ${root}: ${e.message}`); }
}
try { fs.mkdirSync(path.dirname(ACTIVITY), { recursive: true }); fs.watch(path.dirname(ACTIVITY), (_e, rel) => { if (rel === 'activity.jsonl') readActivity(); }); } catch {}
let actOffset = (() => { try { return fs.statSync(ACTIVITY).size; } catch { return 0; } })();
function parseEvents(text) {
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map((ev) => (ev.t === 'read' && ev.path ? { ...ev, path: real(ev.path.replace(/^~(?=\/)/, HOME)) } : ev));
}
function readActivity() {
  let size; try { size = fs.statSync(ACTIVITY).size; } catch { return; }
  if (size < actOffset) actOffset = 0; // rotated
  if (size === actOffset) return;
  const fd = fs.openSync(ACTIVITY, 'r'); const buf = Buffer.alloc(size - actOffset);
  fs.readSync(fd, buf, 0, buf.length, actOffset); fs.closeSync(fd); actOffset = size;
  const events = parseEvents(buf.toString('utf8'));
  if (events.length) broadcast({ type: 'activity', events });
}
function recentActivity(limit = 40) {
  let text = ''; try { text = fs.readFileSync(ACTIVITY + '.1', 'utf8'); } catch {} try { text += fs.readFileSync(ACTIVITY, 'utf8'); } catch {}
  return parseEvents(text.split('\n').slice(-limit - 1).join('\n'));
}
actions['GET /api/activity'] = (q) => ({ events: recentActivity(Math.min(8000, Number(q.get('n')) || 40)) });

// The real file behind a skill name (plugin, account, tree or own), so the app can show what Claude is reading.
const APP_SESS = path.join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
function resolveSkillFile(name) {
  const plugin = name.includes(':') ? name.split(':')[0] : '', short = name.replace(/^[\w-]+:/, '');
  if (!/^[\w.-]+$/.test(short)) return null;
  const cands = [path.join(SKILLS, short, 'SKILL.md')];
  for (const b of ls(path.join(SKILLS, 'synced'))) cands.push(path.join(SKILLS, 'synced', b, short, 'SKILL.md'));
  for (const a of ls(APP_SESS)) for (const b of ls(path.join(APP_SESS, a))) {
    const rpm = path.join(APP_SESS, a, b, 'rpm');
    for (const p of ls(rpm)) {
      const f = path.join(rpm, p, 'skills', short, 'SKILL.md');
      if (!plugin || plugin === 'anthropic-skills') { cands.push(f); continue; }
      let pn = ''; try { pn = JSON.parse(fs.readFileSync(path.join(rpm, p, '.claude-plugin', 'plugin.json'), 'utf8')).name; } catch {}
      if (pn === plugin) cands.unshift(f);
    }
    cands.push(path.join(APP_SESS, a, b, 'skills', short, 'SKILL.md'));
  }
  for (const a of ls(path.join(APP_SESS, 'skills-plugin'))) for (const b of ls(path.join(APP_SESS, 'skills-plugin', a))) cands.push(path.join(APP_SESS, 'skills-plugin', a, b, 'skills', short, 'SKILL.md'));
  for (const area of ls(TREE)) cands.push(path.join(TREE, area, short, 'SKILL.md'));
  for (const g of ['escalon', 'account']) cands.push(path.join(H, '10-mine', g, short, 'SKILL.md'));
  return cands.find((f) => fs.existsSync(f)) || null;
}
const NAMES_FILE = path.join(DATA, 'names.json'), FEEDBACK = path.join(H, 'feedback.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const titleCache = new Map();
function firstAsk(file) { // no title yet: name the session after its first request (first 256 KB only)
  try {
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(262144), n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    for (const l of buf.toString('utf8', 0, n).split('\n')) {
      if (!l.includes('"type":"user"')) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.isMeta || j.isSidechain) continue;
      const c = j.message?.content; const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text) : [];
      for (let x of parts) {
        const st = /<scheduled-task name="([\w-]+)"/.exec(x); if (st) { const n = st[1].replace(/-/g, ' '); return ('Scheduled: ' + n).slice(0, 48); }
        x = String(x).replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim();
        if (x.length < 4 || x.startsWith('<') || /^(Caveat:|This session is being continued)/.test(x)) continue;
        x = x[0].toUpperCase() + x.slice(1);
        return x.length > 44 ? x.slice(0, 43).replace(/\s+\S*$/, '') + '…' : x;
      }
    }
  } catch {}
  return null;
}
function sessionTitle(sid) { // the session's own title from its transcript, when it has one
  if (!/^[\w-]{8,64}$/.test(sid)) return null;
  const proj = path.join(HOME, '.claude', 'projects'); let file = null;
  let best = -1; // a session that changed folders has a transcript in each; the newest one carries the title
  for (const d of ls(proj)) for (const n of ls(path.join(proj, d))) { if (!n.startsWith(sid) || !n.endsWith('.jsonl')) continue; const f = path.join(proj, d, n); let mt = 0; try { mt = fs.statSync(f).mtimeMs; } catch {} if (mt > best) { best = mt; file = f; } }
  if (!file) return null;
  const m = fs.statSync(file).mtimeMs, c = titleCache.get(sid); if (c && c.m === m) return c.t;
  let t = null;
  try { const out = execFileSync('/usr/bin/grep', ['-a', '-E', '"type":"(custom-title|ai-title|summary)"', file], { encoding: 'utf8', maxBuffer: 8e6 }).trim().split('\n'); for (const l of out) { try { const j = JSON.parse(l); const v = j.customTitle || j.aiTitle || j.title || j.summary; if (v) t = String(v).slice(0, 48); } catch {} } } catch {}
  if (!t) t = firstAsk(file);
  titleCache.set(sid, { m, t }); return t;
}
actions['GET /api/names'] = (q) => { const titles = {}; for (const sid of String(q.get('sids') || '').split(',').filter(Boolean).slice(0, 80)) { const t = sessionTitle(sid); if (t) titles[sid.slice(0, 8)] = t; } return { custom: readJ(NAMES_FILE, {}), titles }; };
actions['POST /api/names'] = (b) => { const id = String(b.id || '').slice(0, 16); if (!/^[\w-]+$/.test(id)) throw new Error('Bad session id.'); const n = readJ(NAMES_FILE, {}); const name = String(b.name || '').trim().slice(0, 40); if (name) n[id] = name; else delete n[id]; fs.writeFileSync(NAMES_FILE, JSON.stringify(n, null, 2)); return { ok: true }; };
actions['GET /api/feedback'] = () => ({ items: (readJ(FEEDBACK, { items: [] }).items || []).slice(-60).reverse() });
actions['POST /api/feedback'] = (b) => { const d = readJ(FEEDBACK, { items: [] }); d.items ||= [];
  if (b.action === 'add') { const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 600); if (text.length < 8) throw new Error('Say what should change.'); const scope = ['session', 'all', 'retro'].includes(b.scope) ? b.scope : 'retro'; d.items.push({ id: crypto.randomBytes(4).toString('hex'), ts: Date.now(), text, scope, session: scope === 'session' ? String(b.session || '').slice(0, 64) : '', sessionName: String(b.sessionName || '').slice(0, 48), about: String(b.about || '').slice(0, 80), status: 'open' }); }
  else if (b.action === 'resolve' || b.action === 'delete') { const it = d.items.find((x) => x.id === b.id); if (!it) throw new Error('No such item.'); if (b.action === 'delete') d.items = d.items.filter((x) => x !== it); else { it.status = 'resolved'; it.resolved = Date.now(); } }
  else throw new Error('Unknown action.');
  fs.writeFileSync(FEEDBACK, JSON.stringify(d, null, 2) + '\n'); return { ok: true }; };
// Morning brief: what ran since the last working evening, what is unfinished, what waits on the user. Labels only.
function transcriptOf(id) { const proj = path.join(HOME, '.claude', 'projects'); let best = -1, file = null; for (const d of ls(proj)) for (const n of ls(path.join(proj, d))) { if (!n.startsWith(id) || !n.endsWith('.jsonl')) continue; const f = path.join(proj, d, n); let mt = 0; try { mt = fs.statSync(f).mtimeMs; } catch {} if (mt > best) { best = mt; file = f; } } return file; }
const schedCache = new Map();
function scheduledName(id) { if (schedCache.has(id)) return schedCache.get(id); let v = null; const f = transcriptOf(id);
  if (f) { try { const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(65536), n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); const m = /<scheduled-task name=\\?"([\w-]+)\\?"/.exec(buf.toString('utf8', 0, n)); if (m) v = m[1]; } catch {} schedCache.set(id, v); }
  return v; }
const STALL_MS = 12 * 60e3;
function briefSince(now) { const d = new Date(now); d.setHours(17, 0, 0, 0); do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6); return d.getTime(); }
function sessionStates(since, now = Date.now()) {
  const by = new Map();
  for (const f of [ACTIVITY + '.1', ACTIVITY]) { let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch {} for (const l of txt.split('\n')) { if (!l) continue; let e; try { e = JSON.parse(l); } catch { continue; } if (!e.session || e.ts < since || /^dbg[ABC]000/.test(e.session)) continue; if (!by.has(e.session)) by.set(e.session, []); by.get(e.session).push(e); } }
  const custom = readJ(NAMES_FILE, {}), sessions = [];
  for (const [id, ev] of by) { ev.sort((a, b) => a.ts - b.ts);
    const last = ev[ev.length - 1]; let items = [];
    for (const e of ev) { // replay the task list the same way the live view does
      if (e.t === 'plan') items = (e.items || []).map((x) => ({ ...x }));
      else if (e.t === 'planstep') { if (e.all) items.forEach((x) => (x.s = 'completed')); for (const i of e.done || []) if (items[i - 1]) items[i - 1].s = 'completed';
        if (e.advance) { const i = items.findIndex((x) => x.s === 'in_progress'); if (i >= 0) items[i].s = 'completed'; const j = items.findIndex((x) => x.s === 'pending'); if (j >= 0) items[j].s = 'in_progress'; }
        if (e.start && items[e.start - 1]) items[e.start - 1].s = 'in_progress'; } }
    const done = items.filter((x) => x.s === 'completed').length;
    const fails = ev.filter((e) => e.t === 'post' && e.fail), lastStop = [...ev].reverse().find((e) => e.t === 'stop'), open = new Map();
    for (const e of ev) { if (e.t === 'pre') open.set(e.id, e); else if (e.t === 'post') open.delete(e.id); else if (e.t === 'stop') open.clear(); }
    const sched = scheduledName(id), idle = now - last.ts, lastWork = [...ev].reverse().find((e) => e.t !== 'notify');
    // an approval prompt always waits on the user; an "idle" notice only counts when the turn had not finished
    const waiting = last.t === 'notify' && (last.kind === 'permission' || (last.kind === 'input' && lastWork && lastWork.t !== 'stop'));
    const lastStopAt = lastStop ? lastStop.ts : 0, prevStop = [...ev].reverse().find((e) => e.t === 'stop' && e.ts < lastStopAt), turnFails = fails.filter((e) => e.ts > (prevStop ? prevStop.ts : 0)).length;
    let state = 'done';
    if (waiting) state = 'waiting'; else if (last.t === 'notify' && lastWork && lastWork.t === 'stop') state = items.length && done < items.length ? 'unfinished' : 'done'; else if (last.t !== 'stop') state = idle < STALL_MS ? 'running' : (open.size || sched ? 'stalled' : 'running'); else if (items.length && done < items.length) state = 'unfinished';
    if (state === 'done' && fails.length) state = 'issues';
    sessions.push({ openActions: open.size, turnFails, lastStopAt, lastT: last.t, id, name: custom[id] || sessionTitle(id) || (sched ? 'Scheduled: ' + sched.replace(/-/g, ' ') : 'Session ' + id.slice(0, 4)), sched, state, first: ev[0].ts, last: last.ts, actions: ev.filter((e) => e.t === 'pre').length, fails: fails.length, failLabel: fails.length ? fails[fails.length - 1].label : '', done, total: items.length, next: (items.find((x) => x.s !== 'completed') || {}).c || '', waitMsg: waiting ? last.msg : '', lastLabel: ([...ev].reverse().find((e) => e.t === 'pre') || {}).label || '', chain: ([...ev].reverse().find((e) => e.t === 'route' && e.chains?.length)?.chains || [])[0] || '' });
  }
  sessions.sort((a, b) => b.last - a.last);
  return sessions;
}
actions['GET /api/brief'] = () => {
  const now = Date.now(), since = briefSince(now), sessions = sessionStates(since, now);
  const tasks = ls(path.join(HOME, '.claude', 'scheduled-tasks')).filter((n) => fs.existsSync(path.join(HOME, '.claude', 'scheduled-tasks', n, 'SKILL.md'))).map((name) => { const runs = sessions.filter((x) => x.sched === name); const r = runs[0]; return { name, runs: runs.length, state: r ? r.state : 'none', last: r ? r.last : 0, id: r ? r.id : '', fails: runs.reduce((n, x) => n + x.fails, 0), note: r ? (r.waitMsg || r.failLabel || (r.state === 'unfinished' ? r.next : '')) : '' }; });
  const fb = (readJ(FEEDBACK, { items: [] }).items || []).filter((x) => x.status !== 'resolved').slice(-8).reverse().map((x) => ({ id: x.id, text: x.text, scope: x.scope, status: x.status, ts: x.ts }));
  let cl = ''; try { cl = fs.readFileSync(path.join(H, 'CHANGELOG.md'), 'utf8'); } catch {}
  const backlog = cl.split('\n').filter((l) => /^- \[ \]/.test(l)).map((l) => l.replace(/^- \[ \]\s*/, '').replace(/`/g, '').slice(0, 150));
  const out = { now, since, alerts: recentAlerts(8), alertsOn: settings().alerts !== false, tasks, work: sessions.filter((x) => !x.sched), feedback: fb, backlog: backlog.slice(0, 4), backlogTotal: backlog.length, usage: null };
  // Usage since the same window start; the Brief still opens if the scan fails or runs long.
  return Promise.race([usageReport(1, since), new Promise((ok) => setTimeout(() => ok(null), 15e3))]).then((r) => {
    if (r && r.window) { const names = readJ(NAMES_FILE, {}), w = r.window;
      for (const s of w.topSessions) { const id = s.sid.slice(0, 8); s.id = id; s.name = names[id] || (scheduledName(s.sid) || '').replace(/-/g, ' ') || sessionTitle(s.sid) || id; }
      out.usage = { window: w, today: r.today.cost, yesterday: r.yesterday, dayMedian: r.dayMedian, block: r.block, limits: { daily: settings().usageDaily || null, block: settings().usageBlock || null }, basis: r.basis }; }
    return out;
  }, () => out);
};
// Alerts: one line per event in app-data/alerts.jsonl. The Electron app tails that file and posts native notifications;
// the page gets the same alert over the live channel. Labels only, same as the activity log.
const ALERTS = path.join(DATA, 'alerts.jsonl'), SETTINGS = path.join(DATA, 'settings.json');
const settings = () => readJ(SETTINGS, {});
const recentAlerts = (n) => { let t = ''; try { t = fs.readFileSync(ALERTS, 'utf8'); } catch {} return t.split('\n').filter(Boolean).slice(-n).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); };
const alerted = new Set(); let alertsPrimed = false, alertTimer = null;
function checkAlerts() {
  let list; try { list = sessionStates(Date.now() - 36 * 3600e3); } catch { return; }
  const out = [];
  for (const x of list) {
    const what = x.sched ? x.sched.replace(/-/g, ' ') : x.name; let key = null, title = '', body = '';
    if (x.state === 'waiting') { const q = /AskUserQuestion/.test(x.waitMsg || ''); key = 'wait:' + x.id + ':' + x.last; title = q ? 'Has a question for you' : 'Needs your approval'; body = what + (q ? ': waiting for your answer' : x.waitMsg ? ': ' + x.waitMsg.replace(/^Claude needs your permission to use /, 'wants to use ') : ''); }
    else if (x.state === 'stalled') { key = 'stall:' + x.id + ':' + x.last; title = 'Stopped mid-task'; body = what + ': no activity for ' + Math.round((Date.now() - x.last) / 60e3) + ' min' + (x.lastLabel ? ' after "' + x.lastLabel + '"' : ''); }
    else if (x.lastT === 'stop' && x.turnFails) { key = 'fail:' + x.id + ':' + x.lastStopAt; title = 'Finished with failures'; body = what + ': ' + x.turnFails + ' failed action' + (x.turnFails > 1 ? 's' : '') + (x.failLabel ? ', last: ' + x.failLabel : ''); }
    else if (x.sched && x.state === 'unfinished') { key = 'left:' + x.id + ':' + x.lastStopAt; title = 'Scheduled run ended early'; body = what + ': ' + x.done + ' of ' + x.total + ' tasks done' + (x.next ? ', stopped before "' + x.next + '"' : ''); }
    if (!key || alerted.has(key)) continue; alerted.add(key);
    if (alertsPrimed) out.push({ id: crypto.randomBytes(4).toString('hex'), ts: Date.now(), kind: key.split(':')[0], session: x.id, title, body: body.slice(0, 180) });
  }
  alertsPrimed = true; // the first pass only records what already exists, so a restart never replays old alerts
  if (!out.length || settings().alerts === false) return;
  try { fs.appendFileSync(ALERTS, out.map((a) => JSON.stringify(a)).join('\n') + '\n'); } catch {}
  for (const a of out) broadcast({ type: 'alert', alert: a });
}
try { const keep = fs.readFileSync(ALERTS, 'utf8').split('\n').filter(Boolean).slice(-200); fs.writeFileSync(ALERTS, keep.length ? keep.join('\n') + '\n' : ''); } catch { try { fs.writeFileSync(ALERTS, ''); } catch {} }
const pokeAlerts = () => { clearTimeout(alertTimer); alertTimer = setTimeout(checkAlerts, 1200); };
try { fs.watch(path.dirname(ACTIVITY), (_e, rel) => { if (rel === 'activity.jsonl') pokeAlerts(); }); } catch {}
setInterval(checkAlerts, 60e3); setTimeout(checkAlerts, 500);
actions['GET /api/alerts'] = () => ({ on: settings().alerts !== false, items: recentAlerts(30) });
actions['POST /api/settings'] = (b) => { const st = settings(); if (typeof b.alerts === 'boolean') st.alerts = b.alerts;
  for (const k of ['usageDaily', 'usageBlock']) if (k in b) { const v = Number(b[k]); if (b[k] === null || b[k] === '' || !(v > 0)) delete st[k]; else st[k] = Math.min(1e6, Math.round(v * 100) / 100); }
  fs.writeFileSync(SETTINGS, JSON.stringify(st, null, 2) + '\n'); if ('usageDaily' in b || 'usageBlock' in b) usageMemo.clear();
  return { ok: true, alerts: st.alerts !== false, usageDaily: st.usageDaily || null, usageBlock: st.usageBlock || null }; };

// Usage monitor: usage.mjs scans the transcripts in a child process (the first scan reads every transcript;
// later ones read only new lines), so the server never blocks. Results are kept for 30 s per range.
const usageMemo = new Map(); let usageRun = null;
function usageReport(days, since = 0) {
  const key = days + ':' + since, hit = usageMemo.get(key); if (hit && Date.now() - hit.at < 30e3) return Promise.resolve(hit.r);
  if (usageRun && usageRun.key === key) return usageRun.p;
  const args = [path.join(HERE, 'usage.mjs'), '--json', '--days', String(days)]; if (since) args.push('--since', String(since));
  const p = new Promise((ok, bad) => execFile(process.execPath, args, { maxBuffer: 32e6, timeout: 240e3 }, (err, out) => {
    if (usageRun && usageRun.key === key) usageRun = null; if (err) return bad(new Error('Usage scan failed: ' + String(err.message).split('\n')[0]));
    try { const r = JSON.parse(out); usageMemo.set(key, { at: Date.now(), r }); ok(r); } catch (e) { bad(e); }
  }));
  usageRun = { key, p }; return p;
}
actions['GET /api/usage'] = async (q) => {
  const days = [1, 7, 30].includes(Number(q.get('days'))) ? Number(q.get('days')) : 7, r = await usageReport(days), st = settings();
  const names = readJ(NAMES_FILE, {});
  for (const s of r.sessions) { const id = s.sid.slice(0, 8); s.name = names[id] || (scheduledName(s.sid) || '').replace(/-/g, ' ') || sessionTitle(s.sid) || id; }
  return { ...r, limits: { daily: st.usageDaily || null, block: st.usageBlock || null } };
};
const usageAlerted = new Set(recentAlerts(200).map((a) => a.key).filter(Boolean)); // a restart never repeats one
async function checkUsage() { // threshold alerts, at most once per day and once per 5-hour block
  const st = settings(); if (!st.usageDaily && !st.usageBlock) return;
  let r; try { r = await usageReport(1); } catch { return; }
  const out = [], money = (n) => '$' + n.toFixed(2);
  if (st.usageDaily && r.today.cost >= st.usageDaily) out.push({ key: 'usage:day:' + new Date().toDateString(), title: 'Usage over your daily line', body: `Today is at ${money(r.today.cost)} (API-equivalent), past your ${money(st.usageDaily)} line.` });
  if (st.usageBlock && r.block && r.block.cost >= st.usageBlock) out.push({ key: 'usage:block:' + r.block.start, title: 'Usage over your 5-hour line', body: `This 5-hour block is at ${money(r.block.cost)}, past your ${money(st.usageBlock)} line. On pace for ${money(r.block.projected)}.` });
  const fresh = out.filter((a) => !usageAlerted.has(a.key)); fresh.forEach((a) => usageAlerted.add(a.key));
  if (!fresh.length || st.alerts === false) return;
  const items = fresh.map((a) => ({ id: crypto.randomBytes(4).toString('hex'), ts: Date.now(), kind: 'usage', key: a.key, session: '', title: a.title, body: a.body }));
  try { fs.appendFileSync(ALERTS, items.map((a) => JSON.stringify(a)).join('\n') + '\n'); } catch {}
  for (const a of items) broadcast({ type: 'alert', alert: a });
}
setInterval(checkUsage, 120e3); setTimeout(checkUsage, 8000);
actions['GET /api/health'] = () => {
  const out = [], ok = (name, pass, detail) => out.push({ name, pass, detail });
  let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')); } catch {}
  const has = (ev, f) => (st.hooks?.[ev] || []).some((g) => (g.hooks || []).some((h) => String(h.command || '').includes(f)));
  ok('Router hook', has('UserPromptSubmit', 'route.mjs'), 'Suggests chains and skills on every prompt');
  ok('Activity hooks', ['PreToolUse', 'PostToolUse', 'Stop', 'Notification'].every((e) => has(e, 'activity.mjs')), 'Feed this live view');
  let age = null; try { age = Date.now() - fs.statSync(path.join(H, 'index.json')).mtimeMs; } catch {}
  ok('Skill index', age != null, age == null ? 'Missing: run build.mjs index' : 'Rebuilt ' + (age < 3600e3 ? Math.round(age / 60e3) + ' min ago' : Math.round(age / 3600e3) + ' h ago'));
  let core = ''; try { core = fs.readFileSync(path.join(HOME, '.claude', 'CLAUDE.md'), 'utf8'); } catch {}
  ok('Core rules loaded', core.includes('Rule zero'), Math.round(core.length / 1000) + 'k characters in every session');
  let log = 0; try { log = fs.statSync(ACTIVITY).size; } catch {}
  ok('Activity log', true, Math.round(log / 1024) + ' KB (rotates at 512 KB)');
  let cl = ''; try { cl = fs.readFileSync(path.join(H, 'CHANGELOG.md'), 'utf8'); } catch {}
  const backlog = cl.split('\n').filter((l) => /^- \[ \]/.test(l)).map((l) => l.replace(/^- \[ \]\s*/, '').replace(/`/g, '').slice(0, 140));
  return { checks: out, backlog };
};
actions['GET /api/audit'] = (q) => JSON.parse(execFileSync(process.execPath, [path.join(H, 'bin', 'audit.mjs'), '--json', '--days', String(Math.min(60, Number(q.get('days')) || 7))], { encoding: 'utf8' }));
actions['POST /api/tests'] = () => {
  try { const o = execFileSync(process.execPath, [path.join(H, 'bin', 'test-route.mjs')], { encoding: 'utf8' }); return { pass: true, summary: o.trim().split('\n').pop() }; }
  catch (e) { const o = String(e.stdout || ''); return { pass: false, summary: o.trim().split('\n').pop(), fails: o.split('\n').filter((l) => /^FAIL|missing:/.test(l.trim())).slice(0, 12) }; }
};
actions['POST /api/open'] = (b) => {
  const p = real(String(b.path || '').replace(/^~(?=\/)/, HOME));
  if (!under(p, HOME) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('Not a folder in your home directory.');
  openWith([p], () => {}); return { ok: true };
};
// Opens a session in the Claude desktop app. Desktop sessions open directly; a terminal-only session is imported by Claude.
actions['POST /api/claude'] = (b) => {
  let sid = String(b.sid || '').replace(/[^A-Za-z0-9-]/g, ''); if (sid.length < 8) throw new Error('This session has no id yet.');
  const root = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'), when = (j) => Number(new Date(j.lastActivityAt || j.createdAt || 0)) || 0; let best = null;
  for (const a of ls(root)) for (const c of ls(path.join(root, a))) for (const f of ls(path.join(root, a, c))) {
    if (!/^local_[A-Za-z0-9-]+\.json$/.test(f)) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(root, a, c, f), 'utf8')); if (String(j.cliSessionId || '').startsWith(sid) && (!best || when(j) > when(best))) best = j; } catch {}
  }
  if (best && /^local_[A-Za-z0-9-]{1,64}$/.test(String(best.sessionId))) { openWith(['claude://code/continue?session=' + best.sessionId], () => {}); return { ok: true, how: 'opened' }; }
  if (sid.length < 36) { const t = transcriptOf(sid); if (t) sid = path.basename(t, '.jsonl'); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sid)) throw new Error('Could not find this session in Claude.');
  openWith(['claude://resume?session=' + sid], () => {}); return { ok: true, how: 'imported' };
};
actions['GET /api/skilltext'] = (q) => {
  let f = q.get('name') ? resolveSkillFile(String(q.get('name'))) : null;
  if (!f && q.get('path')) f = real(String(q.get('path')).replace(/^~(?=\/)/, HOME));
  if (!f) return { path: null, text: null };
  f = real(f);
  const ok = /\.(md|json|txt)$/i.test(f) && READ_ROOTS.some((r) => under(f, r)) && fs.existsSync(f) && fs.statSync(f).isFile();
  return { path: f, text: ok ? fs.readFileSync(f, 'utf8').slice(0, 120000) : null };
};

// ---------- server ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const server = http.createServer((req, res) => {
  try {
    if (!HOSTS.has(req.headers.host || '')) return send(res, 421, { error: 'Wrong host.' });
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, renderPage(buildData(), TOKEN), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true });
    if (req.method === 'GET' && /^\/sounds\/[\w-]+\.wav$/.test(url.pathname)) {
      const f = path.join(HERE, '..', url.pathname);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'GET' && /^\/vendor\/[\w.-]+\.js$/.test(url.pathname)) {
      const f = path.join(HERE, url.pathname);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (url.searchParams.get('t') !== TOKEN) return send(res, 403, { error: 'Missing or wrong token.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    const fn = actions[key];
    if (!fn) return send(res, 404, { error: 'Not found.' });
    if (req.headers['x-brain-token'] !== TOKEN) return send(res, 403, { error: 'Missing or wrong token. Reload the page.' });
    if (req.method === 'POST' && req.headers.origin && !ORIGINS.has(req.headers.origin)) return send(res, 403, { error: 'Wrong origin.' });
    if (req.method === 'GET') { const out = fn(url.searchParams); if (out && typeof out.then === 'function') { out.then((v) => send(res, 200, v), (e) => send(res, 500, { error: e.message })); return; } return send(res, 200, out); }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try { send(res, 200, fn(JSON.parse(raw || '{}'))); }
      catch (e) { send(res, e.code || 400, { error: e.message }); }
    });
  } catch (e) { send(res, 500, { error: e.message }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Agentic Harness editor: http://127.0.0.1:${PORT}  (Ctrl+C to stop)`));
