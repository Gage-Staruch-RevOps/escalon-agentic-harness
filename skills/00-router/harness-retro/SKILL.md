---
name: harness-retro
description: Finds what went wrong in recent Claude Code work and fixes the harness so it does not happen again. Reads the activity audit (failed actions, waits on the user, requests the router could not place, chains whose skills were never loaded, slow actions), works out the cause, and records the smallest durable correction (a rule, a skill gate, a routing trigger, a project note or a routing test). Use when the user says "that was wrong", "you should have", "don't do that again", "why did that fail", "run a retro", "audit Claude", "what went wrong this week", after any correction they had to make twice, and as a weekly review. Not for fixing the task itself (finish that first), editing plugin skills owned by others, or routine skill authoring (use skill-creator through C11).
---

# Harness retro

## Purpose
Turn mistakes into permanent corrections. Every miss the user has to catch should be caught by the harness next time: a rule, a gate in a skill, a routing trigger, a note or a test.

## Layer and dependencies
- Layer: L3 (system). Runs after the work, never instead of it.
- Depends on: `harness` (where things live), `references/conventions.md` in skill-router for any skill-tree edit.

## Procedure
0. **Preflight: can this session reach `~/.claude`?** The audit, triggers, tests, `lessons.md` and session transcripts all live there. Claude app chats (cloud session plus desktop bridge) cannot connect `~/.claude`: it is a protected location. If unreachable, say so in the first line, then (a) still collect chat-side evidence with the past-chat tools (`recent_chats`, `conversation_search`) for the same window, (b) apply fixes that live in `the skill tree (the harness repo's `skills/` folder)`, and (c) write the lesson entries and any `~/.claude` edits to `_inbox/harness-pending.md` for the next Claude Code run to apply. Ask the user to run `node ~/.claude/harness/bin/audit.mjs --days 7` in Claude Code or paste its output; never fake the audit.
1. **Collect the evidence.**
   - Run `node ~/.claude/harness/bin/audit.mjs --days 7` (or `--days 1` after a single bad session). It lists failed actions, waits, unrouted requests, chains with no skill loaded, slow actions and per-chain totals.
   - The log holds labels only. For the why, read the session itself: the conversation in front of you, or the Claudoscope tools (`search_sessions`, `get_session`) if connected. Never guess a cause from a label.
   - Add anything the user corrected by hand in this conversation, even if nothing "failed".
   - Read `~/.claude/harness/feedback.json`: every item with status `open` or `delivered` is a correction the user typed into the app's Improve box (scope `session` reached one session once, `all` rides on every prompt until resolved, `retro` was queued for this review). Treat each as a miss to classify, in their words.
2. **Name each miss in one line**: what happened, what should have happened, how it was caught (the user, a gate, a test, luck).
3. **Classify the cause** and pick the matching fix. Prefer the first fix that would have caught it.

| Cause | Fix | Where |
| --- | --- | --- |
| Right skill exists, was not routed | Add or widen a trigger; add a routing test case | `~/.claude/harness/triggers.json`, `bin/test-route.mjs` |
| Routed, but the skill was not loaded or followed | Tighten Rule zero wording or the chain's gates | `00-core/rules.md`, skill-router `chains.md` |
| Skill followed, skill was wrong or silent | Add the step or gate to that skill | the skill's SKILL.md (own skills only; for plugin skills write the patch note for the owner) |
| A fact about a project was missing | Add it to the project note | `~/.claude/harness/notes/<project>.md` |
| Repeated procedure with no skill | New skill through C11 | skill tree |
| Tool or environment failure | Add a preflight or a note; do not paper over it | the owning skill, or `plugin-local-runtime` |
| One-off, not worth a rule | Record it and move on | `notes/lessons.md` only |

4. **Apply the fix**, smallest first. One correction per miss. Do not add a rule when a test or gate would do; rules cost context in every session.
5. **Prove it.** Routing fixes: `node ~/.claude/harness/bin/test-route.mjs` passes with the new case. Rule or skill edits: `node ~/.claude/harness/bin/build.mjs index`, then reread the changed text once for conflicts with existing rules.
5a. **Close the feedback.** For each feedback item now fixed, set `status` to `resolved` and add `resolved` (ms timestamp) and `fix` (one line: the file changed) in `feedback.json`. Leave an item open if the fix needs the user's decision, and say so in the report. Never delete items; the app's History shows them.
6. **Record it.** Append one entry to `~/.claude/harness/notes/lessons.md` (format below) and one dated line to `~/.claude/harness/CHANGELOG.md`.
7. **Report** to the user: the misses, the correction for each, and anything that needs their decision (never change approvals, permissions or another owner's skill on your own).

## Lesson format (`notes/lessons.md`, newest first)
```
### YYYY-MM-DD: <the miss in a few words>
- What happened: ...
- Should have: ...
- Cause: <one of the causes above>
- Correction: <what was changed, with the file>
- Check: <the test or gate that now catches it>
```

## Gates (all must pass before delivery)
- [ ] Every miss has a cause backed by evidence from the session, not inferred from a label.
- [ ] Every correction is in the file that will catch it next time, and nothing was only "noted" when a gate or test was possible.
- [ ] Routing tests pass; the index is rebuilt if rules, triggers or skills changed.
- [ ] `lessons.md` and `CHANGELOG.md` both have the entry.
- [ ] No feedback item is still `open` or `delivered` without either a fix or a line in the report saying why.
- [ ] No rule was added that duplicates an existing one; core rules stayed short.

## Changelog
- 2026-11-19 v1.2: reads and closes live feedback from the app's Improve box (`feedback.json`).
- 2026-11-17 v1.1: Step 0 preflight for sessions that cannot reach `~/.claude` (first retro run from a Claude app chat hit this).
- 2026-11-17 v1.0: created with `bin/audit.mjs` and the app's audit view.
