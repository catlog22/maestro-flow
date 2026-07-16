

# Ant Output Schema

**The critical contract.** Every ant MUST write a JSON file matching this schema. Pheromone updates depend on it. Schema violation = ant output discarded + worker error reported.

## File Path

```
{run_dir}/outputs/ant-<iteration>-<ant_id>.json
```

Example: `{run_dir}/outputs/ant-3-2.json` (ant id 2 in iteration 3)

## Schema

```json
{
  "schema_version": "1.0",
  "ant_id": "ANT-3-2",
  "iteration": 3,
  "assignment": {
    "start_node": "node_a",
    "max_path_length": 5
  },
  "path": ["node_a", "node_c", "node_f"],
  "path_decisions": [
    {
      "from": "node_a",
      "to": "node_c",
      "rationale": "<one-line reason>",
      "guided_by": "pheromone | heuristic | evidence",
      "pheromone_weight": 0.30,
      "deviation_from_hint": false
    },
    {
      "from": "node_c",
      "to": "node_f",
      "rationale": "<one-line reason>",
      "guided_by": "evidence",
      "deviation_from_hint": true
    }
  ],
  "self_score": 0.78,
  "self_confidence": 0.6,
  "cost_tokens": 1200,
  "cost_seconds": 18,
  "evidence": [
    "src/foo.ts:42",
    "tests/foo.spec.ts:18"
  ],
  "candidate_solution": {
    "type": "<string|object|file_ref>",
    "summary": "<one-line>",
    "content": "<actual artifact content OR a path>"
  },
  "blockers": [],
  "notes": "<optional free text, NOT used by pheromone update>"
}
```

## Required Fields (Validation)

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `schema_version` | string | yes | must be `"1.0"` |
| `ant_id` | string | yes | matches assignment |
| `iteration` | int | yes | matches assignment |
| `path` | array of string | yes | len >= 1, all nodes ∈ task_space.nodes |
| `path_decisions` | array | yes | len = len(path) - 1 |
| `self_score` | float | yes | 0.0 ≤ x ≤ 1.0 |
| `self_confidence` | float | yes | 0.0 ≤ x ≤ 1.0 |
| `cost_tokens` | int | no | recommended for budget tracking |
| `evidence` | array of string | yes | min 1 entry (forces grounding) |
| `candidate_solution` | object | yes | non-empty `summary` |

## Two-Layer Scoring

| Score | Source | Purpose |
|-------|--------|---------|
| `self_score` | Ant LLM self-report | Cheap early-stop signal; tracked but NOT used for pheromone update |
| `self_confidence` | Ant LLM self-report | Used to weight self_score when no verified_score is available |
| `verified_score` | scoring.py OR scorer role | **Authoritative input to pheromone update.** Written to separate file: `<session>/scores/iter-k-scores.json` |

If `verified_score` is missing for an ant (scorer disabled), pheromone update falls back to:
```
effective_score = self_score * self_confidence * config.scoring.self_score_discount  # default 0.5
```

## verified_scores File

When scorer runs (script or LLM), produces:

```json
{
  "iteration": 3,
  "scorer_type": "script | llm",
  "scores": {
    "ANT-3-1": { "verified_score": 0.82, "rationale": "..." },
    "ANT-3-2": { "verified_score": 0.45, "rationale": "..." }
  },
  "computed_at": "2026-05-25T14:30:00Z"
}
```

## Hallucination Detection

`aco.py update` compares `self_score` vs `verified_score` per ant:
- `|self_score - verified_score| > 0.4` → flagged as `hallucination_suspected`
- Repeat offenders (≥ 3 across iterations) → `aco.py` reduces deposit on their paths by 50%

## Validation in Ant's Phase 4

Ant MUST self-validate before writing:
1. JSON parses cleanly
2. All required fields present
3. `path` nodes exist in task-space.json
4. `path_decisions` length = `len(path) - 1`
5. Numeric ranges within bounds

Validation failure → retry once → if still failing, report `partial_completion` to coordinator.
