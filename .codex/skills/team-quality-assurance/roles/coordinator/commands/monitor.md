# Monitor Pipeline

Event-driven pipeline coordination. Beat model: coordinator wake -> process -> spawn -> STOP.

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_GC_ROUNDS: 3

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [scout], [strategist], [generator], [executor], [analyst] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Parse message to identify role and task ID:

| Message Pattern | Role Detection |
|----------------|---------------|
| `[scout]` or task ID `SCOUT-*` | scout |
| `[strategist]` or task ID `QASTRAT-*` | strategist |
| `[generator]` or task ID `QAGEN-*` | generator |
| `[executor]` or task ID `QARUN-*` | executor |
| `[analyst]` or task ID `QAANA-*` | analyst |

2. Check if progress update (inner loop) or final completion
3. Progress -> update session state, STOP
4. Completion -> mark task done (read `<session>/tasks.json`, set status to "completed", write back), remove from active_workers
5. Check for checkpoints:
   - QARUN-* completes -> read meta.json for coverage:
     - coverage >= target OR gc_rounds >= MAX_GC_ROUNDS -> proceed to handleSpawnNext
     - coverage < target AND gc_rounds < MAX_GC_ROUNDS -> create GC fix tasks, increment gc_rounds

**GC Fix Task Creation** (when coverage below target) -- add paired tasks to `<session>/tasks.json`:
- `QAGEN-fix-<round>` (owner: generator) -- fix failing tests and improve coverage using previous results
- `QARUN-gc-<round>` (owner: executor, blockedBy: [QAGEN-fix-<round>]) -- re-execute tests after fixes, measure coverage

6. -> handleSpawnNext

## handleCheck

Read-only status report, then STOP.

Read team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Aggregate per-worker milestones.

**Output format**:
```
[coordinator] QA Pipeline Status — Mode: <pipeline_mode> — Progress: <done>/<total> (<pct>%)
[coordinator] GC Rounds: <gc_rounds>/3
[coordinator] Pipeline Graph: <task_id>: <done|run|wait> <summary> (per task)
[coordinator] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[coordinator] Blockers: <task_id> <role> "<blocker_summary>" <time_ago> (omit if none)
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

Then STOP.

## handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against active_workers. Missing agents -> reset task to pending.

```
Load active_workers -> route:
  none -> handleSpawnNext
  has workers -> classify each: completed | in_progress
    some completed -> handleSpawnNext
    all running -> report status -> STOP
```

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

```
Classify tasks: completed | in_progress | ready (pending + all blockedBy completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting, STOP
  none + nothing in_progress -> handleComplete
  has ready -> for each:
    determine role from prefix (see prefix-role map below)
    skip if inner loop role already has active worker
    else: set status="in_progress", log task_unblocked, spawn team_worker, add to active_workers
  Update session, output summary, STOP
```

| Prefix | Role | inner_loop |
|--------|------|------------|
| SCOUT-* | scout | false |
| QASTRAT-* | strategist | false |
| QAGEN-* | generator | false |
| QARUN-* | executor | true |
| QAANA-* | analyst | false |

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <project>/.codex/skills/team-quality-assurance/roles/<role>/role.md
session: <session-folder> | session_id: <session-id> | team_name: quality-assurance
requirement: <task-description> | inner_loop: <true|false>
## Current Task
task_id: <task-id> | subject: <subject>
Read role_spec for Phase 2-4 instructions. Execute Phase 1 -> role Phase 2-4 -> Phase 5 (report).
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Result collection**: `wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent.

**Cross-Agent Supplementary Context** (v4): Use `send_message` (not `followup_task`) to deliver upstream results to running downstream workers as non-interrupting supplementary context.

## handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents.

Pipeline done. Verify all tasks (including GC fix/recheck) completed/deleted. Incomplete -> handleSpawnNext. All complete -> read meta.json (quality_score, coverage, gc_rounds), generate summary.

Route by completion_action: interactive (Archive/Keep/Export) | auto_archive | auto_keep.

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 6 -> generate dynamic role-spec in <session>/role-specs/
4. Add new task entry to tasks.json, spawn worker
5. Role count >= 6 -> merge or pause

## Fast-Advance Reconciliation

On every wake: sync `fast_advance` messages from team_msg into active_workers. No duplicate spawns.

## Phase 4: State Persistence

After every handler: reconcile active_workers with tasks.json, remove completed/deleted entries, write meta.json, STOP.

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| Pipeline stall (no ready, no running, has pending) | Check blockedBy chains, report to user |
| GC loop exceeded | Accept current coverage with warning, proceed |
| Scout finds 0 issues | Skip to testing mode, proceed to QASTRAT |
