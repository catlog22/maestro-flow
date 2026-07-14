

# Pheromone Schema

Pheromone matrix structure, update formula, evaporation rule. Authoritative spec for `pheromone/current.json` and history snapshots.

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
    "<node_a>::<node_c>": 1.20,
    "<node_x>::<node_y>": 0.13
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

### Field Semantics

| Field | Type | Meaning |
|-------|------|---------|
| `matrix_type` | enum | `edge_weighted_sparse` (default), `node_weighted`, `full_dense` |
| `tau` | dict | Edge pheromone, key `"a::b"` (undirected uses lexical order) |
| `node_tau` | dict | Node-level pheromone (used when matrix_type = node_weighted) |
| `metadata.alpha` | float | Pheromone weight in selection probability |
| `metadata.beta` | float | Heuristic weight in selection probability |
| `metadata.rho` | float | Evaporation rate (0..1), applied each iteration |
| `metadata.q` | float | Deposit constant |
| `metadata.tau_min/max` | float | MMAS bounds — prevents premature convergence/explosion |
| `stats.entropy` | float | Shannon entropy of normalized tau — convergence signal |

## Update Formula

After iteration k completes, for each ant a in iteration:

```
delta_tau_a(edge) = q * verified_score_a  if edge in path_a, else 0
```

Then:

```
tau(edge) = (1 - rho) * tau(edge) + sum_over_ants(delta_tau_a(edge))
tau(edge) = clip(tau(edge), tau_min, tau_max)
```

**Elitist strategy** (always on): the best path of all time deposits extra `q * best_score` on its edges before clipping.

## Selection Probability (used in `aco.py select`)

For ant at node i choosing neighbor j from candidate set N(i):

```
p(i -> j) = (tau(i,j)^alpha * eta(i,j)^beta) / sum_{k in N(i)}(tau(i,k)^alpha * eta(i,k)^beta)
```

where `eta` is a heuristic value from config (e.g., inverse-distance, prior knowledge). Default `eta = 1.0` if not provided.

## Path-Hints vs Full-Path

`aco.py select` does NOT prescribe a complete path — it returns **path-hints**: weighted starting nodes + edge probabilities. The ant (LLM) then makes the actual node-by-node choices, with freedom to deviate based on its own evidence. This preserves LLM judgment while keeping search guided.

```json
{
  "ant_id": "ANT-3-2",
  "start_node": "node_a",
  "edge_preferences": {
    "node_a::node_b": 0.45,
    "node_a::node_c": 0.30,
    "node_a::node_d": 0.25
  },
  "max_path_length": 5
}
```

## Initialization

```
tau_init for all edges = config.aco.tau_init (default 1.0)
```

If `task_space.nodes` is `auto_discover_from: <glob>`, init.py discovers nodes by globbing and initializes a full uniform matrix.

## History & Reproducibility

- `init.json` — frozen snapshot of initial state (never overwritten)
- `history/k.json` — full pheromone state after iteration k (for convergence-curve analysis)
- All updates are deterministic given (prior state + ant artifacts + config)
