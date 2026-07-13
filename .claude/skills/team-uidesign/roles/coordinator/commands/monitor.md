
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
| Message contains [researcher], [designer], [reviewer], [implementer] | handleCallback |
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
| `[researcher]` or `RESEARCH-*` | researcher |
| `[designer]` or `DESIGN-*` | designer |
| `[reviewer]` or `AUDIT-*` | reviewer |
| `[implementer]` or `BUILD-*` | implementer |

2. Mark task completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. Check checkpoint for completed task:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| RESEARCH-001 | - | Notify user: research complete |
| DESIGN-001 (tokens) | - | Proceed to AUDIT-001 |
| AUDIT-* | QUALITY-001: Sync Point | Check audit signal -> GC loop or unblock parallel |
| BUILD-001 (tokens) | - | Check if BUILD-002 ready |
| BUILD-002 (components) | - | Check if AUDIT-003 exists (full-system) or handleComplete |

5. **Sync Point handling** (AUDIT task completed):
   Read audit signal from message: `audit_passed`, `audit_result`, or `fix_required`

   | Signal | Condition | Action |
   |--------|-----------|--------|
   | `audit_passed` | Score >= 8, critical === 0 | GC converged -> record sync_point -> unblock downstream |
   | `audit_result` | Score 6-7, no critical | gc_rounds < max -> create DESIGN-fix task |
   | `fix_required` | Score < 6 or critical > 0 | gc_rounds < max -> create DESIGN-fix task (CRITICAL) |
   | Any | gc_rounds >= max | Escalate to user |

   **GC Fix Task Creation**:
   ```
   TaskCreate({ subject: "DESIGN-fix-<round>",
     description: "PURPOSE: Address audit feedback | Success: All critical/high issues resolved
   TASK:
     - Parse audit feedback for specific issues
     - Apply targeted fixes
   CONTEXT:
     - Session: <session-folder>
     - Upstream artifacts: audit/audit-<NNN>.md" })
   TaskUpdate({ taskId: "DESIGN-fix-<round>", owner: "designer" })
   ```
   Then create new AUDIT task blocked by fix. Increment gc_state.round.

   **GC Escalation Options** (when max rounds exceeded):
   1. Accept current design - skip review, continue implementation
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
  [DONE]  RESEARCH-001 (researcher)  -> research/*.json
  [DONE]  DESIGN-001   (designer)    -> design-tokens.json
  [RUN]   AUDIT-001    (reviewer)    -> auditing tokens...
  [WAIT]  BUILD-001    (implementer) -> blocked by AUDIT-001
  [WAIT]  DESIGN-002   (designer)    -> blocked by AUDIT-001

GC Rounds: 0/2
Sync Points: 0/<expected>
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
  team_name: "uidesign",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-uidesign/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: uidesign
requirement: <task-description>
inner_loop: false

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
| component | Sequential | One task at a time |
| system | After Sync Point 1 | Spawn DESIGN-002 + BUILD-001 in parallel |
| system | After Sync Point 2 | Spawn BUILD-002 |
| full-system | After Sync Point 1 | Spawn DESIGN-002 + BUILD-001 in parallel |
| full-system | After BUILD-002 | Spawn AUDIT-003 |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

**Completion check by mode**:

| Mode | Completion Condition |
|------|---------------------|
| component | All 4 tasks (+ fix tasks) completed |
| system | All 7 tasks (+ fix tasks) completed |
| full-system | All 8 tasks (+ fix tasks) completed |

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
