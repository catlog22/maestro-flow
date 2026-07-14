---
name: blueprint
description: Generate a formal specification package (Product Brief, PRD, Architecture, Epics) via a 6-phase document chain
argument-hint: "<idea or @file> [-y] [-c] [--from <source>]"
contract:
  consumes:
    - { kind: context-package, alias: upstream-context, required: false }
  produces:
    - { path: product-brief.md, kind: blueprint, alias: current-blueprint, role: primary }
    - { path: blueprint-config.json, kind: blueprint-config, role: evidence }
    - { path: discovery-context.json, kind: discovery-context, role: evidence, optional: true }
    - { path: refined-requirements.json, kind: refined-requirements, role: evidence }
    - { path: glossary.json, kind: glossary, role: attachment }
    - { path: requirements/, kind: requirements-spec, role: attachment }
    - { path: architecture/, kind: architecture-spec, role: attachment }
    - { path: epics/, kind: epics-spec, role: attachment }
    - { path: readiness-report.md, kind: readiness-report, role: evidence }
    - { path: blueprint-summary.md, kind: blueprint-summary, role: attachment }
    - { path: context-package.json, kind: context-package, alias: blueprint-context, role: attachment }
refs:
  - { path: ref/interview-mechanics.md, when: Entering the depth-first menu Q&A of each phase }
  - { path: ref/finish-work.md, when: The wrap-up phase (at gate Pass/Review) }
gates: [phases-complete, readiness-passed]
---

# Pre-task Thinking: blueprint

## Purpose

Blueprint is a 6-phase formal spec document chain: Product Brief → PRD → Architecture → Epics. Pure document output, no code generation.

Pipeline: brainstorm (optional) → **blueprint** → analyze / roadmap / plan.

The internal document chain:

```
P0: Spec Study → P1: Discovery → P1.5: Req Expansion → P2: Product Brief → P3: PRD → P4: Architecture → P5: Epics → P6: Readiness Check
```

P6 gate: Pass (≥80%) → Handoff | Review (60-79%) → Handoff w/concerns | Fail (<60%) → P6.5 Auto-Fix (max 2 rounds) → re-check.

## Input Interpretation

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode, skip interactive questions, use recommended defaults | false |
| `-c` / `--continue` | continue from the last checkpoint (read blueprint-config.json) | false |
| `--from <source>` | load upstream context package (brainstorm:ID, @file, path), consuming context-package.json | — |
| `--from-brainstorm SESSION-ID` | backward-compatible alias for `--from brainstorm:ID` | — |

Input types:

- Direct text: `"Build a real-time collaboration platform with WebSocket"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` / `--from @requirements.md` / `--from path/`
- Continuation: `-c` (resume from the first incomplete phase)

## Required Context

Pre-load (optional, continue if missing):

1. **Specs**: `maestro load --type spec --category arch` — load constraints for Phase 4 architecture decisions
2. **Wiki search**: `maestro search "{topic keywords}" --json` → prior-knowledge context

## Boundaries and Invariants

- All file writes must land in `.workflow/blueprint/BLP-{slug}-{date}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden.
- Scope guard: define only the spec shape, do not pre-resolve roadmap phases or plan tasks.
- Flowback target: blueprint-config.json (each decision is persisted before the next question).
- Interaction style: **convergent menu-driven, depth-first**; decision tree strictly depth-first: scope (full product / feature set / single feature) → spec type (service / api / library / platform) → focus areas → whether to run codebase exploration → requirement priority.

## Risk Checklist

- Is the scope over-reaching? Blueprint defines spec shape only — pre-resolving roadmap phases or plan tasks is scope creep.
- Is each decision persisted before advancing? blueprint-config.json must record every answer before the next question, so `-c` can resume correctly.
- Did the readiness check pass on real evidence? The P6 score must reflect actual document completeness, not an optimistic estimate.

## Gate Intent

- `phases-complete`: the document chain advances only when each phase's artifact exists — `product-brief.md` (with ≥5 glossary terms) before PRD (P2→P3), and `requirements/_index.md` (with MoSCoW table) before architecture (P3→P4).
- `readiness-passed`: the P6 readiness check gates handoff — Pass (≥80%) hands off, Review (60-79%) hands off with concerns, Fail (<60%) enters P6.5 Auto-Fix (max 2 rounds) then re-checks.
