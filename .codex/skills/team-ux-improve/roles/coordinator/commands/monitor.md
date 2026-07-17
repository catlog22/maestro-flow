
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
- MAX_TEST_ITERATIONS: 5

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [scanner], [diagnoser], [designer], [implementer], [tester] | handleCallback |
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
| `[diagnoser]` or `DIAG-*` | diagnoser |
| `[designer]` or `DESIGN-*` | designer |
| `[implementer]` or `IMPL-*` | implementer |
| `[tester]` or `TEST-*` | tester |

2. Check if progress update (inner loop) or final completion
3. Progress update -> update session state, STOP
4. Completion -> mark task done:
   ```
   update_plan({ taskId: "<task-id>", status: "completed" })
   ```
5. Remove from active_workers, record completion in session

6. Check for checkpoints:
   - **TEST-001 completes** -> Validation Gate:
     Read test results from `.msg/meta.json`

     | Condition | Action |
     |-----------|--------|
     | pass_rate >= 95% | -> handleSpawnNext (pipeline likely complete) |
     | pass_rate < 95% AND iterations < max | Log warning, still -> handleSpawnNext |
     | pass_rate < 95% AND iterations >= max | Accept current state -> handleComplete |

7. -> handleSpawnNext

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
Pipeline Status (standard):
  [DONE]  SCAN-001    (scanner)     -> artifacts/scan-report.md
  [DONE]  DIAG-001    (diagnoser)   -> artifacts/diagnosis.md
  [RUN]   DESIGN-001  (designer)    -> designing solutions...
  [WAIT]  IMPL-001    (implementer) -> blocked by DESIGN-001
  [WAIT]  TEST-001    (tester)      -> blocked by IMPL-001

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

Stage-to-role mapping:
| Task Prefix | Role |
|-------------|------|
| SCAN | scanner |
| DIAG | diagnoser |
| DESIGN | designer |
| IMPL | implementer |
| TEST | tester |

Inner loop roles: implementer (inner_loop: true)
Single-task roles: scanner, diagnoser, designer, tester (inner_loop: false)

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

1. Verify all tasks (including any fix-verify iterations) have status "completed"
2. If any tasks not completed -> handleSpawnNext
3. If all completed -> transition to coordinator Phase 5

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
