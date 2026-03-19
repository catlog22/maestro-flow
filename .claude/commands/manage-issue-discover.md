---
name: manage-issue-discover
description: Automated issue discovery -- multi-perspective analysis or prompt-driven exploration
argument-hint: "[by-prompt \"what to look for\"]"
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

- **Default (no args)**: Multi-perspective scan — security, performance, reliability, maintainability, scalability, UX, accessibility, compliance.
- **`by-prompt "..."`**: Prompt-driven — user describes what to look for, system decomposes into exploration dimensions with iterative deepening.

For CRUD operations (create, list, update, close, link), use `/manage-issue`.

After discovery, use `/manage-issue-analyze <ISS-ID>` to perform root cause analysis on individual findings.
</purpose>

<required_reading>
@~/.maestro/workflows/issue-discover.md
</required_reading>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) — read when creating issue records from findings (Step 6/11)
</deferred_reading>

<context>
$ARGUMENTS -- optional. Parse first token to determine mode.

**Modes:**
- _(empty)_ -- multi-perspective discovery (8 analysis perspectives)
- `by-prompt "..."` -- prompt-driven discovery (user describes what to look for)

**State files:**
- `.workflow/issues/issues.jsonl` -- issues appended here
- `.workflow/issues/discoveries/{SESSION_ID}/` -- session artifacts
</context>

<execution>
Determine mode from $ARGUMENTS:
- No arguments or empty → multi-perspective mode
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
</success_criteria>
