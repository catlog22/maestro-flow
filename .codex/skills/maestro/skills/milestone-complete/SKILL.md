---
name: maestro-milestone-complete
description: Archive completed milestone and prepare for next. Validates all phases complete, creates archive, extracts learnings, updates state.json.
argument-hint: "[milestone] [--force]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Milestone Complete

## Usage

```bash
$maestro-milestone-complete "v1.0"
$maestro-milestone-complete              # uses current_milestone from state.json
$maestro-milestone-complete --force "v1.0"  # skip audit check
```

**Flags**:
- `[milestone]`: Target milestone identifier (default: current_milestone from state.json)
- `--force`: Skip audit verification, complete without passing audit

**Output**: `.workflow/milestones/{milestone}/` archive directory

---

## Overview

Sequential milestone archival: validate audit + phases -> create archive -> extract learnings -> update state -> report.

---

## Implementation

### Step 1: Parse Input

1. Read `.workflow/state.json` to get `current_milestone`
2. If `$ARGUMENTS` contains a milestone identifier, use it; otherwise use `current_milestone`
3. Detect `--force` flag
4. If no milestone resolvable: **E001** -- exit

### Step 2: Validate Completion

**2a. Check audit report:**
```
Read .workflow/milestone-audit-{milestone}.md
```
- If missing and not `--force`: **E002** -- warn "No audit report found. Run milestone-audit first." Ask user to proceed or abort.
- If verdict is FAIL and not `--force`: **E002** -- exit with suggestion to fix failing items

**2b. Verify all phases completed:**
```
For each phase in milestone (from roadmap.md):
  Read .workflow/phases/{NN}-{slug}/index.json
  If status != "completed": E003 -- list incomplete phases, exit
```

### Step 3: Create Archive

1. Create archive directory:
   ```bash
   mkdir -p .workflow/milestones/{milestone}/phases/
   ```

2. Snapshot roadmap:
   ```bash
   cp .workflow/roadmap.md .workflow/milestones/{milestone}/roadmap-snapshot.md
   ```

3. Archive each phase directory:
   ```bash
   cp -r .workflow/phases/{NN}-{slug}/ .workflow/milestones/{milestone}/phases/{NN}-{slug}/
   ```

4. Copy audit report (if exists):
   ```bash
   cp .workflow/milestone-audit-{milestone}.md .workflow/milestones/{milestone}/audit-report.md
   ```

### Step 4: Extract Learnings

1. Load existing learnings from `.workflow/specs/learnings.md` to avoid duplicates
2. For each phase, read `reflection-log.md` if exists:
   - Extract strategy adjustments, patterns discovered, pitfalls encountered
3. Append aggregated learnings to `.workflow/specs/learnings.md`:
   ```markdown
   ## Milestone {milestone} Learnings ({date})

   ### Strategy Adjustments
   - {from reflection-log entries}

   ### Patterns Discovered
   - {from reflection-log entries}

   ### Pitfalls Encountered
   - {from reflection-log entries}
   ```

### Step 5: Update State

1. Update `.workflow/state.json`:
   - `current_milestone` -> next version (increment minor)
   - `current_phase` -> 1 (reset)
   - `status` -> "idle"
   - Reset `phases_summary` counters
   - Preserve `accumulated_context` (decisions + deferred items carry forward)
   - Set `last_updated` timestamp

2. Clean up completed phase directories:
   ```bash
   rm -rf .workflow/phases/{NN}-{slug}/  # for each archived phase
   ```
   Keep `.workflow/phases/` directory (empty, ready for new milestone).

### Step 6: Report and Route

Display completion summary:
```
====================================================
  MILESTONE COMPLETED: {milestone}
====================================================

Archived:
  - {N} phases archived to .workflow/milestones/{milestone}/
  - Roadmap snapshot saved
  - Audit report archived
  - {M} learnings extracted to specs/learnings.md

State reset:
  - Current milestone: {next_milestone}
  - Current phase: 1
  - Status: idle

====================================================
```

Suggest next steps:
- "Start planning next milestone?" -> Skill({ skill: "maestro-plan" })
- "Project is idle." -> Skill({ skill: "manage-status" })

---

## Error Handling

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required and not resolvable | Prompt user for milestone |
| E002 | error | Audit not passed (missing or FAIL verdict) | Run milestone-audit first, or use --force |
| E003 | error | Incomplete phases remain | Complete or verify remaining phases |

---

## Core Rules

- **Never delete** phase directories before archiving -- always copy first
- **Preserve** `accumulated_context` across milestone boundaries
- **Learnings dedup** -- check existing entries before appending
- **Git commit** if in a git repo: `chore: complete milestone {milestone}`
- **--force** bypasses audit check only, not phase completion check
