---
name: Maestro-coordinate
description: CLI-based coordinator — analyze intent → select command chain → execute sequentially via codex delegate with auto-confirm. Async state machine with template-driven prompts and gemini analysis between steps.
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--chain <name>] [--tool <tool>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `-y` or `--yes`: Skip clarification and confirmation prompts. Auto-confirm all delegate executions.

# Maestro Coordinate (CLI Delegate)

## Usage

```bash
$Maestro-coordinate "implement user authentication with JWT"
$Maestro-coordinate -y "refactor the payment module"
$Maestro-coordinate --continue
$Maestro-coordinate --dry-run "add rate limiting to API endpoints"
$Maestro-coordinate --chain feature "add dark mode toggle"
$Maestro-coordinate --tool gemini "fix auth regression"
```

**Flags**:
- `-y, --yes` — Auto mode: skip all prompts, inject auto-confirm into delegates
- `-c, --continue` — Resume previous session from last incomplete step
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force a specific chain (skips intent classification)
- `--tool <tool>` — CLI tool override (default: codex)

**Session state**: `.workflow/.maestro-coordinate/{session-id}/state.json`

---

## Overview

Sequential CLI-delegate coordinator. Each chain step is executed via `codex delegate "prompt" --to <tool> --mode write` with a template-driven prompt. After each step completes, a gemini analysis evaluates output quality and generates optimization hints for subsequent steps. All execution is background-async with hook callbacks.

```
Intent  →  Resolve Chain  →  Step 1  →  Analysis  →  Step 2  →  Analysis  →  …  →  Report
              (chainMap)     delegate    gemini       delegate    gemini
                             callback   callback     callback    callback
```

---

## Implementation

> **Full implementation reference**: The complete `detectTaskType`, `detectNextAction`, and `chainMap` definitions (35+ intent patterns, 40+ chain types) are in `~/.maestro/workflows/maestro-coordinate.codex.md`. Read that file for authoritative logic before executing any step.

<required_reading>
@~/.maestro/workflows/maestro-coordinate.codex.md
</required_reading>

<deferred_reading>
- [coordinate template](~/.maestro/templates/cli/prompts/coordinate-step.txt) — read when filling step prompts
</deferred_reading>

### Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const AUTO_YES = /\b(-y|--yes)\b/.test(args);
const RESUME = /\b(-c|--continue)\b/.test(args);
const DRY_RUN = /\b--dry-run\b/.test(args);
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'codex';
const intent = args
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

**If RESUME:**
1. Find latest `state.json` in `.workflow/.maestro-coordinate/`
2. Load state → set `current_step` to first non-completed step
3. Jump to **Step 6**

---

### Step 2: Read Project State

Read `.workflow/state.json` + `.workflow/roadmap.md` + current phase `index.json`.

**If missing:** `projectState = { initialized: false }`. If intent also empty → Error E001.

---

### Step 3: Classify Intent & Select Chain

Follow `~/.maestro/workflows/maestro-coordinate.md` Steps 3a–3d exactly:
- Exact-match keywords (fast path)
- Structured intent extraction (action × object matrix)
- State-based routing for `state_continue`
- Chain map lookup
- Phase/issue ID resolution

If clarity < 2 and not AUTO_YES: clarify via AskUserQuestion (max 2 rounds).

---

### Step 4: Confirm

**If `DRY_RUN`:** Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name} (dry run)
  1. [{cmd}] {args}
  2. [{cmd}] {args}
```

**If not AUTO_YES:** AskUserQuestion — Execute / Execute from step N / Cancel.

---

### Step 5: Setup Session

```javascript
const sessionId = `coord-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;
Bash(`mkdir -p "${sessionDir}"`);

const state = {
  session_id: sessionId, status: 'running',
  created_at: new Date().toISOString(),
  intent, task_type: taskType, chain_name: chainName,
  tool: cliTool, auto_mode: AUTO_YES, phase: resolvedPhase,
  current_step: 0,
  gemini_session_id: null,
  step_analyses: [],
  steps: chain.map((s, i) => ({
    index: i, cmd: s.cmd, args: s.args || '',
    status: 'pending', exec_id: null, analysis: null
  }))
};
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

---

### Step 6: Execute Step via codex delegate

#### 6a: Assemble args

```javascript
const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y', 'maestro-ui-design': '-y',
  'maestro-plan': '--auto', 'maestro-spec-generate': '-y', 'quality-test': '--auto-fix',
  'quality-retrospective': '--auto-yes',
};

function assembleArgs(step) {
  let a = (step.args || '')
    .replace(/\{phase\}/g, context.current_phase || '')
    .replace(/\{description\}/g, context.user_intent || '')
    .replace(/\{issue_id\}/g, context.issue_id || '')
    .replace(/\{spec_session_id\}/g, context.spec_session_id || '')
    .replace(/\{scratch_dir\}/g, context.scratch_dir || '');
  if (state.auto_mode) {
    const flag = AUTO_FLAG_MAP[step.cmd];
    if (flag && !a.includes(flag)) a = a ? `${a} ${flag}` : flag;
  }
  return a.trim();
}
```

#### 6b: Build prompt from template

Read `~/.maestro/templates/cli/prompts/coordinate-step.txt`, fill placeholders.
If previous step has analysis hints, inject them as `{{ANALYSIS_HINTS}}`.

```javascript
function escapeForShell(str) { return "'" + str.replace(/'/g, "'\\''") + "'"; }

const assembledArgs = assembleArgs(step);
const template = Read('~/.maestro/templates/cli/prompts/coordinate-step.txt');

let analysisHints = '';
const prevAnalysis = (state.step_analyses || []).find(a => a.step_index === state.current_step - 1);
if (prevAnalysis?.next_step_hints) {
  const h = prevAnalysis.next_step_hints;
  const parts = [];
  if (h.prompt_additions) parts.push(h.prompt_additions);
  if (h.cautions?.length) parts.push('Cautions: ' + h.cautions.join('; '));
  if (h.context_to_carry) parts.push('Context from prior step: ' + h.context_to_carry);
  if (parts.length) analysisHints = parts.join('\n');
}

const prompt = template
  .replace('{{COMMAND}}', `/${step.cmd}`)
  .replace('{{ARGS}}', assembledArgs)
  .replace('{{STEP_N}}', `${state.current_step + 1}/${state.steps.length}`)
  .replace('{{AUTO_DIRECTIVE}}', state.auto_mode ? 'Auto-confirm all prompts. No interactive questions.' : '')
  .replace('{{CHAIN_NAME}}', state.chain_name)
  .replace('{{ANALYSIS_HINTS}}', analysisHints);
```

#### 6c: Launch via codex delegate

```
------------------------------------------------------------
  STEP {i+1}/{total}: {step.cmd}  |  Tool: {cliTool}
------------------------------------------------------------
```

```javascript
state.steps[state.current_step].status = 'running';
state.steps[state.current_step].started_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

Bash({
  command: `codex delegate ${escapeForShell(prompt)} --to ${state.tool} --mode write`,
  run_in_background: true, timeout: 600000
});
// ■ STOP — wait for hook callback
```

---

### Step 7: Post-Step Callback

```javascript
const stepIdx = state.current_step;
const step = state.steps[stepIdx];
const output = /* callback output */;

step.exec_id = /* from callback stderr */;
step.completed_at = new Date().toISOString();

// Context propagation
const phaseMatch = output.match(/PHASE:\s*(\d+)/m);
if (phaseMatch) context.current_phase = phaseMatch[1];
const specMatch = output.match(/SPEC-[\w-]+/);
if (specMatch) context.spec_session_id = specMatch[0];
const scratchMatch = output.match(/scratch_dir:\s*(.+)/m);
if (scratchMatch) context.scratch_dir = scratchMatch[1].trim();

// Success/failure
const failed = /^STATUS:\s*FAILURE/m.test(output);
if (!failed) {
  step.status = 'completed';
} else if (state.auto_mode) {
  if (!step.retried) { step.retried = true; /* re-execute Step 6c */ return; }
  step.status = 'skipped';
} else {
  // AskUserQuestion: Retry / Skip / Abort
}

Write(`${sessionDir}/step-${stepIdx + 1}-output.txt`, output);
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

// → Step 7b: Gemini analysis (skip if step failed/skipped or single-step chain)
if (step.status === 'completed' && state.steps.length > 1) {
  // → Step 7b
} else {
  state.current_step = stepIdx + 1;
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
  if (state.current_step < state.steps.length) { /* → Step 6 */ }
  else { /* → Step 8 */ }
}
```

---

### Step 7b: Analyze Step Output (via gemini)

After each step completes, call gemini to evaluate execution quality and generate optimization hints.

```javascript
const analysisPrompt = `PURPOSE: Evaluate execution quality of coordinate step "${step.cmd}" and generate optimization hints for the next step.
CHAIN: ${state.chain_name} | Intent: ${state.intent}
COMMAND: /${step.cmd} ${step.args || ''}
STEP OUTPUT (last 200 lines):
${output.split('\n').slice(-200).join('\n')}
NEXT STEP: ${nextStep ? `/${nextStep.cmd} ${nextStep.args || ''}` : 'None (last step)'}
EXPECTED OUTPUT (strict JSON):
{
  "quality_score": <0-100>,
  "execution_assessment": { "success": <bool>, "completeness": "<full|partial|minimal>", "key_outputs": [], "missing_outputs": [] },
  "issues": [{ "severity": "critical|high|medium|low", "description": "" }],
  "next_step_hints": {
    "prompt_additions": "<extra context or constraints to inject into next step prompt>",
    "cautions": ["<things next step should watch out for>"],
    "context_to_carry": "<key facts from this step's output that next step needs>"
  },
  "step_summary": ""
}`;

let delegateCmd = `codex delegate ${escapeForShell(analysisPrompt)} --to gemini --mode analysis --rule analysis-review-code-quality`;
if (state.gemini_session_id) delegateCmd += ` --resume ${state.gemini_session_id}`;
Bash({ command: delegateCmd, run_in_background: true, timeout: 300000 });
// ■ STOP — wait for hook callback
```

### Step 7c: Post-Analyze Callback

```javascript
const analysisResult = /* parsed JSON from callback output */;
state.gemini_session_id = /* from callback stderr */;

if (!state.step_analyses) state.step_analyses = [];
state.step_analyses.push({
  step_index: stepIdx, cmd: step.cmd,
  quality_score: analysisResult.quality_score,
  issues: analysisResult.issues,
  next_step_hints: analysisResult.next_step_hints,
  summary: analysisResult.step_summary
});
step.analysis = {
  quality_score: analysisResult.quality_score,
  issue_count: (analysisResult.issues || []).length
};
Write(`${sessionDir}/step-${stepIdx + 1}-analysis.json`, JSON.stringify(analysisResult, null, 2));

// Advance
state.current_step = stepIdx + 1;
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

if (state.current_step < state.steps.length) { /* → Step 6 */ }
else { /* → Step 8 */ }
```

---

### Step 8: Completion Report

```javascript
const done = state.steps.filter(s => s.status === 'completed').length;
state.status = state.steps.some(s => s.status === 'failed') ? 'completed_with_errors' : 'completed';
state.completed_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

```
============================================================
  MAESTRO-COORDINATE COMPLETE
============================================================
  Session: {session_id}
  Chain:   {chain_name} ({done}/{total})
  Tool:    {cliTool}

  Steps:
    [✓] 1. maestro-plan — completed (quality: 85/100)
    [✓] 2. maestro-execute — completed (quality: 78/100)

  Avg Quality: {avg_score}/100
  Next: $Maestro-coordinate --continue
============================================================
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Suggest $maestro-init |
| E002 | error | Clarity too low after 2 rounds | Ask to rephrase |
| E003 | error | Step failed + abort | Suggest resume with -c |
| E004 | error | Resume session not found | Show available sessions |
| E005 | error | CLI tool unavailable | Try fallback tool |

---

## Core Rules

1. **Semantic routing** — LLM-native structured extraction (`action × object`) replaces regex; disambiguates by context
2. **STOP after each `codex delegate` call** — background execution, wait for hook callback
3. **State machine** — advance via `current_step`, no sync loops for async operations
4. **Template-driven** — all steps use `coordinate-step.txt`, no per-command prompt assembly
5. **Context propagation** — parse PHASE / spec session ID / scratch_dir / issue_id from each step output, feed to next step
6. **Quality gates** — issue chains auto-include review; `issue-full` is default for issue execution
7. **Tool fallback** — if `codex delegate` fails: retry with same tool once, then try `gemini` → `qwen`
8. **Auto-confirm injection** — `{{AUTO_DIRECTIVE}}` in template prevents blocking during background execution
9. **Resumable** — `-c` reads `state.json`, jumps to first pending step
10. **Gemini analysis after each step** — evaluate output quality via `codex delegate --to gemini --mode analysis`, chained via `--resume`
11. **Session capture** — after each gemini callback, capture exec_id → `gemini_session_id` for resume chain
12. **Analysis skip conditions** — skip gemini analysis for: failed/skipped steps, single-step chains
