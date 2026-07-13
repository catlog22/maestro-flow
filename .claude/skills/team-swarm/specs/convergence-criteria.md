

# Convergence Criteria

When does the swarm stop iterating? Defines stop conditions computed by `aco.py converged`.

## Stop Conditions (any-of)

The swarm stops when **any** of the configured criteria triggers:

| Criterion | Default | Description |
|-----------|---------|-------------|
| `max_iterations` | 5 | Hard cap on iteration count |
| `stagnation` | patience = 2 | Best score unchanged for N iterations |
| `entropy_floor` | 0.5 | Pheromone Shannon entropy drops below threshold (matrix highly concentrated) |
| `budget_tokens` | 100000 | Total token cost exceeds budget |
| `target_score` | 0.95 | Best verified_score crosses target |

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

## Output Schema (aco.py converged)

```json
{
  "converged": true,
  "iteration": 4,
  "reason": "stagnation",
  "metrics": {
    "best_score": 0.78,
    "mean_score": 0.62,
    "entropy": 1.85,
    "iterations_completed": 4,
    "iterations_since_best_change": 2,
    "total_tokens_used": 42000
  },
  "triggered_by": ["stagnation"],
  "recommendation": "best solution is stable; recommend report"
}
```

## Selection Logic

```
def check_convergence(history, config):
    triggered = []
    
    if iteration >= config.max_iterations:
        triggered.append("max_iterations")
    
    if config.stagnation.enabled:
        recent = history[-config.stagnation.patience-1:]
        if len(recent) > config.stagnation.patience:
            deltas = [abs(recent[i].best - recent[i-1].best) 
                      for i in range(1, len(recent))]
            if all(d < config.stagnation.min_delta for d in deltas):
                triggered.append("stagnation")
    
    if config.entropy_floor.enabled and current_entropy < threshold:
        triggered.append("entropy_floor")
    
    if config.budget_tokens.enabled and total_tokens > config.budget_tokens.max:
        triggered.append("budget_tokens")
    
    if config.target_score.enabled and best_score >= config.target_score.value:
        triggered.append("target_score")
    
    return {"converged": len(triggered) > 0, "triggered_by": triggered}
```

## Entropy Calculation

Shannon entropy of normalized pheromone distribution:

```
p_i = tau_i / sum(tau)  for each active edge
H = -sum(p_i * log2(p_i))
```

- High H → diverse exploration (early stage)
- Low H → concentrated on few paths (converging)
- H < threshold + best score plateau → safe to stop

## Why Multi-Criterion

Single criterion is fragile:
- `max_iterations` alone wastes budget if converged early
- `stagnation` alone may stop too early on noisy scoring
- `entropy_floor` alone may trigger before useful solutions emerge

Combination = early termination when safe, but always bounded by `max_iterations`.

## Anti-Patterns

- DO NOT use `stagnation` with `patience < 2` — noise will trigger false stops
- DO NOT disable `max_iterations` — runaway risk
- DO NOT set `target_score` without verified scoring — self_score is too optimistic
