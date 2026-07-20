<!-- session-mode: none -->
# SKILL.md Authoring Standard

## 1. Architecture: Hybrid State Machine

采用"骨架状态机 + 肉身散文"的混合架构。顶层用显式状态转移定义控制流，ACTIONS 内部用结构化散文指导具体操作。

### File Structure

```
---
frontmatter (name, description, argument-hint, allowed-tools, session-mode)
---

<required_reading>  <!-- session-mode: run MUST reference @~/.maestro/workflows/run-mode.md -->
<purpose>           <!-- 1-5 行：目标 + 拓扑图 + 入口点 -->
<context>           <!-- 用法示例、flag 说明 -->
<invariants>        <!-- 全局底线规则，独立于状态转移 -->

<state_machine>
  <states>          <!-- 显式声明所有状态节点 -->
  <transitions>     <!-- 每个状态的转移规则 -->
  <actions>         <!-- 具体操作逻辑，结构化散文 -->
</state_machine>

<appendix>          <!-- 查阅型内容：schema、error codes、examples、success criteria -->
```

### Why Hybrid

- **纯状态机**（6.5/10）：过度缩写导致 LLM 卡死或幻觉操作，丢失执行语境
- **纯散文**（5/10）：LLM 需"阅读理解"提取转移条件，注意力分散，上下文寻址迷失
- **混合**（8.5/10）：状态机路由 + 散文动作，兼顾确定性和可理解性

### Session/Run 分类

每个 `SKILL.md` 必须在 frontmatter 声明 `session-mode: run|none`：

- `run`：技能产生正式交付物或需要恢复。入口必须调用 `maestro run create <skill>`，正式产物写入 `outputs/`，证据写入 `evidence/`，最终报告写入 `report.md`，并以 `maestro run check/complete` 收口。
- `none`：纯路由、只读查询或无正式持久化的技能。禁止创建私有 `.workflow` 会话目录。

Team skill 可以继续使用 `.workflow/.team/` 作为瞬态消息总线，但正式 artifact/wisdom 必须进入 active Run；消息总线不得作为知识索引源。

---

## 2. Section Specifications

### `<invariants>` — Global Guard Rails

保留为独立段落，不打散到 transitions 中。这些是 LLM 的系统级底线指令，无论处于哪个状态都必须遵守。

```markdown
<invariants>
1. Durable State is Source of Truth — 状态写入声明的 Run/session/work 文件，不依赖模型内存
2. Dependency Order is Sacred — 依赖未完成时不得执行下游步骤
3. Delegation Has One Owner — 委托后由 worker 执行任务，coordinator 只协调、等待和汇总
</invariants>
```

**规则**：
- 只放跨状态的全局约束
- 绑定到特定转移的条件放 `<transitions>` 的 GUARD 中
- 每条 invariant 必须可验证（有明确的违反判定条件）

### `<states>` — Explicit State Declaration

显式声明所有状态节点，每个节点含 1 行 rationale + PERSIST 字段。

```markdown
<states>
S_INIT          — 解析参数、路由入口           PERSIST: session.status
S_INFER         — 推断生命周期位置             PERSIST: session.lifecycle_position
S_BUILD_CHAIN   — 构建步骤链                   PERSIST: session.steps[]
S_CONFIRM       — 用户确认（auto_mode 跳过）   PERSIST: —
S_WAVE_LOOP     — 构建并执行下一波             PERSIST: session.waves[], session.current_step
S_DECISION      — 委托评估 + 应用裁决          PERSIST: session.passed_gates[], step.retry_count
S_FIX_LOOP      — 插入修复步骤并重索引          PERSIST: session.steps[] (expanded)
S_COMPLETE      — 标记完成、释放目标            PERSIST: session.status = "completed"
S_PAUSED        — 暂停等待人工介入              PERSIST: session.status = "paused"
S_FALLBACK      — 兜底：条件不匹配时请求输入    PERSIST: session.status = "paused"
</states>
```

**规则**：
- 每个 state 必须有 `PERSIST` 字段，明确写哪些 session/status/artifact/work 字段
- `S_FALLBACK` 必须存在——当所有 WHEN 条件不满足时进入此状态，调用 `request_user_input`
- Rationale 限 1 行，不展开

### `<transitions>` — State Transition Rules

每个状态列出所有出边，格式：`→ TARGET  WHEN: condition  [GUARD: constraint]  DO: action_ref`

```markdown
<transitions>

S_INIT:
  → S_INFER         WHEN: intent is non-empty
  → S_WAVE_LOOP     WHEN: intent == "execute" | "continue"
  → S_FALLBACK      WHEN: no intent AND no running session

S_INFER:
  → S_BUILD_CHAIN   WHEN: position resolved
  → S_FALLBACK      WHEN: cannot infer position         DO: show raw state

S_WAVE_LOOP:
  → S_DECISION      WHEN: next_step.type == "decision"
  → S_WAVE_LOOP     WHEN: next_step.type == "external"  DO: A_BUILD_AND_SPAWN_WAVE
  → S_COMPLETE      WHEN: no pending steps
  → S_PAUSED        WHEN: step failed
                     GUARD: auto_mode → retry once then pause

S_DECISION:
  → S_WAVE_LOOP     WHEN: verdict == "proceed"          DO: add to passed_gates
  → S_FIX_LOOP      WHEN: verdict == "fix"              DO: A_INSERT_FIX_LOOP
  → S_PAUSED        WHEN: verdict == "escalate"
  → S_WAVE_LOOP     WHEN: structural(post-milestone) + has next milestone
                                                         DO: A_ADVANCE_MILESTONE
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 + proceed → override to fix

</transitions>
```

**规则**：
- 转移条件用 `WHEN`，绑定到特定转移的约束用 `GUARD`
- 动作引用 `DO: A_XXX`，具体逻辑在 `<actions>` 中定义
- 每个 state 必须有到 `S_FALLBACK` 或 `S_PAUSED` 的兜底路径
- 条件必须互斥且穷尽（覆盖所有可能）

### `<actions>` — Operation Definitions

每个 ACTION 独立定义，内部使用结构化散文 + 伪代码。不压缩为纯 DSL。

```markdown
<actions>

### A_BUILD_AND_SPAWN_WAVE

以下仅是选择 CSV Wave 后的 ACTION 示例，不是 Codex Skill 的默认执行结构。

1. buildNextWave: barrier → solo CSV; non-barrier → batch until decision node
2. buildSkillCall per step: resolve placeholders, apply enrichment table, append auto flags
3. Write wave-{N}.csv
4. spawn_agents_on_csv({ csv_path, instruction, max_workers, output_csv_path })
5. Merge results into master, delete wave CSV
6. Update session: current_step, waves[], context fields

Enrichment table:
| Skill | Args | Source |
|-------|------|--------|
| plan | --dir {analyze_artifact_path} | state.json artifacts |
| execute | --dir {plan_artifact_path} | state.json artifacts |
| debug | "{gap_summary}" | decision verdict |

### A_INSERT_FIX_LOOP

1. Clear passed_gates (code will change)
2. Select fix-loop template by decision type (see Appendix: Fix-Loop Templates)
3. Insert steps after current position
4. Reindex all steps
5. Write status.json

</actions>
```

**规则**：
- ACTION 名称以 `A_` 前缀，与 transitions 中的 `DO:` 引用对应
- 内部用编号步骤，不用散文段落
- 数据映射用表格，不用散文描述
- 每个 ACTION 必须明确输入/输出和副作用（写了什么文件）

---

## 3. Codex Execution Surfaces and Optional Primitives

### Execution Surface Selection

Codex Skill 不强制使用 CSV Wave。按任务形状选择最小且清晰的执行面：

| Surface | Use when | Required contract |
|---------|----------|-------------------|
| Direct execution | 单一、边界清晰、委托无收益 | Skill 直接执行并验证 |
| `spawn_agent` + `wait_agent` | 少量异构任务、需要迭代交流或每个任务上下文不同 | 每个 agent 必须被等待回收；首次超时后继续等待，不遗留 orphan agent |
| `spawn_agents_on_csv` | 大批量同构、逐行独立、输入输出 schema 稳定 | 显式 `max_runtime_seconds: 3600`；每个 worker 调用一次 `report_agent_job_result` |

**规则**：
- 不得为了符合模板而创建 `tasks.csv`、wave 状态或 results CSV。
- 只有选用 `spawn_agents_on_csv` 时，才适用 CSV 列分离、wave 顺序、merge 和清理规则。
- 执行面是 ACTION 的实现选择，不应改变 Skill 的领域状态机、Run contract 或正式 artifact 边界。

### MACRO: RUN_CSV_WAVE

当 2 个以上 Skill 都选择 CSV Wave 且流程实质相同时，可抽为标准子程序：

```markdown
### MACRO: RUN_CSV_WAVE(wave_rows, session_folder, instruction_builder)

1. Filter pending rows for target wave
2. Build prev_context from completed predecessor findings
3. Write wave-{N}.csv with prev_context column
4. spawn_agents_on_csv({
     csv_path: wave-{N}.csv,
     instruction: instruction_builder(context),
     output_csv_path: wave-{N}-results.csv
   })
5. Merge results into master CSV
6. Delete wave-{N}.csv
7. Return: updated master CSV rows
```

仅采用 CSV Wave 的 Skill 通过不同的 `instruction_builder` 和上下文参数调用此 MACRO，不重复描述流程。未采用 CSV Wave 的 Skill 不引用此 MACRO。

---

## 4. `<appendix>` — Reference-Only Content

以下内容移出主流程，放入 appendix 供按需查阅：

| Section | Content |
|---------|---------|
| CSV Schema（仅 CSV Wave） | 列定义、示例行 |
| Worker Contract（按所选执行面） | 子 agent instruction 模板、output schema |
| Fix-Loop Templates | 各 decision type 的修复步骤链 |
| Discovery Board Protocol | 类型定义、去重规则 |
| Error Codes | 错误码 + 恢复策略 |
| Success Criteria | 验收检查项 |
| Golden Examples | 典型执行路径的完整示例 |

---

## 5. Implementation Plan

### Order

1. **Pilot**: `maestro-ralph/SKILL.md` — 本质是 adaptive state machine，收益最大
2. **Select Surface**: 每个 ACTION 按任务形状选择 direct、`spawn_agent` 或 `spawn_agents_on_csv`
3. **Extract if Needed**: 仅为重复的 CSV Wave 流程抽 `MACRO: RUN_CSV_WAVE`
4. **Rollout**: 线性 `plan` 和 `execute` step 用 Phase Cards 轻量整理（不必完整状态机化）

### Phase Cards（适用于 plan/execute）

对于线性 pipeline 型 skill，用 Phase Cards 代替完整状态机：

```markdown
<phases>

PHASE P1_RESOLVE_INPUT:
  DO: parse args, resolve phase dir, load context
  NEXT: P2_SELECT_EXECUTION
  FAIL: abort with error

PHASE P2_SELECT_EXECUTION:
  DO: choose direct, spawn_agent, or spawn_agents_on_csv from task shape
  NEXT: P3_EXECUTE
  FAIL: abort

PHASE P3_EXECUTE:
  DO: execute through selected surface; use MACRO:RUN_CSV_WAVE only for CSV batches
  NEXT: P4_AGGREGATE
  FAIL: mark failed, pause

PHASE P4_AGGREGATE:
  DO: export results, update state, generate report
  NEXT: END

</phases>
```

### Safety Protocol

- 第一版将原散文移入 `<appendix>`，不删除
- 跑 3-5 次真实 skill 调用后评估效果，再压缩 appendix
- 每条原 invariant 必须能映射到 global invariant 或 transition GUARD
- 每条原 error code 必须在 appendix 中保留

---

## 6. Anti-Patterns

| Anti-Pattern | Correct |
|---|---|
| 在散文中嵌入隐式状态转移 | 所有转移在 `<transitions>` 中显式声明 |
| ACTION 内只写 2-3 个单词 | ACTION 内用编号步骤 + 表格，保留足够细节 |
| 用 GUARD 完全替代 invariants | 全局约束留在 `<invariants>`，只有绑定到特定转移的条件用 GUARD |
| 未选择执行面就默认创建 CSV Wave | 先按任务形状选择 direct、`spawn_agent` 或 `spawn_agents_on_csv` |
| 在主流程中内联 CSV schema | 仅选用 CSV Wave 时把 Schema 放 `<appendix>`，主流程只引用 |
| 多个 CSV Skill 重写相同 wave 执行逻辑 | 仅在流程重复时引用 `MACRO: RUN_CSV_WAVE` |
| 状态没有兜底路径 | 每个 state 必须有到 `S_FALLBACK` 的出边 |
| PERSIST 字段缺失 | 每个 state 声明写入哪些持久化字段 |

---

## 7. Language Style

Skill prompt 使用一种主要自然语言，并保持同一章节内一致。仓库级 Skill 默认用 English 编写可执行控制语句；明确面向中文用户的交互文案和报告模板可使用简体中文。

**Voice and wording**：
- 使用直接、命令式、可执行的短句；一条 bullet 只表达一个动作或约束。
- `MUST`/“必须”只用于 gate、invariant 和安全边界；`SHOULD`/“应”用于强建议；`MAY`/“可”用于真正可选行为。
- 条件、动作和失败路径分别写成 `WHEN`、`DO`、`GUARD`、`FAIL`，避免藏在长段落中。
- 保留 tool 名、代码标识符、schema 字段、路径、命令和原始错误信息的 English 拼写。
- 技术术语可嵌入中文句子，但不要在同一句中来回切换语法语言。
- 删除营销口号、人格化描述、哲学宣言和不产生执行约束的 commentary。
- 避免 `handle`、`ensure`、`improve`、`properly` 等不可验证动词；改写为具体动作和验收条件。
- 示例必须使用目标平台真实存在的工具与参数，不用跨平台伪 API。
