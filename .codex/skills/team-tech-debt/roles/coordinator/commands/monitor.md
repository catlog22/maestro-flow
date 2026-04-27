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

## handleCheck

Read-only status report from tasks.json, then STOP.

Read tasks.json + team_msg (type="progress", last=50) + team_msg (type="blocker", last=10). Count tasks by status.

**Output format**:
```
Pipeline Status (<mode>): <task_id> (<role>) [DONE|RUN|WAIT] -> <summary> (per task)
[coordinator] Active Workers: <task_id> <role> <milestone_phase> <pct>% "<summary>" <time_ago>
[coordinator] Blockers: <task_id> <role> "<blocker_summary>" <time_ago> (omit if none)
GC Rounds: <n>/3 | Session: <session-id>
Commands: 'resume' to advance | 'check' to refresh
```

**CLI monitoring**: `maestro agent-msg list -s "<session_id>" --type progress --last 10`

Output status -- do NOT advance pipeline.

## handleResume

**Agent Health Check** (v4): Cross-check `list_agents()` against `active_agents`. Missing agents -> reset task to pending. Stuck in_progress -> reset to pending. Ready but still pending -> include in spawn list.

-> handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, wait for completion, process results.

```
Classify tasks: completed | in_progress | ready (pending + all deps completed)

Ready tasks -> route:
  none + in_progress exists -> report waiting, STOP
  none + nothing in_progress -> handleComplete
  has ready -> for each:
    skip if inner loop role already has active worker
    else: set status="in_progress", log task_unblocked, spawn team_worker, add to active_agents
```

| Task Prefix | Role |
|-------------|------|
| TDSCAN | scanner |
| TDEVAL | assessor |
| TDPLAN | planner |
| TDFIX | executor |
| TDVAL | validator |

**Spawn worker message template**:
```
## Role Assignment
role: <role> | role_spec: <skillRoot>/roles/<role>/role.md
session: <session-folder> | session_id: <session-id> | team_name: tech-debt
requirement: <task-description> | inner_loop: <true for executor>
Read role_spec for Phase 2-4 instructions. Execute Phase 1 -> role Phase 2-4 -> Phase 5 (report).
## Task Context + Upstream Context
task_id: <taskId> | title: <title> | description: <description> | <prevContext>
## Progress Milestones
Report progress via team_msg at phase boundaries. Blockers via type="blocker". Completion via type="task_complete" after report_agent_job_result.
```

**Result collection**: `wait_agent({ timeout_ms: 1800000 })` (30 min), drain progress from team_msg.

**Timeout escalation**: STATUS_CHECK (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out with last progress context, close_agent. Normal completion -> mark completed, close_agent (use task_name, not agentId).

### Checkpoint Processing

After task completion, check for checkpoints:

- **TDPLAN-001 completes** -> Plan Approval Gate: `request_user_input` with Approve / Revise / Abort.
  - Approve -> Worktree Creation (`git worktree add .worktrees/TD-<slug>-<date>`) -> continue
  - Revise -> Add TDPLAN-revised task -> continue
  - Abort -> handleComplete

- **TDVAL-* completes** -> GC Loop Check (read validation from .msg/meta.json):

  | Condition | Action |
  |-----------|--------|
  | No regressions | -> continue (pipeline complete) |
  | Regressions AND gc_rounds < 3 | Add fix-verify tasks, increment gc_rounds |
  | Regressions AND gc_rounds >= 3 | Accept current state -> handleComplete |

  Fix-Verify tasks: `TDFIX-fix-<round>` (role: executor) + `TDVAL-recheck-<round>` (role: validator, deps: [TDFIX-fix]).

**Cross-Agent Supplementary Context** (v4): Use `send_message` (not `followup_task`) to deliver upstream results to running downstream workers as non-interrupting supplementary context.

### Persist and Loop

Write tasks.json -> more tasks ready? -> loop handleSpawnNext. All done -> handleComplete. Blocked -> report, STOP.

## handleComplete

**Cleanup Verification** (v4): `list_agents()` -> close any still-running team agents.

Pipeline done. Verify all tasks (including fix-verify) completed. Incomplete -> handleSpawnNext. All complete:
- If worktree exists + validation passed: commit, push, `gh pr create`, cleanup worktree
- Compile summary: total tasks, gc_rounds, debt_score_before/after
- Route by completion_action: interactive (Archive/Keep/Export) | auto_archive | auto_keep.

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role spec in <session>/role-specs/
4. Add new task to tasks.json, spawn worker via spawn_agent + wait_agent
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every wake: sync `fast_advance` messages from team_msg into active_agents. No duplicate spawns.
