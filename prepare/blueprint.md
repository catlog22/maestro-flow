---
name: blueprint
description: Generate a formal specification package (Product Brief, PRD, Architecture, Epics) via a 6-phase document chain
argument-hint: "<idea or @file> [-y] [-c] [--from <source>]"
contract:
  consumes:
    - { kind: context-package, alias: upstream-context, required: false }
  produces:
    - { path: outputs/product-brief.md, kind: blueprint, alias: current-blueprint, role: primary }
    - { path: outputs/blueprint-config.json, kind: blueprint-config, role: evidence }
    - { path: outputs/discovery-context.json, kind: discovery-context, role: evidence, optional: true }
    - { path: outputs/refined-requirements.json, kind: refined-requirements, role: evidence }
    - { path: outputs/glossary.json, kind: glossary, role: attachment }
    - { path: outputs/requirements/, kind: requirements-spec, role: attachment }
    - { path: outputs/architecture/, kind: architecture-spec, role: attachment }
    - { path: outputs/epics/, kind: epics-spec, role: attachment }
    - { path: outputs/readiness-report.md, kind: readiness-report, role: evidence }
    - { path: outputs/blueprint-summary.md, kind: blueprint-summary, role: attachment }
    - { path: outputs/context-package.json, kind: context-package, alias: blueprint-context, role: attachment }
  gates:
    exit: [phases-complete, readiness-passed]
refs:
  - { path: ref/interview-mechanics.md, when: Entering the depth-first menu Q&A of each phase }
  - { path: ref/finish-work.md, when: The wrap-up phase (at gate Pass/Review) }
---

# Pre-task Thinking: blueprint

## Purpose

Blueprint is a 6-phase formal spec document chain: Product Brief → PRD → Architecture → Epics. Pure document output, no code generation.

Pipeline: brainstorm (optional) → **blueprint** → analyze / roadmap / plan.

## Input Interpretation

Input is routed by its shape: direct idea text or an `@file` reference starts a fresh spec; `--from <source>` imports an upstream context package (brainstorm, `@file`, or path); `-c` resumes from the first incomplete phase using the persisted `blueprint-config.json`.

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
