# Workflow: Issue Analysis

Root cause analysis for a specific issue using CLI exploration and codebase context gathering.

## Input

- `$ARGUMENTS`: `<ISS-ID> [--tool gemini|qwen] [--depth standard|deep]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Arguments

```
1. Extract ISS-ID from first positional token in $ARGUMENTS
   If empty → error E_NO_ISSUE_ID:
     "Usage: /manage-issue-analyze <ISS-ID> [--tool gemini|qwen] [--depth standard|deep]"
     "Example: /manage-issue-analyze ISS-20260318-001 --tool gemini --depth deep"

2. Parse optional flags:
   --tool VALUE    → TOOL (default: gemini)
   --depth VALUE   → DEPTH (default: standard)

3. Validate:
   - ISS-ID matches pattern ISS-\d{8}-\d{3}
   - TOOL is one of: gemini, qwen
   - DEPTH is one of: standard, deep
```

---

### Step 2: Load Issue and Validate

```
1. Check .workflow/issues/issues.jsonl exists
   If not → fatal: "No issues file. Run /manage-issue create first."

2. Read .workflow/issues/issues.jsonl line by line
3. Parse each line as JSON, find record where id == ISS-ID
   If not found → error E_ISSUE_NOT_FOUND:
     "Issue {ISS-ID} not found. Run /manage-issue list to see available issues."

4. Check issue status:
   - If status is 'open' or 'registered' → proceed
   - Otherwise → warning E_INVALID_STATUS:
     "Issue {ISS-ID} has status '{status}'. Analysis typically runs on open issues."
     Proceed anyway (analysis is non-destructive metadata enrichment).

5. Store issue record as ISSUE for subsequent steps
```

---

### Step 3: Gather Codebase Context

```
1. Extract keywords from ISSUE.title and ISSUE.description
   - Split into significant words (>3 chars, skip stop words)
   - Include ISSUE.context.location if present
   - Include ISSUE.affected_components[] if present

2. If DEPTH == "standard":
   - Use Grep to search for each keyword in source files:
     rg "{keyword}" --type-add "src:*.{ts,tsx,js,jsx,py,java,go}" --type src -l
   - Collect up to 20 matching file paths
   - For top 5 files by match count, read relevant sections (10 lines around match)

3. If DEPTH == "deep":
   - Run standard keyword grep (above)
   - Additionally, launch Agent for semantic search:
     Search for code related to: "{ISSUE.title} - {ISSUE.description}"
     Focus on: error handling, data flow, dependencies
   - Merge results from both approaches

4. Build CONTEXT_SUMMARY:
   - List of related files with brief relevance notes
   - Key code snippets (max 50 lines total)
   - Dependency chain if identifiable

5. Store as CODEBASE_CONTEXT for CLI prompt
```

---

### Step 4: Run CLI Analysis

```
1. Build analysis prompt:

   ccw cli -p "PURPOSE: Root cause analysis for issue {ISS-ID}: {ISSUE.title}
   Identify the root cause, assess impact, and suggest an approach.

   ISSUE DETAILS:
   - Title: {ISSUE.title}
   - Description: {ISSUE.description}
   - Severity: {ISSUE.severity}
   - Location: {ISSUE.context.location or 'unknown'}
   - Fix Direction: {ISSUE.fix_direction or 'none provided'}

   CODEBASE CONTEXT:
   {CODEBASE_CONTEXT}

   TASK:
   - Identify the root cause with file:line references
   - Assess impact scope (which components/features affected)
   - List all related files that need attention
   - Rate confidence in the analysis (high/medium/low)
   - Suggest a fix approach (brief, actionable)

   MODE: analysis
   CONTEXT: @**/*
   EXPECTED: JSON object with fields:
     root_cause: string (clear explanation),
     impact: string (scope of impact),
     related_files: string[] (file paths),
     confidence: 'high'|'medium'|'low',
     suggested_approach: string (actionable fix direction)
   CONSTRAINTS: Only cite evidence found in codebase, no speculation
   " --tool {TOOL} --mode analysis

2. Parse CLI output:
   - Extract JSON object from response
   - Validate required fields: root_cause, impact, related_files, confidence, suggested_approach
   - If parsing fails → error E_ANALYSIS_FAILED:
     "Analysis did not return valid JSON. Raw output saved for review."
     Store raw output in ISSUE feedback for manual review.

3. Store parsed result as ANALYSIS_RESULT
```

---

### Step 5: Build Analysis Record

```
1. Construct IssueAnalysis record:
   {
     "root_cause": "{ANALYSIS_RESULT.root_cause}",
     "impact": "{ANALYSIS_RESULT.impact}",
     "related_files": {ANALYSIS_RESULT.related_files},
     "confidence": "{ANALYSIS_RESULT.confidence}",
     "suggested_approach": "{ANALYSIS_RESULT.suggested_approach}",
     "analyzed_at": "{NOW_ISO}",
     "analyzed_by": "{TOOL}"
   }

2. Store as ANALYSIS record for next step
```

---

### Step 6: Update Issue in JSONL

```
1. Read all lines from .workflow/issues/issues.jsonl
2. Find the line matching ISS-ID
3. Update the issue record:
   - Set issue.analysis = ANALYSIS
   - Set issue.updated_at = NOW_ISO
   - Add issue_history entry:
     {
       "timestamp": "{NOW_ISO}",
       "from_status": "{ISSUE.status}",
       "to_status": "{ISSUE.status}",
       "actor": "analysis-agent",
       "note": "Root cause analysis completed (confidence: {ANALYSIS.confidence})"
     }
   - Status stays unchanged (analysis is metadata enrichment, not a status transition)

4. Rewrite .workflow/issues/issues.jsonl:
   - Replace the matching line with updated record (single JSON line)
   - Write all lines back to file

5. Verify file integrity:
   - Re-read file, confirm ISS-ID record has analysis field
```

---

### Step 7: Display Summary and Next Steps

```
Display analysis summary:

====================================================
  ANALYSIS COMPLETE: {ISS-ID}
  Tool: {TOOL}    Depth: {DEPTH}
====================================================

ROOT CAUSE:
  {ANALYSIS.root_cause}

IMPACT:
  {ANALYSIS.impact}

CONFIDENCE: {ANALYSIS.confidence}

RELATED FILES:
  {for each file in ANALYSIS.related_files}
  - {file}
  {/for}

SUGGESTED APPROACH:
  {ANALYSIS.suggested_approach}
====================================================

Suggest next steps:
  - Skill({ skill: "manage-issue-plan", args: "{ISS-ID}" }) -- Generate solution plan
  - Skill({ skill: "manage-issue-plan", args: "{ISS-ID} --tool {TOOL}" }) -- Plan with same tool
  - Skill({ skill: "manage-issue", args: "status {ISS-ID}" }) -- View full issue details
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue record enriched with `analysis` field
- **Analysis fields**: root_cause, impact, related_files, confidence, suggested_approach, analyzed_at, analyzed_by

## Quality Criteria

- Analysis grounded in actual codebase evidence (file:line references)
- JSON result validated before writing to JSONL
- Issue status unchanged (analysis is non-destructive enrichment)
- Read-modify-write pattern preserves other issues in JSONL
- Next-step routing guides user to solution planning
