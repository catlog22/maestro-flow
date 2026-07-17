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
| Message contains [researcher], [interaction-designer], [builder], [a11y-tester] | handleCallback |
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
| `[researcher]` or `RESEARCH-*` | researcher |
| `[interaction-designer]` or `INTERACT-*` | interaction-designer |
| `[builder]` or `BUILD-*` | builder |
| `[a11y-tester]` or `A11Y-*` | a11y-tester |

2. Mark task completed: `TaskUpdate({ taskId: "<task-id>", status: "completed" })`
3. Record completion in session state

4. Check checkpoint for completed task:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| RESEARCH-001 | - | Notify user: research complete |
| INTERACT-001 | - | Proceed to BUILD-001 (single/gallery) or BUILD-001..N (page parallel) |
| INTERACT-002 | - | Proceed to BUILD-002 (gallery) |
| BUILD-001 | - | Check mode: single -> A11Y-001; gallery -> INTERACT-002; page -> check if all BUILD done |
| BUILD-001..N | - | Page mode: check if all BUILD tasks done -> A11Y-001 |
| BUILD-002 | - | Gallery: proceed to A11Y-001 |
| A11Y-001 | QUALITY: A11y Gate | Check a11y signal -> GC loop or complete |

5. **A11y Gate handling** (A11Y task completed):
   Read a11y signal from message: `a11y_passed`, `a11y_result`, or `fix_required`

   | Signal | Condition | Action |
   |--------|-----------|--------|
   | `a11y_passed` | 0 critical issues | GC converged -> record gate -> handleComplete |
   | `a11y_result` | Minor issues only | gc_rounds < max -> create BUILD-fix task |
   | `fix_required` | Critical issues found | gc_rounds < max -> create BUILD-fix task (CRITICAL) |
   | Any | gc_rounds >= max | Escalate to user |

   **GC Fix Task Creation**:
   ```
   TaskCreate({ subject: "BUILD-fix-<round>",
     description: "PURPOSE: Address a11y audit feedback | Success: All critical/high issues resolved
   TASK:
     - Parse a11y audit feedback for specific issues
     - Apply targeted fixes to component JS/CSS
   CONTEXT:
     - Session: <session-folder>
     - Upstream artifacts: a11y/a11y-audit-<NNN>.md" })
   TaskUpdate({ taskId: "BUILD-fix-<round>", owner: "builder" })
   ```
   Then create new A11Y task blocked by fix. Increment gc_state.round.

   **GC Escalation Options** (when max rounds exceeded):
   1. Accept current implementation - skip remaining a11y fixes
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
  [DONE]  RESEARCH-001      (researcher)            -> research/*.json
  [DONE]  INTERACT-001      (interaction-designer)  -> blueprints/*.md
  [RUN]   BUILD-001         (builder)               -> building component...
  [WAIT]  A11Y-001          (a11y-tester)            -> blocked by BUILD-001

GC Rounds: 0/2
Session: <session-id>
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
  team_name: "interactive-craft",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <project>/.claude/skills/team-interactive-craft/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: interactive-craft
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <session-id>
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
| single | Sequential | One task at a time |
| gallery | Sequential | One task at a time |
| page | After INTERACT-001 | Spawn BUILD-001..N in parallel (CP-3 fan-out) |
| page | After all BUILD done | Spawn A11Y-001 |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

**Completion check by mode**:

| Mode | Completion Condition |
|------|---------------------|
| single | All 4 tasks (+ fix tasks) completed |
| gallery | All 6 tasks (+ fix tasks) completed |
| page | All 3+N tasks (+ fix tasks) completed |

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
