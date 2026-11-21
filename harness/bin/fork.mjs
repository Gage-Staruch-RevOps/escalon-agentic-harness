#!/usr/bin/env node
// Make any skill yours so you can edit it. Library and account folders are rebuilt from their sources,
// so edits there are lost on the next build. A fork lives in 10-mine/, which builds never touch, and it
// outranks the original in routing. If the original was promoted to native, the fork replaces the native copy.
//
//   node ~/.claude/harness/bin/fork.mjs <skill-name>               fork into 10-mine/<its category>/
//   node ~/.claude/harness/bin/fork.mjs <skill-name> --as my-name  fork under a new name
//   node ~/.claude/harness/bin/fork.mjs --list                     show what you have forked
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const H = path.join(os.homedir(), '.claude', 'harness');
const exp = (p) => p.replace(/^~(?=\/|$)/, os.homedir());
const index = JSON.parse(fs.readFileSync(path.join(H, 'index.json'), 'utf8'));
const args = process.argv.slice(2);

if (!args.length) { console.log('usage: fork.mjs <skill-name> [--as new-name] | --list'); process.exit(2); }
if (args[0] === '--list') {
  const forks = index.entries.filter((e) => e.forkedFrom);
  console.log(forks.length ? forks.map((e) => `${e.name}  ${e.path}  (from ${e.forkedFrom})`).join('\n') : 'No forks yet.');
  process.exit(0);
}

const want = args[0];
const asIdx = args.indexOf('--as');
const newName = asIdx > 0 ? args[asIdx + 1] : null;
const matches = index.entries.filter((e) => e.layer !== '10-mine' && (e.name === want || e.native === want || e.id.endsWith('/' + want)));
if (!matches.length) {
  const near = index.entries.filter((e) => e.name.includes(want)).slice(0, 8).map((e) => e.name);
  console.error(`No skill named "${want}".${near.length ? ' Close: ' + near.join(', ') : ''}`);
  process.exit(1);
}
const TIERS = ['account', 'anthropic', 'author', 'vendor', 'community'];
const src = matches.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))[0];
if (matches.length > 1) console.log(`Several skills are named "${want}"; forking the most trusted: ${src.id} (${src.source}).`);

const srcDir = path.dirname(exp(src.path));
const category = src.layer === '30-library' ? src.group.split('/')[0] : 'from-account';
const leaf = newName || path.basename(srcDir);
const dest = path.join(H, '10-mine', category, leaf);
if (fs.existsSync(dest)) { console.error(`Already forked: ${dest.replace(os.homedir(), '~')}`); process.exit(1); }

fs.cpSync(srcDir, dest, { recursive: true });
let meta = {};
try { meta = JSON.parse(fs.readFileSync(path.join(dest, '.source.json'), 'utf8')); } catch {}
fs.writeFileSync(path.join(dest, '.source.json'), JSON.stringify({
  source: 'mine', tier: 'mine', forkedFrom: `${src.source}:${src.id}`, forkedFromCommit: meta.commit || null,
  license: meta.license || null, native: null, flags: [], forkedAt: new Date().toISOString(),
}, null, 2));
if (newName) {
  const f = path.join(dest, 'SKILL.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^(---[\s\S]*?\nname:\s*).*$/m, `$1${newName}`));
}
console.log(`Forked ${src.name} -> ${dest.replace(os.homedir(), '~')}`);
console.log('Edit its SKILL.md freely. Rebuilding the index...');
execFileSync(process.execPath, [path.join(H, 'bin', 'build.mjs'), 'promote'], { stdio: 'inherit' }); // promote also reindexes
