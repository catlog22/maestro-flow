---
name: quick
description: Execute a small ad-hoc task through a shortened pipeline, preserving the workflow guarantees of atomic commits and state tracking
argument-hint: "[description] [--full] [--discuss] [-y]"
contract:
  consumes: []
  produces:
    - { path: outputs/plan.json, kind: plan, alias: quick-plan, role: primary }
    - { path: outputs/index.json, kind: index, role: attachment }
    - { path: "outputs/.summaries/TASK-*-summary.md", kind: task-summary, role: attachment }
    - { path: outputs/verification.json, kind: verification, role: evidence, optional: true }
  gates:
    exit: [plan-verified, tasks-committed]
refs: []
---

# Pre-task Thinking: quick

## Purpose

Quick executes a small ad-hoc task through a shortened pipeline while preserving workflow guarantees (atomic commits, state tracking). `--discuss` and `--full` enable additional phases. The state.json Run task entry is written implicitly as workflow tracking (no confirmation gate).

## Input Interpretation

$ARGUMENTS determines the execution mode:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Discuss | `--discuss` | do decision extraction before plan (gray areas → Locked/Free/Deferred classification) |
| Full | `--full` | enable plan-checking (max 2 rounds) + post-execution verification |
| Default | description only | plan → execute |

When description is empty, follow up with `AskUserQuestion`; if still empty, ask again.

## Required Context

Pre-load (all optional, continue if missing):

1. **Coding specs + tools**: `maestro load --type spec --category coding` — load coding conventions and discoverable tools, apply to implementation
2. **UI specs (conditional)**: if the task involves frontend/UI (description contains component, page, style, layout, CSS, HTML, frontend), additionally `maestro load --type spec --category ui`
3. **Role Knowledge**: browse with `maestro search --category coding`, load relevant entries with `maestro load --type knowhow --id <id1> [id2...]`

## Boundaries and Invariants

- **Precondition**: `.workflow/state.json` must exist (project initialized); quick can run mid-phase, only validating that the project exists.
- **Output boundary**: all file writes must land in `{run_dir}/outputs/` (task directory, plan.json, summaries) and the source files modified by the plan.json task definitions. The state.json scratch entry is implicit workflow tracking.
- **Atomic commit** — each task execution produces a commit containing only the files changed by that task; unrelated files are never staged.
- **Evidence-based summary** — the task summary carries concrete evidence (files changed, tests run, commands executed); "task completed successfully" is not an acceptable summary.
- **Plan before execute** — plan.json exists before any task execution; planning is never skipped, even for a single task.
- **Scratch isolation** — all workflow artifacts land in `{run_dir}/outputs/{task-dir}/`; workflow metadata is never written outside this.
- **Commit confirmation** — staged files and the commit message are shown via `AskUserQuestion` before committing (except `-y`); commits are never silent.

## Risk Checklist

- Is the commit truly atomic? Staging files unrelated to this task's plan definition pollutes the commit — stage only the task's changed files.
- Is the summary evidence-based? "task completed successfully" without concrete files/tests/commands is a hollow summary and must be rejected.
- Was planning skipped? Even a single trivial task requires plan.json before execution — never plan inline in the main flow.
- Is commit confirmation honored? Outside `-y`, staged files and message must be shown via `AskUserQuestion` before committing.

## Gate Intent

- `plan-verified`: plan.json is written before any task execution; in `--full` mode it is verified by plan-checker before execution (plan-verified gate), blocked if unverified.
- `tasks-committed`: each task produces an atomic commit of only its changed files with an evidence-based summary; outside `-y`, staged files and message are confirmed via `AskUserQuestion` before committing.
