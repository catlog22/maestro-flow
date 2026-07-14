
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: iterate

## Two Entry Points

| Entry | Trigger | Action |
|-------|---------|--------|
| **Iteration start** | Phase 3 invoked OR previous iteration converged=false | Run "Iteration Start" workflow |
| **Iteration end** | All ants of current iter reported via callback | Run "Iteration End" workflow |

## Iteration Start Workflow

### Step 1: Determine iteration number

```
k = session.iteration + 1
```

If `k > session.max_iterations`: force converge to Phase 4 (safety net).

### Step 2: Call aco.py select

```
Bash: python <skill_root>/scripts/aco.py --session <session> select --iter <k>
```

Parse stdout JSON. Expected:
```json
{
  "status": "ok",
  "iteration": <k>,
  "n_assignments": <N>,
  "assignments": [
    {
      "ant_id": "ANT-<k>-<i>",
      "start_node": "<node>",
      "edge_preferences": {"a::b": 0.4, ...},
      "max_path_length": <int>,
      "iteration": <k>
    }, ...
  ]
}
```

On error -> log to issues.md, request_user_input (retry / abort).

### Step 3: Create ant tasks

For each assignment:

```
create_goal({
  subject: "ANT-<k>-<i>: explore from <start_node>",
  description: "Session: <session_path>\nAssignment: <assignment JSON>\nObjective: <config.ant_prompt.objective>"
})
update_goal({ taskId: <new>, owner: "ant" })
```

Set the task ID to match `ANT-<k>-<i>` (or record mapping in `.msg/meta.json` if framework auto-assigns IDs).

### Step 4: Spawn N ant workers in parallel

For each assignment, spawn one team-worker:

```
spawn_agent({ task_name: "ant_<k>_<i>", message: "Spawn ant <ANT-k-i>", fork_turns: "none", agent_type: "team_worker" })
```

All N spawns in a single message (parallel).

### Step 5: Update session state

```
session.iteration = <k>  (mark "in progress")
session.active_workers = [<list of ant IDs>]
```

Log state_update:
```
team_msg.log({
  type: "state_update",
  summary: "Iteration <k> dispatched: <N> ants",
  data: { iteration: <k>, n_ants: <N>, status: "ants_running" }
})
```

### Step 6: STOP

Wait for ant callbacks. Each ant reports via team_msg(type="task_complete"). When ALL N reported, callback handler invokes "Iteration End" workflow.

---

## Iteration End Workflow

### Step 1: Verify completion

Check `ANT-<k>-*` task statuses. If any still in_progress: not yet complete, do nothing.

If all completed -> proceed.

### Step 2: (Conditional) Spawn scorer

If `config.scoring.mode == "llm"`:

```
spawn_agent({ task_name: "scorer_<k>", message: "<message>", fork_turns: "none", agent_type: "team_worker" })
```

STOP and await scorer callback. On callback resume at Step 3.

If `scoring.mode == "script"` or `"fallback"` -> proceed directly to Step 3.

### Step 3: Call aco.py update

```
Bash: python <skill_root>/scripts/aco.py --session <session> update --iter <k>
```

Parse stdout JSON. Expected:
```json
{
  "status": "ok",
  "iteration": <k>,
  "n_ants_processed": <N>,
  "mean_score": <float>,
  "best_score": <float>,
  "delta": <float>,
  "elite_updated": <bool>,
  "hallucinations_flagged": [<ant_ids>],
  "stats": {<pheromone stats>}
}
```

### Step 4: Log iteration result

```
team_msg.log({
  type: "state_update",
  summary: "Iter <k> done: best=<X>, mean=<Y>, delta=<Z>",
  data: { iteration: <k>, best_score, mean_score, delta, elite_updated, hallucinations_flagged }
})
```

If `hallucinations_flagged.length > N/2`: append warning to wisdom/issues.md (high-noise iteration).

### Step 5: Call aco.py converged

```
Bash: python <skill_root>/scripts/aco.py --session <session> converged
```

Parse:
```json
{ "converged": <bool>, "triggered_by": [...], "reason": "...", "metrics": {...} }
```

### Step 6: Branch on convergence

```
if converged:
    update session: completed_iterations.push(k), status = "converging"
    -> proceed to Phase 4 (converge.md)
else:
    update session: completed_iterations.push(k), active_workers = []
    -> re-enter "Iteration Start" workflow with k+1
```

### Step 7: Output progress to user

After each iteration:
```
[coordinator] Iteration <k>/<max> complete.
[coordinator]   best=<best_score>  mean=<mean_score>  delta=<delta>
[coordinator]   entropy=<entropy>  hallucinations=<count>
[coordinator]   Status: <converged | continuing to iter k+1>
```

---

## Edge Cases

| Condition | Handling |
|-----------|----------|
| Ant task failed | Mark task failed; if >50% failed in iter -> halt, request_user_input |
| Ant produced no artifact | Script's update will skip it; if all skipped -> error -> halt |
| `aco.py update` fails | Retry once; if persistent -> halt with error report |
| Scorer worker fails | Fall back to `script` or `fallback` mode for this iter, log warning |
| Iteration takes too long | After timeout (configurable), check `team_msg` for blockers |
| User sends `feedback <text>` mid-iteration | Append to wisdom/learnings.md; apply at next iteration start (not mid-iter) |
