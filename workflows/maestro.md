# Workflow: maestro

Intelligent coordinator that routes user intent to optimal command chain based on project state.
Dual execution engines: **Skill()** (in-process, synchronous) and **CLI delegate** (via `maestro delegate`, async with gemini quality analysis).
Default `auto` mode selects engine based on chain complexity.

**Prerequisites:**
- None for initial invocation (can bootstrap)
- `continue`/`next`: `.workflow/state.json` must exist
- `-c` (resume): `.workflow/.maestro/*/status.json` must exist

## Step 1: Parse & Initialize

### 1a: Parse arguments

```javascript
const autoYes = /\b(-y|--yes)\b/.test($ARGUMENTS)
const resumeMode = /\b(-c|--continue)\b/.test($ARGUMENTS)
const dryRun = /\b--dry-run\b/.test($ARGUMENTS)
const forcedChain = $ARGUMENTS.match(/--chain\s+(\S+)/)?.[1] || null
const execMode = $ARGUMENTS.match(/--exec\s+(auto|cli|skill)/)?.[1] || 'auto'
const cliTool = $ARGUMENTS.match(/--tool\s+(\S+)/)?.[1] || 'claude'
const intent = $ARGUMENTS
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--chain\s+\S+/g, '')
  .replace(/--exec\s+\S+/g, '')
  .replace(/--tool\s+\S+/g, '')
  .trim()
```

### 1b: Handle resume mode

If `resumeMode`:
1. Scan `.workflow/.maestro/` for latest session (or session ID if specified)
2. Read `status.json` → find last completed step, remaining steps
3. Set `$CHAIN` from status.json, `$STEP_INDEX` = last_completed + 1
4. If no session found: **Error E004** — list available sessions
5. Jump to **Step 4** at resume point

### 1c: Read project state

```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

**If `.workflow/state.json` exists:**
1. Read `state.json` → extract `current_milestone`, `status`, `milestones[]`, `artifacts[]`, `accumulated_context`
2. Read `.workflow/roadmap.md` → extract phase list with titles
3. Derive progress from artifact registry:
   - Group `artifacts[]` by phase for current milestone
   - For each phase: determine furthest artifact type (analyze→plan→execute→verify)
   - Identify which phases have pending plans (plan artifact without execute artifact)
4. Build `$PROJECT_STATE`:
   ```json
   {
     "initialized": true,
     "current_milestone": "M1",
     "milestone_name": "MVP Auth",
     "milestone_progress": {
       "phases_total": 3,
       "phases_with_execute": 1,
       "phases_with_plan": 2,
       "adhoc_count": 0
     },
     "latest_artifact": { "id": "PLN-002", "type": "plan", "phase": 2 },
     "pending_actions": ["execute phase 2", "analyze phase 3"],
     "has_blockers": false,
     "suggested_next": null
   }
   ```

**If missing:** `$PROJECT_STATE = { initialized: false }`. If intent also empty → **Error E001** (suggest `maestro-init`).

### 1d: Display banner

```
============================================================
  MAESTRO COORDINATOR
============================================================
  Mode:  {intent-based | state-based | resume}
  Auto:  {yes | no}
  Exec:  {auto | cli | skill}
  Input: {intent or "continue"}
```

## Step 2: Analyze Intent

### 2a: Fast path — forced chain or exact match

**Forced chain (`--chain`):**
- Validate against known chains (see [Chain Reference](#chain-reference))
- If valid: skip intent analysis, jump to **Step 3**
- If invalid: display valid chains, ask user to choose

**Exact-match keywords:**
```javascript
const exactMatch = {
  'continue': 'state_continue', 'next': 'state_continue', 'go': 'state_continue',
  '继续': 'state_continue', '下一步': 'state_continue',
  'status': 'status', '状态': 'status', 'dashboard': 'status',
};
const normalized = intent.toLowerCase().trim();
if (exactMatch[normalized]) {
  taskType = exactMatch[normalized];
  // → skip to Step 3
}
```

### 2b: Structured intent extraction (LLM-native)

Extract a structured intent tuple from user input. Leverages LLM semantic understanding to disambiguate polysemous words (e.g., "问题" as bug vs. issue-tracker item).

```json
{
  "action":    "<from action enum>",
  "object":    "<from object enum>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low | normal | high>"
}
```

**Action enum:**

| action | Triggered by (semantic) |
|--------|------------------------|
| `create` | Build new — feature, component, spec, project |
| `fix` | Repair broken — fix bug, resolve error, 修复, 解决 |
| `analyze` | Understand — analyze, evaluate, investigate, 分析, 评估 |
| `plan` | Design approach — plan, break down, architect, 规划, 分解 |
| `execute` | Implement — execute, implement, develop, code, 实现, 开发 |
| `verify` | Check goals — verify, validate, 验证 |
| `review` | Code quality — review code, 代码审查 |
| `test` | Run/create tests — test, UAT, 测试, 验收 |
| `debug` | Diagnose — debug, troubleshoot, 调试, 排查 |
| `refactor` | Restructure — refactor, clean up, tech debt, 重构 |
| `explore` | Discover — brainstorm, ideate, explore, 头脑风暴, 发散 |
| `manage` | CRUD/lifecycle — list, create issue, close, track, 管理 |
| `transition` | Advance — next phase, complete milestone |
| `continue` | Resume — continue, next, go on, 继续 |
| `sync` | Update docs — sync, refresh, 同步 |
| `fork` | Worktree — fork, parallel, 分叉, 并行 |
| `merge` | Merge back — merge worktree, 合并工作树 |
| `learn` | Capture — learn, insight, eureka, 记录洞察 |
| `retrospect` | Post-mortem — retrospective, retro, 复盘 |
| `release` | Publish — release, publish, ship, tag, 发布 |
| `amend` | Revise — amend workflow, fix command, 修正流程 |
| `compose` | Design workflow — compose, build workflow, 编排流程 |

**Object enum:**

| object | Meaning |
|--------|---------|
| `feature` | New functionality or enhancement |
| `bug` | Defect, error, broken behavior |
| `issue` | Issue-tracker item |
| `code` | Source code in general |
| `test` | Tests, test suite, coverage |
| `spec` | Specification, PRD, requirements |
| `phase` | Workflow phase |
| `milestone` | Workflow milestone |
| `doc` | Documentation |
| `performance` | Performance characteristics |
| `security` | Security concerns |
| `ui` | User interface, design, prototype |
| `memory` | Memory/knowledge management |
| `codebase` | Codebase documentation/mapping |
| `team` | Team-based multi-agent execution |
| `config` | Configuration, setup, initialization |

**Disambiguation ("问题" / "issue" / "problem"):**
- Describing **something broken** → `object: "bug"` (route to debug/fix)
- Referring to **a tracked item** (with ISS-ID, or "create/manage issue" context) → `object: "issue"`
- When ambiguous → prefer `"bug"` (more actionable)

### 2c: Route via action × object matrix

```javascript
function routeIntent(intent, projectState) {
  const { action, object, issue_id, phase_ref } = intent;

  // Hard signal: explicit issue ID → issue pipeline
  if (issue_id) {
    const issueRoutes = {
      'analyze': 'issue_analyze', 'plan': 'issue_plan',
      'fix': 'issue_execute', 'execute': 'issue_execute',
      'debug': 'issue_analyze', 'manage': 'issue',
    };
    return { taskType: issueRoutes[action] || 'issue', issueId: issue_id };
  }

  // Team skill detection (before matrix)
  if (object === 'team') {
    const teamRoutes = {
      'review': 'team_review', 'test': 'team_test',
      'debug': 'team_qa', 'analyze': 'team_qa',
      'refactor': 'team_tech_debt', 'execute': 'team_lifecycle',
      'plan': 'team_coordinate', '_default': 'team_coordinate',
    };
    return { taskType: teamRoutes[action] || 'team_coordinate' };
  }

  // Action × Object matrix
  const matrix = {
    'fix':       { 'bug': 'debug', 'issue': 'issue', 'code': 'debug', 'performance': 'debug', 'security': 'debug', 'test': 'debug', '_default': 'debug' },
    'create':    { 'feature': 'quick', 'issue': 'issue', 'test': 'test_gen', 'spec': 'spec_generate', 'ui': 'ui_design', 'config': 'init', '_default': 'quick' },
    'analyze':   { 'bug': 'analyze', 'issue': 'issue_analyze', 'code': 'analyze', 'performance': 'analyze', 'security': 'analyze', 'feature': 'analyze', 'codebase': 'spec_map', '_default': 'analyze' },
    'explore':   { 'issue': 'issue_discover', 'feature': 'brainstorm', 'ui': 'ui_design', '_default': 'brainstorm' },
    'plan':      { 'issue': 'issue_plan', 'spec': 'spec_generate', 'phase': 'plan', 'milestone': 'plan', '_default': 'plan' },
    'execute':   { 'issue': 'issue_execute', '_default': 'execute' },
    'verify':    { '_default': 'verify' },
    'review':    { '_default': 'review' },
    'test':      { 'feature': 'test', 'code': 'test', '_default': 'test' },
    'debug':     { '_default': 'debug' },
    'refactor':  { '_default': 'refactor' },
    'manage':    { 'issue': 'issue', 'milestone': 'milestone_audit', 'phase': 'milestone_close', 'memory': 'memory', 'doc': 'sync', 'codebase': 'codebase_refresh', 'config': 'spec_setup', 'team': 'team_coordinate', '_default': 'status' },
    'transition':{ 'phase': 'milestone_close', 'milestone': 'milestone_complete', '_default': 'milestone_close' },
    'continue':  { '_default': 'state_continue' },
    'sync':      { 'doc': 'sync', 'codebase': 'codebase_refresh', '_default': 'sync' },
    'fork':      { '_default': 'fork' },
    'merge':     { '_default': 'merge' },
    'learn':     { '_default': 'learn' },
    'retrospect':{ '_default': 'retrospective' },
    'release':   { '_default': 'release' },
    'amend':     { '_default': 'amend' },
    'compose':   { '_default': 'compose' },
  };

  const actionMap = matrix[action];
  if (!actionMap) return { taskType: 'quick' };
  return { taskType: actionMap[object] || actionMap['_default'] || 'quick' };
}
```

### 2d: Chain upgrade & clarity

**State-aware chain upgrade** — check if resolved task_type should become a multi-step chain:

```javascript
function upgradeChain(taskType, projectState) {
  if (taskType === 'issue_execute') return 'issue-full';  // auto-append review gate
  if (taskType === 'debug' && projectState.initialized && projectState.phase_status === 'executing')
    return null;  // keep single-step; state validation will prepend/append as needed
  return null;
}
```

**Clarity score** (from extracted intent tuple):
- **3**: action + object + scope all present
- **2**: action + object present
- **1**: only action, or vague object
- **0**: neither extracted

Display:
```
  Intent Analysis:
    Action: {action}  Object: {object}  Scope: {scope or "none"}
    Issue ID: {issue_id or "none"}  Phase: {phase_ref or "none"}
    Task type: {task_type}  Clarity: {clarity_score}/3
```

**Clarification** (skip if `autoYes` or clarity >= 2, max 2 rounds):

- clarity == 0 → AskUserQuestion: "Start new project" / "Continue working" / "Quick task" / "Check status" / "Rephrase"
- clarity == 1 → AskUserQuestion: "I think you want to {inferred_action}. Right?" + alternatives
- Still unclear after 2 rounds → **Error E002**

## Step 3: Select Chain & Prepare

### 3a: Map task_type → chain

**Resolution order:**
1. `forcedChain` → `chainMap[forcedChain]`
2. `state_continue` → `detectNextAction(projectState)` → returns `{ chain, argsOverride? }`. Use `chainMap[chain]` for steps. If `argsOverride` present, apply to step args before template substitution.
3. `taskToChain[taskType]` → named multi-step chain
4. `chainMap[taskType]` → direct lookup

```javascript
// task_type aliases → named multi-step chains
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm': 'brainstorm-driven',
  'issue_execute': 'issue-full',    // issue execute always gets review gate
};
```

Full `chainMap` and `detectNextAction` are in the [Reference Data](#reference-data) section.

### 3b: Validate against state (W003)

Cross-validate intent against project state:
- `execute` but no plan → warn, prepend `maestro-plan`
- `verify` but not executed → warn, prepend `maestro-execute`
- `test` but not verified → warn, prepend `maestro-verify`
- `milestone_close` but not all phases executed → warn, suggest completing first

Display warning but let user override.

### 3c: Resolve phase number and issue ID

```javascript
function resolvePhase(intent_analysis, project_state) {
  // 1. From structured extraction
  if (intent_analysis.phase_ref) return intent_analysis.phase_ref;

  // 2. Fallback: regex on raw intent text
  const phaseMatch = intent.match(/phase\s*(\d+)|^(\d+)$/);
  if (phaseMatch) return phaseMatch[1] || phaseMatch[2];

  // 3. From project state — derive from artifacts
  if (project_state.initialized) {
    const arts = project_state.artifacts ?? [];
    const inProgress = arts.find(a => a.type === 'execute' && a.status === 'in_progress');
    if (inProgress) return inProgress.phase;
    const phases = [...new Set(arts.map(a => a.phase).filter(Boolean))].sort((a,b) => a - b);
    const current = phases.find(p => !arts.some(a => a.phase === p && a.type === 'execute' && a.status === 'completed'));
    if (current) return current;
    return project_state.latest_artifact?.phase ?? null;
  }

  // 4. Scratch mode chains use {scratch_dir} instead of {phase}
  if (chainName === 'analyze-plan-execute') return null;

  // 5. Chain doesn't need phase
  const noPhaseCommands = ['manage-status', 'manage-issue', 'manage-issue-discover',
    'maestro-init', 'maestro-spec-generate', 'maestro-fork', 'maestro-merge',
    'maestro-roadmap', 'spec-setup', 'manage-memory', 'manage-memory-capture', 'manage-learn',
    'manage-codebase-rebuild', 'manage-codebase-refresh', 'maestro-milestone-audit',
    'maestro-milestone-complete'];
  if (chain.every(s => noPhaseCommands.includes(s.cmd))) return null;

  // 6. Ask user
  return askUserForPhase();
}

function resolveIssueId(intent_analysis) {
  if (intent_analysis.issue_id) return intent_analysis.issue_id;
  const issueMatch = intent.match(/ISS-[\w]+-\d+/i);
  return issueMatch ? issueMatch[0] : null;
}
```

When executing issue chains, replace `{issue_id}` in step args with resolved ID. If missing and required, prompt user.

### 3d: Confirm chain

**If `dryRun`:** Display chain visualization and exit.

**If not `autoYes`:**
```
AskUserQuestion:
  header: "Confirm Chain: {chain_name}"
  question: "Execute this {step_count}-step chain?\n  1. {cmd} — {desc}\n  2. {cmd} — {desc}"
  options: ["Execute", "Execute from step N", "Cancel"]
```

### 3e: Step-level engine selection

Engine is selected **per step**, not per chain. Heavy execution steps use CLI (context isolation, template prompts), observable/lightweight steps use Skill (output visible in conversation).

```javascript
// Heavy execution → CLI: generates large output, benefits from context isolation
const CLI_STEPS = new Set([
  'maestro-plan',           // generates detailed plan artifacts
  'maestro-execute',        // implements code, produces bulk output
  'maestro-analyze',        // deep codebase analysis
  'maestro-brainstorm',     // creative exploration
  'maestro-spec-generate',  // multi-phase document generation
  'maestro-roadmap',        // roadmap creation
  'maestro-ui-design',      // design prototype generation
  'quality-refactor',       // code restructuring
]);

// Everything else → Skill: observable, interactive, or lightweight
// verify, review, test, debug, milestone-*, manage-*, spec-*, quick, etc.

function selectStepEngine(execMode, step) {
  if (execMode === 'cli') return 'cli';
  if (execMode === 'skill') return 'skill';
  // auto: per-step decision
  return CLI_STEPS.has(step.cmd) ? 'cli' : 'skill';
}
```

**Trade-off:**
- CLI: context isolation (不撑爆对话), template-driven prompts, gemini quality analysis
- Skill: observability (输出直接可见), synchronous, user can intervene mid-step

### 3f: Setup session

```bash
SESSION_ID="maestro-$(date +%Y%m%d-%H%M%S)"
SESSION_DIR=".workflow/.maestro/${SESSION_ID}"
mkdir -p "${SESSION_DIR}"
```

Write `${SESSION_DIR}/status.json`:
```json
{
  "session_id": "{SESSION_ID}",
  "created_at": "{ISO timestamp}",
  "intent": "{original_intent}",
  "task_type": "{task_type}",
  "chain_name": "{chain_name}",
  "phase": "{resolved_phase}",
  "auto_mode": "{autoYes}",
  "exec_mode": "{execMode}",
  "cli_tool": "{cliTool}",
  "gemini_session_id": null,
  "step_analyses": [],
  "steps": [{ "index": 0, "skill": "{cmd}", "args": "{args}", "engine": null, "status": "pending", "started_at": null, "completed_at": null }],
  "current_step": 0,
  "status": "running"
}
```

## Step 4: Execute Chain

### Shared: context & argument assembly

```javascript
const context = {
  current_phase: resolvedPhase,
  user_intent: intent,
  issue_id: resolvedIssueId,
  spec_session_id: null,
  scratch_dir: null,
  auto_mode: autoYes
};

const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y', 'maestro-roadmap': '-y',
  'maestro-ui-design': '-y', 'maestro-plan': '--auto', 'maestro-spec-generate': '-y',
  'quality-test': '--auto-fix', 'quality-retrospective': '--auto-yes',
};

function assembleArgs(step, context) {
  let args = (step.args || '')
    .replace(/\{phase\}/g, context.current_phase || '')
    .replace(/\{description\}/g, context.user_intent || '')
    .replace(/\{issue_id\}/g, context.issue_id || '')
    .replace(/\{spec_session_id\}/g, context.spec_session_id || '')
    .replace(/\{scratch_dir\}/g, context.scratch_dir || '');
  if (context.auto_mode) {
    const flag = AUTO_FLAG_MAP[step.cmd];
    if (flag && !args.includes(flag)) args = args ? `${args} ${flag}` : flag;
  }
  return args.trim();
}

function escapeForShell(str) { return "'" + str.replace(/'/g, "'\\''") + "'"; }
```

### Step loop — for each step starting at `$STEP_INDEX` (default 0):

**4a. Select engine & display banner:**

```javascript
const stepEngine = selectStepEngine(execMode, step);
step.engine = stepEngine;  // record in status.json
```

```
------------------------------------------------------------
  STEP {i+1}/{total}: {command_name}  |  {stepEngine}
------------------------------------------------------------
  Args: {assembled_args}
```

If `i >= 3` and not autoYes: display context cleanup hint (`/maestro -c` to resume in fresh context).
If autoYes and `i >= 4`: log one-line warning to status.json.

Update status.json: step status = `"running"`, engine = stepEngine, started_at = now.

**4b. Execute (engine-dependent):**

**Skill** — direct, synchronous, output visible in conversation:
```javascript
if (stepEngine === 'skill') {
  Skill({ skill: step.cmd, args: assembledArgs });
}
```

**CLI** — template-driven, async, context-isolated:
```javascript
if (stepEngine === 'cli') {
  // Read template and build analysis hints from previous step's gemini evaluation
  const template = Read('~/.maestro/templates/cli/prompts/coordinate-step.txt');

let analysisHints = '';
const prevAnalysis = (state.step_analyses || []).find(a => a.step_index === i - 1);
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
  .replace('{{STEP_N}}', `${i + 1}/${state.steps.length}`)
  .replace('{{AUTO_DIRECTIVE}}', state.auto_mode ? 'Auto-confirm all prompts. No interactive questions.' : '')
  .replace('{{CHAIN_NAME}}', state.chain_name)
  .replace('{{ANALYSIS_HINTS}}', analysisHints);

Bash({
  command: `maestro delegate ${escapeForShell(prompt)} --to ${cliTool} --mode write`,
  run_in_background: true, timeout: 600000
});
// ■ STOP — wait for background callback
```

**4c. Parse output & update context:**

After step returns (Skill immediately, CLI on callback):
- `PHASE: N` → update `context.current_phase`
- `SPEC-xxx` → update `context.spec_session_id`
- `scratch_dir: path` → update `context.scratch_dir`
- CLI only: capture exec_id from stderr `[MAESTRO_EXEC_ID=xxx]`

**4d. Handle result:**

On success: update status.json (`"completed"`, completed_at). CLI: save output to `step-{N}-output.txt`.

On failure:
- autoYes: retry once, then mark `"skipped"`, continue
- Interactive: AskUserQuestion — Retry (max 2) / Skip / Abort
- On Abort: **Error E003** — display `Resume with: /maestro -c`

**4e. Post-step analysis (CLI steps only, multi-step chains):**

Skip if: step failed/skipped, single-step chain, or `stepEngine === 'skill'`.

```javascript
const analysisPrompt = `PURPOSE: Evaluate execution quality of step "${step.cmd}" (${i+1}/${state.steps.length}) and generate optimization hints.
CHAIN: ${state.chain_name} | Intent: ${state.intent}
COMMAND: /${step.cmd} ${step.args || ''}
STEP OUTPUT (last 200 lines):
${output.split('\n').slice(-200).join('\n')}
${nextStep ? `NEXT STEP: /${nextStep.cmd} ${nextStep.args || ''}` : 'NEXT STEP: None (last step)'}
EXPECTED OUTPUT (strict JSON):
{
  "quality_score": <0-100>,
  "execution_assessment": { "success": <bool>, "completeness": "<full|partial|minimal>", "key_outputs": [], "missing_outputs": [] },
  "issues": [{ "severity": "critical|high|medium|low", "description": "" }],
  "next_step_hints": {
    "prompt_additions": "<extra context for next step>",
    "cautions": ["<things to watch out for>"],
    "context_to_carry": "<key facts from this step>"
  },
  "step_summary": ""
}`;

let delegateCmd = `maestro delegate ${escapeForShell(analysisPrompt)} --to gemini --mode analysis`;
if (state.gemini_session_id) delegateCmd += ` --resume ${state.gemini_session_id}`;
Bash({ command: delegateCmd, run_in_background: true, timeout: 300000 });
// ■ STOP — wait for analysis callback
```

On analysis callback:
- Capture gemini exec_id → `state.gemini_session_id` for resume chain
- Store in `state.step_analyses[]` with `quality_score`, `issues`, `next_step_hints`
- Save to `${SESSION_DIR}/step-${i+1}-analysis.json`
- Advance `state.current_step`, continue to next step (**4a**)

**4f. Completion report:**

```
============================================================
  MAESTRO SESSION COMPLETE
============================================================
  Session:  {session_id}
  Chain:    {chain_name}
  Steps:    {completed}/{total} completed
  Phase:    {current_phase}

  Results:
    [✓] 1. maestro-plan — completed [cli] (quality: 85/100)
    [✓] 2. maestro-verify — completed [skill]
    [—] 3. quality-review — skipped [skill]

  CLI Avg Quality: {avgScore}/100 (based on {cliStepCount} cli steps)

  Next: /maestro continue | /manage-status
============================================================
```

---

## Reference Data

### Chain Map

```javascript
const chainMap = {
  // ── Single-step ──
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze', args: '{phase}' }],
  'analyze-quick':      [{ cmd: 'maestro-analyze', args: '{phase} -q' }],
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
  'sync':               [{ cmd: 'quality-sync' }],
  'milestone_close':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute', args: '' }],
  'memory':             [{ cmd: 'manage-memory', args: '"{description}"' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'fork':               [{ cmd: 'maestro-fork', args: '-m {milestone_num}' }],
  'merge':              [{ cmd: 'maestro-merge', args: '-m {milestone_num}' }],

  // ── Team skills ──
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4', args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_design':        [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_execute':       [{ cmd: 'team-executor', args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance', args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing', args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review', args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt', args: '"{description}"' }],

  // ── Multi-step chains ──
  'full-lifecycle':       [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-milestone-audit' }],
  'spec-driven':          [{ cmd: 'maestro-init' }, { cmd: 'maestro-spec-generate', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'roadmap-driven':       [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven':    [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven':     [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
  'execute-verify':       [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':         [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test-gen', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close':      [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'next-milestone':       [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'review-fix':           [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }],
  'quality-loop-partial': [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'issue-full':           [{ cmd: 'maestro-analyze', args: '--gaps {issue_id}' }, { cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
  'issue-quick':          [{ cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
  'milestone-release':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-release' }],

  'learn':                [{ cmd: 'maestro-learn', args: '"{description}"' }],
  'harvest':              [{ cmd: 'manage-harvest', args: '"{description}"' }],
  'wiki':                 [{ cmd: 'manage-wiki' }],
  'wiki_connect':         [{ cmd: 'wiki-connect' }],
  'wiki_digest':          [{ cmd: 'wiki-digest' }],
  'business_test':        [{ cmd: 'quality-business-test', args: '{phase}' }],
  'spec_remove':          [{ cmd: 'spec-remove', args: '"{description}"' }],
  'amend':                [{ cmd: 'maestro-amend', args: '"{description}"' }],
  'release':              [{ cmd: 'maestro-milestone-release' }],
  'compose':              [{ cmd: 'maestro-composer', args: '"{description}"' }],
  'play':                 [{ cmd: 'maestro-player', args: '"{description}"' }],
  'update':               [{ cmd: 'maestro-update' }],
  'overlay':              [{ cmd: 'maestro-overlay', args: '"{description}"' }],
  'link_coordinate':      [{ cmd: 'maestro-link-coordinate', args: '"{description}"' }],
};
```

### State Detection (detectNextAction)

Used when `task_type == state_continue`. Routes based on `phase_status` and artifact presence:

```javascript
// Returns { chain: string, argsOverride?: Record<string, string> }
// Steps are always resolved from chainMap[chain] — never inline.
function detectNextAction(state) {
  if (!state.initialized) return { chain: 'init' };

  const ps = state.phase_status;
  const art = state.phase_artifacts;
  const exec = state.execution;
  const ver = state.verification_status;
  const uat = state.uat_status;

  // Post-milestone: no roadmap, has accumulated context → next milestone
  const hasRoadmap = fileExists('.workflow/roadmap.md');
  if (state.phases_total === 0 && !hasRoadmap && state.accumulated_context) {
    const deferred = (state.accumulated_context.deferred || []).join('; ');
    const decisions = (state.accumulated_context.key_decisions || []).join('; ');
    const context = [
      deferred ? `Deferred from previous milestone: ${deferred}` : '',
      decisions ? `Key decisions carried forward: ${decisions}` : ''
    ].filter(Boolean).join('. ');
    return { chain: 'next-milestone', argsOverride: { '{description}': `"Plan next milestone. ${context}"` } };
  }

  // No phases, no context → fresh start
  if (state.phases_total === 0) return { chain: 'brainstorm-driven' };

  // ── Route by phase_status ──

  if (ps === 'pending') {
    if (art.context) return { chain: 'plan' };
    if (art.analysis) return { chain: 'analyze-quick' };
    return { chain: 'analyze' };
  }

  if (ps === 'exploring' || ps === 'planning') {
    if (art.plan) return { chain: 'execute-verify' };
    return { chain: 'plan' };
  }

  if (ps === 'executing') {
    if (exec.tasks_completed >= exec.tasks_total && exec.tasks_total > 0)
      return { chain: 'verify' };
    if (state.has_blockers) return { chain: 'debug' };
    return { chain: 'execute' };
  }

  if (ps === 'verifying') {
    const rev = state.review_verdict;  // "PASS" | "WARN" | "BLOCK" | null
    if (ver === 'passed') {
      if (!rev) return { chain: 'review' };
      if (rev === 'BLOCK') return { chain: 'review-fix' };
      if (uat === 'pending') return { chain: 'test' };
      if (uat === 'passed') return { chain: 'milestone-close' };
      if (uat === 'failed') return { chain: 'debug' };
      return { chain: 'test' };
    }
    return { chain: 'quality-loop-partial' };
  }

  if (ps === 'testing') {
    if (uat === 'passed') return { chain: 'milestone-close' };
    return { chain: 'debug' };
  }

  if (ps === 'completed') return { chain: 'milestone-close' };

  if (ps === 'forked') {
    if (fileExists('.workflow/worktrees.json')) return { chain: 'merge' };
    return { chain: 'status' };
  }

  if (ps === 'blocked') return { chain: 'debug' };

  return { chain: 'status' };
}
```

### Chain Reference

| Chain | Steps | Use Case |
|-------|-------|----------|
| `full-lifecycle` | plan → execute → verify → review → test → audit | Full milestone completion |
| `spec-driven` | init → spec-generate → plan → execute → verify | From idea/requirements (heavy) |
| `roadmap-driven` | init → roadmap → plan → execute → verify | From requirements (light) |
| `brainstorm-driven` | brainstorm → plan → execute → verify | From exploration |
| `ui-design-driven` | ui-design → plan → execute → verify | From UI prototypes |
| `analyze-plan-execute` | analyze -q → plan --dir → execute --dir | Fast track (scratch mode) |
| `execute-verify` | execute → verify | Resume after planning |
| `review-fix` | plan --gaps → execute → review | Fix review-blocked issues |
| `quality-loop` | verify → review → test-gen → test → debug → plan --gaps → execute | Fix quality issues |
| `quality-loop-partial` | plan --gaps → execute → verify | Partial quality fix cycle |
| `milestone-close` | audit → complete | Close a milestone |
| `milestone-release` | audit → release | Release with version tag |
| `next-milestone` | roadmap → plan → execute → verify | Next milestone (auto-loads deferred) |
| `issue-full` | analyze → plan → execute → review → close | Issue with quality gate |
| `issue-quick` | plan → execute → close | Issue fast path |

### Pipeline Examples

| Input | Extraction | Route | Chain |
|-------|-----------|-------|-------|
| `"continue"` | *(exact match)* | state_continue | (from state) |
| `"status"` | *(exact match)* | status | manage-status |
| `"Add API endpoint"` | `{create, feature}` | quick | maestro-quick |
| `"plan phase 2"` | `{plan, phase, ref:2}` | plan | maestro-plan 2 |
| `"execute"` | `{execute, code}` | execute | maestro-execute |
| `"run tests"` | `{test, test}` | test | quality-test |
| `"debug auth crash"` | `{debug, bug, scope:"auth"}` | debug | quality-debug |
| `"修复登录问题"` | `{fix, bug, scope:"登录"}` | debug | quality-debug |
| `"fix issue ISS-abc-001"` | `{fix, issue, ISS-abc-001}` | issue_execute | issue-full |
| `"这个问题需要看看"` | `{analyze, bug}` | analyze | maestro-analyze |
| `"创建一个 issue 跟踪"` | `{manage, issue}` | issue | manage-issue |
| `"discover issues"` | `{explore, issue}` | issue_discover | manage-issue-discover |
| `"brainstorm notifications"` | `{explore, feature}` | brainstorm | brainstorm-driven |
| `"spec generate auth"` | `{create, spec}` | spec_generate | spec-driven |
| `"ui design landing"` | `{create, ui}` | ui_design | ui-design-driven |
| `"refactor auth module"` | `{refactor, code}` | refactor | quality-refactor |
| `"复盘 phase 2"` | `{retrospect, phase}` | retrospective | quality-retrospective |
| `"team review code"` | `{review, team}` | team_review | team-review |
| `"next phase"` | `{transition, milestone}` | milestone_close | audit → complete |
| `-y "implement X"` | `{execute, feature}` | execute | maestro-execute (auto) |
| `"release v1.2"` | `{release, milestone}` | release | maestro-milestone-release |
| `"amend plan command"` | `{amend, config}` | amend | maestro-amend |
| `"compose deploy flow"` | `{compose, config}` | compose | maestro-composer |

### Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| E001 | No intent + project not initialized | Suggest maestro-init |
| E002 | Clarity too low after 2 rounds | Ask to rephrase |
| E003 | Chain step failed + abort | Suggest resume with -c |
| E004 | Resume session not found | Show available sessions |
| W001 | Ambiguous intent, multiple chains | Present options |
| W002 | Step completed with warnings | Log and continue |
| W003 | State suggests different chain | Show discrepancy, let user decide |

### Design Principles

1. **Semantic Routing** — LLM-native `action × object` extraction; disambiguates "问题" by context
2. **State-Aware** — Reads `.workflow/state.json` before routing
3. **Quality Gates** — Issue chains auto-include review; `issue-full` is default for issue execution
4. **Per-Step Engine** — Each step independently selects Skill or CLI. Heavy steps (plan, execute, analyze, brainstorm) → CLI for context isolation. Observable steps (verify, review, test, debug, manage-*) → Skill for direct visibility. `--exec cli|skill` forces all steps.
5. **CLI Analysis Chain** — Gemini evaluates each CLI step's output, generates `next_step_hints` via `{{ANALYSIS_HINTS}}`. Skill steps skip analysis (output already visible). Sessions chained via `--resume`
6. **Phase Propagation** — Auto-detects and passes phase numbers to downstream commands
7. **Auto Mode** — `-y` propagates through chain, skipping all confirmations
8. **Resumable** — Session state in `.workflow/.maestro/` enables `-c` resume
9. **Error Resilience** — Retry/skip/abort per step; auto-skip in `-y` mode
