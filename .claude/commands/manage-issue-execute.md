---
name: manage-issue-execute
description: Execute planned solution for an issue via dual-mode agent dispatch
argument-hint: "<ISS-ID> [--executor claude-code|codex|gemini] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Execute a planned solution for a specific issue. Supports dual-mode dispatch:

- **Server UP**: POST to `/api/execution/dispatch` for orchestrated execution
- **Server DOWN**: Direct execution via `maestro cli` with the solution prompt

Options:
- **--executor**: Agent to execute the solution (default: claude-code)
- **--dry-run**: Display the constructed prompt and steps without executing

For issue CRUD, use `/manage-issue`. For analysis, use `/manage-issue-analyze`. For planning, use `/manage-issue-plan`.
</purpose>

<required_reading>
@~/.maestro/workflows/issue-execute.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) -- read when updating issue status after execution
</deferred_reading>

<context>
$ARGUMENTS -- ISS-ID (required) + optional flags.

**Options:**
- `<ISS-ID>` -- issue ID in ISS-XXXXXXXX-NNN format (required)
- `--executor claude-code|codex|gemini` -- execution agent (default: claude-code)
- `--dry-run` -- preview prompt and steps without executing

**State files:**
- `.workflow/issues/issues.jsonl` -- issue records (read + write)
</context>

<execution>
Follow '~/.maestro/workflows/issue-execute.md' completely.

**Next-step routing on completion:**
- Execution succeeded → Skill({ skill: "manage-issue", args: "close <ISS-ID> --resolution fixed" })
- Execution failed → Skill({ skill: "quality-debug", args: "<failure description>" }) then retry
- Want verification → Skill({ skill: "maestro-verify", args: "{phase}" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_ISSUE_ID | error | No ISS-ID provided in $ARGUMENTS | Display usage hint with example |
| E_NO_SOLUTION | error | Issue has no solution record (issue.solution is null) | Suggest `/manage-issue-plan` first |
| E_DISPATCH_FAILED | error | Server dispatch or CLI execution failed | Log error, revert status to open, display failure details |
</error_codes>

<success_criteria>
- [ ] Issue loaded with valid solution record
- [ ] Execution mode detected (server UP or DOWN)
- [ ] Solution executed (or dry-run displayed)
- [ ] Issue status updated in issues.jsonl (in_progress -> resolved or open on failure)
- [ ] Result summary displayed with next-step routing:
  - Execution succeeded → Skill({ skill: "manage-issue", args: "close <ISS-ID> --resolution fixed" })
  - Execution failed → Skill({ skill: "quality-debug", args: "<failure description>" }) then retry
  - Want verification → Skill({ skill: "maestro-verify", args: "{phase}" })
</success_criteria>
