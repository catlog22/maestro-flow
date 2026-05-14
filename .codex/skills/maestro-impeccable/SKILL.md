---
name: maestro-impeccable
description: Production-grade UI design with knowhow accumulation -- 24 commands + chain orchestration with quality gates + integrated design search
argument-hint: "<command|intent> [target] [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [--skip-harvest] [--skip-design-explore] [--styles <N>] [--stack <stack>] [-y] [-c]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft. Automatically harvests design knowledge to `.workflow/knowhow/` for cross-session accumulation.

## Setup

Before any design work or file edits:

1. Load context (PRODUCT.md / DESIGN.md) via the loader script.
2. Identify the register and load the matching register reference (brand.md or product.md).
3. **If the user invoked a sub-command (e.g. `craft`, `shape`, `audit`), load its reference file too.** Non-negotiable: `craft` without `craft.md` loaded means skipping the shape-and-confirm step.

Skipping these produces generic output that ignores the project.

### 1. Context gathering

Two files, case-insensitive. PRODUCT.md and DESIGN.md are stored at `.workflow/impeccable/`.

- **PRODUCT.md**: required. Users, brand, tone, anti-references, strategic principles.
- **DESIGN.md**: optional, strongly recommended. Colors, typography, elevation, components.

Both are registered in the spec system under category `ui` via `spec add`. Load with:

```bash
maestro spec load --category ui
```

This surfaces all design context (product + visual) from `.workflow/specs/ui-conventions.md`. If specs are not initialized, fall back to the legacy loader:

```bash
maestro impeccable load-context
```

Consume the full output. Never pipe through `head`, `tail`, `grep`, or `jq`.

If the output is already in this session, don't re-run. Exceptions: you just ran `teach` or `document` (they rewrite the files and re-register specs), or the user manually edited one.

`live` already warms context via `maestro impeccable live`. If you've run `live`, skip context loading.

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

All sub-command workflows: `~/.maestro/workflows/impeccable/{command}.md`

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Shape, then build end-to-end | [craft.md](~/.maestro/workflows/impeccable/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before code | [shape.md](~/.maestro/workflows/impeccable/shape.md) |
| `teach` | Build | Set up PRODUCT.md and DESIGN.md | [teach.md](~/.maestro/workflows/impeccable/teach.md) |
| `document` | Build | Generate DESIGN.md from code | [document.md](~/.maestro/workflows/impeccable/document.md) |
| `extract [target]` | Build | Pull tokens/components into design system | [extract.md](~/.maestro/workflows/impeccable/extract.md) |
| `explore [--styles N]` | Build | Multi-style comparison: generate variants, render prototypes, visual compare, select/mix | [explore.md](~/.maestro/workflows/impeccable/explore.md) |
| `critique [target]` | Evaluate | UX review with heuristic scoring | [critique.md](~/.maestro/workflows/impeccable/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks | [audit.md](~/.maestro/workflows/impeccable/audit.md) |
| `polish [target]` | Refine | Final quality pass | [polish.md](~/.maestro/workflows/impeccable/polish.md) |
| `bolder [target]` | Refine | Amplify bland designs | [bolder.md](~/.maestro/workflows/impeccable/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive designs | [quieter.md](~/.maestro/workflows/impeccable/quieter.md) |
| `distill [target]` | Refine | Strip to essence | [distill.md](~/.maestro/workflows/impeccable/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [harden.md](~/.maestro/workflows/impeccable/harden.md) |
| `onboard [target]` | Refine | First-run flows, empty states | [onboard.md](~/.maestro/workflows/impeccable/onboard.md) |
| `animate [target]` | Enhance | Add purposeful motion | [animate.md](~/.maestro/workflows/impeccable/animate.md) |
| `colorize [target]` | Enhance | Add strategic color | [colorize.md](~/.maestro/workflows/impeccable/colorize.md) |
| `typeset [target]` | Enhance | Improve typography | [typeset.md](~/.maestro/workflows/impeccable/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, hierarchy | [layout.md](~/.maestro/workflows/impeccable/layout.md) |
| `delight [target]` | Enhance | Add personality | [delight.md](~/.maestro/workflows/impeccable/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [overdrive.md](~/.maestro/workflows/impeccable/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy and labels | [clarify.md](~/.maestro/workflows/impeccable/clarify.md) |
| `adapt [target]` | Fix | Adapt for devices/screens | [adapt.md](~/.maestro/workflows/impeccable/adapt.md) |
| `optimize [target]` | Fix | Fix UI performance | [optimize.md](~/.maestro/workflows/impeccable/optimize.md) |
| `live` | Iterate | Browser-based variant generation | [live.md](~/.maestro/workflows/impeccable/live.md) |

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
| explore | decision + asset | DCS- + AST- | Style selection rationale + design tokens |
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
