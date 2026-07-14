
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: converge

## Workflow

### Step 1: Call aco.py report

```
Bash: python <skill_root>/scripts/aco.py --session <session> report
```

Parse stdout JSON. Expected:
```json
{
  "status": "ok",
  "best": { ant_id, iteration, path, score, candidate_solution, evidence, ... },
  "top_k": [<top 5 trails>],
  "convergence_curve": [{iteration, entropy, tau_max, tau_mean}, ...],
  "final_pheromone_stats": {...},
  "iterations_completed": <int>
}
```

Save full report to `<session>/artifacts/swarm-report.json` (raw data for analyst).

### Step 2: Spawn analyst worker

```
spawn_agent({ task_name: "analyst", message: "Spawn analyst for swarm synthesis", fork_turns: "none" })
```

STOP. Resume on analyst callback.

### Step 3: On analyst callback

Verify `<session>/artifacts/best-solution.md` exists.

If missing -> request_user_input (skip synthesis / retry analyst).

### Step 4: Build completion summary

```
[coordinator] ============================================
[coordinator] SWARM CONVERGED
[coordinator]
[coordinator] Iterations: <iterations_completed> / <max_iterations>
[coordinator] Trigger: <triggered_by[0]>
[coordinator] Total ants spawned: <iterations * n_ants>
[coordinator]
[coordinator] Best Solution:
[coordinator]   ant_id: <best.ant_id>
[coordinator]   iteration: <best.iteration>
[coordinator]   path: <best.path joined with " -> ">
[coordinator]   verified_score: <best.score>
[coordinator]   summary: <best.candidate_solution.summary>
[coordinator]
[coordinator] Convergence curve (entropy):
[coordinator]   iter 1: <e1>  iter 2: <e2>  iter 3: <e3>  ...
[coordinator]
[coordinator] Deliverables:
[coordinator]   - artifacts/best-solution.md (analyst synthesis)
[coordinator]   - artifacts/swarm-report.json (raw data)
[coordinator]   - best.json (canonical best)
[coordinator]   - trails/*.jsonl (full exploration log)
[coordinator]
[coordinator] Session: <session_path>
[coordinator] ============================================
```

### Step 5: Update session state

```
session.status = "completed"
session.converged_at = <iso8601>
session.convergence_reason = <triggered_by>
```

Log state_update:
```
team_msg.log({
  type: "state_update",
  summary: "Swarm pipeline complete: <iterations_completed> iters, best=<score>",
  data: { ... }
})
```

### Step 6: Completion action (interactive)

```
request_user_input({
  questions: [{
    question: "Swarm pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, delete team" },
      { label: "Keep Active", description: "Preserve for follow-up iteration" },
      { label: "Export Best Solution", description: "Copy best-solution.md to target path" },
      { label: "Run Another Round", description: "Reset convergence, run K more iterations from current pheromone" }
    ]
  }]
})
```

### Action Handlers

| Choice | Steps |
|--------|-------|
| Archive & Clean | session.status = "completed"; TeamDelete; output final summary |
| Keep Active | session.status = "paused"; output resume instructions |
| Export Best Solution | request_user_input(target path); copy best-solution.md + best.json; then Archive & Clean |
| Run Another Round | request_user_input(additional K); reset convergence counters; re-enter Phase 3 iterate.md |

## Failure Cases

| Failure | Action |
|---------|--------|
| `aco.py report` fails | Read best.json directly + manual top-K from trails/ |
| Analyst worker crashes | Generate minimal best-solution.md from best.json template |
| best.json missing | Pipeline ran but no successful ant - report failure, keep session for inspection |
| Run Another Round chosen but max_iterations already at limit | request_user_input to raise the cap before continuing |
