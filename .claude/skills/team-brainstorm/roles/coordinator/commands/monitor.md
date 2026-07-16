# Monitor Pipeline

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_GC_ROUNDS: 2

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [ideator], [challenger], [synthesizer], [evaluator] | handleCallback |
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
| `[ideator]` or task ID `IDEA-*` | ideator |
| `[challenger]` or task ID `CHALLENGE-*` | challenger |
| `[synthesizer]` or task ID `SYNTH-*` | synthesizer |
| `[evaluator]` or task ID `EVAL-*` | evaluator |

2. Mark task as completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state
4. **Generator-Critic check** (when challenger completes):
   - If completed task is CHALLENGE-* AND pipeline is deep or full:
   - Read critique file for GC signal
   - Read .msg/meta.json for gc_round

   | GC Signal | gc_round < max | Action |
   |-----------|----------------|--------|
   | REVISION_NEEDED | Yes | Increment gc_round, unblock IDEA-fix task |
   | REVISION_NEEDED | No (>= max) | Force convergence, unblock SYNTH |
   | CONVERGED | - | Unblock SYNTH (skip remaining GC tasks) |

   - Log team_msg with type "gc_loop_trigger" or "task_unblocked"
   - If skipping GC tasks, mark them as completed (skip)

5. Proceed to handleSpawnNext

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
[coordinator] GC Rounds: <gc_round>/<max_gc_rounds>
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
        team_name: "brainstorm",
        name: "<role>",
        run_in_background: true,
        prompt: `## Role Assignment
      role: <role>
      role_spec: ~  or <project>/.claude/skills/team-brainstorm/roles/<role>/role.md
      session: <session-folder>
      session_id: <session-id>
      team_name: brainstorm
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
| Quick | Single sequential | One worker at a time |
| Deep | Sequential with GC | One worker at a time |
| Full | IDEA-001/002/003 unblocked | Spawn ALL 3 ideator workers in parallel |
| Full | Other stages | One worker at a time |

**Parallel ideator spawn** (Full pipeline):
```
Agent({
  subagent_type: "team-worker",
  name: "ideator-<N>",
  ...
  prompt: `...agent_name: ideator-<N>...`
})
```

6. Update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

Completion check by mode:
| Mode | Completion Condition |
|------|---------------------|
| quick | All 3 tasks completed |
| deep | All 6 tasks (+ any skipped GC tasks) completed |
| full | All 7 tasks (+ any skipped GC tasks) completed |

1. Verify all tasks completed via TaskList()
2. If any tasks not completed, return to handleSpawnNext
3. Run lifecycle completion:
   - Read run_id from team-session.json.run.run_id
   - Write {run_dir}/report.md with frontmatter (verdict/summary/concerns)
   - Run `maestro run complete <run_id>`
   - If complete fails: log warning, continue (do not block completion action)
4. If all completed -> transition to coordinator Phase 5

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
3. Role count < 5 -> generate dynamic role-spec in <session>/role-specs/
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
