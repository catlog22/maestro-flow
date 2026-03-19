---
name: maestro-phase-add
description: Add or insert a new phase into the project roadmap with automatic renumbering
argument-hint: "\"phase name\" [--after N] [--before N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# Maestro Phase Add (Single Agent)

## Usage

```bash
$maestro-phase-add "authentication"
$maestro-phase-add "caching-layer" --after 2
$maestro-phase-add "security-hardening" --before 5
```

**Flags**:
- `"phase name"`: Required. Used as both slug and title (slug = lowercase, hyphens)
- `--after N`: Insert after phase N (renumbers subsequent phases)
- `--before N`: Insert before phase N (renumbers from N onward)
- If neither: append at end

**Output**: New phase directory, updated roadmap.md, updated state.json

---

## Overview

Single mutation operation on the project roadmap. Creates a new phase directory with initialized index.json, inserts the phase entry into roadmap.md at the correct position, and handles automatic renumbering of all affected phase directories and references.

---

## Implementation

### Step 1: Parse Arguments

Extract:
- Phase name/slug (required — E001 if missing)
- `--after N` or `--before N` flag (mutually exclusive)
- Generate slug: lowercase, replace spaces with hyphens, strip special chars

### Step 2: Load Roadmap State

```bash
cat .workflow/roadmap.md
cat .workflow/state.json
ls -d .workflow/phases/*/
```

- Parse existing phases from roadmap.md
- List existing phase directories
- Check for duplicate slug (E003 if exists)
- Verify roadmap.md exists (E002 if not)

### Step 3: Calculate Position

- If `--after N`: new phase number = N + 1
- If `--before N`: new phase number = N
- If neither: new phase number = max_existing + 1

### Step 4: Renumber Existing Phases (if inserting)

**Only when `--after N` or `--before N` is used.**

For each phase with number >= new phase number (process in reverse order to avoid collisions):

1. Rename directory: `.workflow/phases/{NN}-{slug}` → `.workflow/phases/{NN+1}-{slug}`
2. Update index.json inside renamed directory: `"phase": N+1`

```bash
# Rename in reverse order to prevent collisions
for dir in $(ls -rd .workflow/phases/*/); do
  # Extract number, if >= insertion point, rename to number+1
done
```

### Step 5: Create Phase Directory

```bash
mkdir -p .workflow/phases/{NN}-{slug}
```

Format NN as zero-padded 2-digit number (e.g., 03).

### Step 6: Initialize Phase index.json

Read template from `~/.maestro/templates/index.json` if available, otherwise create:

```json
{
  "phase": <N>,
  "slug": "<slug>",
  "title": "<phase name>",
  "status": "pending",
  "created_at": "<ISO timestamp>",
  "tasks": []
}
```

Write to `.workflow/phases/{NN}-{slug}/index.json`.

### Step 7: Update roadmap.md

Insert new phase entry at the correct position in roadmap.md:
- Match the existing phase entry format
- If inserting, update all subsequent phase numbers in the document

### Step 8: Update state.json

If renumbering affected `current_phase` or `phases_completed`:
- Adjust `current_phase` number if it was shifted
- Adjust all entries in `phases_completed` that were shifted

### Step 9: Completion Report

```
=== PHASE ADDED ===
Phase: {NN} - {phase name}
Location: .workflow/phases/{NN}-{slug}/

{if renumbered}
Renumbered: Phases {start}-{end} shifted by +1
{endif}

Updated:
  .workflow/roadmap.md
  .workflow/phases/{NN}-{slug}/index.json
  {if renumbered}.workflow/state.json{endif}

Next steps:
  $maestro-plan ""         -- Plan tasks for the new phase
  $maestro-status          -- View updated roadmap
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Phase name/slug required | Provide phase name as argument |
| E002 | error | roadmap.md not found | Run maestro-init first |
| E003 | error | Duplicate phase name/slug exists | Choose a different name |

---

## Core Rules

1. **Reverse-order renumbering** — always rename directories from highest to lowest to prevent collisions
2. **State consistency** — state.json phase references must be adjusted after renumbering
3. **Match existing format** — new roadmap.md entries must match the style of existing entries
4. **Zero-padded numbers** — always use 2-digit format (01, 02, ... 99)
5. **Slug normalization** — lowercase, hyphens only, no special characters
