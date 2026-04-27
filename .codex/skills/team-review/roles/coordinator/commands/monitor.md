# Monitor Pipeline

Synchronous pipeline coordination using spawn_agent + wait_agent.

## Constants

- WORKER_AGENT: team_worker
- FAST_ADVANCE_AWARE: true

## Handler Router

| Source | Handler |
|--------|---------|
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## Role-Worker Map

| Prefix | Role | Role Spec | inner_loop |
|--------|------|-----------|------------|
| SCAN-* | scanner | `<project>/.codex/skills/team-review/roles/scanner/role.md` | false |
| REV-* | reviewer | `<project>/.codex/skills/team-review/roles/reviewer/role.md` | false |
| FIX-* | fixer | `<project>/.codex/skills/team-review/roles/fixer/role.md` | true |

## handleCheck

Read-only status report from tasks.json, then STOP.

Read tasks.json + team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Count tasks by status.

**Output format**:
```
[coordinator] Review Pipeline Status — Mode: <pipeline_mode> — Progress: <completed>/<total> (<percent>%)
[coordinator] Pipeline Graph: <task_id>: <done|run|wait|deleted> <summary> (per task) — done=completed >>>=running o=pending x=deleted
[coordinator] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[coordinator] Blockers: <task_id> <role> "<blocker_summary>" <time_ago> (omit if none)
[coordinator] Ready to spawn: <subjects>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

Then STOP.

## handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against `active_agents`. Missing agents -> reset task to pending.

```
Load active_agents -> route:
  none -> handleSpawnNext
  has agents -> classify each: completed | in_progress | failed(reset to pending)
    some completed -> handleSpawnNext
    all running -> report status -> STOP
```

## handleSpawnNext

Find ready tasks, spawn workers, wait for results, process.

```
Classify tasks: completed | in_progress | deleted | ready (pending + all deps completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting, STOP
  none + nothing in_progress -> handleComplete
  has ready -> take first ready task:
    determine role from prefix (Role-Worker Map)
    set status="in_progress", log task_unblocked, spawn team_worker, add to active_agents
```

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <skillRoot>/roles/<role>/role.md
session: <session-folder> | session_id: <session-id>
requirement: <task-description> | inner_loop: <true|false>
## Current Task
task_id: <taskId> | subject: <taskSubject>
Read role_spec for Phase 2-4 instructions. Execute Phase 1 -> role Phase 2-4 -> Phase 5 (report).
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Result collection**: `wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent. Normal completion -> mark completed, close_agent (use task_name, not agentId).

**Checkpoints after completion**:
- scanner: findings_count === 0 -> delete remaining REV-*/FIX-* -> handleComplete; > 0 -> handleSpawnNext
- reviewer (full mode): autoYes -> write fix-manifest.json, fix_scope='all'; else request_user_input (Fix all / Fix critical+high only / Skip fix -> delete FIX-* -> handleComplete). Write fix_scope to meta.json.
- fixer: -> handleSpawnNext (natural completion check)

Update tasks.json, output summary, STOP.

**Cross-Agent Supplementary Context** (v4): Use `send_message` (not `followup_task`) to deliver upstream results to running downstream workers as non-interrupting supplementary context.

## handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents.

Pipeline done. All tasks completed/deleted -> read meta.json, generate summary (mode, target, findings_count, stages, fix results, deliverables). Update session pipeline_status='complete'.

Route by completion_action: interactive (Archive/Keep/Export) | auto_archive | auto_keep.

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 4 -> generate dynamic role-spec in <session>/role-specs/
4. Create new task in tasks.json, spawn worker
5. Role count >= 4 -> merge or pause

## Fast-Advance Reconciliation

On every wake: sync completed tasks and active_agents with actual state. No duplicate spawns.

## State Persistence

After every handler: reconcile active_agents with tasks.json, remove completed/deleted entries, write tasks.json, STOP.

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| 0 findings after scan | Delete remaining stages, complete pipeline |
| User declines fix | Delete FIX-* tasks, complete with review-only results |
| Pipeline stall | Check deps chains, report to user |
| Worker failure | Reset task to pending, respawn on next resume |
