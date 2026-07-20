
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 4: Rebuttal Writing

> **COMPACT SENTINEL [Phase 4: Rebuttal Writing]**
> This phase contains 5 execution steps (Step 4.1 -- 4.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/04-rebuttal-writing.md")`

Write the complete, structured rebuttal document with professional responses to every reviewer comment.

## Objective

- Write point-by-point responses following the planned strategy
- Maintain professional, respectful, evidence-based tone throughout
- Follow venue-specific formatting conventions
- Ensure completeness (every comment addressed)

## Execution

### Step 4.1: Load Strategy and References

Read the response strategy from Phase 3:
```
Read({OUTPUT_DIR}/response-strategy.md)
```

Also load:
- The review analysis: `Read({OUTPUT_DIR}/review-analysis.md)`
- The paper for specific references: `Read(paperPath)`
- Tone guidelines: `Ref: specs/tone-guidelines.md`

### Step 4.2: Write Opening Statement

Write the rebuttal opening that sets the professional tone:

**Standard opening structure**:
```markdown
We sincerely thank all reviewers for their valuable feedback and constructive
suggestions. We have carefully addressed all comments and made substantial
revisions to improve the manuscript. Below, we provide detailed responses to
each reviewer's comments.
```

**Venue-specific openings**:

For NeurIPS:
```markdown
We thank the reviewers for their constructive feedback. Our key contributions
advance the field by [innovation]. We have strengthened the paper with
[improvements] and clarified [areas]. All code and data will be released upon
acceptance to ensure reproducibility.
```

For ICML:
```markdown
We appreciate the reviewers' thorough evaluation. We have added theoretical
analysis [details] and expanded our experimental validation. We have also
enhanced the broader impact statement to address [concerns].
```

For ICLR:
```markdown
We thank the reviewers for their detailed comments. We have conducted additional
experiments [details] addressing all concerns. We have also expanded the
Limitations section and [other improvements]. These revisions significantly
strengthen the empirical validation.
```

### Step 4.3: Write Point-by-Point Responses

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 4.1 -- 4.5) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/04-rebuttal-writing.md")` now.

For each reviewer, write responses following the planned strategy. Use the response format:

**Standard response format per comment**:
```markdown
**Comment [N.M]**: [Exact quote or faithful summary of reviewer's comment]

**Response**: [Our response following the selected strategy]

**Changes**: [Specific changes made, with section/page/table references]
```

**Strategy-specific templates**:

**Accept strategy**:
```markdown
**Response**: We thank the reviewer for this valuable suggestion. We have
[specific modification action]. [Location of change].
```

**Defend strategy**:
```markdown
**Response**: We appreciate the reviewer's concern. However, we respectfully
note that [explanation with rationale]. This choice is motivated by [specific
reasons]. [Optional: cite supporting evidence]. We have added this discussion
to [location].
```

**Clarify strategy**:
```markdown
**Response**: We thank the reviewer for raising this point. We would like to
respectfully clarify that [existing content description]. This is discussed in
[specific location: Section X, page Y, paragraph Z]. To make this clearer,
we have [improvement action].
```

**Experiment strategy**:
```markdown
**Response**: We thank the reviewer for this excellent suggestion. We have
conducted additional experiments on [experiment description]. The results show
that [key findings with numbers]. These new results have been added to [Table/
Figure/Section location] and discussed in [Section].
```

**Combination strategies** (e.g., Accept + Experiment, Clarify + Accept):
Combine templates naturally, addressing each aspect in sequence.

**Tone rules** (apply to all responses):
- Always begin with gratitude: "We thank the reviewer for..."
- Use "We" not "I"
- Never say "The reviewer is wrong/misunderstood/failed to notice"
- For misunderstandings: "We apologize for the confusion" or "We would like to respectfully clarify"
- Provide specific location references (Section, page, Table, Figure)
- Avoid arrogant words: "Obviously", "Clearly", "It is well-known"
- Keep responses substantive (not just "Fixed" or "Done")

### Step 4.4: Write Summary of Major Changes

After all point-by-point responses, add a summary section:

```markdown
## Summary of Major Changes

In response to the reviewers' feedback, we have made the following major
revisions:

1. **[Change category]** (Reviewers [X, Y]) -- [Brief description]
2. **[Change category]** (Reviewer [Z]) -- [Brief description]
3. ...

We believe these revisions have significantly strengthened the manuscript and
addressed all concerns raised by the reviewers.
```

### Step 4.5: Assemble and Save Complete Rebuttal

Assemble the full document in order:
1. Opening statement
2. Per-reviewer responses (Major comments first, then Minor)
3. Summary of major changes
4. Closing statement

**For venues with page limits** (e.g., CVPR one-page limit):
- Prioritize critical and high-priority responses
- Condense minor issue responses
- Remove redundant acknowledgments
- Use concise formatting

Save to: `{OUTPUT_DIR}/rebuttal-response.md`

**Quality checklist before saving**:
- [ ] Every reviewer comment has a response
- [ ] All responses begin with gratitude
- [ ] No arrogant or defensive language
- [ ] Specific location references provided
- [ ] Changes section included for each response
- [ ] Venue formatting requirements met
- [ ] Summary of major changes present
- [ ] Reviewer numbering preserved correctly

## Output

- **File**: `rebuttal-response.md` in the designated output directory
- **update_plan**: Mark Phase 4 completed, Phase 5 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 5: Revision](05-revision.md).
