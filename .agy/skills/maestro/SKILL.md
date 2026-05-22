---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: <intent> [-y] [-c] [--dry-run] [--super]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Orchestrate all maestro commands based on user intent and project state.
Classify intent → select chain → create session → dispatch to `maestro-ralph-execute`.

Entry points:
- **`/maestro "intent"`** — Intent-based: classify → chain → execute
- **`/maestro -c`** — Resume previous session
- **`/maestro --dry-run "intent"`** — Show chain, no execution
- **`/maestro --super "intent"`** — Production-ready mode (read maestro-super.md)

Session: `.workflow/.maestro/{session_id}/status.json`
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
6. **执行步骤统一 Read .md 内联** — chain 内每个执行 step 解析 `command_scope`/`command_path`（全局优先 `~/.claude/commands/{name}.md`，fallback 项目），由 ralph-execute `view_file({command_path})` 内联执行；CLI 仅在 decision 节点做只读分析
7. **Topology awareness** — chain catalog 含 brainstorm / blueprint / analyze-macro(text) / analyze(numeric phase) / roadmap / plan(三路径) / execute / verify / ...；scope_verdict 路由由 ralph 在 `post-analyze-scope` 决定
8. **D-007 milestone 反查** — 数字 phase 步骤的 `milestone_id` 由 `state.json.milestones[].phase_slugs` 反查得出
9. **每个 step 必须 `completion_confirmed: true`** — 基于 `--- COMPLETION STATUS ---` 的 `STATUS: DONE`
10. **schema 向后兼容** — 新增字段全部可选；既有字段名不删不改
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
  → END           DO: view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph-execute/SKILL.md") + execute inline

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent           DO: ask_question
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
   - 头脑风暴/探索 → `brainstorm`
   - 正式规格/spec-generate/7-phase → `blueprint`
   - 项目初始化 → `init`
   - 宽/中等意图 + 无数字 phase → `analyze-macro`（产 scope_verdict，由 ralph 在 `post-analyze-scope` 决定是否插入 roadmap+analyze 或直跳 plan --from analyze）
   - 数字 phase 上下文 → `analyze {phase}` → `plan {phase}` → `execute {phase}` → `verify {phase}` → quality pipeline
   - 已有 analyze artifact 想直达执行 → `plan --from analyze:{ANL_ID}` → execute → verify
   - 已有 blueprint artifact → `plan --from blueprint:{BLP_ID}` → execute → verify
4. 执行 step 解析 `command_scope` + `command_path`（全局优先 fallback 项目）；写入 `step.stage` / `step.scope` / `step.source_artifact_ref`（如 `--from` 注入时）。decision 节点通过 `step.decision` 字段标识

### A_CLARIFY

1. `ask_question` with parsed intent + available chain options
2. Re-classify with user response

### A_DECOMPOSE_TASKS

与 maestro-ralph `A_DECOMPOSE_TASKS` 共享分解契约。Condensed:

1. 分类意图广度。narrow / 单步 / `{status,init,quick}` 链跳过
2. broad/medium → `ask_question` ≤3 轮：Scope / Constraints / Definition of Done
3. 派生 `execution_criteria` + `task_decomposition`（每个 sub-goal 含 `done_when` + `evidence` + `lifecycle` + `completion_confirmed: false`）
4. **status.json 唯一真源**：写入 `boundary_contract` / `execution_criteria` / `task_decomposition`；不生成 markdown 清单
5. 在最后一个 evidence-producing stage（verify/review/test）之后、`milestone-complete` 之前追加 `decision:post-goal-audit`。ralph-execute 在该节点按需动态生长 `steps[]`
6. **输出 `/goal` 绑定提示词（不阻塞，用户可在执行过程中随时输入）：**
   ```
   📋 任务分解完成。可随时复制下面一行设定目标（执行过程中输入即可）：

   /goal 目标达成条件: {session_dir}/status.json 中 task_decomposition[*].status == "done" 且 task_decomposition[*].completion_confirmed == true 且 steps[*].completion_confirmed == true。未达成时：阅读 {session_dir}/status.json 取得 execution_criteria / boundary_contract / task_decomposition / steps 作为行动手册，调用 /maestro-ralph continue 推进；严禁手动执行 skill 或越界修改 status.json.boundary_contract.out_of_scope。
   ```

### A_CREATE_SESSION

1. Read `.workflow/state.json` 获取 phase / milestone（含 D-007 反查 `phase_slugs`）；读最新 macro analyze artifact 注入 `scope_verdict` + `analyze_macro_id`（如存在）；读最新 blueprint artifact 注入 `blueprint_id`
2. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`（与 ralph 共用 schema）：
   ```json
   {
     "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "phase", "phase_is_new": false, "milestone": "",
     "scope_verdict": null, "analyze_macro_id": null, "blueprint_id": null,
     "auto_mode": false, "cli_tool": "claude",   // cli_tool: decision 节点 delegate 评估时的 CLI 工具
     "context": { "scratch_dir": null, "plan_dir": null, "analysis_dir": null,
       "brainstorm_dir": null, "blueprint_dir": null, "issue_id": null },
     "steps": [{
       "index": 0,
       "skill": "", "args": "",
       "stage": "", "scope": null,
       "decision": null,                 // 非 null → decision 节点；null → 执行节点
       "command_scope": "global|project|missing|null",
       "command_path": "~/.claude/commands/{name}.md | .claude/commands/{name}.md | null",
       "milestone_id": null, "source_artifact_ref": null,
       "status": "pending", "goal_ref": null,
       "completion_confirmed": false, "completion_status": null,
       "completion_evidence": null, "completed_at": null
     }],
     "waves": [], "current_step": 0, "status": "running",
     "boundary_contract": {}, "execution_criteria": [],
     "task_decomposition": [], "task_decomposition_all_done": false
   }
   ```
   Decomposition 字段仅在 A_DECOMPOSE_TASKS 产出时写入（additive）
3. Validate: 所有 step 的 `command_scope != "missing"`；否则 raise E005 列出缺失 skill
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
- [ ] Chain catalog 覆盖 brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute / verify / quality pipeline
- [ ] D-007: 数字 phase 步骤的 `milestone_id` 通过 `state.json.milestones[].phase_slugs` 反查
- [ ] macro analyze 后跟 `decision:post-analyze-scope`（由 ralph 评估 scope_verdict 决定下游链路）
- [ ] plan 支持 `{phase}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}` 三路径；`source_artifact_ref` 写入 step
- [ ] Broad lifecycle intents decomposed (≤3 boundary questions); narrow/single-step skip
- [ ] status.json 唯一真源；无 markdown 清单；post-goal-audit 节点在 decomposed 时追加；/goal 提示词以 status.json 为判据
- [ ] Chain selected and confirmed (or auto-confirmed)
- [ ] Session dir created with status.json before execution; decomposition fields additive-only
- [ ] 执行 step 含 `command_scope` + `command_path` + `completion_confirmed` 字段；decision step 通过 `step.decision` 字段标识
- [ ] 用户传入 `-y` 时透传到 skill args
- [ ] All chains dispatched via maestro-ralph-execute
- [ ] Low-complexity intents routed to maestro-quick
- [ ] (super) Requirements validated before roadmap
- [ ] (super) Each milestone scored >= 80%

</appendix>
