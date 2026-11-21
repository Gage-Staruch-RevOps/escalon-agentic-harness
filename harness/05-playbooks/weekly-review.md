---
name: weekly-review
description: The user's weekly work review and plan: open work, reviews, meetings, blockers and the week's focus.
match: \b(weekly review|monday review|week ahead|plan (my|the) week|what should i (work on|focus on)|where do things stand|status update)\b
skills:
  - stakeholder-update
  - status-report
---

# Weekly review

1. **Open work**: tickets, branches and PRs assigned to the user or waiting on them. EDIT: where these live (ticket tool, repo hosts).
2. **Reviews owed**: PRs and docs others are waiting on the user to review.
3. **Calendar**: this week's meetings that need prep, and deadlines.
4. **Blockers**: anything stuck on someone else, with who and since when.
5. **Notes**: open items in `~/.claude/harness/notes/`.
6. **Output**: the 3 to 5 things that matter this week, in priority order. If a status update is due, draft it with `stakeholder-update` or `status-report`.

## Weekly questions

1. What is the most important thing to ship this week, and what is its next step?
2. Who is waiting on me, and for what?
3. What am I waiting on, and does it need a nudge?
4. What did I commit to last week that is not done?
5. What am I saying no to this week?

## Done means

One short page: this week's 3 to 5 priorities, reviews owed, blockers, and a draft status update if one is due.
