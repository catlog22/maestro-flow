---
name: manage-issue
description: Create, query, update, close, and link issues
argument-hint: "<subcommand: create|list|status|update|close|link> [--title text] [--severity S] [--status S] [--resolution text]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Issue lifecycle management: create, list, status, update, close, link. Stored in `.workflow/issues/issues.jsonl`. For automated discovery, use `/manage-issue-discover`.
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
Parse subcommand from first token of $ARGUMENTS.
Follow '~/.maestro/workflows/issue.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Execute** (Subcommand routing)
- REQUIRED: Subcommand parsed and validated against valid set (create/list/status/update/close/link).
- REQUIRED: `.workflow/issues/` directory exists (auto-create with empty issues.jsonl if missing).
- BLOCKED if E_NO_SUBCOMMAND or E_INVALID_SUBCOMMAND.

**GATE 2: Execute → Write** (For mutating subcommands: create/update/close/link)
- REQUIRED: Issue data validated against issue.json template schema.
- REQUIRED: For `close`: resolution text provided.
- REQUIRED: For `link`: target task ID resolved and exists.
- BLOCKED if schema validation fails or target references unresolvable.
</execution>

<completion>
### Next-step routing

| Subcommand | Suggestion |
|-----------|-----------|
| create | `/maestro-analyze --gaps <ISS-ID>` or `/maestro-plan --gaps` |
| list | `/maestro-analyze --gaps <ISS-ID>` for open issues |
| close | `/manage-status` |
</completion>

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
- [ ] Next step routed by subcommand
</success_criteria>
