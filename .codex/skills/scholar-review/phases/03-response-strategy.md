# Phase 3: Response Strategy

> **COMPACT SENTINEL [Phase 3: Response Strategy]**
> This phase contains 4 execution steps (Step 3.1 -- 3.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/03-response-strategy.md")`

Plan the rebuttal strategy for each reviewer comment, selecting the appropriate response approach and planning any required actions (experiments, revisions, clarifications).

## Objective

- Select a response strategy (Accept / Defend / Clarify / Experiment) for each comment
- Plan concrete actions required for each response
- Estimate effort and feasibility of requested changes
- Prioritize actions by impact on acceptance decision

## Execution

### Step 3.1: Load Review Analysis

Read the review analysis from Phase 2:

```
Read({OUTPUT_DIR}/review-analysis.md)
```

Re-read paper sections as needed for planning.

### Step 3.2: Select Strategy Per Comment

For each comment in the review analysis, select one or more strategies:

**Strategy Selection Flow**:
```
Comment → Classification → Strategy

Major Issues:
  ├─ Request is reasonable and feasible → Accept + Experiment
  ├─ Current approach has strong justification → Defend (with evidence)
  ├─ Request is partially feasible → Accept (partial) + Defend (remainder)
  └─ Request is infeasible → Defend + offer alternative

Minor Issues:
  ├─ Easy to address → Accept
  ├─ Already addressed in paper → Clarify
  └─ Improvement suggestion → Accept (if reasonable) or Defend (if not)

Typos/Formatting:
  └─ Always → Accept

Misunderstandings:
  ├─ Paper content exists but unclear → Clarify + Accept (improve wording)
  └─ Paper content exists and is clear → Clarify (point to location)
```

For each comment, record:

```
{
  commentId: "1.1",
  strategy: ["Accept", "Experiment"] | ["Defend"] | ["Clarify"] | etc.,
  rationale: "Why this strategy was chosen",
  actions: [
    {
      type: "add_experiment" | "revise_text" | "add_figure" | "add_citation" | "clarify_existing" | "fix_typo",
      description: "Specific action to take",
      effort: "low | medium | high",
      feasibility: "certain | likely | uncertain",
      paperLocation: "Where the change goes"
    }
  ],
  keyPoints: ["Main argument point 1", "Main argument point 2"],
  evidence: ["Supporting evidence 1", "Supporting evidence 2"]
}
```

### Step 3.3: Venue-Specific Strategy Adjustments

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 3.1 -- 3.4) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/03-response-strategy.md")` now.

Apply venue-specific rebuttal conventions:

**NeurIPS**:
- Emphasize conceptual novelty over incremental improvements
- Address broader impact concerns proactively
- Promise reproducibility (code release, detailed setup)

**ICML**:
- Strengthen theoretical foundations when challenged
- Provide mathematical proofs or complexity analysis
- Link experimental results to theoretical predictions

**ICLR**:
- Prioritize adding requested experiments (highest impact)
- Expand limitations section honestly
- Disclose LLM usage if applicable
- Use evidence-supported clarifications (strongest correlation with score increase)
- For borderline papers (5-6 range): focus on quick-win improvements

**CVPR**:
- Respect strict one-page rebuttal limit
- Identify champion reviewer and strengthen their arguments
- No external links; include results inline
- Restate core contributions while addressing concerns

**ACL**:
- May include small tables in rebuttal
- Emphasize linguistic significance and NLP community impact
- Address ethics and bias concerns thoroughly

### Step 3.4: Generate Response Strategy Document

Compile strategy decisions into the planning document:

```markdown
# Response Strategy

## Paper: [Paper Title]
## Date: [Date]
## Target Venue: [Venue]

## Strategy Overview

| Comment | Type | Strategy | Effort | Priority |
|---------|------|----------|--------|----------|
| 1.1 | Major | Accept + Experiment | High | Critical |
| 1.2 | Minor | Accept | Low | Medium |
| 2.1 | Misunderstanding | Clarify | Low | High |
| ... | | | | |

## Effort Summary

- **High effort actions**: N (experiments, major rewrites)
- **Medium effort actions**: N (new text, additional analysis)
- **Low effort actions**: N (typo fixes, minor clarifications)
- **Estimated total effort**: [assessment]

## Detailed Strategy Per Comment

### Reviewer 1

#### Comment 1.1 [Major] -- Accept + Experiment
- **Original**: "[comment]"
- **Strategy rationale**: [Why Accept + Experiment]
- **Actions**:
  1. [Action description] (effort: high, location: Section X)
  2. [Action description] (effort: low, location: Table Y)
- **Key response points**:
  - [Point 1 with evidence]
  - [Point 2 with evidence]
- **Draft response outline**: Thank reviewer → Acknowledge validity → Present new results → Reference location

[... more comments]

### Reviewer 2

[Same format]

### Reviewer 3

[Same format]

## Cross-Cutting Actions

Actions that address multiple reviewer comments:
1. [Action]: Addresses comments [1.1, 2.3, 3.1]
2. [Action]: Addresses comments [1.2, 3.2]

## Venue-Specific Notes

[Venue-specific strategy adjustments applied]

## Risk Assessment

- **Strongest responses**: Comments [X, Y] -- high confidence
- **Weakest responses**: Comments [X, Y] -- may need additional evidence
- **Potential reviewer pushback**: [Anticipated challenges]
```

Save to: `{OUTPUT_DIR}/response-strategy.md`

## Output

- **File**: `response-strategy.md` in the designated output directory
- **Variable**: `responseStrategy` (strategy data for Phase 4)
- **update_plan**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 4: Rebuttal Writing](04-rebuttal-writing.md).
