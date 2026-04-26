# Workflow: Maestro (Codex Edition)

CSV wave coordinator version of the intelligent coordinator. Replaces `spawn_agent / wait / close_agent` loop with `spawn_agents_on_csv` (max_workers=1) for sequential pipeline execution. Each chain step is a CSV row with `skill_call` column; agents read prior results from session directory for context propagation.

> Referenced by: `~/.codex/skills/maestro/SKILL.md`

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
    // Derive current_phase from artifacts (first in_progress execute, or first without completed execute)
    current_phase: (() => {
      const arts = raw.artifacts ?? [];
      const ip = arts.find(a => a.type === 'execute' && a.status === 'in_progress');
      if (ip) return ip.phase;
      const phases = [...new Set(arts.map(a => a.phase).filter(Boolean))].sort((a,b) => a - b);
      return phases.find(p => !arts.some(a => a.phase === p && a.type === 'execute' && a.status === 'completed')) ?? raw.current_phase ?? null;
    })(),
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

### 3a: Exact-match keywords (fast path)

If `forceChain` is set → validate against chainMap and jump to **3c**.

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
    'create':    { 'feature': 'quick', 'issue': 'issue', 'test': 'test_gen', 'spec': 'spec_generate', 'ui': 'ui_design', 'config': 'init', 'phase': 'phase_add', '_default': 'quick' },
    'analyze':   { 'bug': 'analyze', 'issue': 'issue_analyze', 'code': 'analyze', 'codebase': 'spec_map', '_default': 'analyze' },
    'explore':   { 'issue': 'issue_discover', 'feature': 'brainstorm', 'ui': 'ui_design', '_default': 'brainstorm' },
    'plan':      { 'issue': 'issue_plan', 'spec': 'spec_generate', '_default': 'plan' },
    'execute':   { 'issue': 'issue_execute', '_default': 'execute' },
    'verify':    { '_default': 'verify' },
    'review':    { '_default': 'review' },
    'test':      { '_default': 'test' },
    'debug':     { '_default': 'debug' },
    'refactor':  { '_default': 'refactor' },
    'manage':    { 'issue': 'issue', 'milestone': 'milestone_audit', 'phase': 'phase_transition', 'memory': 'memory', 'doc': 'sync', 'codebase': 'codebase_refresh', '_default': 'status' },
    'transition':{ 'phase': 'phase_transition', 'milestone': 'milestone_complete', '_default': 'phase_transition' },
    'continue':  { '_default': 'state_continue' },
    'sync':      { '_default': 'sync' },
    'learn':     { '_default': 'learn' },
    'retrospect':{ '_default': 'retrospective' },
  };

  const actionMap = matrix[action] || matrix['fix'];
  return actionMap[object] || actionMap['_default'] || 'quick';
}
```

**Clarity scoring**: 3 = action+object+scope, 2 = action+object, 1 = action only, 0 = empty.
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
      if (s.uat_status === 'passed')  return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
      return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
    }
    return { chain: 'quality-loop-partial', steps: [
      { cmd: 'maestro-plan',    args: '{phase} --gaps' },
      { cmd: 'maestro-execute', args: '{phase}' },
      { cmd: 'maestro-verify',  args: '{phase}' }
    ]};
  }
  if (ps === 'testing') {
    if (s.uat_status === 'passed') return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'debug', steps: [{ cmd: 'quality-debug', args: '--from-uat {phase}' }] };
  }
  if (ps === 'completed') {
    if (s.phases_completed >= s.phases_total)
      return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
    return { chain: 'milestone-close', steps: [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }] };
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
  'phase_transition':   [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'phase_add':          [{ cmd: 'maestro-phase-add',       args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add',                args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load',               args: '"{description}"' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture',   args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory',           args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue',            args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover',   args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze',          args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan',            args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute',         args: '' }],
  'quick':              [{ cmd: 'maestro-quick',           args: '"{description}"' }],
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
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-complete' }
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
    { cmd: 'maestro-analyze',      args: '--gaps "{description}"' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'maestro-verify',       args: '{phase}' }
  ],
  'deploy': [
    { cmd: 'maestro-verify',  args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' }
  ],

  // ── Issue lifecycle chains (with quality gates) ────────────────────────────
  'issue-full': [
    { cmd: 'maestro-analyze',      args: '--gaps {issue_id}' },
    { cmd: 'maestro-plan',         args: '--gaps' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'quality-review',       args: '--scope {affected_files}' },
    { cmd: 'manage-issue',         args: 'close {issue_id} --resolution fixed' }
  ],
  'issue-quick': [
    { cmd: 'maestro-plan',         args: '--gaps' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'manage-issue',         args: 'close {issue_id} --resolution fixed' }
  ],
};

// Aliases: task type → named chain
const taskToChain = {
  'spec_generate':  'spec-driven',
  'brainstorm':     'brainstorm-driven',
  'issue_execute':  'issue-full',    // issue execute always gets review gate
};
```

**Resolution order:**
1. `forceChain` → `chainMap[forceChain]` (E002 if not found)
2. `state_continue` → `detectNextAction(projectState)`
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

### 3d: Resolve phase, description, and issue ID

```javascript
function resolvePhase() {
  // From structured extraction
  if (intentAnalysis.phase_ref) return intentAnalysis.phase_ref;
  // Fallback regex
  const m = intent.match(new RegExp('^(\\d+)$')) ?? intent.match(new RegExp('phase\\s*(\\d+)', 'i'));
  if (m) return m[1] ?? m[2];
  if (projectState.initialized) return projectState.current_phase;
  return null;
}

function resolveIssueId() {
  if (intentAnalysis.issue_id) return intentAnalysis.issue_id;
  const m = intent.match(new RegExp('ISS-[\\w]+-\\d+', 'i'));
  return m ? m[0] : null;
}

const resolvedPhase = resolvePhase();
const resolvedIssueId = resolveIssueId();
const context = {
  current_phase: resolvedPhase,
  user_intent: intent,
  issue_id: resolvedIssueId,
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

const BARRIER_SKILLS = new Set([
  'maestro-analyze', 'maestro-plan', 'maestro-brainstorm',
  'maestro-spec-generate', 'maestro-execute'
]);

const AUTO_FLAG_MAP = {
  'maestro-analyze':        '-y',
  'maestro-brainstorm':     '-y',
  'maestro-ui-design':      '-y',
  'maestro-plan':           '--auto',
  'maestro-spec-generate':  '-y',
  'quality-test':           '--auto-fix',
  'quality-retrospective':  '--auto-yes',
};

const context = {
  phase: resolvedPhase,
  plan_dir: null,
  analysis_dir: null,
  brainstorm_dir: null,
  spec_session_id: null,
  issue_id: resolvedIssueId,
  gaps: null
};

const state = {
  session_id: sessionId,
  status: 'running',
  created_at: new Date().toISOString(),
  intent,
  task_type: taskType,
  chain_name: chainName,
  auto_yes: AUTO_YES,
  context,
  waves: [],
  steps: chain.map((s, i) => ({
    index: i,
    cmd: s.cmd,
    args: s.args ?? '',
    status: 'pending',
    wave_n: null,
    findings: null,
    artifacts: null
  }))
};
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

---

## Step 6: Wave Execution Loop

### 6a: Helper functions

```javascript
function buildSkillCall(step, ctx) {
  let a = (step.args ?? '')
    .replaceAll('{phase}',           ctx.phase ?? '')
    .replaceAll('{description}',     state.intent ?? '')
    .replaceAll('{issue_id}',        ctx.issue_id ?? '')
    .replaceAll('{plan_dir}',        ctx.plan_dir ?? '')
    .replaceAll('{analysis_dir}',    ctx.analysis_dir ?? '')
    .replaceAll('{brainstorm_dir}',  ctx.brainstorm_dir ?? '')
    .replaceAll('{spec_session_id}', ctx.spec_session_id ?? '')
    .replaceAll('{scratch_dir}',     ctx.scratch_dir ?? '');

  if (state.auto_yes) {
    const flag = AUTO_FLAG_MAP[step.cmd];
    if (flag && !a.includes(flag)) a = a ? `${a} ${flag}` : flag;
  }
  return `$${step.cmd} ${a}`.trim();
}

function buildNextWave(steps) {
  const pending = steps.filter(s => s.status === 'pending');
  if (!pending.length) return [];
  const first = pending[0];
  // Barrier skill → solo wave
  if (BARRIER_SKILLS.has(first.cmd)) return [first];
  // Group consecutive non-barriers
  const wave = [first];
  for (let i = 1; i < pending.length; i++) {
    if (BARRIER_SKILLS.has(pending[i].cmd)) break;
    wave.push(pending[i]);
  }
  return wave;
}
```

### 6b: Wave instruction template (simple)

```javascript
const WAVE_INSTRUCTION = `你是 CSV job 子 agent。

先原样执行这一段技能调用：
{skill_call}

然后基于结果完成这一行任务说明：
{topic}

限制：
- 不要修改 .workflow/.maestro-coordinate/ 下的 state 文件
- skill 内部有自己的 session 管理，按 skill SKILL.md 执行即可

最后必须调用 report_agent_job_result，返回 JSON：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","artifacts":"产物路径或空字符串","error":"失败原因或空字符串"}`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    skill_call: { type: "string" },
    summary: { type: "string" },
    artifacts: { type: "string" },
    error: { type: "string" }
  },
  required: ["status", "skill_call", "summary", "artifacts", "error"]
};
```

### 6c: Main loop

```javascript
let waveNum = 0;

while (state.steps.some(s => s.status === 'pending')) {
  waveNum++;
  const waveSteps = buildNextWave(state.steps);
  if (!waveSteps.length) break;

  // Build wave CSV — skill_call assembled with latest context
  const csvRows = waveSteps.map(step => {
    const skillCall = buildSkillCall(step, context);
    const topic = `Chain "${state.chain_name}" step ${step.index + 1}/${state.steps.length}`;
    return `"${step.index + 1}","${skillCall.replace(/"/g, '""')}","${topic.replace(/"/g, '""')}"`;
  });
  Write(`${sessionDir}/wave-${waveNum}.csv`, 'id,skill_call,topic\n' + csvRows.join('\n'));

  // Execute wave
  spawn_agents_on_csv({
    csv_path: `${sessionDir}/wave-${waveNum}.csv`,
    id_column: "id",
    instruction: WAVE_INSTRUCTION,
    max_workers: waveSteps.length,   // parallel for non-barriers, 1 for barriers
    max_runtime_seconds: 1800,
    output_csv_path: `${sessionDir}/wave-${waveNum}-results.csv`,
    output_schema: RESULT_SCHEMA
  });

  // Read results
  const results = parseCSV(Read(`${sessionDir}/wave-${waveNum}-results.csv`));

  // Update step status
  for (const row of results) {
    const step = state.steps[parseInt(row.id) - 1];
    step.status = row.status;
    step.findings = row.summary;
    step.artifacts = row.artifacts;
    step.wave_n = waveNum;
    step.completed_at = new Date().toISOString();
  }

  // Barrier analysis — coordinator reads artifacts, updates context
  if (waveSteps.length === 1 && BARRIER_SKILLS.has(waveSteps[0].cmd)) {
    analyzeBarrierArtifacts(waveSteps[0], results[0], context);
  }

  // Record wave
  state.waves.push({ wave_n: waveNum, step_ids: waveSteps.map(s => s.index + 1) });
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

  // Abort on failure
  if (results.some(r => r.status === 'failed')) {
    state.status = 'aborted';
    state.steps.filter(s => s.status === 'pending').forEach(s => { s.status = 'skipped'; });
    Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
    break;
  }
}
```

---

## Step 7: Barrier Artifact Analysis

After a barrier skill completes, the coordinator reads its artifacts and updates `context` for subsequent waves:

```javascript
function analyzeBarrierArtifacts(step, result, ctx) {
  const artifactPath = result.artifacts;
  if (!artifactPath) return;

  switch (step.cmd) {
    case 'maestro-analyze': {
      // Read analysis conclusions → extract gaps, phase
      ctx.analysis_dir = artifactPath;
      const contextMd = Read(`${artifactPath}/context.md`);
      // Extract gap markers
      const gapLines = contextMd.match(/^[-*]\s.*gap|issue|problem.*/gmi);
      if (gapLines) ctx.gaps = gapLines.join('; ').slice(0, 500);
      // Extract phase if detected
      const phaseMatch = contextMd.match(/phase\s*[:=]\s*(\d+)/i);
      if (phaseMatch && !ctx.phase) ctx.phase = phaseMatch[1];
      break;
    }
    case 'maestro-plan': {
      // Read plan.json → know task count and structure
      ctx.plan_dir = artifactPath;
      if (fileExists(`${artifactPath}/plan.json`)) {
        const plan = JSON.parse(Read(`${artifactPath}/plan.json`));
        ctx.task_count = plan.tasks?.length ?? 0;
        ctx.wave_count = plan.waves?.length ?? 0;
      }
      break;
    }
    case 'maestro-brainstorm': {
      ctx.brainstorm_dir = artifactPath;
      break;
    }
    case 'maestro-spec-generate': {
      ctx.spec_session_id = artifactPath.match(/SPEC-[\w-]+/)?.[0] ?? artifactPath;
      break;
    }
    case 'maestro-execute': {
      // Read execution results for verify context
      if (fileExists(`${artifactPath}/results.csv`)) {
        const execResults = parseCSV(Read(`${artifactPath}/results.csv`));
        ctx.exec_completed = execResults.filter(r => r.status === 'completed').length;
        ctx.exec_failed = execResults.filter(r => r.status === 'failed').length;
      }
      break;
    }
  }
}
```

**Key principle**: The coordinator owns all context assembly. Sub-agents receive a fully-resolved `skill_call` — they don't need to discover or resolve anything themselves.

---

## Step 8: Completion Report

```javascript
const done = state.steps.filter(s => s.status === 'completed').length;
const failed = state.steps.filter(s => s.status === 'failed').length;
const total = state.steps.length;

state.status = state.steps.every(s => s.status === 'completed') ? 'completed' : state.status;
state.completed_at = new Date().toISOString();
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
```

Generate `context.md`:

```markdown
# Coordinate Report — {chainName}

## Summary
- Session: {sessionId}
- Chain: {chainName}
- Waves: {waveNum} executed
- Steps: {done}/{total} completed, {failed} failed

## Wave Results
### Wave {N}
| Step | Skill Call | Status | Summary |
|------|-----------|--------|---------|
| {index+1} | {skill_call} | {status} | {summary} |

Context update: {what changed in ctx}
```

Display:

```
============================================================
  MAESTRO-COORDINATE COMPLETE
============================================================
  Session:  {session_id}
  Chain:    {chain_name}
  Waves:    {waveNum} executed
  Steps:    {done}/{total}

  WAVE RESULTS:
    [W1] $maestro-analyze --gaps  →  ✓  found 3 gaps
    [W2] $maestro-plan --gaps     →  ✓  12 tasks in 3 waves
    [W3] $maestro-execute         →  ✓  12/12 tasks done
    [W4] $maestro-verify          →  ✓  all criteria met

  Artifacts:  .workflow/.maestro-coordinate/{session_id}/
  Resume:     $maestro --continue
============================================================
```

---

## Core Rules

1. **Semantic routing**: LLM-native structured extraction (`action × object`) replaces regex; disambiguates "问题" by context
2. **Wave-by-wave**: Never start wave N+1 before wave N results are read and barrier artifacts analyzed
3. **Barrier = solo wave**: A barrier skill always executes alone; coordinator analyzes its artifacts before proceeding
4. **Non-barriers can parallel**: Consecutive non-barrier skills share a wave with `max_workers = N`
5. **Coordinator owns context**: Sub-agents receive fully-resolved `skill_call` — no context discovery needed
6. **Simple instruction**: Sub-agent instruction is minimal — "execute {skill_call}, report result"
7. **Quality gates**: Issue chains auto-include review; `issue-full` is default for issue execution
8. **report_agent_job_result**: Every agent MUST call this with the output schema
9. **State.json tracks waves**: Each wave recorded with step IDs and results; `--continue` resumes from next pending
10. **Dry-run is read-only**: Display chain with [BARRIER] markers, no execution
11. **Abort on failure**: Failed step → skip remaining → report
