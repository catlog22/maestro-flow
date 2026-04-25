---
name: manage-memory-capture
description: Capture session memory (compact mode) into .workflow/memory/ with JSON index
argument-hint: "[compact] [description]"
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
Capture session working memory into `.workflow/memory/` for cross-session recovery. Compact mode only: full session compression for recovery. Entries are created via `maestro wiki create --type memory` and automatically indexed in `.workflow/wiki-index.json`. Invoked when saving session state before context loss.

**Note:** Quick tips/notes have been moved to `manage-learn tip <text>`. Use that command for atomic knowledge capture.
</purpose>

<required_reading>
@~/.maestro/workflows/memory.md
</required_reading>

<context>
Arguments: $ARGUMENTS

**Mode:**
- `compact` — Full session memory compression (files, decisions, plan state, pending work)
- No arguments — Defaults to compact mode

**Storage:**
- `.workflow/memory/` — Memory entries directory (via `maestro wiki create --type memory`)
- `.workflow/wiki-index.json` — Unified wiki index (auto-updated on create)
</context>

<execution>
Follow '~/.maestro/workflows/memory.md' Part B (Memory Capture) completely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `/maestro-init` first | parse_input |
| E002 | error | Tip mode removed — use `/manage-learn tip <text>` instead | parse_input |
| W001 | warning | No active workflow session found — compact will capture conversation only | analyze_session |
| W002 | warning | Plan detection found no explicit plan — using inferred plan | analyze_session |
</error_codes>

<success_criteria>
- [ ] Compact mode executed
- [ ] Entry markdown file written to `.workflow/memory/`
- [ ] `wiki-index.json` auto-updated via wiki create
- [ ] All session fields populated (objective, files, decisions, plan)
- [ ] Execution plan preserved VERBATIM (not summarized)
- [ ] All file paths are ABSOLUTE
- [ ] Confirmation banner displayed with entry ID
- [ ] Next step: `/manage-status` to resume workflow, or `/manage-memory view <entry_id>` to verify captured memory
- [ ] For tips: redirect user to `/manage-learn tip <text>`
</success_criteria>
