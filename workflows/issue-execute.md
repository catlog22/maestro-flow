# Workflow: Issue Execution

> **DEPRECATED**: This workflow was used by the deleted `manage-issue-execute` command.
> Use `maestro-execute` instead, which handles wave-based execution with automatic issue status sync.

Execute a planned solution for an issue via dual-mode agent dispatch (server or direct CLI).

## Input

- `$ARGUMENTS`: `<ISS-ID> [--executor claude-code|codex|gemini] [--dry-run]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Arguments

```
1. Extract ISS-ID from first positional token in $ARGUMENTS
   If empty → error E_NO_ISSUE_ID:
     "Usage: /manage-issue-execute <ISS-ID> [--executor claude-code|codex|gemini] [--dry-run]"
     "Example: /manage-issue-execute ISS-20260318-001 --executor codex --dry-run"

2. Parse optional flags:
   --executor VALUE  → EXECUTOR (default: claude-code)
   --dry-run         → DRY_RUN = true (default: false)

3. Validate:
   - ISS-ID matches pattern ISS-\d{8}-\d{3}
   - EXECUTOR is one of: claude-code, codex, gemini
```

---

### Step 2: Load Issue and Validate

```
1. Check .workflow/issues/issues.jsonl exists
   If not → fatal: "No issues file. Run /manage-issue create first."

2. Read .workflow/issues/issues.jsonl line by line
3. Parse each line as JSON, find record where id == ISS-ID
   If not found → error E_NO_ISSUE_ID:
     "Issue {ISS-ID} not found. Run /manage-issue list to see available issues."

4. Check issue.solution exists and is not null:
   If null → error E_NO_SOLUTION:
     "Issue {ISS-ID} has no solution plan."
     "Run first: /manage-issue-plan {ISS-ID}"

5. Validate solution.steps is a non-empty array
   If empty → error E_NO_SOLUTION:
     "Solution plan has no steps. Re-run: /manage-issue-plan {ISS-ID}"

6. Resolve EXECUTOR to CLI tool mapping:
   - claude-code → claude (--tool claude --mode write)
   - codex → codex (--tool codex --mode write)
   - gemini → gemini (--tool gemini --mode write)

7. Store issue record as ISSUE, solution as SOLUTION
```

---

### Step 3: Dry Run (if --dry-run)

```
If DRY_RUN == true:

  Display preview:

  ====================================================
    DRY RUN: {ISS-ID}
    Executor: {EXECUTOR}
    Steps: {SOLUTION.steps.length}
  ====================================================

  PROMPT TEMPLATE:
    {SOLUTION.promptTemplate}

  SOLUTION STEPS:
  ---------------------------------------------------------------
  #  | Action  | Title                          | Files
  ---------------------------------------------------------------
  {for each step in SOLUTION.steps}
  {index} | {step.action} | {step.title} | {step.files joined by ", "}
  {/for}
  ---------------------------------------------------------------

  CONTEXT:
    {SOLUTION.context}

  ====================================================
  This is a dry run. No changes were made.
  To execute: /manage-issue-execute {ISS-ID} --executor {EXECUTOR}
  ====================================================

  Exit (do not proceed to Steps 4-7).
```

---

### Step 4: Detect Execution Mode

```
1. Check if maestro dashboard server is running:
   curl http://127.0.0.1:3001/api/health --connect-timeout 2 -s -o /dev/null -w "%{http_code}"

2. If HTTP 200 → SERVER_UP = true
   Otherwise → SERVER_UP = false

3. Log execution mode:
   "Execution mode: {SERVER_UP ? 'Server dispatch' : 'Direct CLI'}"
```

---

### Step 5a: Server UP Path

```
If SERVER_UP == true:

1. Build dispatch payload:
   {
     "issueId": "{ISS-ID}",
     "executor": "{EXECUTOR}",
     "solution": {
       "steps": {SOLUTION.steps},
       "context": "{SOLUTION.context}",
       "promptTemplate": "{SOLUTION.promptTemplate}"
     }
   }

2. POST to server:
   curl -X POST http://127.0.0.1:3001/api/execution/dispatch \
     -H "Content-Type: application/json" \
     -d '{PAYLOAD_JSON}' \
     --connect-timeout 5 -s

3. Parse response:
   - If HTTP 200/201 → DISPATCH_SUCCESS = true, store response as DISPATCH_RESULT
   - If error → DISPATCH_SUCCESS = false, fall through to Step 5b

4. If DISPATCH_SUCCESS:
   - Do NOT update JSONL manually (server manages status)
   - Store DISPATCH_RESULT for display in Step 6
   - Skip to Step 6

5. If DISPATCH_FAILED:
   - Log: "Server dispatch failed, falling back to direct CLI execution"
   - Proceed to Step 5b
```

### Step 5b: Server DOWN Path

```
If SERVER_UP == false (or server dispatch failed):

1. Build execution prompt from SOLUTION:
   EXEC_PROMPT = "{SOLUTION.promptTemplate}

   SOLUTION STEPS:
   {for each step in SOLUTION.steps}
   {index}. [{step.action}] {step.title}
      Files: {step.files joined by ', '}
      Description: {step.description}
   {/for}

   CONTEXT: {SOLUTION.context}

   ISSUE: {ISS-ID} - {ISSUE.title}
   CONSTRAINTS: Follow solution steps in order. Verify each step before proceeding."

2. Update JSONL: Set issue status → in_progress
   - Read all lines from .workflow/issues/issues.jsonl
   - Update matching record:
     status = "in_progress"
     updated_at = NOW_ISO
     Add issue_history entry:
       {
         "timestamp": "{NOW_ISO}",
         "from_status": "{ISSUE.status}",
         "to_status": "in_progress",
         "actor": "{EXECUTOR}",
         "note": "Execution started (direct CLI)"
       }
   - Rewrite file

3. Execute via delegate:
   maestro delegate "{EXEC_PROMPT}" --to {CLI_TOOL} --mode write

4. Evaluate result:
   - If CLI exits successfully → EXEC_SUCCESS = true
   - If CLI fails → EXEC_SUCCESS = false

5. Update JSONL based on result:
   If EXEC_SUCCESS:
     status = "resolved"
     resolved_at = NOW_ISO
     updated_at = NOW_ISO
     Add issue_history entry:
       {
         "timestamp": "{NOW_ISO}",
         "from_status": "in_progress",
         "to_status": "resolved",
         "actor": "{EXECUTOR}",
         "note": "Solution executed successfully"
       }

   If EXEC_FAILED:
     status = "open"
     updated_at = NOW_ISO
     Add issue_history entry:
       {
         "timestamp": "{NOW_ISO}",
         "from_status": "in_progress",
         "to_status": "open",
         "actor": "{EXECUTOR}",
         "note": "Execution failed — reverted to open"
       }
   - Rewrite JSONL file

6. Store result for display
```

---

### Step 6: Display Result

```
Display execution summary:

====================================================
  EXECUTION {EXEC_SUCCESS or DISPATCH_SUCCESS ? "COMPLETE" : "FAILED"}: {ISS-ID}
  Mode: {SERVER_UP ? "Server dispatch" : "Direct CLI"}
  Executor: {EXECUTOR}
====================================================

ISSUE: {ISSUE.title}
STATUS: {new status}

{If SERVER_UP and DISPATCH_SUCCESS}
  Dispatch ID: {DISPATCH_RESULT.id or "N/A"}
  Server is managing execution lifecycle.

{If not SERVER_UP and EXEC_SUCCESS}
  Solution applied successfully.
  Files modified: {list from SOLUTION.steps[].files}

{If failure}
  Execution failed. Issue reverted to open status.
  Review the error output above and consider:
  - Re-running with a different executor
  - Revising the solution plan

====================================================
```

---

### Step 7: Suggest Next Steps

```
If execution succeeded:
  - Skill({ skill: "manage-issue", args: "close {ISS-ID} --resolution \"Fixed via {EXECUTOR} execution\"" }) -- Close the issue
  - Skill({ skill: "manage-issue", args: "status {ISS-ID}" }) -- View updated issue
  - Skill({ skill: "quality-test", args: "" }) -- Run tests to verify fix

If execution failed:
  - Skill({ skill: "manage-issue-execute", args: "{ISS-ID} --executor codex" }) -- Retry with different executor
  - Skill({ skill: "manage-issue-plan", args: "{ISS-ID}" }) -- Revise solution plan
  - Skill({ skill: "manage-issue-analyze", args: "{ISS-ID} --depth deep" }) -- Re-analyze with deeper context
  - Skill({ skill: "manage-issue", args: "status {ISS-ID}" }) -- View current issue state
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue status transitions (open -> in_progress -> resolved/open)
- **Execution modes**: Server dispatch (POST /api/execution/dispatch) or Direct delegate (maestro delegate --mode write)

## Quality Criteria

- Dual-mode execution: server dispatch preferred, CLI fallback automatic
- Dry-run mode shows full prompt without side effects
- Status transitions recorded in issue_history with actor and timestamp
- Failed execution reverts status to open (no stuck in_progress)
- Read-modify-write pattern preserves other issues in JSONL
- Next-step routing adapts based on success or failure
