---
name: quality-sync
description: Sync codebase docs after code changes -- traces git diff through component/feature/requirement layers
argument-hint: "[--full] [--since <commit|HEAD~N>] [--dry-run]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Sync codebase documentation after code changes by tracing git diff through component, feature, and requirement layers. Updates `.workflow/codebase/` docs to reflect current source state.
</purpose>

<context>

```bash
$quality-sync
$quality-sync "--since HEAD~5"
$quality-sync "--full"
$quality-sync "--dry-run"
$quality-sync "--since abc123 --dry-run"
```

**Flags**:
- `--full` -- Complete resync of all tracked files (ignores git diff)
- `--since <commit|HEAD~N>` -- Diff since specific commit (default: last sync timestamp)
- `--dry-run` -- Show what would be updated without writing

</context>

<execution>

### Step 1: Validate

```bash
test -d .workflow || exit 1  # E001: not initialized
```

### Step 2: Detect Changes

If `--full`: skip diff, mark all tracked files as changed.

Otherwise:
1. Read last sync timestamp from `state.json` field `last_synced`
2. If `--since` provided, use that as baseline
3. Run `git diff --name-only {baseline} HEAD` to get changed files

If no changes and not `--full`, report clean state (W001) and exit.

### Step 3: Trace Impact Chain

For each changed file, trace through `doc-index.json` impact layers:
1. **File layer** -- Which doc entries reference this file directly
2. **Component layer** -- Which components contain this file
3. **Feature layer** -- Which features depend on affected components
4. **Requirement layer** -- Which requirements trace to affected features

Build the full set of affected documentation entries.

### Step 4: Update Documentation

If `--dry-run`: display affected entries and exit.

For each affected entry:
1. Re-read source files
2. Regenerate the documentation section in `.workflow/codebase/`
3. Update `doc-index.json` with new timestamp and content hash

### Step 5: Update State

Update `state.json`:
- `last_synced: "{ISO timestamp}"`
- `last_synced_commit: "{HEAD commit hash}"`

Update affected `index.json` files in phase directories if task files were modified.

Display summary:
```
=== SYNC COMPLETE ===
Files changed: {N}
Components affected: {C}
Features affected: {F}
Docs updated: {D}
```

</execution>

<error_codes>

| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | `.workflow/` not initialized -- run `Skill({ skill: "maestro-init" })` first |
| W001 | warning | No changes detected since last sync |

</error_codes>

<success_criteria>
- [ ] Changed files detected (or full resync triggered)
- [ ] Impact chain traced through all layers
- [ ] Documentation entries updated in `.workflow/codebase/`
- [ ] `state.json` updated with sync timestamp and commit hash
- [ ] Summary report displayed
</success_criteria>
