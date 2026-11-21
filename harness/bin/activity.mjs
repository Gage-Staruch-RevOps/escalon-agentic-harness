#!/usr/bin/env node
// Hook for PreToolUse, PostToolUse and Stop (all tools). Feeds the Agentic Harness app's live view:
// what Claude is doing (tool name plus a short label), which skills and skill files it loads,
// the task list and its progress, and when a turn ends. Labels only: no prompt text, no command
// text, no file contents. Local file, rotated by route.mjs. Never blocks: any error exits quietly.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const H = path.join(os.homedir(), '.claude', 'harness');
const clip = (s, n = 80) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = (p) => path.basename(String(p || ''));
const SKILLISH = /\.(md|json|txt)$/i;
const SKILLDIR = /(\/skills\/|\/Claude Skills\/|\/\.claude\/harness\/(00-core|notes|10-mine|05-playbooks|20-account|30-library)\/|\/scheduled-tasks\/|\/\.claude\/projects\/[^/]+\/memory\/)/;
// Skill, note and memory reads done through Bash (cat, sed -n, grep). Paths there may be quoted ("Claude Skills"/...).
const BASHREAD = /\b(cat|head|tail|sed|grep|rg|awk|less)\b/;
const BASHDIR = /(\/skills\/|Claude Skills|\.claude\/harness\/(00-core|notes|10-mine|05-playbooks|20-account|30-library)\/|scheduled-tasks\/|\.claude\/projects\/[^\s/]+\/memory\/)/;

function label(tool, ti) {
  if (tool === 'Bash') return clip(ti.description || 'Run a command');
  if (tool === 'Read') return 'Read ' + base(ti.file_path);
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'Edit ' + base(ti.file_path || ti.notebook_path);
  if (tool === 'Write') return 'Write ' + base(ti.file_path);
  if (tool === 'Grep' || tool === 'Glob') return 'Search files';
  if (tool === 'Skill') return 'Load skill ' + clip(ti.skill, 50);
  if (tool === 'Agent' || tool === 'Task') return 'Subagent: ' + clip(ti.description || 'task', 60);
  if (tool === 'WebSearch') return 'Search the web';
  if (tool === 'WebFetch') return 'Fetch a web page';
  if (tool === 'ToolSearch') return 'Find a tool';
  if (/update_plan|TodoWrite|TaskCreate|TaskUpdate/.test(tool)) return 'Update the task list';
  if (/wrap_up/.test(tool)) return 'Wrap up';
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) return clip(m[2].replace(/_/g, ' ') + (/^[0-9a-f-]{20,}$/.test(m[1]) ? '' : ' · ' + m[1].replace(/_/g, ' ')), 70);
  return clip(tool, 60);
}
function kind(tool) {
  if (tool === 'Skill') return 'skill';
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'write';
  if (tool === 'Bash') return 'run';
  if (tool === 'Agent' || tool === 'Task') return 'agent';
  if (/^Web/.test(tool)) return 'web';
  if (/^mcp__/.test(tool)) return 'tool';
  return 'other';
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(input || '{}');
    const hook = j.hook_event_name || 'PostToolUse', tool = String(j.tool_name || ''), ti = j.tool_input || {};
    const session = String(j.session_id || '').slice(0, 8), ts = Date.now();
    const out = [];
    if (hook === 'Stop' || hook === 'SubagentStop') out.push({ t: hook === 'Stop' ? 'stop' : 'substop', ts, session });
    else if (hook === 'Notification') { const m = String(j.message || ''); out.push({ t: 'notify', ts, session, kind: /permission|approve|allow/i.test(m) ? 'permission' : /waiting|input|idle/i.test(m) ? 'input' : 'note', msg: clip(m, 90) }); }
    else if (tool) {
      const id = String(j.tool_use_id || '').slice(-10) || undefined;
      const phase = hook === 'PreToolUse' ? 'pre' : 'post';
      // A failed tool call never reaches PostToolUse: it arrives as PostToolUseFailure (error, is_interrupt). An interrupt by the user is not a failure.
      const tr = j.tool_response, fail = hook === 'PostToolUseFailure' ? (j.is_interrupt ? undefined : true) : phase === 'post' && tr && typeof tr === 'object' && (tr.is_error === true || tr.error || tr.interrupted === true) ? true : undefined;
      out.push({ t: phase, ts, session, id, tool: tool.replace(/^mcp__[0-9a-f-]{20,}__/, 'mcp__'), k: kind(tool), label: label(tool, ti), fail });
      if (phase === 'pre') {
        if (tool === 'Skill' && ti.skill) out.push({ t: 'skill', ts, session, name: String(ti.skill) });
        else if (tool === 'Read' && typeof ti.file_path === 'string' && SKILLISH.test(ti.file_path) && SKILLDIR.test(ti.file_path)) out.push({ t: 'read', ts, session, path: ti.file_path });
        else if (tool === 'Bash' && typeof ti.command === 'string' && BASHREAD.test(ti.command) && BASHDIR.test(ti.command)) {
          const f = /[\w.-]+\.(md|json|txt)\b/i.exec(ti.command); // file name only, never the command text
          if (f) out.push({ t: 'read', ts, session, path: 'bash:' + f[0] });
        }
        else if (/^(Edit|Write|MultiEdit)$/.test(tool) && typeof ti.file_path === 'string' && SKILLISH.test(ti.file_path) && SKILLDIR.test(ti.file_path)) out.push({ t: 'touch', ts, session, path: ti.file_path });
        // task list: full list (TodoWrite, update_plan items) or a step change (advance / done / start)
        const items = Array.isArray(ti.todos) ? ti.todos : Array.isArray(ti.items) ? ti.items : null;
        if (items) out.push({ t: 'plan', ts, session, items: items.slice(0, 20).map((x) => ({ c: clip(x.content || x.subject || x.activeForm, 90), s: String(x.status || 'pending') })) });
        else if (/update_plan/.test(tool) && (ti.advance || ti.done || ti.start)) out.push({ t: 'planstep', ts, session, advance: !!ti.advance, done: Array.isArray(ti.done) ? ti.done : [], start: Number(ti.start) || 0 });
        else if (/wrap_up/.test(tool)) out.push({ t: 'planstep', ts, session, all: true });
      }
    }
    if (!out.length) return;
    const dir = path.join(H, '.cache'); fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'activity.jsonl'), out.map((e) => JSON.stringify(e)).join('\n') + '\n');
  } catch { /* never block */ }
});
