
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Monitor

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session state | {run_dir}/work/team/team-session.json | Yes |
| Task list | list_agents() | Yes |
| Trigger event | From Entry Router detection | Yes |
| Pipeline definition | From SKILL.md | Yes |

1. Load team-session.json for current state, `parallel_mode`, `branches`, `fix_cycles`
2. Run list_agents() to get current task statuses
3. Identify trigger event type from Entry Router

## Phase 3: Event Handlers

### handleCallback

Triggered when a worker sends completion message.

1. Parse message to identify role, task ID, and **branch/pipeline label**:

| Message Pattern | Branch Detection |
|----------------|-----------------|
| `[optimizer-B01]` or task ID `IMPL-B01` | Branch `B01` (fan-out) |
| `[profiler-A]` or task ID `PROFILE-A01` | Pipeline `A` (independent) |
| `[profiler]` or task ID `PROFILE-001` | No branch (single) |

2. Mark task as completed:

```
update_plan({ taskId: "<task-id>", status: "completed" })
```

3. Record completion in session state

4. **CP-2.5 check** (auto/fan-out mode only):
   - If completed task is STRATEGY-001 AND `parallel_mode` is `auto` or `fan-out`:
   - Execute **CP-2.5 Branch Creation** subroutine from dispatch.md
   - After branch creation, proceed to handleSpawnNext (spawns all IMPL-B* in parallel)
   - STOP after spawning

5. Check if checkpoint feedback is configured for this stage:

| Completed Task | Checkpoint | Action |
|---------------|------------|--------|
| PROFILE-001 / PROFILE-{P}01 | CP-1 | Notify user: bottleneck report ready for review |
| STRATEGY-001 / STRATEGY-{P}01 | CP-2 | Notify user: optimization plan ready for review |
| STRATEGY-001 (auto/fan-out) | CP-2.5 | Execute branch creation, then notify user with branch count |
| BENCH-* or REVIEW-* | CP-3 | Check verdicts per branch (see Review-Fix Cycle below) |

6. Proceed to handleSpawnNext

### handleSpawnNext

Find and spawn the next ready tasks.

1. Scan task list for tasks where:
   - Status is "pending"
   - All blockedBy tasks have status "completed"

2. For each ready task, spawn team-worker:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none", agent_type: "team_worker" })
```

3. **Parallel spawn rules by mode**:

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| Single | Stage 4 ready | Spawn BENCH-001 + REVIEW-001 in parallel |
| Fan-out (CP-2.5 done) | All IMPL-B* unblocked | Spawn ALL IMPL-B* in parallel |
| Fan-out (IMPL-B{NN} done) | BENCH-B{NN} + REVIEW-B{NN} ready | Spawn both for that branch in parallel |
| Independent | Any unblocked task | Spawn all ready tasks across all pipelines in parallel |

4. STOP after spawning -- wait for next callback

### Review-Fix Cycle (CP-3)

**Per-branch/pipeline scoping**: Each branch/pipeline has its own independent fix cycle.

#### Single Mode (unchanged)

When both BENCH-001 and REVIEW-001 are completed:

1. Read benchmark verdict from shared-memory (benchmarker namespace)
2. Read review verdict from shared-memory (reviewer namespace)

| Bench Verdict | Review Verdict | Action |
|--------------|----------------|--------|
| PASS | APPROVE | -> handleComplete |
| PASS | REVISE | Create FIX task with review feedback |
| FAIL | APPROVE | Create FIX task with benchmark feedback |
| FAIL | REVISE/REJECT | Create FIX task with combined feedback |
| Any | REJECT | Create FIX task + flag for strategist re-evaluation |

#### Fan-out Mode (per-branch)

When both BENCH-B{NN} and REVIEW-B{NN} are completed for a specific branch:

1. Read benchmark verdict from `benchmarker.B{NN}` namespace
2. Read review verdict from `reviewer.B{NN}` namespace
3. Apply same verdict matrix as single mode, but scoped to this branch only
4. **Other branches are unaffected** -- they continue independently

#### Independent Mode (per-pipeline)

When both BENCH-{P}01 and REVIEW-{P}01 are completed for a specific pipeline:

1. Read verdicts from `benchmarker.{P}` and `reviewer.{P}` namespaces
2. Apply same verdict matrix, scoped to this pipeline only

#### Fix Cycle Count Tracking

Fix cycles are tracked per branch/pipeline in `team-session.json`:

```json
// Single mode
{ "fix_cycles": { "main": 0 } }

// Fan-out mode
{ "fix_cycles": { "B01": 0, "B02": 1, "B03": 0 } }

// Independent mode
{ "fix_cycles": { "A": 0, "B": 2 } }
```

| Cycle Count | Action |
|-------------|--------|
| < 3 | Create FIX task, increment cycle count for this branch/pipeline |
| >= 3 | Escalate THIS branch/pipeline to user. Other branches continue |

#### FIX Task Creation (branched)

**Fan-out mode**:
```
update_plan({
  subject: "FIX-B{NN}-{cycle}",
  description: "PURPOSE: Fix issues in branch B{NN} from review/benchmark | Success: All flagged issues resolved
TASK:
  - Address review findings: <specific-findings>
  - Fix benchmark regressions: <specific-regressions>
  - Re-validate after fixes
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: branches/B{NN}/review-report.md, branches/B{NN}/benchmark-results.json
  - Shared memory: {run_dir}/work/team/.msg/meta.json (namespace: optimizer.B{NN})
EXPECTED: Fixed source files for B{NN} only
CONSTRAINTS: Targeted fixes only | Do not touch other branches
---
InnerLoop: false
BranchId: B{NN}",
  status: "pending"
})
```

Create new BENCH and REVIEW with retry suffix:
- `BENCH-B{NN}-R{cycle}` blocked on `FIX-B{NN}-{cycle}`
- `REVIEW-B{NN}-R{cycle}` blocked on `FIX-B{NN}-{cycle}`

**Independent mode**:
```
update_plan({
  subject: "FIX-{P}01-{cycle}",
  ...same pattern with pipeline prefix...
  status: "pending"
})
```

Create `BENCH-{P}01-R{cycle}` and `REVIEW-{P}01-R{cycle}`.

### handleCheck

Output current pipeline status grouped by branch/pipeline.

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

**Single mode** (unchanged):
```
Pipeline Status:
  [DONE]  PROFILE-001  (profiler)    -> bottleneck-report.md
  [DONE]  STRATEGY-001 (strategist)  -> optimization-plan.md
  [RUN]   IMPL-001     (optimizer)   -> implementing...
  [WAIT]  BENCH-001    (benchmarker) -> blocked by IMPL-001
  [WAIT]  REVIEW-001   (reviewer)    -> blocked by IMPL-001

Fix Cycles: 0/3
Session: <run-id>
```

**Fan-out mode**:
```
Pipeline Status (fan-out, 3 branches):
  Shared Stages:
    [DONE]  PROFILE-001  (profiler)    -> bottleneck-report.md
    [DONE]  STRATEGY-001 (strategist)  -> optimization-plan.md (4 OPT-IDs)

  Branch B01 (OPT-001: <title>):
    [RUN]   IMPL-B01     (optimizer)   -> implementing...
    [WAIT]  BENCH-B01    (benchmarker) -> blocked by IMPL-B01
    [WAIT]  REVIEW-B01   (reviewer)    -> blocked by IMPL-B01
    Fix Cycles: 0/3

  Branch B02 (OPT-002: <title>):
    [DONE]  IMPL-B02     (optimizer)   -> done
    [RUN]   BENCH-B02    (benchmarker) -> benchmarking...
    [RUN]   REVIEW-B02   (reviewer)    -> reviewing...
    Fix Cycles: 0/3

  Branch B03 (OPT-003: <title>):
    [FAIL]  IMPL-B03     (optimizer)   -> failed
    Fix Cycles: 0/3 [BRANCH FAILED]

Session: <run-id>
```

**Independent mode**:
```
Pipeline Status (independent, 2 pipelines):
  Pipeline A (target: optimize rendering):
    [DONE]  PROFILE-A01  -> [DONE]  STRATEGY-A01 -> [RUN] IMPL-A01 -> ...
    Fix Cycles: 0/3

  Pipeline B (target: optimize API):
    [DONE]  PROFILE-B01  -> [DONE]  STRATEGY-B01 -> [DONE] IMPL-B01 -> ...
    Fix Cycles: 1/3

Session: <run-id>
```

Output status -- do NOT advance pipeline.

### handleResume

Resume pipeline after user pause or interruption.

1. Audit task list for inconsistencies:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. For fan-out/independent: check each branch/pipeline independently
3. Proceed to handleSpawnNext

### handleConsensus

Handle consensus_blocked signals from discuss rounds.

| Severity | Action |
|----------|--------|
| HIGH | Pause pipeline (or branch), notify user with findings summary |
| MEDIUM | Create revision task for the blocked role (scoped to branch if applicable) |
| LOW | Log finding, continue pipeline |

### handleComplete

Triggered when all pipeline tasks are completed and no fix cycles remain.

**Completion check varies by mode**:

| Mode | Completion Condition |
|------|---------------------|
| Single | All 5 tasks (+ any FIX/retry tasks) have status "completed" |
| Fan-out | ALL branches have BENCH + REVIEW completed with PASS/APPROVE (or escalated), shared stages done |
| Independent | ALL pipelines have BENCH + REVIEW completed with PASS/APPROVE (or escalated) |

**Aggregate results** before transitioning to Phase 5:

1. For fan-out mode: collect per-branch benchmark results into `{run_dir}/outputs/aggregate-results.json`:
   ```json
   {
     "branches": {
       "B01": { "opt_id": "OPT-001", "bench_verdict": "PASS", "review_verdict": "APPROVE", "improvement": "..." },
       "B02": { "opt_id": "OPT-002", "bench_verdict": "PASS", "review_verdict": "APPROVE", "improvement": "..." },
       "B03": { "status": "failed", "reason": "IMPL failed" }
     },
     "overall": { "total_branches": 3, "passed": 2, "failed": 1 }
   }
   ```

2. For independent mode: collect per-pipeline results similarly

3. If any tasks not completed, return to handleSpawnNext
4. If all completed (allowing for failed branches marked as such), transition to coordinator Phase 5

### handleRevise

Triggered by user "revise <TASK-ID> [feedback]" command.

1. Parse target task ID and optional feedback
2. Detect branch/pipeline from task ID pattern
3. Create revision task with same role but updated requirements, scoped to branch
4. Skip addBlockedBy (no dependencies, immediate execution)
5. Cascade: create new downstream tasks within same branch only
6. Proceed to handleSpawnNext

### handleFeedback

Triggered by user "feedback <text>" command.

1. Analyze feedback text to determine impact scope
2. Identify which pipeline stage, role, and branch/pipeline should handle the feedback
3. Create targeted revision task (scoped to branch if applicable)
4. Proceed to handleSpawnNext

## Phase 4: State Persistence

After every handler execution:

1. Update team-session.json with current state (active tasks, fix cycle counts per branch, last event, resolved parallel_mode)
2. Verify task list consistency
3. STOP and wait for next event
