# Named Chains

Tested pipelines. The router uses these verbatim when the request matches; the harness hook names one in the `<harness>` block when a trigger in `~/.claude/harness/triggers.json` fires. Each chain has gates that must pass before delivery.

Numbering: C1 to C19 are the general chains below and work on day one with library and Claude skills. C20 to C49 are reserved for company chains, C50 and up for team chains. A step written `PLACEHOLDER:` is a slot for a company skill that does not exist yet; until it does, the router names it as a Gap and does the step ad hoc.

Format: triggers → chain → gates

---

### C1. Business question (chat answer)
**Triggers**: "how many", "what's our", "how is X doing this quarter"
**Chain**: PLACEHOLDER: company-definitions → PLACEHOLDER: data-access skill for the system of record → reply
**Gates**: the definition used is stated in one line; every figure came from a query run this session; the source system is named.

### C2. Analysis with a chart or dashboard
**Triggers**: "chart", "graph", "build a dashboard of", "visualize"
**Chain**: (C1's definitions and data steps) → dataviz → PLACEHOLDER: company-brand → Artifact (Dashboard type when offered)
**Gates**: data saved to files and computed in code; renders in light and dark; numbers reconcile with C1 for the same cut.

### C3. Recurring report or deck
**Triggers**: "refresh the", "monthly report", "weekly report", "update the deck"
**Chain**: PLACEHOLDER: the report's owner skill → (its listed prerequisites) → pptx / xlsx / docs → PLACEHOLDER: company-brand
**Gates**: last period's layout kept; nothing dropped from the last version; every number sourced this session; output saved in a dated run folder.

### C4. Email or message as the user
**Triggers**: "draft a reply", "write an email to", "message the team", "follow up with"
**Chain**: (definitions if any number) → PLACEHOLDER: the user's voice skill (until one exists: humanizer, stop-slop) → email draft or reply text
**Gates**: never sent without a yes; no em dashes; a recommendation, owner and date when there is a choice; length matches the audience.

### C5. Document, deck or spreadsheet
**Triggers**: "write a doc", "make slides", "build a spreadsheet", "PDF", "Word", "PowerPoint", "Excel"
**Chain**: docs / pptx / xlsx / pdf (the format asked for) → PLACEHOLDER: company-brand
**Gates**: the file opens; brand applied when it leaves the user's desk; no placeholder text left.

### C6. Research report
**Triggers**: "research", "look into", "compare vendors", "what are the options for"
**Chain**: deep-research → research-report playbook (`05-playbooks/research-report.md`) → docs
**Gates**: every claim has a source; sources dated; recommendation stated with its tradeoff.

### C7. Code change, feature or bug fix
**Triggers**: "build", "fix the bug", "add a feature", "refactor", "why does this fail"
**Chain**: writing-plans (non-trivial work) → systematic-debugging (bugs) → the build → verification-before-completion → branch and pull request
**Gates**: tests or a run prove it works; nothing pushed to a shared branch without a yes; rollback target noted before any deploy.

### C8. UI build or polish
**Triggers**: "make it look better", "polish the UI", "build a page", "landing page", "component"
**Chain**: frontend-design → design-engineering → PLACEHOLDER: company-brand → (animate / choreograph as needed)
**Gates**: looked at in a browser at desktop and phone width; light and dark checked; no layout shift.

### C9. New or improved skill
**Triggers**: "make a skill", "turn this into a skill", "add a skill", "update the skill"
**Chain**: skill-router/references/conventions.md → skill-creator → write it in the right tree folder → add its row to registry.md (and a chain here if it forms one) → `node ~/.claude/harness/bin/lint-skills.mjs` → branch and pull request to the harness repo
**Gates**: lint passes; description says what, when and when not; registry row added; opened as a pull request, never pushed to main.

### C10. Harness retro or tune-up
**Triggers**: "run a retro", "that was wrong", "don't do that again", "audit Claude"
**Chain**: harness-retro
**Gates**: harness-retro's own gates; routing tests pass (`node ~/.claude/harness/bin/test-route.mjs`).

---

## Company chains (C20 to C49)

### C20. PLACEHOLDER: company chain
**Triggers**: PLACEHOLDER phrases people actually say
**Chain**: PLACEHOLDER: owner skill → its prerequisites → format → brand → delivery
**Gates**: PLACEHOLDER: what must be true before it is delivered

## Team chains (C50 and up)

### C50. PLACEHOLDER: team chain
**Triggers**: PLACEHOLDER
**Chain**: PLACEHOLDER
**Gates**: PLACEHOLDER
