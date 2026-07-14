
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Monitor Pipeline

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [analyzer], [designer], [refactorer], [validator], [reviewer] | handleCallback |
| Message contains branch tag [refactorer-B01], etc. | handleCallback (branch-aware) |
| Message contains pipeline tag [analyzer-A], etc. | handleCallback (pipeline-aware) |
| "consensus_blocked" | handleConsensus |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Parse message to identify role, task ID, and branch/pipeline label:

| Message Pattern | Branch Detection |
|----------------|-----------------|
| `[refactorer-B01]` or task ID `REFACTOR-B01` | Branch `B01` (fan-out) |
| `[analyzer-A]` or task ID `ANALYZE-A01` | Pipeline `A` (independent) |
| `[analyzer]` or task ID `ANALYZE-001` | No branch (single) |

2. Mark task as completed: `update_goal({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state
4. **CP-2.5 check** (auto/fan-out mode only):
   - If completed task is DESIGN-001 AND parallel_mode is `auto` or `fan-out`:
   - Execute CP-2.5 Branch Creation from dispatch.md
   - After branch creation, proceed to handleSpawnNext (spawns all REFACTOR-B* in parallel)
   - STOP after spawning
5. Check stage checkpoints:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| ANALYZE-001 / ANALYZE-{P}01 | CP-1 | Notify user: architecture report ready |
| DESIGN-001 / DESIGN-{P}01 | CP-2 | Notify user: refactoring plan ready |
| DESIGN-001 (auto/fan-out) | CP-2.5 | Execute branch creation, notify with branch count |
| VALIDATE-* or REVIEW-* | CP-3 | Check verdicts per branch (see Review-Fix Cycle) |

6. Proceed to handleSpawnNext

## handleCheck

Read-only status report, then STOP.

**Worker Progress** (from message bus):

Before generating status output, read worker milestones:

```javascript
const progressMsgs = mcp__maestro__team_msg({
  operation: "list", session_id: sessionId, type: "progress", last: 50
})
const blockerMsgs = mcp__maestro__team_msg({
  operation: "list", session_id: sessionId, type: "blocker", last: 10
})

// Aggregate latest milestone per task
const taskProgress = {}
for (const msg of (progressMsgs.result?.messages || [])) {
  const tid = msg.data?.task_id
  if (tid && (!taskProgress[tid] || msg.ts > taskProgress[tid].ts)) {
    taskProgress[tid] = { phase: msg.data.phase, pct: msg.data.progress_pct, ts: msg.ts }
  }
}
```

Include in status output:
- Per-worker latest milestone (phase + progress_pct) next to task status
- Active blockers section (if any blockerMsgs found)

Output (single mode):
```
[coordinator] Pipeline Status
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] Active: <workers with elapsed time>
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Fan-out mode adds per-branch grouping. Independent mode adds per-pipeline grouping.

## handleResume

1. Audit task list: Tasks stuck in "in_progress" -> reset to "pending"
2. For fan-out/independent: check each branch/pipeline independently
3. Proceed to handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check inner_loop: parse task description `InnerLoop:` field (NOT role.md default)
      - InnerLoop: true AND same-role worker already active -> skip (worker picks up)
      - InnerLoop: false OR no active same-role worker -> spawn new worker
   b. update_goal -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker (see SKILL.md Spawn Template):
      ```
      spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none" })
      ```
   e. Add to active_workers
5. Parallel spawn rules by mode:

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| Single | Stage 4 ready | Spawn VALIDATE-001 + REVIEW-001 in parallel |
| Fan-out (CP-2.5 done) | All REFACTOR-B* unblocked | Spawn ALL REFACTOR-B* in parallel |
| Fan-out (REFACTOR-B{NN} done) | VALIDATE + REVIEW ready | Spawn both for that branch in parallel |
| Independent | Any unblocked task | Spawn all ready tasks across all pipelines in parallel |

6. Update session, output summary, STOP

## Review-Fix Cycle (CP-3)

**Per-branch/pipeline scoping**: Each branch/pipeline has its own independent fix cycle.

When both VALIDATE-* and REVIEW-* are completed for a branch/pipeline:

1. Read validation verdict from scoped meta.json namespace
2. Read review verdict from scoped meta.json namespace

| Validate Verdict | Review Verdict | Action |
|-----------------|----------------|--------|
| PASS | APPROVE | -> handleComplete check |
| PASS | REVISE | Create FIX task with review feedback |
| FAIL | APPROVE | Create FIX task with validation feedback |
| FAIL | REVISE/REJECT | Create FIX task with combined feedback |
| Any | REJECT | Create FIX task + flag for designer re-evaluation |

Fix cycle tracking per branch in session.json `fix_cycles`:
- < 3: Create FIX task, increment cycle count
- >= 3: Escalate THIS branch to user. Other branches continue

## handleComplete

Pipeline done. Generate report and completion action.

Completion check by mode:
| Mode | Completion Condition |
|------|---------------------|
| Single | All 5 tasks (+ any FIX/retry tasks) completed |
| Fan-out | ALL branches have VALIDATE + REVIEW completed (or escalated), shared stages done |
| Independent | ALL pipelines have VALIDATE + REVIEW completed (or escalated) |

1. For fan-out/independent: aggregate per-branch/pipeline results to `<session>/artifacts/aggregate-results.json`
2. If any tasks not completed, return to handleSpawnNext
3. If all completed -> transition to coordinator Phase 5

## handleConsensus

Handle consensus_blocked signals from discuss rounds.

| Severity | Action |
|----------|--------|
| HIGH | Pause pipeline (or branch), notify user with findings summary |
| MEDIUM | Create revision task for the blocked role (scoped to branch if applicable) |
| LOW | Log finding, continue pipeline |

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role-spec in <session>/role-specs/
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
