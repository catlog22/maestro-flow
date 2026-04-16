---
name: quality-sync
description: Sync codebase docs after code changes - traces git diff through component/feature/requirement impact chain
argument-hint: "[--full] [--since <commit|HEAD~N>] [--dry-run]"
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
Synchronize project state after manual code changes or to refresh codebase documentation. Detects changes via git diff, traces impact through doc-index.json (file -> component -> feature -> requirement), updates state.json and index.json, and refreshes affected `.workflow/codebase/` documentation. Use --full flag for a complete resync of all tracked files regardless of git diff.
</purpose>

<required_reading>
@~/.maestro/workflows/sync.md
</required_reading>

<context>
$ARGUMENTS -- optional flags:
- `--full` -- Complete resync of all tracked files (ignores git diff, rebuilds all docs)
- `--since <commit|HEAD~N>` -- Diff since specific commit (default: last sync timestamp)
- `--dry-run` -- Show what would be updated without writing changes
</context>

<execution>
Follow '~/.maestro/workflows/sync.md' completely.

**Next-step routing on completion:**
- Docs refreshed → Skill({ skill: "manage-status" })
- Major structural changes detected → Skill({ skill: "manage-codebase-rebuild" }) (full rebuild recommended)
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Suggest running Skill({ skill: "maestro-init" }) first|
| W001 | warning | No changes detected since last sync | Report clean state, skip updates |
</error_codes>

<success_criteria>
- [ ] state.json updated with current sync timestamp
- [ ] Codebase docs refreshed for all affected components
- [ ] doc-index.json reflects current file state
- [ ] Changes tracked and logged
- [ ] project-tech.json refreshed if dependency manifests changed
</success_criteria>
