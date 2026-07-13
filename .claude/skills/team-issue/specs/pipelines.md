

# Pipeline Definitions — team-issue

## Available Pipelines

### Quick Pipeline (4 beats, strictly serial)

```
EXPLORE-001 → SOLVE-001 → MARSHAL-001 → BUILD-001
[explorer]    [planner]   [integrator]  [implementer]
```

Use when: 1-2 simple issues, no high-priority (priority < 4).

### Full Pipeline (5 beats, with review gate)

```
EXPLORE-001 → SOLVE-001 → AUDIT-001 ─┬─(approved/concerns)→ MARSHAL-001 → BUILD-001
[explorer]    [planner]   [reviewer]  │
                                      └─(rejected, round<2)→ SOLVE-fix-001 → AUDIT-002 → MARSHAL-001 → BUILD-001
```

Use when: 1-4 issues with high-priority, or 3-4 issues regardless of priority.

### Batch Pipeline (parallel windows)

```
[EXPLORE-001..N](parallel, max 5) → [SOLVE-001..N](sequential) → AUDIT-001 → MARSHAL-001 → [BUILD-001..M](parallel, max 3, deferred)
```

Use when: 5+ issues.

Note: BUILD tasks are created dynamically after MARSHAL completes and execution-queue.json is available.

## Task Metadata Registry

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| EXPLORE-001 | explorer | explore | (none) | Context analysis and impact assessment |
| EXPLORE-002..N | explorer | explore | (none) | Parallel exploration (Batch mode only, max 5) |
| SOLVE-001 | planner | plan | EXPLORE-001 (or all EXPLORE-*) | Solution design and task decomposition |
| SOLVE-002..N | planner | plan | all EXPLORE-* | Parallel solution design (Batch mode only) |
| AUDIT-001 | reviewer | review | SOLVE-001 (or all SOLVE-*) | Technical feasibility and risk review (Full/Batch) |
| SOLVE-fix-001 | planner | fix | AUDIT-001 | Revised solution addressing reviewer feedback |
| AUDIT-002 | reviewer | re-review | SOLVE-fix-001 | Re-review of revised solution |
| MARSHAL-001 | integrator | integrate | AUDIT-001 (or last SOLVE-* in quick) | Conflict detection and queue orchestration |
| BUILD-001 | implementer | implement | MARSHAL-001 | Code implementation and result submission |
| BUILD-002..M | implementer | implement | MARSHAL-001 | Parallel implementation (Batch, deferred creation) |

## Mode Auto-Detection

| Condition | Mode |
|-----------|------|
| User specifies `--mode=<M>` | Use specified mode |
| Issue count <= 2 AND no high-priority (priority < 4) | `quick` |
| Issue count <= 2 AND has high-priority (priority >= 4) | `full` |
| 3-4 issues | `full` |
| Issue count >= 5 | `batch` |

## Checkpoints

| Trigger | Location | Behavior |
|---------|----------|----------|
| Review gate | After AUDIT-* | approved/concerns → MARSHAL; rejected → SOLVE-fix (max 2 rounds) |
| Review loop limit | fix_cycles >= 2 | Force proceed to MARSHAL with warnings |
| Deferred BUILD creation | After MARSHAL-* (batch) | Read execution-queue.json, create BUILD tasks |
| Pipeline stall | No ready + no running | Check missing tasks, report to user |

## Completion Conditions

| Mode | Completion Condition |
|------|---------------------|
| quick | All 4 tasks completed |
| full | All 5 tasks (+ any fix cycle tasks) completed |
| batch | All N EXPLORE + N SOLVE + 1 AUDIT + 1 MARSHAL + M BUILD (+ any fix cycle tasks) completed |

## Parallel Spawn Rules

| Pipeline | Stage | Max Parallel |
|----------|-------|-------------|
| Batch | EXPLORE-001..N | min(N, 5) |
| Batch | BUILD-001..M | min(M, 3) |
| All | All other stages | 1 |

## Shared State (meta.json)

| Role | State Key |
|------|-----------| 
| explorer | `explorer` (issue_id, complexity, impact_scope, file_count) |
| planner | `planner` (issue_id, solution_id, task_count, is_revision) |
| reviewer | `reviewer` (overall_verdict, review_count, scores) |
| integrator | `integrator` (queue_size, parallel_groups, conflict_count) |
| implementer | `implementer` (issue_id, executor, test_status, review_status) |

## Message Types

| Role | Types |
|------|-------|
| coordinator | `pipeline_selected`, `review_result`, `fix_required`, `task_unblocked`, `error`, `shutdown` |
| explorer | `context_ready`, `error` |
| planner | `solution_ready`, `multi_solution`, `error` |
| reviewer | `approved`, `concerns`, `rejected`, `error` |
| integrator | `queue_ready`, `conflict_found`, `error` |
| implementer | `impl_complete`, `impl_failed`, `error` |

## Review-Fix Cycle

```
AUDIT verdict: rejected
    │
    ├─ fix_cycles < 2 → create SOLVE-fix-<N> + AUDIT-<N+1> → spawn planner → wait
    │                       ↑
    │                   (repeat if rejected again)
    │
    └─ fix_cycles >= 2 → force proceed to MARSHAL with rejection warning logged
```

## Deferred BUILD Creation (Batch Mode)

BUILD tasks are not created during initial dispatch. After MARSHAL-001 completes:
1. Read `.workflow/issues/queue/execution-queue.json`
2. Parse `parallel_groups` to determine M
3. Create BUILD-001..M tasks with `addBlockedBy: ["MARSHAL-001"]`
4. Assign owners: M <= 2 → "implementer"; M > 2 → "implementer-1".."implementer-M" (max 3)
5. Spawn implementer workers via handleSpawnNext
