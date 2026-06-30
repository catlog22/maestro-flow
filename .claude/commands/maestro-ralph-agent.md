---
name: maestro-ralph-agent
description: Agent-orchestrated lifecycle — compose, dispatch Agent, evaluate decision, loop
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
---
<purpose>
Agent-orchestrated variant of maestro-ralph. Same chain-building logic — but execution via Claude Agent instead of CLI delegation: compose prompt → dispatch Agent(maestro-ralph-agent-execute) → agent runs step loop → returns on decision/complete/fail → evaluate decision inline via Agent → re-dispatch → loop.

Session: `.workflow/.maestro/ralph-agent-{YYYYMMDD-HHmmss}/status.json`

Chain building（A_RESOLVE_PHASE → A_INFER_POSITION → A_BUILD_STEPS）、session schema、decomposition（A_DECOMPOSE_TASKS）与 ralph 共用。
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
- `.workflow/.maestro/ralph-agent-*/status.json` — session state
</context>

<invariants>
All ralph invariants (1-16) apply, with the following overrides:

- **Invariant 1 Agent 语义**: ralph-agent 不直接执行 step 内容；执行由 Agent(maestro-ralph-agent-execute) 完成
- **Invariant 2 覆盖**: ralph-agent 不调用 `Skill("maestro-ralph-execute")`；invariant 17-24 替代 handoff 机制，ralph-agent 持有完整循环

Additionally:

17. **ralph-agent owns the loop** — dispatch Agent → wait → verify → decide → re-dispatch 全部在本命令内完成；execute Agent 是被委派的执行者
18. **Dispatch via Agent()** — 使用 `Agent({ name, description, prompt })` 启动执行 Agent，Agent 内部调用 `Skill("maestro-ralph-agent-execute", "--session {session_id}")` 加载执行命令
19. **Synchronous dispatch** — Agent() 调用是同步的（等待返回），不需要 STOP/callback 模式
20. **Execute Agent 自治执行** — 执行 Agent 自主循环处理所有 pending 执行 step，遇到 decision 节点时停止并返回；执行 Agent 内部调用 `maestro ralph complete` 上报（agent 上报）
21. **Decision evaluation inline** — decision 节点不 handoff，通过 `Agent()` 启动分析 Agent 在本循环内评估
22. **Agent return 解析** — 从 Agent 返回文本中解析执行结果（`---AGENT-STATUS---` 块），替代 `---RESULT---` 解析
23. **No CLI delegation** — 本命令不使用 `maestro delegate`；执行和评估均通过 Agent() 完成
24. **No inline skill execution** — 本命令不执行 skill 逻辑；执行由 Agent(maestro-ralph-agent-execute) 完成
</invariants>

<state_machine>

Chain-building states（S_PARSE_ROUTE through S_CREATE_SESSION）与 ralph 共用。执行循环 states：

<states>
S_PARSE_ROUTE   — 解析参数、路由入口
S_STATUS        — 显示 session 进度
S_CONTINUE      — 恢复执行
S_RESOLVE_PHASE — (共用)
S_INFER         — (共用)
S_RESOLVE_SCOPE — (共用)
S_QUALITY_MODE  — (共用)
S_PLANNING_MODE — (共用)
S_DECOMPOSE     — (共用)
S_BUILD_CHAIN   — (共用)
S_CREATE_SESSION — 写 status.json
S_CONFIRM       — 用户确认

S_AGENT_DISPATCH  — 启动执行 Agent                      PERSIST: session.active_agent_name
S_AGENT_RECEIVE   — 接收 Agent 返回、解析状态              PERSIST: —
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
  → S_AGENT_DISPATCH WHEN: running session found
  → S_FALLBACK       WHEN: no running session

S_AMEND_GOAL:
  → S_AGENT_DISPATCH WHEN: change applied + user confirmed    DO: A_AMEND_GOAL
  → END              WHEN: user cancels
  GUARD: RISK_LEVEL=high → auto_confirm 无效

S_CREATE_SESSION:
  → S_CONFIRM         WHEN: not auto_confirm
  → S_AGENT_DISPATCH  WHEN: auto_confirm

S_CONFIRM:
  → S_AGENT_DISPATCH  WHEN: user confirms
  → S_BUILD_CHAIN     WHEN: user edits
  → END               WHEN: user cancels

S_AGENT_DISPATCH:
  → S_AGENT_RECEIVE   DO: A_DISPATCH_EXECUTE_AGENT

S_AGENT_RECEIVE:
  → S_DECISION_EVAL   WHEN: Agent returned "decision_pending"   DO: A_PARSE_AGENT_RETURN
  → S_SESSION_DONE    WHEN: Agent returned "session_complete"    DO: A_PARSE_AGENT_RETURN
  → S_HANDLE_FAIL     WHEN: Agent returned "step_failed"        DO: A_PARSE_AGENT_RETURN
  → S_HANDLE_FAIL     WHEN: Agent returned null (agent error)   DO: A_PARSE_AGENT_RETURN

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
  → S_AGENT_DISPATCH WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_AGENT_DISPATCH WHEN: post-goal-audit + has_unmet       DO: A_APPLY_GOAL_FIX
  → S_AGENT_DISPATCH WHEN: post-goal-audit + all_met + INTENT_ALIGNED=true  DO: A_APPLY_GOAL_DONE
  → END              WHEN: post-goal-audit + all_met + INTENT_ALIGNED=false  DO: A_REGROUND_HALT
  → S_AGENT_DISPATCH WHEN: post-analyze-scope                DO: A_APPLY_SCOPE_VERDICT
  → S_AGENT_DISPATCH WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_AGENT_DISPATCH WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_AGENT_DISPATCH WHEN: post-milestone + standard + next milestone   DO: A_ADVANCE_MILESTONE
  → END              WHEN: post-milestone + standard + no next milestone
  → END              WHEN: post-milestone + adhoc                       DO: mark completed (set current_milestone = null)
  → END              WHEN: post-debug-escalate                DO: A_PAUSE_ESCALATE
  → END              WHEN: post-reground + drifted + confidence >= 60  DO: A_REGROUND_HALT
  → S_AGENT_DISPATCH WHEN: post-reground + aligned           DO: A_APPLY_PROCEED
  → S_AGENT_DISPATCH WHEN: post-reground + drifted + confidence < 60  DO: A_APPLY_PROCEED (标 LOW CONFIDENCE)
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → AskUserQuestion with override options
  GUARD: post-reground + drifted + confidence >= 60 → A_REGROUND_HALT（auto_confirm 不跳过）

S_HANDLE_FAIL:
  → S_AGENT_DISPATCH WHEN: auto + not retried              DO: A_RETRY
  → END              WHEN: auto + retried                   DO: A_PAUSE_SESSION
  → S_AGENT_DISPATCH WHEN: interactive + retry
  → S_AGENT_DISPATCH WHEN: interactive + skip
  → END              WHEN: interactive + abort

S_SESSION_DONE:
  → END             DO: A_COMPLETE_SESSION

</transitions>

<actions>

### A_CREATE_SESSION
1. `session_id` format: `ralph-agent-{YYYYMMDD-HHmmss}`
2. Additional fields: `execution_mode: "agent"`，无 `cli_tool` 字段
3. Each step: `agent_exec_name: null`（替代 `delegate_exec_id`）
4. Step mode/role/rule assigned per stage (see Stage Mapping table)

### A_DISPATCH_EXECUTE_AGENT

启动执行 Agent 处理 pending 执行 step。Agent 自主循环直到遇到 decision/完成/失败。

1. Read status.json → 确认有 pending step
2. Resolve agent name: `{stage_prefix}-{session_id_short}-{HHmmss}`

   **Agent Name Prefix (by stage):**

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

3. Compose `<execution_context>` block:

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
  <active_goals>{task_decomposition WHERE status != "superseded"; superseded 目标仅一行标注}</active_goals>
  <prior_step_context>
    {最近 5 个已完成 step 的 completion_summary + completion_caveats}
  </prior_step_context>
  <accumulated_signals>
    {聚合所有已完成 step 的 caveats + deferred}
  </accumulated_signals>
  <stage_context>
    {按下一个 pending step 的目标 skill 类型选择性注入，见下表；仅在有实际内容时加入}
  </stage_context>
</execution_context>
```

   **Stage-specific `<stage_context>` injection:**

   | 目标 skill 类型 | 注入重点 |
   |----------------|---------|
   | analyze | intent + scope + boundary |
   | plan | analysis findings + scope_verdict + recommendations |
   | execute | task list + dependencies + wave + caveats from plan |
   | review | changed files + verification results + execution decisions |
   | test | review findings + execution artifacts + coverage data |
   | debug | error details + failing tests + execution trace |
   | brainstorm/grill | challenged assumptions + risks + prior findings |

4. Dispatch Agent:

```
Agent({
  name: "{resolved_agent_name}",
  description: "执行 ralph session steps",
  prompt: `执行 ralph-agent session {session_id} 的 pending steps。

调用 Skill("maestro-ralph-agent-execute", "--session {session_id}") 执行步骤。
maestro-ralph-agent-execute 会自动循环执行 pending 执行 step，遇到 decision/完成/失败时返回。

{execution_context}

执行 Agent 内部调用 maestro ralph complete 上报。你只需确保 Skill 调用完成后输出 ---AGENT-STATUS--- 块。

最后必须输出以下状态块：

---AGENT-STATUS---
RESULT: decision_pending|session_complete|step_failed|steps_completed
LAST_STEP_INDEX: {N}
DECISION_NODE: {gate name, 仅 decision_pending 时}
COMPLETED_STEPS: {本次完成的 step 数量}
FAILURE_REASON: {仅 step_failed 时}
---END---`
})
```

5. Write `session.active_agent_name` to status.json
6. Display: `⟶ Agent:{name} dispatched for session {session_id}`

### A_PARSE_AGENT_RETURN

从 Agent 返回文本中解析 `---AGENT-STATUS---` 块，并验证 session 状态一致性。

1. Extract RESULT field → route to next state
2. Extract metadata: LAST_STEP_INDEX, DECISION_NODE, COMPLETED_STEPS, FAILURE_REASON
3. If no `---AGENT-STATUS---` block → fallback: re-read status.json 推断状态
   - 有 pending decision step → `decision_pending`
   - 全部 completed → `session_complete`
   - 有 failed step → `step_failed`
4. **Verify agent reporting** — re-read status.json 验证 agent 上报是否成功写入：
   - 检查 LAST_STEP_INDEX 对应的 step 是否 `completion_confirmed == true`
   - 若 Agent 返回 COMPLETED_STEPS > 0 但 status.json 中对应 step 未 completed → 标记 `agent_report_mismatch = true`，RESULT 降级为 `step_failed`，FAILURE_REASON = "agent 上报未写入 status.json"
   - 检查 `session.status` 是否仍为 "running"（agent 崩溃可能导致 paused）
5. Display: `[Agent返回] {RESULT} — 完成 {COMPLETED_STEPS} 步`

### A_AGENT_EVALUATE

通过 Agent 在本循环内评估质量门。替代 `maestro delegate --mode analysis`。

1. Resolve artifact dir: `.workflow/scratch/{artifact.path}/` with fallback glob
2. Parse decision metadata: `{ decision, retry_count, max_retries }`
3. Map result files（同 ralph A_DELEGATE_EVALUATE）:

   | Decision | Files |
   |----------|-------|
   | post-execute | verification.json |
   | post-business-test | .tests/auto-test/report.json |
   | post-review | review.json |
   | post-test | uat.md, .tests/test-results.json |
   | post-frontend-verify | e2e-results.json |

4. Dispatch evaluation Agent:
   ```
   Agent({
     name: "eval-{decision}-{timestamp}",
     description: "评估 {decision} 质量门",
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
5. On return: parse `---VERDICT---` block — STATUS must match strict enum `PASS|FAIL|PARTIAL|BLOCKED`; parse failure → fallback STATUS="fix", `parse_failed: true`, `confidence_score: 0` (invariant 13)
6. Confidence adjustment: <60 + proceed → fix; >95 + fix + retry>0 → suggest proceed
7. **Decision log**: Append to `{session_dir}/decisions.ndjson`:
   ```json
   { "id": "DEC-{timestamp}", "timestamp": "{ISO}", "source": "ralph-agent",
     "node_id": "{step.decision}", "type": "quality-gate",
     "verdict": "{adjusted_verdict}", "confidence_score": {N},
     "parse_failed": false,
     "close_call": {N>=50 && N<=70}, "summary": "{REASON}" }
   ```

### A_AGENT_GOAL_AUDIT

通过 Agent 审计子目标完成情况。替代 `maestro delegate --mode analysis` 的 goal audit。

1. Read `session.task_decomposition` from status.json
2. Dispatch audit Agent:
   ```
   Agent({
     name: "goal-audit-{timestamp}",
     description: "审计子目标完成情况",
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
4. Append `{session_dir}/decisions.ndjson`：`{ "type": "goal-gate", "unmet_count": N, "unmet_ids": [...] }`
5. Verdict routing: `all_met` + `INTENT_ALIGNED=true` → A_APPLY_GOAL_DONE；`all_met` + `INTENT_ALIGNED=false` → A_REGROUND_HALT；`has_unmet` → A_APPLY_GOAL_FIX
   GUARD: retry_count >= max_retries AND still unmet → A_APPLY_ESCALATE

### A_AGENT_REGROUND

通过 Agent 执行意图保真检查。替代 `maestro delegate --mode analysis` 的 reground。

1. Read status.json：intent, boundary_contract, completed steps, done goals
2. Dispatch reground Agent:
   ```
   Agent({
     name: "reground-{timestamp}",
     description: "意图保真检查",
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

与 ralph 的 A_SCOPE_EVALUATE 相同。读 `conclusions.json.scope_verdict`，写入 session，追加 decisions.ndjson。

### A_STRUCTURAL_EVALUATE

与 ralph 相同。post-milestone → 判断 standard/adhoc + 后续。post-debug-escalate → A_PAUSE_ESCALATE。

### A_SHOW_STATUS

与 ralph 相同。找最新 ralph-agent session，显示 steps + sub-goals 进度。

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE

与 ralph 相同。Mark decision / insert fix-loop / insert debug-escalate。

### A_APPLY_SCOPE_VERDICT

与 ralph 相同。依据 scope_verdict 重塑下游链路。

### A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE

与 ralph 相同。Insert scoped mini-loops / mark all goals done。

### A_ADVANCE_MILESTONE

与 ralph 相同。Insert full lifecycle steps for next milestone。

### A_REGROUND_HALT / A_PAUSE_ESCALATE

与 ralph 相同。Set session paused，display warning。

### A_AMEND_GOAL

运行中 session 的目标热修改。详细流程由 `<deferred_reading>` 加载 `ralph-amend-goal.md`。

| Phase | 行为 | 产出 |
|-------|------|------|
| 1. 快照 | 读 `task_decomposition` + `boundary_contract` + 已完成 steps 的 `completion_summary` | Display: 目标列表 + 进度 |
| 2. 解析 | `change_request` 非空 → 直接用；为空 → AskUserQuestion（修改/新增/移除/调整边界） | `change_type` + `change_request` |
| 3. Mini Grill | Agent 评估影响（替代 maestro delegate） | RISK_LEVEL + AFFECTED_GOALS + INVALIDATED_STEPS + NEW_GAPS |
| 4. 确认 | AskUserQuestion：应用并继续 / 仅改目标 / 取消 | 用户选择 |
| 5. 应用 | 归档旧目标（`superseded`）→ 写入新目标（`origin: CHG-xxx`）→ 重建链路 → write status.json | re-dispatch |

**Phase 3 Agent prompt:**
```
Agent({
  name: "amend-grill-{timestamp}",
  description: "Amend impact analysis",
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

- **A_RETRY**: `Bash("maestro ralph retry {index}")` — 同 ralph
- **A_PAUSE_SESSION**: `ralph complete N --status BLOCKED --reason "..."` — 同 ralph
- **A_COMPLETE_SESSION**: 校验所有 step `completion_confirmed == true` + `task_decomposition_all_done == true`，写 `session.status = "completed"` — 同 ralph

</actions>

</state_machine>

<appendix>

### Agent vs CLI-Delegate 对照

| 维度 | ralph-cli (CLI-delegate) | ralph-agent (Agent) |
|------|-------------------------|---------------------|
| 执行分发 | `maestro delegate` (Bash bg) | `Agent()` (同步) |
| 执行包装器 | `maestro-ralph-cli-execute` (delegate 加载) | `maestro-ralph-agent-execute` (Agent 内 Skill 加载) |
| 结果通信 | `---RESULT---` 文本块 (从 delegate output 解析) | Agent 返回文本 + `---AGENT-STATUS---` 块 |
| 回调模式 | STOP → re-invocation callback | 同步等待 Agent 返回（无 STOP） |
| 决策评估 | `maestro delegate --mode analysis` (Bash bg + STOP) | `Agent()` 同步分析（无 STOP） |
| 完成上报 | 编排器调 `ralph complete`（解析 RESULT 后） | 执行 Agent 内调 `ralph complete`（agent 上报） |
| session 字段 | `execution_mode: "cli-delegate"`, `cli_tool`, `delegate_exec_id` | `execution_mode: "agent"`, `agent_exec_name` |

### Stage Mapping

Agent 版无 `delegate_mode`/`delegate_rule` 字段。执行 Agent 始终拥有完整工具集（read + write），由 skill 自身约束行为。Decision 评估 Agent 通过 prompt 中的 CONSTRAINTS 约束为只读。

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

Build rules 与 ralph 完全共用（0-14），包括 spec-setup 预检（rule 0.5）、grill auto_confirm 透传（rule 3.5）、frontend-verify UI 门控（rule 3.6）、re-grounding 插入（rule 5.5）等。

### Session Schema

```json
{
  "session_id": "ralph-agent-{YYYYMMDD-HHmmss}",
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

与 ralph 共用 6 套 fix-loop templates。插入的 step 通过 Agent dispatch 执行，由 execute Agent 内调 `ralph complete` 上报。

### Error Codes

E001–E006, W001–W004 适用。Agent 新增：

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E014 | error | Agent execution failed (Agent returned null) | Retry once, then BLOCKED |
| E015 | error | `---AGENT-STATUS---` block not found | Fallback: re-read status.json 推断 |
| E016 | error | Evaluation Agent verdict parse failed | Fallback fix + parse_failed: true |

### Success Criteria

- [ ] ralph-agent owns full loop: dispatch Agent → wait → verify → decide → re-dispatch
- [ ] 执行通过 `Agent()` 分发，Agent 内调 `Skill("maestro-ralph-agent-execute", "--session {id}")` 执行
- [ ] Agent 返回文本含 `---AGENT-STATUS---` 块（RESULT/LAST_STEP_INDEX/DECISION_NODE/COMPLETED_STEPS/FAILURE_REASON）
- [ ] 无 STOP/callback 模式 — Agent() 同步等待返回
- [ ] 执行 Agent 自主循环执行 step，遇 decision 停止返回
- [ ] 执行 Agent 内部调 `maestro ralph complete` 上报（agent 上报，非编排器上报）
- [ ] A_PARSE_AGENT_RETURN 验证 status.json：agent 上报写入确认 + session.status 一致性
- [ ] Decision evaluation 通过 Agent() 同步完成（非 maestro delegate）
- [ ] Verdict 解析保持 `---VERDICT---` 格式，parse 失败 → fallback fix + parse_failed: true
- [ ] decisions.ndjson 追加：source 字段为 `"ralph-agent"`
- [ ] Session schema: `execution_mode: "agent"`，`agent_exec_name` 替代 `delegate_exec_id`，含 `artifacts_produced`
- [ ] Chain building（S_RESOLVE_PHASE through S_BUILD_CHAIN）与 ralph 共用逻辑不变
- [ ] execution_context 块含 prior_step_context（滑动窗口 5 step）+ accumulated_signals + stage_context
- [ ] execution_context 中 boundary_contract 不截断；superseded 目标仅一行标注
- [ ] Agent name 含 stage prefix（grl/brn/anm/ana/pln/exe/rev/tst/dbg）
- [ ] Stage Mapping 表内联适配（无 delegate_mode/delegate_rule，Agent 始终 read+write，评估 Agent prompt 约束只读）
- [ ] completion_summary 在 DONE/DONE_WITH_CONCERNS 时为 MUST（由 execute Agent 的 ralph complete --summary 写入）
- [ ] CAVEATS 在 DONE_WITH_CONCERNS 时同时映射 --concerns（execute Agent 负责）
- [ ] A_AMEND_GOAL：完整 5 步流程 + deferred_reading ralph-amend-goal.md + Agent mini grill 含完整 prompt
- [ ] 旧目标标 superseded（superseded_by + superseded_at），新目标 origin: "CHG-xxx"
- [ ] goal_changelog 含完整 before/after + impact_assessment
- [ ] blueprint_id session 字段支持 --from blueprint:{BLP_ID} 路径
- [ ] spec-setup 预检（build rule 0.5）
- [ ] post-milestone adhoc 分支：mark completed + set current_milestone = null
- [ ] post-reground + drifted + confidence < 60 → A_APPLY_PROCEED (LOW CONFIDENCE)
- [ ] Fix-loop 插入的 step 通过 Agent dispatch 执行，`agent_exec_name` 初始化为 null
- [ ] re-grounding 3-step 插入规则（build rule 5.5）不变
- [ ] A_REGROUND_HALT 漂移熔断（auto_confirm 不跳过）不变
- [ ] `---AGENT-STATUS---` 块缺失时 fallback：re-read status.json 推断状态
- [ ] Agent 超时/崩溃 → A_PARSE_AGENT_RETURN fallback 推断 + S_HANDLE_FAIL 路径

</appendix>
</output>
</output>
