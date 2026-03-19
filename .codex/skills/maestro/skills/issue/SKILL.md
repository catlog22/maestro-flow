---
name: maestro-issue
description: Issue CRUD -- create, list, status, update, close, and link issues to tasks
argument-hint: "<create|list|status|update|close|link> [options]"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Issue Management

## Usage

```bash
$maestro-issue "create --title 'Auth token expiry bug' --severity high --source manual"
$maestro-issue "list --status open --severity high"
$maestro-issue "status ISS-20260318-001"
$maestro-issue "update ISS-20260318-001 --priority critical --tags auth,security"
$maestro-issue "close ISS-20260318-001 --resolution fixed"
$maestro-issue "link ISS-20260318-001 --task TASK-003"
```

---

## Implementation

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

---

## Error Handling

| Code | Severity | Description |
|------|----------|-------------|
| E_NO_SUBCOMMAND | error | No subcommand provided -- display valid subcommands |
| E_INVALID_SUBCOMMAND | error | Unrecognized subcommand |
| E_ISSUES_DIR_MISSING | warning | `.workflow/issues/` not found -- auto-created |
