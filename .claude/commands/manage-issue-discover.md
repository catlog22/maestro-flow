---
name: manage-issue-discover
description: Discover issues via multi-perspective analysis
argument-hint: "[multi-perspective | by-prompt <prompt>] [-y] [--scope <glob>] [--depth standard|deep]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Automated issue discovery: multi-perspective (8 perspectives) or prompt-driven. Deduplicates and records to `issues.jsonl`. For CRUD operations, use `/manage-issue`.
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
- `by-prompt "..."` -- prompt-driven iterative agent exploration (CLI-planned)

**Flags:**
- `-y` / `--yes` -- auto mode, skip confirmations
- `--scope=<pattern>` -- file scope (default: `**/*`)
- `--depth=standard|deep` -- exploration depth (by-prompt only, default: `standard`)

**State files:**
- `.workflow/issues/issues.jsonl` -- issues appended here (set `source: "discover"` on each row so concurrent writers like `manage-harvest` with `source: "harvest"` can be distinguished and deduplicated)
- `.workflow/issues/discoveries/{SESSION_ID}/` -- session artifacts

### Pre-load specs
1. **Debug specs**: Run `maestro load --type spec --category debug` to load known antipatterns, root causes, and gotchas. Informs discovery perspectives with prior findings.
2. Optional — proceed without if unavailable.

**Output boundary**: ALL file writes MUST target `.workflow/issues/issues.jsonl` or `.workflow/issues/discoveries/{SESSION_ID}/` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — discovery agents MUST NOT modify source code; only `.workflow/issues/` is writable
2. **Source tagging** — MUST set `source: "discover"` on every issues.jsonl row so concurrent writers (e.g. `manage-harvest`) can be distinguished and deduplicated
3. **Dedup before write** — MUST check existing issues.jsonl for duplicates before appending new findings
4. **Session traceability** — every discovery run MUST produce a session directory under `.workflow/issues/discoveries/` with full agent outputs
5. **Schema compliance** — every issue row MUST conform to the canonical issue.json template schema
6. **Idempotent re-run** — repeated execution with same scope and prompt MUST NOT create duplicate issues
</invariants>

<execution>
Determine mode from $ARGUMENTS:
- No arguments or empty → interactive selection via AskUserQuestion
- First token is `multi-perspective` → multi-perspective mode
- First token is `by-prompt` → prompt-driven mode, remaining tokens are the user prompt

Follow '~/.maestro/workflows/issue-discover.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Mode Selection → Analysis** (Steps 1-2 → Steps 3-8)
- REQUIRED: Mode correctly determined from arguments (multi-perspective or by-prompt).
- REQUIRED: `.workflow/issues/` directory exists (auto-create if missing).
- BLOCKED if E_NO_PROJECT (`.workflow/` missing) or E_EMPTY_PROMPT (by-prompt without text).

**GATE 2: Analysis → Issue Creation** (Steps 8-9 → Steps 10-11)
- REQUIRED: All perspectives analyzed (multi-perspective) or dimensions explored (by-prompt).
- REQUIRED: Findings deduplicated against existing issues.jsonl.
- BLOCKED if E_DISCOVERY_FAILED (all agents returned no results).

**GATE 3: Issue Creation → Completion** (Steps 11-12)
- REQUIRED: Issues appended to issues.jsonl with correct schema and `source: "discover"`.
- REQUIRED: Discovery session directory created with full agent outputs.
- BLOCKED if schema validation fails on any issue record.
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
- [ ] Next step routed
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Issues discovered | `/manage-issue list` to review |
| Need root cause analysis | `/maestro-analyze --gaps <ISS-ID>` |
| Want to plan fixes | `/maestro-plan --gaps` |
</completion>
