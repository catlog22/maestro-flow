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

**If `.workflow/state.json` missing:**
- `$PROJECT_STATE = { initialized: false }`
- If `$INTENT` is also empty: **Error E001** — suggest `maestro-init` or describe a task

---

### Step 3: Analyze Intent

**If `$FORCED_CHAIN` is set:**
- Validate against known chains: `full-lifecycle`, `spec-driven`, `brainstorm-driven`, `ui-design-driven`, `analyze-plan-execute`, `execute-verify`, `quality-loop`, `milestone-close`, `next-milestone`, `quick`, `review`, `issue-full`, `issue-quick`, `fork`, `merge`
- If valid: skip intent analysis, jump to **Step 5**
- If invalid: display valid chains, ask user to choose

#### 3a: Exact-match keywords (fast path)

Before LLM extraction, check for exact-match special keywords:

```javascript
const exactMatch = {
  'continue': 'state_continue', 'next': 'state_continue', 'go': 'state_continue',
  '继续': 'state_continue', '下一步': 'state_continue',
  'status': 'status', '状态': 'status', 'dashboard': 'status',
};
const normalized = intent.toLowerCase().trim();
if (exactMatch[normalized]) {
  taskType = exactMatch[normalized];
  // → skip to Step 5
}
```

#### 3b: Structured intent extraction (LLM-native)

Instead of regex pattern matching, extract a structured intent tuple from the user's natural language. This leverages the LLM's semantic understanding to disambiguate polysemous words (e.g., "问题" as bug vs. issue-tracker item).

**Extract the following JSON from the user input:**

```json
{
  "action":    "<from enum>",
  "object":    "<from enum>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low | normal | high>"
}
```

**Action enum** (what the user wants to do):

| action | Triggered by (semantic, not regex) |
|--------|-----------------------------------|
| `create` | Build something new — new feature, new component, new spec, new project |
| `fix` | Repair something broken — fix bug, resolve error, patch, 修复, 修, 解决 |
| `analyze` | Understand something — analyze, evaluate, assess, investigate, 分析, 评估 |
| `plan` | Design approach — plan, break down, design, architect, 规划, 分解 |
| `execute` | Implement planned work — execute, implement, develop, code, 实现, 开发 |
| `verify` | Check completeness against goals — verify, validate, check goals, 验证 |
| `review` | Evaluate code quality — review code, code review, 代码审查 |
| `test` | Run or create tests — test, UAT, acceptance, 测试, 验收 |
| `debug` | Diagnose failures — debug, diagnose, troubleshoot, 调试, 排查 |
| `refactor` | Restructure without behavior change — refactor, clean up, tech debt, 重构 |
| `explore` | Open-ended discovery — brainstorm, ideate, discover, explore, 头脑风暴, 发散 |
| `manage` | CRUD / lifecycle ops — list, create issue, close, update, track, 管理 |
| `transition` | Move to next phase/milestone — next phase, advance, complete milestone |
| `continue` | Resume work — continue, next, go on, 继续 |
| `sync` | Update docs/state — sync, refresh, update docs, 同步 |
| `fork` | Create worktree for parallel milestone — fork, worktree, parallel, 分叉, 并行 |
| `merge` | Merge worktree back — merge worktree, merge milestone, 合并工作树 |
| `learn` | Capture insights — learn, capture insight, eureka, 记录洞察 |
| `retrospect` | Post-mortem review — retrospective, retro, 复盘, post-mortem |

**Object enum** (what the action targets):

| object | Meaning |
|--------|---------|
| `feature` | New functionality or enhancement |
| `bug` | Defect, error, broken behavior (includes "问题" when meaning "something is wrong") |
| `issue` | Issue-tracker item (includes "问题" when meaning "tracked issue for management") |
| `code` | Source code in general |
| `test` | Tests, test suite, test coverage |
| `spec` | Specification, PRD, product requirements |
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

**Disambiguation rules for "问题" / "issue" / "problem":**
- "问题" / "problem" describing **something broken or wrong** → `object: "bug"` (route to debug/fix)
- "问题" / "issue" referring to **a tracked item** (especially with ISS-ID, or in context of "create/list/manage issue") → `object: "issue"` (route to issue management)
- When ambiguous, prefer `"bug"` — it routes to the main workflow (debug) which is more actionable

#### 3c: Route via action × object matrix

```javascript
function routeIntent(intent, projectState) {
  const { action, object, issue_id, phase_ref } = intent;

  // ── Hard signal: explicit issue ID → issue pipeline ──
  if (issue_id) {
    const issueRoutes = {
      'analyze': 'issue_analyze',
      'plan':    'issue_plan',
      'fix':     'issue_execute',
      'execute': 'issue_execute',
      'debug':   'issue_analyze',
      'manage':  'issue',
    };
    return { taskType: issueRoutes[action] || 'issue', issueId: issue_id };
  }

  // ── Action × Object routing matrix ──
  const matrix = {
    'fix': {
      'bug':         'debug',
      'issue':       'issue',
      'code':        'debug',
      'performance': 'debug',
      'security':    'debug',
      'test':        'debug',
      '_default':    'debug',
    },
    'create': {
      'feature':     'quick',           // new feature without lifecycle → quick
      'issue':       'issue',
      'test':        'test_gen',
      'spec':        'spec_generate',
      'ui':          'ui_design',
      'config':      'init',
      'phase':       'phase_add',
      '_default':    'quick',
    },
    'analyze': {
      'bug':         'analyze',
      'issue':       'issue_analyze',
      'code':        'analyze',
      'performance': 'analyze',
      'security':    'analyze',
      'feature':     'analyze',
      'codebase':    'spec_map',
      '_default':    'analyze',
    },
    'explore': {
      'issue':       'issue_discover',
      'feature':     'brainstorm',
      'ui':          'ui_design',
      '_default':    'brainstorm',
    },
    'plan': {
      'issue':       'issue_plan',
      'spec':        'spec_generate',
      'phase':       'plan',
      'milestone':   'plan',
      '_default':    'plan',
    },
    'execute': {
      'issue':       'issue_execute',
      '_default':    'execute',
    },
    'verify':      { '_default': 'verify' },
    'review':      { '_default': 'review' },
    'test': {
      'feature':     'test',
      'code':        'test',
      '_default':    'test',
    },
    'debug':       { '_default': 'debug' },
    'refactor':    { '_default': 'refactor' },
    'manage': {
      'issue':       'issue',
      'milestone':   'milestone_audit',
      'phase':       'milestone_close',
      'memory':      'memory',
      'doc':         'sync',
      'codebase':    'codebase_refresh',
      'config':      'spec_setup',
      'team':        'team_coordinate',
      '_default':    'status',
    },
    'transition': {
      'phase':       'milestone_close',
      'milestone':   'milestone_complete',
      '_default':    'milestone_close',
    },
    'continue':    { '_default': 'state_continue' },
    'sync': {
      'doc':         'sync',
      'codebase':    'codebase_refresh',
      '_default':    'sync',
    },
    'fork':        { '_default': 'fork' },
    'merge':       { '_default': 'merge' },
    'learn':       { '_default': 'learn' },
    'retrospect':  { '_default': 'retrospective' },
  };

  const actionMap = matrix[action];
  if (!actionMap) return { taskType: 'quick' };

  const taskType = actionMap[object] || actionMap['_default'] || 'quick';

  // ── Team skill detection ──
  if (object === 'team') {
    const teamRoutes = {
      'review':    'team_review',
      'test':      'team_test',
      'debug':     'team_qa',
      'analyze':   'team_qa',
      'refactor':  'team_tech_debt',
      'execute':   'team_lifecycle',
      'plan':      'team_coordinate',
      '_default':  'team_coordinate',
    };
    return { taskType: teamRoutes[action] || 'team_coordinate' };
  }

  return { taskType };
}
```

#### 3d: State-aware chain upgrade

After routing, check if the resolved command should be upgraded to a multi-step chain based on project state:

```javascript
function upgradeChain(taskType, projectState) {
  // Issue execute → auto-append review gate
  if (taskType === 'issue_execute') {
    return 'issue-full';  // analyze → plan → execute → review
  }

  // Debug/fix in executing phase → debug + re-execute + verify
  if (taskType === 'debug' && projectState.initialized && projectState.phase_status === 'executing') {
    return null;  // keep single-step, but state validation (5b) will prepend/append as needed
  }

  return null;  // no upgrade, use default chainMap lookup
}
```

#### 3e: Compute clarity score

From the extracted intent tuple:
- 3: `action` + `object` + `scope` all present (e.g., "plan phase 2 with gap fixes")
- 2: `action` + `object` present (e.g., "run tests on auth module")
- 1: Only `action` present, or only vague `object` (e.g., "help with quality")
- 0: Neither `action` nor `object` could be extracted

**Output:**
```
  Intent Analysis:
    Action:     {action}
    Object:     {object}
    Scope:      {scope or "none"}
    Issue ID:   {issue_id or "none"}
    Task type:  {task_type}
    Clarity:    {clarity_score}/3
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

  // Post-milestone state: initialized, no roadmap, has accumulated_context
  // This happens after milestone-complete deletes roadmap.md
  const hasRoadmap = fileExists('.workflow/roadmap.md');
  if (state.phases_total === 0 && !hasRoadmap && state.accumulated_context) {
    // Format deferred items and key decisions as context for new roadmap
    const deferred = (state.accumulated_context.deferred || []).join('; ');
    const decisions = (state.accumulated_context.key_decisions || []).join('; ');
    const context = [
      deferred ? `Deferred from previous milestone: ${deferred}` : '',
      decisions ? `Key decisions carried forward: ${decisions}` : ''
    ].filter(Boolean).join('. ');
    return {
      chain: 'next-milestone',
      steps: [
        { cmd: 'maestro-roadmap', args: `"Plan next milestone. ${context}"` }
      ]
    };
  }

  // No phases exist and no prior context — fresh start
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
      if (uat === 'passed') return { chain: 'milestone-close', steps: ['maestro-milestone-audit', 'maestro-milestone-complete'] };
      if (uat === 'failed') return { chain: 'debug', steps: ['quality-debug --from-uat {phase}'] };
      if (uat === 'in_progress') return { chain: 'test', steps: ['quality-test'] };
      return { chain: 'test', steps: ['quality-test'] };
    }
    // Verification has gaps
    return { chain: 'quality-loop-partial', steps: ['maestro-plan --gaps', 'maestro-execute', 'maestro-verify'] };
  }

  // Testing
  if (ps === 'testing') {
    if (uat === 'passed') return { chain: 'milestone-close', steps: ['maestro-milestone-audit', 'maestro-milestone-complete'] };
    return { chain: 'debug', steps: ['quality-debug --from-uat {phase}'] };
  }

  // Phase completed
  if (ps === 'completed') {
    if (state.phases_completed >= state.phases_total)
      return { chain: 'milestone-close', steps: ['maestro-milestone-audit', 'maestro-milestone-complete'] };
    return { chain: 'milestone-close', steps: ['maestro-milestone-audit', 'maestro-milestone-complete'] };
  }

  // Phase forked (developed in a worktree)
  if (ps === 'forked') {
    // Check if worktree is complete — suggest merge
    if (fileExists('.workflow/worktrees.json')) {
      return { chain: 'merge', steps: ['maestro-merge'] };
    }
    return { chain: 'status', steps: ['manage-status'] };
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
  'retrospective':      [{ cmd: 'quality-retrospective', args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn', args: '"{description}"' }],
  'sync':               [{ cmd: 'quality-sync', args: '{phase}' }],
  'milestone_close':   [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
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
    { cmd: 'maestro-milestone-audit' }
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
  ],
  'next-milestone': [
    { cmd: 'maestro-roadmap', args: '"{description}"' },
    { cmd: 'maestro-plan', args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify', args: '{phase}' }
  ],
  // Issue lifecycle chains (with quality gates)
  'issue-full': [
    { cmd: 'maestro-analyze', args: '--gaps {issue_id}' },
    { cmd: 'maestro-plan', args: '--gaps' },
    { cmd: 'maestro-execute', args: '' },
    { cmd: 'quality-review', args: '--scope {affected_files}' },
    { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }
  ],
  'issue-quick': [
    { cmd: 'maestro-plan', args: '--gaps' },
    { cmd: 'maestro-execute', args: '' },
    { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }
  ]
};

// Map task_type → chain (when task_type should use a multi-step chain instead of single-step)
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm': 'brainstorm-driven',
  'issue_execute': 'issue-full',    // issue execute always gets review gate
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
- Intent says `milestone_close` but not all phases executed → warn, suggest completing execution first

Display warning but let user override.

#### 5c: Resolve phase number and issue ID

```javascript
function resolvePhase(intent_analysis, project_state) {
  // 1. From structured extraction
  if (intent_analysis.phase_ref) return intent_analysis.phase_ref;

  // 2. Fallback: regex on raw intent text
  const phaseMatch = intent.match(/phase\s*(\d+)|^(\d+)$/);
  if (phaseMatch) return phaseMatch[1] || phaseMatch[2];

  // 3. From project state
  if (project_state.initialized) return project_state.current_phase;

  // 4. Scratch mode chains use {scratch_dir} instead of {phase}
  if (chainName === 'analyze-plan-execute') return null;

  // 5. Chain doesn't need phase (init, status, memory, issue, etc.)
  const noPhaseCommands = ['manage-status', 'manage-issue', 'manage-issue-discover',
    'maestro-init', 'maestro-spec-generate', 'maestro-fork', 'maestro-merge',
    'maestro-roadmap', 'spec-setup', 'manage-memory', 'manage-memory-capture', 'manage-learn',
    'manage-codebase-rebuild', 'manage-codebase-refresh', 'maestro-milestone-audit',
    'maestro-milestone-complete', 'maestro-milestone-audit'];
  if (chain.every(s => noPhaseCommands.includes(s.cmd))) return null;

  // 6. Ask user
  return askUserForPhase();
}

// Resolve issue ID for issue chains
function resolveIssueId(intent_analysis) {
  // 1. From structured extraction
  if (intent_analysis.issue_id) return intent_analysis.issue_id;

  // 2. Fallback: regex on raw intent text
  const issueMatch = intent.match(/ISS-[\w]+-\d+/i);
  if (issueMatch) return issueMatch[0];

  return null;
}
```

When executing issue chains (`issue-full`, `issue-quick`), replace `{issue_id}` in step args with the resolved issue ID. If no issue ID is found and the chain requires one, prompt the user.

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
  issue_id: resolvedIssueId,
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
  'quality-retrospective': '--auto-yes',
};

function assembleArgs(step, context) {
  let args = step.args || '';

  // Template substitution
  args = args.replace(/\{phase\}/g, context.current_phase || '');
  args = args.replace(/\{description\}/g, context.user_intent || '');
  args = args.replace(/\{issue_id\}/g, context.issue_id || '');
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

**7a-1. Context cleanup hint (after step 3+):**

If `i >= 3` and not `$AUTO_MODE`:
```
  ⚡ 已执行 {i} 步，上下文较重。可随时 /maestro -c 在新上下文中恢复。
```
If `$AUTO_MODE` and `i >= 4`: log one-line warning to status.json, continue.

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
| `full-lifecycle` | plan → execute → verify → review → test → milestone-audit → milestone-complete | Full milestone completion |
| `spec-driven` | init → spec-generate → plan → execute → verify | Start from idea/requirements (heavy path) |
| `roadmap-driven` | init → maestro-roadmap → plan → execute → verify | Start from requirements (light path) |
| `brainstorm-driven` | brainstorm → plan → execute → verify | Start from exploration |
| `ui-design-driven` | ui-design → plan → execute → verify | Start from UI design prototypes |
| `analyze-plan-execute` | analyze -q → plan --dir → execute --dir | Fast track without roadmap (scratch mode) |
| `execute-verify` | execute → verify | Resume after planning |
| `quality-loop` | verify → review → test-gen → test → debug → plan --gaps → execute | Fix quality issues |
| `milestone-close` | milestone-audit → milestone-complete | Close a milestone |
| `next-milestone` | maestro-roadmap → plan → execute → verify | Start next milestone (auto-loads deferred items) |
| `issue-full` | analyze → plan → execute → review → close | Issue with quality gate (default for issue execute) |
| `issue-quick` | plan → execute → close | Issue fast path (use `--chain issue-quick`) |
| *(single-step)* | Any individual command | Direct invocation |

---

## Pipeline Examples

Shows how structured extraction routes common inputs — especially cases where regex previously misrouted:

| Input | Extraction | Task Type | Chain |
|-------|-----------|-----------|-------|
| `"continue"` | *(exact match)* | state_continue | (from state) |
| `"status"` | *(exact match)* | status | manage-status |
| `"Add API endpoint"` | `{create, feature}` | quick | maestro-quick |
| `"plan phase 2"` | `{plan, phase, phase_ref:2}` | plan | maestro-plan 2 |
| `"execute"` | `{execute, code}` | execute | maestro-execute |
| `"run tests"` | `{test, test}` | test | quality-test |
| `"debug auth crash"` | `{debug, bug, scope:"auth"}` | debug | quality-debug |
| `"修复登录问题"` | `{fix, bug, scope:"登录"}` | debug | quality-debug |
| `"fix this issue"` | `{fix, bug}` | debug | quality-debug |
| `"fix issue ISS-abc-001"` | `{fix, issue, ISS-abc-001}` | issue_execute | issue-full (analyze→plan→execute→review→close) |
| `"解决性能问题"` | `{fix, performance}` | debug | quality-debug |
| `"这个问题需要看看"` | `{analyze, bug}` | analyze | maestro-analyze |
| `"创建一个 issue 跟踪"` | `{manage, issue}` | issue | manage-issue |
| `"discover issues"` | `{explore, issue}` | issue_discover | manage-issue-discover |
| `"analyze issue ISS-xxx"` | `{analyze, issue, ISS-xxx}` | issue_analyze | maestro-analyze --gaps |
| `"plan issue ISS-xxx"` | `{plan, issue, ISS-xxx}` | issue_plan | maestro-plan --gaps |
| `"brainstorm notification system"` | `{explore, feature}` | brainstorm | brainstorm-driven |
| `"spec generate user auth"` | `{create, spec}` | spec_generate | spec-driven |
| `"ui design landing page"` | `{create, ui}` | ui_design | ui-design-driven |
| `"refactor auth module"` | `{refactor, code}` | refactor | quality-refactor |
| `"复盘 phase 2"` | `{retrospect, phase}` | retrospective | quality-retrospective |
| `"team review code"` | `{review, team}` | team_review | team-review |
| `"team qa full scan"` | `{analyze, team}` | team_qa | team-quality-assurance |
| `"next phase"` | `{transition, milestone}` | milestone_close | maestro-milestone-audit → milestone-complete |
| `"milestone audit"` | `{manage, milestone}` | milestone_audit | maestro-milestone-audit |
| `-y "implement feature X"` | `{execute, feature}` | execute | maestro-execute (auto mode) |

---

## Key Design Principles

1. **Semantic Routing** — LLM-native structured extraction (`action × object`) replaces regex pattern matching; disambiguates polysemous words like "问题" by semantic context
2. **State-Aware** — Reads `.workflow/state.json` to understand project context before routing
3. **Quality Gates** — Issue chains auto-include review steps; `issue-full` is the default for issue execution
4. **Skill Composition** — Chains compose independent Skills via sequential Skill() calls
5. **Phase Propagation** — Auto-detects and passes phase numbers to downstream commands
6. **Auto Mode** — `-y` flag propagates through entire chain, skipping all confirmations
7. **Resumable** — Session state in `.workflow/.maestro/` enables resume with `-c`
8. **Progressive Clarification** — Low clarity triggers user questions (max 2 rounds)
9. **Error Resilience** — Retry/skip/abort per step, with auto-skip in `-y` mode
