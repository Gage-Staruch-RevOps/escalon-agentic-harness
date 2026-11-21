// Installs or refreshes the harness for one person. Used by setup.mjs (command line), update.mjs and the app's first-run screen.
// Company-owned files come from the repo and are refreshed on every run. User-owned files are created once and never overwritten:
// user.json, 00-core/projects.md, notes/, 10-mine/, feedback.json, CHANGELOG.md.
// Before the first install it backs up ~/.claude/harness, ~/.claude/settings.json and ~/.claude/CLAUDE.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = os.homedir();
export const CLAUDE = path.join(HOME, '.claude');
export const H = path.join(CLAUDE, 'harness');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const MARK = path.join(H, '.installed-from');
const fwd = (p) => p.split(path.sep).join('/');

export const FIELDS = [
  { key: 'name', q: 'Your name (how Claude should refer to you)', required: true },
  { key: 'company', q: 'Company', def: 'Escalon' },
  { key: 'role', q: 'Your role or title', required: true },
  { key: 'team', q: 'Your team (for example Sales, Marketing, Finance, RevOps)', required: true },
  { key: 'manager', q: 'Your manager (optional)' },
  { key: 'timezone', q: 'Time zone', def: Intl.DateTimeFormat().resolvedOptions().timeZone },
  { key: 'focus', q: 'In one sentence, what do you do day to day?', def: '', ph: 'For example: I run pipeline reviews and coach the sales team.' },
  { key: 'tools', q: 'Main work tools, comma separated (optional)', def: '', ph: 'For example: Salesforce, Outlook, Teams, Excel' },
];

export function readUser() { try { return JSON.parse(fs.readFileSync(path.join(H, 'user.json'), 'utf8')); } catch { return null; } }

export function checkUser(u) {
  const errs = [];
  for (const f of FIELDS) if (f.required && !String(u[f.key] || '').trim()) errs.push(`${f.q} is required.`);
  for (const [k, v] of Object.entries(u)) if (String(v).length > 300) errs.push(`${k} is too long.`);
  if (/\{\{|\}\}/.test(JSON.stringify(u))) errs.push('Answers cannot contain {{ or }}.');
  return errs;
}

function nodeCommand() {
  // Hooks run outside the app, so they need a real Node on this computer, not Electron's.
  const env = process.env.HARNESS_NODE;
  if (env) return env;
  // Prefer the stable launcher on PATH (for example /opt/homebrew/bin/node) over a versioned install folder that an upgrade removes.
  try { const w = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim(); if (w) return w; } catch {}
  return process.versions.electron ? 'node' : process.execPath;
}

function copyDir(src, dst, { overwrite = true } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    if (n === '.DS_Store') continue;
    const a = path.join(src, n), b = path.join(dst, n);
    if (fs.statSync(a).isDirectory()) copyDir(a, b, { overwrite });
    else if (overwrite || !fs.existsSync(b)) fs.copyFileSync(a, b);
  }
}

function backupOnce(log) {
  if (fs.existsSync(MARK)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(CLAUDE, 'backups', `before-agentic-harness-${stamp}`);
  let any = false;
  for (const p of [H, SETTINGS, path.join(CLAUDE, 'CLAUDE.md')]) {
    if (!fs.existsSync(p)) continue;
    fs.mkdirSync(dir, { recursive: true }); any = true;
    if (fs.statSync(p).isDirectory()) {
      // the library and fetch cache are rebuilt from GitHub, so they are not copied
      copyDir(p, path.join(dir, path.basename(p)));
      for (const big of ['30-library', '20-account', '90-quarantine']) fs.rmSync(path.join(dir, path.basename(p), big), { recursive: true, force: true });
    } else fs.copyFileSync(p, path.join(dir, path.basename(p)));
  }
  if (any) log(`backed up your existing Claude setup to ${dir}`);
  return any ? dir : null;
}

function fillTemplate(text, u) {
  const v = {
    ...u,
    focus: u.focus || 'Not set yet.',
    manager_clause: u.manager ? `, reporting to ${u.manager}` : '',
    manager_line: u.manager ? `${u.manager}: ${u.name}'s manager.` : 'PLACEHOLDER: your manager.',
    tools: String(u.tools || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => `- ${t}`).join('\n') || '- PLACEHOLDER: the tools you use, and how Claude reaches each one.',
  };
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
}

const HOOK_EVENTS = { UserPromptSubmit: 'route.mjs', PreToolUse: 'activity.mjs', PostToolUse: 'activity.mjs', PostToolUseFailure: 'activity.mjs', Stop: 'activity.mjs', Notification: 'activity.mjs' };
const isOurs = (h) => /[\\/]\.claude[\\/]harness[\\/]bin[\\/](route|activity)\.mjs/.test(h?.command || '');

export function writeHooks(remove = false) {
  let s = {}; try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) { if (fs.existsSync(SETTINGS)) throw new Error(`~/.claude/settings.json is not valid JSON; fix it first (${e.message}).`); }
  s.hooks ||= {};
  const node = nodeCommand();
  for (const [ev, script] of Object.entries(HOOK_EVENTS)) {
    const groups = (s.hooks[ev] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length);
    if (!remove) groups.push({ ...(ev.includes('ToolUse') ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: `"${node}" "${path.join(H, 'bin', script)}"`, timeout: 5 }] });
    if (groups.length) s.hooks[ev] = groups; else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  fs.mkdirSync(CLAUDE, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

function linkSkill(src, name, log) {
  const dst = path.join(CLAUDE, 'skills', name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    const st = fs.lstatSync(dst);
    if (st.isSymbolicLink()) fs.unlinkSync(dst);
    else { log(`left ~/.claude/skills/${name} alone: a skill with that name is already yours`); return; }
  } catch {}
  fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
}

export function runBuild(args, log) {
  const out = execFileSync(nodeCommand(), [path.join(H, 'bin', 'build.mjs'), ...args], { encoding: 'utf8', maxBuffer: 64e6, timeout: 3600e3 });
  out.trim().split('\n').slice(-6).forEach((l) => log(l));
}

// user: answers (null keeps the saved profile). library: also fetch and import the public skill library (about 700 MB, slow).
export function install({ user = null, library = false, log = console.log } = {}) {
  const u = user || readUser();
  if (!u) throw new Error('No profile yet. Run setup first: npm run setup');
  const errs = checkUser(u); if (errs.length) throw new Error(errs.join(' '));
  const first = !fs.existsSync(MARK);
  backupOnce(log);
  fs.mkdirSync(H, { recursive: true });

  // company-owned: refreshed every time
  copyDir(path.join(REPO, 'harness', 'bin'), path.join(H, 'bin'));
  copyDir(path.join(REPO, 'harness', '05-playbooks'), path.join(H, '05-playbooks'));
  copyDir(path.join(REPO, 'harness', 'native'), path.join(H, 'native'));
  fs.mkdirSync(path.join(H, '00-core'), { recursive: true });
  for (const f of ['agent.md', 'rules.md']) fs.copyFileSync(path.join(REPO, 'harness', '00-core', f), path.join(H, '00-core', f));
  fs.copyFileSync(path.join(REPO, 'harness', 'triggers.json'), path.join(H, 'triggers.json'));
  fs.copyFileSync(path.join(REPO, 'harness', 'HOW-TO-EDIT.md'), path.join(H, 'HOW-TO-EDIT.md'));
  const sources = fs.readFileSync(path.join(REPO, 'harness', 'sources.json'), 'utf8').replaceAll('{{REPO}}', fwd(REPO));
  fs.writeFileSync(path.join(H, 'sources.json'), sources);

  // user-owned: written once
  fs.writeFileSync(path.join(H, 'user.json'), JSON.stringify(u, null, 2) + '\n');
  const proj = path.join(H, '00-core', 'projects.md');
  if (!fs.existsSync(proj) || (user && first)) fs.writeFileSync(proj, fillTemplate(fs.readFileSync(path.join(REPO, 'harness', '00-core', 'projects.template.md'), 'utf8'), u));
  copyDir(path.join(REPO, 'harness', 'notes'), path.join(H, 'notes'), { overwrite: false });
  fs.mkdirSync(path.join(H, '10-mine'), { recursive: true });
  if (!fs.existsSync(path.join(H, 'feedback.json'))) fs.writeFileSync(path.join(H, 'feedback.json'), '[]\n');
  if (!fs.existsSync(path.join(H, 'CHANGELOG.md'))) fs.writeFileSync(path.join(H, 'CHANGELOG.md'), `# Harness changelog\n\nOne dated line per change to this harness.\n\n- ${new Date().toISOString().slice(0, 10)}: installed from the company harness repo.\n`);

  // native skills: the harness skill is copied; router skills link to the repo so a git pull updates them
  copyDir(path.join(H, 'native', 'harness'), path.join(CLAUDE, 'skills', 'harness'));
  for (const s of ['skill-router', 'harness-retro']) linkSkill(path.join(REPO, 'skills', '00-router', s), s, log);

  writeHooks();
  fs.writeFileSync(MARK, fwd(REPO) + '\n');
  log(first ? `installed the harness for ${u.name}` : 'refreshed the harness from the repo');

  runBuild(library ? ['all'] : ['index'], log);
  return { first };
}

export function uninstall({ log = console.log } = {}) {
  writeHooks(true); log('removed the harness hooks from ~/.claude/settings.json');
  const boot = path.join(CLAUDE, 'CLAUDE.md');
  try {
    const cur = fs.readFileSync(boot, 'utf8'), next = cur.replace(/<!-- harness:core:start[\s\S]*?<!-- harness:core:end -->\n?/, '');
    if (next !== cur) { fs.writeFileSync(boot, next); log('removed the harness block from ~/.claude/CLAUDE.md'); }
  } catch {}
  for (const s of ['skill-router', 'harness-retro']) { const d = path.join(CLAUDE, 'skills', s); try { if (fs.lstatSync(d).isSymbolicLink()) fs.unlinkSync(d); } catch {} }
  fs.rmSync(MARK, { force: true });
  log('left ~/.claude/harness in place (your notes, profile and history). Delete it yourself if you want it gone.');
}
