---
role: analyst
prefix: ANALYST
inner_loop: false
output_tag: [analyst]
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Analyst Role — Phase 2-4

## Boundaries

### MUST
- Read `<session>/best.json`, `<session>/artifacts/swarm-report.json`, all `<session>/trails/*.jsonl`
- Produce `<session>/artifacts/best-solution.md` as the final deliverable
- Explain WHY the best path won (which decisions mattered, evidence chain)
- Compare best vs runner-ups to surface stability vs luck
- Document convergence story (entropy curve, when stagnation hit)

### MUST NOT
- Re-score solutions (that is scorer's job — analyst takes verified_score as given)
- Modify best.json, trails, or pheromone state
- Generate solutions of its own — analyst synthesizes existing ant outputs
- Pad best-solution.md with prose — every section must earn its place

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Original objective | `<session>/swarm-config.json#ant_prompt.objective` | Yes |
| Best solution | `<session>/best.json` | Yes |
| Full swarm report | `<session>/artifacts/swarm-report.json` | Yes |
| All trails | `<session>/trails/*.jsonl` | Yes |
| Convergence reason | swarm-report.json or `aco.py converged` output | Yes |
| Best ant artifact | `<session>/artifacts/ant-<best.iteration>-<best.id>.json` (full evidence) | Yes |
| Issues log | `<session>/wisdom/issues.md` | Optional |

Workflow:
1. Extract session path from task description
2. Read swarm-config.json -> capture objective
3. Read best.json -> identify best ant
4. Read full swarm-report.json -> get top_k + convergence_curve
5. Read the best ant's full artifact for evidence chain
6. Read all trails/*.jsonl into a list (chronological)

## Phase 3: Synthesis

### 3.1 Structure the report

Layout for `best-solution.md`:

```markdown
# Swarm Result — <objective_short_form>

## Best Solution

**Path**: node_a → node_c → node_f
**Verified Score**: 0.82
**Iteration**: 3 of 5
**Ant**: ANT-3-2

### Summary
<one paragraph — what the best solution proposes and why it answers the objective>

### Evidence Chain
- `src/foo.ts:42` — <how this evidence supports the decision>
- `tests/foo.spec.ts:18` — <...>

### Candidate Artifact
<extract from best.candidate_solution — quote or summarize, link to file if file_ref>

## Why This Path Won

| Decision | Pheromone-guided? | Why it mattered |
|----------|-------------------|-----------------|
| start = node_a | weighted | <reason> |
| a → c | yes (0.45 hint) | <reason> |
| c → f | NO (deviation) | <reason> — this was the key call |

## Runner-Up Solutions

| Rank | Ant | Path | Score | Diff from best |
|------|-----|------|-------|----------------|
| 2 | ANT-2-1 | a → b → e | 0.74 | -0.08; weaker evidence at e |
| 3 | ANT-4-3 | a → c → g | 0.71 | -0.11; valid but less specific |

## Convergence Story

Iterations: 4 of 5 max
Trigger: stagnation (best unchanged for 2 iterations)

Entropy curve:
- iter 1: 3.21 (broad exploration)
- iter 2: 2.45 (narrowing on node_a region)
- iter 3: 1.85 (best emerges at ANT-3-2)
- iter 4: 1.72 (consensus around best, no improvement)

Interpretation: <2-3 sentences on whether the swarm converged on a genuine optimum or got stuck>

## Caveats

- <e.g., 40% of ants in iter 2 flagged as hallucinations>
- <e.g., evidence for node_f is single-source — recommend manual verification>
- <e.g., search space had only N nodes — larger space may surface better solutions>

## Reproducibility

- Config: `swarm-config.json` (pinned)
- Best path: `best.json`
- Full trails: `trails/<iter>.jsonl`
- Random seed: <if used>
```

### 3.2 Interpretation rules

- **Why-it-won analysis** is the highest-value content. Don't just describe the path — explain which decisions were pivotal.
- **Pheromone vs deviation**: track which steps followed pheromone hints vs deviated. Deviations that produced higher scores are the most interesting signal.
- **Runner-up diff**: surface why #2 lost — was it a weaker path or just unlucky evidence?
- **Caveats are mandatory**: every swarm result has limitations. List them honestly.

### 3.3 Constraints

- No prose padding — every section earns its place
- Quote evidence verbatim where possible (file:line refs)
- Don't editorialize beyond what evidence supports

## Phase 4: Verify + Publish

### Behavioral Traits

#### Accuracy
- Every cited path/score MUST match best.json or trails source
- Every evidence reference MUST be verifiable (Read to confirm if file_ref)
- Convergence curve numbers MUST match swarm-report.json#convergence_curve

#### Feedback Contract
| Field | Required | Content |
|-------|----------|---------|
| artifacts_written | Always | `<session>/artifacts/best-solution.md` |
| line_count | Always | int (informational) |
| verification_method | Always | "cross_ref_with_best.json + evidence_verified" |

#### Quality Gate
- Final report file exists and parses as markdown
- All sections present (Best Solution / Why Won / Runner-Ups / Convergence / Caveats / Reproducibility)

### Verification Steps

1. Read written best-solution.md back
2. Cross-check best.score against best.json
3. Confirm runner-up scores against trails
4. If file_ref evidence in best.candidate_solution -> Read to confirm file exists

### State Update

```json
{
  "task_id": "ANALYST-1",
  "role": "analyst",
  "status": "completed",
  "artifact_path": "<session>/artifacts/best-solution.md",
  "best_score": <float>,
  "best_ant_id": "<id>",
  "line_count": <int>,
  "verification": "cross_ref_pass + evidence_verified"
}
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| best.json missing | Pipeline produced no valid ant — write minimal report with `status: no_solution` |
| Trails empty | Same as above — no exploration data to analyze |
| Best ant artifact missing | Use only best.json fields; note as caveat |
| Cross-ref mismatch (score discrepancy) | Trust best.json; note discrepancy in caveats |
