---
name: manage-issue
description: Issue CRUD -- create, list, status, update, close, and link issues to tasks
argument-hint: "<create|list|status|update|close|link> [options]"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Issue CRUD operations: create, list, status, update, close, and link issues to tasks.
All data stored in `.workflow/issues/issues.jsonl` with auto-created directory on first use.
</purpose>

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
</context>

<execution>

### Step 1: Parse Subcommand

Extract first token as subcommand. Valid: `create`, `list`, `status`, `update`, `close`, `link`.
If missing or invalid, display usage and prompt user (E_NO_SUBCOMMAND, E_INVALID_SUBCOMMAND).

### Step 2: Ensure Storage

```bash
mkdir -p .workflow/issues
touch .workflow/issues/issues.jsonl 2>/dev/null
```

Auto-create directory and empty file if missing (E_ISSUES_DIR_MISSING handled silently).

### Step 3: Execute Subcommand

**create**: Read `~/.maestro/templates/issue.json` for schema. Generate ID `ISS-{YYYYMMDD}-{NNN}`. Prompt for missing required fields (title, severity). Append JSON line to `issues.jsonl`.

**list**: Read `issues.jsonl`, filter by `--status`, `--phase`, `--severity`, `--source`. Display as table:
```
ID              | Severity | Status | Title
ISS-20260318-001 | high     | open   | Auth token expiry bug
```

**status**: Find issue by ID in `issues.jsonl`. Display all fields in detail format.

**update**: Find issue by ID, merge provided fields, rewrite the line in `issues.jsonl`. Track `updated_at` timestamp.

**close**: Find issue by ID, set status to `closed`, add `resolution` and `closed_at`. Move line from `issues.jsonl` to `issue-history.jsonl`.

**link**: Find issue by ID, add task reference to issue's `linked_tasks` array. If task JSON exists (`.task/TASK-*.json`), add issue reference to task's `linked_issues`. Bidirectional cross-reference.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E_NO_SUBCOMMAND | error | No subcommand provided -- display valid subcommands |
| E_INVALID_SUBCOMMAND | error | Unrecognized subcommand |
| E_ISSUES_DIR_MISSING | warning | `.workflow/issues/` not found -- auto-created |
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
