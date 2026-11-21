---
name: my-playbook
description: One line on what job this playbook runs end to end.
match: \b(words|that|should|trigger|it)\b
skills:
  - first-skill-name
  - second-skill-name
---

# My playbook

Copy this file to a new name (no leading underscore), fill it in, then run `node ~/.claude/harness/bin/build.mjs index`.

- `match` is a regular expression tested against each prompt (case-insensitive). When it hits, the router names this playbook and pins its first 3 skills.
- `skills` lists skill names in the order the job uses them. Find names in `~/.claude/harness/INDEX.md`.

## Steps

1. ...

## Done means

- ...
