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
Extract ISS-ID (required, pattern ISS-\d{8}-\d{3}).
Flags: --executor claude-code|codex|gemini (default: claude-code), --dry-run (default: false)
```

---

### Step 2: Load Issue and Validate

```
Load ISS-ID from .workflow/issues/issues.jsonl → fatal if file missing or ID not found.
Require issue.solution with non-empty steps[] → error if missing (run manage-issue-plan first).
Resolve EXECUTOR → CLI tool (claude-code→claude, codex→codex, gemini→gemini), all with --mode write.
```

---

### Step 3: Dry Run (if --dry-run)

```
If DRY_RUN: display prompt template, steps table (action | title | files),
and context. No changes made. Exit before Step 4.
```

---

### Step 4: Detect Execution Mode

```
Health check: curl http://127.0.0.1:3001/api/health
  HTTP 200 → SERVER_UP (server dispatch) | otherwise → Direct CLI
```

---

### Step 5a: Server UP Path

```
POST to http://127.0.0.1:3001/api/execution/dispatch:
  { "issueId", "executor", "solution": { steps, context, promptTemplate } }

Success (200/201) → server manages status lifecycle, skip to Step 6.
Failure → fall through to Step 5b (direct CLI fallback).
```

### Step 5b: Server DOWN Path

```
Build EXEC_PROMPT from SOLUTION (promptTemplate + steps + context + constraints).

Status transitions in issues.jsonl with issue_history entries:
  1. Set status → in_progress (actor: EXECUTOR, note: "Execution started")
  2. Execute: maestro delegate "{EXEC_PROMPT}" --to {CLI_TOOL} --mode write
  3. On success → status = "resolved", resolved_at = NOW_ISO
     On failure → status = "open" (revert, no stuck in_progress)

Read-modify-write pattern preserves other issues.
```

---

### Step 6: Display Result

```
Display: execution status (COMPLETE/FAILED), mode, executor, issue title, new status.
  Server dispatch → show dispatch ID, "server managing lifecycle"
  Direct CLI success → show modified files list
  Failure → "reverted to open", suggest re-run or revise plan
```

---

### Step 7: Suggest Next Steps

```
Success → close issue, view status, run tests
Failure → retry with different executor, revise plan, re-analyze with --depth deep
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
