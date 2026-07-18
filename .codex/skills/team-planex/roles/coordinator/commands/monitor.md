
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: monitor

## Purpose

Event-driven pipeline coordination with Spawn-and-Stop pattern. Three wake-up sources: worker callbacks, user `check`, user `resume`.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| SPAWN_MODE | background | All workers spawned via `Task(run_in_background: true)` |
| ONE_STEP_PER_INVOCATION | true | Coordinator does one operation then STOPS |
| WORKER_AGENT | team-worker | All workers are team-worker agents |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session file | `{run_dir}/work/team/.msg/meta.json` | Yes |
| Task list | `list_agents()` | Yes |
| Active workers | session.active_workers[] | Yes |

## Phase 3: Handler Routing

### Wake-up Source Detection

| Priority | Condition | Handler |
|----------|-----------|---------|
| 1 | Message contains `[planner]` or `[executor]` tag | handleCallback |
| 2 | Contains "check" or "status" | handleCheck |
| 3 | Contains "resume", "continue", or "next" | handleResume |
| 4 | None of the above (initial spawn) | handleSpawnNext |

---

### Handler: handleCallback

```
Receive callback from [<role>]
  +- Match role: planner or executor
  +- Progress update (not final)?
  |   +- YES -> Update session -> STOP
  +- Task status = completed?
  |   +- YES -> remove from active_workers -> update session
  |   |   +- role = planner?
  |   |   |   +- Check for new EXEC-* tasks (planner creates them)
  |   |   |   +- -> handleSpawnNext (spawn executor for new EXEC-* tasks)
  |   |   +- role = executor?
  |   |       +- Mark issue done
  |   |       +- -> handleSpawnNext (check for more EXEC-* tasks)
  |   +- NO -> progress message -> STOP
  +- No matching worker found
      +- Scan all active workers for completed tasks
      +- Found completed -> process -> handleSpawnNext
      +- None completed -> STOP
```

---

### Handler: handleCheck

Read-only status report. No advancement.

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
[coordinator] PlanEx Pipeline Status
[coordinator] Progress: <completed>/<total> (<percent>%)

[coordinator] Task Graph:
  PLAN-001: <status-icon> <summary>
  EXEC-001: <status-icon> <issue-title>
  EXEC-002: <status-icon> <issue-title>
  ...

  done=completed  >>>=running  o=pending

[coordinator] Active Workers:
  > <subject> (<role>) - running <elapsed>

[coordinator] Ready to spawn: <subjects>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Then STOP.

---

### Handler: handleResume

```
Load active_workers
  +- No active workers -> handleSpawnNext
  +- Has active workers -> check each:
      +- completed -> mark done, log
      +- in_progress -> still running
      +- other -> worker failure -> reset to pending
      After:
        +- Some completed -> handleSpawnNext
        +- All running -> report status -> STOP
        +- All failed -> handleSpawnNext (retry)
```

---

### Handler: handleSpawnNext

```
Collect task states from list_agents()
  +- Filter tasks: PLAN-* and EXEC-* prefixes
  +- readySubjects: pending + not blocked (no blockedBy or all blockedBy completed)
  +- NONE ready + work in progress -> report waiting -> STOP
  +- NONE ready + nothing running -> PIPELINE_COMPLETE -> Phase 5
  +- HAS ready tasks -> for each:
      +- Inner Loop role AND already has active_worker for that role?
      |   +- YES -> SKIP spawn (existing worker picks up via inner loop)
      |   +- NO -> spawn below
      +- Determine role from task prefix:
      |   +- PLAN-* -> planner
      |   +- EXEC-* -> executor
      +- Spawn team-worker:
         spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <subject>", fork_turns: "none", agent_type: "team_worker" })
      +- Add to session.active_workers
      Update session -> output summary -> STOP
```

---

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Session state consistent | active_workers matches in_progress tasks |
| No orphaned tasks | Every in_progress has active_worker |
| Pipeline completeness | All expected EXEC-* tasks accounted for |

## Worker Failure Handling

1. Reset task -> pending via update_plan
2. Log via team_msg (type: error)
3. Report to user

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Unknown role callback | Log, scan for other completions |
| All workers running on resume | Report status, suggest check later |
| Pipeline stall (no ready + no running + has pending) | Check blockedBy chains, report |
