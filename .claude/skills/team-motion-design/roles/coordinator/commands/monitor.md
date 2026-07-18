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
| Message contains [motion-researcher], [choreographer], [animator], [motion-tester] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Parse message to identify role and task ID:

| Message Pattern | Role |
|----------------|------|
| `[motion-researcher]` or `MRESEARCH-*` | motion-researcher |
| `[choreographer]` or `CHOREO-*` | choreographer |
| `[animator]` or `ANIM-*` | animator |
| `[motion-tester]` or `MTEST-*` | motion-tester |

2. Mark task completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. Check checkpoint for completed task:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| MRESEARCH-001 | - | Notify user: research complete |
| CHOREO-001 | - | Proceed to ANIM task(s) |
| ANIM-* (single) | - | Proceed to MTEST-001 |
| ANIM-* (page mode) | - | Check if all ANIM tasks complete, then unblock MTEST-001 |
| MTEST-001 | PERF-001: Performance Gate | Check perf signal -> GC loop or complete |

5. **Performance Gate handling** (MTEST task completed):
   Read performance signal from message: `perf_passed`, `perf_warning`, or `fix_required`

   | Signal | Condition | Action |
   |--------|-----------|--------|
   | `perf_passed` | FPS >= 60, no layout thrashing, reduced-motion present | Performance gate passed -> pipeline complete |
   | `perf_warning` | Minor issues (will-change count high, near 60fps) | gc_rounds < max -> create ANIM-fix task |
   | `fix_required` | FPS < 60 or layout thrashing detected | gc_rounds < max -> create ANIM-fix task (CRITICAL) |
   | Any | gc_rounds >= max | Escalate to user |

   **GC Fix Task Creation**:
   ```
   TaskCreate({ subject: "ANIM-fix-<round>",
     description: "PURPOSE: Address performance issues from motion-tester report | Success: All critical perf issues resolved
   TASK:
     - Parse performance report for specific issues (layout thrashing, unsafe properties, excessive will-change)
     - Replace layout-triggering properties with compositor-only alternatives
     - Optimize will-change usage
     - Verify reduced-motion fallback completeness
   CONTEXT:
     - Session: {run_dir}/work/team
     - Upstream artifacts: {run_dir}/outputs/testing/reports/perf-report-<NNN>.md" })
   TaskUpdate({ taskId: "ANIM-fix-<round>", owner: "animator" })
   ```
   Then create new MTEST task blocked by fix. Increment gc_state.round.

   **GC Escalation Options** (when max rounds exceeded):
   1. Accept current animations - skip performance review, continue
   2. Try one more round
   3. Terminate

6. -> handleSpawnNext

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
Pipeline Status (<pipeline-mode>):
  [DONE]  MRESEARCH-001 (motion-researcher)  -> research/*.json
  [DONE]  CHOREO-001    (choreographer)       -> motion-tokens.json + sequences/
  [RUN]   ANIM-001      (animator)            -> implementing animations...
  [WAIT]  MTEST-001     (motion-tester)       -> blocked by ANIM-001

GC Rounds: 0/2
Performance Gate: pending
Session: <run-id>
Commands: 'resume' to advance | 'check' to refresh
```

Output status -- do NOT advance pipeline.

## handleResume

1. Audit task list for inconsistencies:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. -> handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects (pending + all blockedBy completed)
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check inner loop role with active worker -> skip (worker picks up)
   b. TaskUpdate -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "motion-design",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-motion-design/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: motion-design
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <run-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

**Parallel spawn rules by mode**:

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| tokens | Sequential | One task at a time |
| component | Sequential | One task at a time, GC loop on MTEST |
| page | After CHOREO-001 | Spawn ANIM-001..N in parallel (CP-3 Fan-out) |
| page | After all ANIM complete | Spawn MTEST-001 |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

**Completion check by mode**:

| Mode | Completion Condition |
|------|---------------------|
| tokens | All 4 tasks (+ fix tasks) completed |
| component | All 4 tasks (+ fix tasks) completed |
| page | All 4+N tasks (+ fix tasks) completed |

1. If any tasks not completed -> handleSpawnNext
2. Run lifecycle completion:
   - Read run_id from team-session.json.run.run_id
   - Write {run_dir}/report.md with frontmatter (verdict/summary/concerns)
   - Run `maestro run complete <run_id>`
   - If complete fails: fix the blocking gate and retry once; still failing -> do NOT archive/clean - keep the team active (status=paused) and report the blocking gate
3. If all completed -> transition to coordinator Phase 5

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role spec
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
