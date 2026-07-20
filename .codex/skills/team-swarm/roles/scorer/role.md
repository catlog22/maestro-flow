---
role: scorer
prefix: SCORE
inner_loop: false
output_tag: "[scorer]"
message_types: 
---

# Scorer Role — Phase 2-4

## Boundaries

### MUST
- Read ALL `ant-<iter>-*.json` artifacts for the target iteration
- Apply a uniform scoring rubric across the batch (consistency over absolute correctness)
- Produce `{run_dir}/work/team/scores/iter-<k>-scores.json` matching the schema in specs/ant-output-schema.md
- Provide a one-line `rationale` per ant
- Use a different model from the ant if possible (configured via maestro delegate) to reduce same-source bias

### MUST NOT
- Modify ant artifacts
- Score ants outside the target iteration
- Use self_score as a starting reference (introduces anchoring bias) — score blind first, compare second
- Assign scores without grounding in evidence claimed by the ant

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Target iteration | Task description (`Iteration to score: <k>`) | Yes |
| Objective | `{run_dir}/work/team/swarm-config.json#ant_prompt.objective` | Yes |
| Scoring rubric | `{run_dir}/work/team/swarm-config.json#scoring.rubric` (if defined) | Optional |
| Ant artifacts | `{run_dir}/outputs/ant-<k>-*.json` | Yes |
| Task space | `{run_dir}/work/team/task-space.json` (for context) | Optional |

Workflow:
1. Extract `k` from task description
2. `Glob("{run_dir}/outputs/ant-<k>-*.json")` -> N artifacts
3. Read all N artifacts in parallel
4. Read swarm-config.json -> capture objective + rubric

## Phase 3: Blind Batch Scoring

### 3.1 Build rubric

If `config.scoring.rubric` provided, use verbatim. Otherwise default rubric:

| Dimension | Weight |
|-----------|--------|
| Path relevance to objective | 0.35 |
| Evidence strength (count + specificity) | 0.30 |
| Candidate solution quality | 0.25 |
| Path coherence (decisions follow logical chain) | 0.10 |

### 3.2 Score each artifact

For each ant artifact (process them blind to self_score order):

1. Extract: `path`, `path_decisions[].rationale`, `evidence`, `candidate_solution`
2. **Do NOT read** `self_score` / `self_confidence` until after scoring
3. Apply rubric:
   - Each dimension -> 0.0..1.0
   - Weighted sum -> `verified_score`
4. One-line rationale: which dimensions drove the score
5. Append to scores dict

### 3.3 Calibrate across batch

After all individual scores:
- Compute mean + std of verified_scores
- If all scores within ±0.05 (compressed range) -> spread them apart by re-ranking with finer rubric application
- If exactly one is 1.0 and rest are < 0.3 -> double-check the outlier

### 3.4 Compose scores file

```json
{
  "iteration": <k>,
  "scorer_type": "llm",
  "rubric_used": "default | custom_from_config",
  "scores": {
    "ANT-<k>-1": { "verified_score": <float>, "rationale": "<one-line>" },
    "ANT-<k>-2": { "verified_score": <float>, "rationale": "<one-line>" },
    ...
  },
  "calibration": {
    "mean": <float>,
    "std": <float>,
    "min": <float>,
    "max": <float>
  },
  "computed_at": "<iso8601>"
}
```

## Phase 4: Verify + Publish

### Behavioral Traits

#### Accuracy
- Every `verified_score` in [0.0, 1.0]
- Every `ANT-<k>-i` in the input set has a score entry
- `rationale` references at least one dimension of the rubric

#### Feedback Contract
| Field | Required | Content |
|-------|----------|---------|
| artifacts_written | Always | `{run_dir}/work/team/scores/iter-<k>-scores.json` |
| n_ants_scored | Always | int |
| verification_method | Always | "blind_then_calibrated + range_check" |

#### Quality Gate
- All N ant artifacts must have a score entry — partial scoring is NOT acceptable
- If a single artifact is unparseable -> assign verified_score = 0.0 with rationale "artifact_invalid", continue
- Validation fails -> retry Phase 3 once

### Verification Steps

1. Re-read the scores file via Read
2. Parse JSON, validate schema
3. Confirm `len(scores) == n_ants_in_iteration`
4. Confirm score range
5. Write hallucination delta to wisdom for coordinator visibility:
   - For each ant, compute `delta = |self_score - verified_score|`
   - If `delta > 0.4` for >50% of ants in this iter -> append warning to `{run_dir}/work/team/wisdom/issues.md`

### State Update

```json
{
  "task_id": "SCORE-<k>",
  "role": "scorer",
  "status": "completed",
  "iteration": <k>,
  "n_ants_scored": <N>,
  "mean_verified_score": <float>,
  "artifact_path": "{run_dir}/work/team/scores/iter-<k>-scores.json",
  "verification": "blind_scored + schema_validated"
}
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| No artifacts found for iteration | Report error - coordinator either misrouted or ants all failed |
| Artifact parse fails | Score = 0.0, rationale = "artifact_invalid", continue |
| Rubric ambiguous for a path | Default to 0.5 with rationale "rubric_uncertain", lower confidence in calibration |
| All scores identical | Force differentiation via secondary tiebreaker (path length, evidence count) |
| Scores file write fails | Retry; on second failure report blocker |
