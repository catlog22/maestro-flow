---
name: plan
description: Decompose confirmed analysis or requirements into an executable DAG, waves, and collision-free tasks
argument-hint: "[scope] [--gaps] [--tdd] [--revise [instructions]] [--check <plan-dir>] [-y]"
contract:
  consumes:
    - { kind: findings, alias: current-analysis, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
    - { kind: blueprint, alias: current-blueprint, required: false }
  produces:
    - { path: outputs/plan.json, kind: plan, alias: current-plan, role: primary }
    - { path: outputs/waves.json, kind: execution-waves, role: attachment }
    - { path: outputs/dependency-graph.json, kind: dependency-graph, role: evidence }
    - { path: outputs/collision-report.json, kind: collision-report, role: evidence }
refs:
  - { path: ref/boundary-grill.md, when: Task boundary / file write conflicts need arbitration }
  - { path: ref/tdd.md, when: --tdd mode, generating a RED-GREEN-REFACTOR task chain }
  - { path: ref/finish-work.md, when: Wrapping up, archiving, and extracting spec/knowhow }
gates: [context-collected, plan-generated, plan-checked, plan-confirmed]
---

# Pre-task thinking: plan

The output of plan is "task JSON an executor can follow to finish the work," not a task-list overview. Understand the input and boundaries before you start.

## Goal-shaping questions

- Where does the upstream come from? `current-analysis` (analyze's findings) takes priority; `--gaps` consumes `latest-debug`; no upstream reports E001. These aliases are injected by create — don't guess by mtime.
- How large is the scope? It determines single-agent vs 2+1 agent mode: ≤3 modules single agent (≤8 tasks); >3 modules 2+1 (2 parallel planners of ≤8 each + 1 synthesis agent, total ≤16). Module count is derived from milestone phase definitions and the analyze upstream.
- Is it a special mode? `--revise` loads an existing plan for incremental changes (skips preceding phases); `--check` is read-only validation; `--tdd` generates a test-first task chain (read ref/tdd.md). All three bypass the standard create pipeline.

## Risk checklist

- Does every task map to an acceptance/requirement ref? A task with no mapping is an out-of-scope artifact.
- Are convergence.criteria grep-verifiable? Subjective/referential phrasings like "looks correct", "properly configured", "align X with Y" are forbidden — you must write exact strings/values/command output.
- Do action and implementation contain concrete values? "Update config to match production" is bad — write the exact key/signature/import path. The executor only works from the task JSON; vague instructions produce shallow changes.
- Is read_first complete? At minimum it includes the modified files themselves + the source-of-truth files from context.
- Are there file write conflicts within the same wave? Only check `files[]` (write targets); `read_first[]` (read-only) is not a conflict. Detected conflicts must be re-arranged across waves.
- UI plan: does every delivery wave have ≥1 `[UI-observable]` convergence criterion? Vertical slices — do not split into pure-backend/pure-frontend tasks.

## Anti-splitting principles

- One feature = one task (even if it touches 3-5 files); never split by file.
- Merge simple unrelated changes into one batch task to reduce agent spawns.
- depends_on is only for real output dependencies; most tasks should be parallelizable.
- Each task should be substantial (15-60 minutes); trivial changes <5 minutes must be merged.

## Upstream reading suggestions

- With `current-analysis`: read `findings.json#decisions` — locked as inviolable constraints, free left to the implementer's discretion, deferred explicitly excluded; `findings[]` and recommendation as task-scope input. If upstream gave implementation_scope, 1 scope item → 1 task.
- With `latest-debug` (--gaps): produce one fix task per gap, with issue_id bidirectionally back-linking issues.jsonl.
- Project specs (arch category): passed in as constraint context for the planner.

## Gate selection suggestions

- `context-collected`: upstream context/exploration is loaded; no context source blocks with E001.
- `plan-generated`: plan.json + tasks are produced by the planner agent (inline planning in the main flow is FORBIDDEN).
- `plan-checked`: plan-checker passes or minor issues confirmed; boundary grill complete; pressure pass complete.
- `plan-confirmed`: artifacts are registered only after user confirmation (execute/modify/cancel).
