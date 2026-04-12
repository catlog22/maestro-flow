---
name: maestro-issue-plan
description: Solution planning for a specific issue. Auto-detects analysis context, runs maestro cli planning, and attaches a structured solution record with ordered steps and verification criteria to the issue in issues.jsonl.
argument-hint: "<ISS-ID> [--tool gemini|qwen] [--from-analysis]"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Issue Plan

## Usage

```bash
$maestro-issue-plan "ISS-20260401-001"
$maestro-issue-plan "ISS-20260401-001 --from-analysis"
$maestro-issue-plan "ISS-20260401-001 --tool qwen"
```

**Flags**:
- `<ISS-ID>` — Issue ID in `ISS-XXXXXXXX-NNN` format (required)
- `--tool gemini|qwen` — CLI tool for planning (default: gemini)
- `--from-analysis` — Explicitly include analysis context. Auto-detected when `issue.analysis` exists.

**State files**: `.workflow/issues/issues.jsonl` (read + write)

---

## Overview

Sequential 4-step pipeline: load issue → build planning prompt → run CLI planning → attach solution record. When an analysis record exists (from `manage-issue-analyze`), it is automatically included in the planning prompt to ground the solution in known root cause and affected files. This is the second step in the issue resolution workflow: **analyze → plan → execute**.

```
Load Issue  →  Build Prompt  →  CLI Planning  →  Attach Solution
(+ analysis    (auto-detect    (gemini/qwen)    (apply_patch)
  context)      analysis)
```

---

## Implementation

### Step 1: Load Issue and Detect Analysis Context

```javascript
functions.update_plan({
  explanation: "Starting issue planning",
  plan: [
    { step: "Load issue and detect analysis", status: "in_progress" },
    { step: "Build planning prompt", status: "pending" },
    { step: "Run CLI planning", status: "pending" },
    { step: "Attach solution record", status: "pending" }
  ]
})
```

Read `.workflow/issues/issues.jsonl`, find the row where `id == <ISS-ID>`. Validate format and existence.

Check analysis context:
- `issue.analysis` non-null → `hasAnalysis = true` (auto-detect, no flag needed)
- `--from-analysis` present AND `issue.analysis` is null → emit W001, proceed without context

### Step 2: Build Planning Prompt

```
PURPOSE: Create a concrete, codebase-aware solution plan for '${issue.title}';
  success = ordered steps with exact file paths, function names, and verification criteria.
TASK: Define solution approach | Break into ordered steps | Identify files to change | Define verification
MODE: analysis
CONTEXT: @src/**/* | Memory: Issue: ${issue.description}
  ${hasAnalysis ? `Root cause: ${analysis.root_cause}
  Affected files: ${analysis.affected_files.join(', ')}
  Fix direction: ${analysis.fix_direction}` : ''}
EXPECTED: JSON: approach (string), steps [{order, description, file, action}],
  verification (string[]), estimated_risk (low|medium|high)
CONSTRAINTS: Concrete steps only | File:line references required | No speculative changes
```

### Step 3: Run CLI Planning

> **Prompt safety**: `issue.title`, `issue.description`, and analysis fields may contain quotes or shell-special characters. Write the assembled prompt to a temp file before passing to exec_command.

```javascript
// Write prompt to temp file to avoid shell injection
Write(`/tmp/iss-plan-${issueId}.txt`, prompt)
functions.exec_command({
  cmd: `maestro cli -p "$(cat /tmp/iss-plan-${issueId}.txt)" --tool ${tool} --mode analysis`,
  workdir: "."
})
```

Parse CLI output into `solution` object:
```json
{
  "approach": "...",
  "steps": [
    { "order": 1, "description": "...", "file": "src/foo.ts", "action": "modify" },
    { "order": 2, "description": "...", "file": "src/bar.ts", "action": "add" }
  ],
  "verification": ["Run unit tests for X", "Verify Y behavior"],
  "estimated_risk": "medium",
  "planned_at": "<ISO>",
  "tool": "<tool>"
}
```

```javascript
functions.update_plan({
  explanation: "Planning complete",
  plan: [
    { step: "Load issue and detect analysis", status: "completed" },
    { step: "Build planning prompt", status: "completed" },
    { step: "Run CLI planning", status: "completed" },
    { step: "Attach solution record", status: "in_progress" }
  ]
})
```

### Step 4: Attach Solution Record and Report

```javascript
// Read issues.jsonl, update the matching line in-place
const historyEntry = { action: "planned", at: new Date().toISOString(), by: "manage-issue-plan", summary: `Approach: ${solution.approach} — ${solution.steps.length} steps` }
const raw = Read('.workflow/issues/issues.jsonl')
const updated = raw.split('\n')
  .filter(l => l.trim())
  .map(l => {
    const row = JSON.parse(l)
    if (row.id !== issueId) return l
    row.solution = solution
    row.issue_history = [...(row.issue_history || []), historyEntry]
    return JSON.stringify(row)
  })
  .join('\n') + '\n'
Write('.workflow/issues/issues.jsonl', updated)
```

```javascript
functions.update_plan({
  explanation: "Solution attached",
  plan: [
    { step: "Load issue and detect analysis", status: "completed" },
    { step: "Build planning prompt", status: "completed" },
    { step: "Run CLI planning", status: "completed" },
    { step: "Attach solution record", status: "completed" }
  ]
})
```

Display:
```
=== SOLUTION PLAN ===
Issue:    <ISS-ID>: <title>
Approach: <approach>
Risk:     <estimated_risk>
Steps:    <N>

Steps:
  1. <description> → <file> (<action>)
  2. <description> → <file> (<action>)

Verification:
  - <verification 1>

Next: $maestro-issue-execute "<ISS-ID>"
```

---

## Error Handling

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No ISS-ID provided | Display usage hint |
| E002 | error | ISS-ID not found in issues.jsonl | Suggest `$maestro-issue "list"` |
| E003 | error | CLI planning returned no parseable result | Retry with different `--tool` |
| W001 | warning | `--from-analysis` but no analysis record exists | Proceed without context; suggest `$maestro-issue-analyze` |

---

## Core Rules

1. **Load before plan**: Validate issue existence before any CLI call
2. **Auto-detect analysis**: Check `issue.analysis` — never require explicit `--from-analysis` if data is present
3. **Concrete steps only**: Each step must have a file reference — no "investigate further" placeholders
4. **Preserve existing fields**: Patch only `solution` + `issue_history` — all other issue fields unchanged
5. **Append-only history**: Append to `issue_history`, never overwrite existing entries
6. **Next-step routing**: Always display `$maestro-issue-execute "<ISS-ID>"` at the end
