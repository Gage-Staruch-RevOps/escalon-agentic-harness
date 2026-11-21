#!/usr/bin/env node
// Builds the Agentic Harness brain: a local, self-contained node graph of the user's harness and skills.
// Reads the harness index, skill tree (router registry, chains), triggers, notes, projects and scheduled tasks,
// then writes index.html to the app data folder (a static copy for browsers; the server renders its own). No network, no dependencies.
//   node build.mjs            rebuild index.html
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { HOME, H, TREE, TASKS, HERE, DATA, COMPANY, COMPANY_SLUG } from './paths.mjs';
const exp = (p) => (p || '').replace(/^~(?=\/|$)/, HOME);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const readJSON = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const real = (p) => { try { return fs.realpathSync(exp(p)); } catch { return exp(p); } };
const short = (n) => String(n).replace(/^[\w-]+:/, '');

export function buildData() {
const index = readJSON(path.join(H, 'index.json'));
if (!index) throw new Error('No ~/.claude/harness/index.json; run build.mjs index first.');
const triggers = readJSON(path.join(H, 'triggers.json')) || { rules: [] };

const nodes = new Map();
const edges = [];
const edgeKeys = new Set();
const node = (id, o) => { if (!nodes.has(id)) nodes.set(id, { id, links: 0, ...o }); return nodes.get(id); };
const edge = (a, b, kind, extra = {}) => {
  if (!a || !b || a === b || !nodes.has(a) || !nodes.has(b)) return;
  const k = `${a}|${b}|${kind}|${extra.step ?? ''}`;
  if (edgeKeys.has(k)) return;
  edgeKeys.add(k);
  edges.push({ s: a, t: b, kind, ...extra });
  nodes.get(a).links++; nodes.get(b).links++;
};

// ---------- hubs and core ----------
node('core', { label: 'Harness core', type: 'core', desc: 'Loaded into every session through ~/.claude/CLAUDE.md. The loop, Rule zero, approvals and the project map.', path: path.join(H, '00-core') });
node('core:agent', { label: 'The loop', type: 'core', desc: 'agent.md: Orient, Route, Decide, Build, Verify, Report, Learn. Quality bar and context budget.', path: path.join(H, '00-core', 'agent.md') });
node('core:rules', { label: 'Rule zero + hard rules', type: 'core', desc: 'rules.md: route before any work, approvals, work and personal apart, deploys, writing.', path: path.join(H, '00-core', 'rules.md') });
node('core:projects', { label: 'Projects map', type: 'core', desc: 'projects.md: role, projects, tools and people.', path: path.join(H, '00-core', 'projects.md') });
node('hook', { label: 'Router hook', type: 'core', desc: 'route.mjs runs before every prompt: names the chain, the skills that fit and the project notes in a <harness> block.', path: path.join(H, 'bin', 'route.mjs') });
node('hub:library', { label: `Skill library (${index.entries.filter((e) => e.layer === '30-library').length})`, type: 'hub', desc: 'The baseline skill library, license-checked for commercial use. Reached through the router.', path: path.join(H, '30-library') });
node('hub:account', { label: 'Account and plugin skills', type: 'hub', desc: 'Skills installed on your Claude account and its plugins.', path: path.join(H, '20-account') });
node('hub:tree', { label: 'Skill tree', type: 'hub', desc: 'The company skill tree in the harness repo, routed by skill-router. Changes go through pull requests.', path: TREE });
node('hub:notes', { label: 'Project notes', type: 'hub', desc: 'One note per project; surfaced by triggers and by the working folder.', path: path.join(H, 'notes') });
node('hub:tasks', { label: 'Scheduled tasks', type: 'hub', desc: 'Unattended refreshes and syncs, each pre-approved for exactly its own steps.', path: TASKS });
for (const c of ['core:agent', 'core:rules', 'core:projects', 'hook']) edge('core', c, 'contains');
node('hub:escalon', { label: `${COMPANY} skills`, type: 'hub', desc: `${COMPANY} plugin skills and the router. Plugin skills are maintained by their owner.`, path: path.join(H, '10-mine', 'escalon') });
for (const h of ['hub:library', 'hub:account', 'hub:escalon', 'hub:tree', 'hub:notes', 'hub:tasks']) edge('core', h, 'contains');
// ---------- Claude memory: what Claude has written down for itself, per project ----------
{
  const proj = path.join(os.homedir(), '.claude', 'projects'); let any = false;
  for (const d of fs.existsSync(proj) ? fs.readdirSync(proj).sort() : []) {
    const dir = path.join(proj, d, 'memory'); let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    if (!files.length) continue;
    if (!any) { node('hub:memory', { label: 'Claude memory', type: 'hub', desc: 'What Claude has saved for itself across sessions, one node per project. These light up when Claude writes a memory.', path: proj }); edge('core', 'hub:memory', 'contains'); any = true; }
    const sc = /scratch-(\d{4}-\d\d-\d\d)/.exec(d); let label = sc ? 'Scratch ' + sc[1] : d.replace(/^-Users-[^-]+-?/, '').replace(/^(Desktop|Downloads|Documents)-/, '').replace(/-/g, ' ') || 'Home';
    const idx = read(path.join(dir, 'MEMORY.md'));
    node(`mem:${d}`, { label, type: 'memory', desc: (files.length - (files.includes('MEMORY.md') ? 1 : 0)) + ' memories. ' + idx.split('\n').filter((l) => l.trim()).slice(0, 5).map((l) => l.replace(/^- \[([^\]]+)\]\([^)]*\)/, '$1')).join(' ').slice(0, 360), path: path.join(dir, 'MEMORY.md') });
    edge('hub:memory', `mem:${d}`, 'contains');
  }
}

// ---------- skills ----------
const entries = index.entries;
const isTree = (e) => e.group?.startsWith('skill-tree/') || real(e.path).startsWith(TREE + path.sep);
const treeArea = (e) => {
  if (e.group?.startsWith('skill-tree/')) return e.group.slice('skill-tree/'.length);
  const r = real(path.dirname(e.path));
  return r.startsWith(TREE + path.sep) ? path.relative(TREE, r).split(path.sep)[0] : null;
};
const CO_RE = new RegExp(`^(${COMPANY_SLUG}-|anthropic-skills:${COMPANY_SLUG})`), escalonish = (e) => e.name.startsWith(COMPANY_SLUG + '-') || e.name === 'skill-router' || CO_RE.test(e.native || '');
const skillType = (e) => {
  if (escalonish(e)) return 'escalon';
  if (e.layer === '30-library') return 'library';
  if (isTree(e) || e.group === 'native') return 'own';
  return 'account';
};
const individual = (e) => e.layer === '10-mine' || (e.layer === '30-library' && e.native);
const byKey = new Map();
const addKey = (k, id) => { if (k && !byKey.has(k)) byKey.set(k, id); };

// registry layers (L1-L6) from skill-router's registry
const layerOf = new Map();
for (const line of read(path.join(TREE, '00-router', 'skill-router', 'references', 'registry.md')).split('\n')) {
  const cols = line.split('|').map((c) => c.trim());
  if (cols.length < 5 || !/^(L\d|owns chain|runtime|gate|L\d\/)/i.test(cols[3] || '')) continue;
  for (const m of cols[2].matchAll(/[\w.…-]+:?[\w-]+/g)) layerOf.set(short(m[0]), cols[3]);
}

const skillNode = (e) => {
  const id = e.native || `skill:${e.id}`;
  if (nodes.has(id)) return id;
  node(id, {
    label: short(e.native || e.name), type: skillType(e), desc: e.desc, path: real(e.path),
    native: e.native || null, layer: layerOf.get(short(e.native || e.name)) || layerOf.get(e.name) || null,
  });
  addKey(e.native, id); addKey(short(e.native || ''), id); addKey(e.name, id);
  return id;
};

for (const e of entries.filter(individual)) {
  const id = skillNode(e);
  const area = treeArea(e);
  if (area) {
    const hub = `tree:${area}`;
    node(hub, { label: area.replace(/^\d+-/, ''), type: 'hub', desc: `Skill tree area ${area}.`, path: path.join(TREE, area) });
    edge('hub:tree', hub, 'contains');
    edge(hub, id, 'contains');
  } else if (e.layer === '30-library') {
    edge('hub:library', id, 'contains');
  } else if (e.group === 'escalon' || skillType(e) === 'escalon') {
    edge('hub:escalon', id, 'contains');
  } else if (e.group === 'account') {
    edge('hub:account', id, 'contains');
  } else edge('core', id, 'contains');
}

// library categories and account groups as clusters
const cats = {};
for (const e of entries) if (e.layer === '30-library') (cats[e.group] ||= []).push(e);
for (const [cat, list] of Object.entries(cats)) {
  const id = `cat:${cat}`;
  node(id, { label: `${cat} (${list.length})`, type: 'library', cluster: true, count: list.length,
    desc: `${list.length} library skills. Top: ${list.filter((e) => e.fav).concat(list).slice(0, 8).map((e) => e.name).join(', ')}.`, path: path.join(H, '30-library', cat) });
  edge('hub:library', id, 'contains');
}
const groups = {};
for (const e of entries) if (e.layer === '20-account') (groups[e.group] ||= []).push(e);
for (const [g, list] of Object.entries(groups)) {
  const id = `grp:${g}`;
  node(id, { label: `${g.replace(/^(plugins|marketplace)\//, '')} (${list.length})`, type: 'account', cluster: true, count: list.length,
    desc: `${g}: ${list.slice(0, 10).map((e) => e.name).join(', ')}${list.length > 10 ? ', ...' : ''}.`, path: path.join(H, '20-account', g) });
  edge('hub:account', id, 'contains');
}

// resolve a skill reference (native, short or library name), creating a library node when referenced
const resolve = (ref) => {
  const r = String(ref).trim();
  if (byKey.has(r)) return byKey.get(r);
  if (byKey.has(short(r))) return byKey.get(short(r));
  const e = entries.find((x) => x.native === r || x.name === r || x.name === short(r));
  if (!e) return null;
  const id = skillNode(e);
  if (e.layer === '30-library') edge(`cat:${e.group}`, id, 'contains');
  else if (e.layer === '20-account') edge(`grp:${e.group}`, id, 'contains');
  return id;
};

// ---------- router and chains ----------
const routerId = resolve('skill-router');
if (routerId) edge('core:rules', routerId, 'routes');
edge('core:rules', 'hook', 'routes');
const chainsFile = path.join(TREE, '00-router', 'skill-router', 'references', 'chains.md');
const chainTitles = {};
for (const line of read(chainsFile).split('\n')) { const h = /^###\s+(C\d+)\.\s+(.+)$/.exec(line); if (h) chainTitles[h[1]] = h[2]; }
// single words only when they are real skill names used in chains, not generic words ("review", "update")
const ONE_WORD = new Set(['pptx', 'docx', 'xlsx', 'pdf', 'dataviz', 'docs', 'morning', 'learn', 'harness', 'animate', 'choreograph', 'gestures']);
const knownNames = [...byKey.keys()].concat(entries.map((e) => e.name)).filter((n) => short(n).includes('-') || ONE_WORD.has(short(n)));
// chains often shorten company skill names (dropping the company prefix): map those back
const alias = new Map();
for (const n of knownNames) {
  const s = short(n);
  if (!s.startsWith(COMPANY_SLUG + '-')) continue;
  for (const a of [s.slice(COMPANY_SLUG.length + 1)]) if (a.length >= 8 && a !== s && !alias.has(a)) alias.set(a, s);
}
knownNames.push(...alias.keys());
const resolveChainRef = (n) => resolve(alias.get(n) || n);
for (const [cid, text] of Object.entries(index.chains || {})) {
  const id = `chain:${cid}`;
  node(id, { label: `${cid} ${chainTitles[cid] || ''}`.trim(), type: 'chain', desc: text, path: chainsFile });
  edge(routerId || 'hook', id, 'routes');
  // ordered steps: every known skill name in the chain text, in order of appearance
  const found = [];
  for (const n of new Set(knownNames)) {
    const re = new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    const m = re.exec(text);
    if (m) found.push({ n, at: m.index });
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set();
  let step = 0;
  for (const { n } of found) {
    const sid = resolveChainRef(n);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    edge(id, sid, 'step', { step: ++step });
  }
}

// ---------- notes, triggers, projects ----------
const notesDir = path.join(H, 'notes');
for (const f of fs.existsSync(notesDir) ? fs.readdirSync(notesDir) : []) {
  if (!f.endsWith('.md') || f === 'README.md') continue;
  const body = read(path.join(notesDir, f));
  node(`note:${f}`, { label: f.replace(/\.md$/, ''), type: 'note', desc: body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 4).join(' ').slice(0, 400), path: path.join(notesDir, f) });
  edge('hub:notes', `note:${f}`, 'contains');
}
for (const r of triggers.rules || []) {
  const sk = (r.skills || []).map(resolve).filter(Boolean);
  for (const s of sk) {
    if (r.chain) edge(`chain:${r.chain}`, s, 'trigger');
    for (const n of r.notes || []) edge(s, `note:${n}`, 'note');
  }
}
for (const line of read(path.join(H, '00-core', 'projects.md')).split('\n')) {
  const cols = line.split('|').map((c) => c.trim());
  if (cols.length < 6 || cols[1] === 'Project' || /^-+$/.test(cols[1])) continue;
  const id = `project:${cols[1]}`;
  node(id, { label: cols[1], type: 'project', desc: `${cols[2]}. Where: ${cols[3].replace(/`/g, '')}. Ship: ${cols[4]}.`, path: path.join(H, '00-core', 'projects.md') });
  edge('core:projects', id, 'contains');
  const nm = /NOTES\/([\w.-]+\.md)/.exec(cols[5]);
  if (nm) edge(id, `note:${nm[1]}`, 'note');
}

// ---------- playbooks ----------
for (const pb of index.playbooks || []) {
  const id = `playbook:${pb.name}`;
  node(id, { label: pb.name, type: 'playbook', desc: pb.desc, path: exp(pb.path) });
  edge('core:agent', id, 'contains');
  pb.skills.forEach((s, i) => edge(id, resolve(s), 'step', { step: i + 1 }));
}

// ---------- scheduled tasks ----------
const skillWords = [...new Set(entries.filter((e) => e.layer === '10-mine').map((e) => short(e.native || e.name)))].filter((n) => n.length > 5);
for (const t of fs.existsSync(TASKS) ? fs.readdirSync(TASKS) : []) {
  const f = path.join(TASKS, t, 'SKILL.md');
  const body = read(f);
  if (!body) continue;
  const d = /^description:\s*(.+)$/m.exec(body);
  const id = `task:${t}`;
  node(id, { label: t, type: 'task', desc: d ? d[1] : '', path: f });
  edge('hub:tasks', id, 'contains');
  for (const w of skillWords) if (body.includes(w)) edge(id, resolve(w), 'uses');
}
edge('hub:tasks', 'note:scheduled-tasks.md', 'note');

// ---------- write ----------
const data = {
  built: new Date().toISOString(),
  nodes: [...nodes.values()],
  edges,
  triggers: (triggers.rules || []).map((r, i) => ({ i, match: r.match, skills: r.skills || [], notes: r.notes || [], chain: r.chain || null })),
  treeAreas: fs.existsSync(TREE) ? fs.readdirSync(TREE).filter((d) => /^\d\d-/.test(d) && fs.statSync(path.join(TREE, d)).isDirectory()) : [],
  counts: {
    library: index.entries.filter((e) => e.layer === '30-library').length,
    account: index.entries.filter((e) => e.layer === '20-account').length,
    own: [...nodes.values()].filter((n) => n.type === 'own' || n.type === 'escalon').length,
    chains: Object.keys(index.chains || {}).length,
  },
};
return data;
}

// Static, read-only page (the server renders the editable one).
export function renderPage(data, token = null) {
  const tpl = read(path.join(HERE, 'template.html'));
  if (!tpl) throw new Error('template.html missing next to build.mjs');
  const logos = brandLogos();
  return tpl
    .replace('<!--LOGO_DARK-->', logos.dark).replace('<!--LOGO_WHITE-->', logos.white)
    .replace('/*__DATA__*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'))
    .replace('/*__TOKEN__*/null', JSON.stringify(token));
}

// Official company logos, inlined (never linked or redrawn). The repo's app/brand/<company>-logo-dark.svg and -white.svg
// come first, so everyone sees the logo; an installed <company>-brand plugin skill is the fallback.
function brandLogos() {
  let dir = fs.existsSync(path.join(HERE, '..', 'brand', COMPANY_SLUG + '-logo-white.svg')) ? path.join(HERE, '..', 'brand') : null;
  const base = path.join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
  try {
    if (!dir) for (const a of fs.readdirSync(base)) for (const b of fs.readdirSync(path.join(base, a))) {
      const rpm = path.join(base, a, b, 'rpm');
      if (!fs.existsSync(rpm)) continue;
      for (const p of fs.readdirSync(rpm)) { const d = path.join(rpm, p, 'skills', COMPANY_SLUG + '-brand', 'assets', 'logos'); if (fs.existsSync(d)) dir = d; }
    }
  } catch {}
  const svg = (f) => { const s = dir ? read(path.join(dir, f)) : ''; return s ? s.replace(/<\?xml[^>]*>\s*/, '').replace(/<svg\b/, () => `<svg aria-label="${COMPANY.replace(/["<>&]/g, '')}" role="img"`) : `<span class="wordmark">${COMPANY.toUpperCase().replace(/[<>&"]/g, '')}</span>`; };
  return { dark: svg(COMPANY_SLUG + '-logo-dark.svg'), white: svg(COMPANY_SLUG + '-logo-white.svg') };
}

if (process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  const data = buildData();
  const html = renderPage(data);
  fs.writeFileSync(path.join(DATA, 'index.html'), html.replace('src="vendor/', `src="${path.join(HERE, 'vendor').replace(/\\/g, '/')}/`));
  console.log(`brain: ${data.nodes.length} nodes, ${data.edges.length} links -> ${path.join(DATA, 'index.html')}`);
}
