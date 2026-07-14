# Phase 1: Self-Review

Conduct a comprehensive pre-submission quality review of the paper, identifying weaknesses and providing actionable improvement suggestions.

## Objective

- Systematically evaluate paper quality across structure, logic, citations, figures/tables, and writing
- Identify issues before external reviewers find them
- Generate a prioritized self-review report with concrete fixes

## Execution

### Step 1.1: Read and Understand the Paper

Read the full paper to understand:
- Research question and contributions
- Methodology and experimental design
- Results and conclusions
- Target venue requirements (if known)

```
Read(paperPath)
```

Store: `paperContent` (full paper text), `paperStructure` (section outline)

### Step 1.2: Structure Review

Check whether all sections are complete and conform to academic standards:

**Checklist**:
- [ ] Abstract includes: problem statement, method summary, key results, contributions
- [ ] Introduction clearly articulates research motivation, background, and gap
- [ ] Related Work covers key prior work and positions the contribution
- [ ] Method section is detailed enough to be reproducible
- [ ] Results sufficiently support the conclusions with appropriate evidence
- [ ] Discussion addresses limitations, implications, and future work
- [ ] Conclusion summarizes contributions without overclaiming

**For each missing or weak element**, record:
```
{
  section: "Section name",
  issue: "Description of the problem",
  severity: "critical | major | minor",
  suggestion: "Specific improvement action"
}
```

### Step 1.3: Logic Consistency Check

Verify the logical coherence of the paper:

- Do research questions align with the methodology?
- Does the experimental design support the research hypotheses?
- Are result interpretations reasonable and supported by data?
- Are conclusions supported by the presented evidence?
- Are there logical gaps or unsupported claims?

**Technique**: Read from conclusion backwards to check logical coherence.

For each inconsistency found:
```
{
  location: "Section X.Y, paragraph Z",
  type: "gap | unsupported_claim | contradiction | overclaim",
  description: "What the issue is",
  suggestion: "How to fix it"
}
```

### Step 1.4: Citation Completeness

Check citations for:
- All in-text citations present in the reference list
- Reference format consistency (all same style)
- Key related works cited (search for obvious missing references)
- Citations accurately reflect the original content (no misattributions)
- Self-citations appropriate (not excessive, not missing key ones)

### Step 1.5: Figure and Table Quality

Evaluate every figure and table:
- Clear, descriptive titles and captions
- Readable at standard print size (font sizes, resolution)
- Support the text narrative (referenced and discussed)
- Format compliant with venue requirements
- Consistent style across all figures/tables
- Axes labeled, units specified, legends present

### Step 1.6: Writing Clarity

Assess writing quality:
- Language is concise and clear (no unnecessary jargon)
- Technical terminology used correctly and consistently
- Sentence structures are clear (no run-on sentences, ambiguity)
- Paragraph organization is logical (topic sentences, transitions)
- No grammatical errors or typos
- Consistent notation throughout

### Step 1.7: Venue-Specific Check

If target venue is known, check venue-specific requirements:

**General conference checks**:
- Page limit compliance
- Required sections present (ethics statement, broader impact, reproducibility)
- Anonymous submission requirements met
- Supplementary material properly formatted

**Venue-specific emphasis**:
- NeurIPS: Conceptual novelty, broader impact, reproducibility checklist
- ICML: Theoretical rigor, mathematical proofs, methodological contribution
- ICLR: Experimental thoroughness, limitations discussion, LLM disclosure
- CVPR: Visual quality, experimental completeness
- ACL: Linguistic significance, ethics statement, limitations section

### Step 1.8: Generate Self-Review Report

Compile all findings into a structured report:

```markdown
# Self-Review Report

## Paper: [Paper Title]
## Date: [Date]
## Target Venue: [Venue or "Not specified"]

## Executive Summary

[2-3 sentence overview of paper quality and main areas for improvement]

## Critical Issues (Must Fix)

### Issue 1: [Title]
- **Location**: [Section, page, paragraph]
- **Category**: [Structure | Logic | Citation | Figure | Writing | Venue]
- **Description**: [What the problem is]
- **Suggestion**: [Specific action to fix]

[... more critical issues]

## Major Issues (Should Fix)

[Same format as critical]

## Minor Issues (Nice to Fix)

[Same format as critical]

## Quality Checklist Summary

| Category | Status | Notes |
|----------|--------|-------|
| Abstract completeness | Pass/Fail | ... |
| Introduction clarity | Pass/Fail | ... |
| Method reproducibility | Pass/Fail | ... |
| Results support conclusions | Pass/Fail | ... |
| Discussion addresses limitations | Pass/Fail | ... |
| Figures/tables quality | Pass/Fail | ... |
| Citations complete | Pass/Fail | ... |
| Writing clarity | Pass/Fail | ... |
| Venue requirements | Pass/Fail | ... |

## Reviewer Perspective

[Brief simulation of likely reviewer concerns -- what would reviewers
likely focus on? What questions would they ask?]

## Recommended Priority Actions

1. [Most important fix]
2. [Second most important]
3. [Third most important]
```

Save to: `{OUTPUT_DIR}/self-review-report.md`

## Output

- **File**: `self-review-report.md` in the designated output directory
- **update_plan**: Mark Phase 1 completed

## Next Phase

For pre-submission mode, the workflow ends here. Return to orchestrator with self-review report location.
