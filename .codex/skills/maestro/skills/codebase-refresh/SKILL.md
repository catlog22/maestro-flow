---
name: maestro-codebase-refresh
description: Incremental refresh of codebase docs based on recent git changes
argument-hint: "[--since <date>] [--deep]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Codebase Refresh

## Usage

```bash
$maestro-codebase-refresh
$maestro-codebase-refresh "--since 2026-03-15"
$maestro-codebase-refresh "--deep"
$maestro-codebase-refresh "--since 3d --deep"
```

**Flags**:
- `--since <date>` -- Override change detection window (ISO date or relative like `3d`)
- `--deep` -- Force deeper re-scan even for minor changes

---

## Implementation

### Step 1: Validate Preconditions

```bash
test -d .workflow || exit 1        # E001: not initialized
test -d .workflow/codebase || exit 1  # E002: no docs, use codebase-rebuild
```

### Step 2: Detect Changes

Determine baseline timestamp:
1. If `--since` provided, use that date
2. Else read `state.json` field `codebase_last_refreshed` or `codebase_last_rebuilt`
3. Fallback to last 7 days

```bash
git diff --name-only --since="{baseline}" HEAD
```

If no changes detected, report clean state (W001) and exit.

### Step 3: Map Changes to Docs

Read `.workflow/codebase/doc-index.json` to find which documentation entries cover the changed files.
Build a list of affected doc entries that need refresh.

### Step 4: Refresh Affected Docs

For each affected documentation entry:
1. Re-read the source files that changed
2. Update the corresponding doc section in `.workflow/codebase/`
3. Update the entry's timestamp in `doc-index.json`

If `--deep` flag is set, also re-scan adjacent files for context changes.

### Step 5: Update State

Update `doc-index.json` timestamps for all refreshed entries.
Update `state.json` with `codebase_last_refreshed: "{ISO timestamp}"`.

Display summary:
```
=== CODEBASE REFRESH ===
Changes detected: {N} files
Docs refreshed: {M} entries
Skipped (unchanged): {K} entries
```

---

## Error Handling

| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized |
| E002 | fatal | No codebase docs exist -- use `Skill({ skill: "codebase-rebuild" })` instead |
| W001 | warning | No changes detected since last refresh |
