# Command: Monitor

Handle all coordinator monitoring events for the roadmap-dev pipeline using the async Spawn-and-Stop pattern. Multi-phase execution with gap closure expressed as event-driven state machine transitions. One operation per invocation, then STOP and wait for the next callback.

## Constants

| Key | Value | Description |
|-----|-------|-------------|
| SPAWN_MODE | background | All workers spawned via `Task(run_in_background: true)` |
| ONE_STEP_PER_INVOCATION | true | Coordinator does one operation then STOPS |
| WORKER_AGENT | team-worker | All workers spawned as team-worker agents |
| MAX_GAP_ITERATIONS | 3 | Maximum gap closure re-plan/exec/verify cycles per phase |

### Role-Worker Map

| Prefix | Role | Role Spec | inner_loop |
|--------|------|-----------|------------|
| PLAN | planner | `~  or <project>/.claude/skills/team-roadmap-dev/roles/planner/role.md` | true (cli_tools: agy --mode analysis) |
| EXEC | executor | `~  or <project>/.claude/skills/team-roadmap-dev/roles/executor/role.md` | true (cli_tools: agy --mode write) |
| VERIFY | verifier | `~  or <project>/.claude/skills/team-roadmap-dev/roles/verifier/role.md` | true |

### Pipeline Structure

Per-phase task chain: `PLAN-{phase}01 -> EXEC-{phase}01 -> VERIFY-{phase}01`

Gap closure creates: `PLAN-{phase}0N -> EXEC-{phase}0N -> VERIFY-{phase}0N` (N = iteration + 1)

Multi-phase: Phases execute sequentially. Each phase completes its full PLAN/EXEC/VERIFY cycle (including gap closure) before the next phase is dispatched.

### State Machine Coordinates

The coordinator tracks its position using these state variables in `meta.json`:

```
session.coordinates = {
  current_phase: <number>,     // Active phase (1-based)
  total_phases: <number>,      // Total phases from roadmap
  gap_iteration: <number>,     // Current gap closure iteration within phase (0 = initial)
  step: <string>,              // Current step: "plan" | "exec" | "verify" | "gap_closure" | "transition"
  status: <string>             // "running" | "paused" | "complete"
}
```

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session file | `<session-folder>/.msg/meta.json` | Yes |
| Task list | `TaskList()` | Yes |
| Active workers | session.active_workers[] | Yes |
| Coordinates | session.coordinates | Yes |
| Config | `<session-folder>/config.json` | Yes |
| State | `<session-folder>/state.md` | Yes |

```
Load session state:
  1. Read <session-folder>/.msg/meta.json -> session
  2. Read <session-folder>/config.json -> config
  3. TaskList() -> allTasks
  4. Extract coordinates from session (current_phase, gap_iteration, step)
  5. Extract active_workers[] from session (default: [])
  6. Parse $ARGUMENTS to determine trigger event
```

## Phase 3: Event Handlers

### Wake-up Source Detection

Parse `$ARGUMENTS` to determine handler:

| Priority | Condition | Handler |
|----------|-----------|---------|
| 1 | Message contains `[planner]`, `[executor]`, or `[verifier]` | handleCallback |
| 2 | Contains "check" or "status" | handleCheck |
| 3 | Contains "resume", "continue", or "next" | handleResume |
| 4 | Pipeline detected as complete (all phases done) | handleComplete |
| 5 | None of the above (initial spawn after dispatch) | handleSpawnNext |

---

### Handler: handleCallback

Worker completed a task. Determine which step completed via prefix, apply pipeline logic, advance.

```
Receive callback from [<role>]
  +- Find matching active worker by role tag
  +- Is this a progress update (not final)? (Inner Loop intermediate)
  |   +- YES -> Update session state -> STOP
  +- Task status = completed?
  |   +- YES -> remove from active_workers -> update session
  |   |   +- Determine completed step from task prefix:
  |   |   |
  |   |   +- PLAN-* completed:
  |   |   |   +- Update coordinates.step = "plan_done"
  |   |   |   +- Is this initial plan (gap_iteration === 0)?
  |   |   |   |   +- YES + config.gates.plan_check?
  |   |   |   |   |   +- AskUserQuestion:
  |   |   |   |   |       question: "Phase <N> plan ready. Proceed with execution?"
  |   |   |   |   |       header: "Plan Review"
  |   |   |   |   |       options:
  |   |   |   |   |         - "Proceed": -> handleSpawnNext (spawns EXEC)
  |   |   |   |   |         - "Revise": Create new PLAN task with incremented suffix
  |   |   |   |   |           blockedBy: [] (immediate), -> handleSpawnNext
  |   |   |   |   |         - "Skip phase": Delete all phase tasks
  |   |   |   |   |           -> advanceToNextPhase
  |   |   |   |   +- NO (gap closure plan) -> handleSpawnNext (spawns EXEC)
  |   |   |   +- -> handleSpawnNext
  |   |   |
  |   |   +- EXEC-* completed:
  |   |   |   +- Update coordinates.step = "exec_done"
  |   |   |   +- -> handleSpawnNext (spawns VERIFY)
  |   |   |
  |   |   +- VERIFY-* completed:
  |   |       +- Update coordinates.step = "verify_done"
  |   |       +- Read verification result from:
  |   |       |   <session-folder>/phase-<N>/verification.md
  |   |       +- Parse gaps from verification
  |   |       +- Gaps found?
  |   |           +- NO -> Phase passed
  |   |           |   +- -> advanceToNextPhase
  |   |           +- YES + gap_iteration < MAX_GAP_ITERATIONS?
  |   |           |   +- -> triggerGapClosure
  |   |           +- YES + gap_iteration >= MAX_GAP_ITERATIONS?
  |   |               +- AskUserQuestion:
  |   |                   question: "Phase <N> still has <count> gaps after <max> attempts."
  |   |                   header: "Gap Closure Limit"
  |   |                   options:
  |   |                     - "Continue anyway": Accept, -> advanceToNextPhase
  |   |                     - "Retry once more": Increment max, -> triggerGapClosure
  |   |                     - "Stop": -> pauseSession
  |   |
  |   +- NO -> progress message -> STOP
  +- No matching worker found
      +- Scan all active workers for completed tasks
      +- Found completed -> process each (same logic above) -> handleSpawnNext
      +- None completed -> STOP
```

**Sub-procedure: advanceToNextPhase**

```
advanceToNextPhase:
  +- Update state.md: mark current phase completed
  +- current_phase < total_phases?
  |   +- YES:
  |   |   +- config.mode === "interactive"?
  |   |   |   +- AskUserQuestion:
  |   |   |       question: "Phase <N> complete. Proceed to phase <N+1>?"
  |   |   |       header: "Phase Transition"
  |   |   |       options:
  |   |   |         - "Proceed": Dispatch next phase tasks, -> handleSpawnNext
  |   |   |         - "Review results": Output phase summary, re-ask
  |   |   |         - "Stop": -> pauseSession
  |   |   +- Auto mode: Dispatch next phase tasks directly
  |   |   +- Update coordinates:
  |   |       current_phase++, gap_iteration=0, step="plan"
  |   |   +- Dispatch new phase tasks (PLAN/EXEC/VERIFY with blockedBy)
  |   |   +- -> handleSpawnNext
  |   +- NO -> All phases done -> handleComplete
```

**Sub-procedure: triggerGapClosure**

```
triggerGapClosure:
  +- Increment coordinates.gap_iteration
  +- suffix = "0" + (gap_iteration + 1)
  +- phase = coordinates.current_phase
  +- Read gaps from verification.md
  +- Log: team_msg gap_closure
  +- Create gap closure task chain:
  |
  |   TaskCreate: PLAN-{phase}{suffix}
  |     subject: "PLAN-{phase}{suffix}: Gap closure for phase {phase} (iteration {gap_iteration})"
  |     description: includes gap list, references to previous verification
  |     blockedBy: [] (immediate start)
  |
  |   TaskCreate: EXEC-{phase}{suffix}
  |     subject: "EXEC-{phase}{suffix}: Execute gap fixes for phase {phase}"
  |     blockedBy: [PLAN-{phase}{suffix}]
  |
  |   TaskCreate: VERIFY-{phase}{suffix}
  |     subject: "VERIFY-{phase}{suffix}: Verify gap closure for phase {phase}"
  |     blockedBy: [EXEC-{phase}{suffix}]
  |
  +- Set owners: planner, executor, verifier
  +- Update coordinates.step = "gap_closure"
  +- -> handleSpawnNext (picks up the new PLAN task)
```

**Sub-procedure: pauseSession**

```
pauseSession:
  +- Save coordinates to meta.json (phase, step, gap_iteration)
  +- Update coordinates.status = "paused"
  +- Update state.md with pause marker
  +- team_msg log -> session_paused
  +- Output: "Session paused at phase <N>, step <step>. Resume with 'resume'."
  +- STOP
```

---

### Handler: handleSpawnNext

Find all ready tasks, spawn team-worker agent in background, update session, STOP.

```
Collect task states from TaskList()
  +- completedSubjects: status = completed
  +- inProgressSubjects: status = in_progress
  +- readySubjects: status = pending
      AND (no blockedBy OR all blockedBy in completedSubjects)

Ready tasks found?
  +- NONE + work in progress -> report waiting -> STOP
  +- NONE + nothing in progress:
  |   +- More phases to dispatch? -> advanceToNextPhase
  |   +- No more phases -> handleComplete
  +- HAS ready tasks -> take first ready task:
      +- Is task owner an Inner Loop role AND that role already has active_worker?
      |   +- YES -> SKIP spawn (existing worker picks it up via inner loop)
      |   +- NO -> normal spawn below
      +- Determine role from prefix:
      |   PLAN-*   -> planner
      |   EXEC-*   -> executor
      |   VERIFY-* -> verifier
      +- TaskUpdate -> in_progress
      +- team_msg log -> task_unblocked (team_session_id=<session-id>)
      +- Spawn team-worker (see spawn call below)
      +- Add to session.active_workers
      +- Update session file
      +- Output: "[coordinator] Spawned <role> for <subject>"
      +- STOP
```

**Spawn worker tool call** (one per ready task):

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <subject>",
  team_name: "roadmap-dev",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-roadmap-dev/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: roadmap-dev
requirement: <task-description>
inner_loop: true

## Current Task
- Task ID: <task-id>
- Task: <subject>
- Phase: <current_phase>
- Gap Iteration: <gap_iteration>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 -> role-spec Phase 2-4 -> built-in Phase 5.`
})
```

---

### Handler: handleCheck

Read-only status report. No pipeline advancement.

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

**Output format**:

```
[coordinator] Roadmap Pipeline Status
[coordinator] Phase: <current>/<total> | Gap Iteration: <N>/<max>
[coordinator] Progress: <completed>/<total tasks> (<percent>%)

[coordinator] Current Phase <N> Graph:
  PLAN-{N}01:   <status-icon> <summary>
  EXEC-{N}01:   <status-icon> <summary>
  VERIFY-{N}01: <status-icon> <summary>
  [PLAN-{N}02:  <status-icon> (gap closure #1)]
  [EXEC-{N}02:  <status-icon>]
  [VERIFY-{N}02:<status-icon>]

  done=completed  >>>=running  o=pending  x=deleted  .=not created

[coordinator] Phase Summary:
  Phase 1: completed
  Phase 2: in_progress (step: exec)
  Phase 3: not started

[coordinator] Active Workers:
  > <subject> (<role>) - running [inner-loop: N/M tasks done]

[coordinator] Ready to spawn: <subjects>
[coordinator] Coordinates: phase=<N> step=<step> gap=<iteration>
[coordinator] Commands: 'resume' to advance | 'check' to refresh
```

Then STOP.

---

### Handler: handleResume

Check active worker completion, process results, advance pipeline. Also handles resume from paused state.

```
Check coordinates.status:
  +- "paused" -> Restore coordinates, resume from saved position
  |   Reset coordinates.status = "running"
  |   -> handleSpawnNext (picks up where it left off)
  +- "running" -> Normal resume:
      Load active_workers from session
        +- No active workers -> handleSpawnNext
        +- Has active workers -> check each:
            +- status = completed -> mark done, remove from active_workers, log
            +- status = in_progress -> still running, log
            +- other status -> worker failure -> reset to pending
            After processing:
              +- Some completed -> handleSpawnNext
              +- All still running -> report status -> STOP
              +- All failed -> handleSpawnNext (retry)
```

---

### Handler: handleComplete

All phases done. Generate final project summary and finalize session.

```
All phases completed (no pending, no in_progress across all phases)
  +- Generate project-level summary:
  |   - Roadmap overview (phases completed)
  |   - Per-phase results:
  |     - Gap closure iterations used
  |     - Verification status
  |     - Key deliverables
  |   - Overall stats (tasks completed, phases, total gap iterations)
  |
  +- Update session:
  |   coordinates.status = "complete"
  |   session.completed_at = <timestamp>
  |   Write meta.json
  |
  +- Update state.md: mark all phases completed
  +- team_msg log -> project_complete
  +- Output summary to user
  +- STOP
```

---

### Worker Failure Handling

When a worker has unexpected status (not completed, not in_progress):

1. Reset task -> pending via TaskUpdate
2. Remove from active_workers
3. Log via team_msg (type: error)
4. Report to user: task reset, will retry on next resume

## Phase 4: State Persistence

After every handler action, before STOP:

| Check | Action |
|-------|--------|
| Coordinates updated | current_phase, step, gap_iteration reflect actual state |
| Session state consistent | active_workers matches TaskList in_progress tasks |
| No orphaned tasks | Every in_progress task has an active_worker entry |
| Meta.json updated | Write updated session state and coordinates |
| State.md updated | Phase progress reflects actual completion |
| Completion detection | All phases done + no pending + no in_progress -> handleComplete |

```
Persist:
  1. Update coordinates in meta.json
  2. Reconcile active_workers with actual TaskList states
  3. Remove entries for completed/deleted tasks
  4. Write updated meta.json
  5. Update state.md if phase status changed
  6. Verify consistency
  7. STOP (wait for next callback)
```

## State Machine Diagram

```
[dispatch] -> PLAN-{N}01 spawned
                |
          [planner callback]
                |
         plan_check gate? --YES--> AskUser --> "Revise" --> new PLAN task --> [spawn]
                |                              "Skip"   --> advanceToNextPhase
                | "Proceed" / no gate
                v
          EXEC-{N}01 spawned
                |
          [executor callback]
                |
                v
          VERIFY-{N}01 spawned
                |
          [verifier callback]
                |
          gaps found? --NO--> advanceToNextPhase
                |
                YES + iteration < MAX
                |
                v
          triggerGapClosure:
            PLAN-{N}02 -> EXEC-{N}02 -> VERIFY-{N}02
                |
          [repeat verify check]
                |
          gaps found? --NO--> advanceToNextPhase
                |
                YES + iteration >= MAX
                |
                v
          AskUser: "Continue anyway" / "Retry" / "Stop"

advanceToNextPhase:
  +- phase < total? --YES--> interactive gate? --> dispatch phase+1 --> [spawn PLAN]
  +- phase = total? --> handleComplete
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session file not found | Error, suggest re-initialization |
| Worker callback from unknown role | Log info, scan for other completions |
| All workers still running on resume | Report status, suggest check later |
| Pipeline stall (no ready, no running, has pending) | Check blockedBy chains, report to user |
| Verification file missing | Treat as gap -- verifier may have crashed, re-spawn |
| Phase dispatch fails | Check roadmap integrity, report to user |
| Max gap iterations exceeded | Ask user: continue / retry / stop |
| User chooses "Stop" at any gate | Pause session with coordinates, exit cleanly |
