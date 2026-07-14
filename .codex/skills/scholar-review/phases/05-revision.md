# Phase 5: Revision

Plan and track the paper revisions based on the rebuttal commitments, ensuring every promised change is implemented.

## Objective

- Create a revision plan mapping each rebuttal commitment to specific paper edits
- Track completion of each revision item
- Verify consistency between rebuttal promises and actual paper changes
- Generate a revision summary for the authors

## Execution

### Step 5.1: Load Rebuttal Commitments

Read the rebuttal document to extract all committed changes:

```
Read({OUTPUT_DIR}/rebuttal-response.md)
```

Also load:
- Response strategy: `Read({OUTPUT_DIR}/response-strategy.md)`
- Paper: `Read(paperPath)`

Parse every "Changes" entry from the rebuttal to build the revision list.

### Step 5.2: Build Revision Plan

Create a structured revision plan organized by paper section:

For each committed change, create a revision item:

```
{
  id: "REV-001",
  source: "Comment 1.1",
  type: "add_section" | "revise_text" | "add_experiment" | "add_figure" | "add_table" | "fix_typo" | "add_citation",
  location: "Section X.Y, page Z",
  description: "What to change",
  currentContent: "Existing text (if revision)" | null,
  targetContent: "Description of desired new content",
  effort: "low | medium | high",
  status: "pending"
}
```

**Organize by paper section** for efficient editing:
```
Abstract:
  - REV-003: Revise claims (Comment 1.5)

Section 1 - Introduction:
  - REV-007: Add motivation paragraph (Comment 2.1)

Section 3 - Method:
  - REV-001: Rewrite Section 3.2 for clarity (Comment 1.1)
  - REV-004: Add algorithm pseudocode (Comment 1.1)

Section 4 - Results:
  - REV-002: Add comparison with Method X (Comment 1.2)
  - REV-005: Add ablation study (Comment 2.3)

Section 5 - Discussion:
  - REV-006: Expand limitations (Comment 2.4)
  - REV-008: Add broader impact (Comment 3.1)

References:
  - REV-009: Add missing citations (Comments 1.3, 3.2)

Appendix:
  - REV-010: Add detailed proofs (Comment 2.2)
```

### Step 5.3: Identify Dependencies and Order

Determine revision order based on dependencies:

- Content changes before formatting changes
- New experiments before results discussion
- Method revisions before results that reference them
- Text additions before length/flow optimization

Group into revision passes:
1. **Pass 1**: Structural changes (add sections, reorganize)
2. **Pass 2**: Content additions (experiments, figures, citations)
3. **Pass 3**: Text revisions (clarity, claims, explanations)
4. **Pass 4**: Polish (typos, formatting, consistency)

### Step 5.4: Generate Revision Plan Document

```markdown
# Revision Plan

## Paper: [Paper Title]
## Date: [Date]
## Based on: rebuttal-response.md

## Revision Summary

| Metric | Count |
|--------|-------|
| Total revision items | N |
| High effort | N |
| Medium effort | N |
| Low effort | N |

## Revision Items by Section

### Abstract
- [ ] **REV-003** [low]: Revise claims to avoid overclaiming (Comment 1.5)
  - Current: "[current text]"
  - Target: "[target description]"

### Section 1: Introduction
- [ ] **REV-007** [medium]: Add motivation paragraph (Comment 2.1)
  - Location: After paragraph 2
  - Target: "[description of content to add]"

### Section 3: Method
- [ ] **REV-001** [high]: Rewrite Section 3.2 for clarity (Comment 1.1)
  - Current: "[current text summary]"
  - Target: Add mathematical formulation, pseudocode, concrete example
- [ ] **REV-004** [medium]: Add Algorithm 1 with pseudocode (Comment 1.1)
  - Location: After Equation 3
  - Target: Step-by-step pseudocode of the method

[... continue for all sections]

## Recommended Revision Order

### Pass 1: Structural Changes
1. REV-001: Rewrite Section 3.2
2. REV-006: Expand limitations section
3. REV-008: Add broader impact section

### Pass 2: Content Additions
1. REV-002: Add Method X comparison experiments
2. REV-005: Add ablation study
3. REV-010: Add detailed proofs to appendix

### Pass 3: Text Revisions
1. REV-003: Revise abstract claims
2. REV-007: Add motivation paragraph
3. REV-004: Add algorithm pseudocode

### Pass 4: Polish
1. REV-009: Add missing citations
2. All typo fixes

## Consistency Check

Verify each rebuttal promise has a corresponding revision item:

| Rebuttal Promise | Revision Item | Status |
|-----------------|---------------|--------|
| "Added to Table 3" | REV-002 | pending |
| "Revised Section 3.2" | REV-001 | pending |
| "Corrected all typos" | REV-011 | pending |
| ... | | |

## Notes for Authors

- [Any special considerations]
- [Items that need author judgment or additional data]
- [Timeline recommendations]
```

Save to: `{OUTPUT_DIR}/revision-plan.md`

## Output

- **File**: `revision-plan.md` in the designated output directory
- **update_plan**: Mark Phase 5 completed

## Next Phase

This is the final phase. Return to orchestrator with completion summary listing all generated documents:
- `self-review-report.md` (if pre-submission mode)
- `review-analysis.md` (if post-review mode)
- `response-strategy.md` (if post-review mode)
- `rebuttal-response.md` (if post-review mode)
- `revision-plan.md` (if post-review mode)
