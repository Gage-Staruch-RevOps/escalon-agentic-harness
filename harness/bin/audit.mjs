#!/usr/bin/env node
// Audits recent Claude Code activity from the Brain's activity log (.cache/activity.jsonl):
// failed actions, waits on the user, requests the router could not place, chains whose skills were
// never loaded, and slow actions. The log holds labels only, so this finds WHERE things went wrong;
// the harness-retro skill works out why and records the correction.
//   node audit.mjs            Markdown report, last 7 days
//   node audit.mjs --days 1   another window
//   node audit.mjs --json     machine-readable (used by the Brain)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const H = path.join(os.homedir(), '.claude', 'harness');
const LOG = path.join(H, '.cache', 'activity.jsonl');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const days = Number(arg('--days', 7)) || 7, since = Date.now() - days * 864e5;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const events = (read(LOG + '.1') + read(LOG)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((e) => e && e.ts >= since && !/^dbg/.test(e.session || ''));
const chains = (() => { try { return JSON.parse(read(path.join(H, 'index.json'))).chains || {}; } catch { return {}; } })();
const fmt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
const when = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const reqs = [], open = new Map(), pend = new Map();
const failed = new Map(), slow = [], waits = [];
// Chains whose skills a session already loaded: a later request on the same chain ("You deploy", "Ship and turn on")
// has them in context and is not a miss. Retro 2026-11-20.
const sessLoaded = new Map();
for (const e of events) {
  const sk = e.session || 'local';
  if (e.t === 'route') { const chain = (e.chains[0] || '').replace('chain:', '') || e.cont || null; const r = { ts: e.ts, session: sk, folder: e.folder || '', chain, picks: e.picks.length, actions: 0, fails: 0, loaded: sessLoaded.get(sk)?.has(chain) ? 1 : 0, end: null, wait: 0 }; reqs.push(r); open.set(sk, r); continue; }
  const r = open.get(sk);
  if (e.t === 'pre') { if (r) r.actions++; pend.set(sk + (e.id || e.tool + e.label), e); }
  else if (e.t === 'post') {
    const p = pend.get(sk + (e.id || e.tool + e.label)); const ms = p ? e.ts - p.ts : 0;
    if (e.fail) { if (r) r.fails++; const f = failed.get(e.label) || { label: e.label, count: 0, sessions: new Set(), last: 0, chains: new Set() }; f.count++; f.sessions.add(sk); f.last = e.ts; if (r?.chain) f.chains.add(r.chain); failed.set(e.label, f); }
    if (ms > 120000) slow.push({ label: e.label, ms, ts: e.ts, chain: r?.chain || null, folder: r?.folder || '' });
  } else if (e.t === 'skill' || e.t === 'read') { if (r) { r.loaded++; if (r.chain) (sessLoaded.get(sk) || sessLoaded.set(sk, new Set()).get(sk)).add(r.chain); } }
  else if (e.t === 'notify' && e.kind !== 'note') { waits.push({ ts: e.ts, kind: e.kind, folder: r?.folder || '', chain: r?.chain || null }); if (r) r.wait++; }
  else if (e.t === 'stop') { if (r) r.end = e.ts; }
}
const noChain = reqs.filter((r) => !r.chain && !r.cont && r.actions > 0);
const unloaded = reqs.filter((r) => r.chain && r.loaded === 0 && r.actions > 2);
const byChain = {};
for (const r of reqs) { const k = r.chain || 'none'; const c = (byChain[k] ||= { chain: k, requests: 0, actions: 0, fails: 0, ms: 0, timed: 0, unloaded: 0 }); c.requests++; c.actions += r.actions; c.fails += r.fails; if (r.end) { c.ms += r.end - r.ts; c.timed++; } if (r.chain && r.loaded === 0 && r.actions > 2) c.unloaded++; }
const out = {
  days, events: events.length, requests: reqs.length, actions: reqs.reduce((s, r) => s + r.actions, 0),
  failedActions: [...failed.values()].sort((a, b) => b.count - a.count).slice(0, 12).map((f) => ({ label: f.label, count: f.count, sessions: f.sessions.size, chains: [...f.chains], last: f.last })),
  failedTotal: [...failed.values()].reduce((s, f) => s + f.count, 0),
  noChain: { count: noChain.length, recent: noChain.slice(-6).map((r) => ({ ts: r.ts, folder: r.folder, actions: r.actions })) },
  chainNoSkill: { count: unloaded.length, byChain: Object.values(byChain).filter((c) => c.unloaded).map((c) => ({ chain: c.chain, count: c.unloaded, of: c.requests })) },
  waits: { count: waits.length, permission: waits.filter((w) => w.kind === 'permission').length },
  slow: slow.sort((a, b) => b.ms - a.ms).slice(0, 6),
  chains: Object.values(byChain).sort((a, b) => b.requests - a.requests).map((c) => ({ chain: c.chain, requests: c.requests, actions: c.actions, fails: c.fails, avg: c.timed ? Math.round(c.ms / c.timed) : null })),
};
if (process.argv.includes('--json')) { console.log(JSON.stringify(out)); process.exit(0); }

const L = [`# Harness audit, last ${days} day${days === 1 ? '' : 's'}`, '', `${out.requests} requests, ${out.actions} actions, ${out.failedTotal} failed actions, ${out.waits.count} waits on the user (${out.waits.permission} for permission).`, ''];
L.push('## Failed actions (repeat offenders first)');
L.push(out.failedActions.length ? out.failedActions.map((f) => `- ${f.count}x "${f.label}" in ${f.sessions} session${f.sessions === 1 ? '' : 's'}${f.chains.length ? ', chains ' + f.chains.join(', ') : ''}, last ${when(f.last)}`).join('\n') : '- none');
L.push('', '## Requests the router could not place');
L.push(out.noChain.count ? `- ${out.noChain.count} requests matched no chain. Recent: ${out.noChain.recent.map((r) => `${when(r.ts)} in ${r.folder || 'no folder'} (${r.actions} actions)`).join('; ')}` : '- none');
L.push('', '## Chain named, but no skill or skill file was loaded');
L.push(out.chainNoSkill.count ? out.chainNoSkill.byChain.map((c) => `- ${c.chain} (${chains[c.chain] ? chains[c.chain].slice(0, 70) + '...' : 'unknown chain'}): ${c.count} of ${c.of} requests`).join('\n') : '- none');
L.push('', '## Slow actions (over 2 minutes)');
L.push(out.slow.length ? out.slow.map((s) => `- ${fmt(s.ms)} "${s.label}"${s.chain ? ' in ' + s.chain : ''}, ${when(s.ts)}`).join('\n') : '- none');
L.push('', '## By chain', '| Chain | Requests | Actions | Failed | Avg time |', '| --- | --- | --- | --- | --- |');
for (const c of out.chains) L.push(`| ${c.chain} | ${c.requests} | ${c.actions} | ${c.fails} | ${c.avg ? fmt(c.avg) : 'n/a'} |`);
console.log(L.join('\n'));
