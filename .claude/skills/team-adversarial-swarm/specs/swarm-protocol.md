

# Swarm Protocol — Adversarial Edition

Defines how the SKILL.md coordinator, Python ACO controller, and modular Workflow scripts interface.

## Design Philosophy

| Principle | Rationale |
|-----------|-----------|
| **Outer loop = coordinator, inner loop = Workflow** | Coordinator drives iteration lifecycle; Workflow scripts handle multi-agent parallelism |
| **ACO math = Python script** | Optimization math is cheap and deterministic; kept in Python for correctness |
| **Exploration = Workflow agents** | LLM agents explore task space in parallel via `parallel()` |
| **Every decision = adversarial** | No single-agent verdicts — scoring, convergence, synthesis all use adversarial patterns |
| **Schema-locked ant output** | Same contract as team-swarm; LLM output → algorithm input via strict JSON |
| **Modular composition** | 4 independent Workflow scripts, composable in any order |

## Three-Component Architecture

```
+-----------------------------------------------------+
|  SKILL.md Coordinator                               |
|  - Parses user task → emits swarm-config.json       |
|  - Iteration loop: calls Python + Workflow modules  |
|  - Data bridge between Workflow calls               |
+--------+--------------------------------------------+
         | Bash subprocess     | Workflow({scriptPath})
         v                     v
+---------------------+  +--------------------------------+
|  Python ACO         |  |  Workflow Modules (4x)          |
|  scripts/aco.py     |  |  wf-swarm-explore.js            |
|  - init/select/     |  |  wf-swarm-score.js              |
|    update/converge  |  |  wf-swarm-converge.js           |
|  - Owns pheromone   |  |  wf-swarm-synthesize.js         |
+---------------------+  |  - parallel()/pipeline() agents |
                          |  - Adversarial decision gates   |
                          +--------------------------------+
```

## Iteration Lifecycle

```
[Coordinator] Phase 1: generate swarm-config.json
[Coordinator] Phase 2: python aco.py init

[Coordinator] Phase 3: iteration k = 1..K
  ├─ python aco.py select --iter k → assignments
  ├─ Workflow(wf-swarm-explore, args={assignments...}) → ant_results
  ├─ Workflow(wf-swarm-score, args={ant_results...}) → verified_scores
  ├─ Write scores → python aco.py update --iter k → pheromone updated
  ├─ Workflow(wf-swarm-converge, args={best, history...}) → {converged}
  └─ if converged: break

[Coordinator] Phase 4:
  ├─ python aco.py report → best + top_k + curve
  └─ Workflow(wf-swarm-synthesize, args={best, top_k...}) → best-solution.md
```

## Script ↔ Coordinator Contract

Same as team-swarm. All scripts:
- Read from `{run_dir}/work/team/...` (via `--session` flag)
- Emit JSON to stdout
- Exit 0 = success, 1 = error, 2 = config invalid
- Idempotent: calling update twice for same iteration is safe

| Subcommand | Input | Output (stdout JSON) | Side effects |
|------------|-------|---------------------|--------------|
| `init` | swarm-config.json | `{status, pheromone_path, n_nodes}` | writes pheromone/current.json, task-space.json |
| `select --iter k` | pheromone/current.json | `{assignments: [{ant_id, path_hints, ...}]}` | none |
| `update --iter k` | {run_dir}/outputs/ant-k-*.json, scores | `{mean_score, best_score, delta}` | writes pheromone + trails + best.json |
| `converged` | history/, best.json, config | `{converged, reason, metrics}` | none |
| `report` | best.json, history/ | full report JSON | none |

## Coordinator ↔ Workflow Contract

Each Workflow module receives `args` and returns structured JSON.

| Module | args (input) | return (output) |
|--------|-------------|-----------------|
| explore | `{iteration, assignments[], objective, session, config, task_space, wisdom}` | `{ant_results[], metadata}` |
| score | `{iteration, ant_results[], objective, rubric}` | `{votes, calibration, metadata}` |
| converge | `{iteration, best, history[], config}` | `{converged, reason, confidence, debate}` |
| synthesize | `{best, top_k[], convergence_story, objective, total_iterations, total_ants}` | `{perspectives, synthesis, metadata}` |

**Key rule**: Coordinator writes ant artifacts and scores to disk BETWEEN Workflow calls.
Workflow agents can read files but structured data flows through args/return.

## Adversarial Patterns by Module

| Module | Pattern | Agents per decision |
|--------|---------|-------------------|
| explore | Parallel ants + cross-validation | N ants + N validators |
| score | Prosecutor/Defender/Judge per ant | 3 × N ants + 1 calibrator |
| converge | Prosecutor(continue) / Defender(stop) / Judge | 3 agents |
| synthesize | 3-perspective (why-won/stability/caveats) + Arbitrator | 4 agents |

## vs team-swarm Protocol

| Aspect | team-swarm | team-adversarial-swarm |
|--------|-----------|----------------------|
| Worker spawning | Agent(team-worker) + callback | Workflow parallel()/pipeline() |
| Scoring | Single scorer OR script | 3-vote adversarial per ant |
| Convergence | Python script only | Python signal + adversarial debate |
| Synthesis | Single analyst | 3-perspective + arbitrator |
| Session management | TeamCreate + team_msg | Coordinator direct file I/O |
| Data flow | Message bus + file artifacts | args → Workflow → return + files |
