---
name: manage-issue-discover
description: Automated issue discovery -- multi-perspective analysis or prompt-driven exploration
argument-hint: "[multi-perspective | by-prompt \"what to look for\"] [-y|--yes] [--scope=src/**] [--depth=standard|deep]"
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
Automated issue discovery via multi-perspective codebase analysis (8 perspectives) or prompt-driven exploration. Discovers issues, deduplicates findings, and records them in `.workflow/issues/issues.jsonl`.

- **Default (no args)**: Interactive mode selection — choose multi-perspective or prompt-driven.
- **`multi-perspective`**: 8-perspective parallel agent scan — security, performance, reliability, maintainability, scalability, UX, accessibility, compliance.
- **`by-prompt "..."`**: Prompt-driven — Gemini plans exploration strategy, agents explore iteratively with cross-dimension analysis.

For CRUD operations (create, list, update, close, link), use `/manage-issue`.

After discovery, use `/maestro-analyze --gaps <ISS-ID>` to perform root cause analysis on individual findings.
</purpose>

<required_reading>
@~/.maestro/workflows/issue-discover.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) — read when creating issue records from findings (Step 6/11)
- [search-tools](~/.maestro/templates/search-tools.md) — search tool priority, passed to agents via workflow
</deferred_reading>

<context>
$ARGUMENTS -- optional. Parse first token to determine mode.

**Modes:**
- _(empty)_ -- interactive mode selection (AskUserQuestion)
- `multi-perspective` -- 8-perspective parallel agent scan
- `by-prompt "..."` -- prompt-driven iterative agent exploration (Gemini-planned)

**Flags:**
- `-y` / `--yes` -- auto mode, skip confirmations
- `--scope=<pattern>` -- file scope (default: `**/*`)
- `--depth=standard|deep` -- exploration depth (by-prompt only, default: `standard`)

**State files:**
- `.workflow/issues/issues.jsonl` -- issues appended here
- `.workflow/issues/discoveries/{SESSION_ID}/` -- session artifacts
</context>

<execution>
Determine mode from $ARGUMENTS:
- No arguments or empty → interactive selection via AskUserQuestion
- First token is `multi-perspective` → multi-perspective mode
- First token is `by-prompt` → prompt-driven mode, remaining tokens are the user prompt

Follow '~/.maestro/workflows/issue-discover.md' completely.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_PROJECT | error | `.workflow/` does not exist | Prompt user to run `/maestro-init` first |
| E_DISCOVERY_FAILED | error | CLI analysis returned no results | Retry with different tool or report partial findings |
| E_EMPTY_PROMPT | warning | `by-prompt` used without prompt text | Interactive prompt with suggested options |
</error_codes>

<success_criteria>
- [ ] Discovery mode correctly determined from arguments
- [ ] All perspectives analyzed (multi-perspective) or dimensions explored (by-prompt)
- [ ] Findings deduplicated before issue creation
- [ ] Issues appended to issues.jsonl with correct schema
- [ ] Discovery session fully traceable via session directory
- [ ] Next step routing: `/maestro-analyze --gaps <ISS-ID>` for root cause analysis, or `/manage-issue list` to review all issues
</success_criteria>
