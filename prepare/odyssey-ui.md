---
name: odyssey-ui
description: "6-dimension visual experience audit with divergent exploration — survey design context, audit visual/interaction/a11y/responsive/motion/edge dimensions, diverge for polish+delight, fix, verify, generalize"
argument-hint: "<target> [--dimensions <list>] [--skip-fix] [--skip-generalize] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: ui-audit, alias: ui-audit-session, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, role: evidence }
    - { path: outputs/understanding.md, kind: ui-audit-report, alias: ui-understanding, role: attachment }
  gates:
    exit: [all-dimensions-audited, diverge-explored, zero-remaining-verified]
refs:
  - { path: workflows/odyssey-base.md, when: Shared back-half (GENERALIZE → DISCOVER → RECORD → END) needed }
  - { path: ref/cli-supplementary.md, when: CLI-assisted survey or verification is needed }
  - { path: ref/finish-work.md, when: Entering the RECORD phase for wrap-up }
---

# Pre-task Thinking: odyssey-ui

## Purpose

Odyssey UI performs a full-lifecycle visual experience optimization cycle: survey design context → 6-dimension audit (visual hierarchy, interaction states, accessibility, responsiveness, micro-interactions, edge cases) → divergent exploration for polish and delight ideas → exhaustive fix → verify → generalize to sibling components → persist learnings. Unlike a standalone review or audit, odyssey-ui goes beyond defect fixing to explore what would make the UI delightful, then carries through to fix, verify, generalize, and persist.

## Input Interpretation

Target resolution determines what gets audited:

| Input | Resolution |
|-------|-----------|
| Component path | Audit component |
| Page/route | Audit page |
| `staged` / `HEAD` | Diff UI changes |
| Feature area | Resolve to components/pages |

The six dimensions (default all, overridable via `--dimensions`): visual_hierarchy, interaction_states, accessibility, responsiveness, micro_interactions, edge_cases. Each dimension has a distinct focus area (see Dimensions table in workflow file).

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → component hierarchy, design system structure
- Wiki: `maestro search "<target keywords>"` → prior UI audits, design decisions
- Specs: `maestro load --type spec --category ui` → design patterns, interaction specs, accessibility rules
- Coding specs: `maestro load --type spec --category coding` → component patterns, generalization patterns
- Role knowledge: `maestro search --category ui` → pick relevant items → `maestro load --type knowhow --id`
- Design system scan: scan for design tokens, CSS variables, theme imports at survey phase — these inform the audit baseline

When prior UI sessions of the same target exist, check their audit results and diverge ideas first to avoid re-auditing already-addressed dimensions.

## Boundaries and Invariants

- **Browser is truth** — the rendered visual output in the browser is the authoritative source of UI quality; code-level analysis alone is insufficient for visual/interaction judgment.
- **Diverge before converge** — the DIVERGE phase explicitly generates ideas beyond the audit defects. Polish (shadows, transitions, hover, feedback, skeleton loading) and delight (motion design, progressive disclosure, smart defaults, celebratory feedback) are separate from fixing audit findings.
- **Decision gate narrow scope** — ONLY these qualify as decisions requiring user input: brand/style direction requiring human creative judgment | layout restructuring that significantly changes user flow | requires new design tokens or breaking component API. Everything else is actionable without user escalation.
- **All dimensions mandatory** — all 6 dimensions (or `--dimensions` subset) must be audited with independent agents. Zero dimensions reviewed is BLOCKED, not a warning.
- **Priority-ordered fixing** — findings and ideas are fixed by priority tier (critical → high → medium → low + high-impact ideas). No partial-tier advancement.
- **Evidence append-only** — evidence.ndjson entries are immutable observations; modifying or deleting them is forbidden.
- **Fix scope** — source code modifications during fix phase are in-scope but MUST be committed per action. Session artifacts target `{run_dir}/outputs/` only.
- **Generalize is mandatory** unless `skip_generalize == true`; generalize source is audit findings + diverge ideas (severity >= medium OR impact = high).

## Risk Checklist

- Is every audit finding anchored to `file:line` with severity, dimension, description, and suggestion? Unanchored findings are not actionable.
- Were all 6 dimensions (or `--dimensions` subset) audited with independent agents? Missing dimensions mean incomplete coverage.
- Did the DIVERGE phase go beyond fixing defects — did it explore polish and delight opportunities separately? Diverge that only restates audit findings is insufficient.
- Are the 2 diverge agents (Polish + Delight) returning distinct categories? Overlapping outputs indicate the agents were not properly scoped.
- After consolidation, is the priority list sorted by severity × impact × effort? Unsorted lists lead to suboptimal fix ordering.
- Is every discovery hit individually classified with a reason? Blanket "pre-existing" skips are forbidden.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.
- Does the decision gate only escalate brand/style/layout/token decisions? Over-escalation slows the cycle; under-escalation risks unwanted visual changes.

## Gate Intent

- `all-dimensions-audited`: all 6 dimensions (or `--dimensions` subset) completed audit with structured findings (`[{title, severity, file, line, description, suggestion, dimension}]`), merged into severity matrix, and evidence phase=audit logged for each. Zero dimensions reviewed is BLOCKED (W002 partial coverage from agent failure is a warning, not a block).
- `diverge-explored`: both Polish and Delight agents completed, returning distinct `[{idea, category, impact, effort, description, inspiration}]` entries. CLI-assisted analysis completed. All outputs consolidated with audit findings into a prioritized list (severity × impact × effort). Evidence phase=diverge logged. Understanding.md §4 written.
- `zero-remaining-verified`: all prioritized findings and ideas are either fixed and verified, individually classified with justification (issue created / decision recorded), or legitimately skipped via `--skip-fix` flag. Tests pass (lint, unit, visual regression). Confirmation written. No unaddressed actionable findings remain. Understanding.md §5 updated. `needs_rework` routes back to FIX.
