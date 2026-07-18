
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

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [scanner], [reviewer], [fixer] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## Role-Worker Map

| Prefix | Role | Role Spec | inner_loop |
|--------|------|-----------|------------|
| SCAN-* | scanner | `~  or <project>/.codex/skills/team-review/roles/scanner/role.md` | false |
| REV-* | reviewer | `~  or <project>/.codex/skills/team-review/roles/reviewer/role.md` | false |
| FIX-* | fixer | `~  or <project>/.codex/skills/team-review/roles/fixer/role.md` | true |

## handleCallback

Worker completed. Verify completion, check pipeline conditions, advance.

1. Parse message to identify role and task ID:

| Message Pattern | Role Detection |
|----------------|---------------|
| `[scanner]` or task ID `SCAN-*` | scanner |
| `[reviewer]` or task ID `REV-*` | reviewer |
| `[fixer]` or task ID `FIX-*` | fixer |

2. Check if progress update (inner loop) or final completion
3. Progress -> update session state, STOP
4. Completion -> mark task done via update_plan(status="completed"), remove from active_workers
5. Check for checkpoints:
   - scanner completes -> read meta.json for findings_count:
     - findings_count === 0 -> delete remaining REV-*/FIX-* tasks -> handleComplete
     - findings_count > 0 -> proceed to handleSpawnNext
   - reviewer completes AND pipeline_mode === 'full':
     - autoYes flag set -> write fix-manifest.json, set fix_scope='all' -> handleSpawnNext
     - NO autoYes -> request_user_input:
       ```
       question: "<N> findings reviewed. Proceed with fix?"
       options:
         - "Fix all": set fix_scope='all'
         - "Fix critical/high only": set fix_scope='critical,high'
         - "Skip fix": delete FIX-* tasks -> handleComplete
       ```
       Write fix_scope to meta.json, write fix-manifest.json, -> handleSpawnNext
   - fixer completes -> handleSpawnNext (checks for completion naturally)

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

Output:
```
[coordinator] Review Pipeline Status
[coordinator] Mode: <pipeline_mode>
[coordinator] Progress: <completed>/<total> (<percent>%)

[coordinator] Pipeline Graph:
  SCAN-001: <done|run|wait|deleted> <summary>
  REV-001:  <done|run|wait|deleted> <summary>
  FIX-001:  <done|run|wait|deleted> <summary>

  done=completed  >>>=running  o=pending  x=deleted

[coordinator] Active Workers: <list with elapsed time>
[coordinator] Ready to spawn: <subjects>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Then STOP.

## handleResume

1. No active workers -> handleSpawnNext
2. Has active -> check each status
   - completed -> mark done via update_plan
   - in_progress -> still running
   - other -> worker failure -> reset to pending
3. Some completed -> handleSpawnNext
4. All running -> report status, STOP

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect from list_agents():
   - completedSubjects: status = completed
   - inProgressSubjects: status = in_progress
   - deletedSubjects: status = deleted
   - readySubjects: status = pending AND all blockedBy in completedSubjects

2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> take first ready task:
   a. Determine role from prefix (use Role-Worker Map)
   b. update_plan -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <subject>", fork_turns: "none", agent_type: "team_worker" })
```

   e. Add to active_workers
5. Update session meta.json, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

1. All tasks completed or deleted (no pending, no in_progress)
2. Read final session state from meta.json
3. Generate pipeline summary: mode, target, findings_count, stages_completed, fix results (if applicable), deliverable paths
4. Update session: pipeline_status='complete', completed_at=<timestamp>
5. Read session.completion_action:
   - interactive -> request_user_input (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 4 -> generate dynamic role-spec in {run_dir}/work/team/role-specs/
4. Create new task, spawn worker
5. Role count >= 4 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns

## Phase 4: State Persistence

After every handler execution:
1. Reconcile active_workers with actual list_agents states
2. Remove entries for completed/deleted tasks
3. Write updated meta.json
4. STOP (wait for next callback)

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| 0 findings after scan | Delete remaining stages, complete pipeline |
| User declines fix | Delete FIX-* tasks, complete with review-only results |
| Pipeline stall | Check blockedBy chains, report to user |
| Worker failure | Reset task to pending, respawn on next resume |
