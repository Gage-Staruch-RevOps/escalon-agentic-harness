---
name: build-a-feature
description: Build a feature in a work codebase with a plan, tests, review and a safe ship through the team's process.
match: \b(build|add|implement|ship|make) (a |an |the |me a )?(new )?(feature|endpoint|screen|flow|integration|page|button|setting|api|webhook|report)\b
skills:
  - brainstorming
  - writing-plans
  - test-driven-development
  - systematic-debugging
  - verification-before-completion
  - requesting-code-review
---

# Build a feature

1. **Orient**: read the project's note (`~/.claude/harness/notes/`) and README. Work in a branch or worktree, never on a shared or production checkout.
2. **Shape it**: `brainstorming` for the approach. Keep it short: pick the approach you would recommend and say why in one line.
3. **Plan**: `writing-plans` for anything over an hour of work; a task list for the rest.
4. **Build test-first** where it matters: `test-driven-development` for logic, money, permissions and anything customer-facing.
5. **Stuck**: `systematic-debugging`, never guess-and-patch.
6. **UI**: the team's design system first, then `design-engineering` and `apple-design` for feel.
7. **Verify**: `verification-before-completion`: run it, test it locally, look at it.
8. **Review**: `requesting-code-review` (or the `code-review` skill) on the diff.
9. **Ship**: the team's release process in `00-core/rules.md`. Push, merge and deploy only with a yes.

## Done means

Feature works locally, tests pass, the diff is reviewed, and the report names the branch or PR and what still needs a human.
