# Monitor Pipeline

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Event-driven pipeline coordination. Beat model: coordinator wake -> process -> spawn -> STOP.

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_FIX_CYCLES: 2

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [explorer], [planner], [reviewer], [integrator], [implementer] | handleCallback |
| "consensus_blocked" | handleConsensus |
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
| `[explorer]` or task ID `EXPLORE-*` | explorer |
| `[planner]` or task ID `SOLVE-*` | planner |
| `[reviewer]` or task ID `AUDIT-*` | reviewer |
| `[integrator]` or task ID `MARSHAL-*` | integrator |
| `[implementer]` or task ID `BUILD-*` | implementer |

2. Mark task as completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. **Review gate check** (when reviewer completes):
   - If completed task is AUDIT-* AND pipeline is full or batch:
   - Read audit report from `<session>/audits/audit-report.json`
   - Read .msg/meta.json for fix_cycles

   | Verdict | fix_cycles < max | Action |
   |---------|-----------------|--------|
   | rejected | Yes | Increment fix_cycles, create SOLVE-fix + AUDIT re-review tasks (see dispatch.md Review-Fix Cycle), proceed to handleSpawnNext |
   | rejected | No (>= max) | Force proceed — log warning, unblock MARSHAL |
   | concerns | - | Log concerns, proceed to MARSHAL (non-blocking) |
   | approved | - | Proceed to MARSHAL via handleSpawnNext |

   - Log team_msg with type "review_result" or "fix_required"
   - If force proceeding past rejection, mark skipped fix tasks as completed (skip)

5. **Deferred BUILD task creation** (when integrator completes):
   - If completed task is MARSHAL-* AND pipeline is batch:
   - Read execution queue from `.workflow/issues/queue/execution-queue.json`
   - Parse parallel_groups to determine BUILD task count M
   - Create BUILD-001..M tasks dynamically (see dispatch.md Batch Pipeline BUILD section)
   - Proceed to handleSpawnNext

6. Proceed to handleSpawnNext

## handleCheck

Read-only status report, then STOP.

**Worker Progress** (from message bus):

Before generating status output, read worker milestones:

```javascript
const progressMsgs = mcp__maestro__team_msg({
  operation: "list", session_id: sessionId, type: "progress", last: 50
})
const blockerMsgs = mcp__maestro__team_msg({
  operation: "list", session_id: sessionId, type: "blocker", last: 10
})

// Aggregate latest milestone per task
const taskProgress = {}
for (const msg of (progressMsgs.result?.messages || [])) {
  const tid = msg.data?.task_id
  if (tid && (!taskProgress[tid] || msg.ts > taskProgress[tid].ts)) {
    taskProgress[tid] = { phase: msg.data.phase, pct: msg.data.progress_pct, ts: msg.ts }
  }
}
```

Include in status output:
- Per-worker latest milestone (phase + progress_pct) next to task status
- Active blockers section (if any blockerMsgs found)

```
[coordinator] Pipeline Status (<pipeline-mode>)
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] Active: <workers with elapsed time>
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Fix Cycles: <fix_cycles>/<max_fix_cycles>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

## handleResume

1. Audit task list: Tasks stuck in "in_progress" -> reset to "pending"
2. Proceed to handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. TaskUpdate -> in_progress
   b. team_msg log -> task_unblocked
   c. Spawn team-worker (see SKILL.md Spawn Template):
      ```
      Agent({
        subagent_type: "team-worker",
        description: "Spawn <role> worker for <task-id>",
        team_name: "issue",
        name: "<role>",
        run_in_background: true,
        prompt: `## Role Assignment
      role: <role>
      role_spec: ~  or <project>/.claude/skills/team-issue/roles/<role>/role.md
      session: <session-folder>
      session_id: <session-id>
      team_name: issue
      requirement: <task-description>
      inner_loop: false

      ## Progress Milestones
      session_id: <session-id>
      Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
      Report blockers immediately via team_msg type="blocker".
      Report completion via team_msg type="task_complete" after final SendMessage.

      Read role_spec file to load Phase 2-4 domain instructions.
      Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
      })
      ```
   d. Add to active_workers

5. Parallel spawn rules:

| Pipeline | Scenario | Spawn Behavior |
|----------|----------|---------------|
| Quick | All stages | One worker at a time |
| Full | All stages | One worker at a time |
| Batch | EXPLORE-001..N unblocked | Spawn ALL N explorer workers in parallel (max 5) |
| Batch | BUILD-001..M unblocked | Spawn ALL M implementer workers in parallel (max 3) |
| Batch | Other stages | One worker at a time |

**Parallel spawn** (Batch mode with multiple ready tasks for same role):
```
Agent({
  subagent_type: "team-worker",
  name: "<role>-<N>",
  team_name: "issue",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-issue/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: issue
requirement: <task-description>
agent_name: <role>-<N>
inner_loop: false

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery, owner=<role>-<N>) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

6. Update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

Completion check by mode:
| Mode | Completion Condition |
|------|---------------------|
| quick | All 4 tasks completed |
| full | All 5 tasks (+ any fix cycle tasks) completed |
| batch | All N EXPLORE + N SOLVE + 1 AUDIT + 1 MARSHAL + M BUILD (+ any fix cycle tasks) completed |

1. Verify all tasks completed via TaskList()
2. If any tasks not completed, return to handleSpawnNext
3. If all completed -> transition to coordinator Phase 5

## handleConsensus

Handle consensus_blocked signals.

| Severity | Action |
|----------|--------|
| HIGH | Pause pipeline, notify user with findings summary |
| MEDIUM | Log finding, attempt to continue |
| LOW | Log finding, continue pipeline |

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
