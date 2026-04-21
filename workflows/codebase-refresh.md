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
Parse $ARGUMENTS for --since and --deep flags.

Verify .workflow/ directory exists and is initialized (project.md, state.json present).
  If not initialized: abort with E001.

Verify .workflow/codebase/doc-index.json exists.
  If not: abort with E002 (suggest using codebase-rebuild instead).
```

### Step 2: Detect Changes

```
Determine the change detection window:
  If --since provided: use that date/ref
  Otherwise: use codebase_last_rebuilt or codebase_last_refreshed from state.json

Run git diff --name-only since the determined date to get list of changed files.

If no changes detected: emit W001 and exit gracefully ("No changes detected since last refresh").
```

### Step 3: Identify Affected Documentation

```
Read .workflow/codebase/doc-index.json to map changed files to documentation entries.

For each changed file, identify which doc-index entries reference it:
  - Which tech-registry components are affected (via code_locations matching)
  - Which feature-map entries need updating (via component -> feature chain)
  - Which requirements or ADRs reference changed code

Build a list of affected documentation sections:
  affected_components = [component entries whose code_locations include changed files]
  affected_features = [features whose component_ids include affected components]
```

### Step 3.5: Load Project Specs

```
specs_content = maestro spec load --category arch
```

Used in Step 4-5 to validate refreshed docs against architectural expectations.

---

### Step 4: Re-scan Affected Components

```
For each component in affected_components:
  For each file_path in component.code_locations:
    a. Check if file still exists
       If not: mark for removal from code_locations, log warning

    b. Read file content
       Extract exported symbols:
         - export class {Name}
         - export function {name}
         - export interface {Name}
         - export type {Name}
         - export const {NAME}
         - export default {name/class}
         - module.exports patterns (for CJS)

    c. Update component entry:
       - symbols = [newly extracted symbols]
       - last_updated = current ISO timestamp

  If --deep is set, also re-scan files that import/require the changed files
  (follow reverse dependency chain to find additional affected components).

  Check for new files that should belong to this component:
    - Scan same directory as existing code_locations
    - If new files match the component's naming pattern:
      Log: "Potential new file for {component.id}: {file}"
      (Do not auto-add; report for manual review)
```

### Step 5: Check Relationship Changes

```
For each refreshed component:
  Read import statements from code_locations files
  Identify imported modules that map to other components

  Compare with current feature_ids:
    If a component imports from a different feature's components:
      Log: "Cross-feature dependency detected: {component.id} -> {other_component.id}"

For each refreshed feature:
  Verify all component_ids still exist in components[]
  Remove any stale component_ids
  Check if new components should be added (by directory proximity)
```

### Step 6: Update Doc Index

```
Write updated entries back to doc-index.json:
  - Updated component entries (symbols, code_locations, last_updated)
  - Updated feature entries (component_ids, last_updated)
  - Update top-level last_updated timestamp
  - Update global last_refreshed timestamp

Write: .workflow/codebase/doc-index.json
```

### Step 7: Regenerate Affected Docs

```
For each refreshed component:
  Compute slug from component.name
  Regenerate: .workflow/codebase/tech-registry/{slug}.md

    # {component.name}

    | Field | Value |
    |-------|-------|
    | **ID** | {id} |
    | **Type** | {type} |
    | **Features** | {feature_ids joined} |

    ## Code Locations
    {bullet list of code_locations}

    ## Exported Symbols
    {bullet list of symbols}

    ---
    *Refreshed at {timestamp}*

For each refreshed feature:
  Compute slug from feature.name
  Regenerate: .workflow/codebase/feature-maps/{slug}.md

    # {feature.name}

    | Field | Value |
    |-------|-------|
    | **ID** | {id} |
    | **Status** | {status} |
    | **Phase** | {phase or "unassigned"} |

    ## Components
    | ID | Name | Type |
    |----|------|------|
    {table row per component}

    ## Requirements
    {bullet list of requirement_ids with titles}

    ---
    *Refreshed at {timestamp}*

Update _index.md files if any entries changed:
  Regenerate tech-registry/_index.md
  Regenerate feature-maps/_index.md
```

### Step 8: Update Timestamps

```
Update .workflow/state.json:
  - Set codebase_last_refreshed timestamp
  - Update last_updated timestamp
```

### Step 9: Report

```
Display summary:
  Refresh complete:
    Changed files detected: {count}
    Components refreshed: {count} ({IDs})
    Features refreshed: {count} ({IDs})
    Symbols updated: {count new} added, {count removed} removed
    Files updated in .workflow/codebase/: {list}
    Warnings: {any warnings from Steps 4-5}
    If W001: "No changes detected since last refresh"

  Suggest next: Skill({ skill: "manage-status" }) to review
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
