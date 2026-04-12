---
name: maestro-issue-execute
description: Execute a planned solution for an issue via dual-mode dispatch. Auto-detects server UP (POST to /api/execution/dispatch) or DOWN (direct maestro cli). Updates issue status on completion with next-step routing to close, debug, or verify.
argument-hint: "<ISS-ID> [--executor claude-code|codex|gemini] [--dry-run]"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Issue Execute

## Usage

```bash
$maestro-issue-execute "ISS-20260401-001"
$maestro-issue-execute "ISS-20260401-001 --dry-run"
$maestro-issue-execute "ISS-20260401-001 --executor codex"
$maestro-issue-execute "ISS-20260401-001 --executor gemini"
```

**Flags**:
- `<ISS-ID>` — Issue ID in `ISS-XXXXXXXX-NNN` format (required)
- `--executor claude-code|codex|gemini` — Execution agent (default: claude-code)
- `--dry-run` — Preview constructed prompt and steps without executing

**State files**: `.workflow/issues/issues.jsonl` (read + write)

---

## Overview

Sequential 4-step pipeline with conditional dispatch: load issue → dry-run check → detect mode → execute + update. Server-UP path posts to the orchestration API; Server-DOWN path invokes `maestro cli` directly. This is the third step in the issue resolution workflow: **analyze → plan → execute**.

```
Load Issue  →  [dry-run?]  →  Detect Mode  →  Dispatch  →  Update Status
(+ solution     (display        server UP         POST       (apply_patch)
  required)      + stop)        / DOWN          / cli
```

---

## Implementation

### Step 1: Load Issue and Validate Solution

```javascript
functions.update_plan({
  explanation: "Starting issue execution",
  plan: [
    { step: "Load issue and validate solution", status: "in_progress" },
    { step: "Detect dispatch mode", status: "pending" },
    { step: "Execute solution", status: "pending" },
    { step: "Update issue status", status: "pending" }
  ]
})
```

Read `.workflow/issues/issues.jsonl`, find row where `id == <ISS-ID>`. Validate:
- ISS-ID format `ISS-[0-9]{8}-[0-9]{3}`
- Row exists in file
- `issue.solution` is non-null (E002 if missing — run `manage-issue-plan` first)

If `--dry-run`: display the full constructed prompt and each step from `issue.solution.steps`, then stop.

### Step 2: Detect Dispatch Mode

```javascript
// Read port from config (falls back to MAESTRO_PORT env var, then 3000)
const configPort = (() => {
  try { return JSON.parse(Read('.workflow/config.json'))?.server?.port } catch { return null }
})()
const port = configPort || functions.exec_command({ cmd: "echo ${MAESTRO_PORT:-3000}", workdir: "." }).stdout.trim()

const healthCheck = functions.exec_command({
  cmd: `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}/health`,
  workdir: "."
})
const serverUp = healthCheck.stdout.trim() === "200"
```

| Mode | Condition | Action |
|------|-----------|--------|
| Server UP | HTTP 200 from /health | POST to `/api/execution/dispatch` |
| Server DOWN | Any other result | Direct `maestro cli` execution |

```javascript
functions.update_plan({
  explanation: `Dispatch mode: ${serverUp ? "server" : "cli"}`,
  plan: [
    { step: "Load issue and validate solution", status: "completed" },
    { step: "Detect dispatch mode", status: "completed" },
    { step: "Execute solution", status: "in_progress" },
    { step: "Update issue status", status: "pending" }
  ]
})
```

### Step 3: Execute Solution

Build the execution prompt from `issue.solution`:
```
PURPOSE: Implement solution for '${issue.title}'.
TASK: ${solution.steps.map(s => `${s.order}. ${s.description} in ${s.file}`).join(' | ')}
MODE: write
CONTEXT: @src/**/* | Memory: Approach: ${solution.approach}
  ${issue.analysis ? `Root cause: ${issue.analysis.root_cause}` : ''}
EXPECTED: All steps implemented, all verification criteria met: ${solution.verification.join('; ')}
CONSTRAINTS: Only modify files listed in steps | No scope creep
```

**Server UP**:
```javascript
// Write payload to temp file to avoid shell injection from prompt content
const payload = JSON.stringify({ issue_id: issue.id, executor, prompt: execPrompt })
Write(`/tmp/iss-exec-${issue.id}.json`, payload)
functions.exec_command({
  cmd: `curl -X POST http://localhost:${port}/api/execution/dispatch \
    -H 'Content-Type: application/json' \
    -d @/tmp/iss-exec-${issue.id}.json`,
  workdir: "."
})
```

**Server DOWN**:
```javascript
// Write prompt to temp file to avoid shell injection
Write(`/tmp/iss-exec-${issue.id}.txt`, execPrompt)
functions.exec_command({
  cmd: `maestro cli -p "$(cat /tmp/iss-exec-${issue.id}.txt)" --tool ${executor === 'codex' ? 'codex' : 'claude'} --mode write`,
  workdir: "."
})
```

Set issue status to `in_progress` before dispatching via apply_patch.

### Step 4: Update Issue Status and Report

On success:
```javascript
// Read issues.jsonl, update the matching line in-place
const historyEntry = { action: "executed", at: new Date().toISOString(), by: "manage-issue-execute", executor, summary: `Solution executed via ${serverUp ? "server" : "cli"}` }
const raw = Read('.workflow/issues/issues.jsonl')
const updated = raw.split('\n')
  .filter(l => l.trim())
  .map(l => {
    const row = JSON.parse(l)
    if (row.id !== issueId) return l
    row.status = "resolved"
    row.issue_history = [...(row.issue_history || []), historyEntry]
    return JSON.stringify(row)
  })
  .join('\n') + '\n'
Write('.workflow/issues/issues.jsonl', updated)
```

```javascript
functions.update_plan({
  explanation: "Execution complete",
  plan: [
    { step: "Load issue and validate solution", status: "completed" },
    { step: "Detect dispatch mode", status: "completed" },
    { step: "Execute solution", status: "completed" },
    { step: "Update issue status", status: "completed" }
  ]
})
```

Display next-step routing:
```
=== EXECUTION COMPLETE ===
Issue:     <ISS-ID>: <title>
Executor:  <executor>
Mode:      <server|cli>
Status:    resolved

Next steps:
  Close:   $maestro-issue "close <ISS-ID> --resolution fixed"
  Verify:  $maestro-verify "<phase>"
  Debug:   $maestro-debug "<failure description>" (if issues found)
```

---

## Error Handling

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No ISS-ID provided | Display usage hint |
| E002 | error | No solution record on issue | Run `$maestro-issue-plan "<ISS-ID>"` first |
| E003 | error | ISS-ID not found in issues.jsonl | Suggest `$maestro-issue "list"` |
| E004 | error | Server dispatch or CLI execution failed | Log error, revert status to `open`, display failure details |

---

## Core Rules

1. **Solution required**: Never dispatch without a valid `issue.solution` record
2. **Dry-run first**: `--dry-run` always stops after displaying prompt — no execution
3. **Status before dispatch**: Set status to `in_progress` before dispatching, `resolved` on success, `open` on failure
4. **Revert on failure**: If dispatch fails, revert issue status to `open` via apply_patch
5. **Preserve history**: Append to `issue_history`, never overwrite existing entries
6. **Next-step routing**: Always display all three options (close / verify / debug) at the end
