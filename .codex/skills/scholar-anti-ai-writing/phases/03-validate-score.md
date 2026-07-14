# Phase 3: Validate & Score

## Objective

Re-score the polished text using the same five dimensions from Phase 1, compare before/after results, apply threshold checks, and generate a final report with all changes documented.

## Execution

### Step 3.1: Re-Score

Apply the identical 5-dimension scoring rubric from Phase 1 to the polished text.

| Dimension | Scoring Criteria (same as Phase 1) |
|-----------|-----------------------------------|
| **Directness** (1-10) | Are claims stated without pre-announcement or softening? |
| **Rhythm** (1-10) | Are sentence lengths and structures varied? |
| **Trust** (1-10) | Are facts stated without over-explanation? |
| **Authenticity** (1-10) | Does the text sound like a specific person wrote it? |
| **Density** (1-10) | Does every word earn its place? |

**Scoring procedure**:
1. Score each section independently (same sections as Phase 1)
2. Weight section scores by word count for overall scores
3. Record specific passages that demonstrate improvements as evidence
4. Note any passages where scores did not improve or regressed

### Step 3.2: Compare

Generate a before/after comparison across all dimensions.

**Score Delta Table**:

```
Dimension      | Before | After | Delta | Change
---------------|--------|-------|-------|-------
Directness     |   X    |   Y   |  +/-  |  +N%
Rhythm         |   X    |   Y   |  +/-  |  +N%
Trust          |   X    |   Y   |  +/-  |  +N%
Authenticity   |   X    |   Y   |  +/-  |  +N%
Density        |   X    |   Y   |  +/-  |  +N%
---------------|--------|-------|-------|-------
TOTAL          |  /50   |  /50  |  +/-  |  +N%
```

**Sample Passages**: Select the 3-5 passages showing the biggest improvements. For each, show:
- Original text
- Rewritten text
- Which patterns were removed (pattern IDs)
- Which dimension(s) improved most

**Regression Check**: Flag any passages where a dimension score decreased. These need review -- the rewrite may have introduced new issues or lost important nuance.

### Step 3.3: Threshold Check

Apply threshold rules to the total score (out of 50):

| Total Score | Rating | Action |
|-------------|--------|--------|
| >= 45 | Excellent | AI patterns effectively removed. Text reads as human-written. Proceed to final report. |
| 35-44 | Good | Most patterns removed. Flag specific sections scoring below 7 on any dimension for optional touch-up. Proceed to final report with recommendations. |
| < 35 | Needs Revision | Significant AI patterns remain. Identify the lowest-scoring sections and dimensions. Return to Phase 2 Step 2.1 for targeted re-polish of flagged sections only. |

**Revision loop rules** (when score < 35):
- Maximum 2 revision loops allowed
- Each loop targets only sections scoring below 7 on any dimension
- If score remains < 35 after 2 loops, proceed to final report with explicit warnings about remaining patterns
- Track which sections improved across loops to avoid infinite cycling

### Step 3.4: Generate Report

Produce a structured final report containing all analysis results.

**Report Structure**:

```markdown
# Anti-AI Writing Report

## Summary
- Input: <filename or "pasted text">, <word count>, <language>
- Patterns found: <total> (high: <n>, medium: <n>, low: <n>)
- Patterns fixed: <n>/<total>
- Score improvement: <before>/50 -> <after>/50 (+<delta>)
- Rating: <Excellent|Good|Needs Revision>

## Score Comparison
<Score delta table from Step 3.2>

## Top Improvements
<3-5 best before/after passage comparisons>

## Changes Log
For each change:
- Location: <section, paragraph, line>
- Pattern: <pattern ID and name>
- Original: "<original text>"
- Revised: "<revised text>"
- Rule applied: <rule name from Phase 2>

## Remaining Issues (if any)
- Passages where patterns persist
- Sections scoring below 7 on any dimension
- Recommendations for manual review

## Polished Text
<Complete polished text, ready for use>
```

## Output

```
finalReport:
  summary:
    input: <filename or description>
    wordCount: <n>
    language: <detected language>
    patternsFound: <total>
    patternsFixed: <n>
    scoreBefore: <n>/50
    scoreAfter: <n>/50
    rating: <Excellent|Good|Needs Revision>
  scores:
    before: { directness, rhythm, trust, authenticity, density, total }
    after: { directness, rhythm, trust, authenticity, density, total }
    delta: { directness, rhythm, trust, authenticity, density, total }
  topImprovements: [{ original, revised, patternsRemoved, dimensionsImproved }]
  changesLog: [{ location, patternId, original, revised, ruleApplied }]
  remainingIssues: [{ location, description, recommendation }]
  polishedText: "<complete final text>"
  revisionLoops: <0|1|2>
```

## Next Phase

None -- this is the final phase. Deliver `finalReport` and `polishedText` to the user.
