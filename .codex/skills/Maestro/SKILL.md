---
name: maestro
disable-model-invocation: false
description: Multi-step orchestration engine with dual execution modes — ralph
  (Agent dispatch, decision gates, drift, auto-retry) and manual (per-step
  confirm, direct LLM execution). Triggered by /maestro-next routing or invoked
  directly
argument-hint: <intent> [-y] [-c] [--engine manual|ralph] [--dry-run] [--super]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_plan
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.54
---

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Multi-step closed-loop orchestration engine. Receives an intent (from `/maestro-next` routing or direct user invocation) and executes the full orchestration loop: select chain → resolve a topic-grouping Session → `session create --chain-file` → dispatch spawn_agent(ralph-executor) per step → extract signals → drift check → `run complete --verdict` → explicit `run next` loop.

**Positioning in the command hierarchy:**
- `/maestro-next` is the unified entry point that classifies intent and routes here when orchestrated multi-step execution is needed
- This command can also be invoked directly when the user explicitly wants closed-loop orchestration
- `/maestro-companion` handles lightweight tasks; this command handles heavy multi-step workflows

Session: `.workflow/sessions/{id}/session.json`（topic grouping/index + orchestration；步进进度与 sealed outputs 归 Run，见 run.json handoff/anchor）。CLI 建/写，本命令不直写。
</purpose>

<deferred_reading>
- [maestro.md](~/.maestro/workflows/maestro.md) — read at execution start for intent analysis + chain selection
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag active
- [node-catalog](~/.maestro/templates/workflows/specs/node-catalog.md) — read at `A_COMPOSE_TEMPLATE` node resolution (`--compose`)
- [template-schema](~/.maestro/templates/workflows/specs/template-schema.md) — read at `A_COMPOSE_TEMPLATE` persist step (`--compose`) and `A_PLAY_TEMPLATE` load step (`--play`)
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Keywords:** `continue`/`next`/`go` → state-based routing; `status` → chain catalog task type `status`

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors
- `-c` / `--continue` — Continue the previous active Run/topic group without invoking Session recovery commands. **`-c` is reserved for `--continue` across all maestro commands** — downstream skills MUST NOT redefine `-c` for other purposes to prevent collision via transparent forwarding.
- `--engine <manual|ralph>` — Execution engine selection. `ralph` (default): spawn_agent(ralph-executor) dispatch with decision gates, drift analysis, auto-retry. `manual`: per-step user confirmation, main LLM executes directly, no decision gates/drift/auto-retry. When routed from `/maestro-next` with engine hint, honor it.
- `--dry-run` — Show chain without executing
- `--super` — Read and follow `maestro-super.md`
- `--compose [--edit <path>]` — Compose a reusable workflow template (NL → DAG) instead of running a live chain. Routes to `A_COMPOSE_TEMPLATE`.
- `--play <template-slug|path> [--context k=v...] [--list] [--dry-run]` — Execute a saved workflow template through the ralph chain runner. Routes to `A_PLAY_TEMPLATE`.
</context>

<invariants>
1. **Engine-specific execution** — `ralph` engine: 每步派发一个 unnamed spawn_agent(ralph-executor)，含 decision gates/drift/auto-retry。`manual` engine: 主 LLM 直接执行每步，逐步用户确认，无 decision gates/drift/auto-retry。两种引擎共享 chain 基础设施（session create --chain-file / run next / run complete --verdict）
2. **Session before execution** — session.json created before any step runs（经 `session create --chain-file`）
3. **Auto flag pass-through** — 仅当用户传入 `-y` 时透传 `-y` 到 skill args
4. **Decomposition contract — maestro owns** — `source=="maestro"` 的 session 由 maestro 拥有分解契约（`decomposition_owner="maestro"`）：S_DECOMPOSE 产出 additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`)，随 chain-file 的 `decomposition` 块建入 session；下游 ralph 只消费不覆盖（当 `decomposition_owner == "maestro"` 时跳过二次提问，仅做 shape 校验 + 缺省字段补齐）
5. **session.json orchestration 唯一真源** — 不生成 `goal-checklist.md` 或外部清单；一切状态写入经 CLI 动词（`session create --chain-file` / `session chain insert|skip|replace` / `run next` / `run complete --verdict` / `run decide` / `session meta update`），本命令不直写 session.json
6. **执行步骤统一通过 `maestro run next` 加载** — `command_scope`/`command_path` 由 `maestro ralph skills --platform codex --steps --json --quiet` 预校验（project 覆盖 global；command/skill 来自 `.claude/`，step 来自 prepare/workflows 步骤注册表）；decision 节点由主流程通过 spawn_agent() 评估、经 `run decide` 落盘，不 handoff 到其他 skill
7. **Topology awareness** — chain catalog 含 grill / brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute / ...；scope_verdict 由链内 `post-analyze-scope` decision 节点落盘决定，本命令不预判
8. **Grill `-y` 透传** — `-y` auto mode 透传 `-y` 到 grill args（grill 自身 Auto mode 用代码代答），不删除 grill stage；grill 仍产出 grill-report/terminology/context-package 供下游 brainstorm
9. **D-007-S topic 解析与复用** — Session 仅作 topic grouping/index；normal routing 只接受唯一 running topic locator，同 Session 的 sealed Run outputs 仅经 canonical `upstream`/Artifact Registry 复用；historical similarity 始终只读且不产生 mutation action
10. **每个 step 由 verdict 驱动链推进** — 由 `maestro run complete --verdict done|done-with-concerns`（免 run-id）驱动 chain step 完成+推进
11. **schema** — session.json 为 `session/1.2`、run.json 为 `command-run/1.2`；orchestration 单源，contract v2 仅显式 opt-in
12. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作，不可绕过。特别是 invariant 1（dispatch via spawn_agent(ralph-executor)）和 invariant 2（session before execution）和 invariant 10（verdict 驱动链推进由 CLI 写入）为硬约束。
13. **Classification evidence** — S_CLASSIFY 的 chain 选择决策 MUST 记录（匹配了哪个 pattern、排除了哪些备选、confidence level）作为分类留痕。无记录的分类不可进入 S_CREATE。
14. **禁止以上下文消耗为由中断执行** — harness 自动处理 context compression，以"上下文不足"或"避免 context overflow"为由中断属于 invariant violation
15. **控制权优先级（范式治理）** — maestro 拥有 **ralph 引擎** session 的完整 FSM 生命周期（step 排序 + cross-step decision 节点 + drift）；**manual 引擎** session 由 maestro 以简化循环管理（逐步确认，无 decision 节点/drift/auto-retry）；Pipeline（plan/execute/analyze）只拥有自身 artifact GATE，由 ralph dispatch 时 GATE 失败 → `complete BLOCKED|NEEDS_RETRY`、自身 GATE 全过 → DONE；Router（maestro-next）不得出现在 FSM step 内。
16. **模板输出边界（--compose）** — `A_COMPOSE_TEMPLATE` 的写入 MUST 限定 `~/.maestro/templates/workflows/`（模板 JSON + index.json）与 `.workflow/templates/design-drafts/`（草稿）；NEVER 修改源码或 `.claude/commands/`。`--play` 视模板为只读，运行态经 CLI 动词写 session.json。
17. **Goal tracking 与 session 双写** — 主流程在 session 创建、step 派发、step 完成时同步创建/更新 goal，补充 session.json 的 UI 可见进度。
18. **Compatibility commands are out of band** — 主流程禁止调用或推荐 `run recall-confirm|fork|import|new|rebind` 与 `session resolve|resume`；这些 deprecated admin-only CLI 不参与 topic resolution、output reuse 或 next-action routing，且无 force bypass。
</invariants>

<task_tracking>

**时机与操作**（plan 是 session 权威状态的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | update_plan 初始化步骤清单 | `update_plan({ plan: [{ step: "Step {index}: {step.skill}", status: "pending" }, ...] })` |
| Step 派发时 | update_plan 标记当前 step | `update_plan({ plan: [..., 当前 step status: "in_progress"] })` |
| Step 完成时 | update_plan 标记完成 | `update_plan({ plan: [..., 该 step status: "completed"] })` |
| Step 失败时 | update_plan + explanation 说明 | `update_plan({ explanation: "Step {index} failed: {reason}", plan: [...] })` |

</task_tracking>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags                PERSIST: —
S_CONTINUE      — 定位 active Run/topic group，不做 lifecycle mutation  PERSIST: —
S_COMPOSE       — 组合 workflow 模板（--compose）      PERSIST: template file + index
S_PLAY          — 执行已存 workflow 模板（--play）      PERSIST: player session.json（CLI 建）
S_CLASSIFY      — 意图分类、chain 选择                 PERSIST: —
S_DECOMPOSE     — 边界澄清、写执行准则+子目标清单       PERSIST: boundary_contract + decomposition（内存 → chain-file）
S_CREATE        — `session create --chain-file`（stdin JSON）  PERSIST: session (全量, CLI 建)
S_DRY_RUN       — 显示 chain 后结束                    PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）            PERSIST: —
S_DISPATCH      — 进入执行循环（按 engine 分流）         PERSIST: —
S_STEP_LOCATE   — 找下一个 pending step                  PERSIST: —
S_STEP_DISPATCH — [ralph] 派发 unnamed executor agent（run next 建 Run + 出生包自源）  PERSIST: step.status = "running"（run next 落）
S_MANUAL_STEP   — [manual] run next → 逐步确认 → 主 LLM 直接执行 → run complete --verdict  PERSIST: step.status 推进
S_STEP_ANALYZE  — [ralph] 提取信号 + 组装 completion 参数        PERSIST: —
S_STEP_DRIFT    — [ralph] 产物 vs 目标偏离分析                    PERSIST: step.drift_score（评估态）
S_STEP_COMPLETE — 调 `run complete --verdict` 上报        PERSIST: run.json handoff + chain 推进
S_DECISION_EVAL — 启动分析 Agent 评估质量门            PERSIST: —
S_APPLY_VERDICT — `run decide` 落盘裁决 + `session chain insert` 插步  PERSIST: decision_point + chain
S_SESSION_DONE  — 所有 step 完成                      PERSIST: status
S_HANDLE_FAIL   — 处理失败                            PERSIST: step.status
S_FALLBACK      — 意图无法分类、请求输入                PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_COMPOSE     WHEN: --compose flag
  → S_PLAY        WHEN: --play flag
  → S_CONTINUE    WHEN: -c / --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_CLASSIFY    WHEN: keyword "continue"/"next"/"go"    DO: A_STATE_BASED_ROUTE
  → S_FALLBACK    WHEN: no intent AND no flags

S_CONTINUE:
  → S_DISPATCH    WHEN: session found                     DO: A_LOCATE_SESSION
  → S_FALLBACK    WHEN: no session found

S_COMPOSE:
  → END           DO: A_COMPOSE_TEMPLATE

S_PLAY:
  → S_DISPATCH    WHEN: template resolved                 DO: A_PLAY_TEMPLATE (build DAG steps → session create --chain-file)
  → S_FALLBACK    WHEN: template not found / --list        DO: list templates from index.json

S_CLASSIFY:
  → END           WHEN: chain resolved as `companion`     DO: A_ROUTE_COMPANION
  → S_DECOMPOSE   WHEN: chain resolved                    DO: A_CLASSIFY_INTENT
  → S_FALLBACK    WHEN: no match AND auto_mode
  → S_CLASSIFY    WHEN: no match AND not auto_mode        DO: A_CLARIFY
                   GUARD: max 2 clarification rounds → S_FALLBACK

S_DECOMPOSE:
  → S_CREATE      DO: A_DECOMPOSE_TASKS
                   GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) on a multi-step lifecycle chain → MUST clarify even if auto_mode
                   GUARD: single-step chain OR narrow intent OR chain ∈ {status,init} → skip decomposition (pass through)

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
  → S_STEP_DISPATCH WHEN: engine == ralph AND pending execution step found (step.decision == null)
  → S_MANUAL_STEP   WHEN: engine == manual AND pending execution step found
  → S_DECISION_EVAL WHEN: engine == ralph AND pending decision step found (step.decision != null)
  → S_SESSION_DONE  WHEN: no pending steps (all completed/skipped)
  → S_HANDLE_FAIL   WHEN: has failed step and no pending

S_STEP_DISPATCH:
  → S_STEP_ANALYZE  WHEN: task-notification status=completed           DO: A_STEP_DISPATCH
  → S_HANDLE_FAIL   WHEN: task-notification status=failed              DO: mark BLOCKED

S_MANUAL_STEP:
  → S_MANUAL_STEP WHEN: step completed AND user confirms "Continue next step"   DO: A_MANUAL_STEP
  → S_SESSION_DONE WHEN: chain exhausted (no pending steps)                      DO: A_MANUAL_STEP (final)
  → END            WHEN: user stops / -y single step done                        DO: A_MANUAL_STEP (pause)

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
  GUARD: not auto_confirm → request_user_input with override options

S_SESSION_DONE:
  → END            DO: A_COMPLETE_SESSION

S_HANDLE_FAIL:
  → S_STEP_LOCATE WHEN: auto + not retried              DO: A_RETRY
  → END              WHEN: auto + retried                   DO: A_PAUSE_SESSION
  → S_STEP_LOCATE WHEN: interactive + retry
  → S_STEP_LOCATE WHEN: interactive + skip
  → END              WHEN: interactive + abort

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent           DO: request_user_input
  → END           WHEN: user cancels

</transitions>

<actions>

### A_STATE_BASED_ROUTE

1. Read `.workflow/state.json` → determine next logical step
2. Convert to equivalent intent for chain classification

### A_LOCATE_SESSION

1. Run `maestro run recall maestro --intent "{intent}" --json` as a read-only lookup. Only one canonical running topic locator may be continued; multiple live candidates are ambiguous and require explicit user selection.
2. For the unique live locator: active Run → `maestro run brief --platform codex <run_id>`; running Session → continue with its explicit `session_id`. A paused, sealed, archived, or blocked candidate is not a normal continuation target: report the state and stop without invoking compatibility transitions.
3. Historical similarity remains read-only evidence (`automatic=false`). Never turn it into a resume/fork/import/new recommendation, never copy its Session authority, and never bind outputs across Sessions. No live locator → S_FALLBACK/new topic Session.

### A_COMPOSE_TEMPLATE

Compose a reusable workflow template (natural language → DAG). `--edit <path>` loads an existing template for revision.

1. **Parse intent** → candidate nodes (verb signals: analyze/review→analysis-cli, plan/design→planning, implement/build→execution, test→testing; then/next→sequential edge, parallel→fan-out) + variables + complexity. Confirm parse via `request_user_input`.
2. **Resolve nodes** → map each step to an executor. Read deferred `node-catalog.md` (fallback: planning→`plan`, execution→`execute`, testing→`test`, review→`review`, analysis→`maestro delegate --to <tool> --mode analysis`). Build `args_template` with `{variable}` placeholders. Confirm mapping.
3. **Build DAG** → sequential/fan-out edges, auto-inject checkpoints (artifact boundaries, before any `execute`, after any `test`), finalize `context_schema`. Validate: **≤20 nodes, acyclic, no orphans**. Display ASCII pipeline; confirm via `request_user_input`.
4. **Persist** → read deferred `template-schema.md`; assemble template JSON (`template_id: wft-<slug>-<date>`, nodes, edges, checkpoints, context_schema) → write to `~/.maestro/templates/workflows/<slug>.json` + update `index.json`. **All writes target `~/.maestro/templates/workflows/` only.** Abandoning any gate saves a draft to `.workflow/templates/design-drafts/`.
5. Output: template path/ID + `/maestro --play <template-id>` to run it.

### A_PLAY_TEMPLATE

Execute a saved workflow template through the ralph chain runner. Flags: `--context k=v` (repeatable), `--list`, `--dry-run`.

1. **Resolve template**: absolute path → as-is; slug → `~/.maestro/templates/workflows/index.json` lookup. `--list` → display index and END. Read deferred `template-schema.md` to validate (`template_id`, `nodes`, `edges`, `context_schema` required).
2. **Bind context**: parse `--context k=v`; collect missing required variables via `request_user_input`; bind `{variable}` placeholders (leave `{N-xxx.field}` and `{prev_*}` for runtime resolution by ralph-execute).
3. **Topological sort** (Kahn) template nodes → linear `steps[]` (parallel nodes share a batch index). Each step carries `command`/`args`/`type` (skill|cli|agent|checkpoint) resolved as in `A_CREATE_SESSION`; cli nodes run async via `Bash(run_in_background)` + STOP, checkpoints pause with resume via `-c`.
4. **Create session**: 组装 chain-file JSON（`intent`/`engine: ralph`/topologically-ordered `steps[]`/`decision_points`/`position`），调 `maestro session create maestro-{slug} --intent "..." --engine ralph --chain-file -`（stdin）。`--dry-run` → display plan and END.
5. 进入 S_DISPATCH → S_STEP_LOCATE 执行循环 — 每步派发 spawn_agent(ralph-executor)，主流程管理 checkpoint、resume-safety、verdict 驱动的链推进。

### A_CLASSIFY_INTENT

1. Read `~/.maestro/workflows/maestro.md` from deferred_reading
2. Match intent to task_type via chain catalog (semantic)
3. Select chain from chainMap，遵循拓扑约束：
   - 压力测试/拷问/验证假设/grill/stress-test → `grill`（**-y 模式透传 `-y` 到 grill，grill 以 Auto mode 执行，不跳过**）
   - 头脑风暴/探索 → `brainstorm`
   - 学习/阅读代码/跟读/follow → retained command `/maestro-learn follow ...`；调查/为什么/investigate → `/maestro-learn investigate ...`；分解/模式/decompose → `/maestro-learn decompose ...`；评审/挑战/second-opinion → `/maestro-learn consult ...`；回顾/retro → step `retrospective`
   - 正式规格/spec-generate/7-phase → `blueprint`
   - 项目初始化 → `init`
   - 宽/中等意图 + 无 session 上下文 → `analyze-macro`（产 scope_verdict，链内 `post-analyze-scope` decision 节点据此决定插入 roadmap+analyze 或直跳 plan --from analyze）
   - session 上下文 → `analyze --session {session}` → `plan --session {session}` → `execute --session {session}` → quality pipeline
   - 已有 analyze artifact 想直达执行 → `plan --from analyze:{ANL_ID}` → execute → quality pipeline
   - 已有 blueprint artifact → `plan --from blueprint:{BLP_ID}` → execute → quality pipeline
4. 执行 step：`Bash("maestro ralph skills --platform codex --steps --json --quiet")` 预校验 skill 名（命中 command、skill 或 step 任一即通过；生命周期 step 名 analyze/plan/execute/… 由 `--steps` 步骤注册表命中），命中记录到内存链的 step（未命中标 `missing`，建 chain-file 前阻断）；同时记 `stage` / `goal_ref` / `args`。decision 节点携 `decision_ref`，不预校验 command_path

### A_ROUTE_COMPANION

输出 `/maestro-companion "{intent}"` 作为轻量任务入口；本命令不创建 Session/Run chain，也不把 companion 当作 chain step。

### A_CLARIFY

1. `request_user_input` with parsed intent + available chain options
2. Re-classify with user response

### A_DECOMPOSE_TASKS

设 `session.decomposition_owner = "maestro"`。下游 ralph 只消费不二次提问（invariant 4）。Condensed:

1. 分类意图广度。narrow / 单步 / `{status,init}` 链跳过
2. broad/medium → `request_user_input` ≤3 轮：Scope / Constraints / Definition of Done
3. 派生 `execution_criteria` + `task_decomposition`（每个 sub-goal 含 `done_when` + `evidence` + `lifecycle` + `completion_confirmed: false`）
4. **session.json 唯一真源**：`boundary_contract` 随 `session create` 建入；`execution_criteria` / `task_decomposition` 装入 chain-file 的 `decomposition`（`execution_criteria` / `goals` / `changelog`）块；不生成 markdown 清单
5. 在最后一个 evidence-producing stage（execute/review/test）之后追加 `decision:post-goal-audit`（session 终结审计节点）。ralph-execute 在该节点按需 `session chain insert` 动态生长
6. **输出 `/goal` 绑定提示词（不阻塞，用户可在执行过程中随时输入）：**
   ```
   📋 任务分解完成。可随时复制下面一行设定目标（执行过程中输入即可）：

   /goal 完成以下子目标：
   {for each G in task_decomposition:}
   - {G.id}: {G.goal} — 完成条件: {G.done_when}
   {end for}
   达成条件: {session_dir}/session.json 中 orchestration.decomposition.goals[*].status == "done" 且 goals[*].completion_confirmed == true 且 chain[*].status ∈ {completed,sealed,skipped}。未达成时：阅读 {session_dir}/session.json 取得 orchestration.decomposition（execution_criteria / goals）/ boundary_contract / orchestration.chain 作为行动手册，调用 /maestro-ralph continue 推进；严禁手动执行 skill 或越界修改 boundary_contract.out_of_scope。
   ```

### A_STEP_DISPATCH

派发 executor agent。executor 内部调 `maestro run next --session {session}` 建 Run + 拿出生包并内联执行。模型同 maestro-ralph 的 A_STEP_DISPATCH。

> **单源上下文（不再手工拼装）**：`run next` 出生包单源提供上游产物、前一步 handoff、后续队列、handoff.next 推荐、按需参考与 goal；`run brief {run_id}` 为 skill 正文注入点。故不再读前序 completion_*、不再手工组装 `<goal_context>`。

1. **Resolve agent name（display 标识）**：`{stage_prefix}-{session_id_short}-{HHmmss}`（prefix: grl/brn/anm/ana/pln/exe/rev/tst/dbg/run）
2. **派发（unnamed executor）**：

```
spawn_agent({
  subagent_type: "ralph-executor",
  description: "执行 step {index}: {step.command} [{resolved_agent_name}]",
  prompt: `Session: {session_id}`
})
```

3. Display: `[{index}/{total}] ⟶ {step.command} → {resolved_agent_name}`（仅日志标识，不落 session state）
4. 等待 task-notification → agent_output

### A_MANUAL_STEP

[manual engine] 逐步确认执行。主 LLM 直接执行，无 Agent 派发、无 decision gates、无 drift 分析。

1. `maestro run next --session {session_id} --workflow-root .` — 出生包携 `run_id` / `run_dir` / `upstream`。NEVER call `run create`（birth-packet red line）。
2. Present step + chain progress (`step k/n`) → request_user_input:
   - **Execute** — 主 LLM 直接执行该步 workflow
   - **Skip this step** (`maestro session chain skip`)
   - **Modify step** (`maestro session chain replace`)
   - **Stop chain** — 暂停，后续可 `/maestro -c` 续接
3. 执行 workflow（按需 `maestro run brief --platform codex <run_id>` 加载 skill 正文），完成后 `maestro run complete <run_id> --verdict done --summary "..."` — chain step 原子推进。
4. Pending steps remain → offer **Continue next step**（loop to 1）or stop with continuation hint（`/maestro -c` 续接）。With `-y`: execute current step only, then stop with hint — never walk chain unattended。
5. No pending steps → chain completion summary（steps done/skipped, artifact paths）。

**与 ralph 引擎的区别：**
- 无 S_STEP_ANALYZE / S_STEP_DRIFT（不做信号提取和偏离分析）
- 无 S_DECISION_EVAL / S_APPLY_VERDICT（不插入 decision 节点）
- 无 Agent 派发（主 LLM 直接执行，节省 subagent 开销）
- 无 auto-retry（失败时由用户决定 retry/skip/abort）
- 共享 chain 基础设施：session create --chain-file / run next / run complete --verdict / session chain skip|replace

### A_STEP_EXTRACT

从 agent 返回提取信号（同 maestro-ralph A_STEP_EXTRACT）：

| Stage | 提取什么 | 组装参数 |
|-------|---------|---------|
| analyze | scope_verdict + key_findings | `--summary` |
| plan | TASK-*.json 数量 + 波次 | `--summary` |
| execute | 修改文件数 + verification | `--summary`, `--evidence` |
| review | verdict + findings + severity | `--summary`, `--decision` |
| test | pass/fail 统计 | `--summary`, `--evidence` |

组装 completion params：`--summary`（MUST，≤100 字），`--decision`/`--note`/`--evidence`（SHOULD）。

### A_STEP_DRIFT_ANALYZE

产物 vs 目标偏离分析（同 maestro-ralph A_STEP_DRIFT_ANALYZE）：

| drift_score | 动作 |
|-------------|------|
| ALIGNED | 正常 complete |
| MINOR_DRIFT | 偏离追加 `--note`，正常 complete |
| MAJOR_DRIFT + 未重试 | `maestro run complete --session {session} --verdict needs-retry` → 回 S_STEP_DISPATCH |
| MAJOR_DRIFT + 已重试 | `--verdict done-with-concerns` complete |

### A_STEP_COMPLETE

1. 使用 A_STEP_EXTRACT 组装的参数调 `Bash("maestro run complete --session {session} --verdict done --summary \"...\" [--evidence ...] [--decision ...] [--note ...]")`（免 run-id，自动解析当前 running 步；verdict 驱动链推进）
2. 上下文信号随 handoff 落 run.json，下一步 `run next` 出生包自源透出（不回写侧文件）
3. Display: `[{index}/{total}] ✓ {step.command} → {SUMMARY}`
4. Treat completion output as `suggest_only`; it does not allocate the next Run. Loop → S_STEP_LOCATE, where the next execution step is allocated only by the explicit `maestro run next --session {session}` call in A_STEP_DISPATCH.

### A_AGENT_EVALUATE

通过 Agent 评估质量门（同 maestro-ralph A_AGENT_EVALUATE）：

```
spawn_agent({  // generic agent — 评估类无专属定义，通过 prompt CONSTRAINTS 约束行为
  description: "评估 {decision} 质量门",
  prompt: "PURPOSE: 评估 {decision} 质量门结果
TASK: 读取结果文件 | 分析状态 | 评估严重性 | 给出建议
FILES: {result_file_paths}
SESSION: {session_dir}/session.json（orchestration 含 chain/position/decomposition）
EXPECTED:
---VERDICT---
STATUS: PASS|FAIL|PARTIAL|BLOCKED
REASON: <原因>
CONFIDENCE_SCORE: 0-100
---END---
CONSTRAINTS: 只评估不修改文件"
})
```

Parse verdict → 调整 → 写 decisions.ndjson（本地审计留痕）→ 裁决落盘经 `run decide`（见 A_APPLY_*）→ S_APPLY_VERDICT。
Parse 失败 → fallback fix + `parse_failed: true`（invariant 18）。

### A_AGENT_GOAL_AUDIT

子目标审计（同 maestro-ralph A_AGENT_GOAL_AUDIT）：Agent 读 `orchestration.decomposition.goals`，对照 evidence 判定 met/unmet。

### A_SCOPE_EVALUATE

post-analyze-scope 触发：读 macro analyze artifact → 提取 scope_verdict → 经 `session meta update --position-file -` 更新 `orchestration.position.scope_verdict`。

### A_APPLY_PROCEED / A_APPLY_FIX / A_APPLY_ESCALATE / A_APPLY_GOAL_FIX / A_APPLY_GOAL_DONE / A_APPLY_SCOPE_VERDICT

裁决落盘统一经 `maestro run decide {point_id} --session {session} --verdict proceed|fix|escalate --confidence high|medium|low`；链改经 `session chain insert|skip|replace`；decomposition/position 改经 `session meta update`（同 maestro-ralph）：

- **A_APPLY_PROCEED**: `run decide {point_id} --verdict proceed`（CLI 标 decision_point 完成并推进）
- **A_APPLY_FIX**: `run decide {point_id} --verdict fix`（CLI 自带 retry 计数）+ `session chain insert ... --inserted-by {gate名}` 逐条插 fix-loop 步
- **A_APPLY_ESCALATE**: `run decide {point_id} --verdict escalate` + `session chain insert --command debug --args "{gap}" --inserted-by {gate名}` + 插 decision 节点
- **A_APPLY_GOAL_FIX**: 每个 unmet 子目标 `session chain insert`（plan --gaps + execute，`--goal-ref G{n}`），追加 post-goal-audit {retry+1}；`run decide post-goal-audit --verdict fix`
- **A_APPLY_GOAL_DONE**: 重建整块 decomposition（`goals[*].status="done"`）提交 `session meta update --decomposition-file -`；`run decide post-goal-audit --verdict proceed`
- **A_APPLY_SCOPE_VERDICT**: 依据 scope_verdict 经 `session chain skip|replace` 重塑下游链路（同 maestro-ralph）

### A_RETRY / A_PAUSE_SESSION / A_COMPLETE_SESSION

- **A_RETRY**: `Bash("maestro run complete --session {session} --verdict needs-retry --reason \"...\"")`
- **A_PAUSE_SESSION**: `maestro run complete --session {session} --verdict blocked --reason "..."`
- **A_COMPLETE_SESSION**: 校验 chain 全 completed/sealed + `orchestration.decomposition.goals[*].status == "done"` → session 由 seal 流程置 `completed`

### A_CREATE_SESSION

经 `maestro session create` 建 session — **不直写 session.json**。

0. **Specs 预检**：当 chain 包含 `analyze-macro` / `analyze` / `plan` / `execute` 等执行 stage 且 `.workflow/specs/` 目录不存在时，在 steps 最前面插入 `spec-setup`（stage=`spec-setup`，无 decision）。确保下游可获得项目约束规则注入。chain ∈ {grill, brainstorm, blueprint, init, status} 时跳过
1. Read `.workflow/state.json` 获取 `active_session_id` / 匹配 `sessions[]`（含 D-007-S session 解析）；读最新 macro analyze artifact 取 `scope_verdict` + `analyze_macro_id`（如存在）；读最新 blueprint artifact 取 `blueprint_id`
2. Validate: 所有 step 的 skill 名预校验通过（`command_scope != "missing"`），否则 raise E005 列出缺失 skill（建 chain-file 前阻断）
3. 组装 chain-file JSON（内存链 → schema；`{session}`/`{intent}` 占位符由 A_STEP_RESOLVE_ARGS 运行时替换或直接 inline 已知值）：
   ```json
   {
     "intent": "{intent}", "engine": "{engine}",
     "quality_mode": "standard", "auto_mode": {auto_mode},
     "steps": [
       { "command": "analyze", "args": "--session {session}", "stage": "analyze", "goal_ref": "G1", "retry_max": 2 },
       { "command": "post-execute", "stage": "execute", "decision_ref": "post-execute" }
     ],
     "decision_points": [{ "point_id": "post-execute", "after_step_id": "step-001-execute", "max_retries": 2 }],
     "position": { "lifecycle": "{lifecycle}", "phase": null, "milestone": "",
       "planning_mode": "unified", "passed_gates": [], "scope_verdict": "{scope_verdict}" },
     "decomposition": { "execution_criteria": [...], "goals": [...task_decomposition], "changelog": [] },
     "executor": { "platform": "claude", "cli_tool": "claude" }
   }
   ```
   - `{engine}` = `--engine` flag 值（default `ralph`）。
   - **manual engine 简化**：当 `engine == "manual"` 时，省略 `decision_points[]`、`decomposition` 块、step 中的 `decision_ref`/`retry_max`。steps 仅保留 `command`/`args`/`stage`。
   - decision 节点（ralph only）：`step` 携 `decision_ref`（CLI 标为 decision node，不建 Run）；`decision_points[]` 声明重试预算。
   - `boundary_contract` 随建入（decomposition_owner=maestro 语义由 orchestration.decomposition 承载；下游 ralph 见非空即只消费）。
4. 调 `Bash("printf '%s' '{chain_json}' | maestro session create maestro-{slug} --intent \"{intent}\" --engine {engine} --chain-file -")`。返回 `session_id` + `next: maestro run next --session {id}`。
5. Initialize tracking via `update_plan`
6. If `--super`: read `maestro-super.md`, follow it completely

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
- [ ] D-007-S: unique running topic locator only；historical similarity 只读且不产生 mutation action；同 Session sealed outputs 仅经 canonical upstream 复用
- [ ] macro analyze 后跟 `decision:post-analyze-scope`（decision 节点评估 scope_verdict 决定下游链路）
- [ ] plan 支持 `--session {session}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}` 三路径；chain step args 携出处
- [ ] Broad lifecycle intents decomposed (≤3 boundary questions); narrow/single-step skip
- [ ] session.json orchestration 唯一真源；无 markdown 清单；post-goal-audit 节点在 decomposed 时追加；/goal 提示词以 session.json 为判据
- [ ] Specs 预检：chain 含执行 stage + `.workflow/specs/` 不存在 → steps 最前面插入 `spec-setup`
- [ ] Chain selected and confirmed (or auto-confirmed)
- [ ] Session created via `session create --chain-file` before execution; decomposition 随 chain-file 建入
- [ ] 执行 step 携 `command`/`args`/`stage`/`goal_ref`/`retry`；decision step 由 `decision_ref` 标识
- [ ] skill 名由 `maestro ralph skills --platform codex --steps --json --quiet` 预校验（project 覆盖 global，含步骤注册表），缺失阻断建链
- [ ] Session schema 为 `session/1.2`、Run schema 为 `command-run/1.2`；旧版兼容读，contract v2 显式 opt-in
- [ ] 用户传入 `-y` 时透传到 skill args
- [ ] All chains dispatched via spawn_agent(ralph-executor) — maestro 拥有完整执行循环
- [ ] One agent per step — unnamed spawn_agent({ task_name: "<task_name>", message: "<message>", agent_type: "ralph_executor" }) 派发
- [ ] Executor 结果通过 task-notification 回传主流程
- [ ] 主流程调 `maestro run complete --verdict`（免 run-id）上报（非 agent 上报）
- [ ] Decision 节点通过 Agent 评估、经 `run decide` 落盘，不 handoff 到其他 skill
- [ ] drift_score 分析：ALIGNED/MINOR_DRIFT → complete；MAJOR_DRIFT → needs-retry/done-with-concerns
- [ ] Low-complexity intents routed to `/maestro-companion`
- [ ] (super) Requirements validated before roadmap
- [ ] (super) Each session scored >= 80%
- [ ] (compose) `--compose` produces a validated template (≤20 nodes, acyclic, no orphans) written to `~/.maestro/templates/workflows/` + index; drafts preserved on abandon
- [ ] (play) `--play <template>` binds context, topologically sorts nodes → chain-file steps（`session create --chain-file`）, and dispatches via spawn_agent(ralph-executor) 执行循环; `--list`/`--dry-run` short-circuit

</appendix>
