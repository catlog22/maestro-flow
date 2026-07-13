
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
| Message contains [color-auditor], [typo-auditor], [focus-auditor], [remediation-planner], [fix-implementer] | handleCallback |
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
| `[color-auditor]` or `COLOR-*` | color-auditor |
| `[typo-auditor]` or `TYPO-*` | typo-auditor |
| `[focus-auditor]` or `FOCUS-*` | focus-auditor |
| `[remediation-planner]` or `REMED-*` | remediation-planner |
| `[fix-implementer]` or `FIX-*` | fix-implementer |

2. Mark task completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. Check checkpoint for completed task:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| COLOR-001 | Parallel fan-in | Check if all 3 audits complete -> unblock REMED-001 |
| TYPO-001 | Parallel fan-in | Check if all 3 audits complete -> unblock REMED-001 |
| FOCUS-001 | Parallel fan-in | Check if all 3 audits complete -> unblock REMED-001 |
| REMED-001 | -- | Unblock FIX-001 (full mode only) |
| FIX-001 | GC check | Spawn COLOR-002 + FOCUS-002 in parallel (full mode) |
| COLOR-002 | Re-audit fan-in | Check if both re-audits complete -> handleComplete |
| FOCUS-002 | Re-audit fan-in | Check if both re-audits complete -> handleComplete |

5. **Parallel fan-in handling** (audit task completed):

   **CRITICAL**: REMED-001 must wait for ALL 3 auditors (COLOR-001 + TYPO-001 + FOCUS-001) to complete.

   Check completion state:
   ```
   completed_audits = count of completed tasks in [COLOR-001, TYPO-001, FOCUS-001]
   if completed_audits < 3:
     -> Log "[coordinator] Audit fan-in: {completed_audits}/3 complete, waiting for remaining"
     -> STOP (do NOT advance)
   if completed_audits === 3:
     -> Log "[coordinator] All 3 audits complete, advancing to REMED-001"
     -> handleSpawnNext (will pick up REMED-001)
   ```

6. **GC loop handling** (full mode, after FIX-001 completes):

   Read re-audit results when COLOR-002 and FOCUS-002 both complete:

   | Signal | Condition | Action |
   |--------|-----------|--------|
   | All pass | No critical/high issues remaining | GC converged -> handleComplete |
   | Issues remain | Critical/high issues found | gc_rounds < max -> create FIX-002 + re-audit tasks |
   | Any | gc_rounds >= max | Escalate to user |

   **GC Fix Task Creation** (when re-audit finds issues):
   ```
   TaskCreate({ subject: "FIX-002",
     description: "PURPOSE: Address remaining issues from re-audit | Success: All critical/high issues resolved
   TASK:
     - Parse re-audit reports for remaining issues
     - Apply targeted fixes for color and focus issues
   CONTEXT:
     - Session: <session-folder>
     - Upstream artifacts: re-audit/color-audit-002.md, re-audit/focus-audit-002.md" })
   TaskUpdate({ taskId: "FIX-002", addBlockedBy: ["COLOR-002", "FOCUS-002"], owner: "fix-implementer" })
   ```
   Then create new re-audit tasks blocked by FIX-002. Increment gc_state.round.

   **GC Escalation Options** (when max rounds exceeded):
   1. Accept current state - acknowledge remaining issues
   2. Try one more round
   3. Terminate

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
Pipeline Status (<pipeline-mode>):
  [DONE]  COLOR-001 (color-auditor)        -> audits/color/color-audit-001.md
  [DONE]  TYPO-001  (typo-auditor)         -> audits/typography/typo-audit-001.md
  [RUN]   FOCUS-001 (focus-auditor)        -> auditing focus...
  [WAIT]  REMED-001 (remediation-planner)  -> blocked by COLOR-001, TYPO-001, FOCUS-001
  [WAIT]  FIX-001   (fix-implementer)      -> blocked by REMED-001
  [WAIT]  COLOR-002 (color-auditor)        -> blocked by FIX-001
  [WAIT]  FOCUS-002 (focus-auditor)        -> blocked by FIX-001

Fan-in: 2/3 audits complete
GC Rounds: 0/2
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
   b. TaskUpdate -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "visual-a11y",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: visual-a11y
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

**Parallel spawn rules by mode**:

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| audit-only | Initial | Spawn COLOR-001 + TYPO-001 + FOCUS-001 in parallel |
| audit-only | After 3 audits complete | Spawn REMED-001 |
| full | Initial | Spawn COLOR-001 + TYPO-001 + FOCUS-001 in parallel |
| full | After 3 audits complete | Spawn REMED-001 |
| full | After REMED-001 | Spawn FIX-001 |
| full | After FIX-001 | Spawn COLOR-002 + FOCUS-002 in parallel |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

**Completion check by mode**:

| Mode | Completion Condition |
|------|---------------------|
| audit-only | All 4 tasks (+ any fix tasks) completed |
| full | All 7 tasks (+ any GC fix tasks) completed |

1. If any tasks not completed -> handleSpawnNext
2. If all completed -> transition to coordinator Phase 5

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 6 -> generate dynamic role spec
4. Create new task, spawn worker
5. Role count >= 6 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
