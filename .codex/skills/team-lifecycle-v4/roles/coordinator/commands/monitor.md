# Monitor Pipeline

Synchronous pipeline coordination using spawn_agent + wait_agent.

## Constants

- WORKER_AGENT: team_worker
- SUPERVISOR_AGENT: team_supervisor (resident, woken via followup_task)

## Handler Router

| Source | Handler |
|--------|---------|
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCheck

Read-only status report from tasks.json + team_msg progress, then STOP.

Read tasks.json + team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Aggregate latest milestone per task.

**Output format**:
```
[coordinator] Pipeline Status — Progress: <done>/<total> (<pct>%)
[coordinator] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[coordinator] Blockers: <count or "none"> (detail per blocker if any)
[coordinator] Completed: <list>
[coordinator] Ready: <pending with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

## handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against `active_agents`. Missing agents -> reset task to pending. Crashed supervisor (resident + no CHECKPOINT in_progress + pending CHECKPOINT exists) -> respawn with recovery: true.

```
Load active_agents -> route:
  none -> handleSpawnNext
  has agents -> health check, process completions -> handleSpawnNext
```

## handleSpawnNext

Find ready tasks, spawn workers, wait for completion, process results.

1. Read tasks.json
2. Collect: completedTasks, inProgressTasks, readyTasks (pending + all deps completed)
3. No ready + nothing in progress -> handleComplete
4. No ready + work in progress -> report waiting, STOP
5. Has ready -> separate regular tasks and CHECKPOINT tasks

### Spawn Regular Tasks

For each ready non-CHECKPOINT task:

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <skillRoot>/roles/<role>/role.md
session: <session-folder> | session_id: <session-id>
requirement: <requirement> | inner_loop: <true|false>
Read role_spec for Phase 2-4 instructions. Execute Phase 1 -> role Phase 2-4 -> Phase 5 (report).
## Task Context
task_id: <id> | title: <title> | description: <description> | pipeline_phase: <phase>
## Upstream Context
<prevContext>
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Result collection**: `wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress + blockers from team_msg, log execution trace.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent. Normal completion -> read `discoveries/{task_id}.json` for status/findings/quality_score/error. Missing file -> status="failed". Close each agent (use task_name, not agentId).

**Cross-Agent Supplementary Context** (v4): Use `send_message` (not `followup_task`) to deliver upstream results to running downstream workers as non-interrupting supplementary context.

### Handle CHECKPOINT Tasks

For each ready CHECKPOINT task:

1. Ensure supervisor in active_agents (resident: true). Not found -> spawn via SKILL.md Supervisor Spawn Template.
2. Wake supervisor via `followup_task` with checkpoint scope (dep task IDs) + pipeline progress.
3. `wait_agent` (30 min) with standard timeout escalation (STATUS_CHECK -> FINALIZE -> timed_out).
4. Read `artifacts/${task.id}-report.md`, parse verdict:
   - **pass** -> mark completed, proceed
   - **warn** -> log risks to wisdom, mark completed, proceed
   - **block** -> request_user_input: Override / Revise upstream / Abort

### Persist and Loop

Write tasks.json -> more tasks ready? -> loop handleSpawnNext. All done -> handleComplete. Blocked -> report, STOP.

## handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents (including resident supervisor).

Pipeline done. Generate summary (deliverables, stats, discussions). Route by completion_action: interactive (Archive/Keep/Export) | auto_archive | auto_keep.

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role-spec in <session>/role-specs/
4. Add new task to tasks.json, spawn worker via spawn_agent + wait_agent
5. Role count >= 5 -> merge or pause
