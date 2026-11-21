#!/usr/bin/env node
// UserPromptSubmit hook. Reads the prompt, scores it against index.json (BM25 over skill names and
// descriptions, plus project triggers from triggers.json) and prints a short <harness> block that
// Claude sees before it starts. Silent when nothing fits. Never blocks: any error exits 0 quietly.
//   Manual test: echo '{"prompt":"make the landing page animations feel better"}' | node route.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const H = path.join(os.homedir(), '.claude', 'harness');
const MAX_SKILLS = 5;
const TIER_BOOST = { mine: 1.7, account: 1.4, anthropic: 1.3, author: 1.25, vendor: 1.12, community: 1.0 };
const NAME_W = 1.2;      // extra weight when a prompt word is in the skill's name
const FAV_BOOST = 1.35;  // skills named in favorites (sources.json)
const PER_SOURCE = 2;    // at most this many picks from one repo or plugin, so near-duplicates don't crowd the list
const MIN = 6.0;         // absolute score floor, tuned with bin/test-route.mjs

import { terms, stem, WEAK } from './text.mjs';

const LIB_CAP_WHEN_ROUTED = 2; // when a company chain or tree skill is pinned, library picks are supplements only
const LIB_MIN_WHEN_ROUTED = MIN * 1.6;
const MAX_CHAINS = 2;
const DESC_CHARS = 80;
const CHAIN_CHARS = 170;
const PIN_FIRST = new Set(['skill-tree', 'company-account', 'anthropic-account']);

export function route(prompt, { index, triggers, cwd = '' } = {}) {
  index ||= JSON.parse(fs.readFileSync(path.join(H, 'index.json'), 'utf8'));
  triggers ||= JSON.parse(fs.readFileSync(path.join(H, 'triggers.json'), 'utf8'));
  const text = String(prompt || '');
  const pinned = [];
  const notes = [];
  const boosts = [];
  const playbooks = [];
  const chainHits = []; // { id, owns }
  for (const pb of index.playbooks || []) {
    if (!pb.match || !new RegExp(pb.match, 'i').test(text)) continue;
    playbooks.push(pb);
    for (const s of pb.skills.slice(0, 3)) if (!pinned.includes(s)) pinned.push(s);
  }
  // Short approvals ("Yes, fix them", "ok go ahead and deploy it", "Done, verify it") are continuations: Rule zero keeps
  // the previous route, so keyword picks on the one verb left ("fix" -> gh-fix-ci, ios-fix) are noise. A trigger still wins.
  const continuation = /^\W*(yes|yep|yeah|yup|ok(ay)?|sure|go ahead|do it|done|sounds good|please do|approved|confirm(ed)?|lgtm|ship it)\b/i.test(text)
    && text.trim().split(/\s+/).length <= 8;
  let folderHit = false; // a folder-scoped rule fired; on a short prompt, library keyword picks are noise ("ship" -> ship)
  for (const t of triggers.rules) {
    // Folder-scoped rules ("cwd": [fragments]) catch short asks like "Validate for prod" that only make sense in that
    // project. Continuations skip them: they keep the route they already have.
    if (t.cwd && (continuation || !t.cwd.some((f) => cwd.includes(f)))) continue;
    if (!new RegExp(t.match, 'i').test(text)) continue;
    if (t.cwd) folderHit = true;
    for (const s of t.skills || []) if (!pinned.includes(s)) pinned.push(s);
    for (const n of t.notes || []) if (!notes.includes(n)) notes.push(n);
    for (const b of t.boost || []) boosts.push(b);
    if (t.chain && !chainHits.some((c) => c.id === t.chain)) chainHits.push({ id: t.chain, owns: !!t.owns });
  }
  // A deliverable-owner chain (C3 deck, C6 weekly update...) replaces generic chains like C1.
  const owners = chainHits.filter((c) => c.owns);
  const chains = (owners.length ? owners : chainHits).slice(0, MAX_CHAINS)
    .map((c) => ({ id: c.id, text: index.chains?.[c.id] || '' }));
  // Project and tool names (listed in triggers.json projectPhrases) route through triggers; keep them out of keyword scoring.
  let scoringText = text;
  for (const ph of triggers.projectPhrases || []) scoringText = scoringText.replace(new RegExp(`\\b${ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  const q = [...new Set(terms(scoringText))];
  // Vague prompts ("try again", "keep going") carry no topic. Without a trigger, route nothing rather than guess.
  const strong = q.filter((t) => !WEAK.has(t));
  const notesDir = triggers.notesDir || '~/.claude/harness/notes';
  if ((strong.length === 0 || continuation) && !pinned.length && !notes.length) return { picks: [], notes: [], playbooks: [], chains: [], notesDir };
  const groups = (triggers.exclusive?.groups || []).map((g) => {
    const members = g.members.map((m) => stem(m.replace(/-/g, '')));
    return { members, unmentioned: g.unmentioned, asked: members.filter((m) => q.includes(m)) };
  });
  const scored = [];
  if (q.length) {
    const N = index.n, k1 = 1.2, b = 0.75;
    const idf = (t) => { const df = index.df[t] || 0.5; return Math.log(1 + (N - df + 0.5) / (df + 0.5)); };
    for (const e of index.entries) {
      const toks = e.t.split(' ');
      const tf = {};
      for (const t of toks) tf[t] = (tf[t] || 0) + 1;
      const nm = e.nm ? e.nm.split(' ') : [];
      let s = 0, hits = 0, nameHits = 0;
      for (const t of q) {
        const f = tf[t];
        if (!f) continue;
        hits++;
        const w = WEAK.has(t) ? 0.5 : 1;
        s += w * idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks.length / index.avgLen));
        if (nm.includes(t) && w === 1) { nameHits++; s += NAME_W * idf(t); }
      }
      if (!s) continue;
      if (hits < 2 && !nameHits && q.length > 2) s *= 0.45; // one shared non-name word is weak evidence
      if (strong.length === 1 && !nameHits) continue;       // a one-word topic must be in the skill's name
      s *= TIER_BOOST[e.tier] || 1;
      for (const g of boosts) if (e.group.includes(g) || e.name.includes(g)) { s *= 1.5; break; }
      if (e.flagged) s *= 0.6;
      if (PIN_FIRST.has(e.source)) s *= 0.5; // reached through triggers and chains; keyword overlap alone is weak evidence
      if (e.fav) s *= FAV_BOOST;
      for (const g of groups) {
        const inName = g.members.filter((m) => nm.includes(m));
        if (!inName.length) continue;
        if (g.asked.length) { if (!inName.some((m) => g.asked.includes(m))) s *= 0.35; }
        else s *= g.unmentioned;
      }
      scored.push({ e, s });
    }
    scored.sort((a, b) => b.s - a.s);
  }
  const top = scored[0]?.s || 0;
  const picks = [];
  const perSource = {};
  const srcKey = (e) => (e.layer === '30-library' ? e.source : e.group);
  const take = (e) => { picks.push(e); perSource[srcKey(e)] = (perSource[srcKey(e)] || 0) + 1; };
  // Pinned names resolve to a native skill first, then to the first entry with that name (entries are in tier order),
  // so a community skill that reuses a name ("apple-design--dickwu") never shadows the native one.
  const byKey = new Map();
  for (const e of index.entries) if (!byKey.has(e.name)) byKey.set(e.name, e);
  for (const e of index.entries) if (e.native) byKey.set(e.native, e);
  for (const key of pinned) {
    const e = byKey.get(key) || index.entries.find((x) => x.name === key || x.id.endsWith('/' + key));
    if (e && !picks.includes(e)) take(e);
  }
  const limit = MAX_SKILLS + Math.min(2, picks.length);
  const routed = chains.length > 0 || picks.some((e) => e.tier === 'mine');
  let libTaken = 0;
  for (const { e, s } of scored) {
    if (picks.length >= limit) break;
    if (s < MIN || s < top * 0.4) break;
    if (picks.some((p) => p.name === e.name || (p.native && p.native === e.native))) continue;
    if (folderHit && e.layer === '30-library' && text.trim().split(/\s+/).length <= 6) continue;
    if (routed && e.layer === '30-library' && (libTaken >= LIB_CAP_WHEN_ROUTED || s < LIB_MIN_WHEN_ROUTED)) continue;
    if (e.layer === '30-library') libTaken++;
    if ((perSource[srcKey(e)] || 0) >= PER_SOURCE) continue;
    const fam = family(e);
    if (fam && picks.some((p) => family(p) === fam)) continue; // solana-vulnerability-scanner vs substrate-vulnerability-scanner
    take(e);
  }
  // Notes for the project folder the session runs in, for any request with a topic ("I can't sign in" in
  // partner-portal still needs the project note). Vague prompts returned above, so continuations stay quiet.
  if (cwd) {
    for (const [frag, ns] of Object.entries(triggers.cwdNotes || {})) {
      if (frag.startsWith('_') || !cwd.includes(frag)) continue;
      for (const n of ns) if (!notes.includes(n)) notes.push(n);
    }
  }
  return { picks, notes, playbooks: playbooks.slice(0, 2), chains, notesDir };
}

// The text the hook routes on: the user's own words. Returns '' when the turn is not a request from them.
// The desktop app prepends <system-reminder> context (4K+ chars) to the prompt; left in, it filled the
// 2000-char cap, cut the real ask off and fired chains on boilerplate ("that reply" -> C5). Retro 2026-11-17.
export function cleanPrompt(raw) {
  let p = String(raw || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    // Output of a command the user ran with ! is context, not the request.
    .replace(/<bash-(input|stdout|stderr)>[\s\S]*?<\/bash-\1>/g, ' ');
  // System turns, and unattended scheduled tasks (their own SKILL.md is the route), are not requests from the user.
  if (/<task-notification>|\[SYSTEM NOTIFICATION|<side-sessions-event>|<ci-monitor-event>|Subagent hand-back|<scheduled-task[\s>]/.test(p)) return '';
  p = p.trim();
  if (/^Base directory for this skill:/.test(p)) return ''; // a skill body the app injected, not a request
  // A compaction summary restates the old ask; routing it fired library picks on the summary text. Retro 2026-11-20.
  if (/^This session is being continued from a previous conversation/.test(p)) return '';
  return p.length < 3 ? '' : p.slice(0, 2000); // "thanks", "yes do it": route() drops topic-less prompts itself // the ask is near the top; long pastes only add noise
}

const family = (e) => { const t = e.name.toLowerCase().split(/[-_:]+/).filter(Boolean); return t.length >= 3 ? t.slice(-2).join('-') : null; };

const short = (p) => p.replace(/^~\/\.claude\/harness\//, 'H/');

export function render({ picks, notes, playbooks = [], chains = [], notesDir = '~/.claude/harness/notes' }) {
  if (!picks.length && !notes.length && !playbooks.length && !chains.length) return '';
  const lines = ['<harness>', 'Rule zero: route, then begin. A CHAIN line is the skill-router chain to run as written (skip loading skill-router). Load only the skills that fit; H/ = ~/.claude/harness/.'];
  for (const c of chains) {
    const t = c.text || 'see skill-router chains.md';
    lines.push(`- CHAIN ${c.id}: ${t.length > CHAIN_CHARS ? t.slice(0, CHAIN_CHARS) + '... (full: chains.md)' : t}`);
  }
  for (const pb of playbooks) lines.push(`- PLAYBOOK ${pb.name}: read ${short(pb.path)} first`);
  for (const e of picks) {
    const how = e.native && !e.native.startsWith('mcp:') ? `Skill "${e.native}"` : `read ${short(e.path)}`;
    const d = e.desc.replace(/\s+/g, ' ');
    lines.push(`- ${e.name} [${how}] ${d.slice(0, DESC_CHARS)}${d.length > DESC_CHARS ? '...' : ''}`);
  }
  if (notes.length) lines.push(`- notes (read first): ${notes.map((n) => n.replace(/^NOTES\//, '')).join(', ')} in ${short(notesDir + '/')}`);
  lines.push('</harness>');
  return lines.join('\n');
}

// Live view for the Agentic Harness app: what was routed (ids only, never the prompt text). Local file, rotated at 512 KB.
export function logActivity(result, j = {}, cont = null) {
  try {
    if (!result.picks.length && !result.chains.length && !result.notes.length && !cont) return;
    const dir = path.join(H, '.cache'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'activity.jsonl');
    try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.1'); } catch {}
    const ev = { t: 'route', ts: Date.now(), session: String(j.session_id || '').slice(0, 8),
      folder: path.basename(String(j.cwd || '')), sid: String(j.session_id || ''), cwd: String(j.cwd || ''), chains: result.chains.map((c) => 'chain:' + c.id), cont: cont || undefined,
      picks: result.picks.map((p) => p.native || 'skill:' + p.id), notes: result.notes.map((n) => 'note:' + n.replace(/^NOTES\//, '')) };
    fs.appendFileSync(f, JSON.stringify(ev) + '\n');
  } catch { /* never block the prompt */ }
}

// Feedback the user typed in the Harness app (feedback.json). Session-scoped items are delivered once, to that
// session's next prompt; "all" items go to every prompt until they resolve them. Never throws.
function feedbackLines(j) {
  try {
    const f = path.join(H, 'feedback.json'); if (!fs.existsSync(f)) return [];
    const d = JSON.parse(fs.readFileSync(f, 'utf8')), sid = String(j.session_id || ''), out = []; let changed = false;
    for (const it of d.items || []) {
      if (it.status === 'resolved' || it.scope === 'retro') continue;
      if (it.scope === 'all') out.push(`- FEEDBACK FROM THE USER (standing, apply to this request): ${it.text}`);
      else if (it.scope === 'session' && it.status === 'open' && it.session && sid && (sid === it.session || sid.startsWith(it.session.slice(0, 8)))) { out.push(`- FEEDBACK FROM THE USER (for this session, apply now, then run harness-retro if it should be permanent): ${it.text}`); it.status = 'delivered'; it.delivered = Date.now(); changed = true; }
    }
    if (changed) fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
    return out.slice(0, 6);
  } catch { return []; }
}

// Rule zero item 5, enforced: a prompt that names no chain, in a session that was on one (last 24 hours), is most likely a continuation
// ("scrub, keep licences", "no banner appeared"). Say so, and for short prompts drop the library guesses, which are noise.
function continuation(sessionId, prompt, result) {
  const short = prompt.split(/\s+/).filter(Boolean).length <= 8, lib = (p) => /(^|\/)(30-library|20-account\/marketplace)\//.test(String(p.id || ''));
  let last = null; const f = sessionId ? path.join(H, '.cache', 'route', String(sessionId).replace(/[^\w-]/g, '') + '.chain') : null;
  try {
    if (f) { fs.mkdirSync(path.dirname(f), { recursive: true });
      if (result.chains.length) fs.writeFileSync(f, JSON.stringify({ id: result.chains[0].id, ts: Date.now() }));
      else { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (Date.now() - j.ts < 24 * 3600e3 /* 24h: sessions resume the next morning, retro 2026-11-20 */) { last = j.id; fs.writeFileSync(f, JSON.stringify({ id: j.id, ts: Date.now() })); } } }
  } catch {}
  if (result.chains.length) return null;
  if (short) result.picks = result.picks.filter((p) => !lib(p));
  return last;
}

// Same route as this session's previous prompt: say so in one line instead of repeating the block.
function dedupe(sessionId, result, out) {
  if (!sessionId || !out) return out;
  const dir = path.join(H, '.cache', 'route');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const sig = JSON.stringify([result.chains.map((c) => c.id), result.picks.map((p) => p.id), result.notes, result.playbooks.map((p) => p.name)]);
    const f = path.join(dir, String(sessionId).replace(/[^\w-]/g, '') + '.json');
    let prev = null;
    try { prev = fs.readFileSync(f, 'utf8'); } catch {}
    fs.writeFileSync(f, sig);
    if (Math.random() < 0.02) for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.rmSync(p, { force: true }); }
    return prev === sig ? '<harness>Same route as your previous prompt in this session; keep it.</harness>' : out;
  } catch { return out; }
}

if (process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(input || '{}');
      const fb = feedbackLines(j);
      const prompt = cleanPrompt(j.prompt ?? j.user_prompt ?? '');
      if (!prompt) { if (fb.length) process.stdout.write(['<harness>', ...fb, '</harness>'].join('\n') + '\n'); return; }
      const result = route(prompt, { cwd: String(j.cwd || '') });
      const cont = continuation(j.session_id, prompt, result);
      logActivity(result, j, cont);
      let out = dedupe(j.session_id, result, render(result));
      if (cont) { const line = `- LAST ROUTE in this session: ${cont}. If this message continues that work, keep that route (same route) and ignore unrelated skills listed here; if the topic changed, route fresh.`; out = out && !/Same route as your previous prompt/.test(out) ? out.replace(/<\/harness>\s*$/, line + '\n</harness>') : ['<harness>', line, '</harness>'].join('\n'); }
      if (fb.length) out = out ? out.replace(/<\/harness>\s*$/, fb.join('\n') + '\n</harness>') : ['<harness>', ...fb, '</harness>'].join('\n');
      if (out) process.stdout.write(out + '\n');
    } catch { /* never block the prompt */ }
  });
}
