---
name: maestro-ralph-v2
description: Adaptive lifecycle orchestrator — compose, dispatch ralph-executor agent, evaluate decision, loop
argument-hint: "<intent> [-y] [--amend [change]] [--roadmap] | status | continue"
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
---
<purpose>
Adaptive lifecycle orchestrator: locate step → resolve args → load context → dispatch Agent(ralph-executor) per step (agent 调 `ralph next` + 执行) → extract signals → drift check → ralph complete → evaluate decision → next step → loop.

Session: `.workflow/.maestro/ralph-v2-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<deferred_reading>
- [ralph-amend-goal.md](~/.maestro/workflows/ralph-amend-goal.md) — read when `--amend` flag active for goal amendment flow
</deferred_reading>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag        → auto_confirm = true
--roadmap      → wants_roadmap = true
--amend / -a   → amend_mode = true
.md/.txt path  → input_doc
status|continue → route keyword
Remaining      → intent (amend_mode 时为 change_request)
```

**State files**:
- `.workflow/state.json` — artifact registry
- `.workflow/.maestro/ralph-v2-*/status.json` — session state
</context>

<invariants>
1. **Ralph-v2 owns the full loop** — locate step → resolve args → load context → dispatch agent → wait for SendMessage → receive → extract signals → drift → complete，全部在本命令内完成
2. **One agent per step** — 每个执行 step 派发一个 named executor agent，agent 通过 SendMessage 回传结果，主流程解析结果后决定下一步
3. **Agent is a thin wrapper** — executor agent 调 `ralph next` 获取 skill prompt 并执行，通过 SendMessage 回传输出；arg resolution、context loading、signal extraction、drift analysis、ralph complete 均由主流程完成
4. **Dual dispatch model** — 执行 Agent 与评估 Agent 使用不同派发模式：
   - **执行 Agent**（A_STEP_DISPATCH）：`Agent({name: "exe-xxx"})` — named mailbox teammate，支持内部多 agent 编排，通过 `SendMessage({to: "main"})` 回传结果
   - **评估 Agent**（A_AGENT_EVALUATE / A_AGENT_GOAL_AUDIT / A_AGENT_REGROUND）：`Agent()` 不传 `name` — 同步阻塞，直接返回结果（评估 agent 只读不需要多 agent）
   - `agent_exec_name` 既用于 display/日志，也作为执行 Agent 的 `name` 参数
5. **主流程调 `ralph complete`** — 每个 step 完成后由主流程调 `maestro ralph complete`，非 agent 上报
6. **Decision evaluation inline** — decision 节点不 handoff，通过 Agent 或 CLI delegate 在本循环内评估
7. **CLI delegation for evaluation only** — CLI delegate（`maestro delegate --mode analysis`）仅限评估环节；执行仍通过 executor Agent 完成
8. **Decision delegates read-only** — 评估 Agent 通过 prompt 中的 CONSTRAINTS 约束为只读
9. **执行 step 通过 `maestro ralph next` CLI 加载并内联执行**（由 execute Agent 完成）
10. **status.json 是唯一真源** — 不生成 markdown 清单或侧文件
11. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE`（或 DONE_WITH_CONCERNS）写入；CLI 是唯一合法写入路径
12. **command_path 在 A_BUILD_STEPS 解析** — 通过 `maestro ralph skills --platform claude --json --quiet` 预校验
13. **执行 step 加载契约** — 由 `maestro ralph next` CLI 在执行期完成
14. **Decomposition is outcome-oriented** — sub-goals 为可观测交付，禁止 lifecycle 复刻
15. **planning_mode governs arg granularity** — `unified` → skill args 无 `{phase}`；`independent` → 含 `{phase}`
16. **task_decomposition 驱动 steps[] 动态生长** — `post-goal-audit` 按 unmet 子目标插入 scoped mini-loop
17. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作
18. **Evaluate fallback 必须标记** — 评估 Agent 解析 verdict 失败时 fallback 为 "fix"，MUST 在 decisions.ndjson 记录 `"parse_failed": true, "confidence_score": 0`
19. **auto_confirm 单一来源** — `auto_confirm` 仅由用户 `-y` 标志设定
20. **分解契约单一所有者** — `boundary_contract` / `task_decomposition` 由 session 创建者拥有
21. **控制权优先级（范式治理）** — FSM 独占 session 生命周期 + step 排序 + retry/fix/escalate + cross-step decision 节点
</invariants>

<state_machine>

Chain-building states + 执行循环 states：

<states>
S_PARSE_ROUTE   — 解析参数、路由入口
S_STATUS        — 显示 session 进度
S_CONTINUE      — 恢复执行
S_RESOLVE_PHASE — 解析 phase + phase_is_new + milestone                PERSIST: session.phase, session.phase_is_new, session.milestone
S_INFER         — 推断 lifecycle_position                              PERSIST: session.lifecycle_position, session.wants_roadmap
S_RESOLVE_SCOPE — 读 macro analyze conclusions.scope_verdict            PERSIST: session.scope_verdict, session.analyze_macro_id
S_QUALITY_MODE  — 决定质量管线模式                                      PERSIST: session.quality_mode
S_PLANNING_MODE — 决定统一/独立规划模式                                  PERSIST: session.planning_mode
S_DECOMPOSE     — 边界澄清 + 执行准则 + 子目标清单                      PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_BUILD_CHAIN   — 构建步骤链（build rules 0-14）                        PERSIST: session.steps[]
S_CREATE_SESSION — 写 status.json                                       PERSIST: session (全量)
S_CONFIRM       — 用户确认

S_STEP_LOCATE     — 找下一个 pending step                    PERSIST: —
S_STEP_RESOLVE    — 解析占位符 + 丰富参数                    PERSIST: step.args (enriched)
S_STEP_DISPATCH   — 组装上下文 + 派发 named executor agent     PERSIST: step.agent_exec_name, step.status = "running"
S_STEP_WAIT_MSG   — 等待 executor 的 SendMessage 回传          PERSIST: —
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
  → S_RESOLVE_PHASE WHEN: intent is non-empty
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
  → S_STEP_WAIT_MSG  WHEN: executor dispatched                  DO: A_STEP_DISPATCH

S_STEP_WAIT_MSG:
  → S_STEP_ANALYZE   WHEN: received agent-message with EXECUTOR_OUTPUT   DO: A_STEP_RECEIVE
  → S_HANDLE_FAIL    WHEN: received agent-message with status=ERROR      DO: A_STEP_RECEIVE
  → S_HANDLE_FAIL    WHEN: executor idle without SendMessage（崩溃检测）  DO: mark BLOCKED

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
  → S_APPLY_VERDICT WHEN: structural (post-milestone, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_STEP_LOCATE WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_STEP_LOCATE WHEN: post-goal-audit + has_unmet       DO: A_APPLY_GOAL_FIX
  → S_STEP_LOCATE WHEN: post-goal-audit + all_met + INTENT_ALIGNED=true  DO: A_APPLY_GOAL_DONE
  → END              WHEN: post-goal-audit + all_met + INTENT_ALIGNED=false  DO: A_REGROUND_HALT
  → S_STEP_LOCATE WHEN: post-analyze-scope                DO: A_APPLY_SCOPE_VERDICT
  → S_STEP_LOCATE WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_STEP_LOCATE WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_STEP_LOCATE WHEN: post-milestone + standard + next milestone   DO: A_ADVANCE_MILESTONE
  → END              WHEN: post-milestone + standard + no next milestone
  → END              WHEN: post-milestone + adhoc                       DO: mark completed (set current_milestone = null)
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

### A_CREATE_SESSION
1. `session_id` format: `ralph-v2-{YYYYMMDD-HHmmss}`
2. Additional fields: `execution_mode: "agent"`，无 `cli_tool` 字段
3. Each step: `agent_exec_name: null`（执行 Agent 名称标识）
4. Step mode/role/rule assigned per stage (see Stage Mapping table)

### A_STEP_RESOLVE_ARGS

解析占位符 + 丰富参数。在 `ralph next` 之前执行。

**1. Placeholder substitution:**

| Placeholder | Source |
|-------------|--------|
| `{phase}` | session.phase |
| `{milestone}` | session.milestone |
| `{intent}` | session.intent |
| `{description}` | session.intent (alias) |
| `{scratch_dir}` | session.context.scratch_dir or latest artifact path |
| `{plan_dir}` | session.context.plan_dir |
| `{analysis_dir}` | session.context.analysis_dir |
| `{issue_id}` | session.context.issue_id |
| `{milestone_num}` | session.context.milestone_num |

**2. Per-skill enrichment** (when args empty or minimal):

| Skill | Required context | Source |
|-------|-----------------|--------|
| maestro-brainstorm | topic | `"{intent}"` |
| maestro-roadmap | description | `"{intent}"` |
| maestro-analyze | phase or topic | `{phase}` or `"{intent}"` |
| maestro-plan | phase, --from, or --dir | see --from auto-injection below |
| maestro-execute | phase or --dir | see --from auto-injection below |
| quality-debug | gap context | Read previous step's error/gap |
| quality-* | phase | `{phase}` |

**3. --from auto-injection (phase-level artifact chaining):**

```
Read state.json.artifacts（含 milestone_history 内归档 artifacts）
→ filter by milestone={session.milestone} + phase={session.phase} + status=="completed"

plan step（含 {phase} 占位符，args 无 --from 且无 --dir）:
  1. 查同 phase+milestone 最新 completed type=="analyze" artifact → id = ANL-xxx
  2. 命中 → args 追加 --from analyze:{id}
  3. 写 step.source_artifact_ref = "analyze:{id}"

execute step（含 {phase} 占位符，args 无 --dir）:
  1. 查同 phase+milestone 最新 completed type=="plan" artifact → id = PLN-xxx, path = scratch/...
  2. 命中 → args 追加 --dir .workflow/scratch/{path}
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

**5. Write** enriched args + source_artifact_ref back to status.json.

### A_STEP_DISPATCH

加载前序产出 + 组装上下文 + 派发 executor agent 执行单步。Agent 内部调 `maestro ralph next` 获取 skill prompt 并执行。

**1. Load previous step context:**

- 读前一 completed step 的 `completion_summary` + `completion_caveats` + `completion_decisions` + `completion_deferred`
- 按 `session.context` 中的路径逐个 Read，提取与当前 step 相关的内容：

   | 当前 stage | 加载什么 | Source |
   |-----------|---------|--------|
   | plan | analysis conclusions + scope_verdict | `{context.analysis_dir}/conclusions.json` |
   | execute | task list + wave assignments | `{context.plan_dir}/TASK-*.json` |
   | review | changed files + verification results | `{context.scratch_dir}/verification.json` |
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

**3. Resolve agent name:** `{stage_prefix}-{session_id_short}-{HHmmss}`

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

**4. Dispatch（named mailbox executor）:**

> 执行 Agent 使用 `name` 参数派发为 named mailbox teammate，支持内部多 agent 编排。executor 通过 `SendMessage({to: "main"})` 回传执行结果。`resolved_agent_name` 同时用于 display 和 Agent `name` 参数。

```
Agent({
  name: "{resolved_agent_name}",
  subagent_type: "ralph-executor",
  description: "执行 step {index}: {step.skill}",
  prompt: `Session: {session_id}
Agent name: {resolved_agent_name}

{goal_context 块，仅 protocol < 2 时}

{loaded_step_context}
`
})
```

5. Write `step.agent_exec_name` to status.json
6. Display: `[{index}/{total}] ⟶ {step.skill} → {resolved_agent_name}`
7. Agent() 立即返回（named teammate 异步启动）→ 进入 S_STEP_WAIT_MSG 等待 executor 的 SendMessage

### A_STEP_RECEIVE

从 executor 的 `agent-message` 中提取执行输出。

1. 接收到 `<agent-message from="{resolved_agent_name}">` 后，提取 message 内容
2. 解析 `EXECUTOR_OUTPUT` 格式：
   - `status: DONE` → agent_output = message 内容，继续 S_STEP_ANALYZE
   - `status: DONE_WITH_CONCERNS` → agent_output = message 内容，继续 S_STEP_ANALYZE
   - `status: ERROR` → STATUS=BLOCKED，转 S_HANDLE_FAIL
3. idle_notification 处理（区分正常等待与崩溃）：
   - 首次收到 `idle_notification`：executor 可能在等待 worker 回传，正常现象，继续等待
   - 连续收到 2 次 `idle_notification` 且中间无 `agent-message`：向 executor 发送 `SendMessage({to: "{resolved_agent_name}", message: "请回报执行状态"})` 询问
   - 询问后仍只收到 `idle_notification` 无 `agent-message`：STATUS=BLOCKED，转 S_HANDLE_FAIL
4. `agent_output` = 提取的 message 内容

### A_STEP_EXTRACT

从 agent 返回的执行输出中提取结构化信号，用于 completion 参数组装。

**1. Stage-specific signal extraction:**

| Stage | 提取什么 | 写入字段 |
|-------|---------|---------|
| analyze | `conclusions.json` scope_verdict + key_findings | `--summary`, context.analysis_dir |
| plan | TASK-*.json 数量 + 主要模块 + 波次 | `--summary`, context.plan_dir |
| execute | 修改文件数 + verification passed/failed | `--summary`, `--evidence`, context.scratch_dir |
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
| `verification.json` | `scratch_dir` |
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
| `scratch_dir:` 或 `.workflow/scratch/` 路径 | `context.scratch_dir` |
| `plan_dir:` 路径 | `context.plan_dir` |
| `PHASE: N` | `session.context.phase` |

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

2. **Context signals propagation** — 将关键信号写入 `status.json.context`:

   | Signal | 写入字段 |
   |--------|---------|
   | `analysis_dir` | `context.analysis_dir` |
   | `plan_dir` | `context.plan_dir` |
   | `scratch_dir` | `context.scratch_dir` |
   | `grill_id` | `context.grill_id` |
   | `brainstorm_dir` | `context.brainstorm_dir` |
   | `blueprint_dir` | `context.blueprint_dir` |
   | `ANL-xxx` | `session.analyze_macro_id` |
   | `BLP-xxx` | `session.blueprint_id` |
   | `phase` | `session.context.phase` |

3. Display: `[{index}/{total}] ✓ {step.skill} → {SUMMARY}`
4. Loop back to S_STEP_LOCATE

### A_AGENT_EVALUATE

通过 Agent 和/或 CLI delegate 评估质量门。评估模式由 `step.evaluate_via` 决定。

**1. Common setup:**

1. Resolve artifact dir: `.workflow/scratch/{artifact.path}/` with fallback glob
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
SESSION: {session_dir}/status.json
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
   { "id": "DEC-{timestamp}", "timestamp": "{ISO}", "source": "ralph-v2",
     "node_id": "{step.decision}", "type": "quality-gate",
     "evaluate_via": "{mode}", "cli_exec_id": "{exec_id|null}",
     "verdict": "{adjusted_verdict}", "confidence_score": {N},
     "parse_failed": false,
     "close_call": {N>=50 && N<=70}, "summary": "{REASON}" }
   ```

### A_AGENT_GOAL_AUDIT

通过 Agent 和/或 CLI delegate 审计子目标完成情况。支持 `evaluate_via` 三种模式（同 A_AGENT_EVALUATE）。

1. Read `session.task_decomposition` from status.json
2. Dispatch audit（按 `evaluate_via` 模式，默认 `agent`）:
   ```
   Agent({
     description: "审计子目标完成情况（同步评估 Agent，不传 name）",
     prompt: "PURPOSE: 审计未完成子目标，判定 met / unmet
   TASK:
     1. 读取 {session_dir}/status.json 中 task_decomposition 的 status!=done 子目标
     2. 打开 evidence 产物，对照 done_when 严格判定
     3. 输出 met / unmet，unmet 给出 gap + target_phase
     4. 对照 intent + definition_of_done 判定意图保真
   CONTEXT:
     status.json        = {session_dir}/status.json
     intent             = {session.intent}
     definition_of_done = {boundary_contract.definition_of_done}
     execution_criteria = {execution_criteria}
     boundary_contract  = {boundary_contract}
   EXPECTED:
     ---VERDICT---
     STATUS: all_met|has_unmet
     INTENT_ALIGNED: true|false
     UNMET: [{id:G2,gap:'...',target_phase:execute}, ...]
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

1. Read status.json：intent, boundary_contract, completed steps, done goals
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
     status.json        = {session_dir}/status.json
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
4. Append `{session_dir}/decisions.ndjson`：`{ "type": "scope-gate", "source": "ralph-v2", "verdict": "{scope_verdict}", "analyze_macro_id": "{ANL_ID}" }`

### A_STRUCTURAL_EVALUATE

**post-milestone:**
1. Read state.json → resolve milestone type（default `"standard"`）
2. Standard milestone：next milestone exists → insert lifecycle steps / complete
3. Adhoc milestone（`type == "adhoc"`）：always END，set `current_milestone = null`

**post-debug-escalate:** always → A_PAUSE_ESCALATE

### A_SHOW_STATUS

1. Find latest `ralph-v2-*` session（by created_at）
2. Display: Session, Status, Position, Progress, Current step
3. List steps: [✓] confirmed, [▸] current, [ ] pending, [◆] decision；执行 step 附 `command_scope` + `command_path`
4. If `task_decomposition` present → 显示 sub-goals 进度（done/total）

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE

- **A_APPLY_PROCEED**: Mark decision completed, write status.json
- **A_APPLY_FIX**: Insert fix-loop steps after current step（见 Fix-Loop Templates），reindex，increment retry_count
- **A_APPLY_ESCALATE**: Insert `[quality-debug "{gap_summary}", decision:post-debug-escalate]`，reindex

### A_APPLY_SCOPE_VERDICT

依据 `session.scope_verdict` + `session.wants_roadmap` 重塑下游链路：

1. 路径 A（`large` 且 `wants_roadmap`）：保持 roadmap+analyze，`plan` 选 phase 列
2. 路径 B（`medium`/`small`，或 `large` 非 `wants_roadmap`）：删除未完成的 `roadmap` + `analyze` step，`plan` 改为 `--from analyze:{ANL_ID}`
3. 路径 C（`unknown`）：非 auto_confirm → AskUserQuestion；auto_confirm → 默认路径 B
4. Reindex steps，标 decision completed

### A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE

- **A_APPLY_GOAL_FIX**: 对每个 unmet 子目标插入 scoped mini-loop（plan --gaps + execute），`goal_ref` 标注，重新追加 `decision:post-goal-audit {retry+1}`
- **A_APPLY_GOAL_DONE**: set `task_decomposition[*].status="done"`, `completion_confirmed=true`, `task_decomposition_all_done=true`

### A_ADVANCE_MILESTONE

1. Update session: milestone, phase, reset passed_gates
2. Insert full lifecycle steps for next milestone
3. Reindex, write status.json

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
| 5. 应用 | 归档旧目标（`superseded`）→ 写入新目标（`origin: CHG-xxx`）→ 重建链路 → write status.json | re-dispatch |

**Phase 3 Agent prompt:**
```
Agent({
  description: "Amend impact analysis（同步评估 Agent，不传 name）",
  prompt: "PURPOSE: 评估目标修改对 running session 的影响
TASK:
  1. 读取 {session_dir}/status.json 的 task_decomposition + boundary_contract + 已完成 steps
  2. 分析 change_request 对既有目标/步骤的影响
  3. 判定 RISK_LEVEL (low/medium/high)
  4. 列出 AFFECTED_GOALS / INVALIDATED_STEPS / NEW_GAPS
CONTEXT:
  change_request    = {change_request}
  change_type       = {change_type}
  session           = {session_dir}/status.json
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

- **A_RETRY**: `Bash("maestro ralph retry {index}")` — CLI 设 `step.retried = true`, `step.status = "pending"`, 清 `active_step_index`
- **A_PAUSE_SESSION**: `ralph complete N --status BLOCKED --reason "..."` — CLI 写 `session.status = "paused"`
- **A_COMPLETE_SESSION**: 校验所有 step `completion_confirmed == true` + `task_decomposition_all_done == true`（若存在），通过后写 `session.status = "completed"`

</actions>

</state_machine>

<appendix>

### Stage Mapping

执行 Agent 始终拥有完整工具集（read + write），由 skill 自身约束行为。Decision 评估 Agent 通过 prompt 中的 CONSTRAINTS 约束为只读。

| Stage | Skill (independent) | Skill (unified) | Decision after | quality_mode |
|-------|---------------------|-----------------|----------------|--------------|
| grill | `maestro-grill "{intent}"` | *(same)* | — | all |
| brainstorm | `maestro-brainstorm "{intent}"` | *(same)* | — | all |
| blueprint | `maestro-blueprint "{intent}"` | *(same)* | — | all |
| init | `maestro-init` | *(same)* | — | all |
| spec-setup | `spec-setup` | *(same)* | — | all |
| analyze-macro | `maestro-analyze "{intent}"` | *(same)* | `post-analyze-scope` | all |
| roadmap | `maestro-roadmap --from analyze:{id}` | *(same)* | — | all |
| analyze | `maestro-analyze {phase}` | `maestro-analyze` | — | all |
| plan | `maestro-plan {phase}` | `maestro-plan` | — | all |
| execute | `maestro-execute {phase}` | `maestro-execute` | `post-execute` | all |
| business-test | `quality-auto-test {phase}` | `quality-auto-test` | `post-business-test` | full only |
| review | `quality-review {phase}` | `quality-review` | `post-review` | all |
| test-gen | `quality-auto-test {phase}` | `quality-auto-test` | — | full / standard |
| test | `quality-test {phase}` | `quality-test` | `post-test` | full, standard |
| frontend-verify | `quality-test {phase} --frontend-verify` | `quality-test --frontend-verify` | `post-frontend-verify` | all (UI only) |
| milestone-audit | `maestro-milestone-audit` | *(same)* | — | all |
| goal-audit | *(decision-only)* | *(same)* | `post-goal-audit` | all |
| milestone-complete | `maestro-milestone-complete` | *(same)* | `post-milestone` | all |

Build rules 0-14 全部适用，包括 spec-setup 预检（rule 0.5）、grill auto_confirm 透传（rule 3.5）、frontend-verify UI 门控（rule 3.6）、re-grounding 插入（rule 5.5）等。

### Session Schema

```json
{
  "session_id": "ralph-v2-{YYYYMMDD-HHmmss}",
  "source": "ralph", "status": "running",
  "execution_mode": "agent",
  "ralph_protocol_version": "2",
  "active_step_index": null,
  "active_agent_name": null,
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
  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
  "steps": [{
    "index": 0,
    "skill": "",
    "args": "",
    "stage": "",
    "scope": null,
    "decision": null,
    "evaluate_via": "agent|cli|dual",
    "retry_count": 0,
    "max_retries": 2,
    "command_scope": "global|project|missing|null",
    "command_path": "<absolute path> | null",
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
    "load": null,
    "agent_exec_name": null,
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

### Fix-Loop Templates

6 套 fix-loop templates（post-execute / post-business-test / post-review / post-test / post-frontend-verify / post-goal-audit）。插入的 step 通过 A_STEP_DISPATCH 派发 executor agent 逐步执行，由主流程调 `ralph complete` 上报。

### Error Codes

E001–E006, W001–W004 适用。Agent 新增：

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E014 | error | Agent execution failed (Agent returned null) | Retry once, then BLOCKED |
| E016 | error | Evaluation Agent verdict parse failed | Fallback fix + parse_failed: true |

### Success Criteria

- [ ] ralph-v2 owns full step loop: locate → resolve → dispatch → wait → receive → extract → drift → complete → next
- [ ] One agent per step — `Agent({ name, subagent_type: "ralph-executor" })` 每步派发一个 named executor
- [ ] Executor 内调 `maestro ralph next` 获取 skill prompt 并执行，支持内部多 agent 编排
- [ ] Executor 通过 `SendMessage({to: "main"})` 回传 `EXECUTOR_OUTPUT` 格式结果
- [ ] 主流程调 `maestro ralph complete` 上报（非 agent 上报）
- [ ] 主流程负责 arg resolution、context loading、signal extraction、drift analysis
- [ ] A_STEP_RECEIVE 从 executor 的 agent-message 中提取执行输出
- [ ] Executor 崩溃（idle 无 SendMessage）→ 询问 2 次后 STATUS=BLOCKED，转 S_HANDLE_FAIL
- [ ] Dual dispatch: 执行 Agent 传 `name`（async + SendMessage），评估 Agent 不传 `name`（sync）或 CLI delegate
- [ ] Decision evaluation 支持三种模式：agent（同步）、cli（CLI delegate）、dual（并行交叉验证）
- [ ] `evaluate_via` 字段控制评估模式，默认 `"agent"`
- [ ] dual 模式合并策略：一致取共识、分歧保守降级、CLI 未返回用 Agent 结果
- [ ] Verdict 解析保持 `---VERDICT---` 格式，parse 失败 → fallback fix + parse_failed: true
- [ ] decisions.ndjson 追加：source 字段为 `"ralph-v2"`
- [ ] Session schema: `execution_mode: "agent"`，`agent_exec_name`（执行 Agent name + display），含 `artifacts_produced`
- [ ] Chain building（S_RESOLVE_PHASE through S_BUILD_CHAIN）自包含执行
- [ ] A_STEP_DISPATCH 含前序产出加载（滑动窗口 5 step + accumulated signals + stage-specific artifacts）
- [ ] `agent_exec_name` 含 stage prefix（grl/brn/anm/ana/pln/exe/rev/tst/dbg）——同时用于 Agent name 参数和 display
- [ ] `--summary` 在 DONE/DONE_WITH_CONCERNS 时为 MUST（动词开头，≤100 字）
- [ ] CAVEATS 在 DONE_WITH_CONCERNS 时同时映射 --concerns
- [ ] A_STEP_EXTRACT 从 executor 输出提取 artifact IDs、path signals、phase signals
- [ ] A_STEP_DRIFT_ANALYZE：ALIGNED/MINOR_DRIFT → complete；MAJOR_DRIFT+未重试 → retry；MAJOR_DRIFT+已重试 → DONE_WITH_CONCERNS
- [ ] A_STEP_COMPLETE 将 context signals 写入 status.json.context
- [ ] A_AMEND_GOAL：完整 5 步流程 + deferred_reading ralph-amend-goal.md + Agent mini grill 含完整 prompt
- [ ] 旧目标标 superseded（superseded_by + superseded_at），新目标 origin: "CHG-xxx"
- [ ] goal_changelog 含完整 before/after + impact_assessment
- [ ] blueprint_id session 字段支持 --from blueprint:{BLP_ID} 路径
- [ ] spec-setup 预检（build rule 0.5）
- [ ] post-milestone adhoc 分支：mark completed + set current_milestone = null
- [ ] post-reground + drifted + confidence < 60 → A_APPLY_PROCEED (LOW CONFIDENCE)
- [ ] Fix-loop 插入的 step 通过 A_STEP_DISPATCH 逐步执行
- [ ] re-grounding 3-step 插入规则（build rule 5.5）不变
- [ ] A_REGROUND_HALT 漂移熔断（auto_confirm 不跳过）不变

</appendix>
