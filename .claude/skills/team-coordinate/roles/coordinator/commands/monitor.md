# Command: monitor

## Purpose

Event-driven pipeline coordination with Spawn-and-Stop pattern. Role names are read from `team-session.json#roles`. Workers are spawned as `team-worker` agents with role-spec paths. Includes `handleComplete` for pipeline completion action and `handleAdapt` for mid-pipeline capability gap handling.

## When to Use

| Trigger | Condition |
|---------|-----------|
| Worker callback | Message contains [role-name] from session roles |
| User command | "check", "status", "resume", "continue" |
| Capability gap | Worker reports capability_gap |
| Pipeline spawn | After dispatch, initial spawn needed |
| Pipeline complete | All tasks done |

## Strategy

- **Delegation**: Inline execution with handler routing
- **Beat model**: ONE_STEP_PER_INVOCATION — one handler then STOP
- **Workers**: Spawned as team-worker via Agent() in background

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| SPAWN_MODE | background | All workers spawned via `Task(run_in_background: true)` |
| ONE_STEP_PER_INVOCATION | true | Coordinator does one operation then STOPS |
| FAST_ADVANCE_AWARE | true | Workers may skip coordinator for simple linear successors |
| WORKER_AGENT | team-worker | All workers spawned as team-worker agents |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session file | `<session-folder>/team-session.json` | Yes |
| Task list | `TaskList()` | Yes |
| Active workers | session.active_workers[] | Yes |
| Role registry | session.roles[] | Yes |

**Dynamic role resolution**: Known worker roles are loaded from `session.roles[].name`. Role-spec paths are in `session.roles[].role_spec`.

## Phase 3: Handler Routing

### Wake-up Source Detection

Parse `$ARGUMENTS` to determine handler:

| Priority | Condition | Handler |
|----------|-----------|---------|
| 1 | Message contains `[<role-name>]` from session roles | handleCallback |
| 2 | Contains "capability_gap" | handleAdapt |
| 3 | Contains "check" or "status" | handleCheck |
| 4 | Contains "resume", "continue", or "next" | handleResume |
| 5 | Pipeline detected as complete | handleComplete |
| 6 | None of the above (initial spawn after dispatch) | handleSpawnNext |

---

### Handler: handleCallback

Worker completed a task. Verify completion, update state, auto-advance.

```
Receive callback from [<role>]
  +- Find matching active worker by role (from session.roles)
  +- Is this a progress update (not final)? (Inner Loop intermediate task completion)
  |   +- YES -> Update session state, do NOT remove from active_workers -> STOP
  +- Task status = completed?
  |   +- YES -> remove from active_workers -> update session
  |   |   +- -> handleSpawnNext
  |   +- NO -> progress message, do not advance -> STOP
  +- No matching worker found
      +- Scan all active workers for completed tasks
      +- Found completed -> process each -> handleSpawnNext
      +- None completed -> STOP
```

**Fast-advance reconciliation**: A worker may have already spawned its successor via fast-advance. When processing any callback or resume:
1. Read recent `fast_advance` messages from team_msg (type="fast_advance")
2. For each fast_advance message: add the spawned successor to `active_workers` if not already present
3. Check if the expected next task is already `in_progress` (fast-advanced)
4. If yes -> skip spawning that task (already running)
5. If no -> normal handleSpawnNext

---

### Handler: handleCheck

Read-only status report. No pipeline advancement.

**Worker Progress** (from message bus):

Before generating status output, read worker milestones:

```javascript
const progressMsgs = mcp__ccw-tools__team_msg({
  operation: "list", session_id: sessionId, type: "progress", last: 50
})
const blockerMsgs = mcp__ccw-tools__team_msg({
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

**Output format**:

```
[coordinator] Pipeline Status
[coordinator] Progress: <completed>/<total> (<percent>%)

[coordinator] Execution Graph:
  <visual representation of dependency graph with status icons>

  done=completed  >>>=running  o=pending  .=not created

[coordinator] Active Workers:
  > <subject> (<role>) - running <elapsed> [inner-loop: N/M tasks done]

[coordinator] Ready to spawn: <subjects>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Then STOP.

---

### Handler: handleResume

Check active worker completion, process results, advance pipeline.

```
Load active_workers from session
  +- No active workers -> handleSpawnNext
  +- Has active workers -> check each:
      +- status = completed -> mark done, log
      +- status = in_progress -> still running, log
      +- other status -> worker failure -> reset to pending
      After processing:
        +- Some completed -> handleSpawnNext
        +- All still running -> report status -> STOP
        +- All failed -> handleSpawnNext (retry)
```

---

### Handler: handleSpawnNext

Find all ready tasks, spawn team-worker agents in background, update session, STOP.

```
Collect task states from TaskList()
  +- completedSubjects: status = completed
  +- inProgressSubjects: status = in_progress
  +- readySubjects: pending + all blockedBy in completedSubjects

Ready tasks found?
  +- NONE + work in progress -> report waiting -> STOP
  +- NONE + nothing in progress -> PIPELINE_COMPLETE -> handleComplete
  +- HAS ready tasks -> for each:
      +- Is task owner an Inner Loop role AND that role already has an active_worker?
      |   +- YES -> SKIP spawn (existing worker will pick it up via inner loop)
      |   +- NO -> normal spawn below
      +- TaskUpdate -> in_progress
      +- team_msg log -> task_unblocked (session_id=<session-id>)
      +- Spawn team-worker (see spawn tool call below)
      +- Add to session.active_workers
      Update session file -> output summary -> STOP
```

**Spawn worker tool call** (one per ready task):

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <subject>",
  team_name: <team-name>,
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <session-folder>/role-specs/<role>.md
session: <session-folder>
session_id: <session-id>
team_name: <team-name>
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file to load Phase 2-4 domain instructions.`
})
```

---

### Handler: handleComplete

Pipeline complete. Execute completion action based on session configuration.

```
All tasks completed (no pending, no in_progress)
  +- Generate pipeline summary:
  |   - Deliverables list with paths
  |   - Pipeline stats (tasks completed, duration)
  |   - Discussion verdicts (if any)
  |
  +- Read session.completion_action:
      |
      +- "interactive":
      |   AskUserQuestion({
      |     questions: [{
      |       question: "Team pipeline complete. What would you like to do?",
      |       header: "Completion",
      |       multiSelect: false,
      |       options: [
      |         { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      |         { label: "Keep Active", description: "Keep session for follow-up work" },
      |         { label: "Export Results", description: "Export deliverables to target directory" }
      |       ]
      |     }]
      |   })
      |   +- "Archive & Clean":
      |   |   Update session status="completed"
      |   |   TeamDelete()
      |   |   Output final summary with artifact paths
      |   +- "Keep Active":
      |   |   Update session status="paused"
      |   |   Output: "Resume with: Skill(skill='team-coordinate', args='resume')"
      |   +- "Export Results":
      |       AskUserQuestion for target directory
      |       Copy deliverables to target
      |       Execute Archive & Clean flow
      |
      +- "auto_archive":
      |   Execute Archive & Clean without prompt
      |
      +- "auto_keep":
          Execute Keep Active without prompt
```

**Fallback**: If completion action fails, default to Keep Active (session status="paused"), log warning.

---

### Handler: handleAdapt

Handle mid-pipeline capability gap discovery. A worker reports `capability_gap` when it encounters work outside its scope.

**CONSTRAINT**: Maximum 5 worker roles per session. handleAdapt MUST enforce this limit.

```
Parse capability_gap message:
  +- Extract: gap_description, requesting_role, suggested_capability
  +- Validate gap is genuine:
      +- Check existing roles in session.roles -> does any role cover this?
      |   +- YES -> redirect: SendMessage to that role's owner -> STOP
      |   +- NO -> genuine gap, proceed to role-spec generation
  +- CHECK ROLE COUNT LIMIT (MAX 5 ROLES):
      +- Count current roles in session.roles
      +- If count >= 5:
          +- Attempt to merge new capability into existing role
          +- If merge NOT possible -> PAUSE, report to user
  +- Generate new role-spec:
      1. Read specs/role-spec-template.md
      2. Fill template with: frontmatter (role, prefix, inner_loop, message_types) + Phase 2-4 content
      3. Write to <session-folder>/role-specs/<new-role>.md
      4. Add to session.roles[]
  +- Create new task(s) via TaskCreate
  +- Update team-session.json
  +- Spawn new team-worker -> STOP
```

---

### Worker Failure Handling

When a worker has unexpected status (not completed, not in_progress):

1. Reset task -> pending via TaskUpdate
2. Log via team_msg (type: error)
3. Report to user: task reset, will retry on next resume

### Fast-Advance Failure Recovery

When coordinator detects a fast-advanced task has failed:

```
handleCallback / handleResume detects:
  +- Task is in_progress (was fast-advanced by predecessor)
  +- No active_worker entry for this task
  +- Resolution:
      1. TaskUpdate -> reset task to pending
      2. Remove stale active_worker entry (if any)
      3. Log via team_msg (type: error)
      4. -> handleSpawnNext (will re-spawn the task normally)
```

### Fast-Advance State Sync

On every coordinator wake (handleCallback, handleResume, handleCheck):
1. Read team_msg entries with `type="fast_advance"` since last coordinator wake
2. For each entry: sync `active_workers` with the spawned successor
3. This ensures coordinator's state reflects fast-advance decisions even before the successor's callback arrives

### Consensus-Blocked Handling

```
handleCallback receives message with consensus_blocked flag
  +- Route by severity:
      +- severity = HIGH
      |   +- Create REVISION task (same role, incremented suffix)
      |   +- Max 1 revision per task. If already revised -> PAUSE, escalate to user
      +- severity = MEDIUM
      |   +- Proceed with warning, log to wisdom/issues.md
      |   +- Normal handleSpawnNext
      +- severity = LOW
          +- Proceed normally, treat as consensus_reached with notes
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Session state consistent | active_workers matches TaskList in_progress tasks |
| No orphaned tasks | Every in_progress task has an active_worker entry |
| Dynamic roles valid | All task owners exist in session.roles |
| Completion detection | readySubjects=0 + inProgressSubjects=0 -> PIPELINE_COMPLETE |
| Fast-advance tracking | Detect tasks already in_progress via fast-advance, sync to active_workers |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| All workers still running on resume | Report status, suggest check later |
| Pipeline stall (no ready, no running) | Check for missing tasks, report to user |
| Fast-advance conflict | Coordinator reconciles, no duplicate spawns |
| Dynamic role-spec file not found | Error, coordinator must regenerate from task-analysis |
| capability_gap when role limit (5) reached | Attempt merge, else pause for user |
| Completion action fails | Default to Keep Active, log warning |
