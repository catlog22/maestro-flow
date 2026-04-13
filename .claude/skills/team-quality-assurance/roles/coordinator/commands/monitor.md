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
4. Completion -> mark task done via TaskUpdate(status="completed"), remove from active_workers
5. Check for checkpoints:
   - QARUN-* completes -> read meta.json for coverage:
     - coverage >= target OR gc_rounds >= MAX_GC_ROUNDS -> proceed to handleSpawnNext
     - coverage < target AND gc_rounds < MAX_GC_ROUNDS -> create GC fix tasks, increment gc_rounds

**GC Fix Task Creation** (when coverage below target):
```
TaskCreate({
  subject: "QAGEN-fix-<round>: Fix tests for <layer> (GC #<round>)",
  description: "PURPOSE: Fix failing tests and improve coverage | Success: Coverage meets target
TASK:
  - Load execution results and failing test details
  - Fix broken tests and add missing coverage
CONTEXT:
  - Session: <session-folder>
  - Layer: <layer>
  - Previous results: <session>/results/run-<layer>.json
EXPECTED: Fixed test files | Improved coverage
CONSTRAINTS: Only modify test files | No source changes
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-quality-assurance/roles/generator/role.md"
})
TaskCreate({
  subject: "QARUN-gc-<round>: Re-execute <layer> (GC #<round>)",
  description: "PURPOSE: Re-execute tests after fixes | Success: Coverage >= target
TASK: Execute test suite, measure coverage, report results
CONTEXT:
  - Session: <session-folder>
  - Layer: <layer>
EXPECTED: <session>/results/run-<layer>-gc-<round>.json
CONSTRAINTS: Read-only execution
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-quality-assurance/roles/executor/role.md"
})
TaskUpdate({ taskId: "QARUN-gc-<round>", addBlockedBy: ["QAGEN-fix-<round>"] })
```

6. -> handleSpawnNext

## handleCheck

Read-only status report, then STOP.

Output:
```
[coordinator] QA Pipeline Status
[coordinator] Mode: <pipeline_mode>
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] GC Rounds: <gc_rounds>/3

[coordinator] Pipeline Graph:
  SCOUT-001:   <done|run|wait> <summary>
  QASTRAT-001: <done|run|wait> <summary>
  QAGEN-001:   <done|run|wait> <summary>
  QARUN-001:   <done|run|wait> <summary>
  QAANA-001:   <done|run|wait> <summary>

[coordinator] Active Workers: <list with elapsed time>
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Then STOP.

## handleResume

1. No active workers -> handleSpawnNext
2. Has active -> check each status
   - completed -> mark done via TaskUpdate
   - in_progress -> still running
3. Some completed -> handleSpawnNext
4. All running -> report status, STOP

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect from TaskList():
   - completedSubjects: status = completed
   - inProgressSubjects: status = in_progress
   - readySubjects: status = pending AND all blockedBy in completedSubjects

2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Determine role from task prefix:

| Prefix | Role | inner_loop |
|--------|------|------------|
| SCOUT-* | scout | false |
| QASTRAT-* | strategist | false |
| QAGEN-* | generator | false |
| QARUN-* | executor | true |
| QAANA-* | analyst | false |

   b. Check if inner loop role with active worker -> skip (worker picks up next task)
   c. TaskUpdate -> in_progress
   d. team_msg log -> task_unblocked
   e. Spawn team-worker:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <subject>",
  team_name: "quality-assurance",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-quality-assurance/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: quality-assurance
requirement: <task-description>
inner_loop: <true|false>

## Current Task
- Task ID: <task-id>
- Task: <subject>

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

   f. Add to active_workers
5. Update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

1. Verify all tasks (including GC fix/recheck tasks) have status "completed" or "deleted"
2. If any tasks incomplete -> return to handleSpawnNext
3. If all complete:
   - Read final state from meta.json (quality_score, coverage, gc_rounds)
   - Generate summary (deliverables, stats, discussions)
4. Read session.completion_action:
   - interactive -> AskUserQuestion (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 6 -> generate dynamic role-spec in <session>/role-specs/
4. Create new task, spawn worker
5. Role count >= 6 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns

## Phase 4: State Persistence

After every handler execution:
1. Reconcile active_workers with actual TaskList states
2. Remove entries for completed/deleted tasks
3. Write updated meta.json
4. STOP (wait for next callback)

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| Pipeline stall (no ready, no running, has pending) | Check blockedBy chains, report to user |
| GC loop exceeded | Accept current coverage with warning, proceed |
| Scout finds 0 issues | Skip to testing mode, proceed to QASTRAT |
