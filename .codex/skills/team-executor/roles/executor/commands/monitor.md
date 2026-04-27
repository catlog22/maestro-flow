# Command: monitor

## Purpose

Synchronous pipeline coordination using spawn_agent + wait_agent for team-executor v2. Role names are read from `tasks.json#roles`. Workers are spawned as `team_worker` agents with role-spec paths. **handleAdapt is LIMITED**: only warns, cannot generate new role-specs. Includes `handleComplete` for pipeline completion action.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| WORKER_AGENT | team_worker | All workers spawned via spawn_agent |
| ONE_STEP_PER_INVOCATION | false | Synchronous wait loop |
| FAST_ADVANCE_AWARE | true | Workers may skip executor for simple linear successors |
| ROLE_GENERATION | disabled | handleAdapt cannot generate new role-specs |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session file | `<session-folder>/tasks.json` | Yes |
| Active agents | tasks.json active_agents | Yes |
| Role registry | tasks.json roles[] | Yes |

**Dynamic role resolution**: Known worker roles are loaded from `tasks.json roles[].name`. Role-spec paths are in `tasks.json roles[].role_spec`.

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
Match agent by role -> route:
  progress_update (not final) -> update state, keep in active_agents -> STOP
  completed -> close_agent, remove from active_agents, -> handleSpawnNext
  not_completed -> log progress -> STOP
  no_match -> scan all agents for completions -> process any found -> handleSpawnNext, else STOP
```

**Fast-advance note**: Check if expected next task is already `in_progress` (fast-advanced). If yes -> skip spawning, sync active_agents.

---

### Handler: handleCheck

Read-only status report. No pipeline advancement.

Read team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Aggregate per-worker milestones.

**Output format**:
```
[executor] Pipeline Status — Progress: <completed>/<total> (<percent>%)
[executor] Execution Graph: <dependency graph with status icons> done=completed >>>=running o=pending .=not created
[executor] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[executor] Blockers: <task_id> <role> "<blocker_summary>" <time_ago> (omit if none)
[executor] Ready to spawn: <subjects>
[executor] Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

Then STOP.

---

### Handler: handleResume

Check active agent completion, process results, advance pipeline.

```
Load active_agents -> route:
  none -> handleSpawnNext
  has agents -> classify each: completed(close_agent) | in_progress | failed(reset to pending)
    some completed -> handleSpawnNext
    all running -> report status -> STOP
    all failed -> handleSpawnNext (retry)
```

---

### Handler: handleSpawnNext

Find all ready tasks, spawn team_worker agents, wait for completion, process results.

```
Classify tasks: completed | in_progress | ready (pending + all deps completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting -> STOP
  none + nothing in_progress -> PIPELINE_COMPLETE -> handleComplete
  has ready -> for each:
    skip if Inner Loop role already has active_agent
    else: set status="in_progress", log task_unblocked, spawn team_worker, add to active_agents
```

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <session-folder>/role-specs/<role>.md
session: <session-folder> | session_id: <session-id> | team_name: <team-name>
requirement: <task-description> | inner_loop: <true|false>
Read role_spec for Phase 2-4 instructions.
## Task Context
task_id: <taskId> | title: <task-title> | description: <task-description>
## Upstream Context
<prevContext>
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

### Wait and Process Results

`wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent.

**Normal completion**: Read `discoveries/{task_id}.json` for status/findings/error. Missing file -> status="failed". Close each agent.

### Persist and Loop

Write tasks.json -> more tasks ready? -> loop handleSpawnNext. All done -> handleComplete. Blocked -> report, STOP.

---

### Handler: handleComplete

Pipeline complete. Execute completion action.

```
Generate summary: deliverables + stats + duration

Route by completion_action:
  "interactive" -> request_user_input:
    "Archive & Clean" -> rm session folder, output summary
    "Keep Active"     -> status="paused", output resume command
    "Export Results"   -> copy artifacts, then Archive & Clean
  "auto_archive" -> Archive & Clean without prompt
  "auto_keep"    -> Keep Active without prompt
```

**Fallback**: If completion action fails, default to Keep Active, log warning.

---

### Handler: handleAdapt (LIMITED)

**UNLIKE team-coordinate, executor CANNOT generate new role-specs.**

```
Log capability_gap via team_msg (type: warning)
Existing role covers gap? -> redirect -> STOP
Genuine gap -> report to user: "Options: 1. Continue  2. Re-run team-coordinate  3. Manually add role-spec"
Continue with existing roles
```

---

### Worker Failure Handling

1. Reset task -> pending in tasks.json
2. Log via team_msg (type: error)
3. Report to user: task reset, will retry on next resume

### Fast-Advance Failure Recovery

Detect orphaned tasks (in_progress without active_agents, > 5 minutes) -> reset to pending -> handleSpawnNext.

### Consensus-Blocked Handling

```
Route by consensus_blocked severity:
  HIGH   -> create REVISION task (max 1, else PAUSE + escalate)
  MEDIUM -> proceed with warning, log to wisdom/issues.md
  LOW    -> proceed normally as consensus_reached with notes
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Session state consistent | active_agents matches tasks.json in_progress tasks |
| No orphaned tasks | Every in_progress task has an active_agents entry |
| Dynamic roles valid | All task owners exist in tasks.json roles |
| Completion detection | readyTasks=0 + inProgressTasks=0 -> PIPELINE_COMPLETE |
| Fast-advance tracking | Detect fast-advanced tasks, sync to active_agents |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-run team-coordinate |
| Unknown role in callback | Log info, scan for other completions |
| All workers still running on resume | Report status, suggest check later |
| Pipeline stall | Check for missing tasks, report to user |
| Fast-advance conflict | Executor reconciles, no duplicate spawns |
| Role-spec file not found | Error, cannot proceed |
| capability_gap | WARN only, cannot generate new role-specs |
| Completion action fails | Default to Keep Active, log warning |
