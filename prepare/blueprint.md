---
name: blueprint
description: Generate a formal specification package (Product Brief, PRD, Architecture, Epics) via a 6-phase document chain
argument-hint: "<idea or @file> [-y] [-c] [--from <source>]"
contract:
  consumes: []
  produces:
    - product-brief.md
    - glossary.json
    - requirements/
    - architecture/
    - epics/
    - readiness-report.md
    - context-package.json
refs:
  - { path: ref/interview-mechanics.md, when: Entering the depth-first menu Q&A of each phase }
  - { path: ref/finish-work.md, when: The wrap-up phase (at gate Pass/Review) }
gates: []
---

# Pre-task thinking

Blueprint is a 6-phase formal spec document chain: Product Brief → PRD → Architecture → Epics. Pure document output, no code generation.

Pipeline: brainstorm (optional) → **blueprint** → analyze / roadmap / plan.

## Phase chain

```
P0: Spec Study → P1: Discovery → P1.5: Req Expansion → P2: Product Brief → P3: PRD → P4: Architecture → P5: Epics → P6: Readiness Check
```

P6 gate: Pass (≥80%) → Handoff | Review (60-79%) → Handoff w/concerns | Fail (<60%) → P6.5 Auto-Fix (max 2 rounds) → re-check.

## Flags

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode, skip interactive questions, use recommended defaults | false |
| `-c` / `--continue` | continue from the last checkpoint (read blueprint-config.json) | false |
| `--from <source>` | load upstream context package (brainstorm:ID, @file, path), consuming context-package.json | — |
| `--from-brainstorm SESSION-ID` | backward-compatible alias for `--from brainstorm:ID` | — |

## Input types

- Direct text: `"Build a real-time collaboration platform with WebSocket"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` / `--from @requirements.md` / `--from path/`
- Continuation: `-c` (resume from the first incomplete phase)

## Output boundary

All file writes must land in `.workflow/blueprint/BLP-{slug}-{date}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden.

## Pre-load (optional, continue if missing)

1. **Specs**: `maestro load --type spec --category arch` — load constraints for Phase 4 architecture decisions
2. **Wiki search**: `maestro search "{topic keywords}" --json` → prior-knowledge context

## Interaction essentials

- Interaction style: **convergent menu-driven, depth-first**
- Decision tree (strictly depth-first): scope (full product / feature set / single feature) → spec type (service / api / library / platform) → focus areas → whether to run codebase exploration → requirement priority
- Scope guard: define only the spec shape, do not pre-resolve roadmap phases or plan tasks
- Flowback target: blueprint-config.json (each decision is persisted before the next question)
