# Ant Output Schema

**The critical contract.** Every ant MUST produce JSON matching this schema.
Pheromone updates and adversarial scoring depend on it.

Inherited from team-swarm with adversarial scoring integration notes.

## File Path

```
<session>/artifacts/ant-<iteration>-<ant_id>.json
```

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
    }
  ],
  "self_score": 0.78,
  "self_confidence": 0.6,
  "evidence": [
    { "source": "src/foo.ts:42", "finding": "suspicious pattern", "strength": "strong" }
  ],
  "candidate_solution": {
    "type": "string | object | file_ref",
    "summary": "<one-line>",
    "content": "<actual artifact>"
  },
  "blockers": [],
  "notes": "<optional free text>"
}
```

## Required Fields

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `schema_version` | string | yes | `"1.0"` |
| `ant_id` | string | yes | matches assignment |
| `iteration` | int | yes | matches assignment |
| `path` | string[] | yes | len >= 1, all nodes ∈ task_space |
| `path_decisions` | array | yes | len = len(path) - 1 |
| `self_score` | float | yes | [0.0, 1.0] |
| `self_confidence` | float | yes | [0.0, 1.0] |
| `evidence` | array | yes | min 1 entry |
| `candidate_solution` | object | yes | non-empty summary |

## Three-Layer Scoring (Adversarial Edition)

| Layer | Source | Purpose |
|-------|--------|---------|
| `self_score` | Ant self-report | Cheap signal; NOT used for pheromone |
| `adversarial_score` | wf-swarm-score (3-vote) | Prosecutor/defender/judge per ant |
| `verified_score` | Calibrated from 3 votes | **Authoritative pheromone input** |

In team-adversarial-swarm, `verified_score` is derived from 3 adversarial votes:
```
verified_score = prosecutor(0.25) + defender(0.25) + judge(0.50)  (weighted avg)
```

Calibrated across the full ant batch for consistency.

## Hallucination Detection

Enhanced by adversarial scoring:
- `|self_score - verified_score| > 0.3` → flagged (threshold lower than team-swarm's 0.4)
- Prosecutor/defender vote spread > 0.5 → "controversial" flag
- If >50% of ants flagged → coordinator pauses for user input

## Adversarial Scores File

```json
{
  "iteration": 3,
  "scorer_type": "adversarial_3vote",
  "scores": {
    "ANT-3-1": {
      "verified_score": 0.72,
      "rationale": "judge weighted average",
      "votes": {
        "prosecutor": 0.55,
        "defender": 0.85,
        "judge": 0.76
      },
      "hallucination_flag": false,
      "self_vs_verified_delta": 0.06
    }
  },
  "calibration": {
    "mean": 0.68,
    "std": 0.12,
    "min": 0.45,
    "max": 0.82,
    "hallucination_rate": 0.2
  },
  "ranking": ["ANT-3-2", "ANT-3-1", "ANT-3-4", "ANT-3-3", "ANT-3-5"]
}
```
