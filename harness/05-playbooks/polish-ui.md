---
name: polish-ui
description: Make an existing screen or app feel premium and native: motion, spacing, states, accessibility, worst-case content.
match: \b(polish|feel(s)? (better|premium|native|cheap|off|janky|clunky)|make it (nicer|prettier|feel better)|ui review|design review|tighten (the |up the )?ui|apple[- ]level)\b
skills:
  - design-engineering
  - apple-design
  - review-animations
  - web-design-guidelines
  - baseline-ui
  - fixing-accessibility
  - break-ui
  - mobile-native
---

# Polish UI

1. **Look first**: screenshot at phone and desktop width. List what feels off before touching code.
2. **Craft pass**: `design-engineering` (press states, popover origin, timing), `apple-design` (springs, interruptible gestures, materials).
3. **Motion**: `review-animations`; remove what doesn't earn its place (`remove-animations`), fix jank (`animation-performance`).
4. **Rules**: `web-design-guidelines` and `baseline-ui`, then the team's design system.
5. **Accessibility**: `fixing-accessibility` (contrast, focus, labels, reduced motion).
6. **Stress**: `break-ui` with worst-case data. **Phone feel**: `mobile-native`.
7. Before/after screenshots in the report.

## Done means

Before/after screenshots, no regressions at phone width, reduced motion respected.
