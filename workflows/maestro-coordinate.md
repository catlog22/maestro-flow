# Workflow: maestro-coordinate

Autonomous CLI coordinator. Classifies intent, selects command chain, executes each step via `maestro cli` with template-driven prompts and async state machine.

---

### Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const autoYes = /\b(-y|--yes)\b/.test(args);
const resumeMode = /\b(-c|--continue)\b/.test(args);
const dryRun = /\b--dry-run\b/.test(args);
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'claude';
const intent = args
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

**If resumeMode:**
1. Find latest `state.json` in `.workflow/.maestro-coordinate/`
2. Load state → set `current_step` to first non-completed step
3. Jump to **Step 6**

---

### Step 2: Read Project State

```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

**If exists:** Read `.workflow/state.json` + `.workflow/roadmap.md` + current phase `index.json`:

```javascript
const projectState = {
  initialized: true,
  current_phase: /* from state.json */,
  phase_slug: '...',
  phase_status: '...', // pending|exploring|planning|executing|verifying|testing|completed|blocked
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

### Step 3: Classify Intent & Select Chain

#### 3a: Detect task type

If `forcedChain` is set, validate and jump to **3c**.

```javascript
function detectTaskType(text) {
  const patterns = [
    ['state_continue',    /^(continue|next|go|继续|下一步)$/i],
    ['status',            /^(status|状态|dashboard)$/i],
    ['spec_generate',     /spec.*(generat|creat|build)|PRD|产品.*规格/i],
    ['brainstorm',        /brainstorm|ideate|头脑风暴|发散/i],
    ['analyze',           /analy[sz]e|feasib|evaluat|assess|discuss|分析|评估|讨论/i],
    ['ui_design',         /ui.*design|design.*ui|prototype|设计.*原型|UI.*风格/i],
    ['init',              /init|setup.*project|初始化|新项目/i],
    ['plan',              /plan(?!.*gap)|break.*down|规划|分解/i],
    ['execute',           /execute|implement|build|develop|code|实现|开发/i],
    ['verify',            /verif[iy]|validate.*result|验证|校验/i],
    ['review',            /\breview.*code|code.*review|代码.*审查/i],
    ['test_gen',          /test.*gen|generat.*test|add.*test|写测试/i],
    ['test',              /\btest|uat|测试|验收/i],
    ['debug',             /debug|diagnos|troubleshoot|fix.*bug|调试|排查/i],
    ['integration_test',  /integrat.*test|e2e|集成测试/i],
    ['refactor',          /refactor|tech.*debt|重构|技术债/i],
    ['sync',              /sync.*doc|refresh.*doc|同步/i],
    ['phase_transition',  /phase.*transit|next.*phase|推进|切换.*阶段/i],
    ['phase_add',         /phase.*add|add.*phase|添加.*阶段/i],
    ['milestone_audit',   /milestone.*audit|里程碑.*审计/i],
    ['milestone_complete',/milestone.*compl|完成.*里程碑/i],
    ['issue_analyze',     /analyze.*issue|issue.*root.*cause/i],
    ['issue_plan',        /plan.*issue|issue.*solution/i],
    ['issue_execute',     /execute.*issue|run.*issue/i],
    ['issue',             /issue|问题|缺陷|discover.*issue/i],
    ['codebase_rebuild',  /codebase.*rebuild|重建.*文档/i],
    ['codebase_refresh',  /codebase.*refresh|刷新.*文档/i],
    ['spec_setup',        /spec.*setup|规范.*初始化/i],
    ['spec_add',          /spec.*add|添加.*规范/i],
    ['spec_load',         /spec.*load|加载.*规范/i],
    ['spec_map',          /spec.*map|规范.*映射/i],
    ['memory_capture',    /memory.*captur|save.*memory|compact/i],
    ['memory',            /memory|manage.*mem|记忆/i],
    ['team_lifecycle',    /team.*lifecycle|团队.*生命周期/i],
    ['team_coordinate',   /team.*coordinat|团队.*协调/i],
    ['team_qa',           /team.*(qa|quality)|团队.*质量/i],
    ['team_test',         /team.*test|团队.*测试/i],
    ['team_review',       /team.*review|团队.*评审/i],
    ['team_tech_debt',    /team.*tech.*debt|团队.*技术债/i],
    ['quick',             /quick|small.*task|ad.?hoc|简单|快速/i],
  ];
  for (const [type, pat] of patterns) { if (pat.test(text)) return type; }
  return 'quick'; // fallback
}
```

Compute clarity (3=verb+object+scope, 2=verb+object, 1=vague, 0=empty).
If clarity < 2 and not autoYes: clarify via AskUserQuestion (max 2 rounds).

#### 3b: State-based routing (task_type == `state_continue`)

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
      if (s.uat_status === 'passed') return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
      return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
    }
    return { chain: 'quality-loop-partial', steps: [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }] };
  }
  if (ps === 'testing') {
    if (s.uat_status === 'passed') return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
    return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
  }
  if (ps === 'completed') {
    if (s.phases_completed >= s.phases_total) return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
  }
  if (ps === 'blocked') return { chain: 'debug', steps: [{ cmd: 'quality-debug' }] };
  return { chain: 'status', steps: [{ cmd: 'manage-status' }] };
}
```

#### 3c: Intent-based chain map

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
  'sync':               [{ cmd: 'quality-sync', args: '{phase}' }],
  'phase_transition':   [{ cmd: 'maestro-phase-transition' }],
  'phase_add':          [{ cmd: 'maestro-phase-add', args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
  'spec_map':           [{ cmd: 'spec-map' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture', args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'manage-issue-analyze', args: '"{description}"' }],
  'issue_plan':         [{ cmd: 'manage-issue-plan', args: '"{description}"' }],
  'issue_execute':      [{ cmd: 'manage-issue-execute', args: '"{description}"' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4', args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance', args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing', args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review', args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt', args: '"{description}"' }],

  // Multi-step chains
  'spec-driven':     [{ cmd: 'maestro-init' }, { cmd: 'maestro-spec-generate', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven': [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven': [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'full-lifecycle':  [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-phase-transition' }],
  'execute-verify':  [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':    [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close': [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap-driven': [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'next-milestone': [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
};

// Aliases
const taskToChain = { 'spec_generate': 'spec-driven', 'brainstorm': 'brainstorm-driven' };
```

**Resolution order:**
1. `forcedChain` → `chainMap[forcedChain]`
2. `state_continue` → `detectNextAction(projectState)`
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

#### 3d: Resolve phase number

```javascript
function resolvePhase() {
  const m = intent.match(/phase\s*(\d+)|^(\d+)$/);
  if (m) return m[1] || m[2];
  if (projectState.initialized) return projectState.current_phase;
  return null;
}
```

---

### Step 4: Confirm

**If `dryRun`:** Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name} (dry run)
  1. [{cmd}] {args}
  2. [{cmd}] {args}
```

**If not autoYes:** AskUserQuestion — Execute / Execute from step N / Cancel.

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
  tool: cliTool, auto_mode: autoYes, phase: resolvedPhase,
  current_step: 0,
  gemini_session_id: null,
  step_analyses: [],
  steps: chain.map((s, i) => ({
    index: i, cmd: s.cmd, args: s.args || '',
    status: 'pending', exec_id: null, analysis: null
  }))
};
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

const context = { current_phase: resolvedPhase, user_intent: intent, spec_session_id: null };
```

---

### Step 6: Execute Step via maestro cli

#### 6a: Assemble args

```javascript
const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y', 'maestro-ui-design': '-y',
  'maestro-plan': '--auto', 'maestro-spec-generate': '-y', 'quality-test': '--auto-fix',
};

function assembleArgs(step) {
  let a = (step.args || '')
    .replace(/\{phase\}/g, context.current_phase || '')
    .replace(/\{description\}/g, context.user_intent || '')
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

#### 6c: Launch

```
------------------------------------------------------------
  STEP {i+1}/{total}: {step.cmd}  |  Tool: {tool}
------------------------------------------------------------
```

```javascript
state.steps[state.current_step].status = 'running';
state.steps[state.current_step].started_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

Bash({
  command: `maestro cli -p ${escapeForShell(prompt)} --tool ${state.tool} --mode write`,
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

// Capture exec_id from stderr [MAESTRO_EXEC_ID=xxx]
step.exec_id = /* from callback */;
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
  // On Abort: state.status = 'aborted', save, exit
}

// Save output for analysis
Write(`${sessionDir}/step-${stepIdx + 1}-output.txt`, output);
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

// → Step 7b: Gemini analysis (skip if step failed/skipped or single-step chain)
if (step.status === 'completed' && state.steps.length > 1) {
  // → Step 7b
} else {
  // Skip analysis, advance directly
  state.current_step = stepIdx + 1;
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
  if (state.current_step < state.steps.length) { /* → Step 6 */ }
  else { /* → Step 8 */ }
}
```

---

### Step 7b: Analyze Step Output (via gemini)

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

let cliCommand = `maestro cli -p ${escapeForShell(analysisPrompt)} --tool gemini --mode analysis --rule analysis-review-code-quality`;
if (state.gemini_session_id) cliCommand += ` --resume ${state.gemini_session_id}`;
Bash({ command: cliCommand, run_in_background: true, timeout: 300000 });
// ■ STOP — wait for hook callback
```

### Step 7c: Post-Analyze Callback

```javascript
const analysisResult = /* parsed JSON from callback output */;

// Capture gemini session ID for resume chain
state.gemini_session_id = /* from callback stderr [MAESTRO_EXEC_ID=xxx] */;

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
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

if (state.current_step < state.steps.length) {
  // → Back to Step 6
} else {
  // → Step 8
}
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
  Tool:    {tool}

  Steps:
    [✓] 1. maestro-plan — completed (quality: 85/100)
    [✓] 2. maestro-execute — completed (quality: 78/100)

  Avg Quality: {avg_score}/100
  Next: /maestro-coordinate continue
============================================================
```

---

## Core Rules

1. **STOP after each `maestro cli` call** — background execution, wait for hook callback
2. **State machine** — advance via `current_step`, no sync loops for async operations
3. **Template-driven** — all steps use `coordinate-step.txt`, no per-command prompt assembly
4. **Context propagation** — parse PHASE / spec session ID / scratch_dir from each step output, feed to next step
5. **Tool fallback** — if `maestro cli` fails: retry with same tool once, then try `gemini` → `qwen`
6. **Auto-confirm injection** — `{{AUTO_DIRECTIVE}}` in template prevents blocking during background execution
7. **Resumable** — `-c` reads `state.json`, jumps to first pending step
8. **Gemini analysis after each step** — evaluate output quality via `maestro cli --tool gemini --mode analysis`, chained via `--resume`. Analysis generates `next_step_hints` injected into next step's prompt as `{{ANALYSIS_HINTS}}`
9. **Session capture** — after each gemini callback, capture exec_id → `gemini_session_id` for resume chain
10. **Analysis skip conditions** — skip gemini analysis for: failed/skipped steps, single-step chains
