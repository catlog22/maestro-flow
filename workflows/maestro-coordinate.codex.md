# Workflow: Maestro-coordinate (Codex CLI-Delegate Edition)

Autonomous CLI coordinator for Codex. Classifies intent, selects command chain, executes each step via `codex delegate` with template-driven prompts and async state machine. After each step, gemini evaluates output quality and generates optimization hints for subsequent steps.

> Referenced by: `~/.codex/skills/maestro-coordinate/SKILL.md`

---

## Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const autoYes = /\b(-y|--yes)\b/.test(args);
const resumeMode = /\b(-c|--continue)\b/.test(args);
const dryRun = /\b--dry-run\b/.test(args);
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'codex';
const intent = args
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

**If resumeMode:**
1. Find latest `status.json` in `.workflow/.maestro-coordinate/`
2. Load state → set `current_step` to first non-completed step
3. Jump to **Step 6**

---

## Step 2: Read Project State

```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

**If exists:** Read `.workflow/state.json` + `.workflow/roadmap.md` + current phase `index.json`:

```javascript
const projectState = {
  initialized: true,
  current_milestone: /* from state.json */,
  latest_artifact: /* last artifact in artifacts[] */,
  milestone_progress: '...', // derived from artifact registry
  phase_artifacts: { brainstorm: false, analysis: false, context: false, plan: false, verification: false, uat: false },
  execution: { tasks_completed: 0, tasks_total: 0 },
  verification_status: 'pending',
  review_verdict: null, // PASS|WARN|BLOCK|null
  uat_status: 'pending',
  phases_total: 0, phases_completed: 0,
  has_blockers: false, accumulated_context: null
};
```

**If missing:** `projectState = { initialized: false }`. If intent also empty → **Error E001**.

---

## Step 3: Classify Intent & Select Chain

### 3a: Exact-match keywords (fast path)

If `forcedChain` is set, validate and jump to **3c**.

```javascript
const exactMatch = {
  'continue': 'state_continue', 'next': 'state_continue', 'go': 'state_continue',
  '继续': 'state_continue', '下一步': 'state_continue',
  'status': 'status', '状态': 'status', 'dashboard': 'status',
};
const normalized = intent.toLowerCase().trim();
if (exactMatch[normalized]) {
  taskType = exactMatch[normalized];
  // → skip to 3c
}
```

### 3a-2: Structured intent extraction (LLM-native)

Instead of regex, extract a structured intent tuple using LLM semantic understanding:

```json
{
  "action":    "<create|fix|analyze|plan|execute|verify|review|test|debug|refactor|explore|manage|transition|continue|sync|learn|retrospect>",
  "object":    "<feature|bug|issue|code|test|spec|phase|milestone|doc|performance|security|ui|memory|codebase|config>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low|normal|high>"
}
```

**Key disambiguation**: "问题"/"issue"/"problem" as something broken → `object: "bug"` (routes to debug). As a tracked item (with ISS-ID or management context) → `object: "issue"` (routes to issue management). When ambiguous, prefer `"bug"`.

### 3a-3: Route via action × object matrix

```javascript
function routeIntent(intent, projectState) {
  const { action, object, issue_id } = intent;

  // Hard signal: explicit issue ID → issue pipeline
  if (issue_id) {
    const issueRoutes = { 'analyze': 'issue_analyze', 'plan': 'issue_plan', 'fix': 'issue_execute', 'execute': 'issue_execute', 'debug': 'issue_analyze', 'manage': 'issue' };
    return issueRoutes[action] || 'issue';
  }

  // Action × Object matrix
  const matrix = {
    'fix':       { 'bug': 'debug', 'issue': 'issue', 'code': 'debug', 'performance': 'debug', 'security': 'debug', '_default': 'debug' },
    'create':    { 'feature': 'quick', 'issue': 'issue', 'test': 'test_gen', 'spec': 'spec_generate', 'ui': 'ui_design', 'config': 'init', 'phase': 'roadmap', '_default': 'quick' },
    'analyze':   { 'bug': 'analyze', 'issue': 'issue_analyze', 'code': 'analyze', 'codebase': 'spec_map', '_default': 'analyze' },
    'explore':   { 'issue': 'issue_discover', 'feature': 'brainstorm', 'ui': 'ui_design', '_default': 'brainstorm' },
    'plan':      { 'issue': 'issue_plan', 'spec': 'spec_generate', '_default': 'plan' },
    'execute':   { 'issue': 'issue_execute', '_default': 'execute' },
    'verify':    { '_default': 'verify' },
    'review':    { '_default': 'review' },
    'test':      { '_default': 'test' },
    'debug':     { '_default': 'debug' },
    'refactor':  { '_default': 'refactor' },
    'manage':    { 'issue': 'issue', 'milestone': 'milestone_audit', 'phase': 'milestone_close', 'memory': 'memory', 'doc': 'sync', 'codebase': 'codebase_refresh', '_default': 'status' },
    'transition':{ 'phase': 'milestone_close', 'milestone': 'milestone_complete', '_default': 'milestone_close' },
    'continue':  { '_default': 'state_continue' },
    'sync':      { '_default': 'sync' },
    'learn':     { '_default': 'learn' },
    'retrospect':{ '_default': 'retrospective' },
  };

  const actionMap = matrix[action] || matrix['fix'];
  return actionMap[object] || actionMap['_default'] || 'quick';
}
```

Compute clarity (3=action+object+scope, 2=action+object, 1=action only, 0=empty).
If clarity < 2 and not autoYes: clarify via AskUserQuestion (max 2 rounds).

### 3b: State-based routing (task_type == `state_continue`)

```javascript
function detectNextAction(s) {
  if (!s.initialized) return { chain: 'init', steps: [{ cmd: 'maestro-init' }] };
  const ps = s.phase_status, art = s.phase_artifacts, exec = s.execution;

  // Post-milestone: no roadmap, has accumulated context
  if (s.phases_total === 0 && !fileExists('.workflow/roadmap.md') && s.accumulated_context)
    return { chain: 'next-milestone', steps: [{ cmd: 'maestro-roadmap', args: '"{description}"' }] };
  if (s.phases_total === 0)
    return { chain: 'brainstorm-driven', steps: [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }] };

  if (ps === 'pending') {
    if (art.context) return { chain: 'plan', steps: [{ cmd: 'maestro-plan', args: '{phase}' }] };
    return { chain: 'analyze', steps: [{ cmd: 'maestro-analyze', args: '{phase}' }] };
  }
  if (ps === 'exploring' || ps === 'planning') {
    if (art.plan) return { chain: 'execute-verify', steps: [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }] };
    return { chain: 'plan', steps: [{ cmd: 'maestro-plan', args: '{phase}' }] };
  }
  if (ps === 'executing') {
    if (exec.tasks_completed >= exec.tasks_total && exec.tasks_total > 0) return { chain: 'verify', steps: [{ cmd: 'maestro-verify', args: '{phase}' }] };
    return { chain: 'execute', steps: [{ cmd: 'maestro-execute', args: '{phase}' }] };
  }
  if (ps === 'verifying') {
    if (s.verification_status === 'passed') {
      if (!s.review_verdict) return { chain: 'review', steps: [{ cmd: 'quality-review', args: '{phase}' }] };
      if (s.uat_status === 'pending') return { chain: 'test', steps: [{ cmd: 'quality-test', args: '{phase}' }] };
      if (s.uat_status === 'passed') return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
      return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
    }
    return { chain: 'quality-loop-partial', steps: [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }] };
  }
  if (ps === 'testing') {
    if (s.uat_status === 'passed') return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
  }
  if (ps === 'completed') {
    if (s.phases_completed >= s.phases_total) return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
  }
  if (ps === 'blocked') return { chain: 'debug', steps: [{ cmd: 'quality-debug' }] };
  return { chain: 'status', steps: [{ cmd: 'manage-status' }] };
}
```

### 3c: Intent-based chain map

```javascript
const chainMap = {
  // Single-step
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze', args: '{phase}' }],
  'ui_design':          [{ cmd: 'maestro-ui-design', args: '{phase}' }],
  'plan':               [{ cmd: 'maestro-plan', args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute', args: '{phase}' }],
  'verify':             [{ cmd: 'maestro-verify', args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-test-gen', args: '{phase}' }],
  'test':               [{ cmd: 'quality-test', args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug', args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-integration-test', args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor', args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review', args: '{phase}' }],
  'retrospective':      [{ cmd: 'quality-retrospective', args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn', args: '"{description}"' }],
  'sync':               [{ cmd: 'quality-sync', args: '{phase}' }],
  'milestone_close':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap':            [{ cmd: 'maestro-roadmap', args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture', args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute', args: '' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'fork':               [{ cmd: 'maestro-fork', args: '-m {milestone_num}' }],
  'merge':              [{ cmd: 'maestro-merge', args: '-m {milestone_num}' }],
  // Multi-step chains
  'spec-driven':     [{ cmd: 'maestro-init' }, { cmd: 'maestro-spec-generate', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven': [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven': [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'full-lifecycle':  [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'execute-verify':  [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':    [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close': [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap-driven': [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'next-milestone': [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
  // Issue lifecycle chains (with quality gates)
  'issue-full': [{ cmd: 'maestro-analyze', args: '--gaps {issue_id}' }, { cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'quality-review', args: '--scope {affected_files}' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
  'issue-quick': [{ cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
};

// Aliases: task type → named multi-step chain
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm': 'brainstorm-driven',
  'issue_execute': 'issue-full',    // issue execute always gets review gate
};
```

**Resolution order:**
1. `forcedChain` → `chainMap[forcedChain]`
2. `state_continue` → `detectNextAction(projectState)`
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

### 3d: Resolve phase number and issue ID

```javascript
function resolvePhase() {
  // From structured extraction
  if (intentAnalysis.phase_ref) return intentAnalysis.phase_ref;
  // Fallback regex
  const m = intent.match(/phase\s*(\d+)|^(\d+)$/);
  if (m) return m[1] || m[2];
  // With scratch-based architecture, commands default to milestone-wide when no phase specified
  return null;
}

function resolveIssueId() {
  if (intentAnalysis.issue_id) return intentAnalysis.issue_id;
  const m = intent.match(/ISS-[\w]+-\d+/i);
  return m ? m[0] : null;
}
```

When executing issue chains, replace `{issue_id}` in step args with the resolved issue ID.

---

## Step 4: Confirm

**If `dryRun`:** Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name} (dry run)
  1. [{cmd}] {args}
  2. [{cmd}] {args}
```

**If not autoYes:** AskUserQuestion — Execute / Execute from step N / Cancel.

---

## Step 5: Setup Session

```javascript
const sessionId = `coord-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;
Bash(`mkdir -p "${sessionDir}"`);

const state = {
  session_id: sessionId, status: 'running',
  created_at: new Date().toISOString(),
  intent, task_type: taskType, chain_name: chainName,
  tool: cliTool, auto_mode: autoYes, phase: resolvedPhase,
  current_step: 0,
  gemini_session_id: null,
  step_analyses: [],
  steps: chain.map((s, i) => ({
    index: i, skill: s.cmd, args: s.args || '',
    status: 'pending', exec_id: null, analysis: null
  }))
};
Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));

const context = { resolved_phase: resolvedPhase, user_intent: intent, issue_id: resolvedIssueId, spec_session_id: null };
```

---

## Step 6: Execute Step via codex delegate

### 6a: Assemble args

```javascript
const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y', 'maestro-ui-design': '-y',
  'maestro-plan': '--auto', 'maestro-spec-generate': '-y', 'quality-test': '--auto-fix',
  'quality-retrospective': '--auto-yes',
};

function assembleArgs(step) {
  let a = (step.args || '')
    .replace(/\{phase\}/g, context.resolved_phase || '')  // empty = milestone-wide default
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

### 6b: Build prompt from template

Read `~/.maestro/templates/cli/prompts/coordinate-step.txt`, fill placeholders.
If previous step has analysis hints, inject them as `{{ANALYSIS_HINTS}}`.

```javascript
function escapeForShell(str) { return "'" + str.replace(/'/g, "'\\''") + "'"; }

const assembledArgs = assembleArgs(step);
const template = Read('~/.maestro/templates/cli/prompts/coordinate-step.txt');

// Build analysis hints from previous step's gemini evaluation
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

### 6c: Launch via codex delegate

```
------------------------------------------------------------
  STEP {i+1}/{total}: {step.cmd}  |  Tool: {cliTool}
------------------------------------------------------------
```

```javascript
state.steps[state.current_step].status = 'running';
state.steps[state.current_step].started_at = new Date().toISOString();
Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));

Bash({
  command: `codex delegate ${escapeForShell(prompt)} --to ${state.tool} --mode write`,
  run_in_background: true, timeout: 600000
});
// ■ STOP — wait for hook callback
```

---

## Step 7: Post-Step Callback

```javascript
const stepIdx = state.current_step;
const step = state.steps[stepIdx];
const output = /* callback output */;

// Capture exec_id from stderr [CODEX_EXEC_ID=xxx]
step.exec_id = /* from callback */;
step.completed_at = new Date().toISOString();

// Context propagation
const phaseMatch = output.match(/PHASE:\s*(\d+)/m);
if (phaseMatch) context.resolved_phase = phaseMatch[1];
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
  // On Abort: state.status = 'aborted', save, exit
}

// Save output for analysis
Write(`${sessionDir}/step-${stepIdx + 1}-output.txt`, output);
Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));

// → Step 7b: Gemini analysis (skip if step failed/skipped or single-step chain)
if (step.status === 'completed' && state.steps.length > 1) {
  // → Step 7b
} else {
  // Skip analysis, advance directly
  state.current_step = stepIdx + 1;
  Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));
  if (state.current_step < state.steps.length) { /* → Step 6 */ }
  else { /* → Step 8 */ }
}
```

---

## Step 7b: Analyze Step Output (via gemini)

After each step completes, call gemini to evaluate execution quality and generate optimization hints for subsequent steps.

```javascript
const stepIdx = state.current_step;
const step = state.steps[stepIdx];
const output = Read(`${sessionDir}/step-${stepIdx + 1}-output.txt`);
const nextStep = stepIdx < state.steps.length - 1 ? state.steps[stepIdx + 1] : null;

// Build analysis prompt
const priorAnalyses = (state.step_analyses || [])
  .map(a => `- Step ${a.step_index + 1} (${a.cmd}): score=${a.quality_score}, issues=${a.issues?.length || 0}`)
  .join('\n');

const analysisPrompt = `PURPOSE: Evaluate execution quality of coordinate step "${step.cmd}" (${stepIdx + 1}/${state.steps.length}) and generate optimization hints for the next step.
CHAIN: ${state.chain_name} | Intent: ${state.intent}
COMMAND: /${step.cmd} ${step.args || ''}
STEP OUTPUT (last 200 lines):
${output.split('\n').slice(-200).join('\n')}
${priorAnalyses ? `PRIOR STEP ANALYSES:\n${priorAnalyses}` : ''}
${nextStep ? `NEXT STEP: /${nextStep.cmd} ${nextStep.args || ''}` : 'NEXT STEP: None (last step)'}
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

// Capture gemini session ID for resume chain
state.gemini_session_id = /* from callback stderr [CODEX_EXEC_ID=xxx] */;

// Store analysis
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
Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));

if (state.current_step < state.steps.length) {
  // → Back to Step 6
} else {
  // → Step 8
}
```

---

## Step 8: Completion Report

```javascript
const done = state.steps.filter(s => s.status === 'completed').length;
state.status = state.steps.some(s => s.status === 'failed') ? 'completed_with_errors' : 'completed';
state.completed_at = new Date().toISOString();
Write(`${sessionDir}/status.json`, JSON.stringify(state, null, 2));
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

## Core Rules

1. **Semantic routing** — LLM-native structured extraction (`action × object`) replaces regex; disambiguates "问题" by context
2. **STOP after each `codex delegate` call** — background execution, wait for hook callback
3. **State machine** — advance via `current_step`, no sync loops for async operations
4. **Template-driven** — all steps use `coordinate-step.txt`, no per-command prompt assembly
5. **Context propagation** — parse PHASE / spec session ID / scratch_dir / issue_id from each step output, feed to next step
6. **Quality gates** — issue chains auto-include review; `issue-full` is default for issue execution
7. **Tool fallback** — if `codex delegate` fails: retry with same tool once, then try `gemini` → `qwen`
8. **Auto-confirm injection** — `{{AUTO_DIRECTIVE}}` in template prevents blocking during background execution
9. **Resumable** — `-c` reads `status.json`, jumps to first pending step
10. **Gemini analysis after each step** — evaluate output quality via `codex delegate --to gemini --mode analysis`, chained via `--resume`. Analysis generates `next_step_hints` injected into next step's prompt as `{{ANALYSIS_HINTS}}`
11. **Session capture** — after each gemini callback, capture exec_id → `gemini_session_id` for resume chain
12. **Analysis skip conditions** — skip gemini analysis for: failed/skipped steps, single-step chains
