
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Monitor Pipeline

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_GC_ROUNDS: 2

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [scanner], [diagnostician], [optimizer], [verifier] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Parse message to identify role and task ID:

| Message Pattern | Role |
|----------------|------|
| `[scanner]` or `SCAN-*` | scanner |
| `[diagnostician]` or `DIAG-*` | diagnostician |
| `[optimizer]` or `OPT-*` | optimizer |
| `[verifier]` or `VERIFY-*` | verifier |

2. Mark task completed: `update_plan({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. Check checkpoint for completed task:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| SCAN-001 | - | Notify user: scan complete, proceed to diagnosis |
| DIAG-001 | - | Check pipeline mode: scan-only -> handleComplete, else proceed to OPT |
| OPT-001 / OPT-fix-* | - | Proceed to VERIFY |
| VERIFY-001 / VERIFY-* | GC Checkpoint | Check verify signal -> GC loop or handleComplete |

5. **GC Checkpoint handling** (VERIFY task completed):
   Read verify signal from message: `verify_passed`, `verify_failed`, or `fix_required`

   | Signal | Condition | Action |
   |--------|-----------|--------|
   | `verify_passed` | No regressions, score_delta >= 0 | GC converged -> handleComplete |
   | `verify_failed` | Regressions found but non-critical | gc_rounds < max -> create OPT-fix task |
   | `fix_required` | Score dropped or critical regressions | gc_rounds < max -> create OPT-fix task (CRITICAL) |
   | Any | gc_rounds >= max | Escalate to user |

   **GC Fix Task Creation**:
   ```
   update_plan({ subject: "OPT-fix-<round>",
     description: "PURPOSE: Address verification regressions | Success: All regressions resolved
   TASK:
     - Parse verification feedback for specific regressions
     - Apply targeted fixes for regression issues only
   CONTEXT:
     - Session: <session-folder>
     - Upstream artifacts: verification/verify-report.md" })
   update_plan({ taskId: "OPT-fix-<round>", owner: "optimizer" })
   ```
   Then create new VERIFY task blocked by OPT-fix. Increment gc_state.round.

   **GC Escalation Options** (when max rounds exceeded):
   1. Accept current state - skip further fixes, complete pipeline
   2. Try one more round
   3. Terminate

6. -> handleSpawnNext

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

```
Pipeline Status (<pipeline-mode>):
  [DONE]  SCAN-001     (scanner)        -> scan-report.md
  [DONE]  DIAG-001     (diagnostician)  -> diagnosis-report.md
  [RUN]   OPT-001      (optimizer)      -> applying fixes...
  [WAIT]  VERIFY-001   (verifier)       -> blocked by OPT-001

GC Rounds: 0/2
Score: <before-score>/32 -> pending
Session: <session-id>
Commands: 'resume' to advance | 'check' to refresh
```

Output status -- do NOT advance pipeline.

## handleResume

1. Audit task list for inconsistencies:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. -> handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects (pending + all blockedBy completed)
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check inner loop role with active worker -> skip (worker picks up)
   b. update_plan -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none", agent_type: "team_worker" })
```

**Spawn rules by mode**:

| Mode | Behavior |
|------|----------|
| scan-only | Sequential: SCAN-001 -> DIAG-001 |
| targeted | Sequential: SCAN -> DIAG -> OPT -> VERIFY |
| full | Sequential: SCAN -> DIAG -> OPT -> VERIFY, then GC loop if needed |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

**Completion check by mode**:

| Mode | Completion Condition |
|------|---------------------|
| scan-only | SCAN-001 + DIAG-001 completed |
| targeted | All 4 tasks (+ any fix tasks) completed |
| full | All 4 tasks (+ any fix tasks) completed |

1. If any tasks not completed -> handleSpawnNext
2. If all completed -> transition to coordinator Phase 5

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role spec
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
