---
name: maestro-ralph-beta
description: Self-running loop controller for adaptive maestro workflow — build, tick, decide in one skill
argument-hint: "<intent> [-y] | continue | status"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - request_user_input
---
<purpose>
Closed-loop runner for the maestro workflow lifecycle.
Single skill — every invocation routes by session state, executes one tick, and self-invokes `$maestro-ralph-beta` until all `completion_confirmed` or paused.

Entry points:
- **`$maestro-ralph-beta "intent"`** — New session: infer → decompose → build → tick
- **`$maestro-ralph-beta continue`** — Resume: locate session → tick
- **`$maestro-ralph-beta status`** — Display session progress

Tick kinds:
- **执行 step** (`step.decision == null`): `maestro ralph next` → inline → `maestro ralph complete` → self-invoke
- **decision step** (`step.decision != null`): inline evaluate → apply verdict → self-invoke

Session: `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag       → auto_confirm = true
.md/.txt path → input_doc (supplementary context only, NEVER substitutes lifecycle stages)
"status"      → status mode
"continue"    → resume mode
Remaining     → intent (new session)
```

**State files:**
- `.workflow/state.json` — artifact registry, milestones, phases
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/.maestro/ralph-*/status.json` — ralph session state
</context>

<invariants>
1. **Self-invocation = `$maestro-ralph-beta`** — 每次 tick 末尾强制自调用；除非 router 命中终止条件
2. **status.json 是唯一真源；写入权限分层**：
   - **Step 级字段**（`step.completion_*`, `step.status` 执行 step running↔completed, `step.load.*`, `step.retried`，以及执行 step 的 `active_step_index` 占用/释放）→ 由 `maestro ralph next/complete/retry` CLI 写入
   - **会话级结构**（`session.status`, `passed_gates`, `steps[]` 增删/reindex, `task_decomposition[*]`, `boundary_contract`, `context.*`, `scope_verdict`, `consec_exit2_count`, decision step 的 `status`/`retry_count`/`active_step_index` 占用与释放）→ 由 maestro-ralph-beta 写入
3. **执行 step 通过 `maestro ralph next` 加载** — CLI 解析 frontmatter + `<required_reading>` + `<deferred_reading>`、读 required 全文、拼 prompt、写 `step.load.*` + `active_step_index` + `step.status="running"`
4. **decision step 内联评估** — 不 handoff、不调 ralph next；按 `step.decision` 分派 A_DECISION_*
5. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE|DONE_WITH_CONCERNS` 写入；STATUS 仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`
6. **command_path 在 A_BUILD_STEPS 解析** — 通过 `maestro ralph skills --platform codex --json --quiet` 预校验（project 覆盖 global，只扫描 `.codex/skills/`）；未命中标 `command_scope = "missing"`
7. **required reading 由 CLI 加载** — 缺失 → 退出码 1（E007）→ pause session；ralph build 阶段不读 .md 内容
8. **active_step_index 一致性由 CLI 维护** — 同一 session 同时最多一个 step 持有；E008/E009 直接退出
9. **Decomposition is outcome-oriented** — sub-goals 为可观测交付，禁止 lifecycle 复刻；`/goal` 由用户输入
10. **planning_mode governs arg granularity** — `unified` → skill args 无 `{phase}`；`independent` → 含 `{phase}`
11. **task_decomposition 驱动 steps[] 动态生长** — `post-goal-audit` 按 unmet 子目标插入 scoped mini-loop；字段累加，既有字段不删不改
</invariants>

<router>

每次进入 skill 先执行 router，按顺序匹配，先命中先用。术语：
- **active session** = `.workflow/.maestro/ralph-*/status.json` 中 `status ∈ {running, paused}` 的最新会话
- **live session** = active session 且 `status == "running"`
- **active_step** = `session.steps[session.active_step_index]`

```
1. intent == "status"                                          → S_STATUS                  → END
2. intent == "continue" AND active session exists              → A_RESUME_SESSION → S_TICK_LOCATE
3. intent non-empty AND intent ∉ {"continue","status"} AND active session exists
                                                               → S_FALLBACK                → END
   display "已有 active session {id}；先 $maestro-ralph-beta continue 续跑或显式 abandon"
4. live session AND active_step.status == "running" AND active_step.decision != null
                                                               → S_TICK_LOCATE → S_TICK_DECISION
5. live session AND has pending step                            → S_TICK_LOCATE
6. live session AND all completion_confirmed                   → S_COMPLETE                → END
7. active session AND session.status == "paused" AND no intent → S_FALLBACK                → END
   display "Session {id} paused；输入 $maestro-ralph-beta continue 显式恢复"
8. no active session AND intent non-empty                      → S_BUILD_PHASE
9. no active session AND no intent                             → S_FALLBACK                → END
```

</router>

<state_machine>

<states>
# Build phase (one-time per session)
S_RESOLVE_PHASE   — 解析 phase + phase_is_new + D-007 milestone   PERSIST: session.phase, session.phase_is_new, session.milestone
S_INFER           — 推断 lifecycle_position                       PERSIST: session.lifecycle_position
S_RESOLVE_SCOPE   — 读 macro analyze conclusions.scope_verdict    PERSIST: session.scope_verdict, session.analyze_macro_id
S_QUALITY_MODE    — 决定质量管线模式                              PERSIST: session.quality_mode
S_PLANNING_MODE   — 决定统一/独立规划模式                         PERSIST: session.planning_mode
S_DECOMPOSE       — 边界澄清、写执行准则+子目标清单                PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_BUILD_CHAIN     — 构建步骤链                                    PERSIST: session.steps[]
S_CREATE_SESSION  — 写 status.json                                PERSIST: session (全量)
S_CONFIRM         — 用户确认                                      PERSIST: —

# Tick phase (per step)
S_TICK_LOCATE     — 定位 session + 找 active step                 PERSIST: —
S_TICK            — 分派执行 step 或 decision step                 PERSIST: step.status, active_step_index
S_TICK_EXEC       — 执行 step：ralph next → inline → ralph complete PERSIST: via CLI
S_TICK_DECISION   — decision step：内联评估 + 应用裁决             PERSIST: session.steps[], passed_gates, decisions.ndjson
S_HANDLE_FAIL     — 处理执行失败                                  PERSIST: step.status, session.status

# Terminal
S_STATUS          — 显示 session 进度                             PERSIST: —
S_COMPLETE        — 收尾                                          PERSIST: session.status = "completed"
S_FALLBACK        — 引导用户输入或退出                            PERSIST: —
</states>

<transitions>

# === Build phase ===

S_BUILD_PHASE (entry):
  → S_RESOLVE_PHASE

S_RESOLVE_PHASE:
  → S_INFER         WHEN: phase resolved or null           DO: A_RESOLVE_PHASE
  → S_FALLBACK      WHEN: ambiguous
                     GUARD: auto_confirm does NOT skip phase ambiguity

S_INFER:
  → S_RESOLVE_SCOPE WHEN: position resolved                DO: A_INFER_POSITION
  → S_FALLBACK      WHEN: cannot infer

S_RESOLVE_SCOPE:
  → S_QUALITY_MODE  DO: A_RESOLVE_SCOPE_VERDICT
                     GUARD: position ∈ {brainstorm, blueprint, init} → skip (scope_verdict = null)

S_QUALITY_MODE:
  → S_PLANNING_MODE DO: A_DETERMINE_QUALITY_MODE

S_PLANNING_MODE:
  → S_DECOMPOSE     DO: A_DETERMINE_PLANNING_MODE
                     GUARD: lifecycle_position ∈ {brainstorm, blueprint, init, analyze-macro, roadmap} → skip (force independent)

S_DECOMPOSE:
  → S_BUILD_CHAIN   DO: A_DECOMPOSE_TASKS
                     GUARD: broad intent → MUST clarify boundary even if auto_confirm
                     GUARD: narrow intent → auto-derive, skip questions
                     GUARD: position ∈ {brainstorm, blueprint, init} → skip decomposition

S_BUILD_CHAIN:
  → S_CREATE_SESSION DO: A_BUILD_STEPS

S_CREATE_SESSION:
  → S_CONFIRM       WHEN: not auto_confirm                 DO: A_CREATE_SESSION
  → S_TICK_LOCATE   WHEN: auto_confirm                     DO: A_CREATE_SESSION + $maestro-ralph-beta

S_CONFIRM:
  → S_TICK_LOCATE   WHEN: user selects "Proceed"           DO: $maestro-ralph-beta
  → S_BUILD_CHAIN   WHEN: user selects "Edit"
  → END             WHEN: user selects "Cancel"

# === Tick phase ===

S_TICK_LOCATE: Entry: A_LOCATE_SESSION
  → S_TICK          WHEN: next_pending_step != null
  → S_COMPLETE      WHEN: next_pending_step == null
  → S_FALLBACK      WHEN: no active session

S_TICK:
  → S_TICK_DECISION WHEN: next_pending_step.decision != null   DO: A_CLAIM_DECISION
  → S_TICK_EXEC     WHEN: next_pending_step.decision == null   DO: A_RESOLVE_ARGS

S_TICK_EXEC: Entry: A_EXEC_STEP
  → S_TICK_LOCATE   WHEN: ralph complete with DONE|DONE_WITH_CONCERNS   DO: $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: ralph next exit == 2                          DO: $maestro-ralph-beta
  → S_HANDLE_FAIL   WHEN: ralph next exit == 1 OR exit >= 3
  → S_HANDLE_FAIL   WHEN: ralph complete with NEEDS_RETRY|BLOCKED

S_TICK_DECISION: (gate 名取自 `step.decision`)
  → S_TICK_APPLY    WHEN: quality-gate (post-execute, post-business-test, post-review, post-test)
                     DO: A_DELEGATE_EVALUATE
  → S_TICK_APPLY    WHEN: goal-gate (post-goal-audit)
                     DO: A_GOAL_AUDIT_EVALUATE
  → S_TICK_APPLY    WHEN: scope-gate (post-analyze-scope)
                     DO: A_SCOPE_EVALUATE
  → S_TICK_APPLY    WHEN: structural (post-milestone, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_TICK_APPLY:
  → S_TICK_LOCATE   WHEN: verdict == "proceed"                          DO: A_APPLY_PROCEED + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: post-goal-audit + unmet sub-goals              DO: A_APPLY_GOAL_FIX + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: post-goal-audit + all sub-goals met            DO: A_APPLY_GOAL_DONE + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: post-analyze-scope                             DO: A_APPLY_SCOPE_VERDICT + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: verdict == "fix"                              DO: A_APPLY_FIX + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: verdict == "escalate"                         DO: A_APPLY_ESCALATE + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: post-milestone + standard + next milestone    DO: A_ADVANCE_MILESTONE + $maestro-ralph-beta
  → END             WHEN: post-milestone + standard + no next milestone DO: mark completed
  → END             WHEN: post-milestone + adhoc                        DO: mark completed (adhoc self-contained)
  → END             WHEN: post-debug-escalate (always STOP)              DO: A_PAUSE_ESCALATE
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → request_user_input with override options

S_HANDLE_FAIL:
  → S_TICK_LOCATE   WHEN: auto + not retried                            DO: A_RETRY + $maestro-ralph-beta
  → END             WHEN: auto + retried                                DO: A_PAUSE_SESSION
  → S_TICK_LOCATE   WHEN: interactive + user selects retry              DO: A_RETRY + $maestro-ralph-beta
  → S_TICK_LOCATE   WHEN: interactive + user selects skip               DO: A_SKIP_STEP + $maestro-ralph-beta
  → END             WHEN: interactive + user selects abort              DO: A_PAUSE_SESSION

# === Terminal ===

S_STATUS:
  → END             DO: A_SHOW_STATUS

S_COMPLETE:
  → END             DO: A_COMPLETE_SESSION

S_FALLBACK:
  → S_BUILD_PHASE   WHEN: user provides intent (no active session)      DO: request_user_input
  → S_TICK_LOCATE   WHEN: user selects "continue active session"         DO: A_RESUME_SESSION + $maestro-ralph-beta
  → END             WHEN: user cancels OR no active session for resume

</transitions>

<actions>

### A_SHOW_STATUS

1. Find latest ralph session (by created_at)
2. Display: Session, Status, Position, Progress, Current step
3. List steps: [✓] completion_confirmed, [▸] current, [ ] pending, [◆] decision（`step.decision` 非空）；执行 step 附 `command_scope`(global/project) + `command_path`
4. If `task_decomposition` present (absent → skip):
   ```
   Sub-goals  ({done}/{total})    source: {session_dir}/status.json#/task_decomposition
   [x] G1 done_when={done_when}   evidence={evidence}   confirmed={completion_confirmed}
   [ ] G2 done_when={done_when}   evidence={evidence}   confirmed=false ◀ unmet
   ```

### A_RESOLVE_PHASE

产出 `phase` + `phase_is_new` + `milestone`（D-007 反查）。

**Priority:**

| Step | 行为 | phase_is_new |
|------|------|--------------|
| 1 | intent 匹配 `phase\s*(\d+)` → 取 state.json 对应 phase | false |
| 2 | intent 派生短语 → 在 `state.json.milestones[*].phase_slugs` / `artifacts[*].path` 查找 | false (匹配) / true (无匹配) |
| 3 | 未派生 → 取最新 in-progress artifact 的 phase | false |
| 4 | 仍无 → state.json 首个 incomplete phase | false |
| 5 | position 将是 brainstorm/blueprint/init/roadmap/analyze-macro → phase = null | n/a |
| 6 | 仍模糊 → `request_user_input` | 由用户回答确定 |

**D-007 Phase→Milestone 反查**（数字 phase 已解析时）：
```
resolve_milestone(phase_number):
  for ms in state.json.milestones:
    if str(phase_number) in ms.phase_slugs: return ms.id
  return state.json.current_milestone   # fallback
```
写入 `session.milestone`。

**写入 session**: `phase`, `phase_is_new`, `milestone`。

**新派生 phase 时 milestone 处理**：
- state.json 当前 milestone 仍 active → 沿用，新增 phase
- intent 派生新 milestone 名 → 写入 session 仅作标签；`state.json.milestones` 由 `maestro-roadmap` / `maestro-milestone-release` 创建

### A_INFER_POSITION

**Intent-based overrides** (按顺序匹配，先命中先用):

| Pattern | Position |
|---------|----------|
| brainstorm / 头脑风暴 / 探索 / ideate / 设计思路 | `brainstorm` |
| blueprint / 规格 / 正式文档 / spec-generate / 7-phase | `blueprint` |
| broad/medium intent 无数字 phase (重构/全面/重写/迁移/新功能 X) | `analyze-macro` |

**Bootstrap detection:**

| Condition | Position |
|-----------|----------|
| No `.workflow/` + no source files | `brainstorm` |
| No `.workflow/` + has source files | `init` |
| Has `.workflow/` but no state.json | `init` |
| Has state.json | → phase-aware artifact inference |

**Phase-aware artifact inference**（基于 `session.phase` + `session.phase_is_new`，artifact 按 `session.phase` 过滤）：

| Condition | Position |
|-----------|----------|
| `phase_is_new == true` | `analyze` |
| no milestones AND no roadmap.md AND has analyze macro artifact | `roadmap` |
| no milestones AND no roadmap.md AND no analyze artifact | `analyze-macro` |
| `phase == null` | n/a |
| phase 已存在 + 无任何 artifact | `analyze` |
| phase 已存在 + 最新 artifact = analyze | `plan` |
| phase 已存在 + 最新 artifact = plan | `execute` |
| phase 已存在 + 最新 artifact = execute | `review` |

**Refine from review results:**

| Condition | Position |
|-----------|----------|
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `milestone-audit` |
| uat.md: has failures | `test-failed` |

### A_RESOLVE_SCOPE_VERDICT

仅当 `lifecycle_position ∈ {analyze-macro, roadmap, plan}` 且存在最新 analyze artifact 时执行。

1. 定位最新 macro analyze artifact（`type=="analyze"` 且 `scope=="macro"`，按 created_at DESC）→ `session.analyze_macro_id = ANL-xxx`
2. 读 `{artifact_path}/conclusions.json` 的 `scope_verdict` 字段（`large | medium | small`）
3. 写入 `session.scope_verdict`；缺失 → `unknown`
4. 路由建议：

| scope_verdict | 链路 |
|---------------|------|
| `large` | analyze-macro → roadmap → analyze → plan → execute → ... |
| `medium` / `small` | analyze-macro → plan --from analyze:{ANL_ID} → execute → ... |
| `unknown` | 默认 large；post-analyze-scope 节点再纠正 |

### A_DETERMINE_QUALITY_MODE

读 `session.quality_mode_override`（CLI `--quality`），无则按规则推断：

| Condition | Mode | Pipeline (execute 之后) |
|-----------|------|-------------------------|
| Has `specs/REQ-*.md` + 当前 phase 业务范围明确 | `full` | business-test → review → test-gen → test |
| Default | `standard` | review → test-gen (当 coverage<80%) → test |
| `--quality quick` | `quick` | review --tier quick |

写入 `session.quality_mode`。

### A_DETERMINE_PLANNING_MODE

**Auto-resolve rules (按优先级):**

| Condition | Mode |
|-----------|------|
| lifecycle_position ∈ {brainstorm, init, roadmap} | `independent` |
| `phase_is_new == true` | `independent` |
| intent 显式指定 phase 编号（如 "phase 2"、"P3"） | `independent` |
| milestone 仅含 1 个 phase | `independent` |
| milestone 含多个 phase + `auto_confirm` | `unified` |
| milestone 含多个 phase + 非 `auto_confirm` | → request_user_input |

**request_user_input** (仅当 milestone 含 ≥2 phase 且非 auto_confirm):

```
question: "当前里程碑含 {N} 个 phase，选择规划模式？"
options:
  - label: "统一规划 (Recommended)"
    description: "一次性分析+规划整个里程碑所有 phase，analyze/plan 走里程碑级，适合 phase 间关联紧密"
  - label: "独立规划"
    description: "逐个 phase 走完整生命周期（analyze→plan→execute→verify→...），适合 phase 间独立性高"
```

写入 `session.planning_mode`（`"unified"` 或 `"independent"`）。

### A_DECOMPOSE_TASKS

**1. Classify intent breadth:**

| Pattern | Breadth | Clarify? |
|---------|---------|----------|
| 重构/全面/重写/重做/整体/迁移 · overhaul/migrate/rewrite/revamp | broad | MUST (ignores auto_confirm) |
| named single file/function/bug, "fix X", "add Y to Z" | narrow | skip — auto-derive |
| otherwise | medium | clarify unless auto_confirm |

**2. Clarify boundary** (broad/medium) — `request_user_input`, ≤3 rounds, options pre-filled from intent + a quick Glob/Grep scan of the target module:

| Round | Question | Drives |
|-------|----------|--------|
| Scope | 哪些目录/文件/层在范围内?明确排除什么? | boundary_contract.in_scope / out_of_scope |
| Constraints | 必须向后兼容?公共 API 冻结?行为/性能预算?测试门槛? | boundary_contract.constraints + execution_criteria |
| Done | 什么可观测结果算"完成"?(如:测试全绿 + 行为零变更 + X 指标) | boundary_contract.definition_of_done |

narrow → derive defaults from intent + codebase, skip questions.

**3. Derive `execution_criteria`**: backward-compat、scope-freeze、test/coverage bar、fix-don't-hide、incremental commit。

**4. Derive `task_decomposition`** (子目标清单 — outcome-oriented, NOT lifecycle stages). Each entry:
```json
{ "id": "G1", "goal": "<deliverable>", "boundary": "<in/out note>",
  "done_when": "<objectively checkable condition>",
  "evidence": "verification.json|review.json|uat.md|<test path>",
  "lifecycle": ["analyze","execute","verify"], "status": "pending" }
```
`done_when` 必须客观可验证，且引用 ralph 已产出的 artifact；`lifecycle` 字段映射到产出 evidence 的生命周期 stage。

**5. Persist**: `boundary_contract`, `execution_criteria`, `task_decomposition`。每个 sub-goal 初始化 `status: "pending"` + `completion_confirmed: false`。

**6. Stage** the Goal Prompt (Appendix) for A_CREATE_SESSION to emit.

### A_BUILD_STEPS

从 `session.lifecycle_position` 生成 steps 到 `milestone-complete`。

| Stage | Skill (independent) | Skill (unified) | Decision after | quality_mode |
|-------|---------------------|-----------------|----------------|--------------|
| brainstorm | `maestro-brainstorm "{intent}"` | *(same)* | — | all |
| blueprint | `maestro-blueprint "{intent}"` | *(same)* | — | all |
| init | `maestro-init` | *(same)* | — | all |
| analyze-macro | `maestro-analyze "{intent}"` | *(same)* | `post-analyze-scope` | all |
| roadmap | `maestro-roadmap --from analyze:{analyze_macro_id}` | *(same)* | — | all |
| analyze | `maestro-analyze {phase}` | `maestro-analyze` | — | all |
| plan | `maestro-plan {phase}` *(scope=phase)* / `maestro-plan --from analyze:{analyze_macro_id}` *(scope=standalone)* / `maestro-plan --from blueprint:{blueprint_id}` *(scope=standalone)* | `maestro-plan` | — | all |
| execute | `maestro-execute {phase}` | `maestro-execute` | `post-execute` | all |
| business-test | `quality-auto-test {phase}` | `quality-auto-test` | `post-business-test` | full only |
| review | `quality-review {phase}` | `quality-review` | `post-review` | all (quick: append `--tier quick`) |
| test-gen | `quality-auto-test {phase}` | `quality-auto-test` | — | full / standard if coverage<80% |
| test | `quality-test {phase}` | `quality-test` | `post-test` | full, standard |
| milestone-audit | `maestro-milestone-audit` | *(same)* | — | all |
| goal-audit | *(decision-only)* | *(same)* | `post-goal-audit` | all (only if decomposed) |
| milestone-complete | `maestro-milestone-complete` | *(same)* | `post-milestone` | all |

**Build rules (按顺序应用):**

0. **planning_mode 选列**：`unified` → Skill (unified) 列；`independent` → Skill (independent) 列
1. **起点**：从 `session.lifecycle_position` 开始
2. **跳过已完成**：跳过当前 milestone+phase 下已有 completed artifact 的 stage（按 `session.phase` 过滤）；unified 按 milestone 过滤
3. **quality_mode 过滤**：按 `session.quality_mode` 排除不匹配 stage
4. **决策节点**：每个 Decision after 非空的 stage 之后插入 `{ decision: "<gate>", retry_count: 0, max_retries: 2, command_scope: null, command_path: null }`
5. **goal-audit 插入**：`task_decomposition` 存在时，在最后一个 evidence-producing stage（verify/review/test）之后、`milestone-complete` 之前插入 `decision:post-goal-audit`
6. **终点硬约束**：chain 以 `milestone-complete` 结尾
7. **goal_ref 传播**：`task_decomposition` 存在时，每个 step 按 `step.stage ∈ g.lifecycle` 匹配 `step.goal_ref = g.id`（多匹配取字典序最小）；decision 节点不打 goal_ref
8. **占位符**：independent 保留 `{phase}` `{intent}`；unified 不带 `{phase}`
9. **command_path 解析**（执行 step）：
   - skill 名 = args 前的第一个 token
   - `Bash("maestro ralph skills --platform codex --json --quiet")` 拉取 global + project（project 覆盖 global），匹配 skill 名：
     - 命中 → `command_scope = "global" | "project"`，`command_path = <绝对路径>`
     - 未命中 → `command_scope = "missing"`, `command_path = null` → A_CREATE_SESSION raise E006
10. **每个 step 初始化** `completion_confirmed: false`, `completion_status: null`, `completion_evidence: null`, `deferred_reads: []`, `load: null`
11. **scope_verdict gating**（仅当 chain 起点 = `analyze-macro`）：
    - `scope_verdict ∈ {medium, small}` → 跳过 `roadmap` + `analyze` 两 stage；`plan` 选 standalone 列（`--from analyze:{analyze_macro_id}`），不带 `{phase}`
    - `scope_verdict == large` → 保留 `roadmap` + `analyze`；`plan` 选 phase 列（`{phase}`）
    - `scope_verdict == unknown` → 默认 large 路径；由 `post-analyze-scope` 决策节点在 macro analyze 完成后纠正（A_APPLY_SCOPE_VERDICT）
12. **--from 自动注入**：
    - `analyze_macro_id` 存在且当前 step 是 `roadmap` → args 改为 `--from analyze:{analyze_macro_id}`
    - `analyze_macro_id` 存在且 `scope_verdict ∈ {medium, small}` 且当前 step 是 `plan` → args 改为 `--from analyze:{analyze_macro_id}`
    - `blueprint_id` 存在 → 当前 step 是 `plan` → args 改为 `--from blueprint:{blueprint_id}`（优先级低于 phase 数字参数）
    - 写入 `step.source_artifact_ref` 以便审计
13. **Milestone-ref**：含 `{phase}` 占位符的 step → `step.milestone_id = session.milestone`
14. **动态插入步骤**（A_APPLY_*）同样应用规则 7-13

### A_CREATE_SESSION

1. 校验所有 step 的 `command_scope != "missing"`；否则 raise E006 + 列出缺失 skill
2. Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`
3. Display chain overview：每步显示 `{index}. {skill} [{command_scope}]`
4. `task_decomposition` 存在 → display Goal Prompt block，继续进入 tick

### A_LOCATE_SESSION

1. If session_id provided → load `.workflow/.maestro/{session_id}/status.json`
2. Else: scan `.workflow/.maestro/*/status.json`, filter `status ∈ {"running","paused"}`, sort DESC by created_at, take first
3. Extract: session_id, source, steps[], phase, milestone, intent, auto_mode, context, cli_tool, active_step_index, status
4. 预探测 `next_pending_step`（瞬态，不持久化）：
   - 若 `active_step_index != null` 且 `steps[active_step_index].status == "running"` → `steps[active_step_index]`
   - 否则 `steps[]` 中 `status == "pending"` 的最小 index
   - 都无 → `null`

### A_RESUME_SESSION

1. A_LOCATE_SESSION 加载 active session
2. 清理 active_step_index：若 `active_step_index != null` 且 `steps[active_step_index].status ∈ {"completed","skipped","failed"}` → `active_step_index = null`；其余保留
3. If `session.status == "paused"` → `session.status = "running"`
4. `session.consec_exit2_count = 0`
5. Display: `↻ Resume {session_id}`

### A_CLAIM_DECISION

1. 校验 `session.active_step_index ∈ {null, next_pending_step.index}`，否则 raise E008
2. `session.active_step_index = next_pending_step.index`
3. `steps[next_pending_step.index].status = "running"`
4. Display: `[{index}/{total}] ◆ {step.decision} Retry: {retry}/{max}`

### A_RESOLVE_ARGS

**Placeholder substitution:**

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

**Per-skill enrichment** (when args empty or minimal):

| Skill | Required context | Source |
|-------|-----------------|--------|
| maestro-brainstorm | topic | `"{intent}"` |
| maestro-roadmap | description | `"{intent}"` |
| maestro-analyze | phase or topic | `{phase}` or `"{intent}"` |
| maestro-plan | phase or --dir | `{phase}`, or `--dir {scratch_dir}` |
| maestro-execute | phase or --dir | `{phase}`, or `--dir {scratch_dir}` |
| quality-debug | gap context | Read previous step's error/gap |
| quality-* | phase | `{phase}` |

**Artifact dir resolution for --dir:**
```
Read state.json → filter artifacts by milestone + phase
plan commands: latest type=="analyze" → --dir .workflow/scratch/{path}
execute commands: latest type=="plan" → --dir .workflow/scratch/{path}
```

Write enriched args back to status.json.

### A_EXEC_STEP

1. **Load** — `Bash("maestro ralph next")`
   - exit 0 → `session.consec_exit2_count = 0`，按 stdout 内联执行（进入步骤 2）
   - exit 2 → `session.consec_exit2_count += 1`；≥ 2 时抛 E010 → S_HANDLE_FAIL；否则 → S_TICK_LOCATE
   - exit 1 → E007 → S_HANDLE_FAIL
   - exit ≥ 3 → E008 → S_HANDLE_FAIL
2. **Inline execution** — 按 stdout 执行；deferred_reading 按需 Read
3. **Complete**:
   - `Bash("maestro ralph complete N --status DONE [--evidence <path>]")`
   - `Bash("maestro ralph complete N --status DONE_WITH_CONCERNS --concerns \"...\"")`
   - `Bash("maestro ralph retry N")`
   - `Bash("maestro ralph complete N --status BLOCKED --reason \"...\"")`
4. **Propagate context signals** — `PHASE: N` / `scratch_dir: path` / `BLP-xxx` 写入 `status.json.context`

### A_DELEGATE_EVALUATE

1. Resolve artifact dir: `.workflow/scratch/{artifact.path}/` with fallback glob
2. Parse decision metadata: `{ decision, retry_count, max_retries }`
3. Map result files:
   | Decision | Files |
   |----------|-------|
   | post-execute | verification.json |
   | post-business-test | .tests/auto-test/report.json |
   | post-review | review.json |
   | post-test | uat.md, .tests/test-results.json |
4. Check artifact for confidence section → include as signal
5. Execute delegate (run_in_background, STOP, wait for callback):
   ```
   maestro delegate "PURPOSE: 评估 {decision} 质量门结果
   TASK: 读取结果 | 分析状态 | 评估严重性 | 给出建议
   EXPECTED: ---VERDICT--- STATUS/REASON/GAP_SUMMARY/CONFIDENCE(high|medium|low)/CONFIDENCE_SCORE(0-100)/WEAKEST_DIMENSION ---END---
   CONSTRAINTS: 只评估 | 置信度<60% 倾向 fix | retry {n}/{max} 达上限必须 escalate"
   --role analyze --mode analysis
   ```
6. On callback: parse verdict; if parse fails → fallback STATUS="fix"
7. Confidence adjustment: <60 + proceed → fix; >95 + fix + retry>0 → suggest proceed
8. **Decision log**: Append to `{session_dir}/decisions.ndjson`:
   ```json
   { "id": "DEC-{timestamp}", "timestamp": "{ISO}", "source": "ralph",
     "node_id": "{step.decision}", "type": "quality-gate",
     "verdict": "{adjusted_verdict}", "confidence_score": {N},
     "close_call": {N>=50 && N<=70}, "summary": "{REASON}" }
   ```

### A_STRUCTURAL_EVALUATE

**post-milestone:**
1. Read state.json → 取已完成 milestone 对象
2. `milestone_obj.type` (default `"standard"`)
3. `type == "standard"`：next milestone 存在 → insert lifecycle steps；否则 → END
4. `type == "adhoc"`：END，`current_milestone = null`

**post-debug-escalate:** STOP → paused，display "请人工介入"

### A_SCOPE_EVALUATE

由 `post-analyze-scope` 触发。

1. 定位刚完成的 macro analyze artifact → `analyze_macro_id`, `conclusions_path = {artifact_path}/conclusions.json`
2. 读取 `conclusions.scope_verdict`（`large | medium | small`），缺失 → `unknown`
3. 写入 `session.scope_verdict` + `session.analyze_macro_id`
4. Append `{session_dir}/decisions.ndjson`:
   ```json
   { "id": "DEC-{timestamp}", "type": "scope-gate",
     "source": "ralph", "node_id": "post-analyze-scope",
     "verdict": "{scope_verdict}", "analyze_macro_id": "{ANL_ID}" }
   ```
5. → A_APPLY_SCOPE_VERDICT

### A_GOAL_AUDIT_EVALUATE

仅当 `task_decomposition` 存在。

1. Read `session.task_decomposition`
2. For each sub-goal `status != "done"`：resolve `evidence` artifact
3. Delegate read-only audit (run_in_background, STOP, wait):
   ```
   maestro delegate "PURPOSE: 审计未完成子目标，判定 met / unmet
   TASK:
     1. 读取 status.json.task_decomposition 中 status!=done 的子目标
     2. 打开 evidence 产物，对照 done_when 严格判定
     3. 输出 met / unmet，unmet 给出 gap + target_phase
   CONTEXT:
     status.json   = {session_dir}/status.json
     evidence      = {evidence artifacts}
     execution_criteria = {execution_criteria}
     boundary_contract  = {boundary_contract}
   EXPECTED:
     ---VERDICT---
     STATUS=all_met|has_unmet
     UNMET=[{id:G2,gap:'...',target_phase:execute}, ...]
     CONFIDENCE_SCORE=0-100
     ---END---
   CONSTRAINTS:
     - 只评估，不修改文件
     - 严格按 done_when 判定；evidence 缺失 → unmet
     - 不得建议超出 boundary_contract 的修改
   "
   --role analyze --mode analysis
   ```
4. On callback: 对每个 met 子目标，set `task_decomposition[i].status="done"` + `completion_confirmed=true` + `completed_at=now`
5. Append `{session_dir}/decisions.ndjson` with `"type": "goal-gate"`, `unmet_count`, `unmet_ids`
6. Verdict: `all_met` → A_APPLY_GOAL_DONE; `has_unmet` → A_APPLY_GOAL_FIX
   GUARD: retry_count >= max_retries AND still unmet → A_APPLY_ESCALATE

> **A_APPLY_\* release 协议**（所有 A_APPLY_* 末尾统一应用）：
> - 完成分支（proceed / goal-done / scope applied / structural advanced）：`step.status = "completed"`, `step.completion_confirmed = true`, `session.active_step_index = null`
> - 重评分支（fix / escalate / goal-fix）：`step.status = "pending"`, `step.completion_confirmed = false`, `session.active_step_index = null`, `step.retry_count += 1`

### A_APPLY_PROCEED

1. release 协议 — 完成分支
2. Append decisions.ndjson with verdict
3. Display: ◆ Decision: {type} → proceed ({reason})

### A_APPLY_FIX

1. Insert fix-loop commands after current step (Appendix: Fix-Loop Templates)
2. release 协议 — 重评分支；reindex steps
3. Display: ◆ Decision: {type} → fix, +{N} commands inserted

### A_APPLY_ESCALATE

1. Insert `[quality-debug "{gap_summary}", decision:post-debug-escalate]`
2. release 协议 — 重评分支；reindex

### A_APPLY_SCOPE_VERDICT

由 `post-analyze-scope` 触发。

1. 读 `session.scope_verdict`
2. `large`：为后续 `roadmap` step 注入 `--from analyze:{analyze_macro_id}`；后续 `plan` step 选 phase 列
3. `medium` / `small`：
   - 删除 `goal-audit` 之前未完成的 `roadmap` + `analyze` (phase) step
   - 下一个未完成的 `plan` step → `maestro-plan --from analyze:{analyze_macro_id}`，去掉 `{phase}`，`source_artifact_ref = analyze:{analyze_macro_id}`
   - 后续 `execute` / `verify` 同 standalone scope
4. `unknown`：非 auto_confirm → request_user_input 二选一（large / medium-small）；auto_confirm → 默认 large
5. release 协议 — 完成分支；reindex
6. Display: ◆ Scope verdict: {verdict} → {kept|collapsed to standalone via analyze:{ANL_ID}}

### A_APPLY_GOAL_FIX

1. 对每个 unmet 子目标 `G{n}`（按 `target_phase` 分组去重）：在 `goal-audit` 节点前插入 scoped mini-loop（Appendix: post-goal-audit），每条 step `goal_ref: "G{n}"`
2. 追加 `decision:post-goal-audit {retry+1}`
3. release 协议 — 重评分支；reindex
4. Display: ◆ Goal audit: {k} unmet → +{N} steps inserted (G{ids}), retry {r}/{max}

### A_APPLY_GOAL_DONE

1. 每个 `task_decomposition[*]` → `status="done"`, `completion_confirmed=true`, `completed_at=now`；顶层 `task_decomposition_all_done=true`
2. release 协议 — 完成分支；proceed to `milestone-complete`
3. Display: ◆ Goal audit: all met ✓

### A_ADVANCE_MILESTONE

1. Update session: milestone, phase, reset passed_gates
2. Insert full lifecycle steps for next milestone
3. release 协议 — 完成分支；reindex

### A_RETRY

1. `Bash("maestro ralph retry N")`
2. Display: `[{index}/{total}] ↻ {step.skill} retry`

### A_SKIP_STEP

手动编辑 status.json：`step.status = "skipped"`, `step.completion_confirmed = false`，若 `active_step_index == step.index` 则置 null。

### A_PAUSE_SESSION

`session.status = "paused"` (CLI 通过 `ralph complete N --status BLOCKED` 自动写；手动场景直接编辑)
Display: `[{index}/{total}] ✗ {step.skill} 失败，会话已暂停。$maestro-ralph-beta continue 恢复。`

### A_PAUSE_ESCALATE

1. `session.status = "paused"`
2. Display: ◆ 已达最大重试次数，debug 已执行。请人工介入。
3. Display: $maestro-ralph-beta continue 恢复

### A_COMPLETE_SESSION

1. 校验：所有 step `completion_confirmed == true`（除 skipped）；task_decomposition 存在时校验 `task_decomposition_all_done == true`
2. 任一校验失败 → 不标 completed，回 S_TICK_LOCATE 或 pause
3. `session.status = "completed"`, write status.json
4. Display completion report:
   ```
   ============================================================
     SESSION COMPLETE
   ============================================================
     Session:  {session_id} [{source}]
     Steps:    {completed}/{total}   confirmed: {confirmed}/{completed}

     [✓] 0.   maestro-plan 1            [global]
     [✓] 1.   maestro-execute 1         [project]
     [✓] 2.   quality-review 1           [global]
     [✓] 3. ◆ post-review               [decision]
     ...
   ============================================================
   ```
   Icons: `✓` confirmed, `—` skipped, `✗` failed, `◆` decision

</actions>

</state_machine>

<appendix>

### Session Schema

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph", "status": "running",
  "ralph_protocol_version": "2",
  "active_step_index": null,
  "intent": "", "lifecycle_position": "",
  "phase": null, "phase_is_new": false,
  "milestone": "",                 // D-007 反查结果
  "auto_mode": false,
  "quality_mode": "standard",      // "full" | "standard" | "quick"
  "planning_mode": "independent",  // "unified" | "independent"
  "scope_verdict": null,           // "large" | "medium" | "small" | "unknown" | null
  "analyze_macro_id": null,        // "ANL-xxx"
  "blueprint_id": null,            // "BLP-xxx"
  "cli_tool": "claude", "passed_gates": [],
  "consec_exit2_count": 0,

  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
  "steps": [{
    "index": 0,
    "skill": "",                   // 执行 step 有值；decision 节点为空字符串/null
    "args": "",
    "stage": "",                   // brainstorm|blueprint|init|analyze-macro|roadmap|analyze|plan|execute|...
    "scope": null,                 // "phase"|"standalone"|"milestone"|null（plan 等需要）
    "decision": null,              // null = 执行 step；非 null = decision step (值为 gate 名)
    "retry_count": 0,              // decision step
    "max_retries": 2,              // decision step
    "command_scope": "global|project|missing|null",
    "command_path": "<absolute path> | null",
    "milestone_id": null,          // 仅含 {phase} 占位符的 step
    "source_artifact_ref": null,   // "analyze:ANL-xxx" | "blueprint:BLP-xxx" | null
    "status": "pending|running|completed|skipped|failed",
    "goal_ref": null,
    "completion_confirmed": false,
    "completion_status": null,
    "completion_evidence": null,
    "completed_at": null,
    "deferred_reads": [],
    "load": null                   // { loaded_at, required_files[], deferred_files[], resolve_version }
  }],
  "current_step": 0,

  "boundary_contract": {
    "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": ""
  },
  "execution_criteria": [],
  "task_decomposition": [
    { "id": "G1", "goal": "", "boundary": "", "done_when": "",
      "evidence": "", "lifecycle": [], "status": "pending|done",
      "completion_confirmed": false, "completed_at": null }
  ],
  "task_decomposition_all_done": false
}
```

### Fix-Loop Templates

插入的执行 step 按 A_BUILD_STEPS 规则 9 解析 `command_path` + `command_scope`；`decision:*` 条目为 decision 节点。

**post-execute:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry+1}
```

**post-business-test:**
```
quality-debug --from-business-test "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry+1}
```

**post-review:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
quality-review {phase}
decision:post-review {retry+1}
```

**post-test:**
```
quality-debug --from-uat "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}
decision:post-execute {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry: 0}
quality-review {phase}
decision:post-review {retry: 0}
quality-auto-test {phase}
quality-test {phase}
decision:post-test {retry+1}
```

**post-goal-audit:** (per unmet sub-goal group)
```
# for each unmet sub-goal G{n}, scoped to target_phase:
maestro-plan --gaps {target_phase} "G{n}: {gap}"     [goal_ref: G{n}]
maestro-execute {target_phase}                       [goal_ref: G{n}]
# after all unmet groups inserted:
decision:post-goal-audit {retry+1}
```

### Goal Prompt Template

decomposition 产出后，链路概览之后逐字显示：

```
📋 任务分解完成。可随时复制以下 /goal 设定终止条件：

/goal 直到 {session_dir}/status.json 的 task_decomposition[*] 与 steps[*] 全部 completion_confirmed=true 才停。每轮以 status.json 为唯一行动手册，通过 $maestro-ralph-beta 推进 tick；decision 节点由 ralph 内联评估。禁止手动执行 skill 或修改 boundary_contract.out_of_scope。
```

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no running session | Prompt for intent |
| E002 | error | Cannot infer lifecycle position | Show raw state, ask |
| E003 | error | Artifact dir not found for decision | Show glob, ask |
| E004 | error | Delegate verdict parse failed | Fallback: "fix" |
| E005 | error | Delegate execution failed | Fallback: "fix" |
| E006 | error | command_scope == "missing" for one or more steps | List missing skills, abort build |
| E007 | error | required_reading 引用文件缺失 | `ralph next` 拒绝；CLI stderr 列出缺失路径 |
| E008 | error | `ralph complete` idx ≠ active_step_index | 编辑 status.json 修正一致性 |
| E009 | error | `ralph complete` step.status ≠ running | 重复 complete 或非法跳跃；编辑 status.json |
| E010 | error | status.json schema 损坏 OR A_EXEC_STEP exit=2 熔断（连续 ≥2 次空转） | `ralph check` 显示损坏字段；熔断需人工核对 next_pending_step 与 router 路由是否一致 |
| W001 | warning | Decision expanded chain | Auto-handled |
| W002 | warning | Max retries, escalating | Auto-handled |
| W003 | warning | Multiple running sessions | Use latest, warn |
| W004 | warning | Low delegate confidence | Show warning |
| W005 | warning | active_step_index 指向已 completed step | `ralph next` 自动清理后继续 |
| W007 | warning | step.skill ≠ command .md frontmatter.name | 提示但不阻塞 |

### Success Criteria

- [ ] Tick 末尾自调用 `$maestro-ralph-beta`，直到全部 `completion_confirmed` 或 paused
- [ ] 同一 session 同时仅一个 step 持 `active_step_index`；切换前必经 release
- [ ] Decision step 全程不调 `maestro ralph next` / `complete`，由 maestro-ralph-beta 内联评估并 release
- [ ] `task_decomposition` 存在时，chain 含 `decision:post-goal-audit`，且最终 `task_decomposition_all_done == true` 才允许 S_COMPLETE
- [ ] Chain 以 `milestone-complete` 结尾；A_APPLY_* 修改 steps[] 后均 reindex
- [ ] 连续 2 次 `ralph next` exit=2 → E010 pause（防 router 错路由空转）

</appendix>
