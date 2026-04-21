---
name: maestro-coordinate
description: CLI-based coordinator — analyze intent → select command chain → execute sequentially via maestro delegate with auto-confirm. Async state machine with template-driven prompts and gemini analysis between steps.
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--chain <name>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Sequential CLI-delegate coordinator. Each chain step executes via `maestro delegate "prompt" --to <tool> --mode write`
with a template-driven prompt. After each step, gemini analysis evaluates output quality and generates
optimization hints for subsequent steps. All execution is background-async with hook callbacks.

```
Intent  →  Resolve Chain  →  Step 1  →  Analysis  →  Step 2  →  Analysis  →  …  →  Report
              (chainMap)     delegate    gemini       delegate    gemini
                             callback   callback     callback    callback
```
</purpose>

<required_reading>
@~/.maestro/workflows/maestro-coordinate.codex.md — authoritative `detectTaskType`, `detectNextAction`, `chainMap` (35+ intent patterns, 40+ chain types). Read before executing any step.
</required_reading>

<deferred_reading>
- [coordinate template](~/.maestro/templates/cli/prompts/coordinate-step.txt) — read when filling step prompts
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special flags.

**Flags:**
- `-y, --yes` — Auto mode: skip all prompts, inject auto-confirm into delegates
- `-c, --continue` — Resume previous session from last incomplete step
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force specific chain (skips intent classification)

**Session state**: `.workflow/.maestro-coordinate/{session-id}/state.json`
</context>

<invariants>
1. **STOP after each delegate call**: Background execution via `run_in_background: true`, wait for hook callback.
2. **State machine**: Advance via `current_step`, no sync loops for async operations.
3. **Template-driven**: All steps use `coordinate-step.txt`, no per-command prompt assembly.
4. **Context propagation**: Parse PHASE / spec session ID / scratch_dir / issue_id from each step output, feed to next step.
5. **Gemini analysis after each step**: Evaluate output quality, generate hints for next step, chain via `--resume`.
6. **Auto-confirm injection**: `{{AUTO_DIRECTIVE}}` in template prevents blocking during background execution.
7. **Resumable**: `-c` reads `state.json`, jumps to first pending step.
8. **Delegate tool**: `maestro delegate --to codex` for all execution steps; `--to gemini` only for post-step analysis.</invariants>

<execution>

### Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const AUTO_YES = /\b(-y|--yes)\b/.test(args);
const RESUME = /\b(-c|--continue)\b/.test(args);
const DRY_RUN = /\b--dry-run\b/.test(args);
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const intent = args
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--chain\s+\S+/g, '')
  .trim();
```

**If RESUME**: Find latest `state.json` in `.workflow/.maestro-coordinate/`, load → jump to Step 6.

### Step 2–4: Classify Intent → Confirm

1. Read `.workflow/state.json` + `.workflow/roadmap.md` + current phase
2. If `--chain` given → use directly; else classify via `detectTaskType` + `chainMap`
3. If clarity < 2 and not AUTO_YES → clarify via AskUserQuestion (max 2 rounds)
4. **`--dry-run`**: Display chain and exit
5. **User confirmation** (skip if AUTO_YES): Execute / Execute from step N / Cancel

### Step 5: Setup Session

```javascript
const sessionId = `coord-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;

const state = {
  session_id: sessionId, status: 'running',
  created_at: new Date().toISOString(),
  intent, task_type: taskType, chain_name: chainName,
  auto_mode: AUTO_YES, phase: resolvedPhase,
  current_step: 0, gemini_session_id: null, step_analyses: [],
  steps: chain.map((s, i) => ({
    index: i, cmd: s.cmd, args: s.args || '',
    status: 'pending', exec_id: null, analysis: null
  }))
};
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

### Step 6: Execute Step via maestro delegate

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

#### 6b: Build prompt from template + launch

Read `~/.maestro/templates/cli/prompts/coordinate-step.txt`, fill placeholders.
If previous step has analysis hints, inject as `{{ANALYSIS_HINTS}}`.

```javascript
const prompt = template
  .replace('{{COMMAND}}', `/${step.cmd}`)
  .replace('{{ARGS}}', assembledArgs)
  .replace('{{STEP_N}}', `${state.current_step + 1}/${state.steps.length}`)
  .replace('{{AUTO_DIRECTIVE}}', state.auto_mode ? 'Auto-confirm all prompts. No interactive questions.' : '')
  .replace('{{CHAIN_NAME}}', state.chain_name)
  .replace('{{ANALYSIS_HINTS}}', analysisHints);

Bash({
  command: `maestro delegate ${escapeForShell(prompt)} --to codex --mode write`,
  run_in_background: true, timeout: 600000
});
// ■ STOP — wait for hook callback
```

### Step 7: Post-Step Callback

```javascript
// Context propagation from output
const phaseMatch = output.match(/PHASE:\s*(\d+)/m);
if (phaseMatch) context.current_phase = phaseMatch[1];
const specMatch = output.match(/SPEC-[\w-]+/);
if (specMatch) context.spec_session_id = specMatch[0];
const scratchMatch = output.match(/scratch_dir:\s*(.+)/m);
if (scratchMatch) context.scratch_dir = scratchMatch[1].trim();

// Success/failure
const failed = /^STATUS:\s*FAILURE/m.test(output);
if (!failed) { step.status = 'completed'; }
else if (state.auto_mode && !step.retried) { step.retried = true; /* re-execute Step 6 */ return; }
else { step.status = 'skipped'; /* or AskUserQuestion: Retry / Skip / Abort */ }

Write(`${sessionDir}/step-${stepIdx + 1}-output.txt`, output);
// → Step 7b (gemini analysis) if completed + multi-step chain
// → else advance current_step, loop to Step 6 or Step 8
```

### Step 7b: Analyze Step Output (via gemini)

```javascript
let delegateCmd = `maestro delegate ${escapeForShell(analysisPrompt)} --to gemini --mode analysis --rule analysis-review-code-quality`;
if (state.gemini_session_id) delegateCmd += ` --resume ${state.gemini_session_id}`;
Bash({ command: delegateCmd, run_in_background: true, timeout: 300000 });
// ■ STOP — wait for hook callback
```

Post-analyze: store quality_score + issues + next_step_hints in `state.step_analyses[]`, chain gemini sessions via `--resume`.

### Step 8: Completion Report

```
============================================================
  MAESTRO-COORDINATE COMPLETE
============================================================
  Session: {session_id}
  Chain:   {chain_name} ({done}/{total})

  Steps:
    [✓] 1. maestro-plan — completed (quality: 85/100)
    [✓] 2. maestro-execute — completed (quality: 78/100)

  Avg Quality: {avg_score}/100
  Next: $maestro-coordinate --continue
============================================================
```
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Suggest $maestro-init |
| E002 | error | Clarity too low after 2 rounds | Ask to rephrase |
| E003 | error | Step failed + abort | Suggest resume with -c |
| E004 | error | Resume session not found | Show available sessions |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain selected via detectTaskType + chainMap
- [ ] Each step executed via `maestro delegate` with coordinate-step template
- [ ] Auto-confirm injected, structured return parsed
- [ ] Each completed step analyzed via `maestro delegate --to gemini --mode analysis`
- [ ] Analysis hints injected into next step prompt via `{{ANALYSIS_HINTS}}`
- [ ] Gemini sessions chained via `--resume` for accumulated context
- [ ] Session state at .workflow/.maestro-coordinate/{session_id}/
- [ ] Completion report with per-step status and quality scores
</success_criteria>
