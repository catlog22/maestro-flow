# Monitor Pipeline

Synchronous pipeline coordination using spawn_agent + wait_agent.

## Constants

- WORKER_AGENT: team_worker
- ONE_STEP_PER_INVOCATION: false (synchronous wait loop)
- FAST_ADVANCE_AWARE: true
- MAX_GC_ROUNDS: 3

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
| STRATEGY-* | strategist | `<project>/.codex/skills/team-testing/roles/strategist/role.md` | false |
| TESTGEN-* | generator | `<project>/.codex/skills/team-testing/roles/generator/role.md` | true |
| TESTRUN-* | executor | `<project>/.codex/skills/team-testing/roles/executor/role.md` | true |
| TESTANA-* | analyst | `<project>/.codex/skills/team-testing/roles/analyst/role.md` | false |

## handleCheck

Read-only status report from tasks.json, then STOP.

Read tasks.json + team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Count tasks by status.

**Output format**:
```
[coordinator] Testing Pipeline Status — Mode: <pipeline_mode> — Progress: <done>/<total> (<pct>%)
[coordinator] GC Rounds: L1: <n>/3, L2: <n>/3
[coordinator] Pipeline Graph: <task_id>: <done|run|wait> <description> (per task)
[coordinator] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[coordinator] Blockers: <task_id> <role> "<blocker_summary>" <time_ago> (omit if none)
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

Then STOP.

## handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against `active_agents`. Missing agents -> reset task to pending.

```
Load active_agents -> route:
  none -> handleSpawnNext
  has agents -> classify each: completed | in_progress
    some completed -> handleSpawnNext
    all running -> report status -> STOP
```

## handleSpawnNext

Find ready tasks, spawn workers, wait for completion, process results.

```
Classify tasks: completed | in_progress | ready (pending + all deps completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting, STOP
  none + nothing in_progress -> handleComplete
  has ready -> for each:
    determine role from prefix (Role-Worker Map)
    skip if inner loop role (generator/executor) already has active worker
    else: set status="in_progress", log task_unblocked, spawn team_worker, add to active_agents
```

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <skillRoot>/roles/<role>/role.md
session: <session-folder> | session_id: <session-id> | team_name: testing
requirement: <task-description> | inner_loop: <true for generator/executor>
## Current Task
task_id: <taskId> | title: <task-title>
Read role_spec for Phase 2-4 instructions. Execute Phase 1 -> role Phase 2-4 -> Phase 5 (report).
## Task Context + Upstream Context
<task description + prevContext>
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Parallel spawn**: Multiple unblocked TESTGEN-* or TESTRUN-* tasks spawn in parallel.

### Wait and Process Results

`wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent. Normal completion -> mark completed, close_agent (use task_name, not agentId).

### GC Checkpoint (TESTRUN-* completes)

After TESTRUN-* completion, read meta.json for executor.pass_rate and executor.coverage:
- (pass_rate >= 0.95 AND coverage >= target) OR gc_rounds[layer] >= MAX_GC_ROUNDS -> proceed
- (pass_rate < 0.95 OR coverage < target) AND gc_rounds[layer] < MAX_GC_ROUNDS -> create GC fix tasks, increment gc_rounds[layer]

**GC Fix Task Creation** (when coverage below target): Add paired tasks to tasks.json:
- `TESTGEN-<layer>-fix-<round>` (role: generator, inner_loop: true) — revise tests to fix failures and improve coverage
- `TESTRUN-<layer>-fix-<round>` (role: executor, deps: [TESTGEN-fix], inner_loop: true) — re-execute revised tests

Increment `gc_rounds[layer]++`.

**Cross-Agent Supplementary Context** (v4): Use `send_message` (not `followup_task`) to deliver upstream results to running downstream workers as non-interrupting supplementary context.

### Persist and Loop

Write tasks.json -> more tasks ready? -> loop handleSpawnNext. All done -> handleComplete. Blocked -> report, STOP.

## handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents.

Pipeline done. Verify all tasks (including GC fix tasks) completed/failed. Incomplete -> handleSpawnNext. All complete -> read meta.json (quality_score, coverage, gc_rounds), generate summary.

Route by completion_action: interactive (Archive/Keep/Deepen Coverage) | auto_archive | auto_keep.

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role-spec in <session>/role-specs/
4. Add new task to tasks.json, spawn worker via spawn_agent + wait_agent
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every wake: sync `fast_advance` messages from team_msg into active_agents. No duplicate spawns.

## Phase 4: State Persistence

After every handler: reconcile active_agents with tasks.json, remove completed/failed entries, write tasks.json, STOP.

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Unknown role in callback | Log info, scan for other completions |
| GC loop exceeded (3 rounds) | Accept current coverage with warning, proceed |
| Pipeline stall | Check deps chains, report to user |
| Coverage tool unavailable | Degrade to pass rate judgment |
| Worker crash | Reset task to pending in tasks.json, respawn via spawn_agent |
