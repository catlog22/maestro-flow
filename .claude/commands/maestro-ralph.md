---
name: maestro-ralph
description: "Adaptive lifecycle orchestrator — compose, dispatch ralph-executor agent, evaluate decision, loop"
argument-hint: "<intent> [-y] [--amend [change]] [--roadmap] [--engine swarm|universal] | status | continue"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
  - Agent
  - SendMessage
  - Workflow
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<purpose>
Adaptive lifecycle orchestrator: locate step → resolve args → load context → dispatch Agent(ralph-executor) per step (agent 调 `ralph next` + 执行) → extract signals → drift check → ralph complete → evaluate decision → next step → loop.

Session: `.workflow/sessions/{id}/session.json` (engine=ralph) + `ralph-meta.json`
`{session_dir}` = `.workflow/sessions/{id}/`（标准 session 目录）
</purpose>

<deferred_reading>
- [ralph-amend-goal.md](~/.maestro/workflows/ralph-amend-goal.md) — read when `--amend` flag active for goal amendment flow
- [swarm scripts](~/.maestro/workflows/swarm/wf-*.js) — read `meta` block at swarm routing / universal scan（`--engine swarm|universal` 时）
- [dynamic scripts](~/.maestro/workflows/dynamic/uwf-*.js) — read `meta` block at universal scan（`--engine universal` 时）
</deferred_reading>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag        → auto_confirm = true
--roadmap      → wants_roadmap = true
--amend / -a   → amend_mode = true
--engine <sequential|swarm|universal> → engine_mode (default sequential)
.md/.txt path  → input_doc
status|continue → route keyword
Remaining      → intent (amend_mode 时为 change_request)
```

**Engine-specific flags**（`--engine` 是判别器；其余在不适用时忽略，见 `<engines>` section）：
```
--script <name>                swarm: force a specific wf-* script
--depth <shallow|standard|deep> universal: adversarial pattern depth (default standard)
--dims <d1,d2>                 swarm: limit analysis dimensions
--roles <r1,r2> / --count N    swarm: limit/size brainstorm roles
--tier <quick|standard>        swarm: review dimension count
--from <script>                universal: base a new dynamic script on an existing wf-*/uwf-*
--dry-run                      universal: generate script only, do not execute
--resume <runId>               both: pass through to Workflow tool (incremental re-run)
```

**State files**:
- `.workflow/state.json` — project state + session index
- `.workflow/sessions/{id}/session.json` — standard session state (engine=ralph)
- `.workflow/sessions/{id}/ralph-meta.json` — ralph orchestration extensions
</context>

<invariants>
1. **Ralph owns the full loop** — locate step → resolve args → load context → dispatch agent → wait for task-notification → extract signals → drift → complete，全部在本命令内完成
2. **One agent per step** — 每个执行 step 派发一个 unnamed executor agent，结果通过 task-notification `<result>` 回传，主流程解析结果后决定下一步
3. **Agent is a thin wrapper** — executor agent 调 `ralph next` 获取 skill prompt 并执行，返回输出文本；arg resolution、context loading、signal extraction、drift analysis、ralph complete 均由主流程完成
4. **Unified unnamed dispatch** — 执行 Agent 和评估 Agent 均使用 unnamed Agent()，结果通过 task-notification `<result>` 回传：
   - **执行 Agent**（A_STEP_DISPATCH）：`Agent()` 不传 name — executor 内部编排也用 unnamed Agent（子结果自动回流 executor，嵌套套娃模型）
   - **评估 Agent**（A_AGENT_EVALUATE / A_AGENT_GOAL_AUDIT / A_AGENT_REGROUND）：同样 `Agent()` 不传 name
   - `agent_exec_name` 仅用于 display/日志标识，不作为 Agent name 参数
5. **主流程调 `ralph complete`** — 每个 step 完成后由主流程调 `maestro ralph complete`，非 agent 上报
6. **Decision evaluation inline** — decision 节点不 handoff，通过 Agent 或 CLI delegate 在本循环内评估
7. **CLI delegation for evaluation only** — CLI delegate（`maestro delegate --mode analysis`）仅限评估环节；执行仍通过 executor Agent 完成
8. **Decision delegates read-only** — 评估 Agent 通过 prompt 中的 CONSTRAINTS 约束为只读
9. **执行 step 通过 `maestro ralph next` CLI 加载并内联执行**（由 execute Agent 完成）
10. **session.json + ralph-meta.json 是唯一真源** — 不生成 markdown 清单或侧文件
11. **每个 step 必须在 chain 中标记 completed** — 由 `maestro ralph complete N --status DONE`（或 DONE_WITH_CONCERNS）写入；CLI 是唯一合法写入路径
12. **step command 在 A_BUILD_STEPS 解析** — 通过 `maestro ralph skills --platform claude --json --quiet` 预校验
13. **执行 step 内容加载** — 由 `maestro ralph next` CLI 通过 `resolveStepContent()` 在执行期完成
14. **Decomposition is outcome-oriented** — sub-goals 为可观测交付，禁止 lifecycle 复刻
15. **Sessions are independent work units** — skill args 统一用 `--session {session}` 模式，无 phase/milestone 占位符
16. **task_decomposition 驱动 steps[] 动态生长** — `post-goal-audit` 按 unmet 子目标插入 scoped mini-loop
17. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作
18. **Evaluate fallback 必须标记** — 评估 Agent 解析 verdict 失败时 fallback 为 "fix"，MUST 在 decisions.ndjson 记录 `"parse_failed": true, "confidence_score": 0`
19. **auto_confirm 单一来源** — `auto_confirm` 仅由用户 `-y` 标志设定
20. **分解契约单一所有者** — `boundary_contract` / `task_decomposition` 由 session 创建者拥有
21. **控制权优先级（范式治理）** — FSM 独占 session 生命周期 + step 排序 + retry/fix/escalate + cross-step decision 节点
22. **引擎只做并行加速，不做状态决策** — `--engine swarm|universal` 通过 Workflow 引擎并行执行单个 step，MUST NOT 修改 session state、MUST NOT 推进 step、MUST NOT 触碰 decision 节点；引擎产出写入该 step 的 Run output dir（格式兼容对应命令产物），由主流程照常 `ralph complete`。生成/固定脚本对引擎只读（`wf-*.js` 从不被编辑；`uwf-*.js` 仅由 universal 生成器按幂等命名覆盖）。
</invariants>

<state_machine>

Chain-building states + 执行循环 states：

<states>
S_PARSE_ROUTE   — 解析参数、路由入口
S_STATUS        — 显示 session 进度
S_CONTINUE      — 恢复执行
S_RESOLVE_SESSION — 解析 session_id + session_is_new                    PERSIST: session.session_id, session.session_is_new
S_INFER         — 推断 lifecycle_position                              PERSIST: session.lifecycle_position, session.wants_roadmap
S_RESOLVE_SCOPE — 读 macro analyze conclusions.scope_verdict            PERSIST: session.scope_verdict, session.analyze_macro_id
S_QUALITY_MODE  — 决定质量管线模式                                      PERSIST: session.quality_mode
S_DECOMPOSE     — 边界澄清 + 执行准则 + 子目标清单                      PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_BUILD_CHAIN   — 构建步骤链（build rules 0-14）                        PERSIST: session.steps[]
S_CREATE_SESSION — 写 session.json + ralph-meta.json                     PERSIST: session (全量)
S_CONFIRM       — 用户确认

S_STEP_LOCATE     — 找下一个 pending step                    PERSIST: —
S_STEP_RESOLVE    — 解析占位符 + 丰富参数                    PERSIST: step.args (enriched)
S_STEP_DISPATCH   — 组装上下文 + 派发 unnamed executor agent    PERSIST: step.agent_exec_name, step.status = "running"
S_STEP_ANALYZE    — 提取信号 + 组装 completion 参数            PERSIST: —
S_STEP_DRIFT      — 产物 vs 目标偏离分析                      PERSIST: step.drift_score
S_STEP_COMPLETE   — 调 `ralph complete` 上报                  PERSIST: step.completion_*
S_DECISION_EVAL   — 启动分析 Agent 评估质量门              PERSIST: —
S_APPLY_VERDICT   — 应用裁决                              PERSIST: session.steps[]
S_SESSION_DONE    — 所有 step 完成                        PERSIST: session.status
S_HANDLE_FAIL     — 处理失败                              PERSIST: step.status
S_AMEND_GOAL      — 修改 running session 目标              PERSIST: session.task_decomposition, .boundary_contract, .goal_changelog, .steps[]
S_FALLBACK        — 请求用户输入                           PERSIST: —
</states>


<transitions>

S_PARSE_ROUTE:
  → S_STATUS        WHEN: intent == "status"
  → S_CONTINUE      WHEN: intent == "continue"
  → S_AMEND_GOAL    WHEN: amend_mode == true AND running session exists
  → S_FALLBACK      WHEN: amend_mode == true AND no running session
  → S_DECISION_EVAL  WHEN: running session with decision step in "running" status
  → S_RESOLVE_SESSION WHEN: intent is non-empty
  → S_FALLBACK      WHEN: no intent AND no running session

S_STATUS:
  → END             DO: A_SHOW_STATUS

S_CONTINUE:
  → S_STEP_LOCATE    WHEN: running session found
  → S_FALLBACK       WHEN: no running session

S_AMEND_GOAL:
  → S_STEP_LOCATE    WHEN: change applied + user confirmed    DO: A_AMEND_GOAL
  → END              WHEN: user cancels
  GUARD: RISK_LEVEL=high → auto_confirm 无效

S_CREATE_SESSION:
  → S_CONFIRM        WHEN: not auto_confirm
  → S_STEP_LOCATE    WHEN: auto_confirm

S_CONFIRM:
  → S_STEP_LOCATE    WHEN: user confirms
  → S_BUILD_CHAIN    WHEN: user edits
  → END              WHEN: user cancels

S_STEP_LOCATE:
  → S_STEP_RESOLVE   WHEN: pending execution step found (step.decision == null)
  → S_DECISION_EVAL  WHEN: pending decision step found (step.decision != null)
  → S_SESSION_DONE   WHEN: no pending steps (all completed/skipped)
  → S_HANDLE_FAIL    WHEN: has failed step and no pending
  → S_FALLBACK       WHEN: no running session

S_STEP_RESOLVE:
  → S_STEP_DISPATCH  DO: A_STEP_RESOLVE_ARGS

S_STEP_DISPATCH:
  → S_STEP_ANALYZE   WHEN: task-notification status=completed            DO: A_STEP_DISPATCH
  → S_HANDLE_FAIL    WHEN: task-notification status=failed               DO: mark BLOCKED

S_STEP_ANALYZE:
  → S_STEP_DRIFT     WHEN: STATUS == DONE|DONE_WITH_CONCERNS    DO: A_STEP_EXTRACT
  → S_HANDLE_FAIL    WHEN: STATUS == NEEDS_RETRY|BLOCKED         DO: A_STEP_EXTRACT

S_STEP_DRIFT:
  → S_STEP_COMPLETE  WHEN: ALIGNED|MINOR_DRIFT                   DO: A_STEP_DRIFT_ANALYZE
  → S_STEP_DISPATCH      WHEN: MAJOR_DRIFT + not retried             DO: A_STEP_DRIFT_ANALYZE (ralph retry + re-execute)
  → S_STEP_COMPLETE  WHEN: MAJOR_DRIFT + retried                 DO: A_STEP_DRIFT_ANALYZE (DONE_WITH_CONCERNS)

S_STEP_COMPLETE:
  → S_STEP_LOCATE    DO: A_STEP_COMPLETE (loop to next step)

S_DECISION_EVAL: (decision 节点 == `step.decision` 非空)
  → S_APPLY_VERDICT WHEN: quality-gate (post-execute, post-business-test, post-review, post-test, post-frontend-verify)
                     DO: A_AGENT_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate (post-goal-audit)
                     DO: A_AGENT_GOAL_AUDIT
  → S_APPLY_VERDICT WHEN: scope-gate (post-analyze-scope)
                     DO: A_SCOPE_EVALUATE
  → S_APPLY_VERDICT WHEN: reground-gate (post-reground)
                     DO: A_AGENT_REGROUND
  → S_APPLY_VERDICT WHEN: structural (post-session, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_STEP_LOCATE WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_STEP_LOCATE WHEN: post-goal-audit + has_unmet       DO: A_APPLY_GOAL_FIX
  → S_STEP_LOCATE WHEN: post-goal-audit + all_met + INTENT_ALIGNED=true  DO: A_APPLY_GOAL_DONE
  → END              WHEN: post-goal-audit + all_met + INTENT_ALIGNED=false  DO: A_REGROUND_HALT
  → S_STEP_LOCATE WHEN: post-analyze-scope                DO: A_APPLY_SCOPE_VERDICT
  → S_STEP_LOCATE WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_STEP_LOCATE WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_STEP_LOCATE WHEN: post-session + next dep-ready session   DO: A_ADVANCE_SESSION
  → END              WHEN: post-session + no next session
  → END              WHEN: post-debug-escalate                DO: A_PAUSE_ESCALATE
  → END              WHEN: post-reground + drifted + confidence >= 60  DO: A_REGROUND_HALT
  → S_STEP_LOCATE WHEN: post-reground + aligned           DO: A_APPLY_PROCEED
  → S_STEP_LOCATE WHEN: post-reground + drifted + confidence < 60  DO: A_APPLY_PROCEED (标 LOW CONFIDENCE)
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → AskUserQuestion with override options
  GUARD: post-reground + drifted + confidence >= 60 → A_REGROUND_HALT（auto_confirm 不跳过）

S_HANDLE_FAIL:
  → S_STEP_LOCATE WHEN: auto + not retried              DO: A_RETRY
  → END              WHEN: auto + retried                   DO: A_PAUSE_SESSION
  → S_STEP_LOCATE WHEN: interactive + retry
  → S_STEP_LOCATE WHEN: interactive + skip
  → END              WHEN: interactive + abort

S_SESSION_DONE:
  → END             DO: A_COMPLETE_SESSION

</transitions>

<actions>

### A_RESOLVE_SESSION

前置于 A_INFER_POSITION。产出 `session_id` + `session_is_new`。

**Priority:**

| Step | 行为 | session_is_new |
|------|------|----------------|
| 1 | intent 含 `--session <id>` 显式指定 → 取该 session_id | false |
| 2 | intent 派生短语（slug）→ 在 `state.json.sessions[*].session_id` / `sessions[*].slug` 匹配 | false (匹配) / true (无匹配) |
| 3 | 未派生 → 取 `state.json.active_session_id` | false |
| 4 | 仍无 → state.json 首个 dep-ready（依赖已满足）的 pending session | false |
| 5 | position 将是 brainstorm/blueprint/init/roadmap/analyze-macro → session_id = null | n/a |
| 6 | 仍模糊 → `AskUserQuestion` | 由用户回答确定 |

**Session resolution priority**（优先级链）：explicit `--session` > slug match in `sessions[]` > `active_session_id` > first dep-ready session > ask user。

**写入 session**: `session_id`, `session_is_new`。

**新派生 session 时处理**：
- intent 派生新 session slug → 写入 `session.session_id` 作为标识；`state.json.sessions[]` 由 step `roadmap` / session-seal 创建
- session_is_new=true → 该 session 尚无上游产出，lifecycle 从 analyze 起

### A_INFER_POSITION

**Intent-based overrides** (按顺序匹配，先命中先用):

| Pattern | Position |
|---------|----------|
| 压力测试 / 拷问 / 验证假设 / grill / stress-test | `grill`（**auto_confirm=true 时透传 `-y`，grill 以 Auto mode 代码代答，不跳过**） |
| brainstorm / 头脑风暴 / 探索 / ideate / 设计思路 | `brainstorm` |
| blueprint / 规格 / 正式文档 / spec-generate / 7-phase | `blueprint` |
| broad/medium intent 无显式 session (重构/全面/重写/迁移/新功能 X) | `analyze-macro` |

**Roadmap opt-in detection** (设 `session.wants_roadmap`，缺省 `false`):
```
wants_roadmap = (--roadmap flag)
             OR (intent 含多发布信号: 多发布|多版本|分阶段交付|multi-release|roadmap)
             OR (current-roadmap artifact 存在 OR state.json.sessions[] 中存在 roadmap_artifact_id != null)
```
默认 `false` → large 项目走单一多波次 `plan --from analyze`，不引入 roadmap 横切层；roadmap 仅多发布场景 opt-in。

**Bootstrap detection:**

| Condition | Position |
|-----------|----------|
| No `.workflow/` + no source files | `brainstorm` |
| No `.workflow/` + has source files | `init` |
| Has `.workflow/` but no state.json | `init` |
| Has state.json | → session-aware artifact inference |

**Session-aware artifact inference** (使用 A_RESOLVE_SESSION 已写入的 `session.session_id` + `session.session_is_new`)：

| Condition | Position |
|-----------|----------|
| `session_is_new == true` (新 session) | `analyze` |
| no roadmap-produced sessions AND has analyze macro artifact | `roadmap` if `wants_roadmap` else `plan` (--from analyze) |
| no roadmap-produced sessions AND no analyze artifact | `analyze-macro` |
| `session_id == null` (grill/brainstorm/blueprint/init/roadmap/analyze-macro override 已定) | n/a |
| session 已存在 + 无任何 artifact | `analyze` |
| session 已存在 + 最新 artifact = analyze | `plan` |
| session 已存在 + 最新 artifact = plan | `execute` |
| session 已存在 + 最新 artifact = execute | → refine from post-execute results |

**关键不变量**：artifact 过滤按 `session.session_id`，不读 `state.json.current_phase`。`session_is_new` → 直接 `analyze`。

### A_RESOLVE_SCOPE_VERDICT

仅当 `lifecycle_position ∈ {analyze-macro, roadmap, plan}` 且存在最新 analyze artifact 时执行。

1. 定位最新 macro analyze artifact（`type=="analyze"` 且 `scope=="macro"`，按 created_at DESC）→ 记 `session.analyze_macro_id = ANL-xxx`
2. 读 `{artifact_path}/conclusions.json` 的 `scope_verdict` 字段（`large | medium | small`）
3. 写入 `session.scope_verdict`；缺失时设 `unknown`
4. 路由建议（A_BUILD_STEPS 据此决定是否插入 roadmap、plan 是否走 `--from`）：

| scope_verdict | 链路 |
|---------------|------|
| `large` + `wants_roadmap` | analyze-macro → roadmap → analyze → plan → execute → ...（多发布 opt-in） |
| `large`（默认）/ `medium` / `small` | analyze-macro → plan --from analyze:{ANL_ID} → execute → ...（跳过 roadmap + analyze-session；单一多波次计划） |
| `unknown` | 默认走 standalone（plan --from analyze）路径，post-analyze-scope 决策节点再纠正 |

**Refine from post-execute results:**

在 execute artifact 的 Run output directory 中检查结果文件（verification.json 由 execute 内置 gate 产出）：

| Condition | Position |
|-----------|----------|
| 无 verification.json 或 passed==false 或 gaps[] | `execute` (触发 post-execute fix loop) |
| passed==true, no review.json | `business-test` |
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `session-seal` |
| uat.md: has failures | `test-failed` |

### A_DETERMINE_QUALITY_MODE

决定下游质量管线长度。读 `session.quality_mode_override`（CLI 标志 `--quality`），无则按规则推断：

| Condition | Mode | Pipeline (execute 之后) |
|-----------|------|-------------------------|
| Has `specs/REQ-*.md` + 当前 session 业务范围明确 | `full` | business-test → review → test-gen → test |
| Default | `standard` | review → test-gen (当 coverage<80%) → test |
| `--quality quick` | `quick` | review --tier quick |

写入 `session.quality_mode`。A_BUILD_STEPS 据此过滤 stage（见下）。

### A_DECOMPOSE_TASKS

Runs once before chain build; additive to session state. 设 `session.decomposition_owner = "ralph"`。

**0. Ownership guard** (invariant 20): 若 `session.boundary_contract` 或 `session.task_decomposition` 已非空（上游 maestro 已写入，`decomposition_owner == "maestro"`）→ MUST 跳过下述提问，仅做 shape 校验 + 缺省字段补齐，直接进入步骤 6。

**1. Classify intent breadth:**

| Pattern | Breadth | Clarify? |
|---------|---------|----------|
| 重构/全面/重写/重做/整体/迁移 · overhaul/migrate/rewrite/revamp | broad | MUST (ignores auto_confirm) |
| named single file/function/bug, "fix X", "add Y to Z" | narrow | skip — auto-derive |
| otherwise | medium | clarify unless auto_confirm |

**2. Clarify boundary** (broad/medium) — `AskUserQuestion`, ≤3 rounds, options pre-filled from intent + a quick Glob/Grep scan of the target module:

| Round | Question | Drives |
|-------|----------|--------|
| Scope | 哪些目录/文件/层在范围内?明确排除什么? | boundary_contract.in_scope / out_of_scope |
| Constraints | 必须向后兼容?公共 API 冻结?行为/性能预算?测试门槛? | boundary_contract.constraints + execution_criteria |
| Done | 什么可观测结果算"完成"?(如:测试全绿 + 行为零变更 + X 指标) | boundary_contract.definition_of_done |

narrow → derive defaults from intent + codebase, skip questions.

**3. Derive `execution_criteria`**: backward-compat、scope-freeze、test/coverage bar、fix-don't-hide、incremental commit。

**4. Derive `task_decomposition`** (子目标清单 — outcome-oriented, NOT lifecycle stages). Each entry:
```json
{ "id": "G1", "goal": "<deliverable>", "boundary": "<in/out note>",
  "done_when": "<objectively checkable condition>",
  "evidence": "verification.json|review.json|uat.md|e2e-results.json|<test path>",
  "lifecycle": ["analyze","execute"], "status": "pending" }
```
`done_when` 必须客观可验证，且引用 ralph 已产出的 artifact；`lifecycle` 字段映射到产出 evidence 的生命周期 stage。涉及前端可用性的子目标，`done_when` 应引用 `e2e-results.json`（frontend-verify 门产出），不得仅以后端 API/build 证据判定可用。

**5. Persist** (additive): `boundary_contract`, `execution_criteria`, `task_decomposition`。每个 sub-goal 含 `status: "pending"` + `completion_confirmed: false`。

**6. Stage** the Goal Prompt (Appendix) for A_CREATE_SESSION to emit.

### A_BUILD_STEPS

Generate steps from `session.lifecycle_position` to `session-seal`（`session.session_id` 存在时）或最后一个质量门（standalone 时）。

> **执行模型**：每个 step 由 Agent(ralph-executor) 派发执行，非主会话内联。Agent 内部调 `maestro ralph next` 获取 skill prompt 并执行，结果通过 task-notification 回传主流程。

| Stage | Skill | Decision after | quality_mode |
|-------|-------|----------------|--------------|
| grill | `grill "{intent}"` | — | all (**auto_confirm → 透传 `-y` 到 grill args，不删除 stage**) |
| brainstorm | `brainstorm "{intent}" --from grill:{grill_id}` *(if grill ran)* / `brainstorm "{intent}"` *(otherwise)* | — | all |
| blueprint | `blueprint "{intent}"` | — | all |
| init | `maestro-init` | — | all |
| spec-setup | `spec setup` | — | all (**仅当 `.workflow/specs/` 不存在时插入**) |
| analyze-macro | `analyze "{intent}"` | `post-analyze-scope` | all |
| roadmap | `roadmap --from analyze:{analyze_macro_id}` | — | all |
| analyze | `analyze --session {session}` | — | all |
| plan | `plan --session {session}` *(scope=session)* / `plan --from analyze:{analyze_macro_id}` *(scope=standalone)* / `plan --from blueprint:{blueprint_id}` *(scope=standalone)* | — | all |
| execute | `execute --session {session}` | `post-execute` | all |
| business-test | `auto-test --session {session}` | `post-business-test` | full only |
| review | `review --session {session}` | `post-review` | all (quick: append `--tier quick`) |
| test-gen | `auto-test --session {session}` | — | full / standard if coverage<80% |
| test | `test --session {session}` | `post-test` | full, standard |
| frontend-verify | `test --session {session} --frontend-verify` | `post-frontend-verify` | all（**仅当 session 交付 UI 时插入**：检出 `dashboard/` 或 UI 关键词 `landing\|page\|dashboard\|frontend\|UI\|component\|界面`） |
| goal-audit | *(decision-only)* | `post-goal-audit` | all (only if decomposed) |
| session-seal | *(decision-only)* | `post-session` | all |

**Build rules (按顺序应用):**

0.5. **specs 预检**：当 `lifecycle_position ∉ {grill, brainstorm, blueprint, init}` 且 `.workflow/specs/` 目录不存在时，在链路最前面插入 `spec-setup` 步骤（stage=`spec-setup`，无 decision）。确保下游 analyze/plan/execute 可获得项目约束规则注入
1. **起点**：从 `session.lifecycle_position` 开始
2. **跳过已完成**：跳过当前 session 下已有 completed artifact 的 stage（按 `session.session_id` 过滤）
3. **quality_mode 过滤**：按 `session.quality_mode` 排除不匹配 stage
3.5. **grill auto_confirm 透传**：`auto_confirm == true` 时为 `grill` step args 追加 `-y`（grill 自身 Auto mode 用代码代答，见 grill step `<context>` Mode selection）；保留 `grill` stage 与 brainstorm 的 `--from grill:*`（grill 仍产出 grill-report/terminology/context-package）
3.6. **frontend-verify UI 门控**：仅当当前 session 交付前端（检出 `dashboard/` 目录，或 session 目标/计划含 UI 关键词 `landing|page|dashboard|frontend|UI|component|界面`）时保留 `frontend-verify` stage + `post-frontend-verify` decision；纯后端 session 删除该 stage
4. **决策节点**：每个 Decision after 非空的 stage 之后插入 `{ decision: "<gate>", retry_count: 0, max_retries: 2, command_scope: null, command_path: null }`
5. **goal-audit 插入**：`task_decomposition` 存在时，在最后一个 evidence-producing stage（execute/review/test）之后、`session-seal` 之前插入 `decision:post-goal-audit`
5.5. **re-grounding 插入**：WHEN `task_decomposition` 存在 AND 执行 step（不含 decision）≥3
   - 从第 3 个执行 step 起每隔 3 个插入 `{ decision: "post-reground", retry_count: 0, max_retries: 0, command_scope: null, command_path: null }`
   - 不在最后一个执行 step 后插入（由 goal-audit 覆盖）
   - 不与已有 quality-gate decision 节点相邻（顺延到下一个 3-step 边界）
   - fix-loop 动态插入的 step **纳入**计数（从插入点起重新计算 3-step 间隔）
6. **终点硬约束**：`session.session_id` 存在时 chain 以 `session-seal`（decision:post-session）结尾；`session.session_id=null`（standalone）时跳过 `session-seal` stage，chain 以最后一个质量门 stage 结尾
7. **goal_ref 传播**：`task_decomposition` 存在时，每个 step 按 `step.stage ∈ g.lifecycle` 匹配 `step.goal_ref = g.id`（多匹配取字典序最小）；decision 节点不打 goal_ref
8. **占位符**：`{session}` `{intent}` 由 A_STEP_RESOLVE_ARGS 运行时替换
9. **command_path 解析**（每个执行 step，decision 节点跳过）：
   - 取 skill 名（args 前的第一个 token）
   - **预校验通过 `Bash("maestro ralph skills --platform claude --json --quiet")`** 一次性拉取 claude 平台可用 commands + skills（global + project，project 覆盖 global），匹配 skill 名得到：
     - 命中 commands → `command_scope = "global" | "project"`，`command_path = <绝对路径>`
     - 命中 skills → 同上（type=skill）
     - 未命中 → `command_scope = "missing"`, `command_path = null`，A_CREATE_SESSION 报错 E006
   - **不在 build 阶段读取 .md 内容**；`<required_reading>` / `<deferred_reading>` 解析与加载由 `maestro ralph next` CLI 在执行期完成
10. **每个 step 初始化** `completion_confirmed: false`, `completion_status: null`, `completion_evidence: null`, `completion_summary: null`, `completion_decisions: null`, `completion_caveats: null`, `completion_deferred: null`, `deferred_reads: []`, `load: null`（由 `ralph next` 写入）
11. **scope_verdict gating**（仅当 chain 起点 = `analyze-macro`）：
    - `scope_verdict == large` **且** `wants_roadmap` → 保留 `roadmap` + `analyze`；`plan` 选 session 列（`--session {session}`）
    - 其余（`medium` / `small`，或 `large` 但非 `wants_roadmap`）→ 跳过 `roadmap` + `analyze` 两 stage；`plan` 选 standalone 列（`--from analyze:{analyze_macro_id}`），不带 `--session`
    - `scope_verdict == unknown` → 默认 standalone（非 roadmap）路径；由 `post-analyze-scope` 决策节点在 macro analyze 完成后纠正（A_APPLY_SCOPE_VERDICT）
12. **--from 自动注入**：
    - `analyze_macro_id` 存在且当前 step 是 `roadmap` → args 改为 `--from analyze:{analyze_macro_id}`
    - `analyze_macro_id` 存在且当前 `plan` step 处于 standalone 列（即非 wants_roadmap 路径：`medium`/`small`，或 `large` 但非 `wants_roadmap`）→ args 改为 `--from analyze:{analyze_macro_id}`
    - `blueprint_id` 存在 → 当前 step 是 `plan` → args 改为 `--from blueprint:{blueprint_id}`（优先级低于 `--session` 参数）
    - **session-level deferred chaining**（step 含 `--session {session}`）：build 阶段前序 artifact 尚未产出，由 A_STEP_RESOLVE_ARGS 运行时从 state.json 查找同 session_id 最新 completed artifact 注入：
      - `plan` step → `--from analyze:{session_analyze_id}`，写 `source_artifact_ref`
      - `execute` step → `--dir {plan_path}`（现有逻辑），写 `source_artifact_ref = "plan:{id}"`
    - 写入 `step.source_artifact_ref` 以便审计
13. **动态插入步骤**（A_APPLY_*）同样应用规则 7-12

### A_CREATE_SESSION
1. `ralph_session_id` format: `ralph-{YYYYMMDD-HHmmss}`
2. Validate: 所有 step 的 `command_scope != "missing"`；否则 raise E006 + 列出缺失 skill
3. Additional fields: `execution_mode: "agent"`，无 `cli_tool` 字段
4. Each step: `agent_exec_name: null`（执行 Agent 名称标识）
5. Step mode/role/rule assigned per stage (see Stage Mapping table)

### A_STEP_RESOLVE_ARGS

解析占位符 + 丰富参数。在 `ralph next` 之前执行。

**1. Placeholder substitution:**

| Placeholder | Source |
|-------------|--------|
| `{session}` | session.session_id |
| `{intent}` | session.intent |
| `{description}` | session.intent (alias) |
| `{run_dir}` | session.context.run_dir or latest artifact path |
| `{plan_dir}` | session.context.plan_dir |
| `{analysis_dir}` | session.context.analysis_dir |
| `{issue_id}` | session.context.issue_id |

**2. Per-skill enrichment** (when args empty or minimal):

| Step | Required context | Source |
|-------|-----------------|--------|
| brainstorm | topic | `"{intent}"` |
| roadmap | description | `"{intent}"` |
| analyze | session or topic | `--session {session}` or `"{intent}"` |
| plan | --session, --from, or --dir | see --from auto-injection below |
| execute | --session or --dir | see --from auto-injection below |
| debug | gap context | Read previous step's error/gap |
| review/test/auto-test | session | `--session {session}` |

**3. --from auto-injection (session-level artifact chaining):**

```
Read state.json.artifacts（含 session 内归档 artifacts）
→ filter by session_id={session.session_id} + status=="completed"

plan step（含 --session 占位符，args 无 --from 且无 --dir）:
  1. 查同 session_id 最新 completed type=="analyze" artifact → id = ANL-xxx
  2. 命中 → args 追加 --from analyze:{id}
  3. 写 step.source_artifact_ref = "analyze:{id}"

execute step（含 --session 占位符，args 无 --dir）:
  1. 查同 session_id 最新 completed type=="plan" artifact → id = PLN-xxx, path = scratch/...
  2. 命中 → args 追加 --dir {run_dir}/outputs/{path}
  3. 写 step.source_artifact_ref = "plan:{id}"
```

兜底：查询无结果 → 不注入，由命令自身 discovery 逻辑处理。已有 `--from` 或 `--dir` 的 step 不覆盖。

**4. Goal context injection:**

当 `step.goal_ref` 非空且 `session.task_decomposition` 存在时：
```
goal = session.task_decomposition.find(g => g.id == step.goal_ref)
if goal:
  goal_snippet = { id: goal.id, goal: goal.goal, done_when: goal.done_when,
                   boundary: goal.boundary, evidence: goal.evidence }
  → 传递给 A_STEP_DISPATCH 注入 agent prompt
```

**5. Write** enriched args + source_artifact_ref back to ralph-meta.json.

### A_STEP_DISPATCH

加载前序产出 + 组装上下文 + 派发 executor agent 执行单步。Agent 内部调 `maestro ralph next` 获取 skill prompt 并执行。

**1. Load previous step context:**

- 读前一 completed step 的 `completion_summary` + `completion_caveats` + `completion_decisions` + `completion_deferred`
- 按 `session.context` 中的路径逐个 Read，提取与当前 step 相关的内容：

   | 当前 stage | 加载什么 | Source |
   |-----------|---------|--------|
   | plan | analysis conclusions + scope_verdict | `{context.analysis_dir}/conclusions.json` |
   | execute | task list + wave assignments | `{context.plan_dir}/TASK-*.json` |
   | review | changed files + verification results | `{context.run_dir}/verification.json` |
   | test | review findings | `review.json` |
   | debug | error traces + failing test details | 前一 step 的 `completion_evidence` |
   | brainstorm | grill report | `{context.grill_id}` report |

- Explore if needed — 产物指向代码位置但缺少上下文 → `maestro explore` 补充（仅 execute/debug/test 且有文件路径引用时）
- Accumulated signals — 遍历 ALL completed steps → 聚合 caveats + deferred

**2. Goal context pre-injection:**

- GUARD: `ralph_protocol_version >= "2"` → skip（session_anchor 已含 goal context）
- WHEN `ralph_protocol_version < "2"` 或缺失 AND `step.goal_ref` 非空 → 组装 `<goal_context>` 块注入 prompt：
```
<goal_context>
Sub-goal: {goal.id} — {goal.goal}
Done when: {goal.done_when}
Boundary: {goal.boundary}
Evidence target: {goal.evidence}
Execution criteria: {session.execution_criteria joined by '; '}
</goal_context>
```

**3. Resolve agent name:** `{stage_prefix}-{ralph_session_id_short}-{HHmmss}`

   | Stage | Prefix |
   |-------|--------|
   | grill | `grl` |
   | brainstorm | `brn` |
   | analyze-macro | `anm` |
   | analyze | `ana` |
   | plan | `pln` |
   | execute | `exe` |
   | review | `rev` |
   | test | `tst` |
   | debug | `dbg` |
   | Other | `run` |

**4. Dispatch（unnamed executor）:**

> 执行 Agent 不传 name，结果通过 task-notification `<result>` 自动回传主流程。executor 内部编排也用 unnamed Agent（子结果自动回流 executor，嵌套套娃模型）。

```
Agent({
  subagent_type: "ralph-executor",
  description: "执行 step {index}: {step.skill} [{resolved_agent_name}]",
  prompt: `Session: {ralph_session_id}

{goal_context 块，仅 protocol < 2 时}

{loaded_step_context}
`
})
```

5. Write `step.agent_exec_name` to session state（仅日志标识）
6. Display: `[{index}/{total}] ⟶ {step.skill} → {resolved_agent_name}`
7. Agent() 返回 agentId → 等待 task-notification（status=completed 时 `<result>` 含 executor 输出）
8. task-notification 到达后，`agent_output` = `<result>` 内容 → 进入 S_STEP_ANALYZE
9. task-notification status=failed → STATUS=BLOCKED，转 S_HANDLE_FAIL

### A_STEP_EXTRACT

从 agent 返回的执行输出中提取结构化信号，用于 completion 参数组装。

**1. Stage-specific signal extraction:**

| Stage | 提取什么 | 写入字段 |
|-------|---------|---------|
| analyze | `conclusions.json` scope_verdict + key_findings | `--summary`, context.analysis_dir |
| plan | TASK-*.json 数量 + 主要模块 + 波次 | `--summary`, context.plan_dir |
| execute | 修改文件数 + verification passed/failed | `--summary`, `--evidence`, context.run_dir |
| review | verdict + findings 数量 + severity | `--summary`, `--decisions` |
| test | pass/fail 统计 | `--summary`, `--evidence` |
| debug | root cause + 修复内容 | `--summary`, `--decisions` |
| grill | 核心质疑点数量 | `--summary`, `--caveats`, context.grill_id |
| brainstorm | 候选方案数 + 推荐方案 | `--summary`, `--decisions`, context.brainstorm_dir |

**2. Artifact scanning** — Use Glob 查找执行期间新增/修改的产物:

| Pattern | Signal |
|---------|--------|
| `conclusions.json` | `analysis_dir` |
| `TASK-*.json` | `plan_dir` |
| `verification.json` | `run_dir` |
| `review.json` | review stage |
| `test-results.json`, `uat.md` | test stage |
| `grill-report.md` | `grill_id` |
| `.brainstorming/*` | `brainstorm_dir` |

**3. Output text signal extraction** — 从执行输出文本中提取：

| Signal pattern | 写入 |
|----------------|------|
| `ANL-xxx` (artifact ID) | `session.analyze_macro_id` |
| `PLN-xxx` (artifact ID) | `context.plan_dir` |
| `BLP-xxx` (artifact ID) | `session.blueprint_id` |
| `run_dir:` 或 `{run_dir}/outputs/` 路径 | `context.run_dir` |
| `plan_dir:` 路径 | `context.plan_dir` |
| `SESSION: {id}` | `session.context.session_id` |

**4. STATUS determination:**

| 条件 | STATUS |
|------|--------|
| Skill 正常完成 + 有产物 | `DONE` |
| 完成但有 warnings/concerns | `DONE_WITH_CONCERNS` |
| 执行出错但可重试（临时错误、网络问题） | `NEEDS_RETRY` |
| 执行出错且无法重试（schema 错误、command_path 不可达） | `BLOCKED` |
| Agent 返回 null（崩溃/超时） | `BLOCKED` |

**5. Compose completion params:**

| Param | 规则 | 组装方法 |
|-------|------|---------|
| `--summary` | MUST。动词开头，≤100 字 | `"<动词><做了什么>，<量化结果>"` |
| `--decisions` | SHOULD。每条一个架构/技术决策 | 从执行中做出的非显而易见的选择 |
| `--caveats` | SHOULD。后续 step 须知 | 发现但不属于本步解决的问题 |
| `--deferred` | SHOULD。推迟工作项 | 被主动推迟的项 |
| `--evidence` | SHOULD。验证产物路径 | 指向验证结果文件 |
| `--concerns` | COND。仅 DONE_WITH_CONCERNS 时 | CAVEATS 内容同时映射为 --concerns |

### A_STEP_DRIFT_ANALYZE

产物 vs 目标偏离分析。A_STEP_EXTRACT 后、A_STEP_COMPLETE 前执行。

**1. 收集对照基准:**

| 基准来源 | 取值 |
|---------|------|
| `step.goal_ref` → goal.done_when | 子目标完成条件 |
| `session.boundary_contract.definition_of_done` | 全局验收标准 |
| `session.execution_criteria` | 执行准则 |
| `session.intent` | 原始意图 |

**2. 对比评分:**

| 维度 | 检查 |
|------|------|
| 覆盖度 | 产物是否覆盖 goal.done_when 每个条件 |
| 方向性 | decisions 是否与 intent/boundary 一致 |
| 完整性 | 预期产物类型是否齐全 |

**drift_score:**
- `ALIGNED` — 全部维度通过
- `MINOR_DRIFT` — 小缺口，不影响后续
- `MAJOR_DRIFT` — 方向性偏离或关键产物缺失

**3. 修正动作:**

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常进入 S_STEP_COMPLETE |
| MINOR_DRIFT | 偏离项追加到 caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | `Bash("maestro ralph retry {index}")` → 回到 S_STEP_DISPATCH 重执行（drift_correction 作修正上下文注入 prompt） |
| MAJOR_DRIFT + 已重试 | 以 DONE_WITH_CONCERNS complete |

**4. 写入:** `step.drift_score`, `step.drift_correction`

### A_STEP_COMPLETE

调 `ralph complete` 上报 + 传播上下文信号 + 循环。

1. 使用 A_STEP_EXTRACT 组装的参数调用 `ralph complete`:
   ```
   Bash("maestro ralph complete {index} --status DONE --summary \"{SUMMARY}\" [--evidence ...] [--decisions ...] [--caveats ...] [--deferred ...]")
   ```
   DONE_WITH_CONCERNS 时 caveats 同时映射 `--concerns`。BLOCKED 时用 `--reason`。

2. **Context signals propagation** — 将关键信号写入 `ralph-meta.json context`:

   | Signal | 写入字段 |
   |--------|---------|
   | `analysis_dir` | `context.analysis_dir` |
   | `plan_dir` | `context.plan_dir` |
   | `run_dir` | `context.run_dir` |
   | `grill_id` | `context.grill_id` |
   | `brainstorm_dir` | `context.brainstorm_dir` |
   | `blueprint_dir` | `context.blueprint_dir` |
   | `ANL-xxx` | `session.analyze_macro_id` |
   | `BLP-xxx` | `session.blueprint_id` |
   | `session_id` | `session.context.session_id` |

3. Display: `[{index}/{total}] ✓ {step.skill} → {SUMMARY}`
4. Loop back to S_STEP_LOCATE

### A_AGENT_EVALUATE

通过 Agent 和/或 CLI delegate 评估质量门。评估模式由 `step.evaluate_via` 决定。

**1. Common setup:**

1. Resolve artifact dir: `{run_dir}/outputs/{artifact.path}/` with fallback glob
2. Parse decision metadata: `{ decision, retry_count, max_retries, evaluate_via }`
3. Map result files:

   | Decision | Files |
   |----------|-------|
   | post-execute | verification.json |
   | post-business-test | .tests/auto-test/report.json |
   | post-review | review.json |
   | post-test | uat.md, .tests/test-results.json |
   | post-frontend-verify | e2e-results.json |

4. `evaluate_via` 默认值：`"agent"`（未设置时）

**2. Dispatch by mode:**

**Mode: `agent`（默认）** — 同步 Agent 评估：

```
Agent({
  description: "评估 {decision} 质量门（同步评估 Agent，不传 name）",
  prompt: "PURPOSE: 评估 {decision} 质量门结果
TASK: 读取以下结果文件 | 分析状态 | 评估严重性 | 给出建议
FILES: {result_file_paths}
SESSION: {session_dir}/session.json + ralph-meta.json
EXPECTED: 输出以下格式：
---VERDICT---
STATUS: PASS|FAIL|PARTIAL|BLOCKED
REASON: <一句话原因>
GAP_SUMMARY: <差距摘要>
CONFIDENCE: high|medium|low
CONFIDENCE_SCORE: 0-100
WEAKEST_DIMENSION: <最弱维度>
---END---
CONSTRAINTS: 只评估不修改文件 | 置信度<60%倾向 fix | retry {n}/{max} 达上限必须 escalate"
})
```

**Mode: `cli`** — CLI delegate 评估（异步后台）：

```
Bash({
  command: `maestro delegate "PURPOSE: 评估 ${decision} 质量门结果\nTASK: 读取 ${result_file_paths} | 分析状态 | 评估严重性\nEXPECTED: ---VERDICT--- 格式（STATUS/REASON/GAP_SUMMARY/CONFIDENCE_SCORE）\nCONSTRAINTS: 只评估不修改文件" --mode analysis --rule analysis-review-code-quality`,
  run_in_background: true
})
```
等待 delegate 完成 → `maestro delegate output {exec_id}` 获取结果 → 解析 `---VERDICT---`

**Mode: `dual`** — Agent + CLI 并行评估，交叉验证：

1. 先派发 CLI delegate（`run_in_background: true`）
2. 同时派发同步 Agent（阻塞等待）
3. Agent 返回后，检查 CLI delegate 状态（`maestro delegate status {exec_id}`）
4. 合并裁决：

   | Agent 结果 | CLI 结果 | 合并策略 |
   |-----------|---------|---------|
   | 两者一致 | — | 采用共识，confidence_score 取较高值 |
   | Agent=PASS, CLI=FAIL | — | 降级为 PARTIAL，confidence_score 取平均值 |
   | Agent=FAIL, CLI=PASS | — | 维持 FAIL（保守策略） |
   | CLI 未返回 | — | 使用 Agent 结果，标 `"cli_pending": true` |

**3. Verdict parse + adjustment（所有模式通用）:**

5. Parse `---VERDICT---` block — STATUS must match strict enum `PASS|FAIL|PARTIAL|BLOCKED`; parse failure → fallback STATUS="fix", `parse_failed: true`, `confidence_score: 0` (invariant 18)
6. Confidence adjustment: <60 + proceed → fix; >95 + fix + retry>0 → suggest proceed
7. **Decision log**: Append to `{session_dir}/decisions.ndjson`:
   ```json
   { "id": "DEC-{timestamp}", "timestamp": "{ISO}", "source": "ralph",
     "node_id": "{step.decision}", "type": "quality-gate",
     "evaluate_via": "{mode}", "cli_exec_id": "{exec_id|null}",
     "verdict": "{adjusted_verdict}", "confidence_score": {N},
     "parse_failed": false,
     "close_call": {N>=50 && N<=70}, "summary": "{REASON}" }
   ```

### A_AGENT_GOAL_AUDIT

通过 Agent 和/或 CLI delegate 审计子目标完成情况。支持 `evaluate_via` 三种模式（同 A_AGENT_EVALUATE）。

1. Read `session.task_decomposition` from session state
2. Dispatch audit（按 `evaluate_via` 模式，默认 `agent`）:
   ```
   Agent({
     description: "审计子目标完成情况（同步评估 Agent，不传 name）",
     prompt: "PURPOSE: 审计未完成子目标，判定 met / unmet
   TASK:
     1. 读取 {session_dir}/session.json + ralph-meta.json 中 task_decomposition 的 status!=done 子目标
     2. 打开 evidence 产物，对照 done_when 严格判定
     3. 输出 met / unmet，unmet 给出 gap + target_stage
     4. 对照 intent + definition_of_done 判定意图保真
   CONTEXT:
     status.json        = {session_dir}/session.json + ralph-meta.json
     intent             = {session.intent}
     definition_of_done = {boundary_contract.definition_of_done}
     execution_criteria = {execution_criteria}
     boundary_contract  = {boundary_contract}
   EXPECTED:
     ---VERDICT---
     STATUS: all_met|has_unmet
     INTENT_ALIGNED: true|false
     UNMET: [{id:G2,gap:'...',target_stage:execute}, ...]
     CONFIDENCE_SCORE: 0-100
     ---END---
   CONSTRAINTS: 只评估不修改文件 | 严格按 done_when 判定 | evidence 缺失→unmet"
   })
   ```
3. On return: parse verdict, update task_decomposition status
4. Append `{session_dir}/decisions.ndjson`：`{ "type": "goal-gate", "evaluate_via": "{mode}", "unmet_count": N, "unmet_ids": [...] }`
5. Verdict routing: `all_met` + `INTENT_ALIGNED=true` → A_APPLY_GOAL_DONE；`all_met` + `INTENT_ALIGNED=false` → A_REGROUND_HALT；`has_unmet` → A_APPLY_GOAL_FIX
   GUARD: retry_count >= max_retries AND still unmet → A_APPLY_ESCALATE

### A_AGENT_REGROUND

通过 Agent 和/或 CLI delegate 执行意图保真检查。支持 `evaluate_via` 三种模式（同 A_AGENT_EVALUATE）。

1. Read session state：intent, boundary_contract, completed steps, done goals
2. Dispatch reground（按 `evaluate_via` 模式，默认 `agent`）:
   ```
   Agent({
     description: "意图保真检查（同步评估 Agent，不传 name）",
     prompt: "PURPOSE: 意图保真检查 — 对照 intent 验证累积执行是否漂移
   TASK:
     1. 读取 intent + boundary_contract.definition_of_done
     2. 读取已完成 steps 的 completion_evidence + 已 done 子目标
     3. 判定累积产出是否仍服务 intent
     4. 输出 aligned / drifted + drift_description + corrective_action
   CONTEXT:
     status.json        = {session_dir}/session.json + ralph-meta.json
     intent             = {session.intent}
     definition_of_done = {boundary_contract.definition_of_done}
     in_scope           = {boundary_contract.in_scope}
     out_of_scope       = {boundary_contract.out_of_scope}
     goal_changelog     = {session.goal_changelog ?? []}
   EXPECTED:
     ---VERDICT---
     STATUS: aligned|drifted
     DRIFT_DESCRIPTION: <空或具体描述>
     CORRECTIVE_ACTION: <空或建议>
     CONFIDENCE_SCORE: 0-100
     ---END---
   CONSTRAINTS: 只评估不修改文件 | aligned 阈值≥80% | 单个 step 触碰 out_of_scope→直接 drifted"
   })
   ```
3. On return: parse verdict
4. Append `{session_dir}/decisions.ndjson`
5. Verdict routing：aligned → A_APPLY_PROCEED；drifted + confidence >= 60 → A_REGROUND_HALT；drifted + confidence < 60 → A_APPLY_PROCEED (LOW CONFIDENCE)

### A_SCOPE_EVALUATE

仅由 `post-analyze-scope` 决策节点触发。

1. 定位刚完成的 macro analyze artifact → `analyze_macro_id`, `conclusions_path`
2. 读取 `conclusions.scope_verdict`（`large | medium | small`），缺失 → `unknown`
3. 写入 `session.scope_verdict` + `session.analyze_macro_id`
4. Append `{session_dir}/decisions.ndjson`：`{ "type": "scope-gate", "source": "ralph", "verdict": "{scope_verdict}", "analyze_macro_id": "{ANL_ID}" }`

### A_STRUCTURAL_EVALUATE

**post-session:**
1. Read state.json → resolve session dependency graph
2. next dep-ready session exists（依赖已满足的 pending session）→ A_ADVANCE_SESSION
3. no next session → END，set `active_session_id = null`

**post-debug-escalate:** always → A_PAUSE_ESCALATE

### A_SHOW_STATUS

1. Find latest `ralph-*` session（by created_at）
2. Display: Session, Status, Position, Progress, Current step
3. List steps: [✓] confirmed, [▸] current, [ ] pending, [◆] decision；执行 step 附 `command_scope` + `command_path`
4. If `task_decomposition` present → 显示 sub-goals 进度（done/total）

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE

- **A_APPLY_PROCEED**: Mark decision completed, write session state
- **A_APPLY_FIX**: Insert fix-loop steps after current step（见 Fix-Loop Templates），reindex，increment retry_count
- **A_APPLY_ESCALATE**: Insert `[debug "{gap_summary}", decision:post-debug-escalate]`，reindex

### A_APPLY_SCOPE_VERDICT

依据 `session.scope_verdict` + `session.wants_roadmap` 重塑下游链路：

1. 路径 A（`large` 且 `wants_roadmap`）：保持 roadmap+analyze，`plan` 选 session 列
2. 路径 B（`medium`/`small`，或 `large` 非 `wants_roadmap`）：删除未完成的 `roadmap` + `analyze` step，`plan` 改为 `--from analyze:{ANL_ID}`
3. 路径 C（`unknown`）：非 auto_confirm → AskUserQuestion；auto_confirm → 默认路径 B
4. Reindex steps，标 decision completed

### A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE

- **A_APPLY_GOAL_FIX**: 对每个 unmet 子目标插入 scoped mini-loop（plan --gaps + execute），`goal_ref` 标注，重新追加 `decision:post-goal-audit {retry+1}`
- **A_APPLY_GOAL_DONE**: set `task_decomposition[*].status="done"`, `completion_confirmed=true`, `task_decomposition_all_done=true`

### A_ADVANCE_SESSION

1. Update session: session_id, reset passed_gates
2. Insert full lifecycle steps for next session
3. Reindex, write session state

### A_REGROUND_HALT / A_PAUSE_ESCALATE

- **A_REGROUND_HALT**: set `session.status = "paused"`，display drift warning + 恢复选项。auto_confirm 不跳过
- **A_PAUSE_ESCALATE**: set session paused，display "请人工介入"，suggest continue

### A_AMEND_GOAL

运行中 session 的目标热修改。详细流程由 `<deferred_reading>` 加载 `ralph-amend-goal.md`。

| Phase | 行为 | 产出 |
|-------|------|------|
| 1. 快照 | 读 `task_decomposition` + `boundary_contract` + 已完成 steps 的 `completion_summary` | Display: 目标列表 + 进度 |
| 2. 解析 | `change_request` 非空 → 直接用；为空 → AskUserQuestion（修改/新增/移除/调整边界） | `change_type` + `change_request` |
| 3. Mini Grill | Agent 评估影响 | RISK_LEVEL + AFFECTED_GOALS + INVALIDATED_STEPS + NEW_GAPS |
| 4. 确认 | AskUserQuestion：应用并继续 / 仅改目标 / 取消 | 用户选择 |
| 5. 应用 | 归档旧目标（`superseded`）→ 写入新目标（`origin: CHG-xxx`）→ 重建链路 → write session state | re-dispatch |

**Phase 3 Agent prompt:**
```
Agent({
  description: "Amend impact analysis（同步评估 Agent，不传 name）",
  prompt: "PURPOSE: 评估目标修改对 running session 的影响
TASK:
  1. 读取 {session_dir}/session.json + ralph-meta.json 的 task_decomposition + boundary_contract + 已完成 steps
  2. 分析 change_request 对既有目标/步骤的影响
  3. 判定 RISK_LEVEL (low/medium/high)
  4. 列出 AFFECTED_GOALS / INVALIDATED_STEPS / NEW_GAPS
CONTEXT:
  change_request    = {change_request}
  change_type       = {change_type}
  session           = {session_dir}/session.json + ralph-meta.json
EXPECTED:
  ---AMEND-VERDICT---
  RISK_LEVEL: low|medium|high
  AFFECTED_GOALS: [G1, G2, ...]
  INVALIDATED_STEPS: [step indices]
  NEW_GAPS: [gap descriptions]
  RECOMMENDATION: <建议>
  ---END---
CONSTRAINTS: 只评估不修改文件"
})
```

GUARD: `RISK_LEVEL == high` → AskUserQuestion 不跳过（auto_confirm 无效）
GUARD: 已完成（`status: "done"`）的目标不可 supersede（skip + warn）
旧目标标 `superseded`（`superseded_by` + `superseded_at`），新目标标 `origin: "CHG-xxx"`。`goal_changelog` 含完整 `before/after` + `impact_assessment`。

### A_RETRY / A_PAUSE_SESSION / A_COMPLETE_SESSION

- **A_RETRY**: `Bash("maestro ralph retry {index}")` — CLI 将 chain step 重设为 pending，记录 retry_count
- **A_PAUSE_SESSION**: `ralph complete N --status BLOCKED --reason "..."` — CLI 写 `session.status = "paused"`
- **A_COMPLETE_SESSION**: 校验所有 step `completion_confirmed == true` + `task_decomposition_all_done == true`（若存在），通过后写 `session.status = "completed"`。unnamed executor 执行完自动终止，无需 shutdown 清理

</actions>

</state_machine>

<engines>

Ralph 是自适应编排器；其顺序链默认以 `--engine sequential`（当前行为）执行。`--engine swarm` 与 `--engine universal` 是叠加在链之上的**执行引擎模式**，为单个 step 增加*并行、对抗式*执行，但不拥有 session 状态。

| Engine mode | 脚本源 | 增加什么 | ralph 何时选它 |
|-------------|--------|----------|---------------|
| `--engine swarm`（fixed） | `swarm/wf-*.js` | 将 step intent 路由到预建 Workflow 脚本（`wf-*.js`）执行多 agent 并发 + 对抗门 | 标准 stage（analyze/brainstorm/review/verify/plan/execute/grill/milestone-audit）需要多维并行 + 交叉验证时 |
| `--engine universal`（dynamic） | `dynamic/uwf-*.js` | 扫描脚本库匹配；无匹配则按 depth 选定对抗模式**动态生成**任务专属 Workflow 脚本，持久化到 `dynamic/`，再执行 | 非标准任务 / 无匹配 fixed 脚本的新领域 |

**控制权边界**：两个引擎均为**并行加速器，非状态决策者** —— 从不修改 ralph session state、从不推进 step。FSM 保留 session 生命周期 + step 排序的所有权（invariant 21 控制权优先级）。引擎调用 `Workflow` 工具在 step 内部并行执行，结果回填该 step 的产物目录，仍由主流程 A_STEP_COMPLETE 调 `ralph complete` 上报。

**Ralph integration hook**：一个 step 的 `skill` 为引擎模式时携带 `args: "--engine swarm --script wf-analyze --session {session}"`；executor agent 通过 `maestro ralph next` 正常加载/执行，引擎在内部调用 `Workflow`。

### Engine: swarm (fixed scripts)

**Script inventory**（`~/.maestro/workflows/swarm/`）:

| Script | args interface |
|--------|----------------|
| `wf-analyze` | `{ target, scope, context, phase?, dimensions? }` |
| `wf-brainstorm` | `{ topic, context, count?, roles? }` |
| `wf-review` | `{ target, scope, specs?, tier?, dimensions? }` |
| `wf-verify` | `{ goals, plan_dir?, scope?, task_files?, must_haves?, skip_antipattern? }` |
| `wf-grill` | `{ topic, context?, depth?: "shallow"|"standard"|"deep" }` |
| `wf-plan` | `{ context_dir?, from?, phase?, scope?, specs?, gaps?, quick? }` |
| `wf-execute` | `{ plan_dir, specs?, codebase_context?, wiki_context?, auto_commit? }` |
| `wf-milestone-audit` | `{ milestone?, is_adhoc? }` |

**Intent→script routing**（最高优先级关键词胜出；`--script` 覆盖）:

| Priority | Keywords | Script |
|----------|----------|--------|
| 1 | 里程碑审计 / milestone-audit / 集成检查 / integration | `wf-milestone-audit` |
| 2 | 拷问 / grill / 压力测试 / stress-test / 挑战 / challenge | `wf-grill` |
| 3 | 验证 / verify / 反模式 / antipattern | `wf-verify` |
| 4 | 审查 / review / 代码审查 / code review / 质量 / quality | `wf-review` |
| 5 | 执行 / execute / 实现 / implement / 开发 / develop | `wf-execute` |
| 6 | 规划 / plan / 任务分解 / decompose / 分波 / wave | `wf-plan` |
| 7 | 头脑风暴 / brainstorm / 方案 / 评估 / evaluate / 多角度 | `wf-brainstorm` |
| 8 | 分析 / analyze / 探索 / explore / 架构 / architecture / 复杂度 / 风险 | `wf-analyze` |

Multi-match within a priority → `AskUserQuestion`。Cross-priority → 取更高优先级。

**Execution sequence:**
1. Parse args + intent → resolve script（`--script` first）。
2. Assemble the `args` payload（所有 FS 读取在此完成 —— 读 `.workflow/state.json` 取 phase/milestone，git diff 取 review scope，最新 plan artifact 取 verify goals 等）。
3. `Workflow({ scriptPath: '~/.maestro/workflows/swarm/{script}.js'（绝对路径）, args, resumeFromRunId })`。
4. Ingest results → 格式化含**对抗结果**的摘要（advocacy/referee、prosecutor/defender、3-vote tally、meta-skeptic rating 等）。
5. Write ralph-compatible artifacts 到该 step 的 Run output dir（格式匹配对应命令产物：`analysis.md`+`context.md`+`conclusions.json`+`adversarial-debate.json`、`review.json` 含 `adversarial_verdict`、`verification.json` 含 prosecutor/defender debate 等）。
6. Show `Resume: --engine swarm --resume {runId}`。

**Invariants:**
- Parallel-accelerate only —— 从不修改 ralph session state，从不推进 step。
- args pre-compiled —— 所有 FS 读取在 assembly step 完成；script 内部 agent 通过工具自读。
- Output 格式与对应命令产物兼容。
- `resumeFromRunId` 直接透传给 Workflow 工具（内置缓存）。
- Scripts 只读 —— routing 从不编辑 `wf-*.js`。
- Results 必须展示 —— 从不静默完成。

**When swarm vs plain sequential step:**

| Condition | Pick |
|-----------|------|
| 需多维并行 + 对抗交叉验证 | swarm |
| 需对话式 / interview_protocol | sequential（swarm agent 不能交互） |
| 必须写 state.json / 推进 ralph step | sequential（swarm 承诺不碰状态） |
| 时间预算充足、精度优先 | swarm |
| 上下文受限、快速单视图即可 | sequential |

### Engine: universal (dynamic scripts)

**Library**：fixed `~/.maestro/workflows/swarm/wf-*.js` + dynamic `~/.maestro/workflows/dynamic/uwf-*.js`。

**Flow**：scan → decide（reuse vs generate）→ design → generate → (confirm) → execute → persist。

1. **Scan** 两个目录；读每个文件的 `meta` 块（`name`/`description`/`whenToUse`）；对 intent 语义匹配；`AskUserQuestion` 呈现 >70% 匹配（max 3）+ "generate new" 选项。若某 swarm 脚本强匹配，优先改路由到 `--engine swarm`。
2. **Design**（生成时）：将 intent 分解为 `work_items`（explore/analyze/create/verify/decide）、`decision_points`（go-nogo/pass-fail/select-best/resolve-conflict/assess-quality）、`data_flow`；编排为 phases（独立项并行，每个 decision_point 后接对抗 phase）；按 decision_point × depth 选对抗模式（下表）；设计 per-agent JSON schema；呈现含预估 agent 数的 blueprint。
3. **Generate** 脚本（先写文件，再通过 `scriptPath` 执行 —— 从不 inline 脚本字符串）。
4. **Validate**：`node --check`；失败则修复重试 ≤2，否则 universal E003。
5. **Confirm** via `AskUserQuestion`（除非 `--resume`）；`--dry-run` 在 generate 后停止。
6. **Execute** `Workflow({ scriptPath: '~/.maestro/workflows/dynamic/uwf-{slug}.js', args, resumeFromRunId })`。
7. **Persist**：脚本已在 `dynamic/uwf-{slug}.js`；展示 reuse/resume/via-swarm 命令。

**Adversarial pattern selection（decision_type × depth）:**

| decision_type | shallow | standard | deep |
|--------------|---------|----------|------|
| go-nogo | 1 skeptic | 3-way advocacy + referee | cross-verify + 3-way advocacy + meta-skeptic |
| pass-fail | 1 challenger | prosecutor/defender/judge | cross-verify + prosecutor/defender + 3-vote |
| select-best | 1 critic | N proposals + judge panel | N proposals + judge + 3-critic challenge |
| resolve-conflict | 1 mediator | 3 philosophy proposals + arbitrator | 3 proposals + arbitrator + meta-skeptic |
| assess-quality | 1 skeptic | 3-vote (strict/lenient/objective) | cross-verify + 3-vote + meta-skeptic |

**Script generation rules（全部强制 —— 防止常见 Workflow 解析失败）:**

1. 纯 JavaScript —— 无 TS 类型注解（`: string`、`interface`、泛型）。
2. `meta` 块仅 ASCII（`name`/`description`/`whenToUse`/`phases[].title/detail`）—— 此处中文触发 `\uXXXX` 序列化解析错误。（agent prompt body 可用中文 —— 运行时字符串。）
3. 无 `Date.now()`、`Math.random()`、无参 `new Date()` —— 破坏 resume-cache 匹配。
4. 每个 JSON Schema 声明为 top-level `const XXX_SCHEMA = {...}`；通过 `schema: XXX_SCHEMA` 引用（从不 inline 大 schema）。
5. 用 `+` 字符串拼接，非模板字面量（backtick 嵌套 / `${}` 是首要解析错误源）。
6. Callback 用 `function(...)` 非箭头函数（避免隐式对象返回 `() => ({})` 陷阱）。
7. 从不用名为 `phase` 的变量遮蔽全局 `phase()` 函数。
8. 字符串中用正斜杠路径（`src/auth/`），从不反斜杠（`\a`、`\u` 变为转义序列）。
9. 仅在有明确匹配时设 `agentType`（如 `Explore`、`workflow-analyzer`）。
10. Null-safety：用 `?.` 链式；数组操作前 `.filter(Boolean)`（agent 可能在跳过时返回 null）。

**Adversarial pattern code templates**（生成时嵌入 top-level schema 常量 + 片段）：`Skeptic CrossVerify`（CHALLENGE_SCHEMA）、`3-Way Advocacy + Referee`（ADVOCACY_SCHEMA/DECISION_SCHEMA）、`Prosecutor/Defender/Judge`（ARGUMENT_SCHEMA/VERDICT_SCHEMA）、`3-Vote Majority`（VOTE_SCHEMA + `resolveVotes`）、`Competing Proposals + Judge`（PROPOSAL_SCHEMA/SCORE_SCHEMA）、`Meta-Skeptic`（META_CHALLENGE_SCHEMA，仅 deep）。标准对抗 schema 为稳定常量，重新生成时逐字复现。

**Invariants:**
- Scan before generate（避免重复脚本）。
- 每个 decision_point 都有对抗模式 —— 无单 agent 决策。
- Depth 单调：shallow ⊂ standard ⊂ deep。
- 纯 JS；meta 仅 ASCII；每个 agent 调用有 top-level 声明的 schema。
- Write file → `node --check` → 通过 `scriptPath` 执行（从不 inline）。
- 幂等命名（`uwf-{slug}.js` 覆盖；用户通过 `--name` 控制）。

</engines>

<appendix>

### Stage Mapping

执行 Agent 始终拥有完整工具集（read + write），由 skill 自身约束行为。Decision 评估 Agent 通过 prompt 中的 CONSTRAINTS 约束为只读。

| Stage | Skill | Decision after | quality_mode |
|-------|-------|----------------|--------------|
| grill | `grill "{intent}"` | — | all |
| brainstorm | `brainstorm "{intent}"` | — | all |
| blueprint | `blueprint "{intent}"` | — | all |
| init | `maestro-init` | — | all |
| spec-setup | `spec setup` | — | all |
| analyze-macro | `analyze "{intent}"` | `post-analyze-scope` | all |
| roadmap | `roadmap --from analyze:{id}` | — | all |
| analyze | `analyze --session {session}` | — | all |
| plan | `plan --session {session}` | — | all |
| execute | `execute --session {session}` | `post-execute` | all |
| business-test | `auto-test --session {session}` | `post-business-test` | full only |
| review | `review --session {session}` | `post-review` | all |
| test-gen | `auto-test --session {session}` | — | full / standard |
| test | `test --session {session}` | `post-test` | full, standard |
| frontend-verify | `test --session {session} --frontend-verify` | `post-frontend-verify` | all (UI only) |
| goal-audit | *(decision-only)* | `post-goal-audit` | all |
| session-seal | *(decision-only)* | `post-session` | all |

Build rules 0.5-13 全部适用，包括 spec-setup 预检（rule 0.5）、grill auto_confirm 透传（rule 3.5）、frontend-verify UI 门控（rule 3.6）、re-grounding 插入（rule 5.5）等。

### Session Schema

**session.json** (standard session, engine=ralph):
```json
{
  "schema_version": "session/1.0",
  "session_id": "{id}",
  "intent": "", "status": "running",
  "boundary_contract": {
    "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": ""
  },
  "orchestration": {
    "engine": "ralph",
    "quality_mode": "standard",
    "auto_mode": false,
    "chain": [{
      "step_id": "step-000-analyze",
      "command": "analyze",
      "status": "pending|running|completed|failed",
      "run_id": null,
      "inserted_by": "build",
      "decision_ref": null
    }],
    "decision_points": [{
      "point_id": "post-execute",
      "after_step_id": "step-001-execute",
      "status": "pending",
      "retry_count": 0, "max_retries": 2,
      "evidence_ref": null
    }]
  }
}
```

**ralph-meta.json** (ralph-specific orchestration extensions):
```json
{
  "lifecycle_position": "", "phase": null, "milestone": "",
  "scope_verdict": null, "planning_mode": "unified",
  "decomposition_owner": "ralph",
  "execution_criteria": [],
  "context": { "issue_id": null, "run_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
  "step_details": {
    "step-000-analyze": {
      "args": "", "stage": "analyze", "skill": "analyze",
      "goal_ref": null, "completion_status": null,
      "completion_summary": null, "completion_caveats": null
    }
  },
  "task_decomposition": [
    { "id": "G1", "goal": "", "boundary": "", "done_when": "",
      "evidence": "", "lifecycle": [], "status": "pending|done|superseded",
      "completion_confirmed": false, "completed_at": null,
      "superseded_by": null, "superseded_at": null, "origin": null }
  ],
  "task_decomposition_all_done": false,
  "goal_changelog": [
    { "id": "CHG-001", "timestamp": "{ISO}",
      "change_type": "modify|add|remove|boundary",
      "reason": "",
      "impact_assessment": { "risk_level": "low|medium|high",
        "invalidated_steps": [], "new_steps_inserted": 0 },
      "before": { "goals": [{"id":"G1","goal":"...","done_when":"..."}] },
      "after":  { "goals": [{"id":"G1v2","goal":"...","done_when":"..."}] } }
  ]
}
```

### Fix-Loop Templates

所有插入的执行 step 按 A_BUILD_STEPS 规则 9 解析 `command_path` + `command_scope`；`decision:*` 条目为 decision 节点（`step.decision` 字段）。插入的 step 通过 A_STEP_DISPATCH 派发 executor agent 逐步执行，由主流程调 `ralph complete` 上报。

**post-execute:**
```
debug "{gap_summary}"
plan --gaps --session {session}
execute --session {session}
decision:post-execute {retry+1}
```

**post-business-test:**
```
debug --from-business-test "{gap_summary}"
plan --gaps --session {session}
execute --session {session}
decision:post-execute {retry: 0}
auto-test --session {session}
decision:post-business-test {retry+1}
```

**post-review:**
```
debug "{gap_summary}"
plan --gaps --session {session}
execute --session {session}
review --session {session}
decision:post-review {retry+1}
```

**post-test:**
```
debug --from-uat "{gap_summary}"
plan --gaps --session {session}
execute --session {session}
decision:post-execute {retry: 0}
auto-test --session {session}
decision:post-business-test {retry: 0}
review --session {session}
decision:post-review {retry: 0}
auto-test --session {session}
test --session {session}
decision:post-test {retry+1}
```

**post-frontend-verify:** (UI 写端点未接线/不可用时)
```
debug --from-frontend-verify "{gap_summary}"
plan --gaps --session {session}
execute --session {session}
test --session {session} --frontend-verify
decision:post-frontend-verify {retry+1}
```

**post-goal-audit:** (per unmet sub-goal group)
```
# for each unmet sub-goal G{n}, scoped to session:
plan --gaps --session {session} "G{n}: {gap}"     [goal_ref: G{n}]
execute --session {session}                       [goal_ref: G{n}]
# after all unmet groups inserted:
decision:post-goal-audit {retry+1}
```

### Error Codes

E001–E006, W001–W004 适用。Agent 新增：

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E014 | error | Agent execution failed (Agent returned null) | Retry once, then BLOCKED |
| E016 | error | Evaluation Agent verdict parse failed | Fallback fix + parse_failed: true |

Engine 模式新增（`--engine swarm|universal`，见 `<engines>`）：

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| swarm E001 | error | No intent and no `--script` | Prompt for intent |
| swarm E002 | error | Ambiguous routing | AskUserQuestion |
| swarm E003 | error | Script file not found | Check `~/.maestro/workflows/swarm/` |
| swarm E004 | error | Workflow execution failed | Show error, suggest `--resume` |
| universal E002 | error | Task decomposition failed | Require more specific intent |
| universal E003 | error | Generated script syntax error after 2 retries | Show script + error for manual fix |
| universal E004 | error | Workflow execution failed | Show error, offer `--resume {runId}` |

### Success Criteria

- [ ] ralph owns full step loop: locate → resolve → dispatch → wait task-notification → extract → drift → complete → next
- [ ] One agent per step — `Agent({ subagent_type: "ralph-executor" })` 每步派发一个 unnamed executor
- [ ] Executor 内调 `maestro ralph next` 获取 skill prompt 并执行，内部编排用 unnamed Agent（子结果回流 executor）
- [ ] Executor 结果通过 task-notification `<result>` 自动回传主流程
- [ ] 主流程调 `maestro ralph complete` 上报（非 agent 上报）
- [ ] 主流程负责 arg resolution、context loading、signal extraction、drift analysis
- [ ] task-notification status=failed → STATUS=BLOCKED，转 S_HANDLE_FAIL
- [ ] Unified unnamed dispatch: 执行 Agent 和评估 Agent 均不传 name，结果通过 task-notification 回传。CLI delegate 仅限评估环节
- [ ] Decision evaluation 支持三种模式：agent（同步）、cli（CLI delegate）、dual（并行交叉验证）
- [ ] `evaluate_via` 字段控制评估模式，默认 `"agent"`
- [ ] dual 模式合并策略：一致取共识、分歧保守降级、CLI 未返回用 Agent 结果
- [ ] Verdict 解析保持 `---VERDICT---` 格式，parse 失败 → fallback fix + parse_failed: true
- [ ] decisions.ndjson 追加：source 字段为 `"ralph"`
- [ ] Session schema: `execution_mode: "agent"`，`agent_exec_name`（display 标识），含 `artifacts_produced`
- [ ] Chain building（S_RESOLVE_SESSION through S_BUILD_CHAIN）自包含执行
- [ ] A_STEP_DISPATCH 含前序产出加载（滑动窗口 5 step + accumulated signals + stage-specific artifacts）
- [ ] `agent_exec_name` 含 stage prefix（grl/brn/anm/ana/pln/exe/rev/tst/dbg）——仅用于 display/日志标识
- [ ] `--summary` 在 DONE/DONE_WITH_CONCERNS 时为 MUST（动词开头，≤100 字）
- [ ] CAVEATS 在 DONE_WITH_CONCERNS 时同时映射 --concerns
- [ ] A_STEP_EXTRACT 从 executor 输出提取 artifact IDs、path signals、session signals
- [ ] A_STEP_DRIFT_ANALYZE：ALIGNED/MINOR_DRIFT → complete；MAJOR_DRIFT+未重试 → retry；MAJOR_DRIFT+已重试 → DONE_WITH_CONCERNS
- [ ] A_STEP_COMPLETE 将 context signals 写入 ralph-meta.json context
- [ ] A_AMEND_GOAL：完整 5 步流程 + deferred_reading ralph-amend-goal.md + Agent mini grill 含完整 prompt
- [ ] 旧目标标 superseded（superseded_by + superseded_at），新目标 origin: "CHG-xxx"
- [ ] goal_changelog 含完整 before/after + impact_assessment
- [ ] blueprint_id session 字段支持 --from blueprint:{BLP_ID} 路径
- [ ] spec-setup 预检（build rule 0.5）
- [ ] post-session adhoc 分支：mark session sealed + clear active_session_id
- [ ] post-reground + drifted + confidence < 60 → A_APPLY_PROCEED (LOW CONFIDENCE)
- [ ] Fix-loop 插入的 step 通过 A_STEP_DISPATCH 逐步执行
- [ ] re-grounding 3-step 插入规则（build rule 5.5）不变
- [ ] A_REGROUND_HALT 漂移熔断（auto_confirm 不跳过）不变
- [ ] `--engine swarm [--script wf-*]` 路由 intent → 运行 fixed Workflow 脚本 → ingest 对抗摘要 + 写 ralph-compatible artifacts
- [ ] `--engine universal [--depth ...] [--from ...] [--dry-run]` 扫描库，无匹配时 generate+validate 动态脚本，经 scriptPath 执行，持久化到 `dynamic/`
- [ ] 两引擎均不修改 ralph session state 或推进 step（控制权优先级 invariant 21 不变）
- [ ] 引擎结果回填 step 产物目录，仍由主流程 A_STEP_COMPLETE 调 `ralph complete` 上报

</appendix>
</output>
