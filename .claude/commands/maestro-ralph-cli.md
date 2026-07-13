---
name: maestro-ralph-cli
description: "[LEGACY — prefer maestro-ralph-v2] CLI-delegated lifecycle orchestrator — compose, delegate, analyze, decide in one loop"
argument-hint: "<intent> [-y] [--to <tool>] [--amend [change]] [--roadmap] | status | continue"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
CLI-delegated lifecycle orchestrator: compose prompt → delegate to CLI (via ralph-cli-execute wrapper) → STOP → callback → analyze structured result → mark complete → decide next → loop.

Session: `.workflow/.maestro/ralph-cli-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag        → auto_confirm = true
--to <tool>    → cli_tool (claude|codex|opencode|agy); 默认 claude
--roadmap      → wants_roadmap = true
--amend / -a   → amend_mode = true
.md/.txt path  → input_doc
status|continue → route keyword
Remaining      → intent (amend_mode 时为 change_request)
```

**CLI tool selection:**
1. `--to <tool>` 显式指定 → 直接使用
2. 未指定 → 默认 `claude`
3. 校验 `cli-tools.json` 中目标工具 `enabled: true`
4. `enabled: false` → E012

**State files**:
- `.workflow/state.json` — artifact registry
- `.workflow/.maestro/ralph-cli-*/status.json` — session state
</context>

<invariants>
1. **Ralph-cli never executes steps** — only creates sessions, composes delegation prompts, and evaluates decisions；执行由 delegate 端 cli-execute 完成
2. **ralph-cli owns the loop** — compose → delegate → analyze → decide 全部在本命令内完成；ralph-cli-execute 只是被委托端的执行包装器
3. **Delegate via cli-execute** — delegate prompt 首行为 cli-execute 调用，格式由目标工具决定（见 Invocation Notation）
4. **Parse ---RESULT--- block** — delegate 返回后从输出中解析结构化结果块
5. **Decision evaluation inline** — decision 节点不 handoff，直接在本循环内评估（用 `maestro delegate --to {session.cli_tool} --mode analysis` 做只读分析）
6. **Decision delegates read-only** — `maestro delegate --to <tool> --mode analysis`
7. **No inline skill execution** — 本命令不执行 skill 逻辑；执行由委托端 cli-execute 完成
8. **执行 step 通过 `maestro ralph next` CLI 加载并内联执行**（由 cli-execute 端完成）
9. **status.json 是唯一真源** — 不生成 markdown 清单或侧文件
10. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE`（或 DONE_WITH_CONCERNS）写入；CLI 是唯一合法写入路径
11. **command_path 在 A_BUILD_STEPS 解析** — 通过 `maestro ralph skills --platform claude --json --quiet` 预校验
12. **执行 step 加载契约** — 由 `maestro ralph next` CLI 在执行期完成
13. **Decomposition is outcome-oriented** — sub-goals 为可观测交付，禁止 lifecycle 复刻
14. **planning_mode governs arg granularity** — `unified` → skill args 无 `{phase}`；`independent` → 含 `{phase}`
15. **task_decomposition 驱动 steps[] 动态生长** — `post-goal-audit` 按 unmet 子目标插入 scoped mini-loop
16. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作
17. **Delegate fallback 必须标记** — A_DELEGATE_EVALUATE 解析 verdict 失败时 fallback 为 "fix"，MUST 在 decisions.ndjson 记录 `"parse_failed": true, "confidence_score": 0`
18. **auto_confirm 单一来源** — `auto_confirm` 仅由用户 `-y` 标志设定
19. **分解契约单一所有者** — `boundary_contract` / `task_decomposition` 由 session 创建者拥有
20. **控制权优先级（范式治理）** — FSM 独占 session 生命周期 + step 排序 + retry/fix/escalate + cross-step decision 节点
</invariants>

<state_machine>

Chain-building states（S_PARSE_ROUTE through S_CREATE_SESSION）+ 执行循环 states（替代 S_DISPATCH）：

<states>
S_PARSE_ROUTE   — 解析参数、路由入口
S_STATUS        — 显示 session 进度
S_CONTINUE      — 恢复执行
S_RESOLVE_PHASE — 解析 phase 三元组                          PERSIST: session.phase, phase_is_new, milestone
S_INFER         — 推断生命周期位置                             PERSIST: session.lifecycle_position
S_RESOLVE_SCOPE — 读 macro scope_verdict                      PERSIST: session.scope_verdict, analyze_macro_id
S_QUALITY_MODE  — 决定质量管线长度                             PERSIST: session.quality_mode
S_PLANNING_MODE — 决定规划粒度                                PERSIST: session.planning_mode
S_DECOMPOSE     — 分解子目标                                  PERSIST: session.task_decomposition
S_BUILD_CHAIN   — 构建步骤链（build rules 0-14）              PERSIST: session.steps[]
S_CREATE_SESSION — 写 status.json
S_CONFIRM       — 用户确认

S_STEP_LOCATE   — 找下一个 pending step                    PERSIST: —
S_STEP_RESOLVE  — 解析占位符 + 丰富参数                    PERSIST: step.args
S_STEP_LOAD     — 加载前序产出 + 发现                      PERSIST: —
S_STEP_COMPOSE  — 根据目标 skill 生成适配 prompt            PERSIST: —
S_STEP_DELEGATE — 调 maestro delegate → STOP              PERSIST: step.delegate_exec_id, step.status
S_STEP_ANALYZE  — 解析 ---RESULT--- 块 + 分析产物          PERSIST: step.cli_output_summary, session.context
S_POST_ANALYZE  — 产物 vs 目标偏离分析                      PERSIST: step.drift_score, step.drift_correction
S_STEP_COMPLETE — 标记完成                                 PERSIST: step.completion_*
S_DECISION_EVAL — 评估 decision 节点                       PERSIST: —
S_APPLY_VERDICT — 应用裁决                                 PERSIST: session.steps[]
S_SESSION_DONE  — 所有 step 完成                           PERSIST: session.status
S_HANDLE_FAIL   — 处理失败                                 PERSIST: step.status
S_AMEND_GOAL    — 修改 running session 目标                PERSIST: session.task_decomposition, .boundary_contract, .goal_changelog, .steps[]
S_FALLBACK      — 请求用户输入                             PERSIST: —
</states>

<transitions>

S_PARSE_ROUTE:
  → S_STATUS        WHEN: intent == "status"
  → S_CONTINUE      WHEN: intent == "continue"
  → S_AMEND_GOAL    WHEN: amend_mode == true AND running session exists
  → S_FALLBACK      WHEN: amend_mode == true AND no running session
  → S_STEP_LOCATE   WHEN: running session with decision step in "running" status
  → S_RESOLVE_PHASE WHEN: intent is non-empty
  → S_FALLBACK      WHEN: no intent AND no running session

S_STATUS:
  → END             DO: A_SHOW_STATUS

S_CONTINUE:
  → S_STEP_LOCATE   WHEN: running session found
  → S_FALLBACK      WHEN: no running session

S_AMEND_GOAL:
  → S_STEP_LOCATE   WHEN: change applied + user confirmed    DO: A_AMEND_GOAL
  → END             WHEN: user cancels
  GUARD: RISK_LEVEL=high → auto_confirm 无效

S_CREATE_SESSION:
  → S_CONFIRM       WHEN: not auto_confirm
  → S_STEP_LOCATE   WHEN: auto_confirm

S_CONFIRM:
  → S_STEP_LOCATE   WHEN: user confirms
  → S_BUILD_CHAIN   WHEN: user edits
  → END             WHEN: user cancels

S_STEP_LOCATE:
  → S_STEP_RESOLVE  WHEN: pending execution step found
  → S_DECISION_EVAL WHEN: pending decision step found
  → S_SESSION_DONE  WHEN: no pending steps
  → S_FALLBACK      WHEN: no running session

S_STEP_RESOLVE:
  → S_STEP_LOAD     DO: A_RESOLVE_ARGS

S_STEP_LOAD:
  → S_STEP_COMPOSE  DO: A_LOAD_STEP_CONTEXT

S_STEP_COMPOSE:
  → S_STEP_DELEGATE DO: A_COMPOSE_DELEGATION_PROMPT

S_STEP_DELEGATE:
  → END             DO: A_DISPATCH_DELEGATE (STOP after dispatch)

(callback resumes here — re-invocation via continue or automatic)
S_STEP_LOCATE (on re-entry, finds running step with delegate_exec_id):
  → S_STEP_ANALYZE  WHEN: delegate completed
  → S_HANDLE_FAIL   WHEN: delegate failed (status != completed AND status != running)
  → END             WHEN: delegate still running (STOP)

S_STEP_ANALYZE:
  → S_POST_ANALYZE  WHEN: result STATUS == DONE|DONE_WITH_CONCERNS   DO: A_PARSE_RESULT
  → S_HANDLE_FAIL   WHEN: result STATUS == NEEDS_RETRY|BLOCKED       DO: A_PARSE_RESULT

S_POST_ANALYZE:
  → S_STEP_COMPLETE WHEN: drift_score == ALIGNED|MINOR_DRIFT   DO: A_POST_ANALYZE_DRIFT
  → S_STEP_LOAD     WHEN: drift_score == MAJOR_DRIFT + not retried  DO: A_POST_ANALYZE_DRIFT (re-delegate with correction)
  → S_STEP_COMPLETE WHEN: drift_score == MAJOR_DRIFT + retried     DO: A_POST_ANALYZE_DRIFT (proceed with caveats)

S_STEP_COMPLETE:
  → S_STEP_LOCATE   DO: A_MARK_COMPLETE (loop to next step)

S_DECISION_EVAL:
  → S_APPLY_VERDICT WHEN: quality-gate (post-execute, post-business-test, post-review, post-test, post-frontend-verify)
                     DO: A_DELEGATE_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate (post-goal-audit)
                     DO: A_GOAL_AUDIT_EVALUATE
  → S_APPLY_VERDICT WHEN: scope-gate (post-analyze-scope)
                     DO: A_SCOPE_EVALUATE
  → S_APPLY_VERDICT WHEN: reground-gate (post-reground)
                     DO: A_REGROUND_EVALUATE
  → S_APPLY_VERDICT WHEN: structural (post-milestone, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_STEP_LOCATE   WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_STEP_LOCATE   WHEN: post-goal-audit + has_unmet       DO: A_APPLY_GOAL_FIX
  → S_STEP_LOCATE   WHEN: post-goal-audit + all_met + INTENT_ALIGNED=true  DO: A_APPLY_GOAL_DONE
  → END             WHEN: post-goal-audit + all_met + INTENT_ALIGNED=false  DO: A_REGROUND_HALT
  → S_STEP_LOCATE   WHEN: post-analyze-scope                DO: A_APPLY_SCOPE_VERDICT
  → S_STEP_LOCATE   WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_STEP_LOCATE   WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_STEP_LOCATE   WHEN: post-milestone + standard + next milestone   DO: A_ADVANCE_MILESTONE
  → END             WHEN: post-milestone + standard + no next milestone
  → END             WHEN: post-milestone + adhoc                       DO: mark completed (adhoc self-contained, set current_milestone = null)
  → END             WHEN: post-debug-escalate                DO: A_PAUSE_ESCALATE
  → END             WHEN: post-reground + drifted + confidence >= 60  DO: A_REGROUND_HALT
  → S_STEP_LOCATE   WHEN: post-reground + aligned           DO: A_APPLY_PROCEED
  → S_STEP_LOCATE   WHEN: post-reground + drifted + confidence < 60  DO: A_APPLY_PROCEED (标 LOW CONFIDENCE)
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → AskUserQuestion with override options
  GUARD: post-reground + drifted + confidence >= 60 → A_REGROUND_HALT（auto_confirm 不跳过）

S_HANDLE_FAIL:
  → S_STEP_LOCATE   WHEN: auto + not retried              DO: A_RETRY
  → END             WHEN: auto + retried                   DO: A_PAUSE_SESSION
  → S_STEP_LOCATE   WHEN: interactive + retry
  → S_STEP_LOCATE   WHEN: interactive + skip
  → END             WHEN: interactive + abort

S_SESSION_DONE:
  → END             DO: A_COMPLETE_SESSION

</transitions>

<actions>

### A_RESOLVE_PHASE

前置于 A_INFER_POSITION。产出 `phase` + `phase_is_new` + `milestone`（D-007 反查）三元组。

**Priority:**

| Step | 行为 | phase_is_new |
|------|------|--------------|
| 1 | intent 匹配 `phase\s*(\d+)` → 取 state.json 对应 phase | false |
| 2 | intent 派生短语 → 在 `state.json.milestones[*].phase_slugs` / `artifacts[*].path` 查找 | false (匹配) / true (无匹配) |
| 3 | 未派生 → 取最新 in-progress artifact 的 phase | false |
| 4 | 仍无 → state.json 首个 incomplete phase | false |
| 5 | position 将是 brainstorm/blueprint/init/roadmap/analyze-macro → phase = null | n/a |
| 6 | 仍模糊 → `AskUserQuestion` | 由用户回答确定 |

**D-007 Phase→Milestone 反查**（数字 phase 已解析时）：
```
resolve_milestone(phase_number):
  for ms in state.json.milestones:
    if str(phase_number) in ms.phase_slugs: return ms.id
  return state.json.current_milestone   # fallback
```
写入 `session.milestone`；禁止直接使用 `current_milestone` 当做 phase 所属 milestone。

**写入 session**: `phase`, `phase_is_new`, `milestone`。

**新派生 phase 时 milestone 处理**：
- state.json 当前 milestone 仍 active → 沿用，新增 phase
- intent 派生新 milestone 名 → 写入 session 仅作标签；`state.json.milestones` 由 `maestro-roadmap` / `maestro-milestone-release` 创建

### A_INFER_POSITION

**Intent-based overrides** (按顺序匹配，先命中先用):

| Pattern | Position |
|---------|----------|
| 压力测试 / 拷问 / 验证假设 / grill / stress-test | `grill`（**auto_confirm=true 时透传 `-y`，grill 以 Auto mode 代码代答，不跳过**） |
| brainstorm / 头脑风暴 / 探索 / ideate / 设计思路 | `brainstorm` |
| blueprint / 规格 / 正式文档 / spec-generate / 7-phase | `blueprint` |
| broad/medium intent 无数字 phase (重构/全面/重写/迁移/新功能 X) | `analyze-macro` |

**Roadmap opt-in detection** (设 `session.wants_roadmap`，缺省 `false`):
```
wants_roadmap = (--roadmap flag)
             OR (intent 含多发布信号: 多发布|多版本|分阶段交付|按里程碑发布|v1.*v2|multi-release|roadmap)
             OR (.workflow/roadmap.md 已存在)   ← 向后兼容：既有 roadmap 项目行为不变
```
默认 `false` → large 项目走单一多波次 `plan --from analyze`，不引入 roadmap 横切层；roadmap 仅多发布场景 opt-in。

**Bootstrap detection:**

| Condition | Position |
|-----------|----------|
| No `.workflow/` + no source files | `brainstorm` |
| No `.workflow/` + has source files | `init` |
| Has `.workflow/` but no state.json | `init` |
| Has state.json | → phase-aware artifact inference |

**Phase-aware artifact inference** (使用 A_RESOLVE_PHASE 已写入的 `session.phase` + `session.phase_is_new`)：

| Condition | Position |
|-----------|----------|
| `phase_is_new == true` (新 phase) | `analyze` |
| no milestones AND no roadmap.md AND has analyze macro artifact | `roadmap` if `wants_roadmap` else `plan` (--from analyze) |
| no milestones AND no roadmap.md AND no analyze artifact | `analyze-macro` |
| `phase == null` (grill/brainstorm/blueprint/init/roadmap/analyze-macro override 已定) | n/a |
| phase 已存在 + 无任何 artifact | `analyze` |
| phase 已存在 + 最新 artifact = analyze | `plan` |
| phase 已存在 + 最新 artifact = plan | `execute` |
| phase 已存在 + 最新 artifact = execute | → refine from post-execute results |

**关键不变量**：artifact 过滤按 `session.phase`，不读 `state.json.current_phase`。`phase_is_new` → 直接 `analyze`。

### A_RESOLVE_SCOPE_VERDICT

仅当 `lifecycle_position ∈ {analyze-macro, roadmap, plan}` 且存在最新 analyze artifact 时执行。

1. 定位最新 macro analyze artifact（`type=="analyze"` 且 `scope=="macro"`，按 created_at DESC）→ 记 `session.analyze_macro_id = ANL-xxx`
2. 读 `{artifact_path}/conclusions.json` 的 `scope_verdict` 字段（`large | medium | small`）
3. 写入 `session.scope_verdict`；缺失时设 `unknown`
4. 路由建议（A_BUILD_STEPS 据此决定是否插入 roadmap、plan 是否走 `--from`）：

| scope_verdict | 链路 |
|---------------|------|
| `large` + `wants_roadmap` | analyze-macro → roadmap → analyze → plan → execute → ...（多发布 opt-in） |
| `large`（默认）/ `medium` / `small` | analyze-macro → plan --from analyze:{ANL_ID} → execute → ...（跳过 roadmap + analyze-phase；单一多波次计划） |
| `unknown` | 默认走 standalone（plan --from analyze）路径，post-analyze-scope 决策节点再纠正 |

**Refine from post-execute results:**

在 execute artifact 的 Run output directory 中检查结果文件（verification.json 由 execute 内置 gate 产出）：

| Condition | Position |
|-----------|----------|
| 无 verification.json 或 passed==false 或 gaps[] | `execute` (触发 post-execute fix loop) |
| passed==true, no review.json | `business-test` |
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed + `session.milestone` 存在 | `milestone-audit` |
| uat.md: all passed + `session.milestone=null` (standalone) | 标记 session completed（无 milestone 可审计） |
| uat.md: has failures | `test-failed` |

### A_DETERMINE_QUALITY_MODE

决定下游质量管线长度。读 `session.quality_mode_override`（CLI 标志 `--quality`），无则按规则推断：

| Condition | Mode | Pipeline (execute 之后) |
|-----------|------|-------------------------|
| Has `specs/REQ-*.md` + 当前 phase 业务范围明确 | `full` | business-test → review → test-gen → test |
| Default | `standard` | review → test-gen (当 coverage<80%) → test |
| `--quality quick` | `quick` | review --tier quick |

写入 `session.quality_mode`。A_BUILD_STEPS 据此过滤 stage。

### A_DETERMINE_PLANNING_MODE

决定里程碑的规划粒度：一次性规划整个里程碑（统一）还是逐 phase 走完整生命周期（独立）。

**Auto-resolve rules (按优先级):**

| Condition | Mode | Reason |
|-----------|------|--------|
| lifecycle_position ∈ {grill, brainstorm, init, roadmap} | `independent` | 前期阶段不涉及多 phase 规划 |
| `phase_is_new == true` | `independent` | 新 phase 尚无里程碑上下文 |
| intent 显式指定 phase 编号（如 "phase 2"、"P3"） | `independent` | 用户明确针对单个 phase |
| milestone 仅含 1 个 phase（读 state.json） | `independent` | 统一无意义 |
| milestone 含多个 phase + `auto_confirm` | `unified` | 自动模式倾向高效 |
| milestone 含多个 phase + 非 `auto_confirm` | → AskUserQuestion | 征询用户选择 |

**AskUserQuestion** (仅当 milestone 含 ≥2 phase 且非 auto_confirm):

```
question: "当前里程碑含 {N} 个 phase，选择规划模式？"
options:
  - label: "统一规划 (Recommended)"
    description: "一次性分析+规划整个里程碑所有 phase，analyze/plan 走里程碑级，适合 phase 间关联紧密"
  - label: "独立规划"
    description: "逐个 phase 走完整生命周期（analyze→plan→execute→...），适合 phase 间独立性高"
```

写入 `session.planning_mode`（`"unified"` 或 `"independent"`）。`A_BUILD_STEPS` 据此决定 skill args 是否携带 `{phase}` 占位符。

### A_DECOMPOSE_TASKS

Runs once before chain build; additive to status.json. 设 `session.decomposition_owner = "ralph"`。

**0. Ownership guard** (invariant 15): 若 `session.boundary_contract` 或 `session.task_decomposition` 已非空（上游 maestro 已写入，`decomposition_owner == "maestro"`）→ MUST 跳过下述提问，仅做 shape 校验 + 缺省字段补齐，直接进入步骤 6。

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

Generate steps from `session.lifecycle_position` to `milestone-complete`（`session.milestone` 存在时）或最后一个质量门（standalone 时）。

> CLI 注：每个执行 step 通过 `maestro delegate` 外部委托执行（见 Stage Mapping 表的 delegate_mode/delegate_rule 分配）。

| Stage | Skill (independent) | Skill (unified) | Decision after | quality_mode |
|-------|---------------------|-----------------|----------------|--------------|
| grill | `maestro-grill "{intent}"` | *(same)* | — | all (**auto_confirm → 透传 `-y` 到 grill args，不删除 stage**) |
| brainstorm | `maestro-brainstorm "{intent}" --from grill:{grill_id}` *(if grill ran)* / `maestro-brainstorm "{intent}"` *(otherwise)* | *(same)* | — | all |
| blueprint | `maestro-blueprint "{intent}"` | *(same)* | — | all |
| init | `maestro-init` | *(same)* | — | all |
| spec-setup | `spec-setup` | *(same)* | — | all (**仅当 `.workflow/specs/` 不存在时插入**) |
| analyze-macro | `maestro-analyze "{intent}"` | *(same)* | `post-analyze-scope` | all |
| roadmap | `maestro-roadmap --from analyze:{analyze_macro_id}` | *(same)* | — | all |
| analyze | `maestro-analyze {phase}` | `maestro-analyze` | — | all |
| plan | `maestro-plan {phase}` *(scope=phase)* / `maestro-plan --from analyze:{analyze_macro_id}` *(scope=standalone)* / `maestro-plan --from blueprint:{blueprint_id}` *(scope=standalone)* | `maestro-plan` | — | all |
| execute | `maestro-execute {phase}` | `maestro-execute` | `post-execute` | all |
| business-test | `quality-auto-test {phase}` | `quality-auto-test` | `post-business-test` | full only |
| review | `quality-review {phase}` | `quality-review` | `post-review` | all (quick: append `--tier quick`) |
| test-gen | `quality-auto-test {phase}` | `quality-auto-test` | — | full / standard if coverage<80% |
| test | `quality-test {phase}` | `quality-test` | `post-test` | full, standard |
| frontend-verify | `quality-test {phase} --frontend-verify` | `quality-test --frontend-verify` | `post-frontend-verify` | all（**仅当 phase 交付 UI 时插入**：检出 `dashboard/` 或 UI 关键词 `landing\|page\|dashboard\|frontend\|UI\|component\|界面`） |
| milestone-audit | `maestro-milestone-audit` | *(same)* | — | all |
| goal-audit | *(decision-only)* | *(same)* | `post-goal-audit` | all (only if decomposed) |
| milestone-complete | `maestro-milestone-complete` | *(same)* | `post-milestone` | all |

> 所有执行 stage 通过 `maestro ralph next` CLI 加载，由 A_DISPATCH_DELEGATE 委托到外部 CLI 工具执行；decision 节点单独作为独立 step 插入。

**Build rules (按顺序应用):**

0. **planning_mode 选列**：`unified` → Skill (unified) 列；`independent` → Skill (independent) 列
0.5. **specs 预检**：当 `lifecycle_position ∉ {grill, brainstorm, blueprint, init}` 且 `.workflow/specs/` 目录不存在时，在链路最前面插入 `spec-setup` 步骤（stage=`spec-setup`，无 decision）。确保下游 analyze/plan/execute 可获得项目约束规则注入
1. **起点**：从 `session.lifecycle_position` 开始
2. **跳过已完成**：跳过当前 milestone+phase 下已有 completed artifact 的 stage（按 `session.phase` 过滤）；unified 按 milestone 过滤
3. **quality_mode 过滤**：按 `session.quality_mode` 排除不匹配 stage
3.5. **grill auto_confirm 透传**：`auto_confirm == true` 时为 `grill` step args 追加 `-y`（grill 自身 Auto mode 用代码代答，见 maestro-grill `<context>` Mode selection）；保留 `grill` stage 与 brainstorm 的 `--from grill:*`（grill 仍产出 grill-report/terminology/context-package）
3.6. **frontend-verify UI 门控**：仅当当前 phase 交付前端（检出 `dashboard/` 目录，或 phase 目标/计划含 UI 关键词 `landing|page|dashboard|frontend|UI|component|界面`）时保留 `frontend-verify` stage + `post-frontend-verify` decision；纯后端 phase 删除该 stage
4. **决策节点**：每个 Decision after 非空的 stage 之后插入 `{ decision: "<gate>", retry_count: 0, max_retries: 2, command_scope: null, command_path: null }`
5. **goal-audit 插入**：`task_decomposition` 存在时，在最后一个 evidence-producing stage（execute/review/test）之后、`milestone-complete` 之前插入 `decision:post-goal-audit`
5.5. **re-grounding 插入**：WHEN `task_decomposition` 存在 AND 执行 step（不含 decision）≥3
   - 从第 3 个执行 step 起每隔 3 个插入 `{ decision: "post-reground", retry_count: 0, max_retries: 0, command_scope: null, command_path: null }`
   - 不在最后一个执行 step 后插入（由 goal-audit 覆盖）
   - 不与已有 quality-gate decision 节点相邻（顺延到下一个 3-step 边界）
   - fix-loop 动态插入的 step **纳入**计数（从插入点起重新计算 3-step 间隔）
6. **终点硬约束**：`session.milestone` 存在时 chain 以 `milestone-complete` 结尾；`session.milestone=null`（standalone）时跳过 `milestone-audit` + `milestone-complete` stage，chain 以最后一个质量门 stage 结尾
7. **goal_ref 传播**：`task_decomposition` 存在时，每个 step 按 `step.stage ∈ g.lifecycle` 匹配 `step.goal_ref = g.id`（多匹配取字典序最小）；decision 节点不打 goal_ref
8. **占位符**：independent 保留 `{phase}` `{intent}`；unified 不带 `{phase}`
9. **command_path 解析**（每个执行 step，decision 节点跳过）：
   - 取 skill 名（args 前的第一个 token）
   - **预校验通过 `Bash("maestro ralph skills --platform claude --json --quiet")`** 一次性拉取 claude 平台可用 commands + skills（global + project，project 覆盖 global），匹配 skill 名得到：
     - 命中 commands → `command_scope = "global" | "project"`，`command_path = <绝对路径>`
     - 命中 skills → 同上（type=skill）
     - 未命中 → `command_scope = "missing"`, `command_path = null`，A_CREATE_SESSION 报错 E006
   - **不在 build 阶段读取 .md 内容**；`<required_reading>` / `<deferred_reading>` 解析与加载由 `maestro ralph next` CLI 在执行期完成
10. **每个 step 初始化** `completion_confirmed: false`, `completion_status: null`, `completion_evidence: null`, `completion_summary: null`, `completion_decisions: null`, `completion_caveats: null`, `completion_deferred: null`, `deferred_reads: []`, `load: null`（由 `ralph next` 写入）
11. **scope_verdict gating**（仅当 chain 起点 = `analyze-macro`）：
    - `scope_verdict == large` **且** `wants_roadmap` → 保留 `roadmap` + `analyze`；`plan` 选 phase 列（`{phase}`）
    - 其余（`medium` / `small`，或 `large` 但非 `wants_roadmap`）→ 跳过 `roadmap` + `analyze` 两 stage；`plan` 选 standalone 列（`--from analyze:{analyze_macro_id}`），不带 `{phase}`
    - `scope_verdict == unknown` → 默认 standalone（非 roadmap）路径；由 `post-analyze-scope` 决策节点在 macro analyze 完成后纠正（A_APPLY_SCOPE_VERDICT）
12. **--from 自动注入**：
    - `analyze_macro_id` 存在且当前 step 是 `roadmap` → args 改为 `--from analyze:{analyze_macro_id}`
    - `analyze_macro_id` 存在且当前 `plan` step 处于 standalone 列（即非 wants_roadmap 路径：`medium`/`small`，或 `large` 但非 `wants_roadmap`）→ args 改为 `--from analyze:{analyze_macro_id}`
    - `blueprint_id` 存在 → 当前 step 是 `plan` → args 改为 `--from blueprint:{blueprint_id}`（优先级低于 phase 数字参数）
    - **phase-level deferred chaining**（独立模式，step 含 `{phase}` 占位符）：build 阶段前序 artifact 尚未产出，由 A_RESOLVE_ARGS（ralph-execute）运行时从 state.json 查找同 phase+milestone 最新 completed artifact 注入：
      - `plan` step → `--from analyze:{phase_analyze_id}`，写 `source_artifact_ref`
      - `execute` step → `--dir {plan_path}`（现有逻辑），写 `source_artifact_ref = "plan:{id}"`
    - 写入 `step.source_artifact_ref` 以便审计
13. **D-007 Milestone-ref 标注**：每个含 `{phase}` 占位符的 step → `step.milestone_id = session.milestone`（由 A_RESOLVE_PHASE 反查得出），禁止读 `current_milestone`
14. **动态插入步骤**（A_APPLY_*）同样应用规则 7-13

### A_CREATE_SESSION

1. Validate: 所有 step 的 `command_scope != "missing"`；否则 raise E006 + 列出缺失 skill
2. Write `.workflow/.maestro/ralph-cli-{YYYYMMDD-HHmmss}/status.json` (Appendix: Session Schema)
3. Additional fields: `execution_mode: "cli-delegate"`, `cli_tool: "<selected>"`
4. Each step: `delegate_exec_id: null`, `cli_output_summary: null`, `artifacts_produced: []`
5. Step mode/role/rule assigned per stage (see Stage Mapping table)
6. Display chain overview：每步显示 `{index}. {skill} [{type}] [{command_scope}]`
7. **Goal Prompt 显示（强制）**：`task_decomposition` 存在时，chain overview 之后**必须逐字显示** Goal Prompt block（Appendix），不得省略或摘要

### A_RESOLVE_ARGS

- Placeholder substitution: `{phase}`, `{milestone}`, `{intent}`
- `--from` auto-injection for phase-level artifact chaining
- Goal context injection (goal_ref → goal_snippet)
- Write enriched args back to status.json

### A_LOAD_STEP_CONTEXT

主流程加载前序产出和发现，为 prompt 生成准备素材。

1. **Session base** — Read status.json → intent, phase, milestone, boundary_contract
2. **Previous step output** — 前一 step 的 `cli_output_summary` + `completion_caveats` + `artifacts_produced` → 关键发现 + 产物路径
3. **Artifacts** — 按产物路径逐个 Read，提取与当前 step 相关的内容：
   - `conclusions.json` → scope, key_findings, recommendations
   - `TASK-*.json` → task descriptions, dependencies, wave assignments
   - `verification.json` → pass/fail results, gap details
   - `review.json` → findings, severity, fix suggestions
   - `completion_evidence` → error traces, test failures
   - `grill-report.md` → challenged assumptions, risks
4. **Explore if needed** — 产物指向代码位置但缺少上下文 → `maestro explore` 补充（仅 execute/debug/test 且有文件路径引用时）
5. **Accumulated signals** — 遍历 ALL completed steps → 聚合 caveats + deferred

输出：`step_context` 结构，供 A_COMPOSE_DELEGATION_PROMPT 消费。

### A_COMPOSE_DELEGATION_PROMPT

根据 `step_context` + 目标 skill 生成适配的 delegate prompt。

**Invocation Notation** — 由 `session.cli_tool` 决定：

| cli_tool | 首行格式 |
|----------|---------|
| claude | `/maestro-ralph-cli-execute --session {session_id}` |
| codex | `$maestro-ralph-cli-execute --session {session_id}` |
| opencode, agy | `/maestro-ralph-cli-execute --session {session_id}` |

**`<execution_context>` 块格式** — 首行调用后紧跟，cli-execute 解析此块获取 session 上下文：

```xml
<execution_context>
  <intent>{session.intent}</intent>
  <phase>{session.phase}</phase>
  <milestone>{session.milestone}</milestone>
  <boundary_contract>
    <in_scope>{boundary_contract.in_scope}</in_scope>
    <out_of_scope>{boundary_contract.out_of_scope}</out_of_scope>
    <definition_of_done>{boundary_contract.definition_of_done}</definition_of_done>
  </boundary_contract>
  <execution_criteria>{session.execution_criteria}</execution_criteria>
  <active_goals>{task_decomposition WHERE status != "superseded"}</active_goals>
  <prior_step_context>
    {最近 5 个已完成 step 的 completion_summary + completion_caveats}
  </prior_step_context>
  <accumulated_signals>
    {聚合所有已完成 step 的 caveats + deferred}
  </accumulated_signals>
  <stage_context>
    {Skill-adapted 注入，见下表；仅在有实际内容时加入}
  </stage_context>
</execution_context>
```

session_anchor 由 `maestro ralph next` 注入，`<execution_context>` 注入 prior artifacts 摘要，两者不重复。

**Skill-adapted `<stage_context>`** — 根据目标 skill 类型选择性注入：

| 目标 skill 类型 | 注入重点 |
|----------------|---------|
| analyze | intent + scope + boundary |
| plan | analysis findings + scope_verdict + recommendations |
| execute | task list + dependencies + wave + caveats from plan |
| review | changed files + verification results + execution decisions |
| test | review findings + execution artifacts + coverage data |
| debug | error details + failing tests + execution trace |
| brainstorm/grill | challenged assumptions + risks + prior findings |

每段仅在有实际内容时加入，无内容则跳过。

### A_DISPATCH_DELEGATE

1. Build command:
   ```
   maestro delegate "{composed_prompt}"
     --to {session.cli_tool}
     --mode {step.delegate_mode}
     --id {stage_prefix}-{HHmmss}-{rand4}
   ```

2. Write `step.delegate_exec_id`, `step.status = "running"` to status.json

3. `Bash({ command: "maestro delegate ...", run_in_background: true })`

4. Display: `[{index}/{total}] ⟶ {step.skill} → delegate:{exec_id} [{cli_tool}]`

5. **STOP**

### A_PARSE_RESULT

On callback (re-invocation finds running step with delegate_exec_id):

1. `Bash("maestro delegate status {exec_id}")` — still running → STOP
2. `Bash("maestro delegate output {exec_id}")` — get full output
3. Parse `---RESULT---` / `---END---` block:
   ```
   STATUS    → completion_status
   SUMMARY   → completion_summary (→ --summary)
   ARTIFACTS → artifacts_produced (split by comma)
   EVIDENCE  → completion_evidence (→ --evidence)
   DECISIONS → completion_decisions (→ --decisions)
   CAVEATS   → completion_caveats (→ --caveats)；DONE_WITH_CONCERNS 时同时映射为 --concerns
   DEFERRED  → completion_deferred (→ --deferred)
   SIGNALS   → parse key=value pairs → update session.context
   ```
4. If no `---RESULT---` block found → fallback: STATUS=DONE_WITH_CONCERNS, SUMMARY from last 200 chars of output
5. Write parsed data to step in status.json

### A_MARK_COMPLETE

**RESULT→complete 映射：** `STATUS→--status`、`SUMMARY→--summary`、`EVIDENCE→--evidence`、`DECISIONS→--decisions`、`CAVEATS→--caveats`（DONE_WITH_CONCERNS 时同时作 `--concerns`）、`DEFERRED→--deferred`。SIGNALS 写入 `status.json.context`，不传给 complete。

1. `Bash("maestro ralph complete {index} --status {STATUS} --summary \"{SUMMARY}\" [--evidence ...] [--decisions ...] [--caveats ...] [--deferred ...]")`
2. Apply SIGNALS to `session.context`
3. Display: `[{index}/{total}] ✓ {step.skill} → {SUMMARY}`
4. Loop back to S_STEP_LOCATE

### A_SHOW_STATUS

Find latest ralph-cli session, display steps + sub-goals progress.

### A_POST_ANALYZE_DRIFT

产物 vs 目标偏离分析。A_PARSE_RESULT 后、A_MARK_COMPLETE 前执行。

**1. 收集对照基准:**

| 基准来源 | 取值 |
|---------|------|
| `step.goal_ref` → goal.done_when | 子目标的完成条件 |
| `session.boundary_contract.definition_of_done` | 全局验收标准 |
| `session.execution_criteria` | 执行准则 |
| `session.intent` | 原始意图 |

**2. 读产物摘要:**

从 A_PARSE_RESULT 已提取的 SUMMARY + DECISIONS + ARTIFACTS + CAVEATS 构建产物画像。

**3. 对比评分:**

| 维度 | 检查 |
|------|------|
| 覆盖度 | 产物是否覆盖了 goal.done_when 的每个条件 |
| 方向性 | DECISIONS 是否与 intent 和 boundary 一致 |
| 完整性 | 预期产物类型是否齐全 |

**drift_score:**
- `ALIGNED` — 全部维度通过
- `MINOR_DRIFT` — 覆盖度/完整性有小缺口
- `MAJOR_DRIFT` — 方向性偏离或关键产物缺失

**4. 修正动作:**

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常进入 S_STEP_COMPLETE |
| MINOR_DRIFT | 将偏离项追加到 completion_caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | 写 `step.drift_correction`，回到 S_STEP_LOAD 重新加载 + compose + delegate（drift_correction 作为修正上下文注入 prompt） |
| MAJOR_DRIFT + 已重试 | 以 DONE_WITH_CONCERNS complete，由后续 decision node 裁决 |

**5. 写入:** `step.drift_score`, `step.drift_correction`

### A_DELEGATE_EVALUATE

Inline 评估质量门（非 handoff）。Runs `run_in_background` → STOP → callback resume in same loop。

1. Resolve artifact dir: `{run_dir}/outputs/{artifact.path}/` with fallback glob
2. Parse decision metadata: `{ decision, retry_count, max_retries }`
3. Map result files:

   | Decision | Files |
   |----------|-------|
   | post-execute | verification.json |
   | post-business-test | .tests/auto-test/report.json |
   | post-review | review.json |
   | post-test | uat.md, .tests/test-results.json |
   | post-frontend-verify | e2e-results.json |

4. Execute delegate (run_in_background, STOP, wait for callback):
   ```
   maestro delegate "PURPOSE: 评估 {decision} 质量门结果
   TASK: 读取结果 | 分析状态 | 评估严重性 | 给出建议
   EXPECTED: ---VERDICT--- STATUS(PASS|FAIL|PARTIAL|BLOCKED)/REASON/GAP_SUMMARY/CONFIDENCE(high|medium|low)/CONFIDENCE_SCORE(0-100)/WEAKEST_DIMENSION ---END---
   CONSTRAINTS: 只评估 | 置信度<60% 倾向 fix | retry {n}/{max} 达上限必须 escalate"
   --to {session.cli_tool} --mode analysis
   ```
5. On callback: parse `---VERDICT---` block — STATUS must match strict enum `PASS|FAIL|PARTIAL|BLOCKED`; any other value → parse failure. If parse fails → fallback STATUS="fix", BUT MUST set `parse_failed: true` and `confidence_score: 0` in decision log (invariant 13). Subsequent steps inherit LOW CONFIDENCE flag.
6. Confidence adjustment: <60 + proceed → fix; >95 + fix + retry>0 → suggest proceed
7. **Decision log**: Append to `{session_dir}/decisions.ndjson`:
   ```json
   { "id": "DEC-{timestamp}", "timestamp": "{ISO}", "source": "ralph-cli",
     "node_id": "{step.decision}", "type": "quality-gate",
     "verdict": "{adjusted_verdict}", "confidence_score": {N},
     "parse_failed": false,
     "close_call": {N>=50 && N<=70}, "summary": "{REASON}" }
   ```

### A_GOAL_AUDIT_EVALUATE

审计未完成子目标，判定 met / unmet。Delegate `--to {session.cli_tool} --mode analysis`。

追加 `{session_dir}/decisions.ndjson`：`{ "type": "goal-gate", "unmet_count": N, "unmet_ids": [...] }`。
GUARD: `retry_count >= max_retries AND still unmet → A_APPLY_ESCALATE`。
Verdict routing: `all_met` + `INTENT_ALIGNED=true` → A_APPLY_GOAL_DONE；`all_met` + `INTENT_ALIGNED=false` → A_REGROUND_HALT；`has_unmet` → A_APPLY_GOAL_FIX。

### A_SCOPE_EVALUATE

Read `conclusions.json.scope_verdict` from macro analyze artifact. Write to `session.scope_verdict` + `session.analyze_macro_id`. Append `{session_dir}/decisions.ndjson`：`{ "type": "scope-gate", "verdict": "{scope_verdict}", "analyze_macro_id": "{ANL_ID}" }`。

### A_REGROUND_EVALUATE

意图保真检查（delegate prompt 含 intent + boundary + completed_steps + done_goals + accumulated_deferred + goal_changelog）。Delegate `--to {session.cli_tool} --mode analysis`。

Append `{session_dir}/decisions.ndjson`：`{ "type": "reground-gate", "verdict": "{aligned|drifted}", "confidence_score": {N}, "drift_description": "...", "corrective_action": "..." }`。
Verdict routing: `aligned` → A_APPLY_PROCEED；`drifted` + `confidence >= 60` → A_REGROUND_HALT；`drifted` + `confidence < 60` → A_APPLY_PROCEED（标 LOW CONFIDENCE）。

### A_STRUCTURAL_EVALUATE

**post-milestone**: read state.json → determine milestone type → standard: next milestone? insert lifecycle steps / complete. Adhoc: always END.
**post-debug-escalate**: always STOP → A_PAUSE_ESCALATE.

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE

Mark decision completed / insert fix-loop steps / insert debug-escalate.

### A_APPLY_SCOPE_VERDICT

Reshape downstream chain based on `scope_verdict`（large+wants_roadmap → keep roadmap；medium/small → collapse to standalone plan）。

### A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE

Insert scoped mini-loops for unmet sub-goals / mark all goals done + `task_decomposition_all_done=true`.

### A_ADVANCE_MILESTONE

Update session milestone/phase, insert full lifecycle steps for next milestone, reindex.

### A_REGROUND_HALT

Set `session.status = "paused"`, display drift warning. auto_confirm 不跳过.

### A_PAUSE_ESCALATE

Set session paused, display "请人工介入", suggest `/maestro-ralph-cli continue`.

### A_AMEND_GOAL

5 步流程（快照→解析→mini grill→确认→应用），deferred_reading: `ralph-amend-goal.md`。RISK_LEVEL=high 时 auto_confirm 无效。

### A_RETRY / A_PAUSE_SESSION / A_COMPLETE_SESSION

- **A_RETRY**: `maestro ralph retry {index}` — CLI 清空 `delegate_exec_id`，设 `step.retried = true`、`step.status = "pending"`，清 `active_step_index`；ralph-cli 回到 S_STEP_RESOLVE 重新 compose→delegate
- **A_PAUSE_SESSION**: 由 `ralph complete N --status BLOCKED --reason "..."` 触发，CLI 写 `session.status = "paused"`
- **A_COMPLETE_SESSION**: 校验所有 step `completion_confirmed == true` + `task_decomposition_all_done == true`（若存在），通过后写 `session.status = "completed"`

</actions>

</state_machine>

<appendix>

### Stage Mapping

| Stage | delegate_mode | delegate_rule |
|-------|---------------|---------------|
| analyze, analyze-macro | analysis | `analysis-analyze-code-patterns` |
| plan | write | `planning-breakdown-task-steps` |
| execute | write | `development-implement-feature` |
| review, business-test | analysis | `analysis-review-code-quality` |
| test, test-gen, frontend-verify | write | — |
| grill, brainstorm | write | — |
| debug, quality-debug | write | `analysis-diagnose-bug-root-cause` |
| blueprint | write | `planning-design-component-spec` |
| init, spec-setup | write | — |
| milestone-audit | analysis | `analysis-review-code-quality` |
| milestone-complete | write | — |

Fix-loop 插入的 step 按此表分配 `delegate_mode` + `delegate_rule`。

All delegation uses `--to {session.cli_tool}` (not `--role`). The `cli_tool` is resolved from session context.

### Delegate Exec ID Prefix

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

### Session Schema

```json
{
  "session_id": "ralph-cli-{YYYYMMDD-HHmmss}",
  "source": "ralph", "status": "running",
  "execution_mode": "cli-delegate",
  "cli_tool": "claude",
  "ralph_protocol_version": "2",
  "active_step_index": null,
  "intent": "", "lifecycle_position": "",
  "phase": null, "phase_is_new": false,
  "milestone": "",
  "auto_mode": false,
  "decomposition_owner": "ralph",

  "quality_mode": "standard",
  "planning_mode": "independent",
  "scope_verdict": null,
  "wants_roadmap": false,
  "analyze_macro_id": null,
  "blueprint_id": null,
  "passed_gates": [],
  "context": { "issue_id": null, "run_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
  "steps": [{
    "index": 0,
    "skill": "",
    "args": "",
    "stage": "",
    "scope": null,
    "decision": null,
    "retry_count": 0,
    "max_retries": 2,
    "command_scope": "global|project|missing|null",
    "command_path": "<absolute path resolved by `maestro ralph skills --platform claude --json --quiet`> | null",
    "milestone_id": null,
    "source_artifact_ref": null,
    "status": "pending|running|completed|skipped|failed",
    "goal_ref": null,
    "completion_confirmed": false,
    "completion_status": null,
    "completion_evidence": null,
    "completion_summary": null,
    "completion_decisions": null,
    "completion_caveats": null,
    "completion_deferred": null,
    "completed_at": null,
    "deferred_reads": [],
    "load": null,           // { loaded_at, required_files[], deferred_files[], resolve_version } — 由 ralph next (cli-execute 端) 写入
    "delegate_exec_id": null,
    "delegate_mode": "write|analysis",
    "delegate_rule": null,
    "cli_output_summary": null,
    "artifacts_produced": [],
    "drift_score": null,
    "drift_correction": null
  }],
  "waves": [], "current_step": 0,

  "boundary_contract": {
    "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": ""
  },
  "execution_criteria": [],
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

新增字段可选，缺省=旧行为；既有字段名不删不改。

### Fix-Loop Templates

所有插入的执行 step 按 A_BUILD_STEPS 规则 9 解析 `command_path` + `command_scope`；`decision:*` 条目为 decision 节点。Each inserted step is delegated through the same compose → delegate → analyze cycle.

**post-execute:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry+1}
```

**post-business-test:**
```
quality-debug --from-business-test "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry+1}
```

**post-review:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
quality-review {phase}
decision:post-review {retry+1}
```

**post-test:**
```
quality-debug --from-uat "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry: 0}
quality-review {phase}
decision:post-review {retry: 0}
quality-auto-test {phase}
quality-test {phase}
decision:post-test {retry+1}
```

**post-frontend-verify:** (UI 写端点未接线/不可用时)
```
quality-debug --from-frontend-verify "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
quality-test {phase} --frontend-verify
decision:post-frontend-verify {retry+1}
```

**post-goal-audit:** (per unmet sub-goal group)
```
# for each unmet sub-goal G{n}, scoped to target_phase:
maestro-plan --gaps {target_phase} "G{n}: {gap}"     [goal_ref: G{n}]
maestro-execute {target_phase}                       [goal_ref: G{n}]
# after all unmet groups inserted:
decision:post-goal-audit {retry+1}
```

### Error Codes

E001–E006, W001–W004 适用。CLI 新增：

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E011 | error | Delegate execution failed | Retry once, then BLOCKED |
| E012 | error | CLI tool not enabled in cli-tools.json | Switch tool or enable |
| E013 | error | ---RESULT--- block not found in output | Fallback parse, mark LOW CONFIDENCE |

### Success Criteria

- [ ] ralph-cli owns full loop: compose → delegate → STOP → callback → parse → complete → next
- [ ] Delegation prompt 首行为 cli-execute 调用（`--session {session_id}`，格式由 cli_tool 决定），后接 `<execution_context>`
- [ ] A_PARSE_RESULT extracts STATUS/SUMMARY/ARTIFACTS/DECISIONS/CAVEATS/DEFERRED/SIGNALS from ---RESULT--- block
- [ ] SIGNALS parsed as key=value pairs and applied to session.context
- [ ] Decision evaluation runs inline (no handoff to another command)
- [ ] ralph-cli-execute 仅通过 delegate 会话加载执行，不直接 Skill() 调用
- [ ] Sliding window: last 5 completed steps in execution_context
- [ ] Accumulated caveats/deferred from ALL completed steps
- [ ] Stage-specific artifact injection in execution_context
- [ ] CLI tool defaults to claude, overridden by --to
- [ ] `--roadmap` flag parsed → `wants_roadmap = true`
- [ ] `.md/.txt path → input_doc` parsed
- [ ] S_AMEND_GOAL + A_AMEND_GOAL 完整实现（5 步流程，RISK_LEVEL=high 不跳过）
- [ ] `goal_changelog` 写入路径存在（amend 流程产出）
- [ ] `blueprint_id` session 字段支持 `--from blueprint:{BLP_ID}` 路径
- [ ] A_SHOW_STATUS 显示 task_decomposition 子目标进度
- [ ] A_STRUCTURAL_EVALUATE 处理 post-milestone + post-debug-escalate
- [ ] A_ADVANCE_MILESTONE 插入下一里程碑 lifecycle steps
- [ ] A_REGROUND_HALT 漂移熔断（auto_confirm 不跳过）
- [ ] A_PAUSE_ESCALATE 达到 max_retries 时暂停
- [ ] A_APPLY_SCOPE_VERDICT 三路径重塑（large+roadmap / medium-small / unknown）
- [ ] Fix-loop templates（6 套）通过 compose-delegate cycle 执行；插入 step 按 Stage Mapping 表分配 delegate_mode + delegate_rule
- [ ] re-grounding 3-step 插入规则（build rule 5.5）
- [ ] spec-setup 预检（build rule 0.5）
- [ ] Invariant 2（Skill handoff）在 ralph-cli 中被覆盖，由 invariant 17-21 替代
- [ ] execution_context 块含 intent + phase + boundary_contract + execution_criteria + active_goals + prior_step_context（滑动窗口 5 step）+ accumulated_signals
- [ ] execution_context 中 boundary_contract 不截断；superseded 目标仅一行标注
- [ ] A_DELEGATE_EVALUATE 解析 `---VERDICT---` 块，parse 失败 → fallback fix + parse_failed: true + confidence_score: 0
- [ ] decisions.ndjson 追加：quality-gate / goal-gate / scope-gate / reground-gate 各有完整格式
- [ ] `completion_summary` 在 STATUS=DONE/DONE_WITH_CONCERNS 时为 MUST（--summary 参数非空）
- [ ] RESULT 的 EVIDENCE 字段映射到 --evidence；CAVEATS 在 DONE_WITH_CONCERNS 时同时映射 --concerns
- [ ] post-milestone adhoc 分支：mark completed + set current_milestone = null
- [ ] post-reground + drifted + confidence < 60 → A_APPLY_PROCEED (LOW CONFIDENCE)
- [ ] 旧目标标 superseded（superseded_by + superseded_at），新目标 origin: "CHG-xxx"
- [ ] goal_changelog 含完整 before/after + impact_assessment

</appendix>
</output>
