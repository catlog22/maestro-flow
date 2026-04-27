# Workflow: codebase-refresh

Incremental refresh of `.workflow/codebase/` documentation based on changes since the last rebuild or refresh.

Detects which files have changed (via git diff), identifies which codebase docs are affected, selectively re-scans only those areas, and updates timestamps. Much faster than a full rebuild for ongoing maintenance.

## Trigger

- Manual via `/workflow:codebase-refresh [--since <date>] [--deep]`

## Arguments

| Arg | Description | Required |
|-----|-------------|----------|
| `--since <date>` | Override change detection window (ISO date or relative like "3d") | No |
| `--deep` | Force deeper re-scan even for files with minor changes | No |

## Prerequisites

- `.workflow/` directory exists and is initialized
- `.workflow/codebase/` must contain existing docs (from prior rebuild)
- `.workflow/codebase/doc-index.json` must exist (run `/workflow:codebase rebuild` first)

---

## Workflow Steps

### Step 1: Parse Input and Validate

```
Parse --since and --deep flags from $ARGUMENTS.
Verify .workflow/ initialized (E001 if not) and doc-index.json exists (E002 if not).
```

### Step 2: Detect Changes

```
Change window: --since value, else codebase_last_rebuilt/codebase_last_refreshed from state.json.
Run git diff --name-only to get changed files.
If no changes: emit W001 and exit.
```

### Step 3: Identify Affected Documentation

```
Map changed files to doc-index.json entries via code_locations matching.
Build affected sets:
  affected_components = components whose code_locations include changed files
  affected_features = features whose component_ids include affected components
```

### Step 3.5: Load Project Specs

```
specs_content = maestro spec load --category arch
```

Used in Step 4-5 to validate refreshed docs against architectural expectations.

---

### Step 4: Re-scan Affected Components

```
For each affected component:
  - Verify code_locations still exist (remove missing, log warning)
  - Re-extract exported symbols (ESM export + CJS module.exports patterns)
  - Update symbols[] and last_updated timestamp

If --deep: follow reverse dependency chain to find additional affected components.

Report new files matching component naming patterns (do not auto-add).
```

### Step 5: Check Relationship Changes

```
For each refreshed component:
  Analyze imports to detect cross-feature dependencies (log if found).

For each refreshed feature:
  Remove stale component_ids, check for new components by directory proximity.
```

### Step 6: Update Doc Index

```
Write updated component/feature entries + timestamps to .workflow/codebase/doc-index.json.
```

### Step 7: Regenerate Affected Docs

```
For each refreshed component: regenerate tech-registry/{slug}.md
  (header table + Code Locations + Exported Symbols + refresh timestamp).

For each refreshed feature: regenerate feature-maps/{slug}.md
  (header table + Components table + Requirements + refresh timestamp).

If entries changed: regenerate tech-registry/_index.md and feature-maps/_index.md.
```

### Step 8: Update Timestamps

```
Update .workflow/state.json: set codebase_last_refreshed and last_updated timestamps.
```

### Step 9: Report

```
Display summary: changed files, components/features refreshed, symbols added/removed, warnings.
Suggest next: manage-status to review.
```

---

## Error Handling

| Code | Meaning |
|------|---------|
| E001 | .workflow/ not initialized |
| E002 | No codebase/ docs exist, use codebase-rebuild instead |
| W001 | No changes detected since last refresh |

| Error | Action |
|-------|--------|
| doc-index.json missing | Fail with E002: "Run /workflow:codebase rebuild first" |
| .workflow/ missing | Fail with E001 |
| Code location file missing | Remove from code_locations, log warning |
| No changes detected | Emit W001, exit gracefully |

## Output Files

| File | Action |
|------|--------|
| `.workflow/codebase/doc-index.json` | Updated (affected entries + timestamps) |
| `.workflow/codebase/tech-registry/{slug}.md` | Regenerated for refreshed components |
| `.workflow/codebase/feature-maps/{slug}.md` | Regenerated for refreshed features |
| `.workflow/codebase/tech-registry/_index.md` | Updated if entries changed |
| `.workflow/codebase/feature-maps/_index.md` | Updated if entries changed |
| `.workflow/state.json` | Updated with codebase_last_refreshed timestamp |
