---
name: maestro-ralph-cli
description: CLI-delegated lifecycle orchestrator — compose, delegate, analyze, decide in one loop
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
---
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
S_RESOLVE_PHASE — (共用)
S_INFER         — (共用)
S_RESOLVE_SCOPE — (共用)
S_QUALITY_MODE  — (共用)
S_PLANNING_MODE — (共用)
S_DECOMPOSE     — (共用)
S_BUILD_CHAIN   — (共用)
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

### A_CREATE_SESSION
1. `session_id` format: `ralph-cli-{YYYYMMDD-HHmmss}`
2. Additional fields: `execution_mode: "cli-delegate"`, `cli_tool: "<selected>"``
3. Each step: `delegate_exec_id: null`, `cli_output_summary: null`, `artifacts_produced: []`
4. Step mode/role/rule assigned per stage (see Stage Mapping table)

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

1. Resolve artifact dir: `.workflow/scratch/{artifact.path}/` with fallback glob
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

6 套 fix-loop templates（post-execute / post-business-test / post-review / post-test / post-frontend-verify / post-goal-audit）。Each inserted step is delegated through the same compose → delegate → analyze cycle.

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
