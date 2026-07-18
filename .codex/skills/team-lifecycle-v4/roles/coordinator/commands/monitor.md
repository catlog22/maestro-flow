
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Monitor Pipeline

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- SUPERVISOR_AGENT: team-supervisor (resident, woken via send_message)

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [role-name] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Find matching worker by role in message
2. Check if progress update (inner loop) or final completion
3. Progress -> update session state, STOP
4. Completion -> mark task done
   - Resident agent (supervisor) -> keep in active_workers (stays alive for future checkpoints)
   - Standard worker -> remove from active_workers
4.5. **evaluateSpecialistInjection** (based on detected codebase characteristics):
   - If callback from analyst, planner, or executor role:
     a. `get_state(role=<callback_role>)` → extract `tech_profile.signals`
     b. Merge with previously collected signals from other roles
     c. Evaluate against trigger matrix (§4)
     d. P0 matches → update_plan with blockedBy on current stage, blocks downstream
     e. P1 matches → update_plan parallel with REVIEW/TEST stage
     f. Log: `team_msg(type="specialist_injection", data={ specialist, signals, priority, evidence })`
     g. Dedup: skip if same specialist already injected this session
5. Check for checkpoints:
   - CHECKPOINT-* with verdict "block" -> request_user_input: Override / Revise upstream / Abort
   - CHECKPOINT-* with verdict "warn" -> log risks to wisdom, proceed normally
   - CHECKPOINT-* with verdict "pass" -> proceed normally
   - QUALITY-001 -> display quality gate, pause for user commands
   - PLAN-001 -> dynamicImplDispatch (see below)
6. -> handleSpawnNext

### dynamicImplDispatch (PLAN-001 callback)

When PLAN-001 completes, coordinator creates IMPL tasks based on complexity:

1. Read `{run_dir}/outputs/plan/plan.json` → extract `complexity`, `tasks[]`
2. Route by complexity (per specs/pipelines.md §6):

| Complexity | Action |
|------------|--------|
| Low (1-2 modules) | Create single IMPL-001, blockedBy: [PLAN-001], InnerLoop: true |
| Medium (3-4 modules) | Create IMPL-{1..N}, each blockedBy: [PLAN-001] only, InnerLoop: false |
| High (5+ modules) | Create IMPL-{1..N} with DAG deps from plan.json, InnerLoop per dispatch rules |

3. For each IMPL task: update_plan with structured description (dispatch.md template)
4. Set blockedBy:
   - **Parallel tasks**: blockedBy: [PLAN-001] (or [CHECKPOINT-003] if supervision enabled)
   - **Serial chain within DAG**: blockedBy includes upstream IMPL task IDs
5. Update team-session.json: `pipeline.tasks_total`, `pipeline.impl_topology: "single"|"parallel"|"dag"`
6. Log via team_msg: `{ type: "state_update", data: { impl_count: N, topology: "..." } }`

### dynamicImplDispatch (PLAN-001 callback)

When PLAN-001 completes, coordinator creates IMPL tasks based on complexity:

1. Read `{run_dir}/outputs/plan/plan.json` → extract `complexity`, `tasks[]`
2. Route by complexity (per specs/pipelines.md §6):

| Complexity | Action |
|------------|--------|
| Low (1-2 modules) | Create single IMPL-001, blockedBy: [PLAN-001], InnerLoop: true |
| Medium (3-4 modules) | Create IMPL-{1..N}, each blockedBy: [PLAN-001] only, InnerLoop: false |
| High (5+ modules) | Create IMPL-{1..N} with DAG deps from plan.json, InnerLoop per dispatch rules |

3. For each IMPL task: update_plan with structured description (dispatch.md template)
4. Set blockedBy:
   - **Parallel tasks**: blockedBy: [PLAN-001] (or [CHECKPOINT-003] if supervision enabled)
   - **Serial chain within DAG**: blockedBy includes upstream IMPL task IDs
5. Update team-session.json: `pipeline.tasks_total`, `pipeline.impl_topology: "single"|"parallel"|"dag"`
6. Log via team_msg: `{ type: "state_update", data: { impl_count: N, topology: "..." } }`

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

Output:
```
[coordinator] Pipeline Status
[coordinator] Progress: <done>/<total> (<pct>%)
[coordinator] Active: <workers with elapsed time>
[coordinator] Ready: <pending tasks with resolved deps>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

## handleResume

1. No active workers -> handleSpawnNext
2. Has active -> check each status
   - completed -> mark done
   - in_progress -> still running
   - Resident agent (supervisor) with `resident: true` + no CHECKPOINT in_progress + pending CHECKPOINT exists
     -> supervisor may have crashed. Respawn with `recovery: true`
3. Some completed -> handleSpawnNext
4. All running -> report status, STOP

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check if inner loop role with active worker -> skip (worker picks up)
   b. **CHECKPOINT-* task** -> wake resident supervisor (see below)
   c. Other tasks -> standard spawn:
      - update_plan -> in_progress
      - team_msg log -> task_unblocked
      - Spawn team-worker (see SKILL.md Worker Spawn Template)
      - Add to active_workers
5. Update session, output summary, STOP

### Wake Supervisor for CHECKPOINT

When a ready task has prefix `CHECKPOINT-*`:

1. Verify supervisor is in active_workers with `resident: true`
   - Not found -> spawn supervisor using SKILL.md Supervisor Spawn Template, wait for ready callback, then wake
2. Determine scope: list task IDs that this checkpoint depends on (its blockedBy tasks)
3. send_message to supervisor (see SKILL.md Supervisor Wake Template):
   ```
   send_message({
     type: "message",
     recipient: "supervisor",
     content: "## Checkpoint Request\ntask_id: <CHECKPOINT-NNN>\nscope: [<upstream-task-ids>]\npipeline_progress: <done>/<total> tasks completed",
     summary: "Checkpoint request: <CHECKPOINT-NNN>"
   })
   ```
4. Do NOT update_plan in_progress — supervisor claims the task itself
5. Do NOT add duplicate entry to active_workers (supervisor already tracked)

## handleComplete

Pipeline done. Generate report and completion action.

1. Shutdown resident supervisor (if active):
   ```
   followup_task({ target: "supervisor", message: { type: "shutdown_request", reason: "Pipeline complete" } })
   ```
2. Generate summary (deliverables, stats, discussions)
3. Read session.completion_action:
   - interactive -> request_user_input (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role-spec in {run_dir}/work/team/role-specs/
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
