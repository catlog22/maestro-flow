# Pheromone Schema

Pheromone matrix structure, update formula, evaporation rule.
Authoritative spec for `pheromone/current.json` and history snapshots.

Inherited from team-swarm — ACO math is identical.

## File Layout

```
<session>/pheromone/
├── current.json         # latest state, overwritten each iteration
├── history/
│   ├── 1.json           # snapshot after iteration 1
│   ├── 2.json
│   └── ...
└── init.json            # snapshot of initial state (immutable)
```

## Schema (pheromone/current.json)

```json
{
  "version": "1.0",
  "iteration": 3,
  "n_nodes": 42,
  "matrix_type": "edge_weighted_sparse",
  "tau": {
    "<node_a>::<node_b>": 0.85,
    "<node_a>::<node_c>": 1.20
  },
  "node_tau": {
    "<node_a>": 0.92,
    "<node_b>": 1.05
  },
  "metadata": {
    "alpha": 1.0,
    "beta": 2.0,
    "rho": 0.2,
    "q": 1.0,
    "tau_init": 1.0,
    "tau_min": 0.01,
    "tau_max": 10.0
  },
  "stats": {
    "mean": 0.91,
    "max": 2.34,
    "min": 0.05,
    "entropy": 3.21,
    "n_edges_active": 87
  }
}
```

## Update Formula

After iteration k, for each ant a:

```
delta_tau_a(edge) = q * verified_score_a  if edge in path_a, else 0
```

Then:

```
tau(edge) = (1 - rho) * tau(edge) + sum_over_ants(delta_tau_a(edge))
tau(edge) = clip(tau(edge), tau_min, tau_max)
```

**Note**: In adversarial-swarm, `verified_score` comes from the 3-vote adversarial scoring
module (wf-swarm-score) rather than a single scorer. The pheromone math is identical —
only the score source changes.

## Selection Probability

```
p(i -> j) = (tau(i,j)^alpha * eta(i,j)^beta) / sum_{k in N(i)}(tau(i,k)^alpha * eta(i,k)^beta)
```

## Path-Hints vs Full-Path

`aco.py select` returns weighted starting nodes + edge probabilities.
Ant agents make actual node-by-node choices with freedom to deviate.

## Entropy as Convergence Signal

Shannon entropy of normalized pheromone:
- High H → diverse exploration (early stage)
- Low H → concentrated on few paths (converging)
- Used by both Python `converged` check AND adversarial convergence debate
