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
| Message contains [strategist], [generator], [executor], [analyst] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## Role-Worker Map

| Prefix | Role | Role Spec | inner_loop |
|--------|------|-----------|------------|
| STRATEGY-* | strategist | `~  or <project>/.claude/skills/team-testing/roles/strategist/role.md` | false |
| TESTGEN-* | generator | `~  or <project>/.claude/skills/team-testing/roles/generator/role.md` | true |
| TESTRUN-* | executor | `~  or <project>/.claude/skills/team-testing/roles/executor/role.md` | true |
| TESTANA-* | analyst | `~  or <project>/.claude/skills/team-testing/roles/analyst/role.md` | false |

## handleCallback

Worker completed. Process and advance.

1. Parse message to identify role and task ID:

| Message Pattern | Role Detection |
|----------------|---------------|
| `[strategist]` or task ID `STRATEGY-*` | strategist |
| `[generator]` or task ID `TESTGEN-*` | generator |
| `[executor]` or task ID `TESTRUN-*` | executor |
| `[analyst]` or task ID `TESTANA-*` | analyst |

2. Check if progress update (inner loop) or final completion
3. Progress -> update session state, STOP
4. Completion -> mark task done via TaskUpdate(status="completed"), remove from active_workers
5. Check for checkpoints:
   - TESTRUN-* completes -> read meta.json for executor.pass_rate and executor.coverage:
     - (pass_rate >= 0.95 AND coverage >= target) OR gc_rounds[layer] >= MAX_GC_ROUNDS -> proceed to handleSpawnNext
     - (pass_rate < 0.95 OR coverage < target) AND gc_rounds[layer] < MAX_GC_ROUNDS -> create GC fix tasks, increment gc_rounds[layer]

**GC Fix Task Creation** (when coverage below target):
```
TaskCreate({
  subject: "TESTGEN-<layer>-fix-<round>: Revise <layer> tests (GC #<round>)",
  description: "PURPOSE: Revise tests to fix failures and improve coverage | Success: pass_rate >= 0.95 AND coverage >= target
TASK:
  - Read previous test results and failure details
  - Revise tests to address failures
  - Improve coverage for uncovered areas
CONTEXT:
  - Session: <session-folder>
  - Layer: <layer>
  - Previous results: <session>/results/run-<N>.json
EXPECTED: Revised test files in <session>/tests/<layer>/
CONSTRAINTS: Only modify test files
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-testing/roles/generator/role.md"
})
TaskCreate({
  subject: "TESTRUN-<layer>-fix-<round>: Re-execute <layer> (GC #<round>)",
  description: "PURPOSE: Re-execute tests after revision | Success: pass_rate >= 0.95
CONTEXT:
  - Session: <session-folder>
  - Layer: <layer>
  - Input: tests/<layer>
EXPECTED: <session>/results/run-<N>-gc.json
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-testing/roles/executor/role.md",
  blockedBy: ["TESTGEN-<layer>-fix-<round>"]
})
```
Update session.gc_rounds[layer]++

6. -> handleSpawnNext

## handleCheck

Read-only status report, then STOP.

Output:
```
[coordinator] Testing Pipeline Status
[coordinator] Mode: <pipeline_mode>
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] GC Rounds: L1: <n>/3, L2: <n>/3

[coordinator] Pipeline Graph:
  STRATEGY-001: <done|run|wait> test-strategy.md
  TESTGEN-001:  <done|run|wait> generating L1...
  TESTRUN-001:  <done|run|wait> blocked by TESTGEN-001
  TESTGEN-002:  <done|run|wait> blocked by TESTRUN-001
  TESTRUN-002:  <done|run|wait> blocked by TESTGEN-002
  TESTANA-001:  <done|run|wait> blocked by TESTRUN-*

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
4. Has ready -> for each ready task:
   a. Determine role from prefix (use Role-Worker Map)
   b. Check if inner loop role (generator/executor) with active worker -> skip (worker picks up next task)
   c. TaskUpdate -> in_progress
   d. team_msg log -> task_unblocked
   e. Spawn team-worker:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <subject>",
  team_name: "testing",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-testing/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: testing
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

5. **Parallel spawn** (comprehensive pipeline):
   - TESTGEN-001 + TESTGEN-002 both unblocked -> spawn both in parallel (name: "generator-1", "generator-2")
   - TESTRUN-001 + TESTRUN-002 both unblocked -> spawn both in parallel (name: "executor-1", "executor-2")

6. Update session.json, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

1. Verify all tasks (including any GC fix tasks) have status "completed" or "deleted"
2. If any tasks incomplete -> return to handleSpawnNext
3. If all complete:
   - Read final state from meta.json (analyst.quality_score, executor.coverage, gc_rounds)
   - Generate summary (deliverables, task count, GC rounds, coverage metrics)
4. Read session.completion_action:
   - interactive -> AskUserQuestion (Archive/Keep/Deepen Coverage)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role-spec in <session>/role-specs/
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns

## Phase 4: State Persistence

After every handler execution:
1. Reconcile active_workers with actual TaskList states
2. Remove entries for completed/deleted tasks
3. Write updated session.json
4. STOP (wait for next callback)

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| GC loop exceeded (3 rounds) | Accept current coverage with warning, proceed |
| Pipeline stall | Check blockedBy chains, report to user |
| Coverage tool unavailable | Degrade to pass rate judgment |
| Worker crash | Reset task to pending, respawn |
