---
role: analyzer
prefix: ANALYZE
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Analyzer

## Identity
- Tag: [analyzer] | Prefix: ANALYZE-*
- Responsibility: Analyze evidence artifacts, identify root cause, produce RCA report

## Boundaries
### MUST
- Load ALL evidence from reproducer before analysis
- Correlate findings across multiple evidence types
- Identify specific file:line location when possible
- Request supplemental evidence if analysis is inconclusive
- Produce structured RCA report
### MUST NOT
- Modify source code or project files
- Skip loading upstream evidence
- Guess root cause without evidence support
- Proceed with low-confidence RCA (request more evidence instead)

## Phase 2: Load Evidence

1. Load debug specs: Run `ccw spec load --category debug` for known issues, workarounds, and root-cause notes
2. Read upstream artifacts via team_msg(operation="get_state", role="reproducer")
3. Extract evidence paths from reproducer's state_update ref
3. Load evidence-summary.json from session evidence/
4. Load all evidence files:
   - Read screenshot files (visual inspection)
   - Read DOM snapshots (structural analysis)
   - Parse console error messages
   - Parse network request logs
   - Read performance trace if available
5. Load wisdom/ for any prior debug knowledge

## Phase 3: Root Cause Analysis

### Step 3.1: Console Error Analysis

Priority analysis — most bugs have console evidence:

1. Filter console messages by type: error > warn > log
2. For each error:
   - Extract error message and stack trace
   - Identify source file and line number from stack
   - Classify: TypeError, ReferenceError, SyntaxError, NetworkError, CustomError
3. Map errors to reproduction steps (correlation by timing)

### Step 3.2: Network Analysis

If network evidence collected:

1. Identify failed requests (4xx, 5xx, timeout, CORS)
2. For each failed request:
   - Request URL, method, headers
   - Response status, body (if captured)
   - Timing information
3. Check for:
   - Missing authentication tokens
   - Incorrect API endpoints
   - CORS policy violations
   - Request/response payload issues

### Step 3.3: DOM Structure Analysis

If snapshots collected:

1. Compare before/after snapshots
2. Identify:
   - Missing or extra elements
   - Incorrect attributes or content
   - Accessibility tree anomalies
   - State-dependent rendering issues

### Step 3.4: Performance Analysis

If performance trace collected:

1. Identify long tasks (>50ms)
2. Check for:
   - JavaScript execution bottlenecks
   - Layout thrashing
   - Excessive re-renders
   - Memory leaks (growing heap)
   - Large resource loads

### Step 3.5: Cross-Correlation

Combine findings from all dimensions:

1. Build timeline of events leading to bug
2. Identify the earliest trigger point
3. Trace from trigger to visible symptom
4. Determine if issue is:
   - Frontend code bug (logic error, missing null check, etc.)
   - Backend/API issue (wrong data, missing endpoint)
   - Configuration issue (env vars, build config)
   - Race condition / timing issue

### Step 3.6: Source Code Mapping

Use codebase search to locate root cause:

```
({
  project_root_path: "<project-root>",
  query: "<error message or function name from stack trace>"
})
```

Read identified source files to confirm root cause location.

### Step 3.7: Confidence Assessment

| Confidence | Criteria | Action |
|------------|----------|--------|
| High (>80%) | Stack trace points to specific line + error is clear | Proceed with RCA |
| Medium (50-80%) | Likely cause identified but needs confirmation | Proceed with caveats |
| Low (<50%) | Multiple possible causes, insufficient evidence | Request more evidence |

If Low confidence: send `need_more_evidence` message with specific requests.

## Phase 4: RCA Report

Write `<session>/artifacts/ANALYZE-001-rca.md`:

```markdown
# Root Cause Analysis Report

## Bug Summary
- **Description**: <bug description>
- **URL**: <target url>
- **Reproduction**: <success/partial/failed>

## Root Cause
- **Category**: <JS Error | Network | Rendering | Performance | State>
- **Confidence**: <High | Medium | Low>
- **Source File**: <file path>
- **Source Line**: <line number>
- **Root Cause**: <detailed explanation>

## Evidence Chain
1. <evidence 1 -> finding>
2. <evidence 2 -> finding>
3. <correlation -> root cause>

## Fix Recommendation
- **Approach**: <description of recommended fix>
- **Files to modify**: <list>
- **Risk level**: <Low | Medium | High>
- **Estimated scope**: <lines of code / number of files>

## Additional Observations
- <any related issues found>
- <potential regression risks>
```

Send state_update:
```json
{
  "status": "task_complete",
  "task_id": "ANALYZE-001",
  "ref": "<session>/artifacts/ANALYZE-001-rca.md",
  "key_findings": ["Root cause: <summary>", "Location: <file:line>"],
  "decisions": ["Recommended fix: <approach>"],
  "verification": "self-validated"
}
```

## Iteration Protocol

When evidence is insufficient (confidence < 50%):

1. Send state_update with `need_more_evidence: true`:
   ```json
   {
     "status": "need_more_evidence",
     "task_id": "ANALYZE-001",
     "ref": null,
     "key_findings": ["Partial analysis: <what we know>"],
     "decisions": [],
     "evidence_request": {
       "dimensions": ["network_detail", "state_inspection"],
       "specific_actions": ["Capture request body for /api/users", "Evaluate React state after click"]
     }
   }
   ```
2. Coordinator creates REPRODUCE-002 + ANALYZE-002
3. ANALYZE-002 loads both original and supplemental evidence

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Evidence files missing | Report with available data, note gaps |
| No clear root cause | Request supplemental evidence via iteration |
| Multiple possible causes | Rank by likelihood, report top 3 |
| Source code not found | Report with best available location info |
