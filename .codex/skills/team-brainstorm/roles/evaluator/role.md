---
role: evaluator
prefix: EVAL
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Evaluator

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session folder | Task description (Session: line) | Yes |
| Synthesis results | <session>/synthesis/*.md files | Yes |
| All ideas | <session>/ideas/*.md files | No (for context) |
| All critiques | <session>/critiques/*.md files | No (for context) |

1. Extract session path from task description (match "Session: <path>")
2. Glob synthesis files from <session>/synthesis/
3. Read all synthesis files for evaluation
4. Optionally read ideas and critiques for full context

## Phase 3: Evaluation and Scoring

**Scoring Dimensions**:

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Feasibility | 30% | Technical feasibility, resource needs, timeline |
| Innovation | 25% | Novelty, differentiation, breakthrough potential |
| Impact | 25% | Scope of impact, value creation, problem resolution |
| Cost Efficiency | 20% | Implementation cost, risk cost, opportunity cost |

**Weighted Score**: `(Feasibility * 0.30) + (Innovation * 0.25) + (Impact * 0.25) + (Cost * 0.20)`

**Per-Proposal Evaluation**:
- Score each dimension (1-10) with rationale
- Overall recommendation: Strong Recommend / Recommend / Consider / Pass

**Output**: Write to `<session>/evaluation/evaluation-<num>.md`
- Sections: Input summary, Scoring Matrix (ranked table), Detailed Evaluation per proposal, Final Recommendation, Action Items, Risk Summary

## Phase 4: Consistency Check

| Check | Pass Criteria | Action on Failure |
|-------|---------------|-------------------|
| Score spread | max - min >= 0.5 (with >1 proposal) | Re-evaluate differentiators |
| No perfect scores | Not all 10s | Adjust to reflect critique findings |
| Ranking deterministic | Consistent ranking | Verify calculation |

After passing checks, update shared state:
- Set .msg/meta.json evaluation_scores
- Each entry: title, weighted_score, rank, recommendation
