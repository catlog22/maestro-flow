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

```
Parse $ARGUMENTS → extract flags, remainder is intent text.
  Flags: autoYes (-y/--yes), resumeMode (-c/--continue), dryRun (--dry-run)
  Valued: forcedChain (--chain X), execMode (--exec auto|cli|skill, default 'auto'), cliTool (--tool X, default 'claude')
  intent = arguments with all flags/valued options stripped, trimmed
```

### 1b: Handle resume mode

If `resumeMode`:
1. Scan `.workflow/.maestro/` for latest session (or session ID if specified)
2. Read `status.json` → find last completed step, remaining steps
3. Set `$CHAIN` from status.json, `$STEP_INDEX` = last_completed + 1
4. If no session found: **Error E004** — list available sessions
5. Jump to **Step 4** at resume point

### 1c: Read project state

Check `.workflow/state.json` existence.

**If exists:** Read state.json + roadmap.md. Derive progress by grouping artifacts by phase, determining furthest artifact type per phase (analyze→plan→execute→verify), and identifying pending plans. Build `$PROJECT_STATE`:
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
```
Keyword → taskType (skip to Step 3):
  continue/next/go/继续/下一步 → 'state_continue'
  status/状态/dashboard → 'status'
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

```
Route priority:
  1. issue_id present → route by action: analyze→issue_analyze, plan→issue_plan, fix/execute→issue_execute, debug→issue_analyze, manage→issue; default→issue
  2. object == 'team' → route by action: review→team_review, test→team_test, debug/analyze→team_qa, refactor→team_tech_debt, execute→team_lifecycle; default→team_coordinate
  3. action × object matrix lookup (fallback per action via '_default', global fallback 'quick'):

  fix:        bug/code/performance/security/test→debug, issue→issue; default→debug
  create:     feature→quick, issue→issue, test→test_gen, spec→spec_generate, ui→ui_design, config→init; default→quick
  analyze:    bug/code/performance/security/feature→analyze, issue→issue_analyze, codebase→spec_map; default→analyze
  explore:    issue→issue_discover, feature→brainstorm, ui→ui_design; default→brainstorm
  plan:       issue→issue_plan, spec→spec_generate, phase/milestone→plan; default→plan
  execute:    issue→issue_execute; default→execute
  verify:     default→verify
  review:     default→review
  test:       feature/code→test; default→test
  debug:      default→debug
  refactor:   default→refactor
  manage:     issue→issue, milestone→milestone_audit, phase→milestone_close, memory→memory, doc→sync, codebase→codebase_refresh, config→spec_setup, team→team_coordinate; default→status
  transition: phase→milestone_close, milestone→milestone_complete; default→milestone_close
  continue:   default→state_continue
  sync:       doc→sync, codebase→codebase_refresh; default→sync
  fork/merge/learn/retrospect/release/amend/compose: default→same name (retrospect→retrospective)
```

### 2d: Chain upgrade & clarity

**State-aware chain upgrade:**
- `issue_execute` → auto-upgrade to `issue-full` (appends review gate)
- `debug` during `executing` phase → keep single-step (state validation handles prepend/append)

**Clarity score** (from extracted intent tuple): 3 = action+object+scope, 2 = action+object, 1 = action only, 0 = neither

Display intent analysis: action, object, scope, issue_id, phase_ref, task_type, clarity score.

**Clarification** (skip if `autoYes` or clarity >= 2, max 2 rounds):
- 0 → offer: "Start new project" / "Continue working" / "Quick task" / "Check status" / "Rephrase"
- 1 → confirm inferred action with alternatives
- Still unclear after 2 rounds → **Error E002**

## Step 3: Select Chain & Prepare

### 3a: Map task_type → chain

**Resolution order:**
1. `forcedChain` → `chainMap[forcedChain]`
2. `state_continue` → `detectNextAction(projectState)` → `{ chain, argsOverride? }`. Apply argsOverride before template substitution.
3. Task-type aliases → named chain: `spec_generate`→`spec-driven`, `brainstorm`→`brainstorm-driven`, `issue_execute`→`issue-full`
4. `chainMap[taskType]` → direct lookup

Full `chainMap` and `detectNextAction` are in the [Reference Data](#reference-data) section.

### 3b: Validate against state (W003)

Cross-validate intent against project state:
- `execute` but no plan → warn, prepend `maestro-plan`
- `verify` but not executed → warn, prepend `maestro-execute`
- `test` but not verified → warn, prepend `maestro-verify`
- `milestone_close` but not all phases executed → warn, suggest completing first

Display warning but let user override.

### 3c: Resolve phase number and issue ID

```
resolvePhase — priority order:
  1. intent_analysis.phase_ref (from structured extraction)
  2. Regex match "phase N" or bare number from raw intent
  3. From project state artifacts: in-progress execute → first incomplete phase → latest artifact phase
  4. null if chain is 'analyze-plan-execute' (uses {scratch_dir} instead)
  5. null if all chain commands are phase-independent:
     manage-status, manage-issue, manage-issue-discover, maestro-init, maestro-spec-generate,
     maestro-fork, maestro-merge, maestro-roadmap, spec-setup, manage-knowhow, manage-knowhow-capture,
     manage-learn, manage-codebase-rebuild, manage-codebase-refresh, maestro-milestone-audit,
     maestro-milestone-complete
  6. Ask user

resolveIssueId — priority: intent_analysis.issue_id → regex match ISS-*-NNN from raw intent → null
```

When executing issue chains, replace `{issue_id}` in step args with resolved ID. If missing and required, prompt user.

### 3d: Confirm chain

**If `dryRun`:** Display chain visualization and exit.
**If not `autoYes`:** Confirm with user — show numbered steps, offer: Execute / Execute from step N / Cancel.

### 3e: Step-level engine selection

Engine is selected **per step**, not per chain.

```
If execMode is 'cli' or 'skill' → force that engine for all steps.
In 'auto' mode, select per step:
  CLI steps (heavy, context-isolated): maestro-plan, maestro-execute, maestro-analyze, maestro-brainstorm, maestro-spec-generate, maestro-roadmap, maestro-ui-design, quality-refactor
  Skill steps (everything else): observable, interactive, lightweight (verify, review, test, debug, milestone-*, manage-*, spec-*, quick, etc.)
```

**Trade-off:** CLI = context isolation + template prompts + gemini analysis. Skill = direct visibility + synchronous + user can intervene.

### 3f: Setup session

Create session directory `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/` and write `status.json`:
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

```
Context object tracks: current_phase, user_intent, issue_id, spec_session_id, scratch_dir, auto_mode.

assembleArgs: substitute placeholders {phase}, {description}, {issue_id}, {spec_session_id}, {scratch_dir} in step.args.
  In auto_mode, append per-command flag if not already present:
    maestro-analyze/brainstorm/roadmap/ui-design/spec-generate → -y
    maestro-plan → --auto
    quality-test → --auto-fix
    quality-retrospective → --auto-yes

Shell-escape strings with single quotes for CLI delegate calls.
```

### Step loop — for each step starting at `$STEP_INDEX` (default 0):

**4a. Select engine & display banner:**

Select engine per step (see 3e). Display step banner with index, command name, engine, args.
- Step >= 4 and not autoYes: hint user about `/maestro -c` for fresh context resume.
- autoYes and step >= 5: log warning to status.json.
- Update status.json: step status = `"running"`, engine, started_at.

**4b. Execute (engine-dependent):**

**Skill** — invoke `Skill({ skill: step.cmd, args: assembledArgs })` directly (synchronous, visible).

**CLI** — template-driven, async, context-isolated:
1. Load template `~/.maestro/templates/cli/prompts/coordinate-step.txt`
2. Build `analysisHints` from previous step's `next_step_hints` (prompt_additions, cautions, context_to_carry)
3. Substitute template placeholders: `{{COMMAND}}`, `{{ARGS}}`, `{{STEP_N}}`, `{{AUTO_DIRECTIVE}}`, `{{CHAIN_NAME}}`, `{{ANALYSIS_HINTS}}`
4. Run `maestro delegate <prompt> --to {cliTool} --mode write` via `Bash(run_in_background: true, timeout: 600000)`
5. **STOP** — wait for background callback

**4c. Parse output & update context:**

Scan step output for context propagation: `PHASE: N` → current_phase, `SPEC-xxx` → spec_session_id, `scratch_dir: path` → scratch_dir. CLI: capture exec_id from stderr.

**4d. Handle result:**

Success: mark `"completed"` in status.json. CLI: save output to `step-{N}-output.txt`.
Failure: autoYes → retry once then skip. Interactive → Retry (max 2) / Skip / Abort. Abort → **Error E003** with resume hint.

**4e. Post-step analysis (CLI steps only, multi-step chains):**

Skip if: step failed/skipped, single-step chain, or `stepEngine === 'skill'`.

Delegate to gemini (analysis mode, `--resume` if prior gemini_session_id exists) with prompt containing:
- Step command, args, chain name, intent
- Last 200 lines of step output
- Next step info (if any)

Expected JSON response:
```json
{
  "quality_score": "<0-100>",
  "execution_assessment": { "success": "<bool>", "completeness": "<full|partial|minimal>", "key_outputs": [], "missing_outputs": [] },
  "issues": [{ "severity": "critical|high|medium|low", "description": "" }],
  "next_step_hints": {
    "prompt_additions": "<extra context for next step>",
    "cautions": ["<things to watch out for>"],
    "context_to_carry": "<key facts from this step>"
  },
  "step_summary": ""
}
```

On callback: capture gemini exec_id for session continuity, store analysis in `state.step_analyses[]` and `step-{N}-analysis.json`, advance to next step (**4a**).

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
  'knowhow_capture':     [{ cmd: 'manage-knowhow-capture', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute', args: '' }],
  'knowhow':             [{ cmd: 'manage-knowhow', args: '"{description}"' }],
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

```
Returns { chain, argsOverride? }. Steps resolved from chainMap[chain].

detectNextAction(state):
  not initialized → 'init'

  phases_total == 0:
    no roadmap + has accumulated_context → 'next-milestone' with argsOverride containing deferred items and key decisions
    otherwise → 'brainstorm-driven'

  Route by phase_status (ps):
    pending:    has context artifact → 'plan'; has analysis → 'analyze-quick'; else → 'analyze'
    exploring/planning: has plan → 'execute-verify'; else → 'plan'
    executing:  all tasks done → 'verify'; has blockers → 'debug'; else → 'execute'
    verifying:
      verification passed:
        no review → 'review'
        review BLOCK → 'review-fix'
        uat pending → 'test'; uat passed → 'milestone-close'; uat failed → 'debug'
        default → 'test'
      verification not passed → 'quality-loop-partial'
    testing:    uat passed → 'milestone-close'; else → 'debug'
    completed:  → 'milestone-close'
    forked:     worktrees.json exists → 'merge'; else → 'status'
    blocked:    → 'debug'
    default:    → 'status'
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
