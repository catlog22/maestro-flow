---
name: quality-sync
description: Sync codebase docs by tracing git diff impact
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
Sync codebase docs after code changes: git diff → trace impact via doc-index.json → refresh `.workflow/codebase/` docs.
</purpose>

<required_reading>
@~/.maestro/workflows/sync.md
</required_reading>

<context>
$ARGUMENTS -- optional flags:
- `--full` -- Complete resync of all tracked files (ignores git diff, rebuilds all docs)
- `--since <commit|HEAD~N>` -- Diff since specific commit (default: last sync timestamp)
- `--dry-run` -- Show what would be updated without writing changes

**Output boundary**: ALL file writes MUST target `.workflow/codebase/`, `.workflow/state.json`, or `doc-index.json` only. NEVER modify source code or files outside `.workflow/`. `--dry-run` MUST suppress all writes.
</context>

<invariants>
1. **Source code is read-only** — sync reads source files to generate documentation. NEVER modify source code, test files, or any non-documentation files.
2. **Dry-run is side-effect-free** — when `--dry-run` is set, NO file writes occur. Report only what would change.
3. **Impact trace before refresh** — NEVER regenerate a doc file without first tracing which source changes affect it via doc-index.json. Untargeted full-refresh requires explicit `--full` flag.
4. **Idempotent sync** — running sync twice with the same diff MUST produce identical results. State.json timestamp prevents redundant re-runs.
5. **Incremental by default** — without `--full`, only changed components are refreshed. NEVER silently expand to a full rebuild.
</invariants>

<execution>
Follow '~/.maestro/workflows/sync.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Diff → Impact Trace**
- REQUIRED: Git diff computed (or --full flag set for all files).
- BLOCKED if no diff and no --full: nothing to sync (W001).

**GATE 2: Impact Trace → Refresh**
- REQUIRED: Affected components traced via doc-index.json.
- BLOCKED if trace fails: cannot refresh docs without impact mapping.

**GATE 3: Refresh → Completion**
- REQUIRED: `.workflow/codebase/` docs refreshed for affected components.
- REQUIRED: If `--dry-run` is set, skip state.json write and report what would change. Otherwise, update state.json with sync timestamp.
- BLOCKED if missing: do not report completion without updated docs.
</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS
CONCERNS: {description if applicable}
--- END STATUS ---
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Docs refreshed | `/manage-status` |
| Major structural changes | `/manage-codebase-rebuild` |
| Incremental refresh | Use `--since` flag |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Suggest running `/maestro-init` first|
| W001 | warning | No changes detected since last sync | Report clean state, skip updates |
</error_codes>

<success_criteria>
- [ ] state.json updated with current sync timestamp (skipped if `--dry-run`)
- [ ] Codebase docs refreshed for all affected components
- [ ] doc-index.json reflects current file state
- [ ] Changes tracked and logged
- [ ] project.md Tech Stack section refreshed if dependency manifests changed
</success_criteria>
