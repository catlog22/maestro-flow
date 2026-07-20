
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# Command: converge

## Workflow

### Step 1: Call aco.py report

```
Bash: python <skill_root>/scripts/aco.py --session {run_dir}/work/team report
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

Save full report to `{run_dir}/outputs/swarm-report.json` (raw data for analyst).

### Step 2: Spawn analyst worker

```
spawn_agent({
  subagent_type: "team-worker",
  description: "Spawn analyst for swarm synthesis",
  team_name: "swarm",
  name: "analyst",
  run_in_background: true,
  prompt: `## Role Assignment
role: analyst
role_spec: <skill_root>/roles/analyst/role.md
session: <session_path>
session_id: <run-id>
team_name: swarm
requirement: synthesize swarm results into human-readable best-solution.md
inner_loop: false

## Context
Report data: {run_dir}/outputs/swarm-report.json
Best solution: {run_dir}/work/team/best.json
All trails: {run_dir}/work/team/trails/*.jsonl
Original objective: <config.ant_prompt.objective>

## Progress Milestones
Report via team_msg at: report loaded -> synthesis done -> verification done.
Report completion via team_msg type="task_complete" after final send_message.`
})
```

STOP. Resume on analyst callback.

### Step 3: On analyst callback

Verify `{run_dir}/outputs/best-solution.md` exists.

If missing -> request_user_input (skip synthesis / retry analyst).

### Step 3.5: Run lifecycle completion

```
  +- Run lifecycle completion:
  |   - Read run_id from team-session.json.run.run_id
  |   - Write {run_dir}/report.md with frontmatter (verdict/summary/concerns)
  |   - Run `maestro run complete <run_id>`
  |   - If complete fails: fix the blocking gate and retry once; still failing -> do NOT archive/clean - keep the team active (status=paused) and report the blocking gate
```

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
[coordinator]   - {run_dir}/outputs/best-solution.md (analyst synthesis)
[coordinator]   - {run_dir}/outputs/swarm-report.json (raw data)
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
