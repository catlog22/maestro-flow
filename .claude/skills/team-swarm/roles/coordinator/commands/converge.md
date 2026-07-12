# Command: converge

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Phase 4 execution guide. Run after `aco.py converged` returns `true`.

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
Agent({
  subagent_type: "team-worker",
  description: "Spawn analyst for swarm synthesis",
  team_name: "swarm",
  name: "analyst",
  run_in_background: true,
  prompt: `## Role Assignment
role: analyst
role_spec: <skill_root>/roles/analyst/role.md
session: <session_path>
session_id: <session_id>
team_name: swarm
requirement: synthesize swarm results into human-readable best-solution.md
inner_loop: false

## Context
Report data: <session>/artifacts/swarm-report.json
Best solution: <session>/best.json
All trails: <session>/trails/*.jsonl
Original objective: <config.ant_prompt.objective>

## Progress Milestones
Report via team_msg at: report loaded -> synthesis done -> verification done.
Report completion via team_msg type="task_complete" after final SendMessage.`
})
```

STOP. Resume on analyst callback.

### Step 3: On analyst callback

Verify `<session>/artifacts/best-solution.md` exists.

If missing -> AskUserQuestion (skip synthesis / retry analyst).

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
AskUserQuestion({
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
| Export Best Solution | AskUserQuestion(target path); copy best-solution.md + best.json; then Archive & Clean |
| Run Another Round | AskUserQuestion(additional K); reset convergence counters; re-enter Phase 3 iterate.md |

## Failure Cases

| Failure | Action |
|---------|--------|
| `aco.py report` fails | Read best.json directly + manual top-K from trails/ |
| Analyst worker crashes | Generate minimal best-solution.md from best.json template |
| best.json missing | Pipeline ran but no successful ant - report failure, keep session for inspection |
| Run Another Round chosen but max_iterations already at limit | AskUserQuestion to raise the cap before continuing |
