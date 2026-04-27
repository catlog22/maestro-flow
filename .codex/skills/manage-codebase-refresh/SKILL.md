---
name: manage-codebase-refresh
description: Incremental refresh of codebase docs based on recent git changes
argument-hint: "[--since <date>] [--deep]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Incremental refresh of codebase documentation based on recent git changes. Detects changed files, maps them to existing doc entries, and updates only affected sections. Use `--deep` for broader context re-scanning.
</purpose>

<context>
$ARGUMENTS — optional flags.

```bash
$manage-codebase-refresh
$manage-codebase-refresh "--since 2026-03-15"
$manage-codebase-refresh "--deep"
$manage-codebase-refresh "--since 3d --deep"
```

**Flags**:
- `--since <date>` -- Override change detection window (ISO date or relative like `3d`)
- `--deep` -- Force deeper re-scan even for minor changes
</context>

<execution>

### Step 1: Validate Preconditions

Verify `.workflow/` exists (E001) and `.workflow/codebase/` exists (E002 -- use codebase-rebuild instead).

### Step 2: Detect Changes

Resolve baseline: `--since` flag > `state.json.codebase_last_refreshed` > `codebase_last_rebuilt` > 7-day fallback. Run `git diff --name-only --since="{baseline}" HEAD`. If no changes: W001, exit.

### Step 3: Map Changes to Docs

Read `.workflow/codebase/doc-index.json` to find doc entries covering changed files. Build affected entry list.

### Step 4: Refresh Affected Docs

For each affected entry: re-read changed source files, update corresponding doc in `.workflow/codebase/`, update timestamp in `doc-index.json`. With `--deep`: also re-scan adjacent files.

### Step 5: Update State

Update `doc-index.json` timestamps and `state.json.codebase_last_refreshed`. Display summary with change/refresh/skip counts.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized |
| E002 | fatal | No codebase docs exist -- use `Skill({ skill: "codebase-rebuild" })` instead |
| W001 | warning | No changes detected since last refresh |
</error_codes>

<success_criteria>
- [ ] Preconditions validated (.workflow/ and .workflow/codebase/ exist)
- [ ] Change detection baseline resolved (--since flag, state.json, or 7-day fallback)
- [ ] Git changes detected and mapped to doc entries via doc-index.json
- [ ] Affected docs refreshed with updated source content
- [ ] --deep flag triggers adjacent file re-scan
- [ ] doc-index.json timestamps and state.json codebase_last_refreshed updated
- [ ] Summary displayed with change/refresh/skip counts
</success_criteria>
