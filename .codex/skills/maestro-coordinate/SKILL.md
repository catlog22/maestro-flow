---
name: maestro-coordinate
description: CLI-based coordinator — classifies intent, reads project state, selects command chain, executes each step via maestro cli with auto-confirm, and chains Gemini analysis hints between steps. Session state at .workflow/.maestro-coordinate/{session_id}/.
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--chain <name>] [--tool <tool>]"
allowed-tools: Read, Write, Bash, Glob, Grep
---

## Auto Mode

When `-y` or `--yes`: Skip clarification prompts. Auto-inject confirmation signals into each step prompt.

# Maestro Coordinate

## Usage

```bash
$maestro-coordinate "implement user authentication with JWT"
$maestro-coordinate -y "refactor the payment module"
$maestro-coordinate -c "continue"
$maestro-coordinate --dry-run "add rate limiting to API endpoints"
$maestro-coordinate --chain quality-fix "fix failing tests"
```

**Flags**:
- `-y, --yes` — Auto mode: skip clarification and confirmation prompts
- `-c, --continue` — Resume previous session (latest if no session id given)
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force a specific command chain
- `--tool <tool>` — CLI tool override (default: claude)

**Session state**: `.workflow/.maestro-coordinate/{session_id}/state.json`

---

## Overview

Pipeline coordinator that executes maestro command chains via external `maestro cli` with structured context propagation between steps. Each step is executed with `maestro cli --tool <tool> --mode write` using the `coordinate-step` prompt template. After each step, a Gemini analysis run extracts quality hints that are injected into the next step's prompt via `{{ANALYSIS_HINTS}}`. Gemini sessions chain via `--resume` for accumulated context.

```
+-------------------------------------------------------------------+
|  maestro-coordinate Pipeline                                       |
+-------------------------------------------------------------------+
|                                                                   |
|  Phase 1: Intent Resolution                                       |
|     +-- Parse flags and detect mode (fresh / resume)              |
|     +-- Read .workflow/state.json for project context             |
|     +-- [if -c] Load existing session                             |
|     +-- Classify intent via detectTaskType                        |
|     +-- Map to chain via chainMap lookup                          |
|     +-- [--dry-run] Display chain and stop                        |
|     +-- [!-y] Present chain for confirmation                      |
|                                                                   |
|  Phase 2: Step Execution Loop                                     |
|     +-- For each step in chain:                                   |
|     |   +-- Build coordinate-step prompt (+ ANALYSIS_HINTS)       |
|     |   +-- exec_command: maestro cli --mode write (step)         |
|     |   +-- exec_command: maestro cli --mode analysis (Gemini)    |
|     |   +-- Extract hints from Gemini output                      |
|     |   +-- Update session state.json                             |
|     +-- On step failure: set abort flag, suggest -c resume        |
|                                                                   |
|  Phase 3: Completion Report                                       |
|     +-- Display per-step status + quality scores                  |
|     +-- Archive session state                                      |
+-------------------------------------------------------------------+
```

---

## Implementation

### Session Initialization

```javascript
const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '')
const timeStr = new Date().toISOString().substring(11, 19).replace(/:/g, '')
const sessionId = `MCC-${dateStr}-${timeStr}`
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`

functions.update_plan({
  explanation: "Starting coordinate session",
  plan: [
    { step: "Phase 1: Intent resolution", status: "in_progress" },
    { step: "Phase 2: Step execution loop", status: "pending" },
    { step: "Phase 3: Completion report", status: "pending" }
  ]
})
```

Create session directory and `state.json`:
```json
{
  "id": "<sessionId>",
  "intent": "<user intent>",
  "chain": null,
  "tool": "claude",
  "status": "in_progress",
  "started_at": "<ISO>",
  "steps": [],
  "current_step": 0,
  "analysis_session_id": null
}
```

### Phase 1: Intent Resolution

**Resume mode** (`-c`): Read latest session dir, load `state.json`, skip to Phase 2 at `current_step`.

**Fresh mode**:
1. Read `.workflow/state.json` for project context (`current_phase`, `workflow_name`)
   — Also read `~/.maestro/workflows/cli-tools-usage.md` for available chain definitions if `--chain` is not specified
2. Classify intent with `detectTaskType` heuristics:

| Intent keywords | Chain |
|----------------|-------|
| fix, bug, error, broken | quality-fix |
| test, spec, coverage | quality-test |
| refactor, cleanup, debt | quality-refactor |
| feature, implement, add | maestro-plan + maestro-execute |
| review, check, audit | quality-review |
| deploy, release, ship | maestro-verify + maestro-execute |

3. If `--chain` specified, use that chain directly
4. If `--dry-run`, display the planned chain and stop
5. If `!AUTO_YES`, confirm chain with user via `functions.request_user_input`

Save resolved chain to `state.json`.

```javascript
functions.update_plan({
  explanation: "Intent resolved, starting execution",
  plan: [
    { step: "Phase 1: Intent resolution", status: "completed" },
    { step: "Phase 2: Step execution loop", status: "in_progress" },
    { step: "Phase 3: Completion report", status: "pending" }
  ]
})
```

### Phase 2: Step Execution Loop

For each step in the resolved chain:

**Step execution**:

> **Prompt safety**: `intent`, `stepDescription`, and `prevStepSummary` may contain quotes or newlines. Write the assembled prompt to a temp file and reference it via `$(cat ...)`.

```javascript
const stepPrompt = `COORDINATE_STEP: ${stepN}
INTENT: ${intent}
CHAIN: ${chain}
STEP_CONTEXT: ${prevStepSummary}
ANALYSIS_HINTS: ${analysisHints || 'none'}
AUTO_YES: ${AUTO_YES}
---
Execute step ${stepN}: ${stepDescription}`

Write(`/tmp/${sessionId}-step-${stepN}.txt`, stepPrompt)
functions.exec_command({
  cmd: `maestro cli -p "$(cat /tmp/${sessionId}-step-${stepN}.txt)" --tool ${tool} --mode write`,
  workdir: "."
})
```

**Post-step analysis** (Gemini):
```javascript
functions.exec_command({
  cmd: `maestro cli -p "PURPOSE: Analyze the output of step ${stepN} for quality and correctness.
TASK: Identify gaps | Extract key findings | Prepare hints for next step
MODE: analysis
CONTEXT: @.workflow/.maestro-coordinate/${sessionId}/
EXPECTED: JSON with: quality_score (0-10), gaps (string[]), hints_for_next (string)
" --tool gemini --mode analysis ${analysisSessionId ? '--resume ' + analysisSessionId : ''}`,
  workdir: "."
})
```

Store `analysisSessionId` from stderr `[MAESTRO_EXEC_ID=...]` for `--resume` chaining.

Update `state.json` after each step:
```json
{
  "steps": [..., {
    "step": <N>,
    "description": "<stepDesc>",
    "status": "completed",
    "quality_score": <score>,
    "completed_at": "<ISO>"
  }],
  "current_step": <N+1>
}
```

On step failure: set `state.status = "aborted"`, stop loop, display resume instructions.

### Phase 3: Completion Report

```javascript
functions.update_plan({
  explanation: "Coordinate complete",
  plan: [
    { step: "Phase 1: Intent resolution", status: "completed" },
    { step: "Phase 2: Step execution loop", status: "completed" },
    { step: "Phase 3: Completion report", status: "completed" }
  ]
})
```

Display:
```
=== COORDINATE COMPLETE ===
Session:  <sessionId>
Chain:    <chain>
Steps:    <N>/<total>

STEP RESULTS:
  [1] <step> — score: <N>/10 ✓
  [2] <step> — score: <N>/10 ✓
  ...

Session: .workflow/.maestro-coordinate/<sessionId>/state.json
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Suggest `$maestro-init` |
| E002 | error | Clarity too low after 2 clarification rounds | Ask user to rephrase intent |
| E003 | error | Step execution failed | Display step error, set status aborted, suggest resume with `-c` |
| E004 | error | Resume session not found | Show available sessions in `.workflow/.maestro-coordinate/` |
| E005 | error | CLI tool unavailable | Try fallback tool (gemini → qwen → codex) |

---

## Core Rules

1. **Start immediately**: Init session directory and state.json before any other action
2. **Auto-confirm injection**: If `-y`, inject auto-confirm signal into every step prompt
3. **Resume is additive**: Resume picks up from `current_step` — never re-executes completed steps
4. **Gemini session chains**: Reuse `--resume <analysisSessionId>` for accumulated Gemini context across steps
5. **State.json is source of truth**: All step progress tracked in `state.json` — never rely on memory
6. **Step failure stops chain**: Abort on first step failure; never skip to next step silently
7. **Dry-run is read-only**: `--dry-run` must never execute any maestro cli write commands
