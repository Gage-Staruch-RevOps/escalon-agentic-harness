#!/usr/bin/env node
// First-time setup on the command line: asks who Claude works for, installs the harness, builds the index.
//   npm run setup               ask the questions (answers already saved are offered as defaults)
//   npm run setup -- --library  also download the public skill library now (about 700 MB, several minutes)
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { FIELDS, readUser, checkUser, install } from './lib.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) { console.error(`Node 20 or newer is needed (this is ${process.versions.node}).`); process.exit(1); }

// From a terminal: ask each question. Piped (scripted installs): one answer per line, blank keeps the default.
const piped = !input.isTTY ? (await new Promise((ok) => { let t = ''; input.setEncoding('utf8'); input.on('data', (c) => (t += c)); input.on('end', () => ok(t.split(/\r?\n/))); })) : null;
const rl = piped ? null : readline.createInterface({ input, output });
const ask = async (q) => (piped ? (console.log(q + (piped[0] ?? '')), piped.shift() ?? '') : rl.question(q));
const saved = readUser() || {};
console.log('\nAgentic Harness setup\nClaude will work for the person you describe here. Answers stay on this computer in ~/.claude/harness/user.json.\n');
const u = {};
for (const f of FIELDS) {
  const def = saved[f.key] ?? f.def ?? '';
  for (;;) {
    const a = (await ask(`${f.q}${def ? ` [${def}]` : ''}: `)).trim();
    u[f.key] = a || def;
    if (!f.required || u[f.key]) break;
    console.log('  This one is needed.');
    if (piped) process.exit(1);
  }
}
let library = process.argv.includes('--library');
if (!library) library = /^y/i.test((await ask('Download the public skill library now? About 700 MB, several minutes. You can do it later with npm run library. [y/N]: ')).trim());
rl?.close();

const errs = checkUser(u);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
try {
  install({ user: u, library });
  console.log(`\nDone. Open a new Claude Code session: it now works for ${u.name}.\nStart the app with: npm start\n`);
} catch (e) { console.error(`\nSetup failed: ${e.message}`); process.exit(1); }
