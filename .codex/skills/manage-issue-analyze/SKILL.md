---
name: maestro-issue-analyze
description: Root cause analysis for a specific issue via CLI exploration. Gathers codebase context (grep or semantic deep search), runs maestro cli gemini analysis, and attaches a structured analysis record to the issue in issues.jsonl.
argument-hint: "<ISS-ID> [--tool gemini|qwen] [--depth standard|deep]"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Issue Analyze

## Usage

```bash
$maestro-issue-analyze "ISS-20260401-001"
$maestro-issue-analyze "ISS-20260401-001 --depth deep"
$maestro-issue-analyze "ISS-20260401-001 --tool qwen --depth standard"
```

**Flags**:
- `<ISS-ID>` — Issue ID in `ISS-XXXXXXXX-NNN` format (required)
- `--tool gemini|qwen` — CLI tool for analysis (default: gemini)
- `--depth standard|deep` — `standard` uses keyword grep; `deep` spawns a semantic explore agent (default: standard)

**State files**: `.workflow/issues/issues.jsonl` (read + write)

---

## Overview

Sequential 4-step pipeline: load issue → gather codebase context → run CLI analysis → attach analysis record. The CLI analysis step invokes `maestro cli --tool gemini --mode analysis` to produce a structured root-cause record written back into issues.jsonl. This is the first step in the issue resolution workflow: **analyze → plan → execute**.

```
Load Issue  →  Gather Context  →  CLI Analysis  →  Attach Record
(validate)     (grep / agent)     (gemini/qwen)    (apply_patch)
```

---

## Implementation

### Step 1: Load and Validate Issue

```javascript
functions.update_plan({
  explanation: "Starting issue analysis",
  plan: [
    { step: "Load and validate issue", status: "in_progress" },
    { step: "Gather codebase context", status: "pending" },
    { step: "Run CLI analysis", status: "pending" },
    { step: "Attach analysis record", status: "pending" }
  ]
})
```

Read `.workflow/issues/issues.jsonl` line by line. Find the row where `id == <ISS-ID>`. Validate:
- ISS-ID matches format `ISS-[0-9]{8}-[0-9]{3}`
- Row found in file
- Parse fields: `id`, `title`, `description`, `status`, `context`, `related_files`

If `status` is not `open` or `registered`, emit W001 but continue.

### Step 2: Gather Codebase Context

**Standard depth** (default):
- Grep key terms from `issue.title` + `issue.description` across `src/**` (-C 3)
- If `issue.related_files` is set, read those files directly
- Collect file:line references into `contextSummary`

**Deep depth**:
```javascript
spawn_agent({
  task_name: "ctx-explore",
  fork_context: false,
  message: `## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read: ~/.codex/agents/cli-explore-agent.md

---

Goal: Gather codebase context for issue root-cause analysis.
Issue: <issue.title>
Description: <issue.description>

TASK: Find all code paths, functions, and modules related to this issue.
Identify: affected locations (file:line), caller/callee chains, data flow, existing error handling.

EXPECTED: JSON with: affected_files [{file, line, snippet, relevance}], related_modules, error_handling_gaps, test_coverage_gaps.
`
})
const ctxResult = wait_agent({ targets: ["ctx-explore"], timeout_ms: 300000 })
close_agent({ target: "ctx-explore" })
```

```javascript
functions.update_plan({
  explanation: "Context gathered",
  plan: [
    { step: "Load and validate issue", status: "completed" },
    { step: "Gather codebase context", status: "completed" },
    { step: "Run CLI analysis", status: "in_progress" },
    { step: "Attach analysis record", status: "pending" }
  ]
})
```

### Step 3: Run CLI Analysis

> **Prompt safety**: `issue.title` and `contextSummary` may contain quotes or shell-special characters. Write the full prompt to a temp file first and reference it via `$(cat ...)` to avoid shell injection.

```javascript
// Build prompt, write to temp file to avoid shell injection
const promptContent = `PURPOSE: Root cause analysis for issue; identify exact cause, impact scope, fix direction; success = actionable record with file:line evidence.
Issue: ${issue.id} — ${issue.title}
TASK: Trace failure path | Map affected components | Assess blast radius | Define fix direction
MODE: analysis
CONTEXT: @src/**/* | Memory: ${contextSummary}
EXPECTED: JSON: root_cause (string), affected_files (string[]), impact_scope (low|medium|high|critical), fix_direction (string), confidence (low|medium|high)
CONSTRAINTS: Evidence required — file:line for each claim`

Write(`/tmp/iss-analyze-${issue.id}.txt`, promptContent)
functions.exec_command({
  cmd: `maestro cli -p "$(cat /tmp/iss-analyze-${issue.id}.txt)" --tool ${tool} --mode analysis`,
  workdir: "."
})
```

Parse CLI output into `analysis` object:
```json
{
  "root_cause": "...",
  "affected_files": ["src/foo.ts:42"],
  "impact_scope": "medium",
  "fix_direction": "...",
  "analyzed_at": "<ISO>",
  "tool": "<tool>",
  "depth": "<depth>",
  "confidence": "medium"
}
```

### Step 4: Attach Analysis Record and Report

```javascript
// Read issues.jsonl, update the matching line in-place
const historyEntry = { action: "analyzed", at: new Date().toISOString(), by: "manage-issue-analyze", summary: `Root cause: ${analysis.root_cause}` }
const raw = Read('.workflow/issues/issues.jsonl')
const updated = raw.split('\n')
  .filter(l => l.trim())
  .map(l => {
    const row = JSON.parse(l)
    if (row.id !== issueId) return l
    row.analysis = analysis
    row.issue_history = [...(row.issue_history || []), historyEntry]
    return JSON.stringify(row)
  })
  .join('\n') + '\n'
Write('.workflow/issues/issues.jsonl', updated)
```

```javascript
functions.update_plan({
  explanation: "Analysis complete",
  plan: [
    { step: "Load and validate issue", status: "completed" },
    { step: "Gather codebase context", status: "completed" },
    { step: "Run CLI analysis", status: "completed" },
    { step: "Attach analysis record", status: "completed" }
  ]
})
```

Display:
```
=== ANALYSIS COMPLETE ===
Issue:       <ISS-ID>: <title>
Root Cause:  <root_cause>
Impact:      <impact_scope>
Confidence:  <confidence>
Affected:    <N> files

Next: $maestro-issue-plan "<ISS-ID>"
```

---

## Error Handling

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No ISS-ID provided | Display usage hint with format example |
| E002 | error | ISS-ID format invalid | Show correct format `ISS-XXXXXXXX-NNN` |
| E003 | error | ISS-ID not found in issues.jsonl | Suggest `$maestro-issue "list"` |
| E004 | error | CLI analysis returned no parseable result | Retry with different `--tool`; report partial |
| W001 | warning | Issue status is not open/registered | Warn, allow analysis to continue |

---

## Core Rules

1. **Start immediately**: First action is `update_plan` then issue load — no preamble
2. **Validate before analysis**: Never run CLI without a valid loaded issue
3. **Evidence required**: Analysis record must cite file:line — no speculative root causes
4. **Deep agent lifecycle**: If deep spawned an agent, always `close_agent` before Step 3
5. **Append-only history**: Append to `issue_history`, never overwrite existing entries
- *Note*: `spawn_agent` / `wait_agent` / `close_agent` are Codex v4 built-in orchestration functions — they do not need to be listed in `allowed-tools`
6. **Preserve existing fields**: Patch only `analysis` + `issue_history` — all other fields unchanged
7. **Next-step routing**: Always display `$maestro-issue-plan "<ISS-ID>"` at the end
