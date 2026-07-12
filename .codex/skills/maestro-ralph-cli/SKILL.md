---
name: maestro-ralph-cli
description: CLI-delegated lifecycle orchestrator — compose, delegate, analyze,
  decide in one loop
argument-hint: <intent> [-y] [--to <tool>] | status | continue
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<run_mode>
**Session mode:** `run`. This boundary is mandatory and overrides legacy Codex session-path examples below.

1. Before domain work, call `maestro run create maestro-ralph-cli -- $ARGUMENTS` and retain the returned `run_id`, `run_dir`, and `upstream`.
2. Formal deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; synthesis and handoff go to `{run_dir}/report.md`.
3. Do not edit protocol JSON or append to project `state.json.artifacts[]`.
4. Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` are semantic labels only. Map them into the active Run and never create a second formal truth source.
</run_mode>

<purpose>
CLI-delegated variant of maestro-ralph. Same chain-building logic — but this command owns the full orchestration loop: compose prompt → delegate to CLI (via ralph-cli-execute wrapper) → STOP → callback → analyze structured result → mark complete → decide next → loop.

### Notation

`Skill(name)` / `Skill(name, args)` = 加载 `~/.codex/skills/{name}/SKILL.md` 或 `.codex/skills/{name}/SKILL.md`（project 覆盖 global）。严禁翻译为 `Bash("maestro {name} {args}")`——CLI 不接受裸 intent。

Session: `.workflow/.maestro/ralph-cli-{YYYYMMDD-HHmmss}/status.json`

**Shared with ralph**: chain building (A_RESOLVE_PHASE → A_INFER_POSITION → A_BUILD_STEPS), session schema, decomposition (A_DECOMPOSE_TASKS). See `Skill(maestro-ralph)` for full specification.
</purpose>

<context>
$ARGUMENTS — same as ralph plus CLI-specific flags.

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
All ralph invariants (1-15) apply. Additionally:

16. **ralph-cli owns the loop** — compose → delegate → analyze → decide 全部在本命令内完成；maestro-ralph-cli-execute 只是被委托端的执行包装器
17. **Delegate via cli-execute** — delegate prompt 首行为 cli-execute 调用，格式由目标工具决定（见 Invocation Notation）
18. **Parse ---RESULT--- block** — delegate 返回后从输出中解析结构化结果块
19. **Decision evaluation inline** — decision 节点不 handoff，直接在本循环内评估
20. **No inline skill execution** — 本命令不执行 skill 逻辑；执行由委托端 cli-execute 完成
21. **Platform** — `session.platform = "codex"`；skill discovery 通过 `maestro ralph skills --platform codex`
</invariants>

<state_machine>

Ralph's chain-building states apply (S_PARSE_ROUTE through S_CREATE_SESSION). Execution loop states replace S_DISPATCH:

<states>
S_PARSE_ROUTE   — 解析参数、路由入口
S_STATUS        — 显示 session 进度
S_CONTINUE      — 恢复执行
S_RESOLVE_PHASE — (ralph shared)
S_INFER         — (ralph shared)
S_RESOLVE_SCOPE — (ralph shared)
S_QUALITY_MODE  — (ralph shared)
S_PLANNING_MODE — (ralph shared)
S_DECOMPOSE     — (ralph shared)
S_BUILD_CHAIN   — (ralph shared)
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

S_STEP_RESOLVE → S_STEP_LOAD       DO: A_RESOLVE_ARGS
S_STEP_LOAD    → S_STEP_COMPOSE    DO: A_LOAD_STEP_CONTEXT
S_STEP_COMPOSE → S_STEP_DELEGATE   DO: A_COMPOSE_DELEGATION_PROMPT
S_STEP_DELEGATE → END              DO: A_DISPATCH_DELEGATE (STOP)

S_STEP_LOCATE (on re-entry, finds running step with delegate_exec_id):
  → S_STEP_ANALYZE  WHEN: delegate completed
  → END             WHEN: delegate still running (STOP)

S_STEP_ANALYZE:
  → S_POST_ANALYZE  WHEN: STATUS == DONE|DONE_WITH_CONCERNS   DO: A_PARSE_RESULT
  → S_HANDLE_FAIL   WHEN: STATUS == NEEDS_RETRY|BLOCKED       DO: A_PARSE_RESULT

S_POST_ANALYZE:
  → S_STEP_COMPLETE WHEN: drift_score == ALIGNED|MINOR_DRIFT   DO: A_POST_ANALYZE_DRIFT
  → S_STEP_LOAD     WHEN: drift_score == MAJOR_DRIFT + not retried  DO: A_POST_ANALYZE_DRIFT (re-delegate with correction)
  → S_STEP_COMPLETE WHEN: drift_score == MAJOR_DRIFT + retried     DO: A_POST_ANALYZE_DRIFT (proceed with caveats)

S_STEP_COMPLETE → S_STEP_LOCATE    DO: A_MARK_COMPLETE

S_DECISION_EVAL:
  → S_APPLY_VERDICT WHEN: quality-gate    DO: A_DELEGATE_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate       DO: A_GOAL_AUDIT_EVALUATE
  → S_APPLY_VERDICT WHEN: scope-gate      DO: A_SCOPE_EVALUATE
  → S_APPLY_VERDICT WHEN: reground-gate   DO: A_REGROUND_EVALUATE
  → S_APPLY_VERDICT WHEN: structural      DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_STEP_LOCATE   WHEN: proceed / fix / goal-fix / scope-verdict / milestone-advance
  → END             WHEN: escalate / reground-halt / session complete / debug-escalate
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: post-reground + drifted + confidence >= 60 → A_REGROUND_HALT（auto_confirm 不跳过）

S_HANDLE_FAIL:
  → S_STEP_LOCATE   WHEN: auto + not retried              DO: A_RETRY
  → END             WHEN: auto + retried                   DO: A_PAUSE_SESSION

S_SESSION_DONE → END               DO: A_COMPLETE_SESSION

</transitions>

<actions>

### A_CREATE_SESSION (override)

Same as ralph A_CREATE_SESSION with:
1. `session_id` format: `ralph-cli-{YYYYMMDD-HHmmss}`
2. `execution_mode: "cli-delegate"`, `cli_tool`, `platform: "codex"`
3. Each step: `delegate_exec_id: null`, `cli_output_summary: null`, `artifacts_produced: []`
4. Step mode/role/rule assigned per stage (see Stage Mapping)

### A_RESOLVE_ARGS

Same as Skill(maestro-ralph-execute) A_RESOLVE_ARGS:
- Placeholder substitution, per-skill enrichment, `--from` auto-injection, goal context injection, `--from blueprint:{BLP_ID}` support

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
| claude | `/maestro-ralph-cli-execute {step.skill} {resolved_args} --session {session_id}` |
| codex | `$maestro-ralph-cli-execute {step.skill} {resolved_args} --session {session_id}` |
| opencode, agy | `/maestro-ralph-cli-execute {step.skill} {resolved_args} --session {session_id}` |

**Skill-adapted prompt** — 根据目标 skill 类型选择性注入 step_context 中的内容：

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

1. `maestro delegate "{prompt}" --to {cli_tool} --mode {delegate_mode} --id {prefix}-{HHmmss}-{rand4}`
2. Write `step.delegate_exec_id`, `step.status = "running"`
3. `Bash({ run_in_background: true })`
4. **STOP**

### A_PARSE_RESULT

1. `maestro delegate status {exec_id}` — still running → STOP
2. `maestro delegate output {exec_id}` — parse `---RESULT---` / `---END---` block
3. Extract: STATUS, SUMMARY, ARTIFACTS, DECISIONS, CAVEATS, DEFERRED, SIGNALS
4. Apply SIGNALS key=value pairs to session.context
5. No block found → fallback: STATUS=DONE_WITH_CONCERNS

### A_MARK_COMPLETE

`Bash("maestro ralph complete {index} --status {STATUS} --summary \"{SUMMARY}\" ...")`

### A_SHOW_STATUS

Same as ralph: find latest ralph-cli session, display steps + sub-goals progress.

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

**drift_score:** ALIGNED / MINOR_DRIFT / MAJOR_DRIFT

**4. 修正动作:**

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常进入 S_STEP_COMPLETE |
| MINOR_DRIFT | 将偏离项追加到 completion_caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | 写 `step.drift_correction`，回到 S_STEP_LOAD 重新 compose + delegate |
| MAJOR_DRIFT + 已重试 | 以 DONE_WITH_CONCERNS complete，由后续 decision node 裁决 |

**5. 写入:** `step.drift_score`, `step.drift_correction`

### A_DELEGATE_EVALUATE

Same as ralph: delegate `--role analyze --mode analysis` with quality gate verdict parsing. Inline (run_in_background, STOP, callback).

### A_GOAL_AUDIT_EVALUATE / A_SCOPE_EVALUATE / A_REGROUND_EVALUATE

Same as ralph. All run inline via delegate.

### A_STRUCTURAL_EVALUATE

**post-milestone**: next milestone? insert lifecycle steps / complete. Adhoc: always END.
**post-debug-escalate**: always STOP → A_PAUSE_ESCALATE.

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE / A_APPLY_SCOPE_VERDICT / A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE / A_ADVANCE_MILESTONE

Same as ralph. All chain mutations apply unchanged.

### A_REGROUND_HALT

Same as ralph: `session.status = "paused"`, display drift warning. auto_confirm 不跳过.

### A_PAUSE_ESCALATE

Set session paused, display "请人工介入", suggest `Skill(maestro-ralph-cli, continue)`.

### A_AMEND_GOAL

Same as ralph (deferred_reading: `ralph-amend-goal.md`): 5 步流程. RISK_LEVEL=high 时 auto_confirm 无效。

### A_RETRY / A_PAUSE_SESSION / A_COMPLETE_SESSION

Same as ralph equivalents.

</actions>

</state_machine>

<appendix>

### Stage Mapping

| Stage | delegate_mode | delegate_role | delegate_rule |
|-------|---------------|---------------|---------------|
| analyze, analyze-macro | analysis | analyze | `analysis-analyze-code-patterns` |
| plan | write | plan | `planning-breakdown-task-steps` |
| execute | write | implement | `development-implement-feature` |
| review, business-test | analysis | review | `analysis-review-code-quality` |
| test, test-gen | write | implement | — |
| grill, brainstorm | write | brainstorm | — |
| debug | write | analyze | `analysis-diagnose-bug-root-cause` |

### Session Schema (extends ralph)

Ralph session schema 全量字段均适用。CLI 新增字段：

```json
{
  "execution_mode": "cli-delegate",
  "cli_tool": "claude",
  "platform": "codex",
  "steps": [{
    "delegate_exec_id": null,
    "delegate_mode": "write|analysis",
    "delegate_role": "analyze|plan|implement|review|brainstorm",
    "delegate_rule": null,
    "cli_output_summary": null,
    "artifacts_produced": []
  }]
}
```

### Fix-Loop Templates

Same as ralph. All 6 fix-loop templates apply unchanged. Each inserted step is delegated through the same compose → delegate → analyze cycle.

### Error Codes

Ralph E001–E006, W001–W004 all apply. CLI additions:

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E011 | error | Delegate execution failed | Retry once, then BLOCKED |
| E012 | error | CLI tool not enabled | Switch tool or enable |
| E013 | error | ---RESULT--- block not found | Fallback parse, LOW CONFIDENCE |

### Success Criteria

All ralph success criteria apply. Additionally:

- [ ] ralph-cli owns full loop: compose → delegate → STOP → callback → parse → complete → next
- [ ] Delegation prompt 首行为 cli-execute 调用（格式由 cli_tool 决定），后接 `<execution_context>`
- [ ] A_PARSE_RESULT extracts ---RESULT--- block fields
- [ ] Decision evaluation inline (no handoff)
- [ ] S_AMEND_GOAL + A_AMEND_GOAL (5 步, RISK_LEVEL=high 不跳过)
- [ ] `goal_changelog` 写入路径存在
- [ ] `blueprint_id` 支持 `--from blueprint:{BLP_ID}`
- [ ] A_STRUCTURAL_EVALUATE 处理 post-milestone + post-debug-escalate
- [ ] A_ADVANCE_MILESTONE 插入下一里程碑 lifecycle steps
- [ ] A_REGROUND_HALT 漂移熔断（auto_confirm 不跳过）
- [ ] Fix-loop templates（6 套）通过 compose-delegate cycle 执行
- [ ] re-grounding 3-step 插入规则（build rule 5.5）
- [ ] spec-setup 预检（build rule 0.5）
- [ ] `platform: "codex"`, skill discovery via `--platform codex`

</appendix>
</output>
