---
name: manage-issue
description: Issue CRUD operations -- create, query, update, close, and link issues to tasks
argument-hint: "<create|list|status|update|close|link> [options]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Issue lifecycle management for the project issue tracker. Supports create, list, status, update, close, and link (bidirectional issue-task cross-reference). All issues stored in `.workflow/issues/issues.jsonl` using the issue.json schema.

For automated issue discovery, use `/manage-issue-discover`.

**Closed-loop workflow**: After creating an issue, use `/manage-issue-analyze` for root cause analysis, `/manage-issue-plan` for solution planning, and `/manage-issue-execute` for execution.
</purpose>

<required_reading>
@~/.maestro/workflows/issue.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) — read when creating or updating issue records (create, update, close)
</deferred_reading>

<context>
$ARGUMENTS -- subcommand + options. Parse first token as subcommand.

**Valid subcommands:**
- `create` -- create a new issue (--title, --severity, --source, --phase, --description)
- `list` -- list issues with optional filters (--status, --phase, --severity, --source)
- `status` -- show full detail for a specific issue (ISS-XXXXXXXX-NNN)
- `update` -- update issue fields (ISS-XXXXXXXX-NNN --status, --priority, --severity, --tags, ...)
- `close` -- close an issue with resolution (ISS-XXXXXXXX-NNN --resolution)
- `link` -- link issue to a task (ISS-XXXXXXXX-NNN --task TASK-NNN)

**State files:**
- `.workflow/issues/issues.jsonl` -- active issues (one JSON per line)
- `.workflow/issues/issue-history.jsonl` -- archived/closed issues
</context>

<execution>
Parse subcommand from first token of $ARGUMENTS.
Follow '~/.maestro/workflows/issue.md' completely.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_SUBCOMMAND | error | No subcommand provided in $ARGUMENTS | Display valid subcommands, prompt user to select |
| E_INVALID_SUBCOMMAND | error | Unrecognized subcommand | Display valid subcommands with usage hints |
| E_ISSUES_DIR_MISSING | warning | `.workflow/issues/` directory does not exist | Auto-create directory and empty issues.jsonl |
</error_codes>

<success_criteria>
- [ ] Subcommand parsed and routed to correct handler
- [ ] Issue data read/written to correct JSONL file
- [ ] Output displayed in appropriate format (table for list, detail for status)
- [ ] Cross-references maintained (link creates bidirectional references)
</success_criteria>
