#!/usr/bin/env node
// Pre-push gate: fails if the repo holds anything personal or confidential that must never reach GitHub:
// home-folder paths, email addresses, secrets, or names from a block list. Run: npm run check
// Add names to BLOCK below (or in scripts/blocklist.local.txt, which is git-ignored) as people join.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', 'dist']);
const TEXT = /\.(md|mjs|js|json|html|txt|yml|yaml|sh|py|css)$/i;
const RULES = [
  [/\/Users\/(?!<name>|x\/|you\/)[A-Za-z][\w.-]*/, 'a personal home-folder path'],
  [/C:\\Users\\[A-Za-z]/, 'a personal home-folder path'],
  [/\b[\w.+-]+@(?!example\.com|anthropic\.com)[\w-]+\.[\w.]+\b/, 'an email address'],
  [/\b(sk-ant-[\w-]{10,}|ghp_[\w]{20,}|github_pat_[\w]{20,}|xox[bap]-[\w-]{10,}|AKIA[0-9A-Z]{16})\b/, 'a secret or token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];
let BLOCK = [];
try { BLOCK = fs.readFileSync(path.join(ROOT, 'scripts', 'blocklist.local.txt'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')); } catch {}
const hits = [];
const walk = (d) => { for (const n of fs.readdirSync(d)) { if (SKIP.has(n)) continue; const p = path.join(d, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (TEXT.test(n) && st.size < 2e6) scan(p); } };
function scan(p) {
  if (path.basename(p) === 'blocklist.local.txt' || p.endsWith(path.join('vendor', 'd3.min.js')) || path.basename(p) === 'package-lock.json') return; // lock files list third-party package authors
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const [re, what] of RULES) if (re.test(l) && !/check-repo: allow/.test(l)) hits.push(`${path.relative(ROOT, p)}:${i + 1}: ${what}`);
    for (const b of BLOCK) if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l)) hits.push(`${path.relative(ROOT, p)}:${i + 1}: blocked word "${b}"`);
  });
}
walk(ROOT);
if (hits.length) { console.log(hits.join('\n')); console.log(`\n${hits.length} problem(s). Remove them before committing.`); process.exit(1); }
console.log('repo check passed: no personal paths, emails, secrets or blocked words');
