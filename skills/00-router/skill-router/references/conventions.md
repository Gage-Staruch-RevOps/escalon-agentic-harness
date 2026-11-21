# Skill Conventions

Standards for every skill in this tree. The router and `lint-skills.mjs` depend on them.

## Folder layout
```
skills/
  00-router/        skill-router and harness-retro (run first, tune the harness)
  10-company/       company-wide skills: definitions, data access, brand, policies
  20-teams/<team>/  one folder per team (sales, marketing, finance, operations, revops, engineering, ...)
  30-people/<name>/ optional personal skills, such as a voice skill
  90-templates/     SKILL.template.md
  _archive/         old versions, dated. Never loaded.
```
One skill = one folder named exactly like its `name:` (kebab-case). Inside: `SKILL.md`, optional `references/`, `scripts/`, `assets/`.

## SKILL.md frontmatter
```yaml
---
name: kebab-case-name           # matches folder name
description: <what it does>. Use when <triggers>. Not for <near-misses> (use <other-skill>).
---
```
Only `name` and `description` are read by Claude. Put version and changelog in the body.

The description is the trigger. It says what the skill does, when to use it (concrete phrases people actually say) and when not to, pointing at the right skill. Under about 900 characters.

## Body structure
1. **Purpose** (2 lines)
2. **Layer** (L1 to L6, see the router) and **Depends on** (skills that must load first)
3. **Procedure** (numbered, imperative)
4. **Gates** (checklist that must pass before delivery)
5. **Changelog** (`- YYYY-MM-DD v1.2: what changed`)

Keep SKILL.md under about 400 lines; move detail into `references/` and say when to read each file.

## Single responsibility
A skill does one job at one layer. If it needs definitions it says "Depends on: <definitions skill>" instead of copying them. Copies drift; references do not.

## What never goes in a skill
- Secrets, passwords, tokens or API keys.
- Client, employee, pay, tax or health details. Use made-up examples.
- Personal paths (`/Users/<name>/...`). Use `~` or a path relative to the skill.

## Review and versioning
- Every change is a branch and a pull request; a teammate who owns the area reviews it.
- Before a breaking change, copy the folder to `_archive/YYYY-MM-DD/<name>/`.
- A skill is not live until it has a row in `00-router/skill-router/references/registry.md`. A repeatable pipeline also gets a chain in `chains.md`.
- After merging, everyone picks it up with `npm run update` in their harness folder (the app shows when an update is waiting).

## Third-party skills
Public skills come in through the library (`harness/sources.json`), not by copying them into this tree. To adopt one company-wide, add its repo to `sources.json` (and to `favorites` to rank it first) in a pull request. The build's license gate blocks non-commercial and unlicensed skills.
