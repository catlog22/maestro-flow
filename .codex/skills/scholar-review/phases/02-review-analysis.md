# Phase 2: Review Analysis

Parse, classify, and prioritize all reviewer comments to create a structured analysis that drives the response strategy.

## Objective

- Parse reviewer comments into individual addressable items
- Classify each comment by type (Major / Minor / Typo / Misunderstanding)
- Assign priority based on impact on acceptance decision
- Map comments to paper sections for targeted responses

## Execution

### Step 2.1: Read Reviewer Comments

Read all reviewer feedback files:

```
Read(reviewCommentsPath)
```

Also re-read the paper for cross-referencing:
```
Read(paperPath)
```

Identify reviewer structure:
- Number of reviewers
- Review format (structured with scores, free-form, or mixed)
- Overall scores/recommendations if present

### Step 2.2: Parse Comments into Individual Items

Break each reviewer's feedback into discrete, addressable comments. For each comment extract:

```
{
  reviewerId: "Reviewer 1" (preserve original numbering),
  commentId: "1.1" (reviewer.sequence),
  originalText: "Exact quote of the comment",
  paperSection: "Section the comment refers to",
  summary: "One-line summary of what the reviewer wants"
}
```

**Parsing rules**:
- One concern = one comment item, even if the reviewer wrote them together
- Preserve exact reviewer wording in `originalText`
- If a reviewer lists multiple points in one paragraph, split them
- Capture both explicit requests and implicit concerns

### Step 2.3: Classify Each Comment

Apply the four-category classification system:

**Major Issues**:
- Questions research method validity
- Requests additional experiments or comparisons
- Challenges result interpretation logic
- Questions novelty or contribution significance
- Keywords: "major concern", "fundamental issue", "missing experiments", "insufficient evidence", "not convincing"

**Minor Issues**:
- Requests clarification of details
- Suggests presentation improvements
- Asks for additional related work discussion
- Suggests figure/table improvements
- Keywords: "minor concern", "could be improved", "please clarify", "suggestion", "it would be better"

**Typos/Formatting**:
- Spelling errors
- Grammar issues
- Reference format inconsistencies
- Figure/table labeling errors
- Keywords: "typo", "grammar", "formatting", "inconsistent"

**Misunderstandings**:
- Reviewer misread or missed existing content
- Reviewer confused concepts the paper already addresses
- Reviewer asks for something already present
- Keywords: "The authors did not..." (but they did), "It is unclear..." (but it is stated)

### Step 2.4: Prioritize Comments

Assign priority to each classified comment:

**Priority order**:
1. **Critical** -- Major Issues that could cause rejection (address first)
2. **High** -- Misunderstandings that could worsen if not clarified
3. **Medium** -- Minor Issues that improve paper quality
4. **Low** -- Typos and formatting (straightforward fixes)

**Cross-reviewer analysis**:
- Flag comments raised by multiple reviewers (higher priority)
- Note contradictory comments between reviewers
- Identify "champion" reviewer (most positive) vs skeptical reviewer

### Step 2.5: Map to Paper Sections

For each comment, identify the exact paper location it refers to:

```
{
  commentId: "1.1",
  paperLocation: {
    section: "Section 3.2",
    page: "5",
    paragraph: "2",
    element: "Equation 3" | "Figure 2" | "Table 1" | null
  },
  existingContent: "Brief quote of relevant existing paper content" | null
}
```

This mapping enables:
- Quick reference when writing responses
- Identifying if the paper already addresses the concern
- Planning targeted revisions

### Step 2.6: Generate Review Analysis Document

Compile the analysis into a structured document:

```markdown
# Review Analysis

## Paper: [Paper Title]
## Date: [Date]
## Reviewers: [N] reviewers

## Overall Assessment

| Reviewer | Score | Recommendation | Stance |
|----------|-------|----------------|--------|
| Reviewer 1 | [score] | [accept/reject/revise] | [champion/neutral/skeptical] |
| Reviewer 2 | [score] | [accept/reject/revise] | [champion/neutral/skeptical] |
| ... | | | |

**Consensus areas**: [What reviewers agree on]
**Disagreement areas**: [Where reviewers disagree]

## Comment Summary by Category

| Category | Count | Reviewers |
|----------|-------|-----------|
| Major Issues | N | R1, R2 |
| Minor Issues | N | R1, R2, R3 |
| Typos/Formatting | N | R1, R3 |
| Misunderstandings | N | R2 |

## Detailed Comment Analysis

### Critical Priority

#### Comment 1.1 [Major] (Reviewer 1)
- **Original**: "[exact quote]"
- **Summary**: [one-line summary]
- **Paper Location**: Section X.Y, page Z
- **Existing Content**: [relevant quote from paper, or "Not addressed"]
- **Cross-reviewer**: [Also raised by Reviewer N] | [Unique to this reviewer]

[... more critical comments]

### High Priority

[Same format]

### Medium Priority

[Same format]

### Low Priority

[Same format]

## Cross-Reviewer Patterns

### Comments Raised by Multiple Reviewers
- [Topic]: Reviewers [X, Y] -- [summary]

### Contradictory Comments
- Reviewer X says [A], Reviewer Y says [B] -- [analysis]

## Key Statistics

- Total comments: N
- Major: N (X%)
- Minor: N (X%)
- Typo: N (X%)
- Misunderstanding: N (X%)
```

Save to: `{OUTPUT_DIR}/review-analysis.md`

## Output

- **File**: `review-analysis.md` in the designated output directory
- **Variable**: `reviewAnalysis` (parsed comment data for Phase 3)
- **update_plan**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Response Strategy](03-response-strategy.md).
