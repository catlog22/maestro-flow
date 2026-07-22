---
name: execute
description: Implement code changes following the DAG and waves of current-plan, producing implementation results and a local smoke self-check
argument-hint: "[scope] [-y] [--task TASK-ID] [--method agent|cli|auto] [--executor <tool>] [--auto-commit]"
contract:
  consumes:
    - { kind: plan, alias: current-plan, required: false }
    - { kind: review-findings, alias: latest-review, required: false }
    - { kind: fix-directions, alias: latest-fix-directions, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
    - { kind: priors, alias: session-priors, required: false }
  produces:
    - { path: outputs/execution.json, kind: execution, alias: current-execution, role: primary }
    - { path: outputs/task-results.json, kind: task-results, role: attachment }
    - { path: outputs/self-check.json, kind: self-check, role: evidence }
    - { path: outputs/change-manifest.json, kind: change-manifest, role: evidence }
  gates:
    exit: [execution-complete, self-check-passed]
refs:
  - { path: ref/finish-work.md, when: Wrapping up, archiving, and extracting incremental learnings }
---

# Pre-task Thinking: execute

## Purpose

The output of execute is "an implementation consistent with the real diff + traceable per-task evidence," not "it looks like it ran." Think through the execution boundaries and failure handling before you start.

## Degradation Routing (no plan)

When `current-plan` is absent (entry gate skipped, not failed), execute enters **degradation mode**. Assess the upstream that IS available and route:

| Available upstream | Scope | Route |
|---|---|---|
| `latest-review` (review-findings) | ≤3 findings, each ≤2 files | **Companion**: seal this run as `needs-retry` with verdict note "degraded to companion", then `/maestro-companion` with the finding list as intent |
| `latest-review` (review-findings) | >3 findings or cross-module | **Odyssey planex**: seal this run as `needs-retry`, then `/odyssey-planex` with the review findings as requirement |
| `latest-debug` (diagnosis + fix-directions) | fix-directions present | **Companion** if ≤2 files; **Odyssey planex** otherwise |
| No upstream at all | — | **Abort**: report E001 "No plan and no alternative upstream; run plan first" |

Degradation seal: `maestro run complete <run_id> --verdict needs-retry` with report.md noting the degradation reason and target command. This preserves the run record without faking a plan.

**Never fabricate a plan artifact to satisfy the gate.** The degradation path is the compliant escape.

## Input Interpretation

- When `current-plan` is present: its path is injected by create — work only from this plan. Do not step outside the waves and task scope declared in the plan to add ad-hoc work.
- When `current-plan` is absent: follow the Degradation Routing table above. Do NOT proceed to Step 1+ without a plan.
- How is the execution method decided? `--method` specifies explicitly (agent / cli / auto), or auto-routes by domain (frontend / backend / general each go to their own executor). When the user names a tool, use `--executor` — don't guess.
- `--task TASK-ID` runs only a single task; without args, execute the full DAG/waves. Already-completed tasks resume from checkpoint and are not re-executed.
- `-y` auto mode skips all interactive questions (executor choice, inter-wave confirmation, blocked prompts); non-auto mode must stop and ask the user retry / skip / abort when a wave is blocked.

## Required Context

- With `current-plan`: read waves, dependency graph, collision report, and each task's convergence.criteria as the basis for execution and self-check.
- With `session-priors` (injected by upstream): its spec / doc-index / wiki hits are already resolved from a prior run — reuse them as the coding-convention context instead of repeating the load/search. Absent priors, collect fresh below.
- Project specs (coding category): unless `session-priors` already carries the coding specs, `maestro load --type spec --category coding` is **mandatory and cannot be replaced by manual Read/Grep** — pass it to each executor as coding conventions.
- UI specs (conditional load): when a task involves frontend/UI (component/page/style/layout/CSS/HTML keywords, or focus_paths falling in a UI directory), append `--category ui`.
- The architecture doc `.workflow/codebase/ARCHITECTURE.md` and wiki search results: injected as shared context into the executor; reuse the `session-priors` copy when present, else search; may continue if missing (record a warning).

## Boundaries and Invariants

- self-check is only a build/test smoke, **not** an acceptance conclusion — formal acceptance is in a separate verify run; never overstep to issue a verdict here.
- Write only source-code changes and this run's domain artifacts; protocol state (run completion, artifact registration) is handled by the CLI — do not manually edit state.
- After each task completes, do knowledge extraction per trigger conditions: deviations → arch constraints; retry_count ≥ 2 → debug fix mode; design_rationale → learning knowhow.
- Full knowledge extraction (constraints/decisions/terminology) and archiving go uniformly through `ref/finish-work.md`; execute only does incremental learnings.
- When a task carries `issue_id`, sync the issue status after completion (all task_refs done → resolved, any failure → in_progress); in non-auto mode, confirm before writing back.

## Risk Checklist

- Are there write conflicts within the same wave? Follow task deps and the collision report — only parallelize tasks with no write conflict; conflicting ones go to different waves.
- Does each task have real evidence? Files changed, commands/tests executed, and per-criterion pass/fail must all be recorded; do not mark done based on the executor's self-report alone.
- Has a single task exhausted 3 chances? Normal execution → focused retry → degraded execution; still failing records blocked and writes a checkpoint. Never fabricate completion.
- What about downstream of a blocked task? Propagate blocked along dependencies; downstream tasks with unmet dependencies are marked `upstream_blocked` — don't pretend they can run.
- Are changes out of bounds? Write only source-code changes and this run's domain artifacts; protocol state (run completion, artifact registration) is handled by the CLI — do not manually edit state.
- Are tech-stack constraints followed? The specs' allowed_languages / disallowed_imports must be scanned once after changes; a hit is critical.

## Gate Intent

- `execution-complete`: every task in the plan reaches a terminal state (done / blocked with checkpoint); `execution.json` is written and completed tasks carry a summary + status.
- `self-check-passed`: the gate fails only when the build/test smoke was not run this round or an unhandled critical tech-stack violation (allowed_languages / disallowed_imports) remains. A self-check result of `gaps_found` does **not** block run completion — gaps are recorded as concerns in the report for the separate verify run to consume (formal acceptance lives in verify, not here).
