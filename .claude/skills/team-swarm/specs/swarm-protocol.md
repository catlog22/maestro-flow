

# Swarm Protocol

Master protocol document for team-swarm: defines how the LLM coordinator and Python ACO controller interface, how ants explore the task space, and how exploration results flow back to update pheromone state.

## Design Philosophy

| Principle | Rationale |
|-----------|-----------|
| **Outer loop = script, inner loop = LLM** | Optimization math is cheap and deterministic; LLM evaluation is expensive and noisy. Separate them. |
| **Coordinator is a hybrid** | LLM coordinator translates user intent + dispatches workers; Python script makes all numeric decisions (selection, update, convergence). |
| **Schema-locked ant output** | LLM output → algorithm input bridge demands strict JSON contract. Free-text outputs cannot feed pheromone updates. |
| **Two-layer scoring** | `self_score` (LLM self-report) is fast but optimistic. `verified_score` (script or LLM scorer) is the only authoritative input to pheromone update. |
| **Universal task space** | Coordinator does not bake in any domain. User provides `swarm-config.json` with task space + scoring rule. |

## Three-Component Architecture

```
+-----------------------------------------------------+
|  LLM Coordinator (roles/coordinator/role.md)       |
|  - Parses user task → emits swarm-config.json       |
|  - Phase 3 main loop: calls script, spawns workers  |
|  - Translates worker callbacks back into script ops |
+--------+--------------------------------------------+
         | Bash subprocess
         v
+-----------------------------------------------------+
|  Python ACO Controller (scripts/aco.py)            |
|  - CLI subcommands: init/select/update/converged    |
|  - Owns pheromone matrix + elite tracker            |
|  - Pure functions of session state files            |
+-----------------------------------------------------+
         ^                                  |
         | reads {run_dir}/outputs/ant-*.json | writes pheromone/*.json
         |                                  v
+-----------------------------------------------------+
|  LLM Workers (team-worker agents)                  |
|  - ant: explores assigned path, writes JSON         |
|  - scorer: assigns verified_score (optional)        |
|  - analyst: final synthesis of elite solutions      |
+-----------------------------------------------------+
```

## Iteration Lifecycle

```
[Coordinator] init phase
  └─> python aco.py init --config {run_dir}/work/team/swarm-config.json
       └─> writes pheromone/current.json + task-space.json

[Coordinator] iteration k (k = 1..K):
  ├─> python aco.py select --iter k
  │    └─> returns N ant assignments (paths to explore)
  ├─> TaskCreate × N ant tasks
  ├─> spawn N × team-worker(ant) in background
  └─> STOP (await all callbacks)
  
[Callback] all ants done → handleIterationComplete
  ├─> (optional) spawn scorer worker → verified_scores.json
  ├─> python aco.py update --iter k
  │    └─> reads {run_dir}/outputs/ant-k-*.json + verified_scores
  │    └─> updates pheromone + elite + history
  ├─> python aco.py converged
  │    └─> {converged: true|false, reason: ...}
  └─> converged → Phase 4; else → iteration k+1

[Coordinator] Phase 4: converge
  ├─> python aco.py report → best.json
  ├─> spawn analyst worker → best-solution.md
  └─> completion action (Archive/Keep/Export)
```

## Script ↔ Coordinator Contract

All scripts MUST:
- Read from `{run_dir}/work/team/...` (session path passed via `--session` flag)
- Write JSON to stdout for coordinator parsing (no prose)
- Use exit code 0 = success, 1 = error, 2 = config invalid
- Be idempotent: calling `update` twice for same iteration is safe

| Subcommand | Input | Output (stdout JSON) | Side effects |
|------------|-------|---------------------|--------------|
| `init` | swarm-config.json | `{status, pheromone_path, n_nodes}` | writes pheromone/current.json, task-space.json |
| `select --iter k` | pheromone/current.json, swarm-config.json | `{iteration, assignments: [{ant_id, path_hints, ...}]}` | none |
| `update --iter k` | {run_dir}/outputs/ant-k-*.json, optional verified_scores.json | `{iteration, mean_score, best_score, delta, elite_updated}` | writes pheromone/current.json (overwrite) + pheromone/history/k.json + trails/k.jsonl + best.json |
| `converged` | history/, best.json, config | `{converged: bool, reason: str, metrics: {...}}` | none |
| `report` | best.json, history/ | full JSON: `{best, top_k, convergence_curve, ...}` | none |

## Data Flow Boundaries

| Boundary | Owner | Format |
|----------|-------|--------|
| User intent → config | LLM coordinator | swarm-config.json |
| Pheromone state | Python script | pheromone/current.json |
| Ant assignment → ant prompt | LLM coordinator (templated) | injected into role-spec at spawn |
| Ant exploration → artifact | LLM ant | {run_dir}/outputs/ant-k-id.json (schema-locked) |
| Artifact → pheromone update | Python script | reads artifacts, computes delta tau |
| Elite solutions → human report | LLM analyst | {run_dir}/outputs/best-solution.md |

## Why Hybrid Coordinator (Not Pure Script)

- User input is natural language → needs LLM to map to swarm-config
- Worker spawning, message routing, session management → all framework-bound to LLM coordinator
- Script as a sub-tool keeps the same team-* lifecycle (spawn-and-stop, callback-driven)
- Same pattern as `maestro delegate` — Bash-callable subprocess from inside an LLM role

## Universality

`team-swarm` is task-agnostic. Specialization happens via:
1. `swarm-config.json#task_space` — defines what nodes/edges/paths mean
2. `swarm-config.json#scoring` — defines how to compute verified_score
3. `swarm-config.json#ant_prompt` — defines what ant should actually do at each node

Example domains the same skill handles:
- Code exploration (nodes = files/modules, score = suspicious code density)
- Test case generation (nodes = code paths, score = coverage delta)
- Refactor strategy search (nodes = refactor moves, score = complexity reduction)
- Hyperparameter tuning (nodes = param choices, score = metric improvement)
