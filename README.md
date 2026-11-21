# Agentic Harness

A company harness for Claude Code. It makes Claude work the same way for everyone at the company, and personally for each user:

- **Routing.** Before every prompt, a hook names the chain of skills to run (definitions, then data, then the build, then format, brand and delivery) and the notes that matter.
- **Rules.** One set of company rules (approvals, data handling, writing) loads into every session, filled in with each person's name, role and team.
- **Shared skills, managed in GitHub.** Company and team skills live in `skills/` in this repo. Changes go through pull requests; everyone gets them with `npm run update`.
- **A best-practice library.** About 2,800 public skills from maintained GitHub repos (Anthropic, Vercel, Cloudflare, Sentry, OpenAI and others), license-checked and security-scanned at install, routed only when they fit.
- **The app.** A desktop window that shows Claude working live: a brain-shaped map of the harness, pulses to each skill as it is used, task progress, a daily brief, alerts when a session needs you, and an editor for the skill tree.

## Install (about 5 minutes)

You need [Claude Code](https://docs.claude.com/en/docs/claude-code), [Node.js 20+](https://nodejs.org) and git.

```bash
git clone <this repo's URL> ~/agentic-harness
cd ~/agentic-harness
npm install
npm start
```

The app asks who Claude is working for (name, role, team, manager, time zone, what you do) and installs the harness. Prefer the terminal? Run `npm run setup` instead of `npm start`.

Then open a new Claude Code session. It now knows who you are and routes every request.

Your first install backs up anything already in `~/.claude` (harness, `settings.json`, `CLAUDE.md`) to `~/.claude/backups/`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm start` | Open the app |
| `npm run update` | Pull the latest rules and skills from GitHub and refresh your install (the app also tells you when an update is waiting) |
| `npm run library` | Download or refresh the public skill library (about 700 MB the first time) |
| `npm run setup` | Change your profile |
| `npm test` | Routing tests |
| `npm run lint` | Check skills in `skills/` against the conventions |
| `npm run check` | Make sure nothing personal or secret is in the repo (run before every push) |
| `npm run uninstall` | Turn the harness off for Claude Code (keeps your notes and profile) |

## What is whose

| Lives in | Owned by | Updated by |
| --- | --- | --- |
| `harness/00-core/agent.md`, `rules.md` | The company | Pull request to this repo |
| `skills/` (router, chains, company and team skills) | The company and each team | Pull request to this repo |
| `harness/triggers.json`, `sources.json` | The company | Pull request to this repo |
| `~/.claude/harness/user.json`, `00-core/projects.md` | You | `npm run setup`, or edit the file |
| `~/.claude/harness/notes/`, `10-mine/` | You | You and Claude, never overwritten by updates |

`{{name}}`, `{{company}}`, `{{role}}` and `{{team}}` in the core files are filled from your profile when the index is built.

## Add or change a skill

1. Ask Claude: "make a skill for our weekly pipeline review" (chain C9). It follows `skills/00-router/skill-router/references/conventions.md`, writes the skill in the right folder, adds a registry row and runs the lint.
2. Claude opens a branch; you open a pull request. A teammate who owns that area reviews it.
3. After merge, everyone gets it with `npm run update`.

Where skills go:

```
skills/
  00-router/      skill-router (chains, registry, conventions) and harness-retro
  10-company/     company-wide: definitions, data access, brand, policies (PLACEHOLDERS to fill)
  20-teams/<team> one folder per team
  30-people/      optional shared personal skills, such as a voice skill
  90-templates/   SKILL.template.md
```

## Routing chains

C1 to C10 work on day one with library and built-in Claude skills: business question, chart or dashboard, recurring report, email as you, document or deck, research, code change, UI, new skill, retro. C20 to C49 are reserved for company chains and C50 and up for team chains; each slot is a PLACEHOLDER in `skills/00-router/skill-router/references/chains.md` with a matching example rule at the end of `harness/triggers.json`.

## Privacy and safety

- Everything runs on your computer. The app's server listens on 127.0.0.1 only and needs a per-launch token.
- The hook logs labels (skill names, chain ids), never prompt text.
- Your profile, notes, activity log and app data stay in `~/.claude/harness/` and are never committed.
- `npm run check` blocks home-folder paths, email addresses, tokens and keys, plus any words in your own `scripts/blocklist.local.txt` (git-ignored), from reaching the repo. CI runs the same check once it is turned on (see Turning on CI).
- Library skills that are non-commercial, unlicensed or Anthropic-proprietary copies are blocked by the license gate; risky install snippets are flagged or quarantined in `THIRD-PARTY-NOTICES.md`.

## Turning on CI

`docs/ci-workflow.yml` runs the privacy check, a test install and the routing tests on every pull request. To turn it on, move it to `.github/workflows/ci.yml` and push. Your GitHub sign-in needs the `workflow` permission for that one push (`gh auth refresh -h github.com -s workflow`).

## Building an installer (optional)

`npm run dist` builds a `.dmg` (Mac) or `.exe` (Windows) with electron-builder. The app still needs this repo cloned for `npm run update`; the installer is a convenience for people who do not want a terminal to start it. Unsigned builds show an "unidentified developer" warning until the company signs them.

## Known limits

- Tested on macOS. Windows paths are handled but not yet tested.
- Opening a session in the Claude app from the map uses `claude://` links from the Claude desktop app.
- The public library is fetched per computer from GitHub, so first setup with the library takes several minutes and about 700 MB.
