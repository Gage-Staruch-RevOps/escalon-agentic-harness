# How to change the harness

Everything here is plain text. Edit any file below, then run one command so Claude sees the change:

```bash
node ~/.claude/harness/bin/build.mjs index
```

## What to edit for what

| I want to change... | Edit this | Notes |
| --- | --- | --- |
| Who Claude is for me at work, how it works each request | `00-core/agent.md` | Copied into `~/.claude/CLAUDE.md` by the command above |
| My hard rules (what needs a yes, what stays private) | `00-core/rules.md` | Same |
| My role, projects, tools, who's who | `00-core/projects.md` | Same. Fill in the `EDIT:` lines first |
| Facts about one project | `notes/<project>.md` | Add a rule in `triggers.json` so it surfaces |
| A multi-step recipe for a kind of job | `05-playbooks/*.md` | Copy `_template.md` to start a new one |
| What a department does, who is on it, how it works | `10-mine/departments/dept-<name>/SKILL.md` | Copy `10-mine/departments/_DEPARTMENT_TEMPLATE.md` for a new one; add a trigger |
| A new skill of my own | `10-mine/<category>/<name>/SKILL.md` | Copy from `10-mine/_TEMPLATE.md` |
| A skill from the library or account | Fork it first (below), then edit the fork | Library folders are rebuilt from source |
| Which skills rank higher | `favorites` list in `sources.json` | Favorites get a boost in every match |
| Which words pull in a project's notes or skills | `triggers.json` | One regular expression per rule |
| Which repos the library pulls from | `git` list in `sources.json` | Then run `build.mjs all` |
| Which skills show in every session's skill list | `promote` in `sources.json` | Costs context every session, so keep it short |

## Fork a skill to make it yours

```bash
node ~/.claude/harness/bin/fork.mjs copywriting
node ~/.claude/harness/bin/fork.mjs copywriting --as team-copywriting
node ~/.claude/harness/bin/fork.mjs --list
```

The fork lands in `10-mine/`, keeps a note of where it came from, outranks the original, and survives every rebuild. If the original was a native skill (in the Skill list), the fork replaces it there too.

## Find every spot marked to fill in

```bash
grep -rn "EDIT:" ~/.claude/harness/00-core ~/.claude/harness/05-playbooks ~/.claude/harness/10-mine
```

## Check it still routes well

```bash
node ~/.claude/harness/bin/test-route.mjs
echo '{"prompt":"write a spec for bulk invoice import"}' | node ~/.claude/harness/bin/route.mjs
```

## Ask Claude to do it

You never have to edit by hand. Say things like "add to my rules that releases go through the change board", "make a playbook for month-end close", "add a note about the reporting service", or "fork the copywriting skill and make it match our brand voice". The `harness` skill tells Claude how.
