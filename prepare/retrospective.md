---
name: retrospective
description: Post-phase retrospective — four parallel lenses (technical/process/quality/decision) distill insights, routed to spec/knowhow/issue storage
argument-hint: "[phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [-y]"
contract:
  consumes:
    - { kind: execution, alias: current-execution, required: false }
    - { kind: verification, alias: latest-verification, required: false }
    - { kind: review-findings, alias: latest-review, required: false }
  produces:
    - { path: outputs/retrospective.json, kind: retrospective, alias: latest-retrospective, role: primary }
    - { path: outputs/retrospective.md, kind: retrospective-doc, role: attachment }
  gates:
    exit: [lenses-complete, insights-routed]
refs: []
---

# Pre-task Thinking: retrospective

## Purpose

Retrospective runs after a phase executes: four parallel lenses (technical/process/quality/decision) analyze phase artifacts → distill portable insights → route to spec/knowhow/issue storage.

## Input Interpretation

$ARGUMENTS determines the mode:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Scan (default) | no arguments | auto-scan un-retrospected phases, prompt to choose |
| Single | `<N>` | retrospect a single phase |
| Range | `<N>..<M>` | retrospect a range (inclusive) |
| All | `--all` | create a new retrospective Run for each completed phase |

Lens selection defaults to all four; a specific lens narrows analysis. Routing can be skipped to produce only retrospective files without external writes, and re-runs on completed phases are opt-in. External writes stay gated on confirmation unless auto-approved.

## Required Context

- Source phase artifacts (verification.json, review.json, plan.json, execution artifacts) are read-only inputs for lens analysis.

## Boundaries and Invariants

- **Output boundary**: all file writes must land in the phase's retrospective directory (`{run_dir}/outputs/`), `.workflow/state.json`, `.workflow/issues.jsonl`, or `.workflow/specs/` (append-only). Never modify source, verification.json, review.json, plan.json, or other existing artifacts.
1. **Source artifacts read-only** — never modify verification.json, review.json, plan.json, or any execution artifact; retrospective reads them only for analysis
2. **Stable insight ID** — insight IDs must be deterministic and stable across re-runs to prevent duplicates
3. **Routing needs confirmation** — unless `-y`, every external write (issues.jsonl, spec entries, knowhow capture) must be confirmed by the user
4. **Lens independence** — each lens agent runs independently; one lens's findings must not suppress or override another's
5. **spec append-only** — learnings.md entries are appended as `<spec-entry>` blocks; never overwrite or restructure existing entries
6. **History immutable** — never overwrite or archive a completed retrospective artifact; create a new Run

## Risk Checklist

- Are insight IDs stable across re-runs? A non-deterministic `INS-{8hex}` produces duplicate insights on every re-run.
- Are lenses genuinely independent? One lens's findings suppressing or overriding another's collapses the multi-perspective value.
- Did any external write skip confirmation? Outside `-y`, issues.jsonl / spec / knowhow writes must be user-confirmed.
- Are source artifacts untouched? Retrospective reads execution artifacts for analysis only — modifying them is forbidden.

## Gate Intent

- `lenses-complete`: every selected lens (technical/process/quality/decision) produced an independent analysis before synthesis (Stage 4→5); a missing lens result blocks or flags [LOW CONFIDENCE].
- `insights-routed`: each distilled insight has a stable `INS-{8hex}` id and a routing decision (spec/knowhow/issue or `--no-route`), with external writes user-confirmed unless `-y`.
