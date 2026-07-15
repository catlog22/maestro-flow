---
name: brainstorm
description: Multi-role brainstorming with cross-role conflict resolution, providing multi-perspective analysis before implementation
argument-hint: "[topic|role-name] [--yes] [--count N] [--session ID] [--update] [--skip-questions] [--include-questions] [--style-skill PKG] [--review-only] [--from <source>]"
contract:
  consumes:
    - { kind: context-package, alias: upstream-context, required: false }
  produces:
    - { path: outputs/guidance-specification.md, kind: guidance, alias: current-guidance, role: primary }
    - { path: outputs/design-research.md, kind: design-research, role: attachment, optional: true }
    - { path: "outputs/{role}/analysis.md", kind: analysis, role: attachment }
    - { path: outputs/context-package.json, kind: context-package, alias: brainstorm-context, role: attachment }
  gates:
    exit: [guidance-generated, roles-converged]
refs:
  - { path: ref/interview-mechanics.md, when: Entering the menu Q&A of interactive framework generation }
  - { path: ref/boundary-grill.md, when: The cross-role re-review detects a boundary conflict }
  - { path: ref/finish-work.md, when: The wrap-up phase (auto mode) }
---

# Pre-task Thinking: brainstorm

## Purpose

Brainstorm does multi-role brainstorming and resolves cross-role conflicts. Auto mode: guidance spec generation → parallel role analysis → cross-role re-review → resolution flowback. Single-role mode: add a single role analysis to an existing session.

Pipeline: grill (optional) → **brainstorm** → roadmap / analyze / blueprint.

## Input Interpretation

$ARGUMENTS determines the mode, by priority:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Review-Only | `--review-only` (requires `--session ID`) | run only cross-role re-review + resolution flowback |
| Auto | `--yes` / `-y` | full flow, no questions |
| Single Role | first non-flag argument matches a valid role name | single-role analysis |
| Phase | first non-flag argument is a number | resolve the phase directory then switch to auto |
| Interactive | text with no flags | ask the user to choose auto / single-role / re-review |

No arguments and no flags = error (missing topic/role).

## Required Context

Pre-load (optional, continue if missing):

1. **Architecture specs**: `maestro load --type spec --category arch` — as constraint context for multi-role analysis
2. **Role knowledge**: `maestro search --category arch` → identify relevant entries → `maestro load --type knowhow --id <id>`

## Boundaries and Invariants

- All output is written to `{run_dir}/outputs/` (the orchestrator must first resolve to an absolute path before passing to sub-agents).
- **Output boundary**: all file writes must land in `{output_dir}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden.
- Scope guard: make only brainstorm decisions, do not pre-resolve roadmap/plan choices.
- Flowback target: guidance-specification.md §11 (create if absent).
- Interaction style: **convergent menu-driven**; decision tree (order is flexible, user can jump): mode (auto / single-role / review-only) → role selection and `--count` → `--from` upstream source → whether to enable the design-research and DESIGN.md sub-flow. Skip conditions: `--skip-questions`, `--session` (existing session).

## Risk Checklist

- Does the mode routing match the arguments? A misread mode (e.g. treating a role name as a topic) sends the whole run down the wrong branch.
- Are role analyses independent? Each role must produce its own analysis without one role's output suppressing another's.
- Did cross-role conflicts get resolved, not buried? Every boundary conflict surfaced in re-review must have an explicit resolution flowed back, not silently dropped.
- Is the scope confined to brainstorm decisions? Pre-resolving roadmap/plan choices is scope creep.

## Gate Intent

- `guidance-generated`: `guidance-specification.md` is written with the §10 Feature Decomposition list before parallel role analysis (guidance-generated gate); a missing spec or feature list blocks.
- `roles-converged`: all selected `{role}/analysis.md` files are verified on disk, cross-role conflicts are resolved and flowed back, and `context-package.json` exists after cross-role conflicts resolved (roles-converged gate).
