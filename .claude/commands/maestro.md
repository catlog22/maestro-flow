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
  - AskUserQuestion
  - TodoWrite
---
<purpose>
Orchestrate all maestro commands: classify intent → select chain → create session → dispatch to `maestro-ralph-execute`.
Session: `.workflow/.maestro/{session_id}/status.json`.
</purpose>

<deferred_reading>
- [maestro.md](~/.maestro/workflows/maestro.md) — read at execution start for intent analysis + chain selection
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Keywords:** `continue`/`next`/`go` → state-based routing; `status` → `Skill("manage-status")`

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors
- `-c` / `--continue` — Resume previous session
- `--dry-run` — Show chain without executing
- `--super` — Read and follow `maestro-super.md`
</context>

<invariants>
1. **All chains dispatch via maestro-ralph-execute** — maestro never executes steps directly
2. **Session before execution** — status.json created before any step runs
3. **Auto flag pass-through** — 仅当用户传入 `-y` 时透传 `-y` 到 skill args
4. **Decomposition contract shared with maestro-ralph** — broad/lifecycle intents run S_DECOMPOSE producing the SAME additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`)。Reference maestro-ralph `A_DECOMPOSE_TASKS`
5. **status.json 唯一真源** — 不生成 `goal-checklist.md` 或外部清单
6. **执行步骤统一通过 `maestro ralph next` 加载** — `command_scope`/`command_path` 由 `maestro ralph skills --platform claude --json --quiet` 预校验（project 覆盖 global，限定 `.claude/`）；decision 节点不走 CLI，走 `Skill("maestro-ralph")` handoff
7. **Topology awareness** — chain catalog 含 grill / brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute / ...；scope_verdict 由 ralph 在 `post-analyze-scope` 决定
8. **Grill is interactive-only** — `-y` auto mode MUST skip grill stage and route directly to brainstorm; grill requires Socratic Q&A with the user
9. **D-007 milestone 反查** — 数字 phase 的 `milestone_id` 由 `state.json.milestones[].phase_slugs` 反查
10. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE|DONE_WITH_CONCERNS` 写入
11. **schema** — `ralph_protocol_version: "1"` 标记 CLI-driven session；新增字段全部可选
12. **Invariant violation = BLOCK** — 违反上述任一 invariant 即阻断当前操作，不可绕过。特别是 invariant 1（dispatch via ralph-execute）和 invariant 2（session before execution）和 invariant 10（completion_confirmed 由 CLI 写入）为硬约束。
14. **禁止以上下文消耗为由中断执行** — harness 自动处理 context compression，以"上下文不足"或"避免 context overflow"为由中断属于 invariant violation
13. **Classification evidence** — S_CLASSIFY 的 chain 选择决策 MUST 记录到 status.json 的 `classification_rationale` 字段：匹配了哪个 pattern、排除了哪些备选、confidence level。无记录的分类不可进入 S_CREATE。
</invariants>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags                PERSIST: —
S_RESUME        — 扫描已有 session、恢复执行           PERSIST: —
S_CLASSIFY      — 意图分类、chain 选择                 PERSIST: —
S_DECOMPOSE     — 边界澄清、写执行准则+子目标清单       PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_CREATE        — 创建 session + status.json           PERSIST: session (全量)
S_DRY_RUN       — 显示 chain 后结束                    PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）            PERSIST: —
S_DISPATCH      — 移交 maestro-ralph-execute           PERSIST: —
S_FALLBACK      — 意图无法分类、请求输入                PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_RESUME      WHEN: -c / --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_CLASSIFY    WHEN: keyword "continue"/"next"/"go"    DO: A_STATE_BASED_ROUTE
  → S_FALLBACK    WHEN: no intent AND no flags

S_RESUME:
  → S_DISPATCH    WHEN: session found                     DO: A_LOCATE_SESSION
  → S_FALLBACK    WHEN: no session found

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
  → END           DO: Skill({ skill: "maestro-ralph-execute" })

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent           DO: AskUserQuestion
  → END           WHEN: user cancels

</transitions>

<actions>

### A_STATE_BASED_ROUTE

1. Read `.workflow/state.json` → determine next logical step
2. Convert to equivalent intent for chain classification

### A_LOCATE_SESSION

1. Scan `.workflow/.maestro/*/status.json`, filter `status == "running"`, sort DESC
2. Take most recent; if not found → S_FALLBACK

### A_CLASSIFY_INTENT

1. Read `~/.maestro/workflows/maestro.md` from deferred_reading
2. Match intent to task_type via chain catalog (semantic)
3. Select chain from chainMap，遵循拓扑约束：
   - 压力测试/拷问/验证假设/grill/stress-test → `grill`（**-y 模式跳过 grill，直接走 brainstorm**）
   - 头脑风暴/探索 → `brainstorm`
   - 学习/阅读代码/跟读/follow → `Skill("learn-follow")`；调查/为什么/investigate → `Skill("learn-investigate")`；分解/模式/decompose → `Skill("learn-decompose")`；评审/挑战/second-opinion → `Skill("learn-second-opinion")`；回顾/retro → `Skill("quality-retrospective")`
   - 正式规格/spec-generate/7-phase → `blueprint`
   - 项目初始化 → `init`
   - 宽/中等意图 + 无数字 phase → `analyze-macro`（产 scope_verdict，由 ralph 在 `post-analyze-scope` 决定是否插入 roadmap+analyze 或直跳 plan --from analyze）
   - 数字 phase 上下文 → `analyze {phase}` → `plan {phase}` → `execute {phase}` → quality pipeline
   - 已有 analyze artifact 想直达执行 → `plan --from analyze:{ANL_ID}` → execute → quality pipeline
   - 已有 blueprint artifact → `plan --from blueprint:{BLP_ID}` → execute → quality pipeline
4. 执行 step：`Bash("maestro ralph skills --platform claude --json --quiet")` 预校验 skill 名，命中写绝对路径到 `command_path`，未命中标 `missing`；同时写 `step.stage` / `step.scope` / `step.source_artifact_ref`。decision 节点不解析 command_path

### A_CLARIFY

1. `AskUserQuestion` with parsed intent + available chain options
2. Re-classify with user response

### A_DECOMPOSE_TASKS

与 maestro-ralph `A_DECOMPOSE_TASKS` 共享分解契约。Condensed:

1. 分类意图广度。narrow / 单步 / `{status,init,quick}` 链跳过
2. broad/medium → `AskUserQuestion` ≤3 轮：Scope / Constraints / Definition of Done
3. 派生 `execution_criteria` + `task_decomposition`（每个 sub-goal 含 `done_when` + `evidence` + `lifecycle` + `completion_confirmed: false`）
4. **status.json 唯一真源**：写入 `boundary_contract` / `execution_criteria` / `task_decomposition`；不生成 markdown 清单
5. 在最后一个 evidence-producing stage（execute/review/test）之后、`milestone-complete` 之前追加 `decision:post-goal-audit`。ralph-execute 在该节点按需动态生长 `steps[]`
6. **输出 `/goal` 绑定提示词（不阻塞，用户可在执行过程中随时输入）：**
   ```
   📋 任务分解完成。可随时复制下面一行设定目标（执行过程中输入即可）：

   /goal 完成以下子目标：
   {for each G in task_decomposition:}
   - {G.id}: {G.goal} — 完成条件: {G.done_when}
   {end for}
   达成条件: {session_dir}/status.json 中 task_decomposition[*].status == "done" 且 task_decomposition[*].completion_confirmed == true 且 steps[*].completion_confirmed == true。未达成时：阅读 {session_dir}/status.json 取得 execution_criteria / boundary_contract / task_decomposition / steps 作为行动手册，调用 /maestro-ralph continue 推进；严禁手动执行 skill 或越界修改 status.json.boundary_contract.out_of_scope。
   ```

### A_CREATE_SESSION

0. **Specs 预检**：当 chain 包含 `analyze-macro` / `analyze` / `plan` / `execute` 等执行 stage 且 `.workflow/specs/` 目录不存在时，在 steps 最前面插入 `spec-setup`（stage=`spec-setup`，无 decision）。确保下游可获得项目约束规则注入。chain ∈ {grill, brainstorm, blueprint, init, status, quick} 时跳过
1. Read `.workflow/state.json` 获取 phase / milestone（含 D-007 反查 `phase_slugs`）；读最新 macro analyze artifact 注入 `scope_verdict` + `analyze_macro_id`（如存在）；读最新 blueprint artifact 注入 `blueprint_id`
2. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`（与 ralph 共用 schema）：
   ```json
   {
     "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "ralph_protocol_version": "1", "active_step_index": null,
     "phase", "phase_is_new": false, "milestone": "",
     "scope_verdict": null, "analyze_macro_id": null, "blueprint_id": null,
     "auto_mode": false, "cli_tool": "claude",
     "context": { "scratch_dir": null, "plan_dir": null, "analysis_dir": null,
       "brainstorm_dir": null, "blueprint_dir": null, "issue_id": null },
     "steps": [{
       "index": 0, "skill": "", "args": "",
       "stage": "", "scope": null, "decision": null,
       "command_scope": "global|project|missing|null", "command_path": "<abs> | null",
       "milestone_id": null, "source_artifact_ref": null,
       "status": "pending", "goal_ref": null,
       "completion_confirmed": false, "completion_status": null,
       "completion_evidence": null, "completed_at": null,
       "deferred_reads": [], "load": null
     }],
     "waves": [], "current_step": 0, "status": "running",
     "boundary_contract": {}, "execution_criteria": [],
     "task_decomposition": [], "task_decomposition_all_done": false
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
- [ ] `-y` 模式不触发 grill（交互式压力测试不支持自动模式，跳过直接走 brainstorm）
- [ ] D-007: 数字 phase 步骤的 `milestone_id` 通过 `state.json.milestones[].phase_slugs` 反查
- [ ] macro analyze 后跟 `decision:post-analyze-scope`（由 ralph 评估 scope_verdict 决定下游链路）
- [ ] plan 支持 `{phase}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}` 三路径；`source_artifact_ref` 写入 step
- [ ] Broad lifecycle intents decomposed (≤3 boundary questions); narrow/single-step skip
- [ ] status.json 唯一真源；无 markdown 清单；post-goal-audit 节点在 decomposed 时追加；/goal 提示词以 status.json 为判据
- [ ] Specs 预检：chain 含执行 stage + `.workflow/specs/` 不存在 → steps 最前面插入 `spec-setup`
- [ ] Chain selected and confirmed (or auto-confirmed)
- [ ] Session dir created with status.json before execution; decomposition fields additive-only
- [ ] 执行 step 含 `command_scope` + `command_path` + `completion_confirmed`；decision step 由 `step.decision` 标识
- [ ] `command_scope`/`command_path` 由 `maestro ralph skills --platform claude --json --quiet` 预校验（project 覆盖 global）
- [ ] Session schema 含 `ralph_protocol_version: "1"` + `active_step_index: null` + step.load 占位
- [ ] 用户传入 `-y` 时透传到 skill args
- [ ] All chains dispatched via maestro-ralph-execute
- [ ] Low-complexity intents routed to maestro-quick
- [ ] (super) Requirements validated before roadmap
- [ ] (super) Each milestone scored >= 80%

</appendix>
