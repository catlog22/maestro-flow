<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: maestro

## Step 1: Parse & Initialize

### 1a: Parse arguments

```
Parse $ARGUMENTS → extract flags, remainder is intent text.
  Flags: autoYes (-y/--yes), dryRun (--dry-run)
  Valued: execMode (--exec auto|cli|internal, default 'auto'), cliTool (--tool X, default 'claude')
  intent = arguments with all flags/valued options stripped, trimmed
```

### 1b: Read project state

Check `.workflow/state.json` existence.

**If exists:** Read state.json + roadmap.md. Derive progress by grouping artifacts by phase, determining furthest artifact type per phase (analyze→plan→execute), and identifying pending plans. Build `$PROJECT_STATE`:
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

### 1c: Display banner

```
============================================================
  MAESTRO COORDINATOR
============================================================
  Mode:  {intent-based | state-based}
  Auto:  {yes | no}
  Exec:  {auto | cli | internal}
  Input: {intent or "continue"}
```

## Step 2: Analyze Intent

### 2a: Fast path — forced chain or exact match

**Exact-match keywords:**
```
Keyword → taskType (skip to Step 3):
  continue/next/go/继续/下一步 → 'state_continue'

Short-circuit (execute immediately, no chain):
  status/状态/dashboard → Skill({ skill: "manage-status" }). **End.**
```

### 2b: Semantic intent matching

Directly match user intent to the best `task_type` (maps to chain in chainMap). Use LLM semantic understanding — no rigid keyword lookup.

**Output:**
```json
{
  "task_type": "<from chain catalog below>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low | normal | high>"
}
```

**Chain catalog — select by best semantic fit:**

| task_type | When user intent is about... |
|-----------|---------------------------|
| `quick` | Simple/small task, add a feature, quick change |
| `plan` | Plan, design, architect a phase |
| `execute` | Implement, develop, code a phase (includes built-in verification gate) |
| `analyze` | Understand, investigate, evaluate code |
| `review` | Code quality review |
| `test` | Run or create tests, UAT |
| `test_gen` | Generate tests for coverage gaps |
| `debug` | Diagnose, troubleshoot, fix broken behavior |
| `refactor` | Restructure, clean up, reduce tech debt |
| `init` | Initialize project |
| `sync` | Update/sync documentation |
| `retrospective` | Phase review, post-mortem, 复盘 |
| `learn` | Capture insights, record learnings |
| `release` | Publish, ship, tag version |
| `fork` | Create worktree for parallel dev |
| `merge` | Merge worktree back |
| `amend` | Revise workflow commands |
| `compose` | Design/compose reusable workflows |
| `overlay` | Create/edit command overlays |
| `update` | Update maestro itself |
| `harvest` | Extract knowledge from artifacts |
| `domain_add` | Register a domain term into glossary |
| `domain_list` | List registered domain terms |
| `domain_discover` | Discover domain term candidates from codebase |
| `wiki` | Manage wiki graph |
| `knowhow` | Manage knowhow entries |
| `impeccable_chain` | UI design — explore, general |
| `impeccable_build` | Build new UI from scratch |
| `impeccable_improve` | Improve/fix existing UI |
| `issue` | Issue CRUD — create, list, close, query |
| `issue_discover` | Discover/find issues in codebase |
| `issue_analyze` | Analyze a specific issue |
| `issue_plan` | Plan fix for an issue |
| `issue_execute` | Fix issue end-to-end (auto-upgrades to issue-full) |
| `team_coordinate` | Team multi-agent coordination (general) |
| `team_review` | Team code review |
| `team_test` | Team testing |
| `team_qa` | Team QA, debugging |
| `team_tech_debt` | Team tech debt remediation |
| `team_lifecycle` | Team full lifecycle (plan+dev+test+review) |
| `full-lifecycle` | Complete phase: plan→execute→review→test→audit |
| `grill` | Stress-test a plan/idea against codebase reality (Socratic; `-y` → Auto mode code-answers, stage NOT skipped) |
| `blueprint` | Formal spec package — 7-phase spec-generate |
| `analyze-macro` | Broad/medium intent, no numeric phase — produces scope_verdict for ralph `post-analyze-scope` |
| `brainstorm-driven` | Start from exploration/brainstorm |
| `spec-driven` | From spec/requirements (heavy, with init) |
| `roadmap-driven` | From requirements (light, with init) |
| `analyze-plan-execute` | Fast track: analyze→plan→execute |
| `review-fix` | Fix review-blocked issues |
| `quality-loop` | Full quality improvement cycle |
| `quality-loop-partial` | Partial quality fix |
| `milestone-close` | Close/transition milestone |
| `milestone-release` | Release milestone with version tag |
| `next-milestone` | Advance to next milestone |
| `state_continue` | Continue from current project state |

**Selection priorities:**
1. `issue_id` present → prefer issue chains
2. "team" context → prefer team chains
3. UI/design/界面/页面/原型 → prefer impeccable chains
4. Multiple lifecycle steps implied → prefer multi-step chains
5. Single specific action → prefer single-step chains
6. "问题" describing broken behavior → `debug`; tracked item with ISS-ID → `issue`; ambiguous → `debug`
7. Simple task, no lifecycle context → `quick`
8. Global fallback → `quick`

### 2c: Chain upgrade & clarity

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
1. `state_continue` → `detectNextAction(projectState)` → `{ chain, argsOverride? }`. Apply argsOverride before template substitution.
2. Task-type aliases → named chain: `spec_generate`→`spec-driven`, `brainstorm`→`brainstorm-driven`, `grill`→`grill-driven`, `blueprint`→`blueprint-driven`, `analyze_macro`→`analyze-plan-execute`, `issue_execute`→`issue-full`
3. `chainMap[taskType]` → direct lookup

Full `chainMap` and `detectNextAction` are in the [Reference Data](#reference-data) section.

### 3b: Validate against state (W003)

Cross-validate intent against project state:
- `execute` but no plan → warn, prepend `maestro-plan`
- `test` but not executed → warn, prepend `maestro-execute`
- `milestone_close` but not all phases executed → warn, suggest completing first

Display warning but let user override.

### 3c: Resolve phase number and issue ID

```
resolvePhase — priority order:
  1. intent_analysis.phase_ref (from structured extraction)
  2. Regex match "phase N" or bare number from raw intent
  3. From project state artifacts: in-progress execute → first incomplete phase → latest artifact phase
  4. null if chain is 'analyze-plan-execute' (uses {run_dir} instead)
  5. null if all chain commands are phase-independent:
     manage-status, manage-issue, manage-issue-discover, maestro-init,
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
If user chooses "Execute from step N": set `$START_STEP = N` (used in 3f to set `current_step`).

### 3e: Step-level command resolution (v1)

> **Superseded by `ralph_protocol_version: "2"`.** The command body resolves `command_scope`/`command_path` per execution step via `maestro ralph skills --platform claude --json --quiet`; cross-step gates carry `step.decision`. Do NOT write a per-step `type` field (legacy skill/cli). `--exec` is recorded to `legacy_options.exec_mode` only — it never changes execution. FSM owns step ordering + decision evaluation (control-plane precedence, see command-body invariant 15).

```
If execMode is 'cli' or 'internal' → force that type for all steps ("cli" or "skill").
In 'auto' mode, select per step:
  CLI steps (heavy, context-isolated): maestro-plan, maestro-execute, maestro-analyze, maestro-brainstorm, maestro-roadmap, maestro-impeccable, quality-refactor → type: "cli"
  Skill steps (everything else): current-session Skill() call — review, test, debug, milestone-*, manage-*, spec-*, quick, etc. → type: "skill"
```

**Trade-off:** CLI = context isolation + template prompts. Skill = current-session Skill() call, direct visibility + synchronous + user can intervene.

### 3f: Low-complexity fast path (before session creation)

If ALL conditions met:
- clarity >= 2
- task_type == `'quick'` or (action == `'create'` && object == `'feature'`)
- NOT `state_continue`

Then: `Skill({ skill: "maestro-quick", args: '"{description}"' })`. **End.** (no session created, no status.json)

### 3g: Setup session

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
  "context": {
    "issue_id": "{resolved_issue_id or null}",
    "milestone_num": "{current_milestone_num or null}",
    "spec_session_id": null,
    "run_dir": null,
    "plan_dir": null,
    "analysis_dir": null,
    "brainstorm_dir": null
  },
  "source": "maestro",
  "updated_at": "{ISO timestamp}",
  "milestone": null,
  "lifecycle_position": null,
  "target": null,
  "waves": [],
  "steps": [{ "index": 0, "skill": "{chainMap[].cmd}", "args": "{chainMap[].args}", "type": "{cli|skill from 3e}", "status": "pending", "started_at": null, "completed_at": null, "error": null }],
  "current_step": "{$START_STEP or 0}",
  "status": "running"
}
```

### 3h: Initialize TodoWrite tracking

Create TodoWrite entries with `MAESTRO:{chain_name}:` prefix for UI-visible progress tracking. TodoWrite and status.json form dual-track system — TodoWrite for user visibility, status.json for persistence and resume.

```javascript
const todos = steps.map((step, i) => ({
  content: `MAESTRO:${chain_name}: [${i + 1}/${steps.length}] ${step.skill}`,
  status: i === 0 ? 'in_progress' : 'pending'
}));
TodoWrite({ todos });
```

## Step 4: Dispatch to unified executor

status.json already created in Step 3g, TodoWrite initialized in Step 3h.

```
Skill({ skill: "maestro-ralph-execute" })
```

The unified executor discovers the latest running session from `.workflow/.maestro/*/status.json` and executes steps in order. maestro sessions (source: "maestro") are `ralph_protocol_version: "2"`: execution steps load via `maestro ralph next`; any `step.decision` node hands off to `Skill("maestro-ralph")` for evaluation (same mechanism as ralph sessions). Decision nodes ARE supported in maestro sessions.

---

## Reference Data

### Chain Map

```javascript
const chainMap = {
  // ── Single-step ──
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'grill':              [{ cmd: 'maestro-grill', args: '"{description}"' }],
  'blueprint':          [{ cmd: 'maestro-blueprint', args: '"{description}"' }],
  'analyze-macro':      [{ cmd: 'maestro-analyze', args: '"{description}"' }],
  'analyze':            [{ cmd: 'maestro-analyze', args: '{phase}' }],
  'analyze-quick':      [{ cmd: 'maestro-analyze', args: '{phase} -q' }],
  'ui_design':          [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }],
  'impeccable_chain':           [{ cmd: 'maestro-impeccable', args: '"{description}"' }],
  'impeccable_build':     [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }],
  'impeccable_improve':   [{ cmd: 'maestro-impeccable', args: '"{description}" --chain improve' }],
  'plan':               [{ cmd: 'maestro-plan', args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute', args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-auto-test', args: '{phase}' }],
  'auto_test':          [{ cmd: 'quality-auto-test', args: '{phase}' }],
  'test':               [{ cmd: 'quality-test', args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug', args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-auto-test', args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor', args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review', args: '{phase}' }],
  'retrospective':      [{ cmd: 'quality-retrospective', args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn', args: '"{description}"' }],
  'sync':               [{ cmd: 'manage sync codebase' }],
  'milestone_close':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'domain_add':         [{ cmd: 'domain-add', args: '"{description}"' }],
  'domain_list':        [{ cmd: 'domain-list' }],
  'domain_discover':    [{ cmd: 'domain-discover' }],
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
  'full-lifecycle':       [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-milestone-audit' }, { cmd: 'manage-harvest', args: '--auto' }],
  'spec-driven':          [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '--mode full "{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'roadmap-driven':       [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'grill-driven':         [{ cmd: 'maestro-grill', args: '"{description}"' }, { cmd: 'maestro-brainstorm', args: '"{description}" --from grill:{grill_id}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'blueprint-driven':     [{ cmd: 'maestro-init' }, { cmd: 'maestro-blueprint', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'brainstorm-driven':    [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'brainstorm_visualize': [{ cmd: 'brainstorm-visualize', args: '"{description}"' }],
  'impeccable-build':       [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'impeccable-driven':      [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {run_dir}' }, { cmd: 'maestro-execute', args: '--dir {run_dir}' }, { cmd: 'manage-harvest', args: '--auto' }],
  'quality-loop':         [{ cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-auto-test', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close':      [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'next-milestone':       [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'review-fix':           [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }],
  'quality-loop-partial': [{ cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'issue-full':           [{ cmd: 'maestro-analyze', args: '--gaps {issue_id}' }, { cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }, { cmd: 'manage-harvest', args: '--auto' }],
  'issue-quick':          [{ cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
  'milestone-release':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-release' }],

  'learn':                [{ cmd: 'maestro-learn', args: '"{description}"' }],
  'harvest':              [{ cmd: 'manage-harvest', args: '"{description}"' }],
  'wiki':                 [{ cmd: 'manage-wiki' }],
  'wiki_connect':         [{ cmd: 'wiki-connect' }],
  'wiki_digest':          [{ cmd: 'wiki-digest' }],
  'business_test':        [{ cmd: 'quality-auto-test', args: '{phase}' }],
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
    exploring/planning: has plan → 'execute'; else → 'plan'
    executing:  all tasks done → 'review'; has blockers → 'debug'; else → 'execute'
    exec completed (verification is built-in):
      no review → 'review'
      review BLOCK → 'review-fix'
      uat pending → 'test'; uat passed → 'milestone-close'; uat failed → 'debug'
      default → 'test'
    testing:    uat passed → 'milestone-close'; else → 'debug'
    completed:  → 'milestone-close'
    forked:     worktrees.json exists → 'merge'; else → 'status'
    blocked:    → 'debug'
    default:    → 'status'
```

### Chain Reference

| Chain | Steps | Use Case |
|-------|-------|----------|
| `full-lifecycle` | plan → execute → review → test → audit → harvest | Full milestone completion |
| `blueprint-driven` | init → blueprint → plan → execute → harvest | From idea/requirements (heavy) |
| `roadmap-driven` | init → roadmap → plan → execute → harvest | From requirements (light) |
| `brainstorm-driven` | brainstorm → plan → execute → harvest | From exploration |
| `impeccable-build` | impeccable --chain build → plan → execute | From design system generation |
| `analyze-plan-execute` | analyze -q → plan --dir → execute --dir → harvest | Fast track (ad-hoc Run mode) |
| `review-fix` | plan --gaps → execute → review | Fix review-blocked issues |
| `quality-loop` | review → auto-test → test → debug → plan --gaps → execute | Fix quality issues |
| `quality-loop-partial` | plan --gaps → execute | Partial quality fix cycle |
| `milestone-close` | audit → complete | Close a milestone |
| `milestone-release` | audit → release | Release with version tag |
| `next-milestone` | roadmap → plan → execute | Next milestone (auto-loads deferred) |
| `issue-full` | analyze → plan → execute → review → close → harvest | Issue with quality gate |
| `issue-quick` | plan → execute → close | Issue fast path |

### Pipeline Examples

| Input | task_type | Chain |
|-------|-----------|-------|
| `"continue"` | *(2a exact)* state_continue | (from state) |
| `"status"` | *(2a exact)* status | manage-status |
| `"plan phase 2"` | plan | maestro-plan 2 |
| `"execute"` | execute | maestro-execute |
| `"Add API endpoint"` | quick | maestro-quick |
| `"run tests"` | test | quality-test |
| `"debug auth crash"` | debug | quality-debug "auth crash" |
| `"修复登录问题"` | debug | quality-debug "登录" |
| `"fix issue ISS-abc-001"` | issue_execute | issue-full |
| `"这个问题需要看看"` | analyze | maestro-analyze |
| `"创建一个 issue 跟踪"` | issue | manage-issue |
| `"discover issues"` | issue_discover | manage-issue-discover |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm→plan→execute |
| `"spec generate auth"` | spec-driven | init→spec→plan→execute |
| `"ui design landing"` | impeccable_build | maestro-impeccable --chain build |
| `"优化界面交互"` | impeccable_improve | maestro-impeccable --chain improve |
| `"refactor auth module"` | refactor | quality-refactor "auth module" |
| `"复盘 phase 2"` | retrospective | quality-retrospective 2 |
| `"team review code"` | team_review | team-review |
| `"next phase"` | milestone-close | audit→complete |
| `-y "implement X"` | execute | maestro-execute (auto) |
| `"release v1.2"` | release | maestro-milestone-release |
| `"从需求开始做完整个项目"` | spec-driven | init→spec→plan→execute |
| `"分析完直接改"` | analyze-plan-execute | analyze→plan→execute |
| `"review 有问题需要修"` | review-fix | plan --gaps→execute→review |
| `"全面质量检查"` | quality-loop | review→test→debug→plan→execute |

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
4. **Per-Step Type** — Each step independently typed as `"skill"` or `"cli"`. Heavy steps (plan, execute, analyze, brainstorm) → CLI for context isolation. Observable steps (review, test, debug, manage-*) → Skill (current-session) for direct visibility. `--exec cli|internal` forces all steps.
5. **Unified Executor** — All execution dispatched to `maestro-ralph-execute`, which handles both maestro (static chain) and ralph (adaptive chain with decision nodes) sessions.
6. **Phase Propagation** — Auto-detects and passes phase numbers to downstream commands
7. **Auto Mode** — `-y` propagates through chain, skipping all confirmations
8. **Resumable** — Session state in `.workflow/.maestro/` enables `-c` resume
9. **Error Resilience** — Retry/skip/abort per step; auto-skip in `-y` mode
