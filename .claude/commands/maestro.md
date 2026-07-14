---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: "<intent> [-y] [-c] [--dry-run] [--super]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - SendMessage
  - AskUserQuestion
  - TodoWrite
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<purpose>
Orchestrate all maestro commands: classify intent → select chain → create session → dispatch [@subagent] Agent(ralph-executor) per step → extract signals → drift check → complete → loop.
Session: `.workflow/.maestro/{session_id}/status.json`.
</purpose>

<deferred_reading>
- [maestro.md](~/.maestro/workflows/maestro.md) — read at execution start for intent analysis + chain selection
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag active
- [node-catalog](~/.maestro/templates/workflows/specs/node-catalog.md) — read at `A_COMPOSE_TEMPLATE` node resolution (`--compose`)
- [template-schema](~/.maestro/templates/workflows/specs/template-schema.md) — read at `A_COMPOSE_TEMPLATE` persist step (`--compose`) and `A_PLAY_TEMPLATE` load step (`--play`)
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Keywords:** `continue`/`next`/`go` → state-based routing; `status` → `[@skill] Skill("manage", "status")`

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors
- `-c` / `--continue` — Resume previous session. **`-c` is reserved for `--continue` across all maestro commands** — downstream skills MUST NOT redefine `-c` for other purposes to prevent collision via transparent forwarding.
- `--dry-run` — Show chain without executing
- `--super` — Read and follow `maestro-super.md`
- `--compose [--edit <path>]` — Compose a reusable workflow template (NL → DAG) instead of running a live chain. Routes to `A_COMPOSE_TEMPLATE`.
- `--play <template-slug|path> [--context k=v...] [--list] [--dry-run]` — Execute a saved workflow template through the ralph chain runner. Routes to `A_PLAY_TEMPLATE`.
</context>

<invariants>
1. **All chains dispatch via Agent(ralph-executor)** — maestro 拥有完整执行循环，每步派发一个 unnamed executor agent
2. **Session before execution** — status.json created before any step runs
3. **Auto flag pass-through** — 仅当用户传入 `-y` 时透传 `-y` 到 skill args
4. **Decomposition contract — maestro owns** — `source=="maestro"` 的 session 由 maestro 拥有分解契约（`decomposition_owner="maestro"`）：S_DECOMPOSE 产出 additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`)，下游 ralph 只消费不覆盖（当 `decomposition_owner == "maestro"` 时跳过二次提问，仅做 shape 校验 + 缺省字段补齐）
5. **status.json 唯一真源** — 不生成 `goal-checklist.md` 或外部清单
6. **执行步骤统一通过 `maestro ralph next` 加载** — `command_scope`/`command_path` 由 `maestro ralph skills --platform claude --json --quiet` 预校验（project 覆盖 global，限定 `.claude/`）；decision 节点由主流程通过 [@subagent] Agent() 评估，不 handoff 到其他 skill
7. **Topology awareness** — chain catalog 含 grill / brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute / ...；scope_verdict 由 ralph 在 `post-analyze-scope` 决定
8. **Grill `-y` 透传** — `-y` auto mode 透传 `-y` 到 grill args（grill 自身 Auto mode 用代码代答），不删除 grill stage；grill 仍产出 grill-report/terminology/context-package 供下游 brainstorm
9. **D-007-S session 解析** — session 由 `state.json.sessions[]` 的 `session_id` 或 intent slug 匹配
10. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE|DONE_WITH_CONCERNS` 写入
11. **schema** — `ralph_protocol_version: "2"` 标记 CLI-driven session；新增字段全部可选
12. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作，不可绕过。特别是 invariant 1（dispatch via Agent(ralph-executor)）和 invariant 2（session before execution）和 invariant 10（completion_confirmed 由 CLI 写入）为硬约束。
13. **Classification evidence** — S_CLASSIFY 的 chain 选择决策 MUST 记录到 status.json 的 `classification_rationale` 字段：匹配了哪个 pattern、排除了哪些备选、confidence level。无记录的分类不可进入 S_CREATE。
14. **禁止以上下文消耗为由中断执行** — harness 自动处理 context compression，以"上下文不足"或"避免 context overflow"为由中断属于 invariant violation
15. **控制权优先级（范式治理）** — FSM（maestro/maestro-ralph）独占 session 生命周期 + step 排序 + cross-step decision 节点；Pipeline（plan/execute/analyze）只拥有自身 artifact GATE，由 ralph dispatch 时 GATE 失败 → `complete BLOCKED|NEEDS_RETRY`、自身 GATE 全过 → DONE；Router（maestro-next）只单次推荐，不得出现在 FSM step 内。
16. **模板输出边界（--compose）** — `A_COMPOSE_TEMPLATE` 的写入 MUST 限定 `~/.maestro/templates/workflows/`（模板 JSON + index.json）与 `.workflow/templates/design-drafts/`（草稿）；NEVER 修改源码或 `.claude/commands/`。`--play` 视模板为只读，运行态只写 session status.json。
</invariants>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags                PERSIST: —
S_RESUME        — 扫描已有 session、恢复执行           PERSIST: —
S_COMPOSE       — 组合 workflow 模板（--compose）      PERSIST: template file + index
S_PLAY          — 执行已存 workflow 模板（--play）      PERSIST: player session status.json
S_CLASSIFY      — 意图分类、chain 选择                 PERSIST: —
S_DECOMPOSE     — 边界澄清、写执行准则+子目标清单       PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_CREATE        — 创建 session + status.json           PERSIST: session (全量)
S_DRY_RUN       — 显示 chain 后结束                    PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）            PERSIST: —
S_DISPATCH      — 进入执行循环                         PERSIST: —
S_STEP_LOCATE   — 找下一个 pending step                  PERSIST: —
S_STEP_DISPATCH — 派发 unnamed executor agent            PERSIST: step.status = "running"
S_STEP_ANALYZE  — 提取信号 + 组装 completion 参数        PERSIST: —
S_STEP_DRIFT    — 产物 vs 目标偏离分析                    PERSIST: step.drift_score
S_STEP_COMPLETE — 调 `ralph complete` 上报                PERSIST: step.completion_*
S_DECISION_EVAL — 启动分析 Agent 评估质量门            PERSIST: —
S_APPLY_VERDICT — 应用裁决                            PERSIST: steps[]
S_SESSION_DONE  — 所有 step 完成                      PERSIST: status
S_HANDLE_FAIL   — 处理失败                            PERSIST: step.status
S_FALLBACK      — 意图无法分类、请求输入                PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_COMPOSE     WHEN: --compose flag
  → S_PLAY        WHEN: --play flag
  → S_RESUME      WHEN: -c / --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_CLASSIFY    WHEN: keyword "continue"/"next"/"go"    DO: A_STATE_BASED_ROUTE
  → S_FALLBACK    WHEN: no intent AND no flags

S_RESUME:
  → S_DISPATCH    WHEN: session found                     DO: A_LOCATE_SESSION
  → S_FALLBACK    WHEN: no session found

S_COMPOSE:
  → END           DO: A_COMPOSE_TEMPLATE

S_PLAY:
  → S_DISPATCH    WHEN: template resolved                 DO: A_PLAY_TEMPLATE (build DAG steps → status.json)
  → S_FALLBACK    WHEN: template not found / --list        DO: list templates from index.json

S_CLASSIFY:
  → S_DECOMPOSE   WHEN: chain resolved                    DO: A_CLASSIFY_INTENT
  → S_FALLBACK    WHEN: no match AND auto_mode
  → S_CLASSIFY    WHEN: no match AND not auto_mode        DO: A_CLARIFY
                   GUARD: max 2 clarification rounds → S_FALLBACK

S_DECOMPOSE:
  → S_CREATE      DO: A_DECOMPOSE_TASKS
                   GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) on a multi-step lifecycle chain → MUST clarify even if auto_mode
                   GUARD: single-step chain OR narrow intent OR chain ∈ {status,init,quick} → skip decomposition (pass through)

S_CREATE:
  → S_DRY_RUN     WHEN: --dry-run flag                    DO: A_CREATE_SESSION
  → S_CONFIRM     WHEN: not auto_mode                     DO: A_CREATE_SESSION
  → S_DISPATCH    WHEN: auto_mode                         DO: A_CREATE_SESSION

S_DRY_RUN:
  → END           DO: display chain with step types

S_CONFIRM:
  → S_DISPATCH    WHEN: user confirms
  → S_PARSE       WHEN: user wants to modify
  → END           WHEN: user cancels

S_DISPATCH:
  → S_STEP_LOCATE

S_STEP_LOCATE:
  → S_STEP_DISPATCH WHEN: pending execution step found (step.decision == null)
  → S_DECISION_EVAL WHEN: pending decision step found (step.decision != null)
  → S_SESSION_DONE  WHEN: no pending steps (all completed/skipped)
  → S_HANDLE_FAIL   WHEN: has failed step and no pending

S_STEP_DISPATCH:
  → S_STEP_ANALYZE  WHEN: task-notification status=completed           DO: A_STEP_DISPATCH
  → S_HANDLE_FAIL   WHEN: task-notification status=failed              DO: mark BLOCKED

S_STEP_ANALYZE:
  → S_STEP_DRIFT    WHEN: STATUS == DONE|DONE_WITH_CONCERNS   DO: A_STEP_EXTRACT
  → S_HANDLE_FAIL   WHEN: STATUS == NEEDS_RETRY|BLOCKED       DO: A_STEP_EXTRACT

S_STEP_DRIFT:
  → S_STEP_COMPLETE WHEN: ALIGNED|MINOR_DRIFT                  DO: A_STEP_DRIFT_ANALYZE
  → S_STEP_DISPATCH     WHEN: MAJOR_DRIFT + not retried            DO: A_STEP_DRIFT_ANALYZE (retry)
  → S_STEP_COMPLETE WHEN: MAJOR_DRIFT + retried                DO: A_STEP_DRIFT_ANALYZE (DONE_WITH_CONCERNS)

S_STEP_COMPLETE:
  → S_STEP_LOCATE   DO: A_STEP_COMPLETE (loop to next step)

S_DECISION_EVAL:
  → S_APPLY_VERDICT WHEN: quality-gate (post-execute, post-review, post-test)
                     DO: A_AGENT_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate (post-goal-audit)
                     DO: A_AGENT_GOAL_AUDIT
  → S_APPLY_VERDICT WHEN: scope-gate (post-analyze-scope)
                     DO: A_SCOPE_EVALUATE

S_APPLY_VERDICT:
  → S_STEP_LOCATE WHEN: verdict == "proceed"             DO: A_APPLY_PROCEED
  → S_STEP_LOCATE WHEN: post-goal-audit + has_unmet      DO: A_APPLY_GOAL_FIX
  → S_SESSION_DONE WHEN: post-goal-audit + all_met        DO: A_APPLY_GOAL_DONE
  → S_STEP_LOCATE WHEN: post-analyze-scope               DO: A_APPLY_SCOPE_VERDICT
  → S_STEP_LOCATE WHEN: verdict == "fix"                 DO: A_APPLY_FIX
  → S_STEP_LOCATE WHEN: verdict == "escalate"            DO: A_APPLY_ESCALATE
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → [@ask] AskUserQuestion with override options

S_SESSION_DONE:
  → END            DO: A_COMPLETE_SESSION

S_HANDLE_FAIL:
  → S_STEP_LOCATE WHEN: auto + not retried              DO: A_RETRY
  → END              WHEN: auto + retried                   DO: A_PAUSE_SESSION
  → S_STEP_LOCATE WHEN: interactive + retry
  → S_STEP_LOCATE WHEN: interactive + skip
  → END              WHEN: interactive + abort

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent           DO: [@ask] AskUserQuestion
  → END           WHEN: user cancels

</transitions>

<actions>

### A_STATE_BASED_ROUTE

1. Read `.workflow/state.json` → determine next logical step
2. Convert to equivalent intent for chain classification

### A_LOCATE_SESSION

1. Scan `.workflow/.maestro/*/status.json`, filter `status == "running"`, sort DESC
2. Take most recent; if not found → S_FALLBACK

### A_COMPOSE_TEMPLATE

Compose a reusable workflow template (natural language → DAG). `--edit <path>` loads an existing template for revision.

1. **Parse intent** → candidate nodes (verb signals: analyze/review→analysis-cli, plan/design→planning, implement/build→execution, test→testing; then/next→sequential edge, parallel→fan-out) + variables + complexity. Confirm parse via `[@ask] AskUserQuestion`.
2. **Resolve nodes** → map each step to an executor. Read deferred `node-catalog.md` (fallback: planning→`plan`, execution→`execute`, testing→`test`, review→`review`, analysis→`maestro delegate --to <tool> --mode analysis`). Build `args_template` with `{variable}` placeholders. Confirm mapping.
3. **Build DAG** → sequential/fan-out edges, auto-inject checkpoints (artifact boundaries, before any `execute`, after any `test`), finalize `context_schema`. Validate: **≤20 nodes, acyclic, no orphans**. Display ASCII pipeline; confirm via `[@ask] AskUserQuestion`.
4. **Persist** → read deferred `template-schema.md`; assemble template JSON (`template_id: wft-<slug>-<date>`, nodes, edges, checkpoints, context_schema) → write to `~/.maestro/templates/workflows/<slug>.json` + update `index.json`. **All writes target `~/.maestro/templates/workflows/` only.** Abandoning any gate saves a draft to `.workflow/templates/design-drafts/`.
5. Output: template path/ID + `/maestro --play <template-id>` to run it.

### A_PLAY_TEMPLATE

Execute a saved workflow template through the ralph chain runner. Flags: `--context k=v` (repeatable), `--list`, `--dry-run`.

1. **Resolve template**: absolute path → as-is; slug → `~/.maestro/templates/workflows/index.json` lookup. `--list` → display index and END. Read deferred `template-schema.md` to validate (`template_id`, `nodes`, `edges`, `context_schema` required).
2. **Bind context**: parse `--context k=v`; collect missing required variables via `[@ask] AskUserQuestion`; bind `{variable}` placeholders (leave `{N-xxx.field}` and `{prev_*}` for runtime resolution by ralph-execute).
3. **Topological sort** (Kahn) template nodes → linear `steps[]` (parallel nodes share a batch index). Each step carries `skill`/`args`/`type` (skill|cli|agent|checkpoint) resolved as in `A_CREATE_SESSION`; cli nodes run async via `Bash(run_in_background)` + STOP, checkpoints pause with resume via `-c`.
4. **Create session**: write `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json` (`source: "maestro"`, `template_id`, bound `context`, topologically-ordered `steps[]`). `--dry-run` → display plan and END.
5. 进入 S_DISPATCH → S_STEP_LOCATE 执行循环 — 每步派发 Agent(ralph-executor)，主流程管理 checkpoint、resume-safety、`completion_confirmed`。

### A_CLASSIFY_INTENT

1. Read `~/.maestro/workflows/maestro.md` from deferred_reading
2. Match intent to task_type via chain catalog (semantic)
3. Select chain from chainMap，遵循拓扑约束：
   - 压力测试/拷问/验证假设/grill/stress-test → `grill`（**-y 模式透传 `-y` 到 grill，grill 以 Auto mode 执行，不跳过**）
   - 头脑风暴/探索 → `brainstorm`
   - 学习/阅读代码/跟读/follow → `[@skill] Skill("learn", "follow")`；调查/为什么/investigate → `[@skill] Skill("learn", "investigate")`；分解/模式/decompose → `[@skill] Skill("learn", "decompose")`；评审/挑战/second-opinion → `[@skill] Skill("learn", "consult")`；回顾/retro → step `retrospective`（`maestro run prepare retrospective` + `maestro run create retrospective`）
   - 正式规格/spec-generate/7-phase → `blueprint`
   - 项目初始化 → `init`
   - 宽/中等意图 + 无 session 上下文 → `analyze-macro`（产 scope_verdict，由 ralph 在 `post-analyze-scope` 决定是否插入 roadmap+analyze 或直跳 plan --from analyze）
   - session 上下文 → `analyze --session {session}` → `plan --session {session}` → `execute --session {session}` → quality pipeline
   - 已有 analyze artifact 想直达执行 → `plan --from analyze:{ANL_ID}` → execute → quality pipeline
   - 已有 blueprint artifact → `plan --from blueprint:{BLP_ID}` → execute → quality pipeline
4. 执行 step：`Bash("maestro ralph skills --platform claude --json --quiet")` 预校验 skill 名，命中写绝对路径到 `command_path`，未命中标 `missing`；同时写 `step.stage` / `step.scope` / `step.source_artifact_ref`。decision 节点不解析 command_path

### A_CLARIFY

1. `[@ask] AskUserQuestion` with parsed intent + available chain options
2. Re-classify with user response

### A_DECOMPOSE_TASKS

设 `session.decomposition_owner = "maestro"`。下游 ralph 只消费不二次提问（invariant 4）。Condensed:

1. 分类意图广度。narrow / 单步 / `{status,init,quick}` 链跳过
2. broad/medium → `[@ask] AskUserQuestion` ≤3 轮：Scope / Constraints / Definition of Done
3. 派生 `execution_criteria` + `task_decomposition`（每个 sub-goal 含 `done_when` + `evidence` + `lifecycle` + `completion_confirmed: false`）
4. **status.json 唯一真源**：写入 `boundary_contract` / `execution_criteria` / `task_decomposition`；不生成 markdown 清单
5. 在最后一个 evidence-producing stage（execute/review/test）之后追加 `decision:post-goal-audit`（session 终结审计节点）。ralph-execute 在该节点按需动态生长 `steps[]`
6. **输出 `/goal` 绑定提示词（不阻塞，用户可在执行过程中随时输入）：**
   ```
   📋 任务分解完成。可随时复制下面一行设定目标（执行过程中输入即可）：

   /goal 完成以下子目标：
   {for each G in task_decomposition:}
   - {G.id}: {G.goal} — 完成条件: {G.done_when}
   {end for}
   达成条件: {session_dir}/status.json 中 task_decomposition[*].status == "done" 且 task_decomposition[*].completion_confirmed == true 且 steps[*].completion_confirmed == true。未达成时：阅读 {session_dir}/status.json 取得 execution_criteria / boundary_contract / task_decomposition / steps 作为行动手册，调用 /maestro-ralph continue 推进；严禁手动执行 skill 或越界修改 status.json.boundary_contract.out_of_scope。
   ```

### A_STEP_DISPATCH

加载前序产出 + 派发 executor agent。模型同 maestro-ralph 的 A_STEP_DISPATCH。

1. **前序上下文**：读前一 completed step 的 `completion_summary` + `completion_caveats` + `completion_decisions` + `completion_deferred`
2. **Goal context**：`step.goal_ref` 非空时组装 `<goal_context>` 块
3. **Resolve agent name**：`{stage_prefix}-{session_id_short}-{HHmmss}`（prefix: grl/brn/anm/ana/pln/exe/rev/tst/dbg/run）
4. **派发（unnamed executor）**：

```
[@subagent] Agent({
  subagent_type: "ralph-executor",
  description: "执行 step {index}: {step.skill} [{resolved_agent_name}]",
  prompt: `Session: {session_id}

{goal_context 块}

{loaded_step_context}
`
})
```

5. 写 `step.agent_exec_name`（仅日志标识）
6. Display: `[{index}/{total}] ⟶ {step.skill} → {resolved_agent_name}`
7. 等待 task-notification → agent_output

### A_STEP_EXTRACT

从 agent 返回提取信号（同 maestro-ralph A_STEP_EXTRACT）：

| Stage | 提取什么 | 写入字段 |
|-------|---------|---------|
| analyze | scope_verdict + key_findings | `--summary`, context.analysis_dir |
| plan | TASK-*.json 数量 + 波次 | `--summary`, context.plan_dir |
| execute | 修改文件数 + verification | `--summary`, `--evidence`, context.run_dir |
| review | verdict + findings + severity | `--summary`, `--decisions` |
| test | pass/fail 统计 | `--summary`, `--evidence` |

组装 completion params：`--summary`（MUST，≤100 字），`--decisions`/`--caveats`/`--deferred`/`--evidence`（SHOULD）。

### A_STEP_DRIFT_ANALYZE

产物 vs 目标偏离分析（同 maestro-ralph A_STEP_DRIFT_ANALYZE）：

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常 complete |
| MINOR_DRIFT | 偏离追加 caveats，正常 complete |
| MAJOR_DRIFT + 未重试 | `maestro ralph retry {index}` → 回 S_STEP_DISPATCH |
| MAJOR_DRIFT + 已重试 | DONE_WITH_CONCERNS complete |

### A_STEP_COMPLETE

1. 使用 A_STEP_EXTRACT 组装的参数调 `Bash("maestro ralph complete {index} --status DONE --summary ...")`
2. 传播 context signals 到 status.json context 字段
3. Display: `[{index}/{total}] ✓ {step.skill} → {SUMMARY}`
4. Loop → S_STEP_LOCATE

### A_AGENT_EVALUATE

通过 Agent 评估质量门（同 maestro-ralph A_AGENT_EVALUATE）：

```
[@subagent] Agent({  // generic agent — 评估类无专属定义，通过 prompt CONSTRAINTS 约束行为
  description: "评估 {decision} 质量门",
  prompt: "PURPOSE: 评估 {decision} 质量门结果
TASK: 读取结果文件 | 分析状态 | 评估严重性 | 给出建议
FILES: {result_file_paths}
SESSION: {session_dir}/status.json
EXPECTED:
---VERDICT---
STATUS: PASS|FAIL|PARTIAL|BLOCKED
REASON: <原因>
CONFIDENCE_SCORE: 0-100
---END---
CONSTRAINTS: 只评估不修改文件"
})
```

Parse verdict → 调整 → 写 decisions.ndjson → S_APPLY_VERDICT。
Parse 失败 → fallback fix + `parse_failed: true`（invariant 18）。

### A_AGENT_GOAL_AUDIT

子目标审计（同 maestro-ralph A_AGENT_GOAL_AUDIT）：Agent 读 task_decomposition，对照 evidence 判定 met/unmet。

### A_SCOPE_EVALUATE

post-analyze-scope 触发：读 macro analyze artifact → 提取 scope_verdict → 写 status.json。

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE / A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE / A_APPLY_SCOPE_VERDICT

- **A_APPLY_PROCEED**: mark decision completed
- **A_APPLY_FIX**: 插入 fix-loop steps → reindex → increment retry
- **A_APPLY_ESCALATE**: 插入 `debug "{gap}"` + decision → reindex
- **A_APPLY_GOAL_FIX**: 每个 unmet 子目标插入 scoped mini-loop（plan --gaps + execute），追加 post-goal-audit {retry+1}
- **A_APPLY_GOAL_DONE**: set `task_decomposition[*].status="done"`, `task_decomposition_all_done=true`
- **A_APPLY_SCOPE_VERDICT**: 依据 scope_verdict 重塑下游链路（同 maestro-ralph）

### A_RETRY / A_PAUSE_SESSION / A_COMPLETE_SESSION

- **A_RETRY**: `Bash("maestro ralph retry {index}")`
- **A_PAUSE_SESSION**: `ralph complete N --status BLOCKED`
- **A_COMPLETE_SESSION**: 校验 `completion_confirmed` + `task_decomposition_all_done` → `status = "completed"`

### A_CREATE_SESSION

0. **Specs 预检**：当 chain 包含 `analyze-macro` / `analyze` / `plan` / `execute` 等执行 stage 且 `.workflow/specs/` 目录不存在时，在 steps 最前面插入 `spec-setup`（stage=`spec-setup`，无 decision）。确保下游可获得项目约束规则注入。chain ∈ {grill, brainstorm, blueprint, init, status, quick} 时跳过
1. Read `.workflow/state.json` 获取 `active_session_id` / 匹配 `sessions[]`（含 D-007-S session 解析）；读最新 macro analyze artifact 注入 `scope_verdict` + `analyze_macro_id`（如存在）；读最新 blueprint artifact 注入 `blueprint_id`
2. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`（与 ralph 共用 schema）：
   ```json
   {
     "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "ralph_protocol_version": "2", "active_step_index": null,
     "session_ref": "", "session_is_new": false,
     "scope_verdict": null, "analyze_macro_id": null, "blueprint_id": null,
     "auto_mode": false, "decomposition_owner": "maestro", "cli_tool": "claude",
     "context": { "run_dir": null, "plan_dir": null, "analysis_dir": null,
       "brainstorm_dir": null, "blueprint_dir": null, "issue_id": null },
     "steps": [{
       "index": 0, "skill": "", "args": "",
       "stage": "", "scope": null, "decision": null,
       "command_scope": "global|project|missing|null", "command_path": "<abs> | null",
       "session_ref": null, "source_artifact_ref": null,
       "status": "pending", "goal_ref": null,
       "completion_confirmed": false, "completion_status": null,
       "completion_evidence": null,
       "completion_summary": null, "completion_decisions": null,
       "completion_caveats": null, "completion_deferred": null,
       "completed_at": null,
       "deferred_reads": [], "load": null
     }],
     "waves": [], "current_step": 0, "status": "running",
     "boundary_contract": {}, "execution_criteria": [],
     "task_decomposition": [{ "status": "pending|done|superseded",
       "superseded_by": null, "superseded_at": null, "origin": null }],
     "task_decomposition_all_done": false,
     "goal_changelog": []
   }
   ```
3. Validate: 所有 step 的 `command_scope != "missing"`，否则 raise E005 列出缺失 skill
4. Initialize tracking via `TodoWrite`
5. If `--super`: read `maestro-super.md`, follow it completely

</actions>

</state_machine>

<appendix>

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Prompt or suggest maestro-init |
| E002 | error | Clarity too low after 2 rounds | Show parsed intent, ask rephrase |
| E003 | error | Chain step failed + user abort | Record partial, suggest -c resume |
| E004 | error | Resume session not found | Show available sessions |
| E005 | error | command_scope == "missing" for one or more steps | List missing skills, abort build |
| W001 | warning | Ambiguous intent, multiple chains | Present options |
| W002 | warning | Step completed with warnings | Log and continue |
| W003 | warning | State suggests different chain | Show discrepancy |

### Success Criteria

- [ ] Intent classified with task_type, complexity, clarity_score
- [ ] Chain catalog 覆盖 grill / brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute / quality pipeline
- [ ] `-y` 模式透传 `-y` 到 grill（grill 以 Auto mode 代码代答执行，stage 不跳过）
- [ ] D-007-S: session 步骤的 `session_ref` 通过 `state.json.sessions[]` 的 session_id 或 intent slug 匹配
- [ ] macro analyze 后跟 `decision:post-analyze-scope`（由 ralph 评估 scope_verdict 决定下游链路）
- [ ] plan 支持 `--session {session}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}` 三路径；`source_artifact_ref` 写入 step
- [ ] Broad lifecycle intents decomposed (≤3 boundary questions); narrow/single-step skip
- [ ] status.json 唯一真源；无 markdown 清单；post-goal-audit 节点在 decomposed 时追加；/goal 提示词以 status.json 为判据
- [ ] Specs 预检：chain 含执行 stage + `.workflow/specs/` 不存在 → steps 最前面插入 `spec-setup`
- [ ] Chain selected and confirmed (or auto-confirmed)
- [ ] Session dir created with status.json before execution; decomposition fields additive-only
- [ ] 执行 step 含 `command_scope` + `command_path` + `completion_confirmed`；decision step 由 `step.decision` 标识
- [ ] `command_scope`/`command_path` 由 `maestro ralph skills --platform claude --json --quiet` 预校验（project 覆盖 global）
- [ ] Session schema 含 `ralph_protocol_version: "2"` + `active_step_index: null` + step.load 占位
- [ ] 用户传入 `-y` 时透传到 skill args
- [ ] All chains dispatched via Agent(ralph-executor) — maestro 拥有完整执行循环
- [ ] One agent per step — unnamed Agent({ subagent_type: "ralph-executor" }) 派发
- [ ] Executor 结果通过 task-notification 回传主流程
- [ ] 主流程调 `maestro ralph complete` 上报（非 agent 上报）
- [ ] Decision 节点通过 Agent 评估，不 handoff 到其他 skill
- [ ] drift_score 分析：ALIGNED/MINOR_DRIFT → complete；MAJOR_DRIFT → retry/concerns
- [ ] Low-complexity intents routed to step `quick`
- [ ] (super) Requirements validated before roadmap
- [ ] (super) Each session scored >= 80%
- [ ] (compose) `--compose` produces a validated template (≤20 nodes, acyclic, no orphans) written to `~/.maestro/templates/workflows/` + index; drafts preserved on abandon
- [ ] (play) `--play <template>` binds context, topologically sorts nodes → `steps[]`, and dispatches via Agent(ralph-executor) 执行循环; `--list`/`--dry-run` short-circuit

</appendix>
