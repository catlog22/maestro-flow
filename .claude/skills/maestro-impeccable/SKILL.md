---
name: maestro-impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 1.0.0
user-invocable: true
argument-hint: "[craft|shape · audit|critique · animate|bolder|colorize|delight|layout|overdrive|quieter|typeset · adapt|clarify|distill · harden|onboard|optimize|polish · teach|document|extract|live] [target] [--skip-harvest] [-y]"
allowed-tools:
  - Bash(maestro impeccable *)
  - Write
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft. Automatically harvests design knowledge to `.workflow/knowhow/` for cross-session accumulation.

## Setup

Before any design work or file edits:

1. Load context (PRODUCT.md / DESIGN.md) via the loader script.
2. Identify the register and load the matching register reference (brand.md or product.md).
3. **If the user invoked a sub-command (e.g. `craft`, `shape`, `audit`), load its reference file too.** Non-negotiable: `craft` without `craft.md` loaded means skipping the shape-and-confirm step.

Skipping these produces generic output that ignores the project.

### 1. Context gathering

Two files, case-insensitive. The loader looks at the project root by default and falls back to `.agents/context/` and `docs/` if the root is clean. Override with `IMPECCABLE_CONTEXT_DIR=path/to/dir`.

- **PRODUCT.md**: required. Users, brand, tone, anti-references, strategic principles.
- **DESIGN.md**: optional, strongly recommended. Colors, typography, elevation, components.

Load both in one call:

```bash
maestro impeccable load-context
```

Consume the full JSON output. Never pipe through `head`, `tail`, `grep`, or `jq`.

If the output is already in this session, don't re-run. Exceptions: you just ran `teach` or `document` (they rewrite the files), or the user manually edited one.

`live` already warms context via `maestro impeccable live`. If you've run `live`, skip `load-context`.

If PRODUCT.md is missing/empty/placeholder (`[TODO]`, <200 chars): run `teach`, then resume the original task. If the original task was `craft`, resume into `shape` first.

If DESIGN.md is missing: nudge once per session (*"Run `/maestro-impeccable document` for more on-brand output"*), then proceed.

### 2. Register

Every design task is **brand** (marketing, landing, campaign: design IS the product) or **product** (app UI, admin, dashboard: design SERVES the product).

Identify before designing. Priority: (1) cue in the task; (2) surface in focus; (3) `register` field in PRODUCT.md. First match wins.

Load the matching reference: [brand.md](~/.maestro/workflows/impeccable/brand.md) or [product.md](~/.maestro/workflows/impeccable/product.md).

## Shared design laws

Apply to every design, both registers. Match complexity to vision. Vary across projects; never converge on the same choices.

### Color

- Use OKLCH. Reduce chroma near lightness extremes.
- Never `#000` or `#fff`. Tint neutrals toward brand hue (chroma 0.005-0.01).
- Pick **color strategy** first: Restrained → Committed → Full palette → Drenched.

### Theme

Write one sentence of physical scene before choosing dark/light. Run the sentence, not the category.

### Typography

- Body line length: 65-75ch.
- Hierarchy: scale + weight contrast (≥1.25 ratio).

### Layout

- Vary spacing for rhythm. Cards only when truly best affordance. No nested cards.

### Motion

- No CSS layout property animations. Ease-out with exponential curves.

### Absolute bans

Match-and-refuse: side-stripe borders, gradient text, glassmorphism as default, hero-metric template, identical card grids, modal as first thought.

### Copy

Every word earns its place. No em dashes.

### AI slop test

Two-altitude category-reflex check. If someone could guess theme+palette from category alone, or guess aesthetic family from category+anti-references, rework until neither is obvious.

See [~/.maestro/workflows/impeccable/brand.md](~/.maestro/workflows/impeccable/brand.md) for reflex-reject aesthetic lanes.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Shape, then build end-to-end | [~/.maestro/workflows/impeccable/craft.md](~/.maestro/workflows/impeccable/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before code | [~/.maestro/workflows/impeccable/shape.md](~/.maestro/workflows/impeccable/shape.md) |
| `teach` | Build | Set up PRODUCT.md and DESIGN.md | [~/.maestro/workflows/impeccable/teach.md](~/.maestro/workflows/impeccable/teach.md) |
| `document` | Build | Generate DESIGN.md from code | [~/.maestro/workflows/impeccable/document.md](~/.maestro/workflows/impeccable/document.md) |
| `extract [target]` | Build | Pull tokens/components into design system | [~/.maestro/workflows/impeccable/extract.md](~/.maestro/workflows/impeccable/extract.md) |
| `critique [target]` | Evaluate | UX review with heuristic scoring | [~/.maestro/workflows/impeccable/critique.md](~/.maestro/workflows/impeccable/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks | [~/.maestro/workflows/impeccable/audit.md](~/.maestro/workflows/impeccable/audit.md) |
| `polish [target]` | Refine | Final quality pass | [~/.maestro/workflows/impeccable/polish.md](~/.maestro/workflows/impeccable/polish.md) |
| `bolder [target]` | Refine | Amplify bland designs | [~/.maestro/workflows/impeccable/bolder.md](~/.maestro/workflows/impeccable/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive designs | [~/.maestro/workflows/impeccable/quieter.md](~/.maestro/workflows/impeccable/quieter.md) |
| `distill [target]` | Refine | Strip to essence | [~/.maestro/workflows/impeccable/distill.md](~/.maestro/workflows/impeccable/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [~/.maestro/workflows/impeccable/harden.md](~/.maestro/workflows/impeccable/harden.md) |
| `onboard [target]` | Refine | First-run flows, empty states | [~/.maestro/workflows/impeccable/onboard.md](~/.maestro/workflows/impeccable/onboard.md) |
| `animate [target]` | Enhance | Add purposeful motion | [~/.maestro/workflows/impeccable/animate.md](~/.maestro/workflows/impeccable/animate.md) |
| `colorize [target]` | Enhance | Add strategic color | [~/.maestro/workflows/impeccable/colorize.md](~/.maestro/workflows/impeccable/colorize.md) |
| `typeset [target]` | Enhance | Improve typography | [~/.maestro/workflows/impeccable/typeset.md](~/.maestro/workflows/impeccable/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, hierarchy | [~/.maestro/workflows/impeccable/layout.md](~/.maestro/workflows/impeccable/layout.md) |
| `delight [target]` | Enhance | Add personality | [~/.maestro/workflows/impeccable/delight.md](~/.maestro/workflows/impeccable/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [~/.maestro/workflows/impeccable/overdrive.md](~/.maestro/workflows/impeccable/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy and labels | [~/.maestro/workflows/impeccable/clarify.md](~/.maestro/workflows/impeccable/clarify.md) |
| `adapt [target]` | Fix | Adapt for devices/screens | [~/.maestro/workflows/impeccable/adapt.md](~/.maestro/workflows/impeccable/adapt.md) |
| `optimize [target]` | Fix | Fix UI performance | [~/.maestro/workflows/impeccable/optimize.md](~/.maestro/workflows/impeccable/optimize.md) |
| `live` | Iterate | Browser-based variant generation | [~/.maestro/workflows/impeccable/live.md](~/.maestro/workflows/impeccable/live.md) |

### Routing rules

1. **No argument**: render command menu grouped by category.
2. **First word matches command**: load its reference file, follow instructions. Rest is target.
3. **No match**: general design invocation with full argument as context.

## Harvest — Design Knowledge Accumulation

After every command execution (except `live`), harvest design decisions into `.workflow/knowhow/` for cross-session reuse. Skip if `--skip-harvest` flag is set.

### Harvest routing

| Command | Type | Prefix | Extract |
|---------|------|--------|---------|
| craft | decision + asset | DCS- + AST- | Design decisions + tokens (dual entry) |
| shape | decision | DCS- | Key decisions from brief |
| teach | reference | REF- | Brand/user/principles from PRODUCT.md |
| document | asset | AST- | Token system from DESIGN.md YAML |
| extract | asset | AST- | Design system patterns |
| critique | tip | TIP- | Scores + P0/P1 findings |
| audit | tip | TIP- | 5-dimension scores |
| polish | tip | TIP- | Polish points |
| bolder/quieter/distill | decision | DCS- | Direction decisions |
| harden/onboard | tip | TIP- | Patterns applied |
| animate | decision | DCS- | Animation strategy |
| colorize | decision | DCS- | Color strategy + OKLCH values |
| typeset | decision | DCS- | Typography decisions |
| layout | decision | DCS- | Layout/spacing decisions |
| delight/overdrive | decision | DCS- | Creative decisions |
| clarify/adapt/optimize | tip | TIP- | Fix points |

### Harvest execution

1. **Determine type** from routing table.
2. **Extract** from output files (document, critique) or conversation context (others).
3. **Write knowhow**:
   - DCS-/TIP-/REF- → `store_knowhow` MCP: `{operation: "add", type, title: "maestro-impeccable <cmd>: <description>", body, tags: ["impeccable", "<cmd>", ...]}`
   - AST- → Write to `.workflow/knowhow/AST-impeccable-<slug>-<YYYYMMDD>.md` with YAML frontmatter (`category: ui`)
4. **Spec index** (DCS-/AST- only): `maestro spec add ui "<title>" "<summary>" --keywords impeccable,<cmd>,... --ref knowhow/<file>`
5. **Report**: one-line summary with knowhow ID.
