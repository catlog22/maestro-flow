---
name: maestro-milestone-complete
description: Archive completed milestone scratch artifacts to milestones/ dir, move artifact entries to milestone_history, extract learnings, advance state.
argument-hint: "[milestone] [--force]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Milestone Complete

## Usage

```bash
$maestro-milestone-complete "M1"
$maestro-milestone-complete              # uses current_milestone from state.json
$maestro-milestone-complete --force "M1"  # skip audit check
```

**Output**: `.workflow/milestones/{milestone}/` archive directory

---

## Overview

Sequential milestone archival: validate audit → archive scratch dirs → extract learnings → move artifact entries to milestone_history → advance state → clean scratch.

---

## Implementation

### Step 1: Parse & Validate

1. Read `.workflow/state.json` to get `current_milestone`, `artifacts[]`, `milestones[]`
2. Determine target milestone (from args or current_milestone)
3. Check `--force` flag
4. If no milestone: **E001**
5. Check audit report exists at `.workflow/milestones/{milestone}/audit-report.md`
   - Missing + not --force: **E002**
   - Verdict FAIL + not --force: **E002**
6. Check all milestone artifacts completed:
   - `state.json.artifacts.filter(a => a.milestone == target && a.status != "completed")`
   - If any incomplete + not --force: **E003**

### Step 2: Archive Scratch Dirs

```bash
mkdir -p .workflow/milestones/{milestone}/artifacts/

# For each artifact path, copy to archive
for artifact in milestone_artifacts:
  if dir exists .workflow/{artifact.path}:
    cp -r .workflow/{artifact.path} .workflow/milestones/{milestone}/artifacts/$(basename {artifact.path})/
```

Snapshot roadmap:
```bash
cp .workflow/roadmap.md .workflow/milestones/{milestone}/roadmap-snapshot.md
```

### Step 3: Extract Learnings

- Read `.summaries/` from each execute artifact's plan dir
- Read `reflection-log.md` if exists
- Extract patterns, pitfalls, strategy adjustments
- Append to `.workflow/specs/learnings.md`
- Avoid duplicates (check existing entries)

### Step 4: Archive Artifact Entries

Move artifact entries from `state.json.artifacts[]` to `milestone_history`:

```json
{
  "milestone_history": [
    ...existing,
    {
      "id": "{milestone}",
      "name": "{milestone_name}",
      "status": "completed",
      "completed_at": "{now}",
      "archive_path": "milestones/{milestone}/",
      "archived_artifacts": [ ...all milestone artifact entries... ]
    }
  ]
}
```

Remove from `artifacts[]`:
```
state.json.artifacts = state.json.artifacts.filter(a => a.milestone != target)
```

### Step 5: Advance State

```
next = state.json.milestones.find(m => m.status == "pending")
if next:
  state.json.current_milestone = next.id
  next.status = "active"
else:
  state.json.current_milestone = null
  state.json.status = "completed"

state.json.last_updated = now()
Write state.json (atomic)
```

### Step 6: Clean Scratch

```bash
for artifact in archived_artifacts:
  rm -rf .workflow/{artifact.path}
```

### Step 7: Generate Summary & Report

Write `.workflow/milestones/{milestone}/summary.md` with outcomes and learnings.
Update `.workflow/project.md` Context section.

```
=== MILESTONE COMPLETE ===
Milestone: {milestone} ({name})
Artifacts: {count} archived
Next:      {next_milestone or "Project complete"}

Next steps:
  $maestro-milestone-release  -- Cut release
  $maestro-analyze            -- Start next milestone
  $manage-status              -- View state
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Milestone identifier required | Specify milestone |
| E002 | error | Audit not passed | Run milestone-audit first |
| E003 | error | Incomplete artifacts remain | Complete work first |

---

## Core Rules

1. **Audit before archive** — refuse without passing audit (unless --force)
2. **Atomic state update** — write state.json via tmp+rename
3. **Learnings are mandatory** — always extract before archiving
4. **Clean after archive** — remove scratch dirs only after successful copy
5. **Advance state** — always set next milestone or mark project complete
