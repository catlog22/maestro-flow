---
name: brainstorm
description: Multi-role brainstorming with cross-role conflict resolution, providing multi-perspective analysis before implementation
argument-hint: "[topic|role-name] [--yes] [--count N] [--session ID] [--update] [--skip-questions] [--include-questions] [--style-skill PKG] [--review-only] [--from <source>]"
contract:
  consumes: []
  produces:
    - guidance-specification.md
    - design-research.md
    - "{role}/analysis.md"
    - context-package.json
refs:
  - { path: ref/interview-mechanics.md, when: Entering the menu Q&A of interactive framework generation }
  - { path: ref/boundary-grill.md, when: The cross-role re-review detects a boundary conflict }
  - { path: ref/finish-work.md, when: The wrap-up phase (auto mode) }
gates: []
---

# Pre-task thinking

Brainstorm does multi-role brainstorming and resolves cross-role conflicts. Auto mode: guidance spec generation → parallel role analysis → cross-role re-review → resolution flowback. Single-role mode: add a single role analysis to an existing session.

Pipeline: grill (optional) → **brainstorm** → roadmap / analyze / blueprint.

## Mode determination

$ARGUMENTS determines the mode, by priority:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Review-Only | `--review-only` (requires `--session ID`) | run only cross-role re-review + resolution flowback |
| Auto | `--yes` / `-y` | full flow, no questions |
| Single Role | first non-flag argument matches a valid role name | single-role analysis |
| Phase | first non-flag argument is a number | resolve the phase directory then switch to auto |
| Interactive | text with no flags | ask the user to choose auto / single-role / re-review |

No arguments and no flags = error (missing topic/role).

## Flags

| Flag | Effect | Default |
|------|--------|---------|
| `--yes` / `-y` | Auto mode, skip interactive questions | false |
| `--count N` | number of roles to choose (max 9) | 3 |
| `--session ID` | use an existing session | — |
| `--update` | update existing analysis (single role) | false |
| `--skip-questions` | skip context-collection questions | false |
| `--include-questions` | force context collection (even if analysis already exists) | false |
| `--style-skill PKG` | style package for the ui-designer role | — |
| `--review-only` | run only cross-role re-review on existing analysis | false |
| `--from <source>` | load upstream context package (grill:ID, blueprint:ID, @file, path) | — |

## Valid roles

data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert.

## Input and boundaries

- All output is written to `{run_dir}/outputs/` (the orchestrator must first resolve to an absolute path before passing to sub-agents)
- **Output boundary**: all file writes must land in `{output_dir}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden

## Pre-load (optional, continue if missing)

1. **Architecture specs**: `maestro load --type spec --category arch` — as constraint context for multi-role analysis
2. **Role knowledge**: `maestro search --category arch` → identify relevant entries → `maestro load --type knowhow --id <id>`

## Interaction essentials

- Interaction style: **convergent menu-driven**
- Decision tree (order is flexible, user can jump): mode (auto / single-role / review-only) → role selection and `--count` → `--from` upstream source → whether to enable the design-research and DESIGN.md sub-flow
- Scope guard: make only brainstorm decisions, do not pre-resolve roadmap/plan choices
- Flowback target: guidance-specification.md §11 (create if absent)
- Additional skip conditions: `--skip-questions`, `--session` (existing session)
