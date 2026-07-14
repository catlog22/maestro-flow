---
name: quick
description: Execute a small ad-hoc task through a shortened pipeline, preserving the workflow guarantees of atomic commits and state tracking
argument-hint: "[description] [--full] [--discuss] [-y]"
contract:
  consumes: []
  produces:
    - outputs/plan.json
    - outputs/.summaries/TASK-*-summary.md
refs: []
gates: []
---

# Pre-task thinking

Quick executes a small ad-hoc task through a shortened pipeline while preserving workflow guarantees (atomic commits, state tracking). `--discuss` and `--full` enable additional phases. The state.json Run task entry is written implicitly as workflow tracking (no confirmation gate).

## Mode determination

$ARGUMENTS determines the execution mode:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Discuss | `--discuss` | do decision extraction before plan (gray areas → Locked/Free/Deferred classification) |
| Full | `--full` | enable plan-checking (max 2 rounds) + post-execution verification |
| Default | description only | plan → execute |

When description is empty, follow up with `AskUserQuestion`; if still empty, ask again.

## Flags

| Flag | Effect |
|------|--------|
| `--full` | plan-checking (max 2 iteration rounds) + post-execution verification |
| `--discuss` | pre-plan decision extraction (gray areas, Locked/Free/Deferred classification) |
| `-y` / `--yes` | Auto mode: skip commit confirmation, auto-approve state writes |
| (remaining text) | task description |

## Input and boundaries

- **Precondition**: `.workflow/state.json` must exist (project initialized); quick can run mid-phase, only validating that the project exists
- **Output boundary**: all file writes must land in `{run_dir}/outputs/` (task directory, plan.json, summaries) and the source files modified by the plan.json task definitions. The state.json scratch entry is implicit workflow tracking

## Pre-load (all optional, continue if missing)

1. **Coding specs + tools**: `maestro load --type spec --category coding` — load coding conventions and discoverable tools, apply to implementation
2. **UI specs (conditional)**: if the task involves frontend/UI (description contains component, page, style, layout, CSS, HTML, frontend), additionally `maestro load --type spec --category ui`
3. **Role Knowledge**: browse with `maestro search --category coding`, load relevant entries with `maestro load --type knowhow --id <id1> [id2...]`

## Invariants

1. **Atomic commit** — each task execution must produce a commit containing only the files changed by that task; never stage unrelated files
2. **Evidence-based summary** — the task summary must contain concrete evidence (files changed, tests run, commands executed); never accept "task completed successfully" as a summary
3. **Plan before execute** — plan.json must be written before any task execution; do not skip planning even for a single task
4. **Scratch isolation** — all workflow artifacts must land in `{run_dir}/outputs/{task-dir}/`; never write workflow metadata outside this
5. **Commit confirmation** — before committing, staged files and the commit message must be shown via `AskUserQuestion` (except `-y`); never commit silently
