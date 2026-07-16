
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Monitor

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_GC_ROUNDS: 2

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [analyst], [architect], [developer], [qa] | handleCallback |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session state | <session>/session.json | Yes |
| Task list | list_agents() | Yes |
| Trigger event | From Entry Router detection | Yes |
| Pipeline definition | From SKILL.md | Yes |

1. Load session.json for current state, `pipeline_mode`, `gc_rounds`
2. Run list_agents() to get current task statuses
3. Identify trigger event type from Entry Router

## Phase 3: Event Handlers

### handleCallback

Triggered when a worker sends completion message.

1. Parse message to identify role and task ID:

| Message Pattern | Role Detection |
|----------------|---------------|
| `[analyst]` or task ID `ANALYZE-*` | analyst |
| `[architect]` or task ID `ARCH-*` | architect |
| `[developer]` or task ID `DEV-*` | developer |
| `[qa]` or task ID `QA-*` | qa |

2. Mark task as completed:

```
update_plan({ taskId: "<task-id>", status: "completed" })
```

3. Record completion in session state

4. Check if checkpoint applies:

| Completed Task | Pipeline Mode | Checkpoint Action |
|---------------|---------------|-------------------|
| ANALYZE-001 | all | Log: analysis ready |
| ARCH-001 | feature/system | Log: architecture ready for review |
| QA-001 (arch review) | feature/system | Gate: pause if critical issues, wait for architect revision |
| QA-* (code review) | all | Check verdict for GC loop (see below) |

5. **GC Loop Check** (when QA completes with fix_required):

| Condition | Action |
|-----------|--------|
| QA verdict = PASSED or PASSED_WITH_WARNINGS | Proceed to handleSpawnNext |
| QA verdict = FIX_REQUIRED AND gc_round < 2 | Create DEV-fix + QA-recheck tasks, increment gc_round |
| QA verdict = FIX_REQUIRED AND gc_round >= 2 | Escalate to user: accept current state or manual intervention |

**GC Fix Task Creation**:
```
update_plan({
  subject: "DEV-fix-<round>",
  description: "PURPOSE: Fix issues identified in QA audit | Success: All critical/high issues resolved
TASK:
  - Load QA audit report with findings
  - Address critical and high severity issues
  - Re-validate fixes against coding standards
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: <session>/qa/audit-<NNN>.md
  - Shared memory: <session>/.msg/meta.json
EXPECTED: Fixed source files | QA issues resolved
CONSTRAINTS: Targeted fixes only | Do not introduce regressions"
})
update_plan({ taskId: "DEV-fix-<round>", owner: "developer" })

update_plan({
  subject: "QA-recheck-<round>",
  description: "PURPOSE: Re-audit after developer fixes | Success: Score >= 8, critical == 0
TASK:
  - Execute 5-dimension audit on fixed code
  - Focus on previously flagged issues
  - Calculate new score
CONTEXT:
  - Session: <session-folder>
  - Review type: code-review
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/qa/audit-<NNN>.md | Improved score
CONSTRAINTS: Read-only review"
})
update_plan({ taskId: "QA-recheck-<round>", addBlockedBy: ["DEV-fix-<round>"], owner: "qa" })
```

6. Proceed to handleSpawnNext

### handleSpawnNext

Find and spawn the next ready tasks.

1. Scan task list for tasks where:
   - Status is "pending"
   - All blockedBy tasks have status "completed"

2. For each ready task, spawn team-worker:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none", agent_type: "team_worker" })
```

3. **Parallel spawn rules**:

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| page | Each stage sequential | One worker at a time |
| feature | After QA-001 arch review | Spawn DEV-001 |
| system | After QA-001 arch review | Spawn ARCH-002 + DEV-001 in parallel |

4. STOP after spawning -- wait for next callback

### handleCheck

Output current pipeline status.

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
Pipeline Status (<mode> mode):
  [DONE]  ANALYZE-001  (analyst)    -> design-intelligence.json
  [DONE]  ARCH-001     (architect)  -> design-tokens.json
  [RUN]   DEV-001      (developer)  -> implementing...
  [WAIT]  QA-001       (qa)         -> blocked by DEV-001

GC Rounds: 0/2
Session: <session-id>
```

Output status -- do NOT advance pipeline.

### handleResume

Resume pipeline after user pause or interruption.

1. Audit task list for inconsistencies:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. Proceed to handleSpawnNext

### handleComplete

Triggered when all pipeline tasks are completed.

**Completion check**:

| Mode | Completion Condition |
|------|---------------------|
| page | All 4 tasks (+ any GC fix/recheck tasks) completed |
| feature | All 5 tasks (+ any GC fix/recheck tasks) completed |
| system | All 7 tasks (+ any GC fix/recheck tasks) completed |

1. If any tasks not completed, return to handleSpawnNext
2. If all completed, transition to coordinator Phase 5

## Phase 4: State Persistence

After every handler execution:

1. Update session.json with current state (active tasks, gc_rounds, last event)
2. Verify task list consistency
3. STOP and wait for next event
