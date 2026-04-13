# Command: monitor

## Purpose

Event-driven pipeline coordination with Spawn-and-Stop pattern for team-executor v2. Role names are read from `team-session.json#roles`. Workers are spawned as `team-worker` agents with role-spec paths. **handleAdapt is LIMITED**: only warns, cannot generate new role-specs. Includes `handleComplete` for pipeline completion action.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| SPAWN_MODE | background | All workers spawned via `Task(run_in_background: true)` |
| ONE_STEP_PER_INVOCATION | true | Executor does one operation then STOPS |
| FAST_ADVANCE_AWARE | true | Workers may skip executor for simple linear successors |
| ROLE_GENERATION | disabled | handleAdapt cannot generate new role-specs |
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
  +- Is this a progress update (not final)?
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

**Fast-advance note**: Check if expected next task is already `in_progress` (fast-advanced). If yes -> skip spawning, sync active_workers.

---

### Handler: handleCheck

Read-only status report. No pipeline advancement.

```
[executor] Pipeline Status
[executor] Progress: <completed>/<total> (<percent>%)

[executor] Execution Graph:
  <visual representation with status icons>

  done=completed  >>>=running  o=pending  .=not created

[executor] Active Workers:
  > <subject> (<role>) - running <elapsed>

[executor] Ready to spawn: <subjects>
[executor] Commands: 'resume' to advance | 'check' to refresh
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
      +- Is task owner an Inner Loop role AND already has active_worker?
      |   +- YES -> SKIP spawn (existing worker picks it up)
      |   +- NO -> normal spawn below
      +- TaskUpdate -> in_progress
      +- team_msg log -> task_unblocked (session_id=<session-id>)
      +- Spawn team-worker (see spawn tool call below)
      +- Add to session.active_workers
      Update session file -> output summary -> STOP
```

**Spawn worker tool call**:

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

Read role_spec file to load Phase 2-4 domain instructions.`
})
```

---

### Handler: handleComplete

Pipeline complete. Execute completion action.

```
All tasks completed (no pending, no in_progress)
  +- Generate pipeline summary (deliverables, stats, duration)
  +- Read session.completion_action:
      |
      +- "interactive":
      |   AskUserQuestion -> user choice:
      |   +- "Archive & Clean": session status="completed" -> TeamDelete -> summary
      |   +- "Keep Active": session status="paused" -> resume command
      |   +- "Export Results": copy artifacts -> Archive & Clean
      |
      +- "auto_archive": Execute Archive & Clean
      +- "auto_keep": Execute Keep Active
```

**Fallback**: If completion action fails, default to Keep Active, log warning.

---

### Handler: handleAdapt (LIMITED)

**UNLIKE team-coordinate, executor CANNOT generate new role-specs.**

```
Receive capability_gap from [<role>]
  +- Log via team_msg (type: warning)
  +- Check existing roles -> does any cover this?
  |   +- YES -> redirect to that role -> STOP
  |   +- NO -> genuine gap, report to user:
  |       "Capability gap detected. team-executor cannot generate new role-specs.
  |        Options: 1. Continue  2. Re-run team-coordinate  3. Manually add role-spec"
  +- Continue execution with existing roles
```

---

### Worker Failure Handling

1. Reset task -> pending via TaskUpdate
2. Log via team_msg (type: error)
3. Report to user: task reset, will retry on next resume

### Fast-Advance Failure Recovery

Detect orphaned tasks (in_progress without active_worker, > 5 minutes) -> reset to pending -> handleSpawnNext.

### Consensus-Blocked Handling

```
Route by severity:
  +- HIGH: Create REVISION task (max 1). Already revised -> PAUSE for user
  +- MEDIUM: Proceed with warning, log to wisdom/issues.md
  +- LOW: Proceed normally as consensus_reached with notes
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Session state consistent | active_workers matches TaskList in_progress tasks |
| No orphaned tasks | Every in_progress task has an active_worker entry |
| Dynamic roles valid | All task owners exist in session.roles |
| Completion detection | readySubjects=0 + inProgressSubjects=0 -> PIPELINE_COMPLETE |
| Fast-advance tracking | Detect fast-advanced tasks, sync to active_workers |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-run team-coordinate |
| Worker callback from unknown role | Log info, scan for other completions |
| All workers still running on resume | Report status, suggest check later |
| Pipeline stall | Check for missing tasks, report to user |
| Fast-advance conflict | Executor reconciles, no duplicate spawns |
| Role-spec file not found | Error, cannot proceed |
| capability_gap | WARN only, cannot generate new role-specs |
| Completion action fails | Default to Keep Active, log warning |
