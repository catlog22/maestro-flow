---
name: manage-codebase-refresh
description: Incremental refresh of codebase docs based on recent changes
argument-hint: "[--since <date>] [--deep]"
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
Incrementally refresh .workflow/codebase/ documentation based on changes since the last rebuild or refresh. Detects which files have changed (via git diff), identifies which codebase docs are affected, selectively re-runs mapper agents on those areas only, and updates timestamps. Much faster than a full rebuild for ongoing maintenance.
</purpose>

<required_reading>
@~/.maestro/workflows/codebase-refresh.md
</required_reading>

<context>
$ARGUMENTS -- optional flags.

**Flags:**
- `--since <date>` -- Override change detection window (ISO date or relative like "3d")
- `--deep` -- Force deeper re-scan even for files with minor changes

**State files:**
- `.workflow/` -- must be initialized
- `.workflow/codebase/` -- must contain existing docs (from prior rebuild)
- `.workflow/codebase/doc-index.json` -- documentation index with timestamps
- `.workflow/state.json` -- contains `codebase_last_rebuilt` timestamp
</context>

<execution>
Follow '~/.maestro/workflows/codebase-refresh.md' completely.
</execution>

<error_codes>
| Code | Meaning                                                  |
|------|----------------------------------------------------------|
| E001 | .workflow/ not initialized                               |
| E002 | No codebase/ docs exist, use codebase-rebuild instead    |
| W001 | No changes detected since last refresh                   |
</error_codes>

<success_criteria>
- [ ] Changed files detected via git diff since last refresh
- [ ] Affected documentation entries identified from doc-index.json
- [ ] Only affected docs refreshed (selective mapper re-run)
- [ ] doc-index.json timestamps updated per affected entry
- [ ] state.json updated with codebase_last_refreshed timestamp
- [ ] Next step routing: Skill({ skill: "manage-status" }) or Skill({ skill: "spec-load" }) to use updated docs
</success_criteria>
