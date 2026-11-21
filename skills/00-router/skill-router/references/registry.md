# Skill Registry (the tree)

Single source of truth for which skill covers what. A skill is not live in the tree until it has a row here. Change this file through a pull request.

Location key: **[tree]** lives in this repo's `skills/` folder; **[plugin]** comes from a company Claude plugin; **[claude]** built into Claude (docs, pptx, xlsx, pdf, dataviz, deep-research, skill-creator); **[library]** fetched by the harness from public skill repos (see `harness/sources.json`).

---

## 1. Company definitions and data
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| What a business number or term means | PLACEHOLDER: company-definitions | L1 | tree `10-company/` |
| Pull data from the system of record (CRM, finance, warehouse) | PLACEHOLDER: one access skill per system | L2 | tree `10-company/` or plugin |

## 2. Writing and communication
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| Write as the user (email, chat, update) | PLACEHOLDER: `<name>-voice` (each person may add their own) | L5 | tree `20-teams/<team>/` |
| Make prose plain and human | humanizer, stop-slop | L5 | library |
| Company look for anything branded | PLACEHOLDER: company-brand | L5 | tree `10-company/` |

## 3. Documents, decks, sheets, dashboards
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| Doc, deck, spreadsheet, PDF | docs, pptx, xlsx, pdf | L4 | claude |
| Chart or dashboard | dataviz | L4 | claude |
| Research report | deep-research | L3 | claude |

## 4. Engineering
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| Plan non-trivial work | writing-plans | L3 | library |
| Debug | systematic-debugging | L3 | library |
| Prove it works before saying done | verification-before-completion | L3 | library |
| UI direction and polish | frontend-design, design-engineering | L3 | library |

## 5. Team skills
One table per team folder in `20-teams/`. Each team owns its rows.

### PLACEHOLDER: team name
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| PLACEHOLDER | PLACEHOLDER | L? | tree `20-teams/<team>/` |

## 6. The harness itself
| Intent | Skill(s) | Layer | Where |
|---|---|---|---|
| Route a request | skill-router | L0 | tree `00-router/` |
| Retro and tune-up | harness-retro | L3 | tree `00-router/` |
| Make or improve a skill | skill-creator, then C9 | L3 | claude |

---

## Precedence
1. The user's explicit instruction in this conversation.
2. Company definitions (L1) beat any number or term elsewhere.
3. A specific skill beats a general one.
4. Company skills (tree, plugins) beat library skills with the same job.
5. Among library skills, the `favorites` in `harness/sources.json` rank first.
