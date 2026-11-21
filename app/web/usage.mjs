#!/usr/bin/env node
// Usage monitor: Claude token use and API-equivalent cost, read from local Claude Code transcripts.
//   node usage.mjs              text summary (today, current 5-hour block, 7 and 30 days, top sessions)
//   node usage.mjs --json [--days 7] [--since <ms>]   JSON for the app (breakdowns cover the last N days, 1 to 90;
//                                                    --since adds a summary from that moment, used by the Brief)
// Reads ~/.claude/projects/**/*.jsonl (subagent transcripts included) and the harness activity log.
// Incremental: byte offsets per file and one compact record per API message live in .usage-cache.json,
// so only new lines are parsed after the first run. Each message counts once (id + request id), which
// covers streamed blocks written on several lines and messages copied into forked or resumed sessions.
// Cost is what the same tokens would cost on the Claude API, not what a subscription plan bills.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
import { DATA, TZ } from './paths.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS = path.join(HOME, '.claude', 'projects');
const ACTIVITY = path.join(HOME, '.claude', 'harness', '.cache', 'activity.jsonl');
const CACHE = path.join(DATA, 'usage-cache.json');
const KEEP_DAYS = 90, BLOCK_MS = 5 * 3600e3;

// USD per million tokens. Source: Claude API reference (claude-api skill, models table cached 2026-11-03,
// shared/models.md and shared/prompt-caching.md). Cache writes are 1.25x input (5 min) and 2x (1 hour);
// cache reads vary by model. Fast mode bills 2x, US-only inference 1.1x. Haiku 5.5 rises to 0.50 / 2.50 above
// 100K prompt tokens; the other models have no long-context premium. Checked against the live pricing page 2026-11-19.
export const PRICES_AS_OF = '2026-11-19';
const P = (i, o, cr, cw5 = i * 1.25, cw1 = i * 2) => ({ i, o, cr, cw5, cw1 });
export const PRICES = {
  'claude-fable-5-2': P(8, 40, 0.2, 10, 16), 'claude-mythos-5-2': P(8, 40, 0.2, 10, 16),
  'claude-fable-5-1': P(10, 50, 0.25), 'claude-mythos-5-1': P(10, 50, 0.25),
  'claude-fable-5': P(10, 50, 1), 'claude-mythos-5': P(10, 50, 1),
  'claude-opus-5-5': P(4, 20, 0.2), 'claude-opus-5': P(5, 25, 0.5),
  'claude-opus-4-8': P(5, 25, 0.5), 'claude-opus-4-7': P(5, 25, 0.5), 'claude-opus-4-6': P(5, 25, 0.5),
  'claude-sonnet-5-5': P(2, 10, 0.1), 'claude-sonnet-5': P(2, 10, 0.2), 'claude-sonnet-4-6': P(3, 15, 0.3),
  'claude-haiku-5-5': P(0.1, 0.5, 0.01), 'claude-haiku-4-5': P(1, 5, 0.1),
};
const HAIKU55_LONG = P(0.5, 2.5, 0.05);
const priceKey = (m) => { const b = String(m || '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, ''); return PRICES[b] ? b : null; };
export const family = (m) => (/fable|mythos/.test(m) ? 'fable' : /opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : /haiku/.test(m) ? 'haiku' : 'other');

// record: [ts, sessionIdx, projectIdx, modelIdx, input, output, cacheWrite5m, cacheWrite1h, cacheRead, fast, subagent, id]
const R = { ts: 0, s: 1, p: 2, m: 3, i: 4, o: 5, w5: 6, w1: 7, cr: 8, fast: 9, sub: 10, id: 11 };
// flags: 1 = fast mode (2x), 2 = US-only inference (1.1x). Both stack with the cache multipliers.
export function costOf(model, i, o, w5, w1, cr, flags) {
  const k = priceKey(model); if (!k) return 0;
  let p = PRICES[k]; if (k === 'claude-haiku-5-5' && i + w5 + w1 + cr > 100000) p = HAIKU55_LONG;
  return ((i * p.i + o * p.o + w5 * p.cw5 + w1 * p.cw1 + cr * p.cr) / 1e6) * (flags & 1 ? 2 : 1) * (flags & 2 ? 1.1 : 1);
}

function loadCache() {
  try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.v === 3) return c; } catch {} // bump v when a stored field changes meaning
  return { v: 3, files: {}, sessions: [], projects: [], models: [], recs: [] };
}
function listFiles(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) listFiles(p, out); else if (e.name.endsWith('.jsonl')) out.push(p); }
  return out;
}
const projectLabel = (cwd) => { // the project folder, not wherever inside it the session had cd'd to
  if (!cwd) return 'Unknown';
  if (/scratch-workspaces\//.test(cwd)) return 'No folder (scratch)';
  if (/local-agent-mode-sessions\//.test(cwd)) return 'Cowork session';
  let parts = (cwd.startsWith(HOME) ? cwd.slice(HOME.length) : cwd).split('/').filter(Boolean);
  if (['Desktop', 'Documents', 'Downloads'].includes(parts[0]) && parts.length > 1) parts = parts.slice(1);
  const cut = parts.findIndex((p) => /^(force-app|src|app|lib|bin|node_modules|dist|build|scripts)$/.test(p));
  if (cut > 0) parts = parts.slice(0, cut);
  return parts.slice(0, 2).join('/') || '~';
};

export function scan() {
  const t0 = Date.now(), c = loadCache(), cutoff = Date.now() - KEEP_DAYS * 864e5;
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { arr.push(v); i = arr.length - 1; } return i; };
  const sIdx = new Map(c.sessions.map((v, i) => [v, i])), pIdx = new Map(c.projects.map((v, i) => [v, i]));
  const tabIdx = (map, arr, v) => { let i = map.get(v); if (i === undefined) { arr.push(v); i = arr.length - 1; map.set(v, i); } return i; };
  const byId = new Map(); c.recs.forEach((r, n) => byId.set(r[R.id], n));
  let newBytes = 0, files = 0, added = 0;
  for (const f of listFiles(PROJECTS)) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < cutoff) continue;
    const prev = c.files[f]; let off = prev && prev.size <= st.size ? prev.off : 0;
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) continue;
    files++;
    const sub = f.includes(`${path.sep}subagents${path.sep}`) ? 1 : 0;
    let fd; try { fd = fs.openSync(f, 'r'); } catch { continue; }
    const len = st.size - off; let buf = Buffer.alloc(0);
    if (len > 0) { buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off); }
    fs.closeSync(fd);
    const end = buf.lastIndexOf(10); if (end < 0) { c.files[f] = { size: st.size, mtime: st.mtimeMs, off }; continue; }
    const text = buf.subarray(0, end + 1).toString('utf8'); newBytes += end + 1;
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const m = j.message, u = m && m.usage; if (j.type !== 'assistant' || !u || !m.model || m.model === '<synthetic>') continue;
      const ts = Date.parse(j.timestamp); if (!(ts >= cutoff)) continue;
      const id = (m.id || '') + ':' + (j.requestId || ''); const cc = u.cache_creation || {};
      const w1 = cc.ephemeral_1h_input_tokens || 0, w5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - w1);
      const rec = [ts, tabIdx(sIdx, c.sessions, j.sessionId || path.basename(f, '.jsonl')), tabIdx(pIdx, c.projects, projectLabel(j.cwd)), idx(c.models, m.model),
        u.input_tokens || 0, u.output_tokens || 0, w5, w1, u.cache_read_input_tokens || 0, (u.speed === 'fast' ? 1 : 0) | (u.inference_geo === 'us' ? 2 : 0), sub, id];
      const at = byId.get(id);
      if (at === undefined) { byId.set(id, c.recs.length); c.recs.push(rec); added++; }
      else { const o = c.recs[at]; for (const k of [R.i, R.o, R.w5, R.w1, R.cr]) o[k] = Math.max(o[k], rec[k]); } // streamed lines repeat a message: keep the fullest count
    }
    c.files[f] = { size: st.size, mtime: st.mtimeMs, off: off + end + 1 };
  }
  const before = c.recs.length; c.recs = c.recs.filter((r) => r[R.ts] >= cutoff);
  for (const f of Object.keys(c.files)) if (!fs.existsSync(f)) delete c.files[f];
  if (files || before !== c.recs.length) { const tmp = CACHE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c)); fs.renameSync(tmp, CACHE); }
  return { c, stats: { files, newBytes, added, ms: Date.now() - t0 } };
}

// Harness routes from the activity log: which chain each session ran under, by time.
function routes() {
  const by = new Map(); let first = Infinity;
  for (const f of [ACTIVITY + '.1', ACTIVITY]) {
    let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const l of t.split('\n')) {
      if (!l.includes('"t":"route"')) continue; let e; try { e = JSON.parse(l); } catch { continue; }
      if (!e.sid || /^dbg/.test(e.session || '')) continue;
      first = Math.min(first, e.ts);
      const label = (e.chains && e.chains[0]) || (e.cont ? 'chain:' + e.cont : 'none');
      if (!by.has(e.sid)) by.set(e.sid, []); by.get(e.sid).push([e.ts, label]);
    }
  }
  for (const v of by.values()) v.sort((a, b) => a[0] - b[0]);
  return { by, first: first === Infinity ? null : first };
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayMemo = new Map();
const dayOf = (ts) => { const h = Math.floor(ts / 3.6e6); let d = dayMemo.get(h); if (!d) { d = dayFmt.format(new Date(h * 3.6e6)); dayMemo.set(h, d); } return d; };
const emptyAgg = () => ({ cost: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, msgs: 0, sessions: new Set() });
function add(a, r, cost, sid) { a.cost += cost; a.input += r[R.i]; a.output += r[R.o]; a.cacheWrite += r[R.w5] + r[R.w1]; a.cacheRead += r[R.cr]; a.msgs++; a.sessions.add(sid); }
const fin = (a) => ({ cost: +a.cost.toFixed(4), input: a.input, output: a.output, cacheWrite: a.cacheWrite, cacheRead: a.cacheRead, tokens: a.input + a.output + a.cacheWrite + a.cacheRead, msgs: a.msgs, sessions: a.sessions.size });

// sinceTs (optional): also summarize spend from that moment (the Brief's window) with its costliest chain and session.
export function report({ days = 7, now = Date.now(), sinceTs = 0 } = {}) {
  days = Math.max(1, Math.min(KEEP_DAYS, Number(days) || 7));
  const { c, stats } = scan(), rt = routes();
  const recs = c.recs.slice().sort((a, b) => a[R.ts] - b[R.ts]);
  const today = dayOf(now), since = now - days * 864e5, unpriced = new Set();
  const win = { today: emptyAgg(), week: emptyAgg(), month: emptyAgg(), range: emptyAgg() };
  const daily = new Map(), models = new Map(), projects = new Map(), chains = new Map(), sessions = new Map();
  let blocks = [], blk = null, savedByCache = 0, subCost = 0;
  const bw = { agg: emptyAgg(), chains: new Map(), sessions: new Map() };
  const get = (map, k, mk) => { let v = map.get(k); if (!v) { v = mk(); map.set(k, v); } return v; };
  for (const r of recs) {
    const ts = r[R.ts], model = c.models[r[R.m]], sid = c.sessions[r[R.s]], cost = costOf(model, r[R.i], r[R.o], r[R.w5], r[R.w1], r[R.cr], r[R.fast]);
    if (!priceKey(model)) unpriced.add(model);
    const d = dayOf(ts);
    if (!blk || ts >= blk.end) { blk = { start: Math.floor(ts / 3.6e6) * 3.6e6, agg: emptyAgg(), last: ts }; blk.end = blk.start + BLOCK_MS; blocks.push(blk); }
    add(blk.agg, r, cost, sid); blk.last = ts;
    if (d === today) add(win.today, r, cost, sid);
    if (ts >= now - 7 * 864e5) add(win.week, r, cost, sid);
    if (ts >= now - 30 * 864e5) { add(win.month, r, cost, sid); const dd = get(daily, d, () => ({ day: d, cost: 0, tokens: 0, fam: {} })); dd.cost += cost; dd.tokens += r[R.i] + r[R.o] + r[R.w5] + r[R.w1] + r[R.cr]; const fm = family(model); dd.fam[fm] = (dd.fam[fm] || 0) + cost; }
    const rl = rt.by.get(sid); let chain = null;
    // 'unlogged': no route event for this session (started before the log, or a session the hook never saw).
    // 'none': routed, but the router named no chain. Subagent transcripts carry the parent's session id.
    if (rt.first && ts >= rt.first) { chain = rl ? rl[0][1] : 'unlogged'; if (rl) for (const [t, l] of rl) { if (t <= ts + 5000) chain = l; else break; } }
    if (sinceTs && ts >= sinceTs) { add(bw.agg, r, cost, sid); if (chain) add(get(bw.chains, chain, emptyAgg), r, cost, sid); const bs = get(bw.sessions, sid, () => ({ ...emptyAgg(), project: c.projects[r[R.p]], last: ts })); add(bs, r, cost, sid); bs.last = ts; }
    if (days === 1 ? d !== today : ts < since) continue; // 1 day means the calendar day, matching the Today tile
    add(win.range, r, cost, sid); if (r[R.sub]) subCost += cost;
    const k = priceKey(model); if (k) savedByCache += (r[R.cr] * (PRICES[k].i - PRICES[k].cr)) / 1e6;
    add(get(models, model, emptyAgg), r, cost, sid);
    add(get(projects, c.projects[r[R.p]], emptyAgg), r, cost, sid);
    const s = get(sessions, sid, () => ({ ...emptyAgg(), project: c.projects[r[R.p]], first: ts, last: ts, fam: {} })); add(s, r, cost, sid); s.last = ts; s.fam[model] = (s.fam[model] || 0) + cost;
    if (chain) add(get(chains, chain, emptyAgg), r, cost, sid);
  }
  const cur = blocks[blocks.length - 1], active = cur && now < cur.end;
  const elapsedH = active ? Math.max(0.25, (now - cur.start) / 3.6e6) : 0;
  const block = active ? { start: cur.start, end: cur.end, ...fin(cur.agg), burnPerHour: cur.agg.cost / elapsedH, projected: (cur.agg.cost / elapsedH) * 5 } : null;
  const prevBlocks = blocks.filter((b) => b !== cur || !active).slice(-40).map((b) => b.agg.cost);
  const sortCost = (m) => [...m.entries()].map(([k, v]) => ({ key: k, ...fin(v) })).sort((a, b) => b.cost - a.cost);
  const dayList = []; for (let i = 29; i >= 0; i--) { const d = dayOf(now - i * 864e5); const v = daily.get(d); if (!dayList.some((x) => x.day === d)) dayList.push(v ? { day: d, cost: +v.cost.toFixed(4), tokens: v.tokens, fam: v.fam } : { day: d, cost: 0, tokens: 0, fam: {} }); }
  const range = fin(win.range), inTok = range.input + range.cacheWrite + range.cacheRead;
  return {
    generatedAt: now, days, tz: TZ, pricesAsOf: PRICES_AS_OF, scan: stats, oldest: recs.length ? recs[0][R.ts] : null,
    basis: 'API-equivalent estimate from local transcripts. A subscription plan bills differently; use this for trends and comparisons.',
    today: fin(win.today), week: fin(win.week), month: fin(win.month), range, block,
    window: sinceTs ? { since: sinceTs, ...fin(bw.agg), topChains: sortCost(bw.chains).slice(0, 5), topSessions: [...bw.sessions.entries()].map(([k, v]) => ({ sid: k, project: v.project, last: v.last, ...fin(v) })).sort((a, b) => b.cost - a.cost).slice(0, 3) } : null,
    yesterday: daily.get(dayOf(now - 864e5))?.cost || 0,
    dayMedian: (() => { const v = [...daily.values()].filter((x) => x.day !== today && x.cost > 0).map((x) => x.cost).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; })(),
    blockMedian: prevBlocks.length ? prevBlocks.slice().sort((a, b) => a - b)[Math.floor(prevBlocks.length / 2)] : 0,
    daily: dayList,
    cache: { readShare: inTok ? range.cacheRead / inTok : 0, saved: +savedByCache.toFixed(2) }, subagentCost: +subCost.toFixed(4),
    models: sortCost(models).map((x) => ({ ...x, family: family(x.key), priced: !!priceKey(x.key) })),
    projects: sortCost(projects).slice(0, 15),
    chains: { since: rt.first, items: sortCost(chains).slice(0, 15) },
    sessions: [...sessions.entries()].map(([k, v]) => ({ sid: k, project: v.project, first: v.first, last: v.last, model: Object.entries(v.fam).sort((a, b) => b[1] - a[1])[0]?.[0] || '', ...fin(v) })).sort((a, b) => b.cost - a.cost).slice(0, 20),
    unpriced: [...unpriced],
  };
}

// CLI
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(fileURLToPath(import.meta.url)) === realOf(process.argv[1])) { // real paths: a symlinked path still runs the CLI
  const a = process.argv.slice(2), di = a.indexOf('--days'), si = a.indexOf('--since'), r = report({ days: di >= 0 ? a[di + 1] : 7, sinceTs: si >= 0 ? Number(a[si + 1]) || 0 : 0 });
  if (a.includes('--json')) { process.stdout.write(JSON.stringify(r)); process.exit(0); }
  const $ = (n) => '$' + n.toFixed(2), tk = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
  const t = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  console.log(`Claude usage (${r.basis})`);
  console.log(`Today      ${$(r.today.cost).padStart(9)}  ${tk(r.today.tokens).padStart(7)} tokens  ${r.today.sessions} sessions`);
  console.log(r.block ? `5h block   ${$(r.block.cost).padStart(9)}  ${t(r.block.start)} to ${t(r.block.end)}, ${$(r.block.burnPerHour)}/h, on pace for ${$(r.block.projected)} (typical block ${$(r.blockMedian)})` : '5h block   none active');
  console.log(`7 days     ${$(r.week.cost).padStart(9)}  ${tk(r.week.tokens).padStart(7)} tokens  ${r.week.sessions} sessions`);
  console.log(`30 days    ${$(r.month.cost).padStart(9)}  ${tk(r.month.tokens).padStart(7)} tokens  ${r.month.sessions} sessions`);
  console.log(`\nLast ${r.days} days by model:`); for (const m of r.models.slice(0, 6)) console.log(`  ${m.key.padEnd(22)} ${$(m.cost).padStart(9)}${m.priced ? '' : '  (no price)'}`);
  console.log(`Cache reads are ${(r.cache.readShare * 100).toFixed(0)}% of input; caching saved about ${$(r.cache.saved)}.`);
  console.log(`\nTop sessions, last ${r.days} days:`); for (const s of r.sessions.slice(0, 8)) console.log(`  ${s.sid.slice(0, 8)}  ${$(s.cost).padStart(9)}  ${s.project}`);
  console.log(`\nScanned ${r.scan.files} changed files (${(r.scan.newBytes / 1e6).toFixed(1)} MB) in ${r.scan.ms} ms.`);
}
