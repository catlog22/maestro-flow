# Workflow: maestro

Intelligent coordinator that routes user intent to optimal command chain based on project state.
Combines intent classification with state-aware routing to orchestrate all maestro commands.

---

## Prerequisites

- None for initial invocation (coordinator can bootstrap from scratch)
- For `continue`/`next`: `.workflow/state.json` must exist
- For `-c` (resume): `.workflow/.maestro/*/status.json` must exist

---

### Step 1: Parse Arguments & Detect Mode

**Parse $ARGUMENTS for flags and intent:**

```javascript
const autoYes = /\b(-y|--yes)\b/.test($ARGUMENTS)
const resumeMode = /\b(-c|--continue)\b/.test($ARGUMENTS)
const dryRun = /\b--dry-run\b/.test($ARGUMENTS)
const forcedChain = $ARGUMENTS.match(/--chain\s+(\S+)/)?.[1] || null
const intent = $ARGUMENTS
  .replace(/\b(-y|--yes|-c|--continue|--dry-run)\b/g, '')
  .replace(/--chain\s+\S+/g, '')
  .trim()
```

**If resumeMode:**
1. Scan `.workflow/.maestro/` for latest session (or session ID if specified)
2. Read `status.json` → find last completed step, remaining steps
3. Set `$CHAIN` from status.json, `$STEP_INDEX` = last_completed + 1
4. If no session found: **Error E004** — list available sessions with dates
5. Jump to **Step 6** (Execute Chain) at resume point

**Display banner:**
```
============================================================
  MAESTRO COORDINATOR
============================================================
  Mode:  {intent-based | state-based | resume}
  Auto:  {yes | no}
  Input: {intent or "continue"}
```

---

### Step 2: Read Project State

**Load project state (if exists):**

```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

**If `.workflow/state.json` exists:**
1. Read `state.json` → extract `current_milestone`, `current_phase`, `status`, `phases_summary`, `accumulated_context`
2. Read `.workflow/roadmap.md` → extract phase list with titles
3. For current_phase, read `.workflow/phases/{NN}-{slug}/index.json`:
   - Extract: `status`, `plan`, `execution`, `verification`, `validation`, `uat`
4. Check for artifacts in current phase directory:
   ```bash
   ls .workflow/phases/{NN}-{slug}/ 2>/dev/null | grep -E "(brainstorm|analysis|context|plan\.json|verification\.json|uat)\.md"
   ```
5. Build `$PROJECT_STATE`:
   ```json
   {
     "initialized": true,
     "current_phase": 1,
     "phase_slug": "auth-system",
     "phase_title": "Authentication System",
     "phase_status": "pending|exploring|planning|executing|verifying|testing|completed|blocked",
     "phase_artifacts": {
       "brainstorm": false, "analysis": false, "context": false,
       "plan": false, "verification": false, "uat": false
     },
     "execution": { "tasks_completed": 0, "tasks_total": 0 },
     "verification_status": "pending",
     "uat_status": "pending",
     "phases_total": 3,
     "phases_completed": 0,
     "has_blockers": false,
     "suggested_next": null
   }
   ```

**If `.workflow/state.json` missing:**
- `$PROJECT_STATE = { initialized: false }`
- If `$INTENT` is also empty: **Error E001** — suggest `maestro-init` or describe a task

---

### Step 3: Analyze Intent

**If `$FORCED_CHAIN` is set:**
- Validate against known chains: `full-lifecycle`, `spec-driven`, `brainstorm-driven`, `ui-design-driven`, `analyze-plan-execute`, `execute-verify`, `quality-loop`, `milestone-close`, `quick`, `review`
- If valid: skip pattern matching, jump to **Step 5**
- If invalid: display valid chains, ask user to choose

**Pattern matching (priority order, first match wins):**

```javascript
function detectTaskType(text) {
  const patterns = [
    // Priority 1-2: Special keywords
    ['state_continue', /^(continue|next|go|继续|下一步)$/i],
    ['status',         /^(status|状态|dashboard)$/i],

    // Priority 3-9: Pre-execution pipeline
    ['spec_generate',  /spec.*(generat|creat|build|write|produce)|from.*idea.*to.*spec|产品.*规格|PRD/i],
    ['brainstorm',     /brainstorm|ideate|explore.*idea|头脑风暴|发散|creative.*think/i],
    ['analyze',        /analy[sz]e|feasib|evaluat|assess|discuss|clarif|decid|gray.*area|分析|评估|讨论|澄清|决策/i],
    ['ui_design',      /ui.*design|design.*ui|landing.*page|prototype.*style|设计.*原型|UI.*风格|design.*variant|design.*prototype|落地页.*设计/i],
    ['init',           /init|setup.*project|start.*project|onboard|初始化|新项目/i],
    ['plan',           /plan(?!.*gap)|design.*plan|break.*down|分解|规划/i],

    // Priority 9-10: Execution pipeline
    ['execute',        /execute|implement|build|develop|code|实现|开发|编码/i],
    ['verify',         /verif[iy]|check.*goal|validate.*result|验证|校验/i],

    // Priority 11-17: Quality pipeline
    ['review',         /\breview.*code|code.*review|代码.*审查|审查.*代码|review.*quality/i],
    ['test_gen',       /test.*gen|generat.*test|add.*test|补充.*测试|写测试/i],
    ['test',           /\btest|uat|user.*accept|测试|用户.*验收/i],
    ['debug',          /debug|diagnos|troubleshoot|fix.*bug|调试|排查/i],
    ['integration_test', /integrat.*test|e2e.*cycle|集成测试|端到端/i],
    ['refactor',       /refactor|clean.*up|tech.*debt|重构|技术债/i],
    ['sync',           /sync.*doc|refresh.*doc|update.*doc|同步/i],

    // Priority 17-20: Phase/milestone lifecycle
    ['phase_transition', /phase.*transit|next.*phase|advance.*phase|推进|切换.*阶段/i],
    ['phase_add',        /phase.*add|insert.*phase|new.*phase|add.*phase|添加.*阶段/i],
    ['milestone_audit',  /milestone.*audit|cross.*phase.*check|里程碑.*审计/i],
    ['milestone_complete', /milestone.*compl|finish.*milestone|完成.*里程碑/i],

    // Priority 21: Issue management (granular patterns first, then generic)
    ['issue_analyze',     /analyze.*issue|issue.*analyze|分析.*问题|issue.*root.*cause/i],
    ['issue_plan',        /plan.*issue|issue.*plan|规划.*问题|issue.*solution/i],
    ['issue_execute',     /execute.*issue|issue.*execute|执行.*问题|run.*issue/i],
    ['issue',             /issue|问题|缺陷|gap.*track|issue.*manage|discover.*issue/i],

    // Priority 22-29: Maintenance operations
    ['codebase_rebuild',  /codebase.*rebuild|full.*rebuild|重建.*文档/i],
    ['codebase_refresh',  /codebase.*refresh|incr.*refresh|刷新.*文档/i],
    ['spec_setup',        /spec.*setup|scan.*convention|规范.*初始化/i],
    ['spec_add',          /spec.*add|add.*(bug|pattern|decision|rule)|添加.*规范/i],
    ['spec_load',         /spec.*load|load.*spec|加载.*规范/i],
    ['spec_map',          /spec.*map|map.*codebase|规范.*映射/i],
    ['memory_capture',    /memory.*captur|save.*memory|compact|记忆.*捕获/i],
    ['memory',            /memory|manage.*mem|记忆.*管理/i],

    // Priority 29: Team skills
    ['team_lifecycle',    /team.*lifecycle|team.*session|团队.*生命周期/i],
    ['team_coordinate',   /team.*coordinat|team.*dynamic.*role|团队.*协调/i],
    ['team_design',       /team.*design(?!.*ui)|design.*team.*skill|团队.*设计/i],
    ['team_execute',      /team.*exec(?!ute\b)|resume.*team.*session|团队.*执行/i],
    ['team_qa',           /team.*(qa|quality.*assur)|团队.*质量/i],
    ['team_test',         /team.*test|团队.*测试/i],
    ['team_review',       /team.*review|团队.*评审/i],
    ['team_tech_debt',    /team.*tech.*debt|team.*debt|团队.*技术债/i],

    // Priority 30: Quick task
    ['quick',             /quick|small.*task|ad.?hoc|just.*do|简单|快速/i],
  ];

  for (const [type, pattern] of patterns) {
    if (pattern.test(text)) return type;
  }
  return 'auto_detect';
}
```

**For `auto_detect` (no pattern matched):**
- Short intent (< 15 words), no phase reference → `quick`
- References lifecycle stages or multiple modules → `execute` (with state validation in Step 5)
- Default fallback → `quick`

**Compute clarity_score:**
- 3: Has verb + object + scope (e.g., "plan phase 2 with gap fixes")
- 2: Has verb + object (e.g., "run tests on auth module")
- 1: Vague but interpretable (e.g., "help with quality")
- 0: Unintelligible or empty

**Output:**
```
  Intent Analysis:
    Type:       {task_type}
    Clarity:    {clarity_score}/3
    Complexity: {simple|moderate|complex}
    Phase ref:  {N or "none"}
```

---

### Step 4: Clarify (if clarity_score < 2)

**Skip if `$AUTO_MODE` is true.**

**If clarity_score == 0:**
```
AskUserQuestion:
  header: "Unclear Intent"
  question: "I couldn't understand your request. What would you like to do?"
  options:
    - "Start a new project" → task_type = init
    - "Continue working" → task_type = state_continue
    - "Run a quick task" → task_type = quick
    - "Check status" → task_type = status
    - "Let me rephrase" → re-run Step 3 with new input
```

**If clarity_score == 1:**
```
AskUserQuestion:
  header: "Clarification"
  question: "I think you want to {inferred_action}. Is that right?"
  options:
    - "Yes, proceed" → continue
    - "{alternative_1}" → update task_type
    - "{alternative_2}" → update task_type
    - "Let me rephrase" → re-run Step 3
```

Max 2 clarification rounds. If still unclear: **Error E002**.

---

### Step 5: Select Chain & Confirm

#### 5a: Map task_type → chain

**State-based routing (task_type == `state_continue`):**

Run state detection algorithm using `$PROJECT_STATE`:

```javascript
function detectNextAction(state) {
  if (!state.initialized) return { chain: 'init', steps: ['maestro-init'] };

  const ps = state.phase_status;
  const art = state.phase_artifacts;
  const exec = state.execution;
  const ver = state.verification_status;
  const uat = state.uat_status;

  // No phases exist
  if (state.phases_total === 0) {
    return { chain: 'brainstorm-driven', steps: ['maestro-brainstorm', 'maestro-plan', 'maestro-execute', 'maestro-verify'] };
  }

  // Phase pending — determine entry point by artifacts (progressive: analyze → plan)
  if (ps === 'pending') {
    if (art.context) return { chain: 'plan', steps: ['maestro-plan'] };
    if (art.analysis) return { chain: 'analyze-quick', steps: ['maestro-analyze -q'] };
    if (art.brainstorm) return { chain: 'analyze', steps: ['maestro-analyze'] };
    return { chain: 'analyze', steps: ['maestro-analyze'] };
  }

  // Planning in progress
  if (ps === 'exploring' || ps === 'planning') {
    if (art.plan) return { chain: 'execute-verify', steps: ['maestro-execute', 'maestro-verify'] };
    return { chain: 'plan', steps: ['maestro-plan'] };
  }

  // Executing
  if (ps === 'executing') {
    if (exec.tasks_completed >= exec.tasks_total && exec.tasks_total > 0)
      return { chain: 'verify', steps: ['maestro-verify'] };
    if (state.has_blockers) return { chain: 'debug', steps: ['quality-debug'] };
    return { chain: 'execute', steps: ['maestro-execute'] };
  }

  // Verifying
  if (ps === 'verifying') {
    const rev = state.review_verdict;  // "PASS" | "WARN" | "BLOCK" | null
    if (ver === 'passed') {
      // Review gate: run review before UAT if not yet done
      if (!rev) return { chain: 'review', steps: ['quality-review'] };
      if (rev === 'BLOCK') return { chain: 'review-fix', steps: ['maestro-plan --gaps', 'maestro-execute', 'quality-review'] };
      // Review passed or warned — proceed to UAT
      if (uat === 'pending') return { chain: 'test', steps: ['quality-test'] };
      if (uat === 'passed') return { chain: 'phase-transition', steps: ['maestro-phase-transition'] };
      if (uat === 'failed') return { chain: 'debug', steps: ['quality-debug --from-uat {phase}'] };
      if (uat === 'in_progress') return { chain: 'test', steps: ['quality-test'] };
      return { chain: 'test', steps: ['quality-test'] };
    }
    // Verification has gaps
    return { chain: 'quality-loop-partial', steps: ['maestro-plan --gaps', 'maestro-execute', 'maestro-verify'] };
  }

  // Testing
  if (ps === 'testing') {
    if (uat === 'passed') return { chain: 'phase-transition', steps: ['maestro-phase-transition'] };
    return { chain: 'debug', steps: ['quality-debug --from-uat {phase}'] };
  }

  // Phase completed
  if (ps === 'completed') {
    if (state.phases_completed >= state.phases_total)
      return { chain: 'milestone-close', steps: ['maestro-milestone-audit', 'maestro-milestone-complete'] };
    return { chain: 'phase-transition', steps: ['maestro-phase-transition'] };
  }

  // Blocked
  if (ps === 'blocked') return { chain: 'debug', steps: ['quality-debug'] };

  // Issue-aware: if open critical issues exist, suggest issue management
  // (checked via .workflow/issues/issues.jsonl if present)
  // This is evaluated as a secondary signal alongside phase_status routing above

  // Fallback
  return { chain: 'status', steps: ['manage-status'] };
}
```

**Intent-based routing (all other task_types):**

```javascript
const chainMap = {
  // Single-step chains
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
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'manage-issue-analyze', args: '"{description}"' }],
  'issue_plan':         [{ cmd: 'manage-issue-plan', args: '"{description}"' }],
  'issue_execute':      [{ cmd: 'manage-issue-execute', args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory', args: '"{description}"' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],

  // Team skills (independent, single-step)
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4', args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_design':        [{ cmd: 'team-designer', args: '"{description}"' }],
  'team_execute':       [{ cmd: 'team-executor', args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance', args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing', args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review', args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt', args: '"{description}"' }],

  // Multi-step chains
  'full-lifecycle': [
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' },
    { cmd: 'quality-review', args: '{phase}' },
    { cmd: 'quality-test', args: '{phase}' },
    { cmd: 'maestro-phase-transition' }
  ],
  'spec-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-spec-generate', args: '"{description}"' },
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  'roadmap-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-roadmap', args: '"{description}"' },
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  'brainstorm-driven': [
    { cmd: 'maestro-brainstorm', args: '"{description}"' },
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  'ui-design-driven': [
    { cmd: 'maestro-ui-design', args: '{phase}' },
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  'analyze-plan-execute': [
    { cmd: 'maestro-analyze', args: '"{description}" -q' },
    { cmd: 'maestro-plan', args: '--dir {scratch_dir}' },
    { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }
  ],
  'execute-verify': [
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  'quality-loop': [
    { cmd: 'maestro-verify', args: '{phase}' },
    { cmd: 'quality-review', args: '{phase}' },
    { cmd: 'quality-test-gen', args: '{phase}' },
    { cmd: 'quality-test', args: '{phase}' },
    { cmd: 'quality-debug', args: '--from-uat {phase}' },
    { cmd: 'maestro-plan', args: '{phase} --gaps' },
    { cmd: 'maestro-execute', args: '{phase}' }
  ],
  'milestone-close': [
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-complete' }
  ]
};

// Map task_type → chain
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm': 'brainstorm-driven',
};
```

**For `spec_generate`** → use `spec-driven` chain.
**For `brainstorm`** → use `brainstorm-driven` chain.
**All other task_types** → look up directly in `chainMap[task_type]`.
**`--chain` flag** → use forced chain from `chainMap[forcedChain]`.

#### 5b: State validation (W003 check)

Cross-validate intent against project state:
- Intent says `execute` but phase has no plan → warn, prepend `maestro-plan`
- Intent says `verify` but phase not executed → warn, prepend `maestro-execute`
- Intent says `test` but phase not verified → warn, prepend `maestro-verify`
- Intent says `phase_transition` but phase not verified → warn, prepend `maestro-verify`

Display warning but let user override.

#### 5c: Resolve phase number

```javascript
function resolvePhase(intent_analysis, project_state) {
  // 1. Explicit phase in intent: "plan phase 3", "verify 2"
  const phaseMatch = intent.match(/phase\s*(\d+)|^(\d+)$/);
  if (phaseMatch) return phaseMatch[1] || phaseMatch[2];

  // 2. From project state
  if (project_state.initialized) return project_state.current_phase;

  // 3. Scratch mode chains use {scratch_dir} instead of {phase}
  // analyze-plan-execute: {scratch_dir} resolved from analyze output dir after step 1 completes
  if (chainName === 'analyze-plan-execute') return null;

  // 4. Chain doesn't need phase (init, status, memory, etc.)
  const noPhaseCommands = ['manage-status', 'manage-issue', 'manage-issue-analyze', 'manage-issue-plan', 'manage-issue-execute', 'maestro-init', 'maestro-spec-generate',
    'maestro-roadmap', 'spec-setup', 'spec-map', 'manage-memory', 'manage-memory-capture',
    'manage-codebase-rebuild', 'manage-codebase-refresh', 'maestro-milestone-audit',
    'maestro-milestone-complete', 'maestro-phase-transition', 'maestro-phase-add'];
  if (chain.every(s => noPhaseCommands.includes(s.cmd))) return null;

  // 4. Ask user
  // AskUserQuestion with available phases from roadmap
  return askUserForPhase();
}
```

#### 5d: Confirm (skip if autoYes)

**If `$DRY_RUN`:**
Display chain visualization and exit:
```
============================================================
  MAESTRO CHAIN: {chain_name} (dry run)
============================================================
  Intent: {original_intent}
  Phase:  {phase} ({phase_title})

  Pipeline:
    1. [{command}] args: {assembled_args}
    2. [{command}] args: {assembled_args}
    ...

  (Use without --dry-run to execute)
============================================================
```

**If not autoYes:**
```
AskUserQuestion:
  header: "Confirm Chain: {chain_name}"
  question: |
    Execute this {step_count}-step chain?

    Pipeline:
      1. {command} — {description}
      2. {command} — {description}
      ...

  options:
    - "Execute" → proceed
    - "Execute from step N" → ask step number, set $STEP_INDEX
    - "Cancel" → exit
```

---

### Step 6: Setup Tracking

**Generate session ID:**
```bash
SESSION_ID="maestro-$(date +%Y%m%d-%H%M%S)"
SESSION_DIR=".workflow/.maestro/${SESSION_ID}"
mkdir -p "${SESSION_DIR}"
```

**Write `${SESSION_DIR}/status.json`:**
```json
{
  "session_id": "{SESSION_ID}",
  "created_at": "{ISO timestamp}",
  "intent": "{original_intent}",
  "task_type": "{task_type}",
  "chain_name": "{chain_name}",
  "phase": "{resolved_phase}",
  "auto_mode": "{autoYes}",
  "steps": [
    {
      "index": 0,
      "skill": "{command_name}",
      "args": "{assembled_args}",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    }
  ],
  "current_step": 0,
  "status": "running"
}
```

---

### Step 7: Execute Chain

**Initialize execution context:**
```javascript
const context = {
  current_phase: resolvedPhase,
  user_intent: intent,
  spec_session_id: null,
  auto_mode: autoYes
};
```

**Argument assembly function:**
```javascript
// Commands that support auto-mode flags
const AUTO_FLAG_MAP = {
  'maestro-analyze':       '-y',
  'maestro-brainstorm':    '-y',
  'maestro-ui-design':     '-y',
  'maestro-plan':          '--auto',
  'maestro-spec-generate': '-y',
  'quality-test':           '--auto-fix',
};

function assembleArgs(step, context) {
  let args = step.args || '';

  // Template substitution
  args = args.replace(/\{phase\}/g, context.current_phase || '');
  args = args.replace(/\{description\}/g, context.user_intent || '');
  args = args.replace(/\{spec_session_id\}/g, context.spec_session_id || '');

  // Propagate auto flag only to commands that support it
  if (context.auto_mode) {
    const autoFlag = AUTO_FLAG_MAP[step.cmd];
    if (autoFlag && !args.includes(autoFlag)) {
      args = args ? `${args} ${autoFlag}` : autoFlag;
    }
  }

  return args.trim();
}
```

**For each step starting at `$STEP_INDEX` (default 0):**

**7a. Display step banner:**
```
------------------------------------------------------------
  STEP {i+1}/{total}: {command_name}
------------------------------------------------------------
  Args: {assembled_args}
```

**7b. Update status.json:** Set step status = `"running"`, started_at = now.

**7c. Execute via Skill():**
```javascript
Skill({ skill: step.cmd, args: assembledArgs })
```

**7d. Parse output & update context:**

After each Skill() returns, scan output for key artifacts:
- Phase number references (e.g., "Phase: 2") → update `context.current_phase`
- Spec session IDs (e.g., "SPEC-auth-2026-03-15") → update `context.spec_session_id`
- These enable downstream steps to receive correct arguments

**7e. Handle result:**

**On success:**
- Update status.json: step status = `"completed"`, completed_at = now
- Continue to next step

**On failure:**
- Update status.json: step status = `"failed"`
- If `$AUTO_MODE`: log warning, mark as `"skipped"`, continue to next step
- If interactive:
  ```
  AskUserQuestion:
    header: "Step Failed: {command_name}"
    question: "{error_description}"
    options:
      - "Retry" → re-execute (max 2 retries per step)
      - "Skip" → mark skipped, continue
      - "Abort" → save progress, display resume instructions, exit
  ```
- On Abort: **Error E003** — display: `Resume with: /maestro -c`

**7f. After all steps complete:**

Update status.json: status = `"completed"`.

Display completion report:
```
============================================================
  MAESTRO SESSION COMPLETE
============================================================
  Session:  {session_id}
  Chain:    {chain_name}
  Steps:    {completed}/{total} completed
  Phase:    {current_phase}

  Results:
    [✓] 1. {command} — completed
    [✓] 2. {command} — completed
    [—] 3. {command} — skipped
    ...

  Next:
    Skill({ skill: "maestro", args: "continue" })
    Skill({ skill: "manage-status" })
============================================================
```

---

## Chain Reference

| Chain | Steps | Use Case |
|-------|-------|----------|
| `full-lifecycle` | plan → execute → verify → review → test → transition | Full phase completion |
| `spec-driven` | init → spec-generate → plan → execute → verify | Start from idea/requirements (heavy path) |
| `roadmap-driven` | init → maestro-roadmap → plan → execute → verify | Start from requirements (light path) |
| `brainstorm-driven` | brainstorm → plan → execute → verify | Start from exploration |
| `ui-design-driven` | ui-design → plan → execute → verify | Start from UI design prototypes |
| `analyze-plan-execute` | analyze -q → plan --dir → execute --dir | Fast track without roadmap (scratch mode) |
| `execute-verify` | execute → verify | Resume after planning |
| `quality-loop` | verify → review → test-gen → test → debug → plan --gaps → execute | Fix quality issues |
| `milestone-close` | milestone-audit → milestone-complete | Close a milestone |
| *(single-step)* | Any individual command | Direct invocation |

---

## Pipeline Examples

| Input | Type | Chain | Steps |
|-------|------|-------|-------|
| `"continue"` | state_continue | (from state) | (detected by state algorithm) |
| `"status"` | status | status | manage-status |
| `"Add API endpoint"` | quick | quick | maestro-quick |
| `"plan phase 2"` | plan | plan | maestro-plan 2 |
| `"execute"` | execute | execute | maestro-execute {current} |
| `"run tests"` | test | test | quality-test {current} |
| `"debug auth crash"` | debug | debug | quality-debug "auth crash" |
| `"brainstorm notification system"` | brainstorm | brainstorm-driven | brainstorm → plan → execute → verify |
| `"spec generate user auth"` | spec_generate | spec-driven | init → spec-generate → plan → execute → verify |
| `"roadmap user auth"` | roadmap | roadmap-driven | init → maestro-roadmap → plan → execute → verify |
| `"ui design landing page"` | ui_design | ui-design-driven | ui-design → plan → execute → verify |
| `"design prototypes for dashboard"` | ui_design | ui_design | maestro-ui-design |
| `"refactor auth module"` | refactor | refactor | quality-refactor |
| `"integration test payment"` | integration_test | integration-test | quality-integration-test |
| `"list critical issues"` | issue | issue | manage-issue "list critical issues" |
| `"discover issues"` | issue | issue | manage-issue "discover" |
| `"analyze issue ISS-xxx"` | issue_analyze | issue_analyze | manage-issue-analyze "ISS-xxx" |
| `"plan issue ISS-xxx"` | issue_plan | issue_plan | manage-issue-plan "ISS-xxx" |
| `"execute issue ISS-xxx"` | issue_execute | issue_execute | manage-issue-execute "ISS-xxx" |
| `"team review code"` | team_review | team_review | team-review |
| `"team qa full scan"` | team_qa | team_qa | team-quality-assurance |
| `"team test auth module"` | team_test | team_test | team-testing |
| `"team lifecycle new session"` | team_lifecycle | team_lifecycle | team-lifecycle-v4 |
| `"team tech debt scan"` | team_tech_debt | team_tech_debt | team-tech-debt |
| `"next phase"` | phase_transition | phase-transition | maestro-phase-transition |
| `"milestone audit"` | milestone_audit | milestone-close | milestone-audit → milestone-complete |
| `-y "implement feature X"` | execute | execute | maestro-execute (auto mode) |

---

## Key Design Principles

1. **State-Aware** — Reads `.workflow/state.json` to understand project context before routing
2. **Intent-Driven** — Priority regex matching classifies user text into task types
3. **Skill Composition** — Chains compose independent Skills via sequential Skill() calls
4. **Phase Propagation** — Auto-detects and passes phase numbers to downstream commands
5. **Auto Mode** — `-y` flag propagates through entire chain, skipping all confirmations
6. **Resumable** — Session state in `.workflow/.maestro/` enables resume with `-c`
7. **Progressive Clarification** — Low clarity triggers user questions (max 2 rounds)
8. **Error Resilience** — Retry/skip/abort per step, with auto-skip in `-y` mode
