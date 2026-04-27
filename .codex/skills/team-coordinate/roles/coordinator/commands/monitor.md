# Command: monitor

## Purpose

Event-driven pipeline coordination with Spawn-and-Stop pattern. Role names are read from `team-session.json#roles`. Workers are spawned as `team_worker` agents with role-spec paths. Includes `handleComplete` for pipeline completion action and `handleAdapt` for mid-pipeline capability gap handling.

## When to Use

| Trigger | Condition |
|---------|-----------|
| Worker result | Result from wait_agent contains [role-name] from session roles |
| User command | "check", "status", "resume", "continue" |
| Capability gap | Worker reports capability_gap |
| Pipeline spawn | After dispatch, initial spawn needed |
| Pipeline complete | All tasks done |

## Strategy

- **Delegation**: Inline execution with handler routing
- **Beat model**: ONE_STEP_PER_INVOCATION -- one handler then STOP
- **Workers**: Spawned as team_worker via spawn_agent

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| SPAWN_MODE | spawn_agent | All workers spawned via `spawn_agent` |
| ONE_STEP_PER_INVOCATION | true | Coordinator does one operation then STOPS |
| FAST_ADVANCE_AWARE | true | Workers may skip coordinator for simple linear successors |
| WORKER_AGENT | team_worker | All workers spawned as team_worker agents |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session file | `<session-folder>/team-session.json` | Yes |
| Task list | Read tasks.json | Yes |
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
Match worker by role -> route:
  progress_update (not final) -> update state, keep in active_workers -> STOP
  completed -> remove from active_workers, close_agent, -> handleSpawnNext
  not_completed -> log progress -> STOP
  no_match -> scan all workers for completions -> process any found -> handleSpawnNext, else STOP
```

**Fast-advance reconciliation**: On any callback/resume, sync `fast_advance` messages from team_msg into `active_workers`. Skip spawning tasks already `in_progress` via fast-advance.

---

### Handler: handleCheck

Read-only status report with progress milestones. No pipeline advancement.

1. Read tasks.json + team_msg (type="progress", last=50) + team_msg (type="blocker", last=10)
2. Aggregate latest milestone per active worker

**Output format**:

```
[coordinator] Pipeline Status
[coordinator] Progress: <completed>/<total> (<percent>%)

[coordinator] Execution Graph:
  <visual representation of dependency graph with status icons>

  done=completed  >>>=running  o=pending  .=not created

[coordinator] Active Workers:
  > <subject> (<role>) - <milestone_phase> <pct>% - running <elapsed>
  ...

[coordinator] Blockers: <count or "none">
  <task_id>: <blocker_detail>    ← only if blockers exist

[coordinator] Ready to spawn: <subjects>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

**CLI equivalent for human monitoring** (works while coordinator is blocked):
```bash
maestro agent-msg list -s "<session_id>" --type progress --last 10
maestro agent-msg list -s "<session_id>" --type blocker
```

Then STOP.

---

### Handler: handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against session `active_workers`. Any agent not actually running -> reset task to pending, remove from active_workers.

Check active worker completion, process results, advance pipeline.

```
Load active_workers -> route:
  none -> handleSpawnNext
  has workers -> classify each: completed | in_progress | failed(reset to pending)
    some completed -> handleSpawnNext
    all running -> report status -> STOP
    all failed -> handleSpawnNext (retry)
```

---

### Handler: handleSpawnNext

Find all ready tasks, spawn team_worker agents, update session, STOP.

```
Classify tasks: completed | in_progress | ready (pending + all deps completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting -> STOP
  none + nothing in_progress -> PIPELINE_COMPLETE -> handleComplete
  has ready -> for each:
    skip if Inner Loop role already has active_worker
    else: set status="in_progress", log task_unblocked, spawn team_worker, add to active_workers
  Update session -> output summary -> STOP
```

**Cross-Agent Supplementary Context** (v4): When spawning later-phase workers, use `send_message` (not `followup_task`) to deliver upstream results to already-running downstream workers as non-interrupting supplementary context.

**Spawn worker call** (one per ready task):

```
spawn_agent({ agent_type: "team_worker", task_name: taskId, message: <role-assignment> })
```

**Role assignment message template**:
```
## Role Assignment
role: <role> | role_spec: <session-folder>/role-specs/<role>.md
session: <session-folder> | session_id: <session-id> | team_name: <team-name>
requirement: <task-description> | inner_loop: <true|false>
Read role_spec for Phase 2-4 instructions.
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Result collection**: `wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent. Normal completion -> process result, close_agent (use task_name, not agentId).

---

### Handler: handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents.

Pipeline complete. Execute completion action based on session configuration.

```
Generate summary: deliverables + stats + verdicts

Route by session.completion_action:
  "interactive" -> request_user_input with options:
    "Archive & Clean" -> status="completed", cleanup, output artifact paths
    "Keep Active"     -> status="paused", output resume command
    "Export Results"   -> prompt for target dir, copy deliverables, then Archive & Clean
  "auto_archive" -> Archive & Clean without prompt
  "auto_keep"    -> Keep Active without prompt

Fallback: default to Keep Active on failure.
```

---

### Handler: handleAdapt

Handle mid-pipeline capability gap discovery. A worker reports `capability_gap` when it encounters work outside its scope.

**CONSTRAINT**: Maximum 5 worker roles per session. handleAdapt MUST enforce this limit.

```
Extract: gap_description, requesting_role, suggested_capability
Validate: existing role covers gap? -> redirect -> STOP
Enforce MAX 5 ROLES: count >= 5 -> attempt merge, else PAUSE for user
Generate role-spec from template -> write to role-specs/<new-role>.md -> add to session.roles
Create task(s) in tasks.json -> update session -> spawn team_worker -> STOP
```

---

### Worker Failure Handling

When a worker has unexpected status (not completed, not in_progress):

1. Reset task -> pending in tasks.json
2. Log via team_msg (type: error)
3. Report to user: task reset, will retry on next resume

### Fast-Advance Failure Recovery

When coordinator detects a fast-advanced task has failed:

```
Detect: task in_progress with no active_worker (stale fast-advance)
-> reset to pending, remove stale entry, log error, -> handleSpawnNext
```

### Fast-Advance State Sync

On every coordinator wake (handleCallback, handleResume, handleCheck):
1. Read team_msg entries with `type="fast_advance"` since last coordinator wake
2. For each entry: sync `active_workers` with the spawned successor
3. This ensures coordinator's state reflects fast-advance decisions even before the successor's callback arrives

### Consensus-Blocked Handling

```
Route by consensus_blocked severity:
  HIGH   -> create REVISION task (max 1 per task, else PAUSE + escalate)
  MEDIUM -> proceed with warning, log to wisdom/issues.md, -> handleSpawnNext
  LOW    -> proceed normally, treat as consensus_reached with notes
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Session state consistent | active_workers matches tasks.json in_progress tasks |
| No orphaned tasks | Every in_progress task has an active_worker entry |
| Dynamic roles valid | All task roles exist in session.roles |
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
