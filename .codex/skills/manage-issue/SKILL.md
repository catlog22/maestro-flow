---
name: manage-issue
description: Create, query, update, close, and link issues
argument-hint: <create|list|status|update|close|link> [options]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
version: 0.5.50
---

<purpose>
Issue CRUD operations: create, list, status, update, close, and link issues to tasks.
All data stored in `.workflow/issues/issues.jsonl` with auto-created directory on first use.

**Closed-loop workflow**: issue → `$maestro-analyze --gaps <ISS-ID>` (root cause analysis) → `$maestro-plan --gaps` (solution planning) → `$maestro-execute` (implementation). For automated issue discovery, use `$manage-issue-discover`.
</purpose>

<required_reading>
Read `~/.maestro/workflows/issue.md` before executing any subcommand. This file defines the issue.json schema, ID format, field validation rules, and JSONL storage conventions.
@~/.maestro/workflows/run-mode.md
</required_reading>

<context>
$ARGUMENTS — subcommand followed by options.

```bash
$manage-issue "create --title 'Auth token expiry bug' --severity high --source manual"
$manage-issue "list --status open --severity high"
$manage-issue "status ISS-20260318-001"
$manage-issue "update ISS-20260318-001 --priority critical --tags auth,security"
$manage-issue "close ISS-20260318-001 --resolution fixed"
$manage-issue "link ISS-20260318-001 --task TASK-003"
```

**Subcommands**: `create`, `list`, `status`, `update`, `close`, `link`.

**Output boundary**: ALL file writes MUST target `.workflow/issues/issues.jsonl`, `.workflow/issues/issue-history.jsonl`, or `.workflow/issues/` directory only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Schema compliance** — every issue record MUST conform to the canonical issue.json template schema
2. **ID uniqueness** — issue IDs (ISS-XXXXXXXX-NNN) MUST be unique across issues.jsonl and issue-history.jsonl
3. **Close moves to history** — `close` subcommand MUST move the record from issues.jsonl to issue-history.jsonl, NEVER delete without archiving
4. **Bidirectional links** — `link` subcommand MUST create references in both the issue and the linked task
5. **Confirmation on destructive ops** — `close` and bulk `update` MUST require user confirmation unless `-y` flag is set
6. **Append-only audit** — NEVER overwrite existing issue records; updates MUST preserve all prior fields and add `updated_at` timestamp
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Execute** (Subcommand routing)
- REQUIRED: Subcommand parsed and validated against valid set (create/list/status/update/close/link).
- REQUIRED: `.workflow/issues/` directory exists (auto-create with empty issues.jsonl if missing).
- BLOCKED if E_NO_SUBCOMMAND or E_INVALID_SUBCOMMAND.

**GATE 2: Execute → Write** (For mutating subcommands: create/update/close/link)
- REQUIRED: Target issue exists for update/close/link operations.
- REQUIRED: User confirmation for close operations (unless -y).
- REQUIRED: For link: both issue and task validated before any writes.
- BLOCKED if target not found or confirmation denied.

### Step 1: Parse Subcommand

Extract first token as subcommand. Valid: `create`, `list`, `status`, `update`, `close`, `link`.
If missing or invalid, display usage and prompt user (E_NO_SUBCOMMAND, E_INVALID_SUBCOMMAND).

### Step 2: Ensure Storage

If `.workflow/issues/` does not exist, auto-create the directory and write an empty `issues.jsonl` file. Log as E_ISSUES_DIR_MISSING (warning, non-blocking).

### Step 3: Execute Subcommand

**create**: Read `~/.maestro/templates/issue.json` for schema. Generate ID `ISS-{YYYYMMDD}-{NNN}`. If required fields are missing, prompt via `request_user_input`:
```json
{ "questions": [{ "id": "issue_title", "header": "New Issue", "question": "What is the issue title?" }, { "id": "issue_severity", "header": "Issue Severity", "question": "What severity level?", "options": [{ "label": "high (Recommended)", "description": "Production-impacting or blocking" }, { "label": "medium", "description": "Degraded functionality" }, { "label": "low", "description": "Minor or cosmetic" }] }] }
```
Append JSON line to `issues.jsonl`.

**list**: Read both `issues.jsonl` (active) and `issue-history.jsonl` (closed) to build the full issue set. Filter by `--status`, `--phase`, `--severity`, `--source`. When `--status closed` is specified, read from `issue-history.jsonl`. When no `--status` filter, merge both files. Display as table:
```
ID              | Severity | Status | Title
ISS-20260318-001 | high     | open   | Auth token expiry bug
ISS-20260310-003 | medium   | closed | Stale cache entries
```

**status**: Find issue by ID in `issues.jsonl`. Display all fields in detail format.

**update**: Find issue by ID, merge provided fields, rewrite the line in `issues.jsonl`. Track `updated_at` timestamp.

**close**: Find issue by ID, set status to `closed`, add `resolution` and `closed_at`. Move line from `issues.jsonl` to `issue-history.jsonl`.

**link**: Bidirectional cross-reference between issue and task:
1. **Pre-validate**: Verify issue ID exists in `issues.jsonl` AND task file exists at `.workflow/.task/{TASK-ID}.json` (or `.task/{TASK-ID}.json`). If either is missing, abort with error before any writes
2. **Save rollback state**: Read and store the original issue line from `issues.jsonl` before modification
3. **First write**: Find issue by ID in `issues.jsonl`, add task ID to issue's `linked_tasks[]` array, rewrite the line
4. **Second write**: Read task JSON. Edit the task's `linked_issues` field — append the issue ID to the array. If `linked_issues` field does not exist, create it as `[ISS-ID]`
5. **Rollback on failure**: If the second write (task file) fails, restore the original issue line in `issues.jsonl` from the saved rollback state and report the error
6. Both writes must succeed for the link to be considered complete
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E_NO_SUBCOMMAND | error | No subcommand provided -- display valid subcommands |
| E_INVALID_SUBCOMMAND | error | Unrecognized subcommand |
| E_ISSUES_DIR_MISSING | warning | `.workflow/issues/` not found — auto-create directory and empty issues.jsonl |
</error_codes>

<success_criteria>
- [ ] Subcommand parsed and validated
- [ ] Storage directory and files auto-created on first use
- [ ] create: generates unique ISS-id, prompts for required fields, appends to JSONL
- [ ] list: filters by status/phase/severity/source, renders table
- [ ] status: displays full detail for given ISS-id
- [ ] update: merges fields, tracks updated_at timestamp
- [ ] close: sets status closed, moves to history file
- [ ] link: bidirectional cross-reference between issue and task
</success_criteria>
