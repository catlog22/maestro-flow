---
name: collab
prepare: collab
commands: [maestro-collab]
session-mode: inherited
---

# Workflow: Collab

Fan-out requirement to multiple CLI tools in parallel → cross-verify for consensus/conflicts → synthesize into unified report with downstream artifacts.

## Architecture

```
Step 1: Parse & Route (requirement, flags)
Step 2: Tool Discovery (eligible tools >= 2)
Step 3: Plan Confirmation (-y skips)
Step 4: Parallel Fan-out (delegate launch + STOP)
Step 5: Collect (callbacks → per-tool evidence)
Step 6: Cross-Verify (consensus/conflict/unique)
Step 7: Boundary Grill (conflict resolution)
Step 8: Synthesis (3 output files)
Step 9: Wrap-up (check + complete)
```

---

## Step 1: Parse & Route

Parse $ARGUMENTS:

- Requirement text = all tokens not consumed by flags
- `--tools <list>`: comma-separated tool names
- `--mode analysis|write`: delegate mode (default `analysis`)
- `--rule <template>`: shared rule template
- `-y` / `--yes`: skip plan confirmation

Empty requirement → AskUserQuestion for the requirement text (E001 path).

**Session Resolution**: Runtime handles session resolution, artifact registration, and state updates via `maestro run create`.

**Output directories**:
```
output_dir   = {run_dir}/outputs/
evidence_dir = {run_dir}/evidence/per-tool/
```

---

## Step 2: Tool Discovery

```
Bash("maestro tools list --json 2>/dev/null || cat ~/.maestro/cli-tools.json")
```

**Note:** Shell commands MUST use the Bash tool (not PowerShell). Use POSIX syntax within Bash calls.

- Filter: `enabled == true`
- If `--mode write`: exclude `type == "api-endpoint"` tools
- `--tools` given → validate each against the eligible set
- No `--tools` → auto-select first 3 eligible in config order
- Eligible tools < 2 → **E002**, abort with guidance to enable more tools in cli-tools.json

---

## Step 3: Plan Confirmation

Skip when `-y`. Otherwise display the plan (requirement, selected tools, mode, rule) and confirm:

```
AskUserQuestion({
  questions: [{
    question: "Fan out to {tools} in {mode} mode?",
    header: "Collab plan",
    options: [
      { label: "执行", description: "Launch all delegates in parallel" },
      { label: "修改工具选择", description: "Re-select tools (must keep >= 2)" }
    ],
    multiSelect: false
  }]
})
```

- "修改工具选择" → back to Step 2 with user-chosen tools
- Cancel → end without creating outputs

---

## Step 4: Parallel Fan-out

### 4.1: Pre-load Project Knowledge (optional)

`maestro load --type spec --category arch` + `maestro search "{requirement keywords}" --category arch` → fold results into the shared prompt CONTEXT. Continue without if unavailable.

### 4.2: Build Shared Prompt

```
PURPOSE: {requirement}; success = actionable findings with evidence
TASK: {auto-decomposed into 3-5 specific verbs}
MODE: {delegateMode}
CONTEXT: @**/*
EXPECTED: Structured findings with file:line refs, confidence (0-100), prioritized recommendations
CONSTRAINTS: {from requirement}
```

The SAME prompt goes to every tool — never leak one tool's findings into another's prompt.

### 4.3: Launch

Launch ALL delegates in ONE message — multiple `Bash(run_in_background: true)` calls:

```
maestro delegate "${prompt}" --to {tool} --mode ${mode} [--rule ${rule}]
```

**STOP immediately after launch. Wait for background callbacks.**

---

## Step 5: Collect

On each callback: `maestro delegate output <id>` → write `{evidence_dir}/{tool}-output.md`.

| Condition | Action |
|-----------|--------|
| All callbacks arrived | proceed to Step 6 |
| All delegates failed | **E004** — abort with per-tool error details |
| 1+ succeeded, others failed | **W001** — continue with partial results, note failures in report |

---

## Step 6: Cross-Verify

**GATE: cross-verified** — every finding classified, consensus_level computed.

Read all per-tool outputs. For each finding:

| Condition | Tag |
|-----------|-----|
| 2+ tools agree | CONSENSUS |
| Tools disagree | CONFLICT |
| 1 tool only | UNIQUE |

```
consensus_level = consensus_count / total_findings * 100
```

If consensus_level < 40% → **W003**: flag in summary, recommend manual review.

---

## Step 7: Boundary Grill

Applies only to CONFLICT findings that dispute boundaries/responsibilities (module ownership, layer responsibility, API contract ownership). → mechanics follow ref/boundary-grill.md.

- Input: classified CONFLICT findings + per-tool outputs
- Cap: max 3 conflicts × 3 questions; non-blocking
- Resolved conflicts → tag with resolution, feed into Step 8
- No boundary conflicts → pass through

---

## Step 8: Synthesis

Resolve remaining (non-boundary) conflicts via evidence-weighted voting:

- Higher confidence wins; more specific evidence (file:line) wins over general; tied → SUGGESTED
- Unresolvable → keep as UNRESOLVED, list explicitly

Write 3 files to `{output_dir}`:

1. **collab-report.md** — Summary, Consensus Findings, Resolved Conflicts, Boundary Grill Results (if any), Unresolved Items, Unique Insights, Recommendations, Per-Tool Confidence table
2. **context.md** — Locked (CONSENSUS items), Free (UNIQUE with strong evidence), Deferred (UNRESOLVED conflicts). Standard Locked/Free/Deferred format for plan compatibility.
3. **conclusions.json**:

```jsonc
{
  "session_id": "{session_id}",
  "subject": "{requirement}",
  "mode": "{delegateMode}",
  "tools": ["{tool}"],
  "consensus_level": 0,
  "recommendation": "Go|No-Go|Conditional",
  "confidence": 0,
  "dimensions": [{ "name": "", "score": 0, "findings": [] }],
  "decisions": [{ "title": "", "classification": "CONSENSUS|CONFLICT|UNIQUE", "source_tools": [], "rationale": "" }]
}
```

**GATE: outputs-complete** — all 3 files exist under `outputs/` before Step 9. If any missing: produce it before proceeding.

---

## Step 9: Wrap-up

Artifact registration and state updates are handled by `maestro run complete`.

### Completion Report

```
=== COLLAB READY ===
Requirement: {requirement}
Tools: {tools with per-tool status}
Consensus level: {consensus_level}%
Output: {output_dir}
=== END COLLAB ===
```

### Next-step Routing

| Condition | Suggestion |
|-----------|-----------|
| Deep feasibility needed | step `analyze` (`maestro run prepare analyze` + `maestro run create analyze --session YYYYMMDD-analyze-{topic} --intent "{topic}"`) |
| Plan from conclusions | step `plan` (`maestro run prepare plan` + `maestro run create plan --session YYYYMMDD-plan-{topic} --intent "{goal}"`) |
| Expand ideas | step `brainstorm` (`maestro run prepare brainstorm` + `maestro run create brainstorm --session YYYYMMDD-brainstorm-{topic} --intent "{topic}"`) |

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Empty requirement | Ask user for requirement text |
| E002 | error | Fewer than 2 eligible tools | Check cli-tools.json, enable more tools |
| E004 | error | All delegates failed | Abort with per-tool error details |
| W001 | warning | Some tools failed, 1+ succeeded | Continue with partial results |
| W003 | warning | consensus_level < 40% | Flag in summary, recommend manual review |

## Success Criteria

- [ ] All delegates launched in parallel via Bash(run_in_background: true), STOP after launch
- [ ] Cross-verification: consensus/conflict/unique classification with consensus_level
- [ ] Boundary grill executed on boundary-type CONFLICT items (skip if none detected)
- [ ] Boundary grill results written to collab-report.md § Boundary Grill Results (if conflicts found)
- [ ] 3 output files produced (collab-report.md, context.md, conclusions.json)
- [ ] Partial degradation: continued if 1+ tools succeeded
