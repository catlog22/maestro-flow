---
role: discussant
prefix: DISCUSS
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Discussant

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Analysis results | `<session>/analyses/*.json` | Yes |
| Exploration results | `<session>/explorations/*.json` | No |

1. Extract session path, topic, round, discussion type, user feedback:

| Field | Pattern | Default |
|-------|---------|---------|
| sessionFolder | `session:\s*(.+)` | required |
| topic | `topic:\s*(.+)` | required |
| round | `round:\s*(\d+)` | 1 |
| discussType | `type:\s*(.+)` | "initial" |
| userFeedback | `user_feedback:\s*(.+)` | empty |

2. Read all analysis and exploration results
3. Aggregate current findings, insights, open questions

## Phase 3: Discussion Processing

Select strategy by discussion type:

| Type | Mode | Description |
|------|------|-------------|
| initial | inline | Aggregate all analyses: convergent themes, conflicts, top discussion points |
| deepen | cli | Use CLI tool to investigate open questions deeper |
| direction-adjusted | cli | Re-analyze via `maestro delegate` from adjusted perspective |
| specific-questions | cli | Targeted exploration answering user questions |

**initial**: Cross-perspective summary -- identify convergent themes, conflicting views, top 5 discussion points and open questions from all analyses.

**deepen**: Use CLI tool for deep investigation:
```javascript
Bash({
  command: `maestro delegate "PURPOSE: Investigate open questions and uncertain insights; success = evidence-based findings
TASK: • Focus on open questions: <questions> • Find supporting evidence • Validate uncertain insights • Document findings
MODE: analysis
CONTEXT: @**/* | Memory: Session <session-folder>, previous analyses
EXPECTED: JSON output with investigation results | Write to <session>/discussions/deepen-<num>.json
CONSTRAINTS: Evidence-based analysis only
" --tool agy --mode analysis --rule analysis-trace-code-execution`,
  run_in_background: false
})
```

**direction-adjusted**: CLI re-analysis from adjusted focus:
```javascript
Bash({
  command: `maestro delegate "Re-analyze '<topic>' with adjusted focus on '<userFeedback>'" --to agy --mode analysis`,
  run_in_background: false
})
```

**specific-questions**: Use CLI tool for targeted Q&A:
```javascript
Bash({
  command: `maestro delegate "PURPOSE: Answer specific user questions about <topic>; success = clear, evidence-based answers
TASK: • Answer: <userFeedback> • Provide code references • Explain context
MODE: analysis
CONTEXT: @**/* | Memory: Session <session-folder>
EXPECTED: JSON output with answers and evidence | Write to <session>/discussions/questions-<num>.json
CONSTRAINTS: Direct answers with code references
" --tool agy --mode analysis`,
  run_in_background: false
})
```

## Phase 4: Update Discussion Timeline

1. Write round content to `<session>/discussions/discussion-round-<num>.json`:
```json
{
  "round": 1, "type": "initial", "user_feedback": "...",
  "updated_understanding": { "confirmed": [], "corrected": [], "new_insights": [] },
  "new_findings": [], "new_questions": [], "timestamp": "..."
}
```

2. Append round section to `<session>/discussion.md`:
```markdown
### Round <N> - Discussion (<timestamp>)
#### Type: <discussType>
#### User Input: <userFeedback or "(Initial discussion round)">
#### Updated Understanding
**Confirmed**: <list> | **Corrected**: <list> | **New Insights**: <list>
#### New Findings / Open Questions
```

Update `<session>/wisdom/.msg/meta.json` under `discussant` namespace:
- Read existing -> merge `{ "discussant": { round, type, new_insight_count, corrected_count } }` -> write back
