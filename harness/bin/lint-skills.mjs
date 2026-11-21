#!/usr/bin/env node
// C9 gate: checks skills in the company skill tree (sources.json skillTree.root) against skill-router/references/conventions.md,
// so a skill written without loading the conventions still gets caught. Added by retro 2026-11-17.
//   node lint-skills.mjs                       every own skill in the tree
//   node lint-skills.mjs <skill folder> ...    just these
// Exit 1 on errors (must fix before delivery); warnings print but pass.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const H = path.join(os.homedir(), '.claude', 'harness');
const TREE = (() => { try { return JSON.parse(fs.readFileSync(path.join(H, 'sources.json'), 'utf8')).skillTree.root.replace(/^~(?=\/|$)/, os.homedir()); } catch { return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'skills'); } })();
const SKIP = /^(_archive|_dist|90-templates|node_modules|\..*)$/;
const registry = (() => { try { return fs.readFileSync(path.join(TREE, '00-router/skill-router/references/registry.md'), 'utf8'); } catch { return ''; } })();

const targets = process.argv.slice(2).map((p) => path.resolve(p));
if (!targets.length) {
  const walk = (d, depth) => { for (const n of fs.readdirSync(d)) { const c = path.join(d, n); if (SKIP.test(n) || !fs.statSync(c).isDirectory()) continue; if (fs.existsSync(path.join(c, 'SKILL.md'))) targets.push(c); else if (depth < 3) walk(c, depth + 1); } };
  for (const top of fs.readdirSync(TREE)) { const d = path.join(TREE, top); if (!SKIP.test(top) && /^\d\d-/.test(top) && fs.statSync(d).isDirectory()) walk(d, 1); }
}

let errors = 0, warnings = 0;
for (const dir of targets) {
  const file = path.join(dir, 'SKILL.md');
  const E = [], W = [];
  if (!fs.existsSync(file)) { E.push('no SKILL.md'); }
  else {
    const src = fs.readFileSync(file, 'utf8');
    const fm = src.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) E.push('no frontmatter');
    const field = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') || '';
    const name = field('name'), desc = field('description');
    const isRouter = name === 'skill-router'; // runs on every task and holds the registry, so no "Not for" and no own row
    if (!name) E.push('frontmatter has no name');
    else if (name !== path.basename(dir)) E.push(`name "${name}" does not match folder "${path.basename(dir)}"`);
    if (!desc) E.push('frontmatter has no description');
    else {
      if (desc.length > 1024) E.push(`description is ${desc.length} chars (hard limit 1024)`);
      else if (desc.length > 900) W.push(`description is ${desc.length} chars (convention: under ~900)`);
      if (!/\bUse (when|for|this|whenever|before|it)\b/i.test(desc)) E.push('description does not say when to use it ("Use when ...")');
      if (!isRouter && !/\b(Not for|Do not use|Don'?t use)\b/i.test(desc)) E.push('description does not say when NOT to use it ("Not for ...")');
    }
    // The section word may sit anywhere in a heading: "## 10. Gates", "## Build procedure", "### 6. Verify (acceptance gates)".
    for (const h of ['Purpose', 'Procedure', 'Gates', 'Changelog']) if (!new RegExp(`^#+ .*\\b${h}\\b`, 'mi').test(src)) W.push(`no "${h}" section`);
    if (!/^#+ .*\bLayer\b/mi.test(src) && !/Depends on/i.test(src)) W.push('no Layer / Depends on section');
    const lines = src.split('\n').length;
    if (lines > 400) W.push(`${lines} lines (convention: under ~400, move detail to references/)`);
    if (name && !isRouter && registry && !registry.includes(name)) E.push('no row in skill-router/references/registry.md');
  }
  errors += E.length; warnings += W.length;
  if (E.length || W.length || targets.length <= 3) {
    console.log(`${E.length ? 'FAIL' : W.length ? 'warn' : 'ok  '} ${path.relative(TREE, dir)}`);
    for (const m of E) console.log(`     error: ${m}`);
    for (const m of W) console.log(`     warn:  ${m}`);
  }
}
console.log(`\n${targets.length} skill(s), ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
