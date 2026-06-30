---
name: maestro-ralph-agent-execute
description: Agent-native step executor — run skill, drift check, ralph complete, return status
argument-hint: "--session <id>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
---
<purpose>
Agent-native execution wrapper for ralph-agent sessions.

Job: receive session ID → locate pending step → `maestro ralph next` → execute skill inline → extract signals → drift check → `maestro ralph complete`（agent 上报）→ check next → loop or return。

与 ralph-cli-execute 的关键区别：
1. **Agent 上报** — 执行 Agent 内部直接调 `maestro ralph complete`（非编排器解析 `---RESULT---` 后调用）
2. **Step 循环** — 自主循环处理连续的执行 step（如 ralph-execute），遇 decision/完成/失败时返回
3. **Drift 自治** — drift analysis 在执行侧完成，MAJOR_DRIFT 时自行 retry
4. **无 ---RESULT--- 输出** — 通过 `---AGENT-STATUS---` 块向编排器 Agent 返回结构化状态

Session management（创建/修改 session、决策评估、`ralph complete` 外的 status 变更）由编排器 `/maestro-ralph-agent` 负责。
</purpose>

<context>
$ARGUMENTS — `--session <id>` (必须)

**Parse:**
```
--session <id>  → session_id
```

本命令仅 session mode，不支持 direct mode。
</context>

<invariants>
1. **Execute and report** — 执行 step + 调 `ralph complete` 上报，双动作为原子单元
2. **Step loop** — 连续执行 pending 执行 step，直到 decision/完成/失败
3. **Decision 不执行** — 遇到 decision step（`step.decision` 非空）立即返回，由编排器评估
4. **No session management** — 不创建/修改 session 元数据、不评估决策、不插入/删除 step
5. **Drift self-heal** — MAJOR_DRIFT + 未重试 → 自行 `ralph retry` + 重执行
6. **Required reading 由 CLI 负责** — `ralph next` 自动展开 + 加载 `<required_reading>`
7. **CLI 输出禁止截断** — `maestro ralph next` stdout 必须全量捕获
8. **STATUS 枚举受限** — 仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`
9. **Agent status 必输出** — 结束前必须输出 `---AGENT-STATUS---` 块
10. **禁止以上下文消耗为由中断循环** — harness 自动处理 context compression
</invariants>

<state_machine>

<states>
S_LOCATE        — 读 status.json，定位 pending step               PERSIST: —
S_RESOLVE_ARGS  — 解析占位符 + 丰富参数                            PERSIST: step.args (enriched)
S_LOAD_CONTEXT  — 加载前序产出 + 发现                              PERSIST: —
S_EXECUTE       — `ralph next` + 内联执行 skill                    PERSIST: step.status = "running"
S_EXTRACT       — 提取信号 + 组装 completion 参数                   PERSIST: —
S_DRIFT         — 产物 vs 目标偏离分析                              PERSIST: step.drift_score
S_COMPLETE      — 调 `ralph complete` 上报                          PERSIST: step.completion_*
S_HANDLE_FAIL   — 处理执行失败                                      PERSIST: step.status
S_OUTPUT        — 输出 `---AGENT-STATUS---` 块                      PERSIST: —
</states>

<transitions>

S_LOCATE:
  → S_RESOLVE_ARGS WHEN: pending 执行 step found (step.decision == null)
  → S_OUTPUT       WHEN: pending decision step found (step.decision != null)   RESULT=decision_pending
  → S_OUTPUT       WHEN: no pending steps (all completed/skipped)              RESULT=session_complete
  → S_OUTPUT       WHEN: has failed step and no pending                        RESULT=step_failed
  → S_OUTPUT       WHEN: no running session                                    RESULT=step_failed

S_RESOLVE_ARGS:
  → S_LOAD_CONTEXT  DO: A_RESOLVE_ARGS

S_LOAD_CONTEXT:
  → S_EXECUTE       DO: A_LOAD_STEP_CONTEXT

S_EXECUTE:
  → S_EXTRACT     WHEN: exit 0 + execution succeeded                DO: A_EXEC_STEP
  → S_HANDLE_FAIL WHEN: exit 1 (required_reading/schema error)      DO: A_EXEC_STEP
  → S_OUTPUT      WHEN: exit 2 (no pending step)                    DO: RESULT=session_complete
  → S_HANDLE_FAIL WHEN: exit 3 (concurrency conflict)               DO: A_HANDLE_CONCURRENCY

S_EXTRACT:
  → S_DRIFT     DO: A_EXTRACT_SIGNALS

S_DRIFT:
  → S_COMPLETE  WHEN: ALIGNED|MINOR_DRIFT        DO: A_POST_ANALYZE_DRIFT
  → S_EXECUTE   WHEN: MAJOR_DRIFT + not retried  DO: A_POST_ANALYZE_DRIFT (ralph retry + re-execute)
  → S_COMPLETE  WHEN: MAJOR_DRIFT + retried      DO: A_POST_ANALYZE_DRIFT (DONE_WITH_CONCERNS)

S_COMPLETE:
  → S_LOCATE    DO: A_AGENT_COMPLETE (loop to next step)

S_HANDLE_FAIL:
  → S_LOCATE    WHEN: auto + not retried                 DO: A_RETRY (ralph retry N)
  → S_OUTPUT    WHEN: auto + retried                     DO: RESULT=step_failed
  → S_LOCATE    WHEN: interactive + user selects retry   DO: A_RETRY
  → S_LOCATE    WHEN: interactive + user selects skip    DO: A_SKIP_STEP
  → S_OUTPUT    WHEN: interactive + user selects abort   DO: RESULT=step_failed

S_OUTPUT:
  → END         DO: A_OUTPUT_STATUS

</transitions>

<actions>

### A_RESOLVE_ARGS

在 `ralph next` 之前解析占位符、注入 artifact 引用、丰富 skill args。

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
  → 传递给 A_EXEC_STEP 用于 goal context pre-injection
```

**5. Write** enriched args + source_artifact_ref back to status.json.

### A_LOAD_STEP_CONTEXT

加载前序产出和发现，为 inline execution 注入上下文。

1. **Previous step output** — 读前一 completed step 的 `completion_summary` + `completion_caveats` + `completion_decisions` + `completion_deferred`
2. **Artifacts** — 按 `session.context` 中的路径逐个 Read，提取与当前 step 相关的内容：

   | 当前 stage | 加载什么 | Source |
   |-----------|---------|--------|
   | plan | analysis conclusions + scope_verdict | `{context.analysis_dir}/conclusions.json` |
   | execute | task list + wave assignments | `{context.plan_dir}/TASK-*.json` |
   | review | changed files + verification results | `{context.scratch_dir}/verification.json` |
   | test | review findings | `review.json` |
   | debug | error traces + failing test details | 前一 step 的 `completion_evidence` |
   | brainstorm | grill report | `{context.grill_id}` report |

3. **Explore if needed** — 产物指向代码位置但缺少上下文 → `maestro explore` 补充（仅 execute/debug/test 且有文件路径引用时）
4. **Accumulated signals** — 遍历 ALL completed steps → 聚合 caveats + deferred

加载的内容进入会话上下文，后续 inline execution 自动受益。

### A_EXEC_STEP

1. Read status.json → 确认 session running，定位 pending 执行 step
2. **Load** — `Bash("maestro ralph next --session {session_id}")`
   - **全量捕获 stdout，严禁截断管道**
   - Exit 0 → 按 stdout 内联执行
   - Exit 1 → set `failure_reason`，转 S_HANDLE_FAIL
   - Exit 2 → RESULT=session_complete，skip to S_OUTPUT
   - Exit 3 → A_HANDLE_CONCURRENCY
3. **Goal context pre-injection:**
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
4. **Deferred reading**: `ralph next` 将 `<deferred_reading>` 路径记录到 `step.load.deferred_files`，执行阶段按需 Read
5. **Inline execution** — 按 stdout 内容执行 skill 逻辑
6. Track: note start time, watch for errors

### A_EXTRACT_SIGNALS

执行完成后，提取结构化信号用于 completion 参数组装。

**Stage-specific extraction:**

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

**Artifact scanning** — Use Glob 查找执行期间新增/修改的产物:

| Pattern | Signal |
|---------|--------|
| `conclusions.json` | `analysis_dir` |
| `TASK-*.json` | `plan_dir` |
| `verification.json` | `scratch_dir` |
| `review.json` | review stage |
| `test-results.json`, `uat.md` | test stage |
| `grill-report.md` | `grill_id` |
| `.brainstorming/*` | `brainstorm_dir` |

**Output text signal extraction** — 从 skill 执行输出文本中提取：

| Signal pattern | 写入 |
|----------------|------|
| `ANL-xxx` (artifact ID) | `session.analyze_macro_id` |
| `PLN-xxx` (artifact ID) | `context.plan_dir` |
| `BLP-xxx` (artifact ID) | `session.blueprint_id` |
| `scratch_dir:` 或 `.workflow/scratch/` 路径 | `context.scratch_dir` |
| `plan_dir:` 路径 | `context.plan_dir` |
| `PHASE: N` | `session.context.phase` |

**STATUS determination:**

| 条件 | STATUS |
|------|--------|
| Skill 正常完成 + 有产物 | `DONE` |
| 完成但有 warnings/concerns（review verdict partial, test 部分失败等） | `DONE_WITH_CONCERNS` |
| 执行出错但可重试（临时错误、网络问题、外部依赖不可用） | `NEEDS_RETRY` |
| 执行出错且无法重试（schema 错误、required_reading 缺失、command_path 不可达） | `BLOCKED` |

**Compose completion params:**

| Param | 规则 | 组装方法 |
|-------|------|---------|
| `--summary` | MUST。动词开头，≤100 字 | `"<动词><做了什么>，<量化结果>"` e.g. `"分析认证模块依赖图，发现 5 处 JWT 内联验证，scope=medium"` |
| `--decisions` | SHOULD。每条一个架构/技术决策 | 从执行中做出的非显而易见的选择。e.g. `"选择中间件模式而非装饰器"` |
| `--caveats` | SHOULD。后续 step 须知 | 发现但不属于本步解决的问题。e.g. `"session 存储层与 JWT 有隐式耦合"` |
| `--deferred` | SHOULD。推迟工作项 | 被主动推迟的项。e.g. `"性能基准测试留到 review 后"` |
| `--evidence` | SHOULD。验证产物路径 | 指向验证结果文件。e.g. `"verification.json"` |
| `--concerns` | COND。仅 DONE_WITH_CONCERNS 时 | CAVEATS 内容同时映射为 --concerns |

### A_POST_ANALYZE_DRIFT

产物 vs 目标偏离分析。A_EXTRACT_SIGNALS 后、A_AGENT_COMPLETE 前执行。

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
| ALIGNED | 正常进入 S_COMPLETE |
| MINOR_DRIFT | 偏离项追加到 caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | `Bash("maestro ralph retry {index}")` → 回到 S_EXECUTE 重执行（drift_correction 作修正上下文注入 prompt） |
| MAJOR_DRIFT + 已重试 | 以 DONE_WITH_CONCERNS complete |

**4. 写入:** `step.drift_score`, `step.drift_correction`

### A_AGENT_COMPLETE

Agent 上报：执行 Agent 直接调 CLI 完成 step。

1. 使用 A_EXTRACT_SIGNALS 组装的参数调用 `ralph complete`:
   ```
   # DONE
   Bash("maestro ralph complete {index} --status DONE --summary \"{SUMMARY}\" [--evidence ...] [--decisions ...] [--caveats ...] [--deferred ...]")

   # DONE_WITH_CONCERNS — caveats 同时映射 --concerns
   Bash("maestro ralph complete {index} --status DONE_WITH_CONCERNS --summary \"{SUMMARY}\" --concerns \"{CAVEATS}\" [--evidence ...] [--decisions ...] [--caveats ...] [--deferred ...]")

   # NEEDS_RETRY
   Bash("maestro ralph retry {index}")

   # BLOCKED
   Bash("maestro ralph complete {index} --status BLOCKED --reason \"{failure_reason}\"")
   ```
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
4. **Increment** `completed_count` (for `---AGENT-STATUS---` reporting)
5. Loop back to S_LOCATE

### A_HANDLE_CONCURRENCY

Exit code 3 — `active_step_index` 被占用。

1. Display: `[{index}] ⚠ Concurrency conflict`
2. Wait 3 seconds, re-read status.json
3. Cleared → S_LOCATE (retry)
4. Still held after 2 attempts → `Bash("maestro ralph complete {index} --status BLOCKED --reason \"concurrency conflict unresolved\"")`, RESULT=step_failed

### A_RETRY

1. `Bash("maestro ralph retry {index}")` — CLI 设 `step.retried = true`, `step.status = "pending"`, 清 `active_step_index`
2. Display: `[{index}/{total}] ↻ {step.skill} retry`
3. Loop back to S_LOCATE

### A_SKIP_STEP

手动编辑 status.json：将 step `status` 设为 `"skipped"`，`completion_confirmed` 设为 `false`，清 `active_step_index`（若指向此 step）。

### A_OUTPUT_STATUS

输出 `---AGENT-STATUS---` 块并结束。

```
---AGENT-STATUS---
RESULT: decision_pending|session_complete|step_failed|steps_completed
LAST_STEP_INDEX: {last processed step index}
DECISION_NODE: {gate name, 仅 decision_pending 时}
COMPLETED_STEPS: {completed_count}
FAILURE_REASON: {仅 step_failed 时}
---END---
```

**RESULT 值语义:**

| RESULT | 含义 | 编排器动作 |
|--------|------|-----------|
| `decision_pending` | 下一个 step 是 decision 节点 | S_DECISION_EVAL |
| `session_complete` | 所有 step 已完成 | S_SESSION_DONE |
| `step_failed` | 执行失败 | S_HANDLE_FAIL |
| `steps_completed` | 完成了 N 个 step（兜底） | re-read status.json |

</actions>

</state_machine>

<appendix>

### 与 ralph-execute / ralph-cli-execute 对照

| 维度 | ralph-execute | ralph-cli-execute | ralph-agent-execute |
|------|---------------|-------------------|---------------------|
| 加载方式 | Skill() 自调用 | delegate CLI 加载 | Agent 内 Skill() 加载 |
| Step 循环 | 自调用链 | 单 step（编排器循环） | 内部循环（无自调用） |
| 完成上报 | `ralph complete` (自身调) | `---RESULT---` 输出（编排器调 complete） | `ralph complete` (自身调，agent 上报) |
| Decision 处理 | handoff Skill("maestro-ralph") | 不处理（无 decision step） | 不执行，返回编排器 |
| Drift 分析 | A_POST_ANALYZE_DRIFT (自身) | 无（编排器做） | A_POST_ANALYZE_DRIFT (自身) |
| 结果通信 | session 上下文传递 | `---RESULT---` stdout | `---AGENT-STATUS---` 块 |

### Arg Resolution

详见 action A_RESOLVE_ARGS（placeholder substitution、per-skill enrichment、--from auto-injection、goal context injection 完整规则均已内联于 action 中）。

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E006 | error | command_path 缺失/不可达 | RESULT=step_failed |
| E007 | error | required_reading 引用文件缺失 | RESULT=step_failed |
| E008 | error | active_step_index 与 complete idx 不匹配 | RESULT=step_failed |
| E009 | error | step.status ≠ running（重复 complete 或非法跳跃） | RESULT=step_failed |
| E010 | error | status.json schema 损坏 | RESULT=step_failed |
| W001 | warning | Step completed with concerns | STATUS=DONE_WITH_CONCERNS |
| W005 | warning | active_step_index 指向已 completed step | `ralph next` 自动清理后继续 |
| W007 | warning | step.skill ≠ command .md frontmatter.name | 提示但不阻塞 |
| — | info | exit 2 — 无 pending step | RESULT=session_complete |
| — | error | exit 3 — 并发冲突 | A_HANDLE_CONCURRENCY |

### Success Criteria

- [ ] 仅 session mode（`--session <id>`），不支持 direct mode
- [ ] `maestro ralph next --session {id}` 全量捕获 stdout，禁止截断
- [ ] Exit codes 完整处理：0→执行，1→S_HANDLE_FAIL，2→session_complete，3→A_HANDLE_CONCURRENCY
- [ ] Step 循环：连续执行 pending 执行 step，遇 decision/完成/失败时停止
- [ ] Decision step 不执行——返回 `decision_pending` + gate 名
- [ ] Agent 上报：执行 Agent 内部调 `maestro ralph complete` 更新 session 状态
- [ ] `--summary` 在 DONE/DONE_WITH_CONCERNS 时为 MUST（动词开头，≤100 字）
- [ ] DONE_WITH_CONCERNS 时 CAVEATS 同时映射 `--concerns` 参数
- [ ] Context signals 写入 status.json.context（analysis_dir/plan_dir/scratch_dir 等）
- [ ] Output text signal extraction：从执行输出中提取 ANL-xxx/PLN-xxx/BLP-xxx/PHASE:N 等信号
- [ ] Drift analysis：ALIGNED/MINOR_DRIFT → complete；MAJOR_DRIFT+未重试 → retry+重执行；MAJOR_DRIFT+已重试 → DONE_WITH_CONCERNS
- [ ] `---AGENT-STATUS---` 块始终输出（RESULT/LAST_STEP_INDEX/DECISION_NODE/COMPLETED_STEPS/FAILURE_REASON）
- [ ] S_RESOLVE_ARGS：placeholder substitution 完整（含 {description}/{milestone_num}）
- [ ] Per-skill enrichment：8 个 skill 的 context 注入规则
- [ ] --from auto-injection：plan → analyze artifact，execute → plan artifact，含 state.json.artifacts 查询伪代码
- [ ] Goal context pre-injection：version >= 2 skip，< 2 注入 `<goal_context>` XML block
- [ ] S_LOAD_CONTEXT：前序 step output + stage-specific artifacts + explore + accumulated signals
- [ ] S_HANDLE_FAIL：auto+未重试→retry，auto+已重试→step_failed，interactive→retry/skip/abort
- [ ] A_SKIP_STEP：编辑 status.json 将 step 标为 skipped
- [ ] S_LOCATE 判断 session_complete 时校验无 pending 且无 failed（非仅 pending=0）
- [ ] Artifact scanning 含 `.brainstorming/*` pattern
- [ ] STATUS determination 4 路判定规则（DONE/DONE_WITH_CONCERNS/NEEDS_RETRY/BLOCKED）
- [ ] 不创建/修改 session 元数据、不评估决策、不插入/删除 step
- [ ] 禁止以上下文消耗为由中断循环

</appendix>
</output>
