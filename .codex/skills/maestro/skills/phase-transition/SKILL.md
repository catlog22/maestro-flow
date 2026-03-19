---
name: maestro-phase-transition
description: Mark current or specified phase as complete, extract learnings, advance to next phase
argument-hint: "[phase-number] [--force]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Maestro Phase Transition (Single Agent)

## Usage

```bash
$maestro-phase-transition ""
$maestro-phase-transition "2"
$maestro-phase-transition "3 --force"
```

**Flags**:
- `[phase-number]`: Phase to transition from (defaults to current_phase from state.json)
- `--force`: Skip gap checks and force transition even with warnings

**Output**: Updated state.json, completed phase index.json, initialized next phase, learnings extracted

---

## Overview

State-machine transition skill. Validates that the current phase meets completion criteria (tasks done, verification passed, no unresolved gaps), marks it complete, extracts learnings, and advances to the next phase. Creates next phase directory if needed.

---

## Implementation

### Step 1: Parse Arguments

Extract:
- Phase number (optional, integer)
- `--force` flag

### Step 2: Load State

```bash
cat .workflow/state.json
```

Determine phase number:
- If provided: use specified phase
- If omitted: use `current_phase` from state.json
- If neither: error E001

### Step 3: Resolve Phase Directory

```bash
ls -d .workflow/phases/*/ | grep "^.workflow/phases/0*{N}-"
```

Read phase files:
- `.workflow/phases/{NN}-{slug}/index.json` — phase metadata, task statuses
- `.workflow/phases/{NN}-{slug}/verification.json` — verification results (if exists)
- `.workflow/phases/{NN}-{slug}/review.json` — code review results (if exists)

### Step 4: Validate Completion

Check the following (skip all if `--force`):

1. **Task completion**: All tasks in index.json have status "completed" or "skipped"
2. **Verification passed**: verification.json exists and verdict is not "FAIL" (E002 if failed)
3. **No critical gaps**: No unresolved critical gaps in verification results (E003)
4. **Review status**: Check review.json if exists
   - BLOCK verdict → W003 (warning, suggest quality-review fix)
   - No review.json → W004 (warning, suggest running quality-review)
5. **UAT status**: Check for test failures → W002

If warnings only (no errors) and not `--force`: display warnings and ask user to confirm.

### Step 5: Mark Phase Complete

Update `.workflow/phases/{NN}-{slug}/index.json`:
```json
{
  "status": "complete",
  "completed_at": "<ISO timestamp>"
}
```

### Step 6: Extract Learnings

Analyze phase artifacts for learnings:
1. Read verification.json gaps and resolutions
2. Read review.json feedback patterns
3. Read task summaries for recurring themes
4. Identify patterns: what worked, what didn't, what to carry forward

Append to `.workflow/specs/learnings.md`:
```markdown
## Phase {N}: {slug}
**Completed**: {date}

### What Worked
- {items}

### Challenges
- {items}

### Carry Forward
- {items}
```

### Step 7: Initialize Next Phase

Determine next phase number = N + 1.

Check if next phase directory exists:
- If exists: verify index.json has status "pending", update to "active"
- If not exists: create directory and initialize

```bash
mkdir -p .workflow/phases/{NN+1}-{next_slug}
```

Write `index.json` for next phase (read template from `~/.maestro/templates/index.json` if available):
```json
{
  "phase": <N+1>,
  "status": "active",
  "created_at": "<ISO timestamp>"
}
```

### Step 8: Update Project State

Update `.workflow/state.json`:
- `current_phase`: N + 1
- `phases_completed`: append phase N

### Step 9: Completion Report

```
=== PHASE TRANSITION ===
From: Phase {N} ({slug}) → COMPLETE
To:   Phase {N+1} ({next_slug}) → ACTIVE

Learnings extracted: .workflow/specs/learnings.md
State updated:       .workflow/state.json

Next steps:
  $maestro-plan ""    -- Plan tasks for Phase {N+1}
  $maestro-status     -- View project dashboard
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Phase number required and could not determine | Specify phase number explicitly |
| E002 | error | Phase has not passed verification | Run maestro-verify first |
| E003 | error | Phase has unresolved critical gaps | Fix gaps, re-verify |
| W001 | warning | Phase has warnings but no blockers | Proceed with confirmation |
| W002 | warning | UAT test failures exist | Review recommended |
| W003 | warning | Code review verdict is BLOCK | Fix review findings first |
| W004 | warning | Code review not yet run | Run quality-review first |

---

## Core Rules

1. **Verify before transition** — refuse to transition without verification (unless --force)
2. **Learnings are mandatory** — always extract and persist learnings, even if minimal
3. **Next phase must be ready** — create directory and index.json before reporting success
4. **State consistency** — state.json and index.json must agree at all times
5. **Warnings need acknowledgment** — display warnings and require user confirmation (unless --force)
