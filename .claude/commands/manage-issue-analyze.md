---
name: manage-issue-analyze
description: Root cause analysis for a specific issue using CLI exploration
argument-hint: "<ISS-ID> [--tool gemini|qwen] [--depth standard|deep]"
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
Root cause analysis for a specific issue. Uses CLI exploration to analyze codebase context, identify root cause, assess impact, and produce a structured analysis record attached to the issue in `.workflow/issues/issues.jsonl`.

- **--tool**: CLI tool for analysis (default: gemini)
- **--depth**: `standard` (keyword grep) or `deep` (semantic search via Agent)

For issue CRUD, use `/manage-issue`. For solution planning, use `/manage-issue-plan`.
</purpose>

<required_reading>
@~/.maestro/workflows/issue-analyze.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) -- read when building the analysis record structure
</deferred_reading>

<context>
$ARGUMENTS -- ISS-ID (required) + optional flags.

**Options:**
- `<ISS-ID>` -- issue ID in ISS-XXXXXXXX-NNN format (required)
- `--tool gemini|qwen` -- CLI tool for analysis (default: gemini)
- `--depth standard|deep` -- analysis depth (default: standard)

**State files:**
- `.workflow/issues/issues.jsonl` -- issue records (read + write)
</context>

<execution>
Follow '~/.maestro/workflows/issue-analyze.md' completely.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_ISSUE_ID | error | No ISS-ID provided in $ARGUMENTS | Display usage hint with example |
| E_ISSUE_NOT_FOUND | error | ISS-ID not found in issues.jsonl | Suggest `/manage-issue list` to find valid IDs |
| E_INVALID_STATUS | warning | Issue status is not 'open' or 'registered' | Warn but allow analysis to proceed |
| E_ANALYSIS_FAILED | error | CLI analysis returned no usable results | Retry with different --tool or report partial context |
</error_codes>

<success_criteria>
- [ ] Issue loaded and validated from issues.jsonl
- [ ] Codebase context gathered (grep or semantic search)
- [ ] CLI analysis executed and JSON result parsed
- [ ] Analysis record attached to issue in issues.jsonl
- [ ] Summary displayed with next-step routing to manage-issue-plan
</success_criteria>
