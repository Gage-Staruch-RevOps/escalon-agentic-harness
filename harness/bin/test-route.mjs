#!/usr/bin/env node
// Routing smoke test: prints what the per-prompt hook would surface for typical requests,
// and fails if an expected skill is missing. Run after every `build.mjs all`, and add cases for your own work.
import { route, cleanPrompt } from './route.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Without the public library (not downloaded yet, or in CI) only chains, notes, playbooks and "must not" checks are enforced;
// expected library skills are reported as "skip".
const LIB = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'harness', 'index.json'), 'utf8')).entries.some((e) => e.layer === '30-library'); } catch { return false; } })();
const structural = (x) => /^(!|CH:|N:|PB:)/.test(x);

const CASES = [
  ['The settings sheet animation is janky, make it feel smoother', ['apple-design']],
  ['Debug why the export job returns a 500 sometimes', ['systematic-debugging']],
  ['Turn this quarterly report into a PowerPoint deck', ['pptx']],
  ['Fill out this PDF form and merge it with the cover letter', ['pdf']],
  ['Build an MCP server for our ticketing API', ['mcp-builder']],
  ['Review this React component for performance problems', ['vercel-react-best-practices|react-component-performance']],
  ['Research the best document management tools and compare pricing', ['deep-research']],
  ['Write a PRD for bulk invoice import', ['write-spec|create-prd|prd']],
  ['Plan the next sprint for the reporting team', ['sprint-planning|sprint-plan']],
  ['Set up Supabase auth with row level security', ['supabase|supabase-rls-policies']],
  ['Make a SwiftUI settings screen with liquid glass', ['swiftui-liquid-glass|ios-liquid-glass|swiftui-expert-skill']],
  ['Audit this repo for security vulnerabilities', ['claude-security|security-reviewer|security-review']],
  ['Create a new skill for how we triage support tickets', ['harness']],
  ['Write Playwright end-to-end tests for the signup flow', ['playwright-cli|webapp-testing|playwright']],
  ['Make this email sound less like AI wrote it', ['humanizer|stop-slop|anti-slop-writing']],
  ['Build a new endpoint for exporting client reports', ['PB:build-a-feature']],
  ['Plan my week', ['PB:weekly-review']],
  ['Make a landing page for the new benefits portal', ['PB:landing-page']],
  ['Reconcile the March bank statement against the ledger', ['reconciliation']],
  ['thanks', [], 'none'],
  ['Try again', [], 'none'],
  ['keep going', [], 'none'],
  ['yes do it', [], 'none'],
  ['<bash-input>node build.mjs all</bash-input><bash-stdout>updated expo/skills\nimported 2264</bash-stdout><bash-stderr></bash-stderr>\nTry again', [], 'none'],
  ['pptx', ['pptx']],
  ['<scheduled-task name="demand-com-audit-refresh" file="x/SKILL.md">\nRefresh the audit pages, then email the summary.\n</scheduled-task>', [], 'none'],
  ['When I land on the page it shows email me my link, and I never get the email', ['!CH:C5']],
  ['After that, a partner goes to the portal and enters their email to get a new link', ['!CH:C5']],
  ['Publish to prod silently so I can perform full end to end testing', ['verification-before-completion']],
  ['Yes, fix them', [], 'none'],
  ['Yes, deploy it', [], 'none'],
  ['ok go ahead and fix it', [], 'none'],
  ['Done, verify it', [], 'none'],
  // General chains (CH:) from skills/00-router/skill-router/references/chains.md
  ['How much revenue did we book last month', ['CH:C1']],
  ['Chart the support tickets by week as a dashboard', ['CH:C2', 'dataviz']],
  ['Refresh the monthly report for the team', ['CH:C3']],
  ['Draft a reply to this email from the vendor', ['CH:C4']],
  ['Turn these notes into a PowerPoint for the offsite', ['CH:C5', 'pptx']],
  ['Look into document management tools and compare pricing', ['CH:C6', 'deep-research']],
  ['Fix the bug in the export script', ['CH:C7', 'systematic-debugging']],
  ['Polish the landing page so it looks more modern', ['CH:C8']],
  ['Turn this into a skill for the team', ['CH:C9', 'harness']],
  ['Run a retro on the last 7 days', ['CH:C10', 'harness-retro', 'N:lessons.md']],
  ['Polish the Agentic Harness app UI', ['CH:C8', 'N:harness-app.md']],
];
let fail = 0;
for (const [rawPrompt, expect, mode] of CASES) {
  const prompt = cleanPrompt(rawPrompt); // same cleanup the hook entry point does; '' means the hook stays silent
  const opts = typeof mode === 'object' ? mode : {};
  const { picks, notes, playbooks = [], chains = [] } = prompt ? route(prompt, opts) : { picks: [], notes: [] };
  const got = picks.map((p) => p.native || p.name);
  // 'CH:C5' chain, 'PB:x' playbook, 'N:x.md' note, '!X' must NOT be present, 'a|b' either
  const has = (alt) => alt.split('|').some((x) => (x.startsWith('PB:') ? playbooks.some((p) => p.name === x.slice(3))
    : x.startsWith('CH:') ? chains.some((c) => c.id === x.slice(3))
    : x.startsWith('N:') ? notes.some((n) => n.endsWith(x.slice(2)))
    : got.includes(x) || picks.some((p) => p.name === x)));
  const missing = expect.filter((x) => (LIB || structural(x)) && (x.startsWith('!') ? has(x.slice(1)) : !has(x)));
  const skipped = LIB ? [] : expect.filter((x) => !structural(x));
  if (mode === 'none' && (picks.length || notes.length || playbooks.length)) missing.push('(expected nothing)');
  if (missing.length) fail++;
  console.log(`${missing.length ? 'FAIL' : 'ok  '} ${rawPrompt.replace(/\s+/g, ' ').slice(0, 90)}`);
  console.log(`     -> ${playbooks.length ? 'PLAYBOOK ' + playbooks.map((p) => p.name).join(', ') + ' | ' : ''}${got.join(', ') || '(nothing)'}${notes.length ? '  | notes: ' + notes.join(', ') : ''}`);
  if (missing.length) console.log(`     missing: ${missing.join(', ')}`);
  if (skipped.length) console.log(`     skip (library not downloaded): ${skipped.join(', ')}`);
}
console.log(fail ? `\n${fail} case(s) failed` : `\nall cases passed${LIB ? '' : ' (library skills not checked: the library is not downloaded)'}`);
process.exit(fail ? 1 : 0);
