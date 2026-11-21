---
name: skill-router
description: Run FIRST on every work task, before any other skill, tool call or output. Classifies the request, walks the company skill tree (references/registry.md), resolves the ordered chain of skills to load (definitions, then data, then build, then format, then brand and voice, then delivery) and enforces precedence and verification gates. Use for any request to make, build, pull, analyze, draft, refresh, publish, fix or answer something for work, even a short one. Skip only for pure small talk.
---

# Skill Router

## Purpose
Decide which skills run, in what order, and what "done" means before any work starts. The router does not do the work itself.

## Layer and dependencies
- Layer: L0 (router). Runs before every other skill; depends on nothing but its own `references/`.
- In Claude Code the harness hook usually names the chain already (a CHAIN line in the `<harness>` block); load this skill only when no chain matched.

## Procedure

### 1. Classify
Note four things:
- **Intent**: answer, analyze, build, refresh, draft, publish, fix, research.
- **Domain**: which branch of the tree (`references/registry.md`).
- **Artifact**: what leaves the conversation (reply, email draft, doc, deck, sheet, dashboard, code change, published page).
- **Audience**: the user only, the team, leadership, a client.

### 2. Walk the tree
Open `references/registry.md`, find the domain branch, then the intent.
- If a **named chain** in `references/chains.md` matches, use it verbatim.
- If not, compose one in layer order:

| Layer | Purpose | Examples |
|---|---|---|
| L1 Policy and definitions | What numbers and terms mean | the company definitions skill (PLACEHOLDER) |
| L2 Data access | How to pull data reliably | CRM, finance and warehouse access skills (PLACEHOLDER) |
| L3 Domain logic | Transform, forecast, build, research | deep-research, writing-plans, systematic-debugging |
| L4 Format | The artifact's mechanics | docs, pptx, xlsx, pdf, dataviz |
| L5 Presentation | Brand and voice | the company brand skill, the user's voice skill (PLACEHOLDERS) |
| L6 Delivery | Publish, send, save | Artifact tool, email draft, pull request |

Rules:
- **L1 loads before any business number is computed or stated.**
- **Load only what the task needs.** A one-line answer may be L1 and L2 only.
- **A skill that owns a deliverable owns its chain.** Follow its own prerequisite list; the router only adds missing L5 and L6.
- **Anything written as the user** ends with their voice skill when one exists.
- **Anything company-branded** ends with the brand skill when one exists.

### 3. Resolve conflicts
Apply the Precedence section of `references/registry.md`: company definitions beat everything; a specific skill beats a general one; company skills beat library skills with the same job; the user's explicit instruction in this conversation beats all of it.

### 4. Declare the chain (one line)
Before the first real tool call, state it, for example:

> Chain: deep-research → docs → company brand

If a step has no skill, say so in the same line: `Gap: no skill for X, doing it ad hoc.`

### 5. Execute
Load each skill just before the step that needs it (L1 up front). Each skill's own instructions override general habits. A chain skill that is not installed is named as a Gap; never invent a stand-in skill.

### 6. Verify
Run the chain's gates in `references/chains.md`, plus:
- Every number traces to a query or source run this session, not memory.
- Brand and voice rules applied when L5 was in the chain.
- The artifact opens or renders.

### 7. Learn
If a composed chain worked, or a gap showed up, end the reply with one line: `Router note: suggest adding chain "<name>" to chains.md`. Changes to this tree go to the team through a pull request (chain C9).

## Gates
- [ ] The chain was stated in one line before the first real tool call, with any Gap named.
- [ ] L1 definitions loaded before any business number was stated.
- [ ] The chain's own gates in `references/chains.md` passed.

## When to ask instead of route
Ask one question only when two branches fit and picking wrong is expensive. Otherwise pick the most specific branch and state it in the chain line.

## Files
- `references/registry.md`: the tree. Domains, intents, skills, precedence.
- `references/chains.md`: named chains with their gates.
- `references/conventions.md`: how skills in this tree are written, named and reviewed.

## Changelog
- v1.0: generic company router with placeholder slots for company and team skills.
