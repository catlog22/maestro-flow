<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: maestro — Chain Catalog

> 本文件是 `/maestro` 命令体（A_CLASSIFY_INTENT）消费的**语义目录**：意图 → task_type → chain。
> 执行流程（状态机、session 创建、`Agent(ralph-executor)` 派发、决策评估、compose/play 模板系统）全部在命令体内定义，本文件不含执行语义。
>
> **cmd 记法**：裸名称（`plan`、`execute`、`review`…）= first-tier step，来自 prepare/workflows 步骤注册表（build 期经 `maestro ralph skills --steps` 预校验，执行期由 `run next` 的 `resolveStepContent()` 加载）；`manage X` / `spec X` = dispatcher 命令 + 子命令参数；`maestro-*`、`quality-refactor`、`team-*` = 独立 command/skill 名。

## Intent → task_type

### Exact-match keywords

```
continue/next/go/继续/下一步 → 'state_continue'
status/状态/dashboard        → 'status'
```

### Semantic matching

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
| `fork` | Create worktree for parallel dev |
| `merge` | Merge worktree back |
| `compose` | Design/compose reusable workflows *(handled by command body A_COMPOSE_TEMPLATE — no chain)* |
| `play` | Run a saved workflow template *(handled by command body A_PLAY_TEMPLATE — no chain)* |
| `overlay` | Create/edit command overlays |
| `update` | Update maestro itself |
| `harvest` | Extract knowledge from artifacts |
| `domain_add` | Register a domain term into glossary |
| `domain_list` | List registered domain terms *(CLI short-circuit: `Bash("maestro domain list")` — no chain)* |
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
| `full-lifecycle` | Complete phase: plan→execute→review→test→session-seal |
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

## task_type → chain

**Resolution order:**
1. `state_continue` → `detectNextAction(projectState)` → `{ chain, argsOverride? }`. Apply argsOverride before template substitution.
2. Task-type aliases → named chain: `spec_generate`→`spec-driven`, `brainstorm`→`brainstorm-driven`, `grill`→`grill-driven`, `blueprint`→`blueprint-driven`, `analyze_macro`→`analyze-plan-execute`, `issue_execute`→`issue-full`
3. `chainMap[taskType]` → direct lookup

**State validation (W003)** — cross-validate intent against project state:
- `execute` but no plan → warn, prepend `plan`
- `test` but not executed → warn, prepend `execute`
- `milestone_close` but not all phases executed → warn, suggest completing first

Display warning but let user override.

**Arg resolution:**

```
resolvePhase — priority order:
  1. intent_analysis.phase_ref (from structured extraction)
  2. Regex match "phase N" or bare number from raw intent
  3. From project state artifacts: in-progress execute → first incomplete phase → latest artifact phase
  4. null if chain is 'analyze-plan-execute' (uses {run_dir} instead)
  5. null if all chain commands are phase-independent:
     maestro-manage status, maestro-manage issue, maestro-manage issue discover, maestro-init,
     maestro-fork, maestro-merge, roadmap, maestro-spec setup,
     maestro-manage knowledge (knowhow/capture/harvest/wiki/domain), maestro-manage sync (codebase/rebuild),
     maestro-session-seal
  6. Ask user

resolveIssueId — priority: intent_analysis.issue_id → regex match ISS-*-NNN from raw intent → null
```

When executing issue chains, replace `{issue_id}` in step args with resolved ID. If missing and required, prompt user.

---

## Reference Data

### Chain Map

```javascript
const chainMap = {
  // ── Single-step ──
  'status':             [{ cmd: 'maestro-manage status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'grill':              [{ cmd: 'grill', args: '"{description}"' }],
  'blueprint':          [{ cmd: 'blueprint', args: '"{description}"' }],
  'analyze-macro':      [{ cmd: 'analyze', args: '"{description}"' }],
  'analyze':            [{ cmd: 'analyze', args: '{phase}' }],
  'analyze-quick':      [{ cmd: 'analyze', args: '{phase} -q' }],
  'ui_design':          [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }],
  'impeccable_chain':   [{ cmd: 'maestro-impeccable', args: '"{description}"' }],
  'impeccable_build':   [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }],
  'impeccable_improve': [{ cmd: 'maestro-impeccable', args: '"{description}" --chain improve' }],
  'plan':               [{ cmd: 'plan', args: '{phase}' }],
  'execute':            [{ cmd: 'execute', args: '{phase}' }],
  'test_gen':           [{ cmd: 'auto-test', args: '{phase}' }],
  'auto_test':          [{ cmd: 'auto-test', args: '{phase}' }],
  'test':               [{ cmd: 'test', args: '{phase}' }],
  'debug':              [{ cmd: 'debug', args: '"{description}"' }],
  'integration_test':   [{ cmd: 'auto-test', args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor', args: '"{description}"' }],
  'review':             [{ cmd: 'review', args: '{phase}' }],
  'retrospective':      [{ cmd: 'retrospective', args: '{phase}' }],
  'learn':              [{ cmd: 'maestro-manage knowledge capture', args: '"{description}"' }],
  'sync':               [{ cmd: 'maestro-manage sync codebase' }],
  'milestone_close':    [{ cmd: 'maestro-session-seal' }],
  'milestone_audit':    [{ cmd: 'maestro-ralph', args: '"{description}" --engine swarm --script wf-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-session-seal' }],
  'codebase_rebuild':   [{ cmd: 'maestro-manage sync rebuild' }],
  'codebase_refresh':   [{ cmd: 'maestro-manage sync codebase' }],
  'spec_setup':         [{ cmd: 'maestro-spec setup' }],
  'spec_add':           [{ cmd: 'maestro-spec add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'maestro-spec load' }],
  'spec_map':           [{ cmd: 'maestro-manage sync rebuild' }],
  'domain_add':         [{ cmd: 'maestro-manage knowledge domain', args: '"{description}"' }],
  'knowhow_capture':    [{ cmd: 'maestro-manage knowledge capture', args: '"{description}"' }],
  'issue':              [{ cmd: 'maestro-manage issue', args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'maestro-manage issue discover', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'execute', args: '' }],
  'knowhow':            [{ cmd: 'maestro-manage knowledge knowhow', args: '"{description}"' }],
  'quick':              [{ cmd: 'quick', args: '"{description}"' }],
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
  'full-lifecycle':       [{ cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'review', args: '{phase}' }, { cmd: 'test', args: '{phase}' }, { cmd: 'maestro-session-seal' }, { cmd: 'harvest', args: '--auto' }],
  'spec-driven':          [{ cmd: 'maestro-init' }, { cmd: 'roadmap', args: '--mode full "{description}"' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'harvest', args: '--auto' }],
  'roadmap-driven':       [{ cmd: 'maestro-init' }, { cmd: 'roadmap', args: '"{description}"' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'harvest', args: '--auto' }],
  'grill-driven':         [{ cmd: 'grill', args: '"{description}"' }, { cmd: 'brainstorm', args: '"{description}" --from grill:{grill_id}' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'harvest', args: '--auto' }],
  'blueprint-driven':     [{ cmd: 'maestro-init' }, { cmd: 'blueprint', args: '"{description}"' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'harvest', args: '--auto' }],
  'brainstorm-driven':    [{ cmd: 'brainstorm', args: '"{description}"' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'harvest', args: '--auto' }],
  'brainstorm_visualize': [{ cmd: 'brainstorm-visualize', args: '"{description}"' }],
  'impeccable-build':     [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }],
  'impeccable-driven':    [{ cmd: 'maestro-impeccable', args: '"{description}" --chain build' }, { cmd: 'execute', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'analyze', args: '"{description}" -q' }, { cmd: 'plan', args: '--dir {run_dir}' }, { cmd: 'execute', args: '--dir {run_dir}' }, { cmd: 'harvest', args: '--auto' }],
  'quality-loop':         [{ cmd: 'review', args: '{phase}' }, { cmd: 'auto-test', args: '{phase}' }, { cmd: 'test', args: '{phase}' }, { cmd: 'debug', args: '--from-uat {phase}' }, { cmd: 'plan', args: '{phase} --gaps' }, { cmd: 'execute', args: '{phase}' }],
  'milestone-close':      [{ cmd: 'maestro-session-seal' }],
  'next-milestone':       [{ cmd: 'roadmap', args: '"{description}"' }, { cmd: 'plan', args: '{phase}' }, { cmd: 'execute', args: '{phase}' }],
  'review-fix':           [{ cmd: 'plan', args: '{phase} --gaps' }, { cmd: 'execute', args: '{phase}' }, { cmd: 'review', args: '{phase}' }],
  'quality-loop-partial': [{ cmd: 'plan', args: '{phase} --gaps' }, { cmd: 'execute', args: '{phase}' }],
  'issue-full':           [{ cmd: 'analyze', args: '--gaps {issue_id}' }, { cmd: 'plan', args: '--gaps' }, { cmd: 'execute', args: '' }, { cmd: 'review', args: '{phase}' }, { cmd: 'maestro-manage issue', args: 'close {issue_id} --resolution fixed' }, { cmd: 'harvest', args: '--auto' }],
  'issue-quick':          [{ cmd: 'plan', args: '--gaps' }, { cmd: 'execute', args: '' }, { cmd: 'maestro-manage issue', args: 'close {issue_id} --resolution fixed' }],

  'harvest':              [{ cmd: 'harvest', args: '"{description}"' }],
  'wiki':                 [{ cmd: 'maestro-manage knowledge wiki' }],
  'wiki_connect':         [{ cmd: 'wiki-connect' }],
  'wiki_digest':          [{ cmd: 'wiki-digest' }],
  'business_test':        [{ cmd: 'auto-test', args: '{phase}' }],
  'spec_remove':          [{ cmd: 'maestro-spec remove', args: '"{description}"' }],
  'update':               [{ cmd: 'maestro-update' }],
  'overlay':              [{ cmd: 'maestro-overlay', args: '"{description}"' }],
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
| `full-lifecycle` | plan → execute → review → test → session-seal → harvest | Full milestone completion |
| `blueprint-driven` | init → blueprint → plan → execute → harvest | From idea/requirements (heavy) |
| `roadmap-driven` | init → roadmap → plan → execute → harvest | From requirements (light) |
| `brainstorm-driven` | brainstorm → plan → execute → harvest | From exploration |
| `impeccable-build` | impeccable --chain build → plan → execute | From design system generation |
| `analyze-plan-execute` | analyze -q → plan --dir → execute --dir → harvest | Fast track (ad-hoc Run mode) |
| `review-fix` | plan --gaps → execute → review | Fix review-blocked issues |
| `quality-loop` | review → auto-test → test → debug → plan --gaps → execute | Fix quality issues |
| `quality-loop-partial` | plan --gaps → execute | Partial quality fix cycle |
| `milestone-close` | session-seal | Seal session & close milestone |
| `next-milestone` | roadmap → plan → execute | Next milestone (auto-loads deferred) |
| `issue-full` | analyze → plan → execute → review → close → harvest | Issue with quality gate |
| `issue-quick` | plan → execute → close | Issue fast path |

### Pipeline Examples

| Input | task_type | Chain |
|-------|-----------|-------|
| `"continue"` | *(exact)* state_continue | (from state) |
| `"status"` | *(exact)* status | maestro-manage status |
| `"plan phase 2"` | plan | plan 2 |
| `"execute"` | execute | execute |
| `"Add API endpoint"` | quick | quick |
| `"run tests"` | test | test |
| `"debug auth crash"` | debug | debug "auth crash" |
| `"修复登录问题"` | debug | debug "登录" |
| `"fix issue ISS-abc-001"` | issue_execute | issue-full |
| `"这个问题需要看看"` | analyze | analyze |
| `"创建一个 issue 跟踪"` | issue | maestro-manage issue |
| `"discover issues"` | issue_discover | maestro-manage issue discover |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm→plan→execute |
| `"spec generate auth"` | spec-driven | init→spec→plan→execute |
| `"ui design landing"` | impeccable_build | maestro-impeccable --chain build |
| `"优化界面交互"` | impeccable_improve | maestro-impeccable --chain improve |
| `"refactor auth module"` | refactor | quality-refactor "auth module" |
| `"复盘 phase 2"` | retrospective | retrospective 2 |
| `"team review code"` | team_review | team-review |
| `"next phase"` | milestone-close | maestro-session-seal |
| `-y "implement X"` | execute | execute (auto) |
| `"从需求开始做完整个项目"` | spec-driven | init→spec→plan→execute |
| `"分析完直接改"` | analyze-plan-execute | analyze→plan→execute |
| `"review 有问题需要修"` | review-fix | plan --gaps→execute→review |
| `"全面质量检查"` | quality-loop | review→test→debug→plan→execute |
