---
name: manage-issue-plan
description: Solution planning for a specific issue with codebase-aware step generation
argument-hint: "<ISS-ID> [--tool gemini|qwen] [--from-analysis]"
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
Solution planning for a specific issue. Generates a structured, codebase-aware solution with ordered steps, context, and a prompt template for execution. Attaches the solution record to the issue in `.workflow/issues/issues.jsonl`.

- **--tool**: CLI tool for planning (default: gemini)
- **--from-analysis**: Auto-detected; includes analysis context (root_cause, related_files) in the planning prompt if issue.analysis exists

For issue CRUD, use `/manage-issue`. For execution, use `/manage-issue-execute`.
</purpose>

<required_reading>
@~/.maestro/workflows/issue-plan.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) -- read when building the solution record structure
</deferred_reading>

<context>
$ARGUMENTS -- ISS-ID (required) + optional flags.

**Options:**
- `<ISS-ID>` -- issue ID in ISS-XXXXXXXX-NNN format (required)
- `--tool gemini|qwen` -- CLI tool for planning (default: gemini)
- `--from-analysis` -- explicitly include analysis context (auto-detected if issue.analysis exists)

**State files:**
- `.workflow/issues/issues.jsonl` -- issue records (read + write)
</context>

<execution>
Follow '~/.maestro/workflows/issue-plan.md' completely.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_ISSUE_ID | error | No ISS-ID provided in $ARGUMENTS | Display usage hint with example |
| E_ISSUE_NOT_FOUND | error | ISS-ID not found in issues.jsonl | Suggest `/manage-issue list` to find valid IDs |
| E_NO_ANALYSIS | warning | No analysis record on issue and --from-analysis specified | Proceed without analysis context, suggest `/manage-issue-analyze` first |
| E_PLANNING_FAILED | error | CLI planning returned no usable results | Retry with different --tool or report partial output |
</error_codes>

<success_criteria>
- [ ] Issue loaded and validated from issues.jsonl
- [ ] Analysis context included in prompt (if available)
- [ ] CLI planning executed and solution JSON parsed
- [ ] Solution record attached to issue in issues.jsonl
- [ ] Solution steps displayed with next-step routing to manage-issue-execute
</success_criteria>
