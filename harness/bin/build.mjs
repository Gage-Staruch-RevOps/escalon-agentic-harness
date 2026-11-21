#!/usr/bin/env node
// Harness builder.
//   node build.mjs fetch     clone or update the git sources into the cache
//   node build.mjs import    copy skills from every source into the harness folders, scanning each
//   node build.mjs promote   copy promoted skills into ~/.claude/skills so they register natively
//   node build.mjs index     rebuild index.json, INDEX.md and THIRD-PARTY-NOTICES.md from the folders on disk
//   node build.mjs all       fetch + import + promote + index
// Folders on disk are the source of truth. Each imported skill carries a .source.json for provenance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { words, terms } from './text.mjs';
import { classify as licenseCheck } from './license-policy.mjs';

const HOME = os.homedir();
const H = path.join(HOME, '.claude', 'harness');
const NATIVE_DIR = path.join(HOME, '.claude', 'skills');
const exp = (p) => p.replace(/^~(?=\/|$)/, HOME);
const cfg = JSON.parse(fs.readFileSync(path.join(H, 'sources.json'), 'utf8'));
const CACHE = exp(cfg.cache);
const TIERS = ['mine', 'account', 'anthropic', 'author', 'vendor', 'community'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.next', 'dist', '.cache', '.trash']);
const MAX_FILE = 1_500_000; // bytes; larger files are left behind
const MAX_SKILL = 12_000_000; // bytes per skill folder
const log = (...a) => console.log(...a);

// ---------- helpers ----------
export function parseFrontmatter(text) {
  const m = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const km = lines[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!km) continue;
    let [, k, v] = km;
    if (/^[>|][+-]?\s*$/.test(v)) {
      const buf = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) buf.push(lines[++i].trim());
      v = buf.join(v.startsWith('|') ? '\n' : ' ').trim();
    } else if (v === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      const arr = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) arr.push(lines[++i].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
      if (!(k in out)) out[k] = arr;
      continue;
    } else if (/^\[.*\]$/.test(v.trim())) {
      if (!(k in out)) out[k] = v.trim().slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    } else {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+-\s/.test(lines[i + 1])) v += ' ' + lines[++i].trim();
      v = v.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    if (!(k in out)) out[k] = v;
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const fwd = (p) => p.split(path.sep).join('/');
const rel = (p) => fwd(p.replace(HOME, '~'));

function walkSkillFiles(root, out = []) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkSkillFiles(path.join(root, e.name), out); }
    else if (e.name === 'SKILL.md') out.push(path.join(root, e.name));
  }
  return out;
}

function copySkillDir(src, dst, skillDirs) {
  let total = 0;
  const skipped = [];
  const rec = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      const sp = path.join(s, e.name), dp = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (skillDirs.has(sp)) continue; // nested skill, imported on its own
        rec(sp, dp);
      } else if (e.isFile()) {
        const size = fs.statSync(sp).size;
        if (size > MAX_FILE || total + size > MAX_SKILL) { skipped.push(path.relative(src, sp)); continue; }
        total += size;
        fs.copyFileSync(sp, dp);
      }
    }
  };
  rec(src, dst);
  return { total, skipped };
}

// ---------- security scan ----------
const HIGH = [
  [/[\u{E0000}-\u{E007F}]/u, 'hidden unicode tag characters'],
  [/ignore (all |any )?(previous|prior|above) (instructions|prompts)/i, 'prompt-injection phrase'],
  [/(disregard|override|bypass) (your|the|all) (system prompt|safety (rules|guidelines|instructions)|guardrails|previous instructions)/i, 'prompt-injection phrase'],
  [/base64\s+(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/i, 'decodes and executes hidden payload'],
  [/(\.ssh\/id_|\.aws\/credentials|Library\/Keychains|\.netrc)[\s\S]{0,200}(curl|fetch|requests\.post|nc )/i, 'reads credentials near a network call'],
];
const MEDIUM = [
  [/(curl|wget)[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'pipes a remote script to a shell'],
  [/rm\s+-rf\s+(\/|~|\$HOME)(\s|$)/, 'recursive delete of root or home'],
  [/[A-Za-z0-9+/]{600,}={0,2}/, 'large base64 blob'],
  [/[​-‏⁠-⁤]{3,}/u, 'zero-width character run'],
];
function scanDir(dir) {
  const flags = new Set();
  let high = false;
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { rec(p); continue; }
      if (!/\.(md|txt|sh|bash|zsh|py|js|mjs|cjs|ts|json|ya?ml|toml|rb|ps1|html)$/i.test(e.name)) continue;
      let t; try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const isDoc = /\.md$/i.test(e.name);
      for (const [rx, why] of HIGH) {
        if (why === 'prompt-injection phrase') {
          // Defensive skills quote these phrases ("ignore previous instructions") to warn about them. Only unquoted use counts.
          const g = new RegExp(rx.source, 'gi');
          let m, live = false;
          while ((m = g.exec(t))) { const before = t.slice(Math.max(0, m.index - 2), m.index); if (!/["“'‘(`]/.test(before)) { live = true; break; } }
          if (!live) continue;
        } else if (!rx.test(t)) continue;
        flags.add(`HIGH ${why} (${path.relative(dir, p)})`);
        high = true;
      }
      for (const [rx, why] of MEDIUM) {
        if (why === 'large base64 blob' && !isDoc && !/\.(sh|py|js|mjs|ts)$/i.test(e.name)) continue;
        if (rx.test(t)) flags.add(`MED ${why} (${path.relative(dir, p)})`);
      }
    }
  };
  rec(dir);
  return { high, flags: [...flags] };
}

// ---------- categorize ----------
const CATS = {
  'design-ui': 'design ui ux interface animation animate animations motion typography font fonts color colors palette brand figma visual aesthetic taste gesture gestures polish icon icons theme themes accessibility a11y wcag hig layout landing styling microinteraction sonner',
  'frontend-web': 'react nextjs next.js vue svelte angular frontend front-end html css tailwind shadcn component components vite browser webapp dom astro remix javascript typescript pwa hydration ssr rsc',
  'mobile-apple': 'ios swift swiftui xcode iphone ipad macos android kotlin mobile react-native expo flutter watchos visionos uikit appkit',
  'backend-api': 'api apis backend server node express fastapi django rails golang rust java database databases sql postgres postgresql mysql sqlite supabase prisma orm auth authentication graphql rest redis queue stripe payments webhook webhooks drizzle',
  'cloud-devops': 'cloudflare workers wrangler aws gcp azure docker kubernetes k8s terraform ci cd deploy deployment deployments devops infra infrastructure serverless vercel netlify monitoring observability sentry logging linux shell bash nginx helm',
  'ai-agents': 'llm llms prompt prompts prompting rag agent agents agentic mcp claude anthropic openai gpt model models embedding embeddings vector fine-tune finetune ml machine-learning pytorch huggingface transformers eval evals inference subagent subagents',
  'engineering': 'tdd debug debugging refactor refactoring review reviews git commit commits branch pull-request pr planning plan plans architecture worktree worktrees implementation implement brainstorming lint linting simplify clean codebase legacy modernization lsp',
  'testing-qa': 'test testing tests playwright cypress jest vitest pytest e2e qa coverage benchmark benchmarks regression',
  'security': 'security vulnerability vulnerabilities pentest exploit cve threat owasp secrets cryptography semgrep codeql fuzz fuzzing malware sast hardening',
  'data-analytics': 'data analytics analysis pandas dataframe chart charts visualization dashboard dashboards metrics statistics statistical bigquery jupyter notebook plot plotting kpi',
  'documents-office': 'docx pdf pptx xlsx word excel powerpoint spreadsheet spreadsheets slides presentation presentations document documents',
  'writing-comms': 'writing write writer copy copywriting content blog article articles essay editing grammar tone voice communication comms newsletter storytelling prose humanize',
  'marketing-growth': 'marketing seo campaign campaigns ads advertising social growth launch conversion funnel influencer positioning competitive competitor',
  'sales-crm': 'sales crm prospect prospects prospecting lead leads pipeline deal deals outreach cold partner partners referral referrals twenty hubspot salesforce',
  'product-strategy': 'product roadmap spec specs prd requirements research-synthesis strategy stakeholder sprint okr okrs feature discovery persona prioritization',
  'business-ops': 'finance financial accounting journal reconciliation budget invoice tax taxes legal contract contracts compliance policy hr hiring recruiting operations ops vendor procurement risk sox audit manufacturing supplier capa',
  'research-science': 'research science scientific biology bioinformatics chemistry genomics protein molecule molecular paper papers literature academic citation clinical medical physics math mathematics proof astronomy lab',
  'media-creative': 'image images video videos audio music sound art generative gif 3d threejs three.js blender remotion photo photos illustration svg game games p5',
  'productivity': 'task tasks todo notes note calendar meeting meetings memory personal schedule inbox digest habit brief morning',
  'automation-integrations': 'automation automate workflow workflows scrape scraping crawler n8n zapier slack notion linear github jira integration integrations bot bots telegram discord imessage gmail',
  'meta-skills': 'skill skills skill-creator plugin plugins claude-code hook hooks command commands settings claude.md marketplace',
};
const CAT_WORDS = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, new Set(v.split(/\s+/))]));
function categorize(name, desc, hint = '') {
  const score = {};
  const add = (text, w) => { for (const t of new Set(words(text))) for (const [c, set] of Object.entries(CAT_WORDS)) if (set.has(t)) score[c] = (score[c] || 0) + w; };
  add(name.replace(/-/g, ' '), 3);
  add(desc, 1);
  add(hint.replace(/[\/_-]/g, ' '), 0.5);
  let best = 'general', bs = 0;
  for (const [c, s] of Object.entries(score)) if (s > bs) { best = c; bs = s; }
  return best;
}

// ---------- fetch ----------
function fetchAll() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const g of cfg.git) {
    const dir = path.join(CACHE, g.repo.replace('/', '__'));
    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        execFileSync('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin'], { stdio: 'pipe', timeout: 300000 });
        execFileSync('git', ['-C', dir, 'reset', '-q', '--hard', 'FETCH_HEAD'], { stdio: 'pipe' });
        log(`updated ${g.repo}`);
      } else {
        const args = ['clone', '-q', '--depth', '1'];
        if (g.sparse) args.push('--filter=blob:none', '--sparse');
        args.push(`https://github.com/${g.repo}.git`, dir);
        execFileSync('git', args, { stdio: 'pipe', timeout: 600000 });
        if (g.sparse) execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', ...g.sparse], { stdio: 'pipe', timeout: 600000 });
        log(`cloned  ${g.repo}${g.sparse ? ' (sparse: ' + g.sparse.join(', ') + ')' : ''}`);
      }
    } catch (e) { log(`FAILED  ${g.repo}: ${String(e.stderr || e.message).split('\n')[0]}`); }
  }
}

// ---------- import ----------
function findLicense(dir, stopAt) {
  let d = dir;
  while (d.startsWith(stopAt)) {
    for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
    if (d === stopAt) break;
    d = path.dirname(d);
  }
  return null;
}
function licenseName(p) {
  if (!p) return 'unspecified';
  const t = fs.readFileSync(p, 'utf8').slice(0, 600);
  if (/MIT License|Permission is hereby granted/i.test(t)) return 'MIT';
  if (/Apache License/i.test(t)) return 'Apache-2.0';
  if (/BSD/i.test(t)) return 'BSD';
  if (/GNU GENERAL PUBLIC/i.test(t)) return 'GPL';
  if (/Creative Commons|CC BY/i.test(t)) return 'CC';
  if (/proprietary|all rights reserved|Anthropic/i.test(t)) return 'proprietary (see LICENSE)';
  return 'see LICENSE';
}

function collectCandidates() {
  const cands = [];
  // local sources
  for (const s of cfg.local) {
    const base = exp(s.glob);
    const roots = base.endsWith('/*') ? (fs.existsSync(path.dirname(base)) ? fs.readdirSync(path.dirname(base)).map((n) => path.join(path.dirname(base), n)) : []) : [base];
    for (const root of roots) {
      if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const f of walkSkillFiles(root)) {
        const relp = path.relative(root, f);
        const parts = relp.split(path.sep);
        let plugin = '';
        if (s.id === 'account-plugins') plugin = parts[0].replace(/~g\d+$/, '');
        if (s.id === 'claude-plugins-official') plugin = parts[1] || 'misc';
        cands.push({ file: f, root, source: s.id, tier: s.tier, layer: s.layer, group: s.group.replace('{plugin}', plugin), native: s.native ? s.native.replace('{plugin}', plugin) : null, plugin, commit: null });
      }
    }
  }
  // git sources
  for (const g of cfg.git) {
    const root = path.join(CACHE, g.repo.replace('/', '__'));
    if (!fs.existsSync(root)) continue;
    let commit = null;
    try { commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch {}
    const ex = g.exclude ? new RegExp(g.exclude) : null;
    const inc = g.include ? new RegExp(g.include) : null;
    const starts = (g.paths || g.sparse || ['']).map((p) => path.join(root, p));
    for (const start of starts) {
      for (const f of walkSkillFiles(start)) {
        const r = path.relative(root, f);
        if (/(^|\/)(tests?|fixtures?|__tests__|evals?\/fixtures)(\/|$)/i.test(r)) continue;
        if (ex && ex.test(r)) continue;
        if (inc && !inc.test(r)) continue;
        cands.push({ file: f, root, source: g.repo, tier: g.tier, layer: '30-library', category: g.category, commit, native: null, extras: g.extras });
      }
    }
  }
  return cands;
}

function importAll() {
  const cached = cfg.git.filter((g) => fs.existsSync(path.join(CACHE, g.repo.replace('/', '__')))).length;
  if (cached < cfg.git.length / 2) {
    log(`only ${cached} of ${cfg.git.length} sources are in the cache (${rel(CACHE)}); refusing to rebuild 20-account and 30-library. Run "build.mjs fetch" first and check it can reach github.com.`);
    return;
  }
  const cands = collectCandidates();
  const skillDirs = new Set(cands.map((c) => path.dirname(c.file)));
  // fresh rebuild of imported layers; 10-mine is never touched
  for (const l of ['20-account', '30-library', '90-quarantine']) { fs.rmSync(path.join(H, l), { recursive: true, force: true }); fs.mkdirSync(path.join(H, l), { recursive: true }); }
  const seenHash = new Map();
  const taken = new Set();
  const report = { imported: 0, dupes: 0, invalid: 0, quarantined: [], flagged: [], licenseBlocked: [] };
  const trustedLic = cfg.licensePolicy?.trustedSources || {};
  cands.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  for (const c of cands) {
    const text = fs.readFileSync(c.file, 'utf8');
    const fm = parseFrontmatter(text);
    const dir = path.dirname(c.file);
    const name = slug(fm.name || path.basename(dir));
    const desc = (fm.description || '').trim();
    if (!desc || desc.length < 12) { report.invalid++; continue; }
    if (/^(example|template)(-skill|-plugin)?$/.test(name) || /(^|\/)example-(plugin|skill)s?\//.test(c.file)) { report.invalid++; continue; }
    const h = sha(text.replace(/\s+/g, ' '));
    if (seenHash.has(h)) { report.dupes++; continue; }
    seenHash.set(h, c.source);
    const owner = c.source.split('/')[0];
    let destParent;
    if (c.layer === '30-library') destParent = path.join(H, '30-library', cfg.overrides?.[name] || c.category || categorize(name, desc, path.relative(c.root, dir)));
    else destParent = path.join(H, c.layer, c.group);
    let leaf = name;
    if (taken.has(path.join(destParent, leaf)) || (c.layer === '30-library' && taken.has('lib:' + name))) leaf = `${name}--${slug(owner)}`;
    let n = 2; while (taken.has(path.join(destParent, leaf))) leaf = `${name}--${slug(owner)}-${n++}`;
    let dest = path.join(destParent, leaf);
    const { skipped } = copySkillDir(dir, dest, skillDirs);
    const scan = scanDir(dest);
    if (scan.high) {
      const q = path.join(H, '90-quarantine', `${slug(owner)}__${leaf}`);
      fs.renameSync(dest, q);
      dest = q;
      report.quarantined.push({ name, source: c.source, flags: scan.flags });
    } else if (scan.flags.length) report.flagged.push({ name, source: c.source, flags: scan.flags });
    taken.add(path.join(destParent, leaf));
    if (c.layer === '30-library') taken.add('lib:' + name);
    for (const xf of (c.extras?.[path.basename(dir)] || [])) {
      const xp = path.join(c.root, xf);
      if (fs.existsSync(xp) && fs.statSync(xp).size < MAX_FILE) fs.copyFileSync(xp, path.join(dest, path.basename(xf)));
    }
    const lic = findLicense(dir, c.root);
    if (lic && !fs.existsSync(path.join(dest, path.basename(lic)))) fs.copyFileSync(lic, path.join(dest, 'LICENSE.source'));
    const nativeName = c.native ? c.native.replace('{name}', fm.name || name) : null;
    fs.writeFileSync(path.join(dest, '.source.json'), JSON.stringify({
      source: c.source, tier: c.tier, commit: c.commit, srcPath: rel(dir), license: licenseName(lic),
      native: nativeName, flags: scan.flags, skippedFiles: skipped, importedAt: new Date().toISOString(),
    }, null, 2));
    const lc = licenseCheck(dest, licenseName(lic), trustedLic[c.source] || null);
    if (!lc.ok) { fs.rmSync(dest, { recursive: true, force: true }); taken.delete(path.join(destParent, leaf)); report.licenseBlocked.push({ name, source: c.source, why: lc.why }); continue; }
    report.imported++;
  }
  fs.writeFileSync(path.join(H, 'scan-report.json'), JSON.stringify(report, null, 2));
  log(`imported ${report.imported}, exact dupes skipped ${report.dupes}, invalid ${report.invalid}, quarantined ${report.quarantined.length}, flagged ${report.flagged.length}, license-blocked ${report.licenseBlocked.length}`);
}

// ---------- promote ----------
// Promoted skills load during routing; a canned "Initial Response" greeting would print instead of doing the work.
function stripInitialResponse(f) {
  try { const t = fs.readFileSync(f, 'utf8'); const n = t.replace(/^## Initial Response\n[\s\S]*?(?=^## )/m, ''); if (n !== t) fs.writeFileSync(f, n); } catch {}
}

function promote() {
  const want = new Set(cfg.promote.skills || []);
  const srcs = new Set(cfg.promote.sources || []);
  let n = 0;
  for (const d of listSkillDirs(path.join(H, '30-library'))) {
    const meta = readJSON(path.join(d, '.source.json')) || {};
    const leaf = path.basename(d);
    if (!(srcs.has(meta.source) || want.has(leaf))) continue;
    if (meta.flags?.length) { log(`not promoting flagged skill ${leaf}`); continue; }
    const target = path.join(NATIVE_DIR, leaf);
    const fork = listSkillDirs(path.join(H, '10-mine')).find((m) => path.basename(m) === leaf);
    const from = fork || d;
    if (fs.existsSync(target) && !fs.existsSync(path.join(target, '.harness-promoted'))) { log(`skip ${leaf}: ~/.claude/skills/${leaf} is yours`); continue; }
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(from, target, { recursive: true });
    stripInitialResponse(path.join(target, 'SKILL.md'));
    fs.writeFileSync(path.join(target, '.harness-promoted'), `Copied from ${rel(from)} by harness/bin/build.mjs promote. Edit the harness copy, not this one.\n`);
    n++;
  }
  log(`promoted ${n} skills into ~/.claude/skills`);
}

// ---------- index ----------
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function listSkillDirs(root) { return walkSkillFiles(root).map((f) => path.dirname(f)); }
const FAVS = new Set(cfg.favorites || []);
function readPlaybooks() {
  const dir = path.join(H, '05-playbooks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).map((f) => {
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { name: fm.name || f.replace(/\.md$/, ''), desc: fm.description || '', match: fm.match || '', skills: Array.isArray(fm.skills) ? fm.skills : [], path: rel(path.join(dir, f)) };
  }).filter((p) => p.match);
}

// skill-router's named chains ("### C3. ..." + "**Chain**: ..."), so the hook can name the chain to run.
function readChains() {
  const f = cfg.router?.chainsFile ? exp(cfg.router.chainsFile) : null;
  const out = {};
  if (!f || !fs.existsSync(f)) return out;
  let id = null;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const h = /^###\s+(C\d+)\./.exec(line);
    if (h) { id = h[1]; continue; }
    const c = /^\*\*Chain\*\*:\s*(.+)$/.exec(line);
    if (id && c) { out[id] = c[1].replace(/\*\*/g, '').trim(); id = null; }
  }
  return out;
}

function buildIndex() {
  const entries = [];
  const add = (dir, layer, group, extra = {}) => {
    const f = path.join(dir, 'SKILL.md');
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    const fm = parseFrontmatter(text);
    const meta = readJSON(path.join(dir, '.source.json')) || {};
    const name = fm.name || path.basename(dir);
    const desc = (fm.description || '').replace(/\s+/g, ' ').trim();
    const pm = path.join(NATIVE_DIR, path.basename(dir), '.harness-promoted');
    const promoted = layer === '30-library' && fs.existsSync(pm) && fs.readFileSync(pm, 'utf8').includes(rel(dir));
    const native = extra.native ?? meta.native ?? (promoted ? path.basename(dir) : null);
    const e = {
      id: path.relative(H, dir).startsWith('..') ? rel(dir) : fwd(path.relative(H, dir)),
      name, desc: desc.slice(0, 400), layer, group,
      path: rel(f), source: meta.source || extra.source || 'mine', tier: meta.tier || extra.tier || 'mine',
      native, flagged: (meta.flags || []).length > 0,
      fav: FAVS.has(name) || FAVS.has(native || '') || FAVS.has(path.basename(dir)) || FAVS.has(`${name}@${meta.source || extra.source || 'mine'}`),
      forkedFrom: meta.forkedFrom || null,
    };
    e.t = [...terms(name.replace(/[-_:]/g, ' ')), ...terms(desc), ...terms(group.replace(/[\/-]/g, ' '))].join(' ');
    e.nm = [...new Set(terms(name.replace(/[-_:]/g, ' ')))].join(' ');
    entries.push(e);
  };
  // your own native skills in ~/.claude/skills (not synced, not promoted copies)
  for (const n of (fs.existsSync(NATIVE_DIR) ? fs.readdirSync(NATIVE_DIR) : [])) {
    const d = path.join(NATIVE_DIR, n);
    if (n === 'synced' || !fs.existsSync(path.join(d, 'SKILL.md')) || fs.existsSync(path.join(d, '.harness-promoted'))) continue;
    add(d, '10-mine', 'native', { native: n, tier: 'mine', source: 'mine' });
  }
  for (const d of listSkillDirs(path.join(H, '10-mine'))) {
    const marker = path.join(NATIVE_DIR, path.basename(d), '.harness-promoted');
    const isNative = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes(rel(d));
    add(d, '10-mine', fwd(path.relative(path.join(H, '10-mine'), path.dirname(d))) || 'mine', { tier: 'mine', ...(isNative ? { native: path.basename(d) } : {}) });
  }
  // The company skill tree (the harness repo's skills/ folder): company and team skills, routed by skill-router. Skip ones already native.
  const tree = cfg.skillTree?.root ? exp(cfg.skillTree.root) : null;
  if (tree && fs.existsSync(tree)) {
    const skipTree = new Set(cfg.skillTree.skip || []);
    const nativeNames = new Set(fs.existsSync(NATIVE_DIR) ? fs.readdirSync(NATIVE_DIR) : []);
    for (const area of fs.readdirSync(tree)) {
      if (skipTree.has(area) || area.startsWith('.')) continue;
      const root = path.join(tree, area);
      if (!fs.statSync(root).isDirectory()) continue;
      for (const d of listSkillDirs(root)) {
        if (nativeNames.has(path.basename(d))) continue;
        add(d, '10-mine', `skill-tree/${area}`, { tier: 'mine', source: 'skill-tree' });
      }
    }
  }
  for (const d of listSkillDirs(path.join(H, '20-account'))) add(d, '20-account', fwd(path.relative(path.join(H, '20-account'), path.dirname(d))));
  for (const d of listSkillDirs(path.join(H, '30-library'))) add(d, '30-library', fwd(path.relative(path.join(H, '30-library'), path.dirname(d))));
  // document frequencies for the router
  const df = {};
  for (const e of entries) for (const t of new Set(e.t.split(' '))) df[t] = (df[t] || 0) + 1;
  const avgLen = entries.reduce((s, e) => s + e.t.split(' ').length, 0) / Math.max(1, entries.length);
  const playbooks = readPlaybooks();
  const chains = readChains();
  fs.writeFileSync(path.join(H, 'index.json'), JSON.stringify({ built: new Date().toISOString(), n: entries.length, avgLen, df, playbooks, chains, entries }));
  writeIndexMd(entries);
  writeSourcesMd(entries);
  log(`indexed ${entries.length} skills, ${playbooks.length} playbooks, ${entries.filter((e) => e.fav).length} favorites`);
}

function writeIndexMd(entries) {
  const byGroup = {};
  for (const e of entries) (byGroup[`${e.layer}/${e.group}`] ||= []).push(e);
  const keys = Object.keys(byGroup).sort();
  const lines = [
    '# Harness skill catalog',
    '',
    `${entries.length} skills, built ${new Date().toISOString().slice(0, 10)} by \`bin/build.mjs index\`. Search it with \`grep -i <word> ~/.claude/harness/INDEX.md\`.`,
    'Native skills run with the Skill tool (name in the native column). Everything else: Read the SKILL.md at the path, then follow it.',
    '',
    '## Playbooks',
    '',
    ...readPlaybooks().map((p) => `- [${p.name}](${p.path.replace('~/.claude/harness/', '')}): ${p.desc}`),
    '',
    '## Favorites',
    '',
    entries.filter((e) => e.fav).map((e) => e.name).sort().join(', ') || '(none yet: add names to favorites in sources.json)',
    '',
    '## Folders',
    '',
    ...keys.map((k) => `- [${k}](#${k.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}) (${byGroup[k].length})`),
    '',
  ];
  for (const k of keys) {
    lines.push(`## ${k}`, '', '| Skill | What it is for | Native |', '| --- | --- | --- |');
    for (const e of byGroup[k].sort((a, b) => a.name.localeCompare(b.name))) {
      const d = e.desc.replace(/\|/g, '/').slice(0, 160) + (e.desc.length > 160 ? '...' : '');
      lines.push(`| [${e.name}](${e.path.replace('~/.claude/harness/', '')})${e.fav ? ' **(favorite)**' : ''}${e.forkedFrom ? ' (your fork)' : ''}${e.flagged ? ' (flagged)' : ''} | ${d} | ${e.native ? '`' + e.native + '`' : ''} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(H, 'INDEX.md'), lines.join('\n'));
}

function writeSourcesMd(entries) {
  const by = {};
  for (const e of entries) (by[e.source] ||= { n: 0, tier: e.tier }).n++;
  const commits = {};
  for (const d of [...listSkillDirs(path.join(H, '30-library')), ...listSkillDirs(path.join(H, '20-account'))]) {
    const m = readJSON(path.join(d, '.source.json'));
    if (m?.commit) commits[m.source] = m.commit;
    if (m?.license && m.source) (by[m.source] ||= { n: 0, tier: m.tier }).license ||= m.license;
  }
  const scan = readJSON(path.join(H, 'scan-report.json')) || { quarantined: [], flagged: [] };
  const lines = ['# Sources', '', 'Where every skill came from. Tiers, most trusted first: mine, account, anthropic, author, vendor, community.', '', '| Source | Tier | Skills | Commit | License |', '| --- | --- | --- | --- | --- |'];
  for (const [s, v] of Object.entries(by).sort((a, b) => TIERS.indexOf(a[1].tier) - TIERS.indexOf(b[1].tier) || b[1].n - a[1].n)) {
    const link = /^[\w.-]+\/[\w.-]+$/.test(s) ? `[${s}](https://github.com/${s})` : s;
    lines.push(`| ${link} | ${v.tier} | ${v.n} | ${commits[s] || ''} | ${v.license || ''} |`);
  }
  lines.push('', `## Quarantined (${scan.quarantined.length})`, '', 'Not indexed. Found in `90-quarantine/`. Review by hand before moving one out.', '');
  for (const q of scan.quarantined) lines.push(`- ${q.name} (${q.source}): ${q.flags.join('; ')}`);
  lines.push('', `## Flagged (${scan.flagged.length})`, '', 'Indexed but marked. Usually install snippets like `curl ... | sh`. Read the flagged file before running anything from it.', '');
  for (const q of scan.flagged) lines.push(`- ${q.name} (${q.source}): ${q.flags.join('; ')}`);
  fs.writeFileSync(path.join(H, 'THIRD-PARTY-NOTICES.md'), ['<!-- Licence notices for the baseline skills this harness builds on. Keep this file and each skill\'s LICENSE file; they are what permits commercial use. -->', ...lines].join('\n') + '\n'); try { fs.rmSync(path.join(H, 'SOURCES.md'), { force: true }); } catch {}
}


// ---------- boot file ----------
// ~/.claude/CLAUDE.md gets the three core files inlined between markers, so the core loads in every
// session without relying on @imports. Anything written outside the markers is kept.
// The user's profile (written by setup): fills the {{placeholders}} in the core files.
function userProfile() {
  let u = {}; try { u = JSON.parse(fs.readFileSync(path.join(H, 'user.json'), 'utf8')); } catch {}
  return { name: 'the user', company: 'the company', role: 'a team member', team: 'their', timezone: 'not set', focus: 'not set yet', ...u };
}
function fill(text, u) { return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (u[k] != null && typeof u[k] !== 'object' ? String(u[k]) : m)); }
function writeBoot() {
  const target = path.join(HOME, '.claude', 'CLAUDE.md');
  const START = '<!-- harness:core:start (generated by ~/.claude/harness/bin/build.mjs from 00-core/*.md and user.json; edit those, then run build.mjs index) -->';
  const END = '<!-- harness:core:end -->';
  const u = userProfile();
  const core = ['agent.md', 'rules.md', 'projects.md']
    .filter((f) => fs.existsSync(path.join(H, '00-core', f)))
    .map((f) => fill(fs.readFileSync(path.join(H, '00-core', f), 'utf8').trim(), u).replace(/^(#{1,5}) /gm, '#$1 '))
    .join('\n\n');
  const block = `${START}\n# Work harness\n\nYou work for ${u.name} at ${u.company}. Your operating system is the harness at \`~/.claude/harness/\`. The core below loads every session; a \`<harness>\` block with matching skills arrives with each prompt; the full catalog is \`~/.claude/harness/INDEX.md\`; the \`harness\` skill explains how to find, add and update skills.\n\n${core}\n${END}`;
  let cur = '';
  try { cur = fs.readFileSync(target, 'utf8'); } catch {}
  let next;
  if (cur.includes(START.slice(0, 24)) && cur.includes(END)) {
    next = cur.replace(new RegExp(`<!-- harness:core:start[\\s\\S]*?${END}`), block);
  } else {
    // first run: drop the old @import stub if that is all the file holds
    const stub = /^# Work harness[\s\S]*?@~\/\.claude\/harness\/00-core\/projects\.md\s*$/;
    next = stub.test(cur.trim()) || !cur.trim() ? block + '\n' : `${block}\n\n${cur}`;
  }
  if (next !== cur) { fs.writeFileSync(target, next); log('wrote core into ~/.claude/CLAUDE.md'); }
}

// ---------- main ----------
const cmd = process.argv[2] || 'index';
if (process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  if (cmd === 'fetch' || cmd === 'all') fetchAll();
  if (cmd === 'import' || cmd === 'all') importAll();
  if (cmd === 'promote' || cmd === 'all') promote();
  if (['index', 'import', 'promote', 'all'].includes(cmd)) { buildIndex(); writeBoot(); rebuildBrain(); }
}

// Keep the Agentic Harness app graph in step with the index (sources.json "brain.script"). Never fails the build.
function rebuildBrain() {
  const s = cfg.brain?.script ? exp(cfg.brain.script) : null;
  if (!s || !fs.existsSync(s)) return;
  try { execFileSync(process.execPath, [s], { stdio: 'pipe' }); log('rebuilt the Agentic Harness app graph'); }
  catch (e) { log(`brain rebuild skipped: ${String(e.message).split('\n')[0]}`); }
}
