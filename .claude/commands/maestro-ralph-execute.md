---
name: maestro-ralph-execute
description: Execute next pending step in ralph session
internal: true
argument-hint: "[-y] [session-id]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<purpose>
Single-step executor for ralph (adaptive) and maestro (static) sessions.
Each invocation: locate session → find next step → resolve args → execute → update → self-invoke next.

Mutual invocation with `/maestro-ralph` forms a self-perpetuating work loop.
Session: `.workflow/sessions/{id}/session.json` (engine=ralph) + `ralph-meta.json`
</purpose>

<context>
$ARGUMENTS — optional `-y` flag + optional session ID.

**Parse:**
```
-y / --yes → auto = true
Remaining  → session_id (if matches maestro-* or ralph-*)
```
Also read `session.orchestration.auto_mode` from session.json — if true, treat as `-y`.

**Step kinds:**

| Kind | Identifier | Execution | Flow after |
|------|-----------|-----------|------------|
| decision step | `step.decision` 非空 | `[@skill] Skill("maestro-ralph")` | Execution ends here |
| 执行 step | `step.decision == null` | `Bash("maestro ralph next")` → 内联按其 stdout 执行 → `Bash("maestro ralph complete N --status ...")` | Self-invoke next |

HARD RULES:
- 执行 step：**统一通过 `maestro ralph next` CLI 加载**。CLI 通过 `resolveStepContent()` 加载内容、创建标准 Run、更新 chain step 状态为 running。不要在会话里手动 Read + 解析文件
- decision step：A_EXEC_DECISION 通过 `[@skill] Skill({ skill: "maestro-ralph" })` handoff 给 ralph 评估（不走 CLI）
- step command 由 ralph 在 A_BUILD_STEPS 写入 session.orchestration.chain[]（缺失内容 → ralph next 返回错误并拒绝执行）
- 每个 step 结束必须调用 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`。STATUS 仅 4 个合法值：`DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`（**`NEEDS_CONTEXT` 已废除**，context 容量由 harness 自动压缩处理）
</context>

<invariants>
1. **执行 = `ralph next` + inline + `ralph complete`** — 调 `maestro ralph next` 拿到 skill 内容，按 stdout 内联执行
2. **Content loading by CLI** — `ralph next` resolves step content via `resolveStepContent()`, creates a standard Run, outputs the prompt. Missing content → exit code 1
3. **Deferred reading recorded only** — deferred paths recorded in ralph-meta, executed on demand
4. **一致性取代锁** — 同一 session 同时最多一个 chain step 为 `running`；CLI 校验失败直接退出码 3，不静默推进
5. **Completion 通过 CLI 调用** — 每个 step 末尾调 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`，由 CLI 更新 chain status + ralph-meta
6. **Self-invocation chain** — 持续直到全部 chain steps completed 或 session paused
7. **session.json + ralph-meta.json 每步骤后由 CLI 原子写盘** — resume-safe
8. **STATUS 枚举受限** — 仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`；`NEEDS_CONTEXT` 已废除
9. **CLI 输出禁止截断** — `maestro ralph next` 的 stdout 包含完整 skill prompt，必须全量捕获。**严禁** `| head`、`| tail`、`2>&1 | head -N` 等任何截断管道。Bash timeout 可加长但不可截断输出
10. **禁止以上下文消耗为由中断自调用链** — harness 自动处理 context compression（消息摘要），模型无需判断上下文剩余空间。自调用链的唯一合法终止条件是：全部 `completion_confirmed`、session paused、或 decision handoff 到 ralph。以"上下文不足"、"已连续完成 N 个 step"、"避免 context overflow"等理由中断属于 invariant violation
</invariants>

<state_machine>

<states>
S_LOCATE        — 定位 session + 找下一个 pending step   PERSIST: —
S_RESOLVE_ARGS  — 解析占位符 + 丰富参数                  PERSIST: step.args (enriched)
S_LOAD_CONTEXT  — 加载前序产出 + 发现                    PERSIST: —
S_EXECUTE       — 执行当前 step                          PERSIST: step.status = "running", session.current_step
S_POST_ANALYZE  — 产物 vs 目标偏离分析                    PERSIST: step.drift_score, step.drift_correction
S_POST_EXEC     — 标记完成 + 传播上下文                   PERSIST: step.completion_*, step.status, session.context
S_HANDLE_FAIL   — 处理失败                               PERSIST: step.status, session.status
S_COMPLETE      — 所有 step 完成                         PERSIST: session.status = "completed"
S_FALLBACK      — 无 session 可执行                      PERSIST: —
</states>

<transitions>

S_LOCATE:
  → S_RESOLVE_ARGS  WHEN: pending step found                DO: A_LOCATE_SESSION
  → S_COMPLETE      WHEN: no pending steps
  → S_FALLBACK      WHEN: no running session

S_RESOLVE_ARGS:
  → S_LOAD_CONTEXT  DO: A_RESOLVE_ARGS

S_LOAD_CONTEXT:
  → S_EXECUTE       DO: A_LOAD_STEP_CONTEXT

S_EXECUTE:
  → END             WHEN: step.decision != null              DO: A_EXEC_DECISION
  → S_POST_ANALYZE  WHEN: step.decision == null + execution succeeded (DONE|DONE_WITH_CONCERNS)  DO: A_EXEC_STEP
  → S_HANDLE_FAIL   WHEN: step.decision == null + ralph next exit=1 OR ralph complete with NEEDS_RETRY|BLOCKED  DO: A_EXEC_STEP
  → S_HANDLE_FAIL   WHEN: step.decision == null + ralph next exit=3 (concurrency conflict)  DO: A_HANDLE_CONCURRENCY

S_POST_ANALYZE:
  → S_POST_EXEC     WHEN: drift_score == ALIGNED|MINOR_DRIFT   DO: A_POST_ANALYZE_DRIFT
  → S_EXECUTE       WHEN: drift_score == MAJOR_DRIFT + not retried  DO: A_POST_ANALYZE_DRIFT (re-execute with correction)
  → S_POST_EXEC     WHEN: drift_score == MAJOR_DRIFT + retried     DO: A_POST_ANALYZE_DRIFT (proceed with caveats)

S_POST_EXEC:
  → S_LOCATE        DO: Bash("maestro ralph complete ...") + [@skill] Skill("maestro-ralph-execute")
                     NOTE: CLI 已写完 chain step status + ralph-meta completion details；无需额外写盘

S_HANDLE_FAIL:
  → S_LOCATE        WHEN: exit code 3 (concurrency conflict)  DO: A_HANDLE_CONCURRENCY (wait 3s + retry)
  → S_LOCATE        WHEN: auto + not retried               DO: A_RETRY
  → END             WHEN: auto + retried                    DO: A_PAUSE_SESSION
  → S_LOCATE        WHEN: interactive + user selects retry  DO: A_RETRY
  → S_LOCATE        WHEN: interactive + user selects skip   DO: A_SKIP_STEP
  → END             WHEN: interactive + user selects abort  DO: A_PAUSE_SESSION

S_COMPLETE:
  → END             DO: A_COMPLETE_SESSION

S_FALLBACK:
  → END             DO: display "无运行中的会话。使用 /maestro 或 /maestro-ralph 创建。"

</transitions>

<actions>

### A_LOCATE_SESSION

1. If session_id provided → load `.workflow/sessions/{session_id}/session.json`
2. Else: scan `.workflow/sessions/*/session.json`, filter `orchestration.engine == "ralph"` AND `status == "running"`, sort by mtime DESC, take first
3. Extract: session_id, orchestration.chain[], ralph-meta (phase, milestone, intent, auto_mode, context)
4. **不在此处选 pending step**——pending 选择由 `maestro ralph next` CLI 内部完成；A_LOCATE_SESSION 只确认 session 存在且 running，由 A_EXEC_STEP 调 CLI 推进

### A_RESOLVE_ARGS

**Placeholder substitution:**

| Placeholder | Source |
|-------------|--------|
| `{phase}` | session.phase |
| `{milestone}` | session.milestone |
| `{intent}` | session.intent |
| `{description}` | session.intent (alias) |
| `{run_dir}` | session.context.run_dir or latest artifact path |
| `{plan_dir}` | session.context.plan_dir |
| `{analysis_dir}` | session.context.analysis_dir |
| `{issue_id}` | session.context.issue_id |
| `{milestone_num}` | session.context.milestone_num |

**Per-skill enrichment** (when args empty or minimal):

| Step | Required context | Source |
|-------|-----------------|--------|
| brainstorm | topic | `"{intent}"` |
| roadmap | description | `"{intent}"` |
| analyze | phase or topic | `{phase}` or `"{intent}"` |
| plan | phase, --from, or --dir | see --from auto-injection below |
| execute | phase or --dir | see --from auto-injection below |
| debug | gap context | Read previous step's error/gap |
| review/test/auto-test | phase | `{phase}` |

**--from auto-injection (phase-level artifact chaining):**

Phase-level steps 在 build 阶段无法预知前序 artifact ID。A_RESOLVE_ARGS 运行时从 state.json 查找并注入显式引用，打通 analyze→plan→execute 数据管道：

```
Read state.json.artifacts（含 milestone_history 内归档 artifacts）
→ filter by milestone={session.milestone} + phase={session.phase} + status=="completed"

plan step（含 {phase} 占位符，args 无 --from 且无 --dir）:
  1. 查同 phase+milestone 最新 completed type=="analyze" artifact → id = ANL-xxx
  2. 命中 → args 追加 --from analyze:{id}
  3. 写 step.source_artifact_ref = "analyze:{id}"

execute step（含 {phase} 占位符，args 无 --dir）:
  1. 查同 phase+milestone 最新 completed type=="plan" artifact → id = PLN-xxx, path = scratch/...
  2. 命中 → args 追加 --dir {run_dir}/outputs/{path}
  3. 写 step.source_artifact_ref = "plan:{id}"
```

兜底：查询无结果 → 不注入，由命令自身 discovery 逻辑处理。已有 `--from` 或 `--dir` 的 step 不覆盖。

**Goal context injection:**

当 step.goal_ref 非空且 session.task_decomposition 存在时：
```
goal = session.task_decomposition.find(g => g.id == step.goal_ref)
if goal:
  goal_snippet = { id: goal.id, goal: goal.goal, done_when: goal.done_when,
                   boundary: goal.boundary, evidence: goal.evidence }
  → 传递给 A_EXEC_STEP 用于 inline execution 前注入（见 step 2 goal context pre-injection）
```

Write enriched args + source_artifact_ref back to ralph-meta.json.

### A_LOAD_STEP_CONTEXT

加载前序产出和发现，为 inline execution 注入上下文。

1. **Previous step output** — 读前一 completed step 的 `completion_summary` + `completion_caveats` + `completion_decisions` + `completion_deferred`
2. **Artifacts** — 按 `session.context` 中的路径逐个 Read，提取与当前 step 相关的内容：

   | 当前 stage | 加载什么 | Source |
   |-----------|---------|--------|
   | plan | analysis conclusions + scope_verdict | `{context.analysis_dir}/conclusions.json` |
   | execute | task list + wave assignments | `{context.plan_dir}/TASK-*.json` |
   | review | changed files + verification results | `{context.run_dir}/verification.json` |
   | test | review findings | `review.json` |
   | debug | error traces + failing test details | 前一 step 的 `completion_evidence` |
   | brainstorm | grill report | `{context.grill_id}` report |

3. **Explore if needed** — 产物指向代码位置但缺少上下文 → `maestro explore` 补充（仅 execute/debug/test 且有文件路径引用时）
4. **Accumulated signals** — 遍历 ALL completed steps → 聚合 caveats + deferred

加载的内容进入会话上下文，后续 inline execution 自动受益。

### A_EXEC_DECISION

1. Mark step running, write session state
2. Display: `[{index}/{total}] ◆ {step.decision} Retry: {retry}/{max}`
3. `[@skill] Skill({ skill: "maestro-ralph" })` — ralph 评估 + handoff
4. 执行在此结束

### A_EXEC_STEP

1. **Load** — `Bash("maestro ralph next --session <session_id>")` — **必须全量捕获 stdout，严禁 `| head`/`| tail` 等截断管道**（stdout 含完整 skill prompt，截断会导致执行内容不完整）
   - 退出码 0 → 按 stdout 内联执行
   - 退出码 2 → 交给 S_LOCATE
   - 退出码 3 → 已有 step 在 running（并发冲突）
   - 退出码 1 → pause session
2. **Goal context pre-injection**:
   - GUARD: `ralph_protocol_version >= "2"` → skip（session_anchor 已含 goal context）
   - WHEN `ralph_protocol_version < "2"` 或缺失 AND `step.goal_ref` 非空 → 在 stdout 顶部前置：
   ```
   <goal_context>
   Sub-goal: {goal.id} — {goal.goal}
   Done when: {goal.done_when}
   Boundary: {goal.boundary}
   Evidence target: {goal.evidence}
   Execution criteria: {session.execution_criteria joined by '; '}
   </goal_context>
   ```
3. **Inline execution** — 按 stdout 执行；deferred_reading 按需 Read
4. **Extract step signals** (A_EXTRACT_STEP_SIGNALS) — 执行完成后、调 ralph complete 前，提取结构化信号用于组装 completion 参数和下一步上下文：

   **4a. Stage-specific signal extraction:**

   | Stage | 提取什么 | 写入字段 |
   |-------|---------|---------|
   | analyze | `conclusions.json` 的 scope_verdict + key_findings; 依赖图摘要 | `--summary`, `--decisions`, context.analysis_dir |
   | plan | 生成的 TASK-*.json 数量 + 主要模块; 波次划分 | `--summary`, context.plan_dir |
   | execute | 修改的文件列表; verification.json passed/failed; 新 artifact ID | `--summary`, `--evidence`, context.run_dir |
   | review | review.json verdict + findings 数量 + severity 分布 | `--summary`, `--decisions` |
   | test | test-results.json pass/fail 统计; uat.md 结果 | `--summary`, `--evidence` |
   | debug | root cause 描述; 修复了什么 | `--summary`, `--decisions` |
   | grill | grill-report.md 核心质疑点; 术语表 | `--summary`, `--caveats`, context.grill_id |
   | brainstorm | 候选方案数量 + 推荐方案 | `--summary`, `--decisions`, context.brainstorm_dir |

   **4b. Compose completion params:**

   | Param | 规则 | 组装方法 |
   |-------|------|---------|
   | `--summary` | MUST。动词开头，≤100 字。从 4a 提取的关键产出组合 | `"<动词><做了什么>，<量化结果>"` e.g. `"分析认证模块依赖图，发现 5 处 JWT 内联验证，scope=medium"` |
   | `--decisions` | SHOULD。每条一个架构/技术决策（可多次 `--decisions`） | 从执行过程中做出的非显而易见的选择提取。e.g. `"选择中间件模式而非装饰器"` `"跳过 session 层重构，留给 G2"` |
   | `--caveats` | SHOULD。后续 step 必须知道的约束/风险 | 从执行中发现但不属于本步解决的问题。e.g. `"session 存储层与 JWT 有隐式耦合，execute 阶段需处理"` |
   | `--deferred` | SHOULD。明确推迟到后续的工作（可多次 `--deferred`） | 被主动推迟的项。e.g. `"性能基准测试留到 review 后"` `"错误码国际化不在 scope 内"` |

   **4c. Context-to-next-step propagation checklist:**

   | 信号 | 检查 | 传播到 |
   |------|------|--------|
   | PHASE 变更 | 输出含 `PHASE: N` | `session.context.phase` |
   | Artifact ID | 输出含 `ANL-xxx`/`PLN-xxx`/`BLP-xxx` | `session.analyze_macro_id`/`context.plan_dir` 等 |
   | Run output directory | 输出含 `run_dir:` 或 `{run_dir}/outputs/` 路径 | `session.context.run_dir` |
   | Plan dir | plan step 产出目录 | `session.context.plan_dir` |
   | Grill ID | grill step 产出 ID | `session.context.grill_id` |
   | Blueprint ID | blueprint step 产出 `BLP-xxx` | `session.blueprint_id` |

   这些信号直接写入 `ralph-meta.json context`，下一步的 session_anchor 自动携带。

5. **Complete** — 使用 4b 组装的参数调用：
   - `Bash("maestro ralph complete N --status DONE --summary \"...\" [--evidence <path>] [--decisions \"...\"] [--caveats \"...\"] [--deferred \"...\"]")`
   - `Bash("maestro ralph complete N --status DONE_WITH_CONCERNS --summary \"...\" --concerns \"...\"")`
   - `Bash("maestro ralph retry N")`
   - `Bash("maestro ralph complete N --status BLOCKED --reason \"...\"")`

6. **Propagate context signals** — 按 4c checklist 将关键信号写入 `ralph-meta.json context`

完成后 S_LOCATE 触发 `[@skill] Skill({ skill: "maestro-ralph-execute" })` 自调用。

### A_POST_ANALYZE_DRIFT

执行完成后、调 ralph complete 前，分析产物与目标的偏离程度并自动修正。

**1. 收集对照基准:**

| 基准来源 | 取值 |
|---------|------|
| `step.goal_ref` → goal.done_when | 子目标的完成条件 |
| `session.boundary_contract.definition_of_done` | 全局验收标准 |
| `session.execution_criteria` | 执行准则 |
| `session.intent` | 原始意图 |

**2. 读产物摘要:**

从 A_EXTRACT_STEP_SIGNALS (step 4a) 已提取的 summary + decisions + artifacts 构建产物画像。

**3. 对比评分:**

| 维度 | 检查 |
|------|------|
| 覆盖度 | 产物是否覆盖了 goal.done_when 的每个条件 |
| 方向性 | decisions 是否与 intent 和 boundary 一致 |
| 完整性 | 预期产物类型是否齐全（如 plan 阶段应有 TASK-*.json） |

**drift_score:**
- `ALIGNED` — 全部维度通过
- `MINOR_DRIFT` — 覆盖度/完整性有小缺口，不影响后续
- `MAJOR_DRIFT` — 方向性偏离或关键产物缺失

**4. 修正动作:**

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常进入 S_POST_EXEC |
| MINOR_DRIFT | 将偏离项追加到 completion_caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | 将偏离分析写入 `step.drift_correction`，回到 S_EXECUTE 重跑（A_LOAD_STEP_CONTEXT 自动加载 drift_correction 作为修正上下文） |
| MAJOR_DRIFT + 已重试 | 将偏离项写入 caveats + concerns，以 DONE_WITH_CONCERNS complete，由后续 decision node 裁决 |

**5. 写入:**
- `step.drift_score` — ALIGNED / MINOR_DRIFT / MAJOR_DRIFT
- `step.drift_correction` — MAJOR_DRIFT 时的偏离描述 + 修正指引（供重跑时注入）

### A_HANDLE_CONCURRENCY

Exit code 3 — another step already running (concurrency conflict).

1. Display: `[{index}] ⚠ Concurrency conflict — another step is running`
2. Wait 3 seconds, then re-read session to check if the running step has completed
3. If cleared → return to S_LOCATE (retry the step)
4. If still held after 2 attempts → A_PAUSE_SESSION with reason "concurrency conflict unresolved — another process may be holding the lock"

### A_RETRY

1. `Bash("maestro ralph retry N")` — CLI 将 chain step 重设为 pending，记录 retry_count
2. Display: `[{index}/{total}] ↻ {step.skill} retry`

### A_SKIP_STEP

跳过执行 step — 手动编辑 `session.json` 中 `orchestration.chain[N].status` 设为 `"skipped"`。
（不提供 CLI 子命令；跳过是非常规操作，避免自动化误用。）

### A_PAUSE_SESSION

通常由 `ralph complete N --status BLOCKED --reason "..."` 触发，CLI 已写 `session.status = "paused"`。手动 pause 场景下直接编辑 session.json。
Display: `[{index}/{total}] ✗ {step.skill} 失败，会话已暂停。/maestro-ralph continue 恢复。`

### A_COMPLETE_SESSION

1. 校验：所有 step `completion_confirmed == true`（除 skipped）；task_decomposition 存在时校验 `task_decomposition_all_done == true`
2. 任一校验失败 → 不标 completed，回 S_LOCATE 或 pause
3. `session.status = "completed"`, write session state
4. Display completion report:
   ```
   ============================================================
     SESSION COMPLETE
   ============================================================
     Session:  {session_id} [{source}]
     Steps:    {completed}/{total}   confirmed: {confirmed}/{completed}

     [✓] 0.   plan 1                   [global]
     [✓] 1.   execute 1                [project]
     [✓] 2. ◆ post-execute               [decision]
     ...
   ============================================================
   ```
   Icons: `✓` confirmed, `—` skipped, `✗` failed, `◆` decision

</actions>

</state_machine>

<appendix>

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running session found | Suggest /maestro or /maestro-ralph |
| E006 | error | command_path missing/unreachable for 执行 step | `ralph next` 拒绝；编辑 session.json 或重 build |
| E007 | error | required_reading 引用文件缺失 | `ralph next` 拒绝；CLI stderr 列出缺失路径 |
| E008 | error | `ralph complete` idx does not match running step | 编辑 session.json 修正一致性 |
| E009 | error | `ralph complete` step.status ≠ running | 重复 complete 或非法跳跃；编辑 session.json |
| E010 | error | session state schema 损坏 | `ralph check` 显示具体损坏字段 |
| W001 | warning | Step completed with concerns | Log and continue |
| W005 | warning | running step already completed | `ralph next` 跳过并继续 |
| W007 | warning | step.skill ≠ command .md frontmatter.name | 提示但不阻塞 |

### Success Criteria

- [ ] Session discovery covers engine=ralph sessions in `.workflow/sessions/`
- [ ] `-y` parsed from args 或 session.auto_mode；auto=true 时透传 `-y` 到 skill args
- [ ] Placeholders resolved；per-skill enrichment 正确
- [ ] Decision 节点（`step.decision != null`）走 [@skill] Skill("maestro-ralph") handoff（**不调 ralph next CLI**）
- [ ] 执行 step 通过 `Bash("maestro ralph next")` 加载；CLI 返回拼好的 prompt + completion 协议
- [ ] required_reading 由 CLI 自动加载并拼入 prompt；缺失 → CLI 退出码 1，pause session
- [ ] `<deferred_reading>` 由 CLI 记录到 `step.load.deferred_files`，执行阶段按需 Read
- [ ] 每个 step 末尾必须调 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`
- [ ] STATUS 枚举仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`；CLI 拒绝 `NEEDS_CONTEXT`
- [ ] chain step status 一致性由 CLI 维护；E008/E009 直接退出，不静默推进
- [ ] step.completion_evidence 通过 `--evidence` 传入并记录
- [ ] Context signals 由执行 step 显式写回 ralph-meta.json context（非 ralph-execute 内嵌扫描）
- [ ] Auto mode: retry 一次后 pause；interactive 提供 retry/skip/abort
- [ ] 自调用持续到全部 completion_confirmed 或 paused
- [ ] --from auto-injection：phase-level plan step 运行时从 state.json 查找同 phase+milestone 最新 completed analyze artifact → 注入 `--from analyze:{id}`，写 `source_artifact_ref`
- [ ] --from auto-injection：phase-level execute step 运行时查找同 phase+milestone 最新 completed plan artifact → 注入 `--dir`，写 `source_artifact_ref`
- [ ] Goal context injection：`ralph_protocol_version < "2"` → 前置 `<goal_context>` block；`>= "2"` → skip（session_anchor 覆盖）
- [ ] Goal context 包含 sub-goal description、done_when、boundary、evidence、execution_criteria
- [ ] 已有 `--from` 或 `--dir` 的 step 不被 auto-injection 覆盖
- [ ] `--summary` 在 DONE/DONE_WITH_CONCERNS 时为 MUST（动词开头，≤100 字）
- [ ] `--decisions`/`--caveats`/`--deferred` 为 SHOULD；存在关键决策/注意事项/推迟工作时填写
- [ ] 结构化总结由 CLI 写入 session state，session_anchor 自动聚合注入下游 step

</appendix>
