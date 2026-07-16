
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
| Message contains [role-name] | handleCallback |
| "need_more_evidence" | handleIteration |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Find matching worker by role in message
2. Check if progress update (inner loop) or final completion
3. Progress -> update session state, STOP
4. Completion -> mark task done, remove from active_workers
5. Check for special conditions:
   - **TEST-001 with 0 issues** -> skip ANALYZE/FIX/VERIFY (mark as completed), handleComplete
   - **TEST-001 with only warnings** -> request_user_input: fix warnings or complete
   - **TEST-001 with high/medium issues** -> proceed to ANALYZE-001
   - ANALYZE-001 with `need_more_evidence: true` -> handleIteration
   - VERIFY-001 with `verdict: fail` -> re-dispatch FIX (create FIX-002 blocked by VERIFY-001)
   - VERIFY-001 with `verdict: pass` -> handleComplete
6. -> handleSpawnNext

## handleIteration

Analyzer needs more evidence. Create supplemental reproduction task.

1. Parse Analyzer's evidence request (dimensions, specific actions)
2. Create REPRODUCE-002 task:
   - update_plan with description from Analyzer's request
   - update_plan to set owner (no blockedBy — can start immediately)
3. Create ANALYZE-002 task:
   - update_plan + update_plan with addBlockedBy: [REPRODUCE-002]
   - update_plan FIX-001 with addBlockedBy to include ANALYZE-002
4. Update team-session.json with new tasks
5. -> handleSpawnNext

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
[coordinator] Debug Pipeline Status
[coordinator] Bug: <bug-description-summary>
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] Active: <workers with elapsed time>
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Evidence: <list of collected evidence types>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

## handleResume

1. No active workers -> handleSpawnNext
2. Has active -> check each status
   - completed -> mark done
   - in_progress -> still running
3. Some completed -> handleSpawnNext
4. All running -> report status, STOP

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check if inner loop role with active worker -> skip (worker picks up)
   b. Standard spawn:
      - update_plan -> in_progress
      - team_msg log -> task_unblocked
      - Spawn team-worker (see SKILL.md Worker Spawn Template)
      - Add to active_workers
5. Update session, output summary, STOP

## handleComplete

Pipeline done. Generate debug report and completion action.

1. Generate debug summary:
   - Bug description and reproduction results
   - Root cause analysis (from ANALYZE artifacts)
   - Code changes applied (from FIX artifacts)
   - Verification verdict (from VERIFY artifacts)
   - Evidence inventory (screenshots, logs, traces)
2. Read session.completion_action:
   - interactive -> request_user_input (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## handleAdapt

Not typically needed for debug pipeline. If Analyzer identifies a dimension not covered:

1. Parse gap description
2. Check if reproducer can cover it -> add to evidence plan
3. Create supplemental REPRODUCE task

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
