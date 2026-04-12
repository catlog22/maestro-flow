# Workflow: maestro-coordinate (Codex Edition)

Codex team-agent version of `maestro-coordinate`. Replaces `maestro cli` background execution + hook callbacks with synchronous `spawn_agent / wait / close_agent`. Each chain step assembles a prompt containing the skill invocation (`$skill-name args`) and spawns one agent; the analysis step spawns a second agent inline. All async state-machine concerns are eliminated.

> Referenced by: `~/.codex/skills/maestro-coordinate/SKILL.md`

---

## Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const AUTO_YES   = new RegExp('\\b(-y|--yes)\\b').test(args);
const RESUME     = new RegExp('\\b(-c|--continue)\\b').test(args);
const DRY_RUN    = new RegExp('\\b--dry-run\\b').test(args);
const forceChain = args.match(new RegExp('--chain\\s+(\\S+)'))?.[1] ?? null;
const intent = args
  .replace(new RegExp('\\b(-y|--yes|-c|--continue|--dry-run)\\b', 'g'), '')
  .replace(new RegExp('--(chain)\\s+\\S+', 'g'), '')
  .trim();
```

**Resume mode**: If `RESUME`:
1. Glob `.workflow/.maestro-coordinate/coord-*/state.json`, sort desc by name, load latest
2. Set `current_step` to index of first step where `status === "pending"`
3. Jump to **Step 6**

---

## Step 2: Read Project State

```javascript
const stateFile = '.workflow/state.json';
let projectState = { initialized: false };

if (fileExists(stateFile)) {
  const raw = JSON.parse(Read(stateFile));
  projectState = {
    initialized: true,
    current_phase: raw.current_phase,
    phase_slug: raw.phase_slug,
    phase_status: raw.phase_status,   // pending|exploring|planning|executing|verifying|testing|completed|blocked
    phase_artifacts: raw.phase_artifacts ?? {},
    execution: raw.execution ?? { tasks_completed: 0, tasks_total: 0 },
    verification_status: raw.verification_status ?? 'pending',
    review_verdict: raw.review_verdict ?? null,
    uat_status: raw.uat_status ?? 'pending',
    phases_total: raw.phases_total ?? 0,
    phases_completed: raw.phases_completed ?? 0,
    has_blockers: raw.has_blockers ?? false,
    accumulated_context: raw.accumulated_context ?? null
  };
}

if (!projectState.initialized && !intent) throw new Error('E001: No project state and no intent. Run $maestro-init first.');
```

---

## Step 3: Classify Intent & Select Chain

### 3a: Detect task type

If `forceChain` is set → validate against chainMap and jump to **3c**.

```javascript
function detectTaskType(text) {
  const patterns = [
    ['state_continue',    new RegExp('^(continue|next|go|继续|下一步)$', 'i')],
    ['status',            new RegExp('^(status|状态|dashboard)$', 'i')],
    ['spec_generate',     new RegExp('spec.*(generat|creat|build)|PRD|产品.*规格', 'i')],
    ['brainstorm',        new RegExp('brainstorm|ideate|头脑风暴|发散', 'i')],
    ['analyze',           new RegExp('analy[sz]e|feasib|evaluat|assess|discuss|分析|评估|讨论', 'i')],
    ['ui_design',         new RegExp('ui.*design|design.*ui|prototype|设计.*原型|UI.*风格', 'i')],
    ['init',              new RegExp('init|setup.*project|初始化|新项目', 'i')],
    ['plan',              new RegExp('plan(?!.*gap)|break.*down|规划|分解', 'i')],
    ['execute',           new RegExp('execute|implement|build|develop|code|实现|开发', 'i')],
    ['verify',            new RegExp('verif[iy]|validate.*result|验证|校验', 'i')],
    ['review',            new RegExp('\\breview.*code|code.*review|代码.*审查', 'i')],
    ['retrospective',     new RegExp('retrospect|retro|复盘|post.?mortem|lessons.*learn|after.?action', 'i')],
    ['learn',             new RegExp('^learn\\b|capture.*insight|capture.*learning|insight.*log|eureka|学习.*记录|记录.*洞察', 'i')],
    ['test_gen',          new RegExp('test.*gen|generat.*test|add.*test|写测试', 'i')],
    ['test',              new RegExp('\\btest|uat|测试|验收', 'i')],
    ['debug',             new RegExp('debug|diagnos|troubleshoot|fix.*bug|调试|排查', 'i')],
    ['integration_test',  new RegExp('integrat.*test|e2e|集成测试', 'i')],
    ['refactor',          new RegExp('refactor|tech.*debt|重构|技术债', 'i')],
    ['sync',              new RegExp('sync.*doc|refresh.*doc|同步', 'i')],
    ['phase_transition',  new RegExp('phase.*transit|next.*phase|推进|切换.*阶段', 'i')],
    ['phase_add',         new RegExp('phase.*add|add.*phase|添加.*阶段', 'i')],
    ['milestone_audit',   new RegExp('milestone.*audit|里程碑.*审计', 'i')],
    ['milestone_complete',new RegExp('milestone.*compl|完成.*里程碑', 'i')],
    ['issue_analyze',     new RegExp('analyze.*issue|issue.*root.*cause', 'i')],
    ['issue_plan',        new RegExp('plan.*issue|issue.*solution', 'i')],
    ['issue_execute',     new RegExp('execute.*issue|run.*issue', 'i')],
    ['issue',             new RegExp('issue|问题|缺陷|discover.*issue', 'i')],
    ['codebase_rebuild',  new RegExp('codebase.*rebuild|重建.*文档', 'i')],
    ['codebase_refresh',  new RegExp('codebase.*refresh|刷新.*文档', 'i')],
    ['spec_setup',        new RegExp('spec.*setup|规范.*初始化', 'i')],
    ['spec_add',          new RegExp('spec.*add|添加.*规范', 'i')],
    ['spec_load',         new RegExp('spec.*load|加载.*规范', 'i')],
    ['spec_map',          new RegExp('spec.*map|规范.*映射', 'i')],
    ['memory_capture',    new RegExp('memory.*captur|save.*memory|compact', 'i')],
    ['memory',            new RegExp('memory|manage.*mem|记忆', 'i')],
    ['team_lifecycle',    new RegExp('team.*lifecycle|团队.*生命周期', 'i')],
    ['team_coordinate',   new RegExp('team.*coordinat|团队.*协调', 'i')],
    ['team_qa',           new RegExp('team.*(qa|quality)|团队.*质量', 'i')],
    ['team_test',         new RegExp('team.*test|团队.*测试', 'i')],
    ['team_review',       new RegExp('team.*review|团队.*评审', 'i')],
    ['team_tech_debt',    new RegExp('team.*tech.*debt|团队.*技术债', 'i')],
    ['quick',             new RegExp('quick|small.*task|ad.?hoc|简单|快速', 'i')],
  ];
  for (const [type, pat] of patterns) if (pat.test(text)) return type;
  return 'quick';
}
```

**Clarity scoring**: 3 = verb+object+scope, 2 = verb+object, 1 = vague, 0 = empty.
If `clarity < 2` and not `AUTO_YES`: call `functions.request_user_input` with one focused question (max 2 rounds).

### 3b: State-based routing (when `taskType === 'state_continue'`)

```javascript
function detectNextAction(s) {
  if (!s.initialized) return { chain: 'init', steps: [{ cmd: 'maestro-init' }] };
  const ps = s.phase_status, art = s.phase_artifacts, exec = s.execution;

  if (s.phases_total === 0 && !fileExists('.workflow/roadmap.md') && s.accumulated_context)
    return { chain: 'next-milestone', steps: [{ cmd: 'maestro-roadmap', args: '"{description}"' }] };
  if (s.phases_total === 0)
    return { chain: 'brainstorm-driven', steps: [
      { cmd: 'maestro-brainstorm', args: '"{description}"' },
      { cmd: 'maestro-plan',       args: '{phase}' },
      { cmd: 'maestro-execute',    args: '{phase}' },
      { cmd: 'maestro-verify',     args: '{phase}' }
    ]};

  if (ps === 'pending') {
    if (art.context) return { chain: 'plan',    steps: [{ cmd: 'maestro-plan',    args: '{phase}' }] };
    return             { chain: 'analyze',  steps: [{ cmd: 'maestro-analyze', args: '{phase}' }] };
  }
  if (ps === 'exploring' || ps === 'planning') {
    if (art.plan) return { chain: 'execute-verify', steps: [
      { cmd: 'maestro-execute', args: '{phase}' },
      { cmd: 'maestro-verify',  args: '{phase}' }
    ]};
    return { chain: 'plan', steps: [{ cmd: 'maestro-plan', args: '{phase}' }] };
  }
  if (ps === 'executing') {
    if (exec.tasks_completed >= exec.tasks_total && exec.tasks_total > 0)
      return { chain: 'verify', steps: [{ cmd: 'maestro-verify', args: '{phase}' }] };
    return { chain: 'execute', steps: [{ cmd: 'maestro-execute', args: '{phase}' }] };
  }
  if (ps === 'verifying') {
    if (s.verification_status === 'passed') {
      if (!s.review_verdict)          return { chain: 'review',           steps: [{ cmd: 'quality-review',   args: '{phase}' }] };
      if (s.uat_status === 'pending') return { chain: 'test',             steps: [{ cmd: 'quality-test',     args: '{phase}' }] };
      if (s.uat_status === 'passed')  return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
      return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
    }
    return { chain: 'quality-loop-partial', steps: [
      { cmd: 'maestro-plan',    args: '{phase} --gaps' },
      { cmd: 'maestro-execute', args: '{phase}' },
      { cmd: 'maestro-verify',  args: '{phase}' }
    ]};
  }
  if (ps === 'testing') {
    if (s.uat_status === 'passed') return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
    return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
  }
  if (ps === 'completed') {
    if (s.phases_completed >= s.phases_total)
      return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'phase-transition', steps: [{ cmd: 'maestro-phase-transition' }] };
  }
  if (ps === 'blocked') return { chain: 'debug', steps: [{ cmd: 'quality-debug' }] };
  return { chain: 'status', steps: [{ cmd: 'manage-status' }] };
}
```

### 3c: Intent-based chain map

```javascript
const chainMap = {
  // ── Single-step ──────────────────────────────────────────────────────────
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze',        args: '{phase}' }],
  'ui_design':          [{ cmd: 'maestro-ui-design',       args: '{phase}' }],
  'plan':               [{ cmd: 'maestro-plan',            args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute',         args: '{phase}' }],
  'verify':             [{ cmd: 'maestro-verify',          args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-test-gen',        args: '{phase}' }],
  'test':               [{ cmd: 'quality-test',            args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug',           args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-integration-test',args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor',        args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review',          args: '{phase}' }],
  'retrospective':      [{ cmd: 'quality-retrospective',   args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn',            args: '"{description}"' }],
  'sync':               [{ cmd: 'quality-sync',            args: '{phase}' }],
  'phase_transition':   [{ cmd: 'maestro-phase-transition' }],
  'phase_add':          [{ cmd: 'maestro-phase-add',       args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add',                args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load',               args: '"{description}"' }],
  'spec_map':           [{ cmd: 'spec-map' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture',   args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory',           args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue',            args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'manage-issue-analyze',    args: '"{description}"' }],
  'issue_plan':         [{ cmd: 'manage-issue-plan',       args: '"{description}"' }],
  'issue_execute':      [{ cmd: 'manage-issue-execute',    args: '"{description}"' }],
  'quick':              [{ cmd: 'maestro-quick',           args: '"{description}"' }],
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4',       args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate',         args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance',  args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing',            args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review',             args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt',          args: '"{description}"' }],

  // ── Multi-step chains ────────────────────────────────────────────────────
  'spec-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-spec-generate', args: '"{description}"' },
    { cmd: 'maestro-plan',          args: '{phase}' },
    { cmd: 'maestro-execute',       args: '{phase}' },
    { cmd: 'maestro-verify',        args: '{phase}' }
  ],
  'brainstorm-driven': [
    { cmd: 'maestro-brainstorm', args: '"{description}"' },
    { cmd: 'maestro-plan',       args: '{phase}' },
    { cmd: 'maestro-execute',    args: '{phase}' },
    { cmd: 'maestro-verify',     args: '{phase}' }
  ],
  'ui-design-driven': [
    { cmd: 'maestro-ui-design', args: '{phase}' },
    { cmd: 'maestro-plan',      args: '{phase}' },
    { cmd: 'maestro-execute',   args: '{phase}' },
    { cmd: 'maestro-verify',    args: '{phase}' }
  ],
  'full-lifecycle': [
    { cmd: 'maestro-plan',          args: '{phase}' },
    { cmd: 'maestro-execute',       args: '{phase}' },
    { cmd: 'maestro-verify',        args: '{phase}' },
    { cmd: 'quality-review',        args: '{phase}' },
    { cmd: 'quality-test',          args: '{phase}' },
    { cmd: 'maestro-phase-transition' }
  ],
  'execute-verify': [
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify',  args: '{phase}' }
  ],
  'quality-loop': [
    { cmd: 'maestro-verify',   args: '{phase}' },
    { cmd: 'quality-review',   args: '{phase}' },
    { cmd: 'quality-test',     args: '{phase}' },
    { cmd: 'quality-debug',    args: '--from-uat {phase}' },
    { cmd: 'maestro-plan',     args: '{phase} --gaps' },
    { cmd: 'maestro-execute',  args: '{phase}' }
  ],
  'milestone-close': [
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-complete' }
  ],
  'roadmap-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-roadmap',  args: '"{description}"' },
    { cmd: 'maestro-plan',     args: '{phase}' },
    { cmd: 'maestro-execute',  args: '{phase}' },
    { cmd: 'maestro-verify',   args: '{phase}' }
  ],
  'next-milestone': [
    { cmd: 'maestro-roadmap',  args: '"{description}"' },
    { cmd: 'maestro-plan',     args: '{phase}' },
    { cmd: 'maestro-execute',  args: '{phase}' },
    { cmd: 'maestro-verify',   args: '{phase}' }
  ],
  'analyze-plan-execute': [
    { cmd: 'maestro-analyze', args: '"{description}" -q' },
    { cmd: 'maestro-plan',    args: '--dir {scratch_dir}' },
    { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }
  ],

  // ── SKILL.md simplified aliases (--chain <name> shortcuts) ───────────────
  'feature': [
    { cmd: 'maestro-plan',    args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify',  args: '{phase}' }
  ],
  'quality-fix': [
    { cmd: 'manage-issue-analyze', args: '"{description}"' },
    { cmd: 'manage-issue-execute', args: '"{description}"' },
    { cmd: 'maestro-verify',       args: '{phase}' }
  ],
  'deploy': [
    { cmd: 'maestro-verify',  args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' }
  ],
};

// Aliases: task type → named chain
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm':    'brainstorm-driven'
};
```

**Resolution order:**
1. `forceChain` → `chainMap[forceChain]` (E002 if not found)
2. `state_continue` → `detectNextAction(projectState)`
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

### 3d: Resolve phase and description

```javascript
function resolvePhase() {
  const m = intent.match(new RegExp('^(\\d+)$')) ?? intent.match(new RegExp('phase\\s*(\\d+)', 'i'));
  if (m) return m[1] ?? m[2];
  if (projectState.initialized) return projectState.current_phase;
  return null;
}

const resolvedPhase = resolvePhase();
const context = {
  current_phase: resolvedPhase,
  user_intent: intent,
  spec_session_id: null,
  scratch_dir: null
};
```

---

## Step 4: Confirm

**If `DRY_RUN`**: Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name}  (dry run)
  1. ${step.cmd} {step.args}
  2. ${step.cmd} {step.args}
  …
```

**If not `AUTO_YES`**: Ask user via `functions.request_user_input`:
- Execute all steps
- Execute from step N
- Cancel

---

## Step 5: Setup Session

```javascript
const ts = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('T', '').slice(0, 15);
const sessionId = `coord-${ts}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;
Bash(`mkdir -p "${sessionDir}"`);

const state = {
  session_id: sessionId,
  status: 'running',
  created_at: new Date().toISOString(),
  intent,
  task_type: taskType,
  chain_name: chainName,
  auto_yes: AUTO_YES,
  phase: resolvedPhase,
  current_step: 0,
  step_analyses: [],      // analysis results per step (for hints chaining)
  steps: chain.map((s, i) => ({
    index: i,
    cmd: s.cmd,
    args: s.args ?? '',
    status: 'pending',
    findings: null,
    quality_score: null,
    hints_for_next: null
  }))
};
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

---

## Step 6: Execute Step via spawn_agent

### 6a: Assemble args

```javascript
const AUTO_FLAG_MAP = {
  'maestro-analyze':        '-y',
  'maestro-brainstorm':     '-y',
  'maestro-ui-design':      '-y',
  'maestro-plan':           '--auto',
  'maestro-spec-generate':  '-y',
  'quality-test':           '--auto-fix',
  'quality-retrospective':  '--auto-yes',
};

function assembleArgs(step) {
  let a = (step.args ?? '')
    .replaceAll('{phase}',           context.current_phase   ?? '')
    .replaceAll('{description}',     context.user_intent     ?? '')
    .replaceAll('{spec_session_id}', context.spec_session_id ?? '')
    .replaceAll('{scratch_dir}',     context.scratch_dir     ?? '');

  if (AUTO_YES) {
    const flag = AUTO_FLAG_MAP[step.cmd];
    if (flag && !a.includes(flag)) a = a ? `${a} ${flag}` : flag;
  }
  return a.trim();
}
```

### 6b: Build analysis hints from previous step

```javascript
function buildAnalysisHints(stepIdx) {
  const prev = state.step_analyses.find(a => a.step_index === stepIdx - 1);
  if (!prev?.next_step_hints) return '';
  const h = prev.next_step_hints;
  const parts = [];
  if (h.prompt_additions)   parts.push(h.prompt_additions);
  if (h.cautions?.length)   parts.push('Cautions: ' + h.cautions.join('; '));
  if (h.context_to_carry)   parts.push('Context from prior step: ' + h.context_to_carry);
  return parts.join('\n');
}
```

### 6c: Assemble step prompt (replaces coordinate-step.txt template)

The prompt embeds the skill invocation so the agent knows exactly what to call:

```javascript
function buildStepPrompt(step, stepIdx, assembledArgs, analysisHints) {
  const skillCall = assembledArgs
    ? `$${step.cmd} ${assembledArgs}`
    : `$${step.cmd}`;

  return `## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read: ~/.codex/agents/universal-executor.md
2. Read: ~/.codex/skills/${step.cmd}/SKILL.md

---

**Coordinate Step ${stepIdx + 1}/${state.steps.length}: ${step.cmd}**
Chain: ${state.chain_name}
Intent: ${state.intent}

## Skill Invocation
Execute this skill to complete your task:

  ${skillCall}

Follow the Implementation section of the skill file you loaded in step 2.
${AUTO_YES ? 'Auto mode: skip all confirmation prompts within the skill.' : ''}

${analysisHints ? `## Analysis Hints from Previous Step\n${analysisHints}\n` : ''}
## Output (required — last JSON block in your response)
\`\`\`json
{
  "status": "completed",
  "quality_score": <0-100>,
  "step_summary": "<what was accomplished — max 500 chars>",
  "phase_detected": <number or null>,
  "spec_session_id": "<if a spec session was created, else null>",
  "scratch_dir": "<if a scratch dir was created, else null>",
  "hints_for_next": "<specific guidance for the next chain step, or null>"
}
\`\`\`

Session artifacts: ${sessionDir}/`;
}
```

### 6d: Spawn, wait, close

```javascript
const step = state.steps[state.current_step];
const assembledArgs = assembleArgs(step);
const analysisHints = buildAnalysisHints(state.current_step);
const stepPrompt = buildStepPrompt(step, state.current_step, assembledArgs, analysisHints);

step.status = 'running';
step.started_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

const stepAgent = spawn_agent({ message: stepPrompt });

let result = wait({ ids: [stepAgent], timeout_ms: 600000 });
if (result.timed_out) {
  send_input({ id: stepAgent, message: "Please finalize and output your results JSON now." });
  result = wait({ ids: [stepAgent], timeout_ms: 120000 });
}

const rawOutput = result.status[stepAgent].completed ?? '';
close_agent({ id: stepAgent });

// Save raw output for analysis
Write(`${sessionDir}/step-${state.current_step + 1}-output.txt`, rawOutput);
```

---

## Step 7: Post-Step Processing

### 7a: Parse output and propagate context

```javascript
const output = parseLastJSON(rawOutput) ?? {
  status: result.timed_out ? 'failed' : 'completed',
  quality_score: null,
  step_summary: rawOutput.slice(-500),
  phase_detected: null,
  spec_session_id: null,
  scratch_dir: null,
  hints_for_next: null
};

// Propagate context to subsequent steps
if (output.phase_detected)    context.current_phase   = output.phase_detected;
if (output.spec_session_id)   context.spec_session_id = output.spec_session_id;
if (output.scratch_dir)       context.scratch_dir     = output.scratch_dir;

// Determine step outcome
const stepFailed = output.status === 'failed' || result.timed_out;

if (stepFailed && AUTO_YES && !step.retried) {
  // One auto-retry
  step.retried = true;
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
  // → back to Step 6d with same step
} else if (stepFailed && !AUTO_YES) {
  // Ask: Retry / Skip / Abort
  const choice = functions.request_user_input({
    id: 'step-failure',
    items: [{ type: 'text', text: `Step ${state.current_step + 1} (${step.cmd}) failed. Retry / Skip / Abort?` }]
  });
  if (choice === 'Retry') { /* → back to Step 6d */ }
  if (choice === 'Abort') {
    state.status = 'aborted';
    Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
    return; // exit
  }
  // Skip: fall through
  step.status = 'skipped';
} else if (stepFailed) {
  step.status = 'skipped';
} else {
  step.status = 'completed';
}

step.findings      = output.step_summary;
step.quality_score = output.quality_score;
step.hints_for_next= output.hints_for_next;
step.completed_at  = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

### 7b: Analyze step output (inline analysis agent)

Skip if: step failed/skipped **or** chain has only one step.

```javascript
if (step.status === 'completed' && state.steps.length > 1) {
  const nextStep = state.steps[state.current_step + 1] ?? null;
  const priorAnalysesSummary = state.step_analyses
    .map(a => `- Step ${a.step_index + 1} (${a.cmd}): score=${a.quality_score}, issues=${a.issues?.length ?? 0}`)
    .join('\n');

  const analysisPrompt = `## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read: ~/.codex/agents/cli-explore-agent.md

---

Goal: Evaluate execution quality of coordinate step and generate optimization hints for the next step.

Step: $${step.cmd} (step ${state.current_step + 1}/${state.steps.length})
Chain: ${state.chain_name} | Intent: ${state.intent}

Step output (last 200 lines):
${rawOutput.split('\n').slice(-200).join('\n')}

${priorAnalysesSummary ? `Prior step analyses:\n${priorAnalysesSummary}\n` : ''}
Next step: ${nextStep ? `$${nextStep.cmd} ${assembleArgs(nextStep)}` : 'None (last step)'}

## Output (strict JSON)
\`\`\`json
{
  "quality_score": <0-100>,
  "execution_assessment": {
    "success": <bool>,
    "completeness": "full|partial|minimal",
    "key_outputs": [],
    "missing_outputs": []
  },
  "issues": [{ "severity": "critical|high|medium|low", "description": "" }],
  "next_step_hints": {
    "prompt_additions": "<extra context or constraints to inject into next step prompt>",
    "cautions": ["<things next step should watch out for>"],
    "context_to_carry": "<key facts from this step that next step needs>"
  },
  "step_summary": ""
}
\`\`\``;

  const analysisAgent = spawn_agent({ message: analysisPrompt });
  let aResult = wait({ ids: [analysisAgent], timeout_ms: 300000 });
  if (aResult.timed_out) {
    send_input({ id: analysisAgent, message: "Finalize and output analysis JSON now." });
    aResult = wait({ ids: [analysisAgent], timeout_ms: 60000 });
  }
  close_agent({ id: analysisAgent });

  const analysis = parseLastJSON(aResult.status[analysisAgent].completed ?? '') ?? {};
  state.step_analyses.push({
    step_index: state.current_step,
    cmd: step.cmd,
    quality_score: analysis.quality_score,
    issues: analysis.issues,
    next_step_hints: analysis.next_step_hints,
    summary: analysis.step_summary
  });
  step.quality_score = analysis.quality_score ?? step.quality_score;
  Write(`${sessionDir}/step-${state.current_step + 1}-analysis.json`, JSON.stringify(analysis, null, 2));
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
}
```

### 7c: Advance

```javascript
state.current_step += 1;
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

if (state.current_step < state.steps.length) {
  // → back to Step 6
} else {
  // → Step 8
}
```

---

## Step 8: Completion Report

```javascript
const done    = state.steps.filter(s => s.status === 'completed').length;
const skipped = state.steps.filter(s => s.status === 'skipped').length;
const avgScore = state.step_analyses.length
  ? Math.round(state.step_analyses.reduce((s, a) => s + (a.quality_score ?? 0), 0) / state.step_analyses.length)
  : null;

state.status = state.steps.some(s => s.status === 'failed') ? 'completed_with_errors' : 'completed';
state.completed_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

Display:
```
============================================================
  MAESTRO-COORDINATE COMPLETE
============================================================
  Session:  {session_id}
  Chain:    {chain_name}  ({done}/{total} steps)

  Steps:
    [✓] 1. {cmd}  — completed  (quality: {score}/100)
    [✓] 2. {cmd}  — completed  (quality: {score}/100)
    [⚠] 3. {cmd}  — skipped

  Avg Quality:  {avgScore}/100
  Artifacts:    .workflow/.maestro-coordinate/{session_id}/

  Resume:  $maestro-coordinate --continue
============================================================
```

---

## Core Rules

1. **Sequential**: Advance `current_step` only after the current step agent is **closed** and state written
2. **Skill in prompt**: Every step agent's message MUST contain `$skill-name args` — this is the skill invocation
3. **MANDATORY FIRST STEPS**: Step agents read `universal-executor.md` + the target `SKILL.md`; analysis agents read `cli-explore-agent.md`
4. **Context propagation**: Parse `phase_detected`, `spec_session_id`, `scratch_dir` from each step's output JSON; feed into next step's `assembleArgs`
5. **Analysis hints chain**: `step_analyses[N].next_step_hints` → `buildAnalysisHints(N+1)` → injected into step N+1's prompt
6. **Timeout handling**: One `send_input` urge, then close agent regardless
7. **Auto-retry**: One silent retry if `AUTO_YES` and step fails; no retry in interactive mode
8. **State.json is source of truth**: Write after every state change; `--continue` reads it to resume
9. **Dry-run is read-only**: Display chain and exit — no agents spawned
10. **Analysis skip conditions**: Single-step chains and failed/skipped steps skip the analysis agent
