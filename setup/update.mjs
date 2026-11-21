#!/usr/bin/env node
// Pulls the latest harness from GitHub and refreshes this install. Your profile, notes and personal skills are kept.
//   npm run update               pull, refresh the engine and core rules, rebuild the index
//   npm run update -- --library  also refresh the public skill library
//   npm run update -- --check    only say whether an update is waiting (exit 10 if one is)
import { execFileSync } from 'node:child_process';
import { REPO, install } from './lib.mjs';

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try { git('fetch', '--quiet'); } catch (e) { console.error(`Could not reach GitHub: ${String(e.stderr || e.message).split('\n')[0]}`); process.exit(1); }
const behind = Number(git('rev-list', '--count', 'HEAD..@{u}') || 0);
if (process.argv.includes('--check')) { console.log(behind ? `${behind} update(s) waiting` : 'up to date'); process.exit(behind ? 10 : 0); }
if (git('status', '--porcelain', '--untracked-files=no')) {
  console.error('This folder has local changes. Commit them on a branch (or stash them) before updating, so nothing is lost.');
  process.exit(1);
}
if (behind) { git('pull', '--ff-only', '--quiet'); console.log(`pulled ${behind} change(s)`); } else console.log('already up to date with GitHub');
install({ library: process.argv.includes('--library') });
console.log('Done. New Claude Code sessions use the update; restart the app to see it there.');
