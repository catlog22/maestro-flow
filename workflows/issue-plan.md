# Workflow: Issue Planning

> **DEPRECATED**: This workflow was used by the deleted `manage-issue-plan` command.
> Use `maestro-plan --gaps` instead, which generates TASK files linked to issues via `task_refs`.

Solution planning for a specific issue with codebase-aware step generation and prompt template construction.

## Input

- `$ARGUMENTS`: `<ISS-ID> [--tool gemini|qwen] [--from-analysis]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Arguments

```
1. Extract ISS-ID from first positional token in $ARGUMENTS
   If empty → error E_NO_ISSUE_ID:
     "Usage: /manage-issue-plan <ISS-ID> [--tool gemini|qwen] [--from-analysis]"
     "Example: /manage-issue-plan ISS-20260318-001 --tool gemini"

2. Parse optional flags:
   --tool VALUE      → TOOL (default: gemini)
   --from-analysis   → FROM_ANALYSIS = true (default: auto-detect)

3. Validate:
   - ISS-ID matches pattern ISS-\d{8}-\d{3}
   - TOOL is one of: gemini, qwen
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
   - If status is other → warn but proceed (planning is non-destructive)

5. If issue.solution exists and is not null:
   AskUserQuestion({
     question: "Issue {ISS-ID} already has a solution plan. Overwrite?",
     options: [
       { label: "Yes", description: "Replace existing solution with new plan" },
       { label: "No", description: "Keep existing solution, abort planning" }
     ]
   })
   If "No" → exit gracefully

6. Store issue record as ISSUE
```

---

### Step 3: Load Analysis Context

```
1. Check if ISSUE.analysis exists and is not null:

   If analysis exists:
     - HAS_ANALYSIS = true
     - Extract: root_cause, impact, related_files, confidence, suggested_approach
     - Build ANALYSIS_CONTEXT:
       "PRIOR ANALYSIS (confidence: {confidence}):
        Root Cause: {root_cause}
        Impact: {impact}
        Related Files: {related_files joined by newline}
        Suggested Approach: {suggested_approach}"

   If analysis is null:
     - HAS_ANALYSIS = false
     - If --from-analysis was explicitly passed:
       → warning E_NO_ANALYSIS:
         "No analysis record on {ISS-ID}. Proceeding without analysis context."
         "For better results, run: /manage-issue-analyze {ISS-ID}"
     - ANALYSIS_CONTEXT = ""

2. Store ANALYSIS_CONTEXT for CLI prompt
```

---

### Step 4: Generate Solution via CLI

```
1. Build planning prompt:

   maestro delegate "PURPOSE: Generate a step-by-step solution plan for issue {ISS-ID}: {ISSUE.title}
   Produce an actionable, ordered list of implementation steps.

   ISSUE DETAILS:
   - Title: {ISSUE.title}
   - Description: {ISSUE.description}
   - Severity: {ISSUE.severity}
   - Location: {ISSUE.context.location or 'unknown'}
   - Fix Direction: {ISSUE.fix_direction or 'none provided'}

   {ANALYSIS_CONTEXT}

   TASK:
   - Break the fix into ordered, atomic implementation steps
   - Each step: title, description, target file(s), action type (create|modify|delete|test)
   - Include a context summary explaining the overall approach
   - Generate a promptTemplate string that an executor agent can use to implement the fix

   MODE: analysis
   CONTEXT: @**/*
   EXPECTED: JSON object with fields:
     steps: [{ title: string, description: string, files: string[], action: string }],
     context: string (approach summary),
     promptTemplate: string (execution prompt for the agent)
   CONSTRAINTS: Steps must be concrete and file-specific, not vague
   " --to {TOOL} --mode analysis

2. Parse CLI output:
   - Extract JSON object from response
   - Validate required fields: steps (array with length > 0), context, promptTemplate
   - Each step must have: title, description, files, action
   - If parsing fails → error E_PLANNING_FAILED:
     "Planning did not return valid JSON. Raw output saved for review."
     Store raw output in ISSUE feedback.

3. Store parsed result as SOLUTION_RESULT
```

---

### Step 5: Build Solution Record

```
1. Construct IssueSolution record:
   {
     "steps": {SOLUTION_RESULT.steps},
     "context": "{SOLUTION_RESULT.context}",
     "promptTemplate": "{SOLUTION_RESULT.promptTemplate}",
     "planned_at": "{NOW_ISO}",
     "planned_by": "{TOOL}"
   }

2. Store as SOLUTION record for next step
```

---

### Step 6: Update Issue in JSONL

```
1. Read all lines from .workflow/issues/issues.jsonl
2. Find the line matching ISS-ID
3. Update the issue record:
   - Set issue.solution = SOLUTION
   - Set issue.updated_at = NOW_ISO
   - Add issue_history entry:
     {
       "timestamp": "{NOW_ISO}",
       "from_status": "{ISSUE.status}",
       "to_status": "{ISSUE.status}",
       "actor": "planning-agent",
       "note": "Solution plan generated ({SOLUTION.steps.length} steps)"
     }
   - Status stays unchanged (planning is metadata enrichment)

4. Rewrite .workflow/issues/issues.jsonl:
   - Replace the matching line with updated record (single JSON line)
   - Write all lines back to file

5. Verify file integrity:
   - Re-read file, confirm ISS-ID record has solution field
```

---

### Step 7: Display Solution Steps Table and Next Steps

```
Display solution summary:

====================================================
  SOLUTION PLAN: {ISS-ID}
  Tool: {TOOL}    Analysis: {HAS_ANALYSIS ? "included" : "none"}
====================================================

APPROACH:
  {SOLUTION.context}

STEPS:
---------------------------------------------------------------
#  | Action  | Title                          | Files
---------------------------------------------------------------
1  | modify  | Fix token validation           | src/auth.ts
2  | create  | Add refresh token handler      | src/refresh.ts
3  | test    | Add auth test cases            | tests/auth.test.ts
---------------------------------------------------------------

PROMPT TEMPLATE (for executor):
  {SOLUTION.promptTemplate}

====================================================

Suggest next steps:
  - Skill({ skill: "manage-issue-execute", args: "{ISS-ID}" }) -- Execute solution
  - Skill({ skill: "manage-issue-execute", args: "{ISS-ID} --dry-run" }) -- Preview execution
  - Skill({ skill: "manage-issue-execute", args: "{ISS-ID} --executor codex" }) -- Execute with Codex
  - Skill({ skill: "manage-issue", args: "status {ISS-ID}" }) -- View full issue details
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue record enriched with `solution` field
- **Solution fields**: steps[], context, promptTemplate, planned_at, planned_by

## Quality Criteria

- Solution steps are concrete with specific file targets and action types
- Analysis context included when available for better accuracy
- Prompt template is self-contained and executable by an agent
- JSON result validated before writing to JSONL
- Issue status unchanged (planning is non-destructive enrichment)
- Read-modify-write pattern preserves other issues in JSONL
- Next-step routing guides user to execution
