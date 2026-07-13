

# PlanEx Pipeline Definitions

## Pipeline Diagram

Issue-based beat pipeline — planner creates EXEC-* tasks at runtime as solutions are completed.

```
PLAN-001 ──> [planner] issue-1 solution -> EXEC-001
                        issue-2 solution -> EXEC-002
                        ...
                        issue-N solution -> EXEC-00N
                        all_planned signal

EXEC-001 ──> [executor] implement issue-1
EXEC-002 ──> [executor] implement issue-2
...
EXEC-00N ──> [executor] implement issue-N
```

## Beat Cycle

Event-driven Spawn-and-Stop. Each beat = coordinator wake -> process callback -> spawn next -> STOP.

```
Event                   Coordinator              Workers
----------------------------------------------------------------------
User invokes -------> Phase 1-3:
                        Parse input
                        TeamCreate
                        Create PLAN-001
                      Phase 4:
                        spawn planner ---------> [planner] Phase 1-5
                        STOP (idle)                      |
                                                         |
callback <-- planner issue_ready -(per issue)-----------+
         handleCallback:
           detect new EXEC-* tasks
           spawn executor ---------------------> [executor] Phase 1-5
           STOP (idle)                                   |
                                                         |
callback <-- executor impl_complete ---------------------+
         handleCallback:
           mark issue done
           check next ready EXEC-*
           spawn next executor / STOP
```

## Task Metadata Registry

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| PLAN-001 | planner | (none) | Requirement decomposition: parse input, create issues, generate solutions, create EXEC-* tasks |
| EXEC-001 | executor | PLAN-001 (created at runtime by planner) | Implement solution for issue #1 |
| EXEC-002 | executor | PLAN-001 (created at runtime by planner) | Implement solution for issue #2 |
| EXEC-00N | executor | PLAN-001 (created at runtime by planner) | Implement solution for issue #N |

> EXEC-* tasks are created by planner at runtime (per-issue beat), not predefined in the task chain.

## Execution Method Selection

| Condition | Execution Method |
|-----------|-----------------|
| `--exec=codex` specified | codex |
| `--exec=agy` specified | agy |
| `-y` or `--yes` flag present | Auto (default agy) |
| No flags (interactive) | AskUserQuestion -> user choice |
| Auto + task_count <= 3 | agy |
| Auto + task_count > 3 | codex |

## Input Type Detection

| Input Pattern | Type | Action |
|--------------|------|--------|
| `ISS-\d{8}-\d{6}` pattern | Issue IDs | Use directly |
| `--text '...'` flag | Text requirement | Create issues via `ccw issue create` |
| `--plan <path>` flag | Plan file | Read file, parse phases, batch create issues |

## Checkpoints

| Trigger | Condition | Action |
|---------|-----------|--------|
| Planner complete | all_planned signal received | Wait for remaining EXEC-* executors to finish |
| Pipeline stall | No ready tasks + no running tasks + has pending | Coordinator checks blockedBy chains, escalates to user |
| Executor blocked | blocked > 2 tasks | Coordinator escalates to user |

## Scope Assessment

| Factor | Complexity |
|--------|------------|
| Issue count 1-3 | Low |
| Issue count 4-10 | Medium |
| Issue count > 10 | High |
| Cross-cutting concern | +1 level |
