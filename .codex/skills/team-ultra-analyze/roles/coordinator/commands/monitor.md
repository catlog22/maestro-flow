
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Monitor

## Constants

| Key | Value |
|-----|-------|
| SPAWN_MODE | background |
| ONE_STEP_PER_INVOCATION | true |
| WORKER_AGENT | team-worker |
| MAX_DISCUSSION_ROUNDS_QUICK | 0 |
| MAX_DISCUSSION_ROUNDS_STANDARD | 1 |
| MAX_DISCUSSION_ROUNDS_DEEP | 5 |

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session state | `<session>/session.json` | Yes |
| Task list | `list_agents()` | Yes |
| Trigger event | From Entry Router detection | Yes |
| Pipeline mode | From session.json `pipeline_mode` | Yes |
| Discussion round | From session.json `discussion_round` | Yes |

1. Load session.json for current state, `pipeline_mode`, `discussion_round`
2. Run `list_agents()` to get current task statuses
3. Identify trigger event type from Entry Router
4. Compute max discussion rounds from pipeline mode:

```
MAX_ROUNDS = pipeline_mode === 'deep' ? 5
           : pipeline_mode === 'standard' ? 1
           : 0
```

## Phase 3: Event Handlers

### handleCallback

Triggered when a worker sends completion message (via send_message callback).

1. Parse message to identify role, then resolve completed tasks:

   **Role detection** (from message tag at start of body):

   | Message starts with | Role | Handler |
   |---------------------|------|---------|
   | `[explorer]` | explorer | handleCallback |
   | `[analyst]` | analyst | handleCallback |
   | `[discussant]` | discussant | handleCallback |
   | `[synthesizer]` | synthesizer | handleCallback |
   | `[supervisor]` | supervisor | Log checkpoint result, verify CHECKPOINT task completed, proceed to handleSpawnNext |

   **Task ID resolution** (do NOT parse from message — use list_agents):
   - Call `list_agents()` and find tasks matching the detected role's prefix
   - Tasks with status `completed` that were not previously tracked = newly completed tasks
   - This is reliable even when a worker reports multiple tasks (inner_loop) or when message format varies

2. Verify task completion (worker already marks completed in Phase 5):

```
wait_agent({ timeout_ms: 3600000, taskId: "<task-id>" })
// If still "in_progress" (worker failed to mark) → fallback:
update_goal({ taskId: "<task-id>", status: "completed" })
```

3. Record completion in session state via team_msg

4. **Role-specific post-completion logic**:

| Completed Role | Pipeline Mode | Post-Completion Action |
|---------------|---------------|------------------------|
| explorer | all | Log: exploration ready. Proceed to handleSpawnNext |
| analyst | all | Log: analysis ready. Proceed to handleSpawnNext |
| discussant | all | **Discussion feedback gate** (see below) |
| synthesizer | all | Proceed to handleComplete |

5. **Discussion Feedback Gate** (when discussant completes):

When a DISCUSS-* task completes, the coordinator collects user feedback BEFORE spawning the next task. This replaces any while-loop pattern.

```
// Read current discussion_round from session state
discussion_round = session.discussion_round || 0
discussion_round++

// Update session state
Update session.json: discussion_round = discussion_round

// Check if discussion loop applies
IF pipeline_mode === 'quick':
    // No discussion in quick mode -- proceed to handleSpawnNext (SYNTH)
    -> handleSpawnNext

ELSE IF discussion_round >= MAX_ROUNDS:
    // Reached max rounds -- force proceed to synthesis
    Log: "Max discussion rounds reached, proceeding to synthesis"
    IF no SYNTH-001 task exists:
        Create SYNTH-001 task blocked by last DISCUSS task
    -> handleSpawnNext

ELSE:
    // Collect user feedback
    request_user_input({
      questions: [{
        question: "Discussion round <N> complete. What next?",
        header: "Discussion Feedback",
        multiSelect: false,
        options: [
          { label: "Continue deeper", description: "Current direction is good, go deeper" },
          { label: "Adjust direction", description: "Shift analysis focus" },
          { label: "Done", description: "Sufficient depth, proceed to synthesis" }
        ]
      }]
    })
```

6. **Feedback handling** (still inside handleCallback, after request_user_input returns):

| Feedback | Action |
|----------|--------|
| "Continue deeper" | Create new DISCUSS-`<N+1>` task (pending, no blockedBy). Record decision in discussion.md. Proceed to handleSpawnNext |
| "Adjust direction" | request_user_input for new focus. Create ANALYZE-fix-`<N>` task (pending). Create DISCUSS-`<N+1>` task (pending, blockedBy ANALYZE-fix-`<N>`). Record direction change in discussion.md. Proceed to handleSpawnNext |
| "Done" | Check if SYNTH-001 already exists (from dispatch): if yes, ensure blockedBy is updated to reference last DISCUSS task; if no, create SYNTH-001 (pending, blockedBy last DISCUSS). Record decision in discussion.md. Proceed to handleSpawnNext |

**Dynamic task creation templates**:

DISCUSS-N (subsequent round):
```
create_goal({
  subject: "DISCUSS-<NNN>",
  description: "PURPOSE: Process discussion round <N> | Success: Updated understanding
TASK:
  - Process previous round results
  - Execute <type> discussion strategy
  - Update discussion timeline
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Round: <N>
  - Type: <deepen|direction-adjusted|specific-questions>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/discussions/discussion-round-<NNN>.json
---
InnerLoop: false"
})
update_goal({ taskId: "DISCUSS-<NNN>", owner: "discussant" })
```

ANALYZE-fix-N (direction adjustment):
```
create_goal({
  subject: "ANALYZE-fix-<N>",
  description: "PURPOSE: Supplementary analysis with adjusted focus | Success: New insights from adjusted direction
TASK:
  - Re-analyze from adjusted perspective: <adjusted_focus>
  - Build on previous exploration findings
  - Generate updated discussion points
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Type: direction-fix
  - Adjusted focus: <adjusted_focus>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/analyses/analysis-fix-<N>.json
---
InnerLoop: false"
})
update_goal({ taskId: "ANALYZE-fix-<N>", owner: "analyst" })
```

SYNTH-001 (created dynamically — check existence first):
```
// Guard: only create if SYNTH-001 doesn't exist yet (dispatch may have pre-created it)
const existingSynth = list_agents().find(t => t.subject === 'SYNTH-001')
if (!existingSynth) {
create_goal({
  subject: "SYNTH-001",
  description: "PURPOSE: Integrate all analysis into final conclusions | Success: Executive summary with recommendations
TASK:
  - Load all exploration, analysis, and discussion artifacts
  - Extract themes, consolidate evidence, prioritize recommendations
  - Write conclusions and update discussion.md
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Upstream artifacts: explorations/*.json, analyses/*.json, discussions/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/conclusions.json + discussion.md update
CONSTRAINTS: Pure integration, no new exploration
---
InnerLoop: false"
})
}
// Always update blockedBy to reference the last DISCUSS task (whether pre-existing or newly created)
update_goal({ taskId: "SYNTH-001", addBlockedBy: ["<last-DISCUSS-task-id>"], owner: "synthesizer" })
```

7. Record user feedback to decision_trail via team_msg:

```
mcp__maestro__team_msg({
  operation: "log", session_id: sessionId, from: "coordinator",
  type: "state_update",
  data: { decision_trail_entry: {
    round: discussion_round,
    decision: feedback,
    context: "User feedback at discussion round N",
    timestamp: current ISO timestamp
  }}
})
```

8. Proceed to handleSpawnNext

### handleSpawnNext

Find and spawn the next ready tasks.

1. Scan task list for tasks where:
   - Status is "pending"
   - All blockedBy tasks have status "completed"

2. For each ready task, determine role from task prefix:

| Task Prefix | Role | Role Spec |
|-------------|------|-----------|
| `EXPLORE-*` | explorer | `<skill_root>/roles/explorer/role.md` |
| `ANALYZE-*` | analyst | `<skill_root>/roles/analyst/role.md` |
| `DISCUSS-*` | discussant | `<skill_root>/roles/discussant/role.md` |
| `SYNTH-*` | synthesizer | `<skill_root>/roles/synthesizer/role.md` |

3. Spawn team-worker for each ready task:

```
spawn_agent({ task_name: "<agent_name>", message: "Spawn <role> worker for <task-subject>", fork_turns: "none", agent_type: "team_worker" })
```

4. **Parallel spawn rules**:

| Mode | Stage | Spawn Behavior |
|------|-------|---------------|
| quick | All stages | One worker at a time (serial pipeline) |
| standard/deep | EXPLORE phase | Spawn all EXPLORE-001..N in parallel |
| standard/deep | ANALYZE phase | Spawn all ANALYZE-001..N in parallel |
| all | DISCUSS phase | One discussant at a time |
| all | SYNTH phase | One synthesizer |

5. **STOP** after spawning -- wait for next callback

### handleCheck

Output current pipeline status without advancing.

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
Pipeline Status (<mode> mode):
  [DONE]  EXPLORE-001  (explorer)     -> exploration-001.json
  [DONE]  EXPLORE-002  (explorer)     -> exploration-002.json
  [DONE]  ANALYZE-001  (analyst)      -> analysis-001.json
  [RUN]   ANALYZE-002  (analyst)      -> analyzing...
  [WAIT]  DISCUSS-001  (discussant)   -> blocked by ANALYZE-002
  [----]  SYNTH-001    (synthesizer)  -> blocked by DISCUSS-001

Discussion Rounds: 0/<max>
Pipeline Mode: <mode>
Session: <session-id>
```

Output status -- do NOT advance pipeline.

### handleResume

Resume pipeline after user pause or interruption.

1. Audit task list for inconsistencies:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. Proceed to handleSpawnNext

### handleComplete

Triggered when all pipeline tasks are completed.

**Completion check**:

| Mode | Completion Condition |
|------|---------------------|
| quick | EXPLORE-001 + ANALYZE-001 + SYNTH-001 all completed |
| standard | All EXPLORE + ANALYZE + DISCUSS-001 + SYNTH-001 completed |
| deep | All EXPLORE + ANALYZE + all DISCUSS-N + SYNTH-001 completed |

1. Verify all tasks completed. If any not completed, return to handleSpawnNext
2. If all completed, **inline-execute coordinator Phase 5** (shutdown workers → report → completion action). Do NOT STOP here — continue directly into Phase 5 within the same turn.

## Phase 4: State Persistence

After every handler execution **except handleComplete**:

1. Update session.json with current state:
   - `discussion_round`: current round count
   - `last_event`: event type and timestamp
   - `active_tasks`: list of in-progress task IDs
2. Verify task list consistency (no orphan tasks, no broken dependencies)
3. **STOP** and wait for next event

> **handleComplete exception**: handleComplete does NOT STOP — it transitions directly to coordinator Phase 5.

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Worker callback but task not completed | Log warning, reset task to pending, include in next handleSpawnNext |
| Worker spawn fails | Retry once. If still fails, report to user via request_user_input: retry / skip / abort |
| Discussion loop exceeds max rounds | Force create SYNTH-001, proceed to synthesis |
| Synthesis fails | Report partial results from analyses and discussions |
| Pipeline stall (no ready + no running) | Check blockedBy chains, report blockage to user |
| Missing task artifacts | Log warning, continue with available data |
