# Convergence Criteria — Adversarial Edition

When does the swarm stop? Two-layer convergence: Python signal + adversarial debate.

## Two-Layer Convergence

Unlike team-swarm (Python-only), adversarial-swarm uses two layers:

```
Layer 1: Python aco.py converged → signal (data-driven)
Layer 2: wf-swarm-converge → adversarial debate (judgment-driven)
```

Python provides the raw signal (stagnation, entropy, budget). The Workflow module
runs a prosecutor/defender/judge debate to make the final call.

## Python Stop Conditions (any-of)

| Criterion | Default | Description |
|-----------|---------|-------------|
| `max_iterations` | 5 | Hard cap — always triggers |
| `stagnation` | patience=2 | Best score unchanged for N iterations |
| `entropy_floor` | 0.5 | Pheromone entropy below threshold |
| `budget_tokens` | 100000 | Total token cost exceeded |
| `target_score` | 0.95 | Best verified_score crosses target |

## Adversarial Override

The Python signal is an INPUT to the adversarial debate, not the final decision:

| Python says | Adversarial debate can |
|-------------|----------------------|
| converged=true | Override to CONTINUE if prosecutor makes strong case (rare) |
| converged=false | Override to STOP if defender makes strong case (quality sufficient) |
| max_iterations reached | MUST converge (no override — hard safety net) |

## Debate Decision Rules

From wf-swarm-converge.js:

1. `iteration >= max_iterations` → MUST converge (no debate needed)
2. `iteration == 1` → MUST NOT converge (too early)
3. Stagnation signal + defender confidence > 60% → converge
4. Prosecutor confidence > 80% + best score < 0.5 → continue (insufficient quality)
5. Defender concedes major points → continue
6. Prosecutor concedes major points → stop
7. Otherwise → weigh evidence quality

## Configuration

```json
{
  "convergence": {
    "max_iterations": 5,
    "stagnation": { "enabled": true, "patience": 2, "min_delta": 0.01 },
    "entropy_floor": { "enabled": true, "threshold": 0.5 },
    "budget_tokens": { "enabled": false, "max": 100000 },
    "target_score": { "enabled": true, "value": 0.95 }
  }
}
```

## Why Two-Layer

Single-layer convergence is fragile:
- Python-only misses qualitative signals (solution is "good enough" even if score plateau isn't reached)
- LLM-only is unreliable for numeric comparisons (misreads stagnation signals)
- Combined: Python provides hard data, adversarial debate provides judgment

## Anti-Patterns

- DO NOT disable `max_iterations` — runaway risk
- DO NOT use `stagnation.patience < 2` — noise triggers false stops
- DO NOT skip the adversarial debate for iteration 1 — just force the outcome
- DO NOT let prosecutor override `max_iterations` — hard cap is sacred
