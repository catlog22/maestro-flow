---
name: maestro-ralph
description: Use when the optimal command sequence is unclear and needs automated state-based determination
argument-hint: "<intent> [-y] | status [session-id] | continue [session-id]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Reads project state → infers position → builds adaptive chain → delegates execution.

### Session

`.workflow/.maestro/{session_id}/status.json` — 工作流唯一真源（schema 见 `<appendix>`）。session_id 格式：`ralph-{YYYYMMDD-HHmmss}`（本 skill 创建，自适应链）或 `maestro-{YYYYMMDD-HHmmss}`（`$maestro` coordinator 创建，静态链）。两类都由 `$maestro-ralph-execute` 推进。session-id 省略时取最新 `status=="running"`。

### Entry points

- **`$maestro-ralph "intent"`** — 新建 session：infer → decompose → build → emit /goal prompt（如有 decomposition）→ dispatch ralph-execute
- **`$maestro-ralph continue [session-id]`** — 恢复执行；省略=最新 running（首选直接 `$maestro-ralph-execute [session-id]`）
- **`$maestro-ralph status [session-id]`** — 显示进度；省略=最新 ralph session

> 推进规则：**step 推进由 `$maestro-ralph-execute` 负责**；ralph 仅在 build / decision 评估时介入。decision 节点由 ralph-execute 自动 `$maestro-ralph` 直调 handoff，无需用户手动切换。

Initial decomposition (S_DECOMPOSE): boundary-clarified via ≤3 questions for broad intents (重构/全面/迁移/重写). 写入 status.json 的 `boundary_contract` / `execution_criteria` / `task_decomposition`，附 `/goal` prompt。

Step kinds:
- **执行 step**: ralph-execute 调 `Bash("maestro ralph next")` 加载 SKILL.md + required_reading 全文，按 stdout 内联执行
- **decision step**: `step.decision` 字段非空；回 ralph 评估（CLI 只读分析）

Key difference from maestro coordinator:
- maestro: static chain → one-time selection → runs all steps
- ralph: living chain → decision nodes re-evaluate → chain grows/shrinks dynamically

Session: `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`
Mutual invocation with `$maestro-ralph-execute` forms a self-perpetuating work loop.

### Execution Flow

```
 $maestro-ralph "intent" ─▶ ralph        infer → decompose → build chain
                              │           resolves command_path per step
                              │           writes status.json
                              │           emits /goal prompt
                              ▼
                       ralph-execute  ◀─┐ 执行 step → `maestro ralph next` + inline + `ralph complete`
                              │         │ decision step → $maestro-ralph
                              └─────────┘ CLI writes step.completion_confirmed
                       loop until all completion_confirmed | paused
```
</purpose>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag                          → auto_confirm = true
.md/.txt path                    → input_doc (supplementary context only, NEVER substitutes lifecycle stages)
status|continue + session-id     → 当 intent ∈ {status,continue} 且后续 token 匹配 ralph-*|maestro-* → target_session_id
Remaining                        → intent
```

**State files:**
- `.workflow/state.json` — artifact registry, milestones, phases
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/.maestro/ralph-*/status.json` — ralph session state
</context>

<invariants>
1. **Ralph never executes steps** — only creates sessions and evaluates decisions
2. **Handoff via `$maestro-ralph-execute` 直调** — 创建 session 后始终自动 handoff；decision 评估后始终 handoff
3. **Decision delegates read-only** — `maestro delegate --role analyze --mode analysis`
4. **执行 step 通过 `maestro ralph next` CLI 加载并内联执行**（详见 invariant 8）
5. **status.json 是唯一真源** — 不生成 markdown 清单或侧文件
6. **每个 step 必须 `completion_confirmed: true`** — 由 `maestro ralph complete N --status DONE`（或 DONE_WITH_CONCERNS）写入；CLI 是唯一合法写入路径
7. **command_path 在 A_BUILD_STEPS 解析** — 通过 `maestro ralph skills --platform codex --json --quiet` 预校验（project 覆盖 global，限定 `.codex/skills/`），命中即写绝对路径到 status.json；未命中标 `command_scope = "missing"`
8. **执行 step 加载契约** — 由 `maestro ralph next` CLI 在执行期完成：解析 frontmatter + `<required_reading>` + `<deferred_reading>`，自动读取 required 文件全文并拼入 prompt；缺失 required → 退出码 1（E007），pause session。ralph build 阶段只通过 `maestro ralph skills --platform codex` 校验路径存在性，不读 SKILL.md 内容
9. **Decomposition is outcome-oriented** — sub-goals 为可观测交付，禁止 lifecycle 复刻；`/goal` 用户绑定，ralph 输出提示词后继续 handoff，用户可在执行过程中随时输入 `/goal`
10. **planning_mode governs arg granularity** — `unified` → skill args 无 `{phase}`；`independent` → 含 `{phase}`
11. **task_decomposition 驱动 steps[] 动态生长** — `post-goal-audit` 按 unmet 子目标插入 scoped mini-loop；字段可选/累加，既有字段不删不改
12. **Platform** — `session.platform = "codex"`；CLI 调用一律带 `--platform codex`
13. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation. Do NOT bypass for "efficiency" or "clear intent" reasons. Especially invariants about ralph never executing steps and completion_confirmed by CLI.
14. **Delegate fallback must be marked** — when A_DELEGATE_EVALUATE verdict parse fails and falls back to "fix", MUST record `parse_failed: true, confidence_score: 0` in decisions.ndjson. Subsequent steps inherit LOW CONFIDENCE flag.
</invariants>

<state_machine>

<states>
S_PARSE_ROUTE     — 解析参数、路由入口                  PERSIST: —
S_STATUS          — 显示 session 进度                   PERSIST: —
S_CONTINUE        — 恢复执行                            PERSIST: —
S_RESOLVE_PHASE   — 解析 phase + phase_is_new + D-007 milestone PERSIST: session.phase, session.phase_is_new, session.milestone
S_INFER           — 基于已解析 phase 推断 lifecycle_position PERSIST: session.lifecycle_position
S_RESOLVE_SCOPE   — 读 macro analyze conclusions.scope_verdict PERSIST: session.scope_verdict, session.analyze_macro_id
S_QUALITY_MODE    — 决定质量管线模式                     PERSIST: session.quality_mode
S_PLANNING_MODE   — 决定统一/独立规划模式               PERSIST: session.planning_mode
S_DECOMPOSE       — 边界澄清、写执行准则+子目标清单       PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_BUILD_CHAIN     — 构建步骤链                           PERSIST: session.steps[]
S_CREATE_SESSION  — 写 status.json                      PERSIST: session (全量)
S_CONFIRM         — 用户确认                             PERSIST: —
S_DISPATCH        — 移交 maestro-ralph-execute           PERSIST: —
S_DECISION_EVAL   — 委托评估质量门                       PERSIST: —
S_APPLY_VERDICT   — 应用裁决 + 插入命令                  PERSIST: session.steps[], session.passed_gates[]
S_FALLBACK        — 请求用户输入                         PERSIST: —
</states>

<transitions>

S_PARSE_ROUTE:
  → S_STATUS        WHEN: intent == "status"
  → S_CONTINUE      WHEN: intent == "continue"
  → S_DECISION_EVAL WHEN: running session with decision step in "running" status
  → S_RESOLVE_PHASE WHEN: intent is non-empty                  ← phase 必须先于 position
  → S_FALLBACK      WHEN: no intent AND no running session

S_STATUS:
  → END             DO: A_SHOW_STATUS

S_CONTINUE:
  → S_DISPATCH      WHEN: target_session_id provided AND session exists
  → S_DISPATCH      WHEN: running session found (no target_session_id → latest running)
  → S_FALLBACK      WHEN: no running session               DO: display "无运行中的 ralph 会话"

S_RESOLVE_PHASE:
  → S_INFER         WHEN: phase resolved or null            DO: A_RESOLVE_PHASE
  → S_FALLBACK      WHEN: ambiguous
                     GUARD: auto_confirm does NOT skip phase ambiguity

S_INFER:
  → S_RESOLVE_SCOPE WHEN: position resolved                 DO: A_INFER_POSITION
  → S_FALLBACK      WHEN: cannot infer

S_RESOLVE_SCOPE:
  → S_QUALITY_MODE  DO: A_RESOLVE_SCOPE_VERDICT
                     GUARD: position ∈ {grill, brainstorm, blueprint, init} → skip (scope_verdict = null)

S_QUALITY_MODE:
  → S_PLANNING_MODE DO: A_DETERMINE_QUALITY_MODE

S_PLANNING_MODE:
  → S_DECOMPOSE     DO: A_DETERMINE_PLANNING_MODE
                     GUARD: lifecycle_position ∈ {grill, brainstorm, blueprint, init, analyze-macro, roadmap} → skip (force independent)

S_DECOMPOSE:
  → S_BUILD_CHAIN   DO: A_DECOMPOSE_TASKS
                     GUARD: broad intent → MUST clarify boundary even if auto_confirm
                     GUARD: narrow intent → auto-derive, skip questions
                     GUARD: position ∈ {grill, brainstorm, blueprint, init} → skip decomposition

S_BUILD_CHAIN:
  → S_CREATE_SESSION DO: A_BUILD_STEPS

S_CREATE_SESSION:
  → S_CONFIRM       WHEN: not auto_confirm                   DO: A_CREATE_SESSION
  → S_DISPATCH      WHEN: auto_confirm                       DO: A_CREATE_SESSION

S_CONFIRM:
  → S_DISPATCH      WHEN: user selects "Proceed"
  → S_BUILD_CHAIN   WHEN: user selects "Edit"
  → END             WHEN: user selects "Cancel"

S_DISPATCH:
  → END             DO: $maestro-ralph-execute

S_DECISION_EVAL: (decision 节点 == `step.decision` 非空，下述 gate 名取自该字段)
  → S_APPLY_VERDICT WHEN: quality-gate (post-execute, post-business-test, post-review, post-test)
                     DO: A_DELEGATE_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate (post-goal-audit)
                     DO: A_GOAL_AUDIT_EVALUATE
  → S_APPLY_VERDICT WHEN: scope-gate (post-analyze-scope)
                     DO: A_SCOPE_EVALUATE
  → S_APPLY_VERDICT WHEN: structural (post-milestone, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_DISPATCH      WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_DISPATCH      WHEN: post-goal-audit + unmet sub-goals  DO: A_APPLY_GOAL_FIX
  → S_DISPATCH      WHEN: post-goal-audit + all sub-goals met DO: A_APPLY_GOAL_DONE
  → S_DISPATCH      WHEN: post-analyze-scope                 DO: A_APPLY_SCOPE_VERDICT
  → S_DISPATCH      WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_DISPATCH      WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_DISPATCH      WHEN: post-milestone + standard + next milestone   DO: A_ADVANCE_MILESTONE
  → END             WHEN: post-milestone + standard + no next milestone DO: mark completed
  → END             WHEN: post-milestone + adhoc                       DO: mark completed (adhoc self-contained)
  → END             WHEN: post-debug-escalate (always STOP)  DO: A_PAUSE_ESCALATE
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → request_user_input with override options

S_FALLBACK:
  → S_PARSE_ROUTE   WHEN: user provides input               DO: request_user_input
  → END             WHEN: user cancels

</transitions>

<actions>

### A_SHOW_STATUS

1. 若 `target_session_id` 提供 → 直接加载 `.workflow/.maestro/{target_session_id}/status.json`；否则取最新 ralph session（by created_at）
2. Display: Session, Status, Position, Progress, Current step
3. List steps: [✓] completion_confirmed, [▸] current, [ ] pending, [◆] decision（`step.decision` 非空）；执行 step 附 `command_scope`(global/project) + `command_path`
4. If `task_decomposition` present (absent → skip):
   ```
   Sub-goals  ({done}/{total})    source: {session_dir}/status.json#/task_decomposition
   [x] G1 done_when={done_when}   evidence={evidence}   confirmed={completion_confirmed}
   [ ] G2 done_when={done_when}   evidence={evidence}   confirmed=false ◀ unmet
   ```

### A_RESOLVE_PHASE

前置于 A_INFER_POSITION。产出 `phase` + `phase_is_new` + `milestone`（D-007 反查）三元组。

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
写入 `session.milestone`；禁止直接使用 `current_milestone` 当做 phase 所属 milestone。

**写入 session**: `phase`, `phase_is_new`, `milestone`。

**新派生 phase 时 milestone 处理**：
- state.json 当前 milestone 仍 active → 沿用，新增 phase
- intent 派生新 milestone 名 → 写入 session 仅作标签；`state.json.milestones` 由 `maestro-roadmap` / `maestro-milestone-release` 创建

### A_INFER_POSITION

**Intent-based overrides** (按顺序匹配，先命中先用):

| Pattern | Position |
|---------|----------|
| 压力测试 / 拷问 / 验证假设 / grill / stress-test | `grill`（**auto_confirm=true 时跳过，直接 `brainstorm`**） |
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

**Phase-aware artifact inference** (使用 A_RESOLVE_PHASE 已写入的 `session.phase` + `session.phase_is_new`)：

| Condition | Position |
|-----------|----------|
| `phase_is_new == true` (新 phase) | `analyze` |
| no milestones AND no roadmap.md AND has analyze macro artifact | `roadmap` |
| no milestones AND no roadmap.md AND no analyze artifact | `analyze-macro` |
| `phase == null` (grill/brainstorm/blueprint/init/roadmap/analyze-macro override 已定) | n/a |
| phase 已存在 + 无任何 artifact | `analyze` |
| phase 已存在 + 最新 artifact = analyze | `plan` |
| phase 已存在 + 最新 artifact = plan | `execute` |
| phase 已存在 + 最新 artifact = execute | `review` |

**关键不变量**：artifact 过滤按 `session.phase`，不读 `state.json.current_phase`。`phase_is_new` → 直接 `analyze`。

### A_RESOLVE_SCOPE_VERDICT

仅当 `lifecycle_position ∈ {analyze-macro, roadmap, plan}` 且存在最新 analyze artifact 时执行。

1. 定位最新 macro analyze artifact（`type=="analyze"` 且 `scope=="macro"`，按 created_at DESC）→ 记 `session.analyze_macro_id = ANL-xxx`
2. 读 `{artifact_path}/conclusions.json` 的 `scope_verdict` 字段（`large | medium | small`）
3. 写入 `session.scope_verdict`；缺失时设 `unknown`
4. 路由建议（A_BUILD_STEPS 据此决定是否插入 roadmap、plan 是否走 `--from`）：

| scope_verdict | 链路 |
|---------------|------|
| `large` | analyze-macro → roadmap → analyze → plan → execute → ... |
| `medium` / `small` | analyze-macro → plan --from analyze:{ANL_ID} → execute → ...（跳过 roadmap + analyze-phase） |
| `unknown` | 默认走 large 路径，post-analyze-scope 决策节点再纠正 |

**Refine from review results:**

| Condition | Position |
|-----------|----------|
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `milestone-audit` |
| uat.md: has failures | `test-failed` |

### A_DETERMINE_QUALITY_MODE

决定下游质量管线长度。读 `session.quality_mode_override`（CLI 标志 `--quality`），无则按规则推断：

| Condition | Mode | Pipeline (execute 之后) |
|-----------|------|-------------------------|
| Has `specs/REQ-*.md` + 当前 phase 业务范围明确 | `full` | business-test → review → test-gen → test |
| Default | `standard` | review → test-gen (当 coverage<80%) → test |
| `--quality quick` | `quick` | review --tier quick |

写入 `session.quality_mode`。A_BUILD_STEPS 据此过滤 stage（见下）。

### A_DETERMINE_PLANNING_MODE

决定里程碑的规划粒度：一次性规划整个里程碑（统一）还是逐 phase 走完整生命周期（独立）。

**Auto-resolve rules (按优先级):**

| Condition | Mode | Reason |
|-----------|------|--------|
| lifecycle_position ∈ {grill, brainstorm, init, roadmap} | `independent` | 前期阶段不涉及多 phase 规划 |
| `phase_is_new == true` | `independent` | 新 phase 尚无里程碑上下文 |
| intent 显式指定 phase 编号（如 "phase 2"、"P3"） | `independent` | 用户明确针对单个 phase |
| milestone 仅含 1 个 phase（读 state.json） | `independent` | 统一无意义 |
| milestone 含多个 phase + `auto_confirm` | `unified` | 自动模式倾向高效 |
| milestone 含多个 phase + 非 `auto_confirm` | → request_user_input | 征询用户选择 |

**request_user_input** (仅当 milestone 含 ≥2 phase 且非 auto_confirm):

```
question: "当前里程碑含 {N} 个 phase，选择规划模式？"
options:
  - label: "统一规划 (Recommended)"
    description: "一次性分析+规划整个里程碑所有 phase，analyze/plan 走里程碑级，适合 phase 间关联紧密"
  - label: "独立规划"
    description: "逐个 phase 走完整生命周期（analyze→plan→execute→verify→...），适合 phase 间独立性高"
```

写入 `session.planning_mode`（`"unified"` 或 `"independent"`）。`A_BUILD_STEPS` 据此决定 skill args 是否携带 `{phase}` 占位符。

### A_DECOMPOSE_TASKS

Runs once before chain build; additive to status.json.

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

**5. Persist** (additive): `boundary_contract`, `execution_criteria`, `task_decomposition`。每个 sub-goal 含 `status: "pending"` + `completion_confirmed: false`。

**6. Stage** the Goal Prompt (Appendix) for A_CREATE_SESSION to emit.

### A_BUILD_STEPS

Generate steps from `session.lifecycle_position` to `milestone-complete`.

| Stage | Skill (independent) | Skill (unified) | Decision after | quality_mode |
|-------|---------------------|-----------------|----------------|--------------|
| grill | `maestro-grill "{intent}"` | *(same)* | — | all (**skip when auto_confirm**) |
| brainstorm | `maestro-brainstorm "{intent}" --from grill:{grill_id}` *(if grill ran)* / `maestro-brainstorm "{intent}"` *(otherwise)* | *(same)* | — | all |
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

> 所有执行 stage 统一通过 `maestro ralph next` CLI 加载 + 内联执行；decision 节点单独作为独立 step 插入（见规则 4）。

**Build rules (按顺序应用):**

0. **planning_mode 选列**：`unified` → Skill (unified) 列；`independent` → Skill (independent) 列
1. **起点**：从 `session.lifecycle_position` 开始
2. **跳过已完成**：跳过当前 milestone+phase 下已有 completed artifact 的 stage（按 `session.phase` 过滤）；unified 按 milestone 过滤
3. **quality_mode 过滤**：按 `session.quality_mode` 排除不匹配 stage
3.5. **grill auto_confirm 跳过**：`auto_confirm == true` 时删除 `grill` stage（grill 为交互式苏格拉底拷问，不支持自动模式）；brainstorm args 不含 `--from grill:*`
4. **决策节点**：每个 Decision after 非空的 stage 之后插入 `{ decision: "<gate>", retry_count: 0, max_retries: 2, command_scope: null, command_path: null }`
5. **goal-audit 插入**：`task_decomposition` 存在时，在最后一个 evidence-producing stage（verify/review/test）之后、`milestone-complete` 之前插入 `decision:post-goal-audit`
6. **终点硬约束**：chain 以 `milestone-complete` 结尾
7. **goal_ref 传播**：`task_decomposition` 存在时，每个 step 按 `step.stage ∈ g.lifecycle` 匹配 `step.goal_ref = g.id`（多匹配取字典序最小）；decision 节点不打 goal_ref
8. **占位符**：independent 保留 `{phase}` `{intent}`；unified 不带 `{phase}`
9. **command_path 解析**（每个执行 step，decision 节点跳过）：
   - 取 skill 名（args 前的第一个 token）
   - **预校验通过 `Bash("maestro ralph skills --platform codex --json --quiet")`** 一次性拉取所有可用 codex skills（global `~/.codex/skills/` + project `.codex/skills/`，project 覆盖 global），匹配 skill 名得到：
     - 命中 → `command_scope = "global" | "project"`，`command_path = <绝对 SKILL.md 路径>`
     - 未命中 → `command_scope = "missing"`, `command_path = null`，A_CREATE_SESSION 报错 E006
   - **不在 build 阶段读取 SKILL.md 内容**；`<required_reading>` / `<deferred_reading>` 解析与加载由 `maestro ralph next` CLI 在执行期完成
10. **每个 step 初始化** `completion_confirmed: false`, `completion_status: null`, `completion_evidence: null`, `deferred_reads: []`, `load: null`（由 `ralph next` 写入）
11. **scope_verdict gating**（仅当 chain 起点 = `analyze-macro`）：
    - `scope_verdict ∈ {medium, small}` → 跳过 `roadmap` + `analyze` 两 stage；`plan` 选 standalone 列（`--from analyze:{analyze_macro_id}`），不带 `{phase}`
    - `scope_verdict == large` → 保留 `roadmap` + `analyze`；`plan` 选 phase 列（`{phase}`）
    - `scope_verdict == unknown` → 默认 large 路径；由 `post-analyze-scope` 决策节点在 macro analyze 完成后纠正（A_APPLY_SCOPE_VERDICT）
12. **--from 自动注入**：
    - `analyze_macro_id` 存在且当前 step 是 `roadmap` → args 改为 `--from analyze:{analyze_macro_id}`
    - `analyze_macro_id` 存在且 `scope_verdict ∈ {medium, small}` 且当前 step 是 `plan` → args 改为 `--from analyze:{analyze_macro_id}`
    - `blueprint_id` 存在 → 当前 step 是 `plan` → args 改为 `--from blueprint:{blueprint_id}`（优先级低于 phase 数字参数）
    - 写入 `step.source_artifact_ref` 以便审计
13. **D-007 Milestone-ref 标注**：每个含 `{phase}` 占位符的 step → `step.milestone_id = session.milestone`（由 A_RESOLVE_PHASE 反查得出），禁止读 `current_milestone`
14. **动态插入步骤**（A_APPLY_*）同样应用规则 7-13

### A_CREATE_SESSION

1. Validate: 所有 step 的 `command_scope != "missing"`；否则 raise E006 + 列出缺失 skill
2. Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json` (Appendix: Session Schema)；含 `platform: "codex"`, `cli_tool: "codex"`
3. Display chain overview：每步显示 `{index}. {skill} [{type}] [{command_scope}]`
4. If `task_decomposition` present: display **Goal Prompt block** (Appendix)，不阻塞流程，继续 handoff

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
1. Read state.json → resolve completed milestone object
2. Determine milestone type: `milestone_obj.type` (default `"standard"` if missing)
3. **Standard milestone** (`type != "adhoc"`): next milestone exists? → insert lifecycle steps / complete
4. **Adhoc milestone** (`type == "adhoc"`): always END — adhoc milestones are self-contained, no successor to advance to. Set `current_milestone = null`.

**post-debug-escalate:** Always STOP → set paused, display "请人工介入"

### A_SCOPE_EVALUATE

仅由 `post-analyze-scope` 决策节点触发；macro analyze 完成后读 `conclusions.json.scope_verdict` 决定下游链路。

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

Runs only when `task_decomposition` present.

1. Read `session.task_decomposition` from status.json
2. For each sub-goal `status != "done"`: resolve `evidence` artifact under current phase scratch dir
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

### A_APPLY_PROCEED

1. Mark decision completed, write status.json
2. Display: ◆ Decision: {type} → proceed ({reason})

### A_APPLY_FIX

1. Insert fix-loop commands after current step (see Appendix: Fix-Loop Templates)
2. Reindex steps, increment retry_count, write status.json
3. Display: ◆ Decision: {type} → fix, +{N} commands inserted

### A_APPLY_ESCALATE

1. Insert `[quality-debug "{gap_summary}", decision:post-debug-escalate]`
2. Increment retry_count, reindex, write status.json

### A_APPLY_SCOPE_VERDICT

由 `post-analyze-scope` 触发，依据 `session.scope_verdict` 重塑下游链路。

1. 读 `session.scope_verdict`
2. 路径 A（`large`）：保持当前链；为后续 `roadmap` step 注入 `--from analyze:{analyze_macro_id}`；为后续 `plan` step 选 phase 列；继续推进
3. 路径 B（`medium` / `small`）：
   - 删除 `goal-audit` 之前所有未完成的 `roadmap` + `analyze` (phase) step
   - 把下一个未完成的 `plan` step 改为 `maestro-plan --from analyze:{analyze_macro_id}`，去掉 `{phase}`，`source_artifact_ref = analyze:{analyze_macro_id}`
   - 后续 `execute` / `verify` 等沿用同一 standalone scope（不带 `{phase}`，由 plan 写出的 task 列表驱动）
4. 路径 C（`unknown`）：
   - 非 auto_confirm → request_user_input 二选一（large / medium-small）；auto_confirm → 默认 large
5. Reindex steps，标 decision completed，write status.json
6. Display: ◆ Scope verdict: {verdict} → {kept|collapsed to standalone via analyze:{ANL_ID}}

### A_APPLY_GOAL_FIX

1. 对每个 unmet 子目标 `G{n}`（按 `target_phase` 分组去重）：在 `goal-audit` 节点前插入 scoped mini-loop（见 Appendix: Fix-Loop Templates → post-goal-audit），每条插入 step `goal_ref: "G{n}"`，按 A_BUILD_STEPS 规则 9 解析 `command_path`
2. 重新追加 `decision:post-goal-audit {retry+1}`
3. Reindex steps, increment retry_count, write status.json
4. Display: ◆ Goal audit: {k} unmet → +{N} steps inserted (G{ids}), retry {r}/{max}

### A_APPLY_GOAL_DONE

1. status.json: set 每个 `task_decomposition[*].status="done"`, `completion_confirmed=true`, `completed_at=now`，顶层 `task_decomposition_all_done=true`
2. Mark goal-audit decision completed；proceed to `milestone-complete`
3. Display: ◆ Goal audit: all met ✓

### A_ADVANCE_MILESTONE

1. Update session: milestone, phase, reset passed_gates
2. Insert full lifecycle steps for next milestone
3. Reindex, write status.json

### A_PAUSE_ESCALATE

1. Set session status = "paused", write status.json
2. Display: ◆ 已达最大重试次数，debug 已执行。请人工介入。
3. Display: $maestro-ralph continue 恢复

</actions>

</state_machine>

<appendix>

### Session Schema

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph", "status": "running",
  "ralph_protocol_version": "1",   // CLI-driven; absent/0 → legacy inline ralph-execute
  "active_step_index": null,       // CLI-managed; only one step held at a time
  "intent": "", "lifecycle_position": "",
  "phase": null, "phase_is_new": false,
  "milestone": "",                // D-007 反查结果，禁止读 current_milestone
  "auto_mode": false,
  "quality_mode": "standard",     // "full" | "standard" | "quick"
  "planning_mode": "independent", // "unified" | "independent"
  "scope_verdict": null,          // "large" | "medium" | "small" | "unknown" | null
  "analyze_macro_id": null,       // "ANL-xxx" 来自最新 macro analyze
  "blueprint_id": null,           // "BLP-xxx" 若存在
  "cli_tool": "codex",
  "platform": "codex",            // codex skills (`.codex/skills/`)
  "passed_gates": [],
  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
  "steps": [{
    "index": 0,
    "skill": "",                  // 执行 step 有值；decision 节点为空字符串/null
    "args": "",
    "stage": "",                  // brainstorm|blueprint|init|analyze-macro|roadmap|analyze|plan|execute|...
    "scope": null,                // "phase"|"standalone"|"milestone"|null（plan 等需要）
    "decision": null,             // 非 null → decision 节点（值为 gate 名，如 "post-execute"）；null → 执行 step
    "retry_count": 0,             // decision 节点专用
    "max_retries": 2,             // decision 节点专用
    "command_scope": "global|project|missing|null",  // 执行 step；decision 节点固定 null
    "command_path": "<absolute SKILL.md path resolved by `maestro ralph skills --platform codex --json --quiet`> | null",
    "milestone_id": null,         // D-007 反查注入；仅含 {phase} 占位符的 step 有
    "source_artifact_ref": null,  // "analyze:ANL-xxx" | "blueprint:BLP-xxx" | null
    "status": "pending|running|completed|skipped|failed",
    "goal_ref": null,
    "completion_confirmed": false,
    "completion_status": null,
    "completion_evidence": null,
    "completed_at": null,
    "deferred_reads": [],         // 由 ralph next CLI 解析 SKILL.md 时填充
    "load": null                  // { loaded_at, required_files[], deferred_files[], resolve_version } —— 由 ralph next 写入
  }],
  "waves": [], "current_step": 0,

  // Optional decomposition block (additive; absent → decomposition off)
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

新增字段可选，缺省=旧行为；既有字段名不删不改。

### Fix-Loop Templates

所有插入的执行 step 按 A_BUILD_STEPS 规则 9 解析 `command_path` + `command_scope`；`decision:*` 条目为 decision 节点（`step.decision` 字段）。

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

链路概览后逐字显示（仅当 decomposition 已产出）：

```
📋 任务分解完成。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 直到 {session_dir}/status.json 的 task_decomposition[*] 与 steps[*] 全部 completion_confirmed=true 才停。每轮以 status.json 为唯一行动手册，通过 $maestro-ralph-execute 推进 step；decision 节点由其自动 handoff 回 ralph 评估。禁止手动执行 skill 或修改 boundary_contract.out_of_scope。
```

`/goal` 由用户输入；ralph 输出提示词后继续 handoff，不阻塞。

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no running session | Prompt for intent |
| E002 | error | Cannot infer lifecycle position | Show raw state, ask |
| E003 | error | Artifact dir not found for decision | Show glob, ask |
| E004 | error | Delegate verdict parse failed | Fallback: "fix" |
| E005 | error | Delegate execution failed | Fallback: "fix" |
| E006 | error | command_scope == "missing" for one or more steps | List missing skills, abort build |
| W001 | warning | Decision expanded chain | Auto-handled |
| W002 | warning | Max retries, escalating | Auto-handled |
| W003 | warning | Multiple running sessions | Use latest, warn |
| W004 | warning | Low delegate confidence | Show warning |

### Success Criteria

- [ ] Phase 先于 position 解析；phase_is_new 标记写入 session
- [ ] D-007 反查：phase 数字 → `session.milestone`，禁止读 current_milestone；写入 step.milestone_id
- [ ] phase_is_new=true → lifecycle_position 强制 `analyze`
- [ ] Intent overrides 识别 grill / brainstorm / blueprint / analyze-macro
- [ ] auto_confirm=true 时 grill stage 跳过（交互式拷问不支持自动模式）
- [ ] A_RESOLVE_SCOPE_VERDICT 读 macro analyze conclusions.scope_verdict，写入 session.scope_verdict + analyze_macro_id
- [ ] 链路起点 = analyze-macro 时：large→roadmap+analyze+plan(phase)；medium/small→直跳 plan --from analyze:{ANL_ID}（跳过 roadmap+analyze）
- [ ] post-analyze-scope decision 节点在 macro analyze 之后插入；A_SCOPE_EVALUATE/A_APPLY_SCOPE_VERDICT 重塑链路
- [ ] plan step args 支持三路径：`{phase}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}`，写入 step.source_artifact_ref
- [ ] roadmap step args 自动注入 `--from analyze:{analyze_macro_id}`（若存在）
- [ ] artifact 过滤按 session.phase；unified 按 milestone
- [ ] quality_mode 由 A_DETERMINE_QUALITY_MODE 决定，过滤 build steps
- [ ] Decomposition: broad intent ≤3 question clarify；narrow auto-derive
- [ ] status.json 唯一真源：boundary_contract + execution_criteria + task_decomposition；无外部清单
- [ ] 执行 step 含 `command_scope` + `command_path`（通过 `maestro ralph skills --platform codex --json --quiet` 预校验，project 覆盖 global）；decision step 通过 `step.decision` 字段标识
- [ ] Ralph build 阶段只通过 `ralph skills --platform codex` 校验路径存在性，不读 SKILL.md 内容；`<required_reading>` 加载由 `maestro ralph next` CLI 完成
- [ ] 每个 step 含 `completion_confirmed` + `completion_status` + `completion_evidence` + `deferred_reads`（初始 false/null/[]）
- [ ] 每个 sub-goal 含 `completion_confirmed`（初始 false）
- [ ] post-goal-audit decision 仅在 decomposed 时插入，位于 milestone-complete 之前
- [ ] Unmet sub-goals 动态 grow steps[]（goal_ref tagged）；max retries → escalate
- [ ] planning_mode 显式决定；unified=无 `{phase}`, independent=带 `{phase}`
- [ ] Chain 必须以 `milestone-complete` 结尾
- [ ] Decision nodes 由 maestro delegate --role analyze 评估
- [ ] Ralph 不执行 step，只 evaluate；`$maestro-ralph-execute` 直调 handoff
- [ ] session.platform = "codex"；所有 CLI 调用携带 `--platform codex`

</appendix>
