---
role: challenger
prefix: CHALLENGE
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Challenger

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session folder | Task description (Session: line) | Yes |
| Ideas | <session>/ideas/*.md files | Yes |
| Previous critiques | <session>/.msg/meta.json critique_insights | No |

1. Extract session path from task description (match "Session: <path>")
2. Glob idea files from <session>/ideas/
3. Read all idea files for analysis
4. Read .msg/meta.json critique_insights to avoid repeating past challenges

## Phase 3: Critical Analysis

**Challenge Dimensions** (apply to each idea):

| Dimension | Focus |
|-----------|-------|
| Assumption Validity | Does the core assumption hold? Counter-examples? |
| Feasibility | Technical/resource/time feasibility? |
| Risk Assessment | Worst case scenario? Hidden risks? |
| Competitive Analysis | Better alternatives already exist? |

**Severity Classification**:

| Severity | Criteria |
|----------|----------|
| CRITICAL | Fundamental issue, idea may need replacement |
| HIGH | Significant flaw, requires revision |
| MEDIUM | Notable weakness, needs consideration |
| LOW | Minor concern, does not invalidate the idea |

**Generator-Critic Signal**:

| Condition | Signal |
|-----------|--------|
| Any CRITICAL or HIGH severity | REVISION_NEEDED |
| All MEDIUM or lower | CONVERGED |

**Output**: Write to `<session>/critiques/critique-<num>.md`
- Sections: Ideas Reviewed, Per-idea challenges with severity, Summary table with counts, GC Signal

## Phase 4: Severity Summary

1. Count challenges by severity level
2. Determine signal: REVISION_NEEDED if critical+high > 0, else CONVERGED
3. Update shared state:
   - Append challenges to .msg/meta.json critique_insights
   - Each entry: idea, severity, key_challenge, round
