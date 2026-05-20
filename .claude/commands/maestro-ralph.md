---
name: maestro-ralph
description: Use when the optimal command sequence is unclear and needs automated state-based determination
argument-hint: "<intent> [-y] | status | continue"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---
<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Reads project state → infers position → builds adaptive chain → delegates execution.

Entry points:
- **`/maestro-ralph "intent"`** — New session: infer → decompose → build → execute
- **`/maestro-ralph continue`** — Resume via maestro-ralph-execute
- **`/maestro-ralph status`** — Display session progress

Initial decomposition (S_DECOMPOSE): broad intents (重构/全面/迁移/重写) are boundary-clarified via ≤3 questions, producing 执行准则 + 子目标清单 written into status.json, plus a `goal-checklist.md` (a rendered view of status.json) and a copy-paste `/goal` prompt for the user to bind.

Three node types:
- **internal**: `Skill()` call (synchronous, lightweight)
- **external**: `maestro delegate --to claude` (context-isolated, heavy computation)
- **decision**: Hand back to ralph for re-evaluation (adaptive branching)

Key difference from maestro coordinator:
- maestro: static chain → one-time selection → runs all steps
- ralph: living chain → decision nodes re-evaluate → chain grows/shrinks dynamically

Session: `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`
Mutual invocation with `/maestro-ralph-execute` forms a self-perpetuating work loop.

### 执行方式 / Execution Flow

```
 /maestro-ralph "intent" ─▶ ralph        infer → decompose → build chain
                              │           writes status.json (truth)
                              │           renders goal-checklist.md (view)
                              │           emits /goal prompt
                              ▼
                       ralph-execute  ◀─┐ runs next step:
                              │         │  internal → Skill()
                              │         │  external → delegate (STOP→callback)
                              │         │  decision → Skill("maestro-ralph")
                              └─────────┘ updates status.json + re-renders checklist
                       loop until done | paused
```

`status.json` 是唯一真源；checklist 是渲染视图。决策节点是链路生长点（`post-goal-audit` 插入按子目标的 mini-loop；`post-verify/review/test` 插入修复 loop）。评估只走 ralph，执行只走 ralph-execute，两者不互相替代。
</purpose>

<context>
$ARGUMENTS — intent text, flags, or keywords.

**Parse:**
```
-y flag       → auto_confirm = true
.md/.txt path → input_doc (supplementary context only, NEVER substitutes lifecycle stages)
Remaining     → intent
```

**State files:**
- `.workflow/state.json` — artifact registry, milestones, phases
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/.maestro/ralph-*/status.json` — ralph session state
</context>

<invariants>
1. **Ralph never executes steps** — only creates sessions and evaluates decisions
2. **Handoff via Skill("maestro-ralph-execute")** — at session creation and after decision evaluation
3. **Decision delegates read-only** — `maestro delegate --role analyze --mode analysis`
4. **External ≠ CLI call** — external spawns full Claude Code session executing the skill command
5. **Delegate sessions non-interactive** — all external skills MUST append `-y` to args inside the prompt
6. **Decomposition is outcome-oriented** — sub-goals are deliverables/done-criteria, NEVER lifecycle-stage duplicates (analyze/plan/...). `/goal` binding is user-driven; ralph only emits the prompt
7. **task_decomposition drives DYNAMIC step growth, not a frozen plan** — sub-goals are the convergence spec; `status.json.steps[]` remains the living chain. The `post-goal-audit` decision node re-checks the checklist and **dynamically inserts scoped execution steps** for every unmet sub-goal (same insert+reindex+retry mechanism as fix-loops). Decomposition never replaces ralph's adaptive branching — it feeds it. New fields are also additive/optional (absent → decomposition off, old behavior); never remove/rename existing fields
</invariants>

<state_machine>

<states>
S_PARSE_ROUTE     — 解析参数、路由入口                  PERSIST: —
S_STATUS          — 显示 session 进度                   PERSIST: —
S_CONTINUE        — 恢复执行                            PERSIST: —
S_RESOLVE_PHASE   — 解析目标 phase + 标记 phase_is_new   PERSIST: session.phase, session.phase_is_new
S_INFER           — 基于已解析 phase 推断 lifecycle_position PERSIST: session.lifecycle_position
S_QUALITY_MODE    — 决定质量管线模式                     PERSIST: session.quality_mode
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
  → S_DISPATCH      WHEN: running session found
  → S_FALLBACK      WHEN: no running session               DO: display "无运行中的 ralph 会话"

S_RESOLVE_PHASE:
  → S_INFER         WHEN: phase resolved or null            DO: A_RESOLVE_PHASE
  → S_FALLBACK      WHEN: ambiguous
                     GUARD: auto_confirm does NOT skip phase ambiguity

S_INFER:
  → S_QUALITY_MODE  WHEN: position resolved                 DO: A_INFER_POSITION
  → S_FALLBACK      WHEN: cannot infer

S_QUALITY_MODE:
  → S_DECOMPOSE     DO: A_DETERMINE_QUALITY_MODE

S_DECOMPOSE:
  → S_BUILD_CHAIN   DO: A_DECOMPOSE_TASKS
                     GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) → MUST clarify boundary even if auto_confirm
                     GUARD: narrow intent (single file/function/bug) → auto-derive, skip questions
                     GUARD: position ∈ {brainstorm, init} → skip decomposition (no concrete target yet)

S_BUILD_CHAIN:
  → S_CREATE_SESSION DO: A_BUILD_STEPS

S_CREATE_SESSION:
  → S_CONFIRM       WHEN: not auto_confirm                  DO: A_CREATE_SESSION
  → S_DISPATCH      WHEN: auto_confirm                      DO: A_CREATE_SESSION

S_CONFIRM:
  → S_DISPATCH      WHEN: user selects "Proceed"
  → S_BUILD_CHAIN   WHEN: user selects "Edit"
  → END             WHEN: user selects "Cancel"

S_DISPATCH:
  → END             DO: Skill({ skill: "maestro-ralph-execute" })

S_DECISION_EVAL:
  → S_APPLY_VERDICT WHEN: quality-gate (post-verify, post-business-test, post-review, post-test)
                     DO: A_DELEGATE_EVALUATE
  → S_APPLY_VERDICT WHEN: goal-gate (post-goal-audit)
                     DO: A_GOAL_AUDIT_EVALUATE
  → S_APPLY_VERDICT WHEN: structural (post-milestone, post-debug-escalate)
                     DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  → S_DISPATCH      WHEN: verdict == "proceed"              DO: A_APPLY_PROCEED
  → S_DISPATCH      WHEN: post-goal-audit + unmet sub-goals  DO: A_APPLY_GOAL_FIX
  → S_DISPATCH      WHEN: post-goal-audit + all sub-goals met DO: A_APPLY_GOAL_DONE
  → S_DISPATCH      WHEN: verdict == "fix"                  DO: A_APPLY_FIX
  → S_DISPATCH      WHEN: verdict == "escalate"             DO: A_APPLY_ESCALATE
  → S_DISPATCH      WHEN: post-milestone + next milestone   DO: A_ADVANCE_MILESTONE
  → END             WHEN: post-milestone + no next milestone DO: mark completed
  → END             WHEN: post-debug-escalate (always STOP)  DO: A_PAUSE_ESCALATE
  GUARD: retry_count >= max_retries → force escalate
  GUARD: confidence_score < 60 AND proceed → override to fix
  GUARD: confidence_score > 95 AND fix AND retry > 0 → suggest proceed
  GUARD: auto_confirm → skip user prompt, apply adjusted verdict
  GUARD: not auto_confirm → AskUserQuestion with override options

S_FALLBACK:
  → S_PARSE_ROUTE   WHEN: user provides input               DO: AskUserQuestion
  → END             WHEN: user cancels

</transitions>

<actions>

### A_SHOW_STATUS

1. Find latest ralph session (by created_at)
2. Display: Session, Status, Position, Progress, Current step
3. List steps: [✓] completed, [▸] current, [ ] pending, [◆] decision
4. If `task_decomposition` present (graceful skip if absent — backward compat):
   ```
   Sub-goals  ({done}/{total})    source: {session_dir}/status.json#/task_decomposition
   [x] G1 done_when={done_when}   evidence={evidence}
   [ ] G2 done_when={done_when}   evidence={evidence} ◀ unmet
   ...
   Checklist view: {session_dir}/goal-checklist.md  (regenerated from status.json)
   ```
   Reads state directly from `status.json.task_decomposition[*].status` — checklist is just a view, status.json wins on conflict.

### A_RESOLVE_PHASE

**前置于 A_INFER_POSITION**——position 推断需要先知道 target phase 是否在 state.json 中已存在。

**Priority (产出 `phase` + `phase_is_new` 二元组):**

| Step | 行为 | phase_is_new |
|------|------|--------------|
| 1 | intent 匹配 `phase\s*(\d+)` 正则 → 取 state.json 中对应 phase | false |
| 2 | intent 派生短语（如 "docs-site-redesign", "auth-refactor"）→ 在 state.json.milestones[*].phases / artifacts[*].path 中查找 | false (匹配) / true (无匹配) |
| 3 | 未派生 → 取最新 in-progress artifact 的 phase | false |
| 4 | 仍无 → state.json 首个 incomplete phase | false |
| 5 | position 将是 brainstorm/init/roadmap → phase = null | n/a |
| 6 | 仍模糊 → `AskUserQuestion`（新 phase / 已存在 phase 二选一） | 由用户回答确定 |

**写入 session**: `phase`（字符串或 null）+ `phase_is_new`（bool）。`phase_is_new=true` 表示当前 milestone 下需要为这个 phase 创建全套生命周期（A_INFER_POSITION 据此强制起始位置）。

**新派生 phase 时 milestone 处理**：
- 若 state.json 当前 milestone 仍 active → 沿用当前 milestone，仅新增 phase
- 若 intent 同时派生了新 milestone 名（如 "M1-visual-replication"）→ 写入 session 但**仅作标签**；state.json.milestones 由后续 `maestro-roadmap` / `maestro-milestone-release` 真实创建。session 层面禁止虚构 milestone 直接改 state.json

### A_INFER_POSITION

**Intent-based override:** brainstorm/头脑风暴/探索/ideate/设计思路 → position = `brainstorm`

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
| `phase_is_new == true` (intent 派生的新 phase, state.json 中无) | **`analyze`** (强制从头起) |
| no milestones or no roadmap.md | `roadmap` |
| `phase == null` (brainstorm/init/roadmap 已由 override 决定) | n/a |
| phase 已存在 + 无任何 artifact | `analyze` |
| phase 已存在 + 最新 artifact = analyze | `plan` |
| phase 已存在 + 最新 artifact = plan | `execute` |
| phase 已存在 + 最新 artifact = execute | `verify` |
| phase 已存在 + 最新 artifact = verify | → refine from result files |

**关键不变量**：artifact 过滤必须用 `session.phase`（A_RESOLVE_PHASE 已写入），而不是 state.json.current_phase。当 `phase_is_new` 时跳过过滤直接走 `analyze`，避免错用其他 phase 的 artifact 推断。

**Refine from verify results:**

| Condition | Position |
|-----------|----------|
| verification.json: passed==false or gaps[] | `verify-failed` |
| passed==true, no review.json | `business-test` |
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `milestone-audit` |
| uat.md: has failures | `test-failed` |

### A_DETERMINE_QUALITY_MODE

决定下游质量管线长度。读 `session.quality_mode_override`（CLI 标志 `--quality`），无则按规则推断：

| Condition | Mode | Pipeline (verify 之后) |
|-----------|------|-------------------------|
| Has `specs/REQ-*.md` + 当前 phase 业务范围明确 | `full` | business-test → review → test-gen → test |
| Default | `standard` | review → test-gen (当 coverage<80%) → test |
| `--quality quick` | `quick` | review --tier quick |

写入 `session.quality_mode`。A_BUILD_STEPS 据此过滤 stage（见下）。

### A_DECOMPOSE_TASKS

Build the boundary contract + outcome sub-goal checklist that `/goal` will track. Runs once at session creation, before chain build. All output is **additive** to status.json.

**1. Classify intent breadth:**

| Pattern | Breadth | Clarify? |
|---------|---------|----------|
| 重构/全面/重写/重做/整体/迁移 · overhaul/migrate/rewrite/revamp | broad | MUST (ignores auto_confirm) |
| named single file/function/bug, "fix X", "add Y to Z" | narrow | skip — auto-derive |
| otherwise | medium | clarify unless auto_confirm |

**2. Clarify boundary** (broad/medium) — `AskUserQuestion`, ≤3 rounds, options pre-filled from intent + a quick Glob/Grep scan of the target module:

| Round | Question | Drives |
|-------|----------|--------|
| Scope | 哪些目录/文件/层在范围内?明确排除什么? | boundary_contract.in_scope / out_of_scope |
| Constraints | 必须向后兼容?公共 API 冻结?行为/性能预算?测试门槛? | boundary_contract.constraints + execution_criteria |
| Done | 什么可观测结果算"完成"?(如:测试全绿 + 行为零变更 + X 指标) | boundary_contract.definition_of_done |

narrow → derive defaults from intent + codebase, skip questions.

**3. Derive `execution_criteria`** (执行准则 — 3-6 short imperative rules every step obeys): backward-compat stance, scope-freeze ("只改请求范围"), test/coverage bar, fix-don't-hide, incremental commit. Each verify/review/test gate later checks against these.

**4. Derive `task_decomposition`** (子目标清单 — outcome-oriented, NOT lifecycle stages). Each entry:
```json
{ "id": "G1", "goal": "<deliverable>", "boundary": "<in/out note>",
  "done_when": "<objectively checkable condition>",
  "evidence": "verification.json|review.json|uat.md|<test path>",
  "lifecycle": ["analyze","execute","verify"], "status": "pending" }
```
**Cleverness rule**: `done_when` MUST be objectively verifiable and SHOULD reference an artifact ralph already produces, so the `/goal` Stop hook can re-verify after context compaction. Map each sub-goal to the lifecycle phase(s) that will produce its evidence — this is how the checklist "adapts to ralph": the existing pipeline becomes the machinery that satisfies the goals.

**5. Persist** (additive) into session for A_CREATE_SESSION to write: `boundary_contract`, `execution_criteria`, `task_decomposition`. Absent feature (skipped) → write none; downstream treats as "decomposition off".

**6. Stage** the Goal Checklist + Goal Prompt (Appendix) for A_CREATE_SESSION to emit.

### A_BUILD_STEPS

Generate steps from `session.lifecycle_position` to `milestone-complete`（终点硬约束）。

| Stage | Skill | Type | Decision after | quality_mode |
|-------|-------|------|----------------|--------------|
| brainstorm | `maestro-brainstorm "{intent}"` | external | — | all |
| init | `maestro-init` | internal | — | all |
| roadmap | `maestro-roadmap "{intent}"` | internal | — | all |
| analyze | `maestro-analyze {phase}` | external | — | all |
| plan | `maestro-plan {phase}` | internal | — | all |
| execute | `maestro-execute {phase}` | external | — | all |
| verify | `maestro-verify {phase}` | internal | `post-verify` | all |
| business-test | `quality-auto-test {phase}` | internal | `post-business-test` | **full only** |
| review | `quality-review {phase}` | internal | `post-review` | all (quick: append `--tier quick`) |
| test-gen | `quality-auto-test {phase}` | internal | — | full / standard if coverage<80% |
| test | `quality-test {phase}` | internal | `post-test` | full, standard |
| milestone-audit | `maestro-milestone-audit` | internal | — | all |
| goal-audit | *(decision-only, no skill)* | decision | `post-goal-audit` | all (only if decomposed) |
| milestone-complete | `maestro-milestone-complete` | internal | `post-milestone` | all (chain 终点) |

Type rationale: `internal` = Skill(), lightweight/interactive; `external` = delegate --to claude, context-isolated heavy computation

**Build rules (按顺序应用):**

1. **起点**：从 `session.lifecycle_position` 开始；不读 `state.json.current_phase`
2. **跳过已完成**：跳过当前 milestone+phase 下已有 completed artifact 的 stage（artifact 过滤同样按 `session.phase`，不按 state.json 当前 phase）
3. **quality_mode 过滤**：按 `session.quality_mode` 排除上表 `quality_mode` 列不包含该模式的 stage（如 standard 不跑 business-test、quick 不跑 test-gen/test）
4. **决策节点**：每个 Decision after 非空的 stage 之后插入 `{ type: "decision", decision: "<gate>", retry_count: 0, max_retries: 2 }`
5. **goal-audit 插入**：当且仅当 `task_decomposition` 存在 → 在最后一个 evidence-producing stage（verify/review/test）之后、`milestone-complete` 之前插入 `decision:post-goal-audit`
6. **终点硬约束**：chain 必须以 `milestone-complete` 步骤结尾（除非 `lifecycle_position` 已是 `milestone-complete` 之后的状态）。生成器在收尾时不论 quality_mode 都必须 append 该 step
7. **初始 goal_ref 传播**：若 `task_decomposition` 存在，遍历每个新建 step：
   - 计算 `step.stage`（如 execute/verify/review）
   - 对每个 `g ∈ task_decomposition`：若 `step.stage ∈ g.lifecycle` → `step.goal_ref = g.id`
   - 多 G 匹配 → 取 id 字典序最小者；保证 verify/review 等共用 lifecycle 的 step 也有可追溯标签
   - decision 节点不打 goal_ref（goal-audit 自身除外，它的 verdict 直接修改 task_decomposition）
8. **占位符**：args 用 `{phase}` `{intent}` 等，由 ralph-execute 在执行时解析
9. **动态插入**：`post-goal-audit` 触发 A_APPLY_GOAL_FIX 时插入的步骤同样按规则 7 打 `goal_ref`（追溯到触发它的子目标 G{n}）

### A_CREATE_SESSION

1. Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json` (Appendix: Session Schema) — decomposition fields included only if produced (additive)
2. If `task_decomposition` present:
   - Set `session.goal_checklist_path = "{session_dir}/goal-checklist.md"` in status.json
   - **Render** checklist from status.json (Appendix: Goal Checklist Template + Sync Rule). This is a one-way projection — status.json drives content; the file is never hand-edited
   - Stable filename within session (so `/goal` condition string survives context compaction)
3. Display chain overview with step list
4. If `task_decomposition` present: display the **Goal Prompt block** (Appendix: Goal Prompt Template) — the copy-paste `/goal …` line binds status.json + checklist as a Stop-hook target

### A_DELEGATE_EVALUATE

1. Resolve artifact dir: `.workflow/scratch/{artifact.path}/` with fallback glob
2. Parse decision metadata: `{ decision, retry_count, max_retries }`
3. Map result files:
   | Decision | Files |
   |----------|-------|
   | post-verify | verification.json |
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

**post-milestone:** Read state.json → next milestone? → insert lifecycle steps / complete
**post-debug-escalate:** Always STOP → set paused, display "请人工介入"

### A_GOAL_AUDIT_EVALUATE

Re-checks sub-goals against `status.json` (source of truth) and decides whether `steps[]` must dynamically grow. Only runs when `task_decomposition` present.

1. Read `session.task_decomposition` from status.json (NOT from checklist — checklist is just a view)
2. For each sub-goal `status != "done"`: resolve its `evidence` artifact (verification.json / review.json / uat.md / test path) under the current phase scratch dir
3. Delegate read-only audit (run_in_background, STOP, wait):
   ```
   maestro delegate "PURPOSE: 审计未完成子目标，判定哪些已达成、哪些仍需补步骤
   TASK:
     1. 读取 status.json.task_decomposition 中每个 status!=done 的子目标
     2. 打开其 evidence 产物，对照 done_when 严格判定
     3. 输出 met / unmet 分类，unmet 给出差距 + 应回补的 target_phase
   CONTEXT:
     status.json   = {session_dir}/status.json
     checklist     = {goal_checklist_path}        (人类可读视图，仅供参考)
     evidence      = {evidence artifacts}
     执行准则      = {execution_criteria}
     边界契约      = {boundary_contract}
   EXPECTED (单行 verdict 块，严格遵循):
     ---VERDICT---
     STATUS=all_met|has_unmet
     UNMET=[{id:G2,gap:'...',target_phase:execute}, ...]   # 空数组当 STATUS=all_met
     CONFIDENCE_SCORE=0-100
     ---END---
   CONSTRAINTS:
     - 只评估，不修改任何文件
     - 严格按 done_when 判定；evidence 缺失 → 视为 unmet
     - 不得建议超出 boundary_contract 的修改
   "
   --role analyze --mode analysis
   ```
4. On callback: parse UNMET list. **status.json is the write target** — for each met sub-goal: `task_decomposition[i].status="done"` + `task_decomposition[i].completed_at=now`. Then regenerate checklist view from status.json (see Sync Rule in Appendix).
5. **Decision log**: append to `{session_dir}/decisions.ndjson` with `"type": "goal-gate"`, `unmet_count`, `unmet_ids`
6. Verdict: `all_met` → A_APPLY_GOAL_DONE; `has_unmet` → A_APPLY_GOAL_FIX
   GUARD: retry_count >= max_retries AND still unmet → A_APPLY_ESCALATE (insert quality-debug, hand to human)

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

### A_APPLY_GOAL_FIX

**This is the dynamic step-growth core.** For every unmet sub-goal, inject scoped execution steps so `steps[]` grows toward convergence:

1. For each `unmet` sub-goal `G{n}` (grouped by `target_phase` to avoid duplicate runs):
   insert before the `goal-audit` node a scoped mini-loop (see Appendix: Fix-Loop Templates → post-goal-audit), each inserted step tagged `goal_ref: "G{n}"`
2. Re-append a fresh `decision:post-goal-audit {retry+1}` after the inserted steps (re-loops until all met or max retries)
3. Reindex steps, increment retry_count, write status.json (steps[] now larger — the JSON "grew")
4. Display: ◆ Goal audit: {k} sub-goals unmet → +{N} steps inserted (G{ids}), retry {r}/{max}

### A_APPLY_GOAL_DONE

1. Write status.json (source of truth): set every `task_decomposition[*].status="done"`, `completed_at=now`, plus top-level `task_decomposition_all_done=true`
2. Regenerate `goal-checklist.md` from status.json (Sync Rule in Appendix) — all boxes flip to `[x]`, sentinel `ALL_GOALS_DONE` appended at file end
3. Mark goal-audit decision completed; proceed to `milestone-complete`
4. Display: ◆ Goal audit: 全部子目标达成 ✓ — status.json + checklist 已同步 ALL_GOALS_DONE

### A_ADVANCE_MILESTONE

1. Update session: milestone, phase, reset passed_gates
2. Insert full lifecycle steps for next milestone
3. Reindex, write status.json

### A_PAUSE_ESCALATE

1. Set session status = "paused", write status.json
2. Display: ◆ 已达最大重试次数，debug 已执行。请人工介入。
3. Display: /maestro-ralph continue 恢复

</actions>

</state_machine>

<appendix>

### Session Schema

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph", "status": "running",
  "intent": "", "lifecycle_position": "",
  "phase": null, "phase_is_new": false, "milestone": "",
  "auto_mode": false,
  "quality_mode": "standard",   // "full" | "standard" | "quick" — 由 A_DETERMINE_QUALITY_MODE 写入
  "cli_tool": "claude", "passed_gates": [],
  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null,
    "analysis_dir": null, "brainstorm_dir": null },
  "steps": [{ "index": 0, "type": "internal|external|decision",
    "skill": "", "args": "", "status": "pending",
    "goal_ref": null }],
  "waves": [], "current_step": 0,

  "_comment": "↓ OPTIONAL additive decomposition block (v0.4.8+). Absent → no decomposition; readers MUST tolerate missing keys. Never remove/rename above fields.",
  "boundary_contract": {
    "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": ""
  },
  "execution_criteria": [],
  "task_decomposition": [
    { "id": "G1", "goal": "", "boundary": "", "done_when": "",
      "evidence": "", "lifecycle": [], "status": "pending|done",
      "completed_at": null }
  ],
  "task_decomposition_all_done": false,
  "goal_checklist_path": "",
  "goal_checklist_synced_at": null
}
```

**扩展约定**：
- Schema 加字段 = 可选（缺省 = 旧行为）；不删/不改既有字段名。
- `steps[]` 是活数组：`post-goal-audit` 与 `post-verify/review/test` 等决策节点按需追加+重排，子目标收敛即停。`goal_ref`（可选）回溯每条动态插入步骤所属子目标。

### Fix-Loop Templates

**post-verify:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}                [external]
maestro-verify {phase}
decision:post-verify {retry+1}
```

**post-business-test:**
```
quality-debug --from-business-test "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}                [external]
maestro-verify {phase}
decision:post-verify {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry+1}
```

**post-review:**
```
quality-debug "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}                [external]
quality-review {phase}
decision:post-review {retry+1}
```

**post-test:**
```
quality-debug --from-uat "{gap_summary}"
maestro-plan --gaps {phase}
maestro-execute {phase}                [external]
maestro-verify {phase}
decision:post-verify {retry: 0}
quality-auto-test {phase}
decision:post-business-test {retry: 0}
quality-review {phase}
decision:post-review {retry: 0}
quality-auto-test {phase}
quality-test {phase}
decision:post-test {retry+1}
```

**post-goal-audit:** (per unmet sub-goal group — this is what dynamically grows `steps[]`)
```
# for each unmet sub-goal G{n}, scoped to its target_phase:
maestro-plan --gaps {target_phase} "G{n}: {gap}"     [goal_ref: G{n}]
maestro-execute {target_phase}             [external] [goal_ref: G{n}]
maestro-verify {target_phase}                         [goal_ref: G{n}]
# after all unmet groups inserted, re-loop the audit:
decision:post-goal-audit {retry+1}
```
Notes: only unmet sub-goals' phases are re-run (no full-pipeline replay); inserted steps carry `goal_ref` for traceability; loop exits when audit returns `all_met` (→ A_APPLY_GOAL_DONE) or retry hits max (→ escalate to human). This keeps growth bounded.

### Goal Checklist Template (status.json projection)

`{session_dir}/goal-checklist.md` 是 `status.json` 的只读投影：不要手改，永远从 JSON 重渲染。文件名在 session 内稳定，`/goal` 条件字符串跨上下文压缩仍可用。

```markdown
# Ralph Goal Checklist — {session_id}
<!-- AUTO-GENERATED from status.json. Source: ../status.json#/task_decomposition -->

> Intent    : {intent}
> Source    : `{session_dir}/status.json` (authoritative)
> Last sync : {ISO}    Phase: {phase}    Milestone: {milestone}

## Resume / 恢复入口
**不要直接执行 skill，调用入口：**
```
/maestro-ralph continue
```
ralph 评估下一步门控，ralph-execute 跑实际步骤。Stop hook 触发时也走这条路径。

## 执行准则 / Execution Criteria
<!-- status.json#/execution_criteria -->
- {criterion 1}
- {criterion 2}

## 边界契约 / Boundary Contract
<!-- status.json#/boundary_contract -->
- In scope           : {in_scope}
- Out of scope       : {out_of_scope}
- Constraints        : {constraints}
- Definition of Done : {definition_of_done}

## 子目标 / Sub-goals    ({done}/{total})
<!-- status.json#/task_decomposition -->
- [ ] G1 — {goal}
       done_when : {done_when}
       evidence  : {evidence}
       lifecycle : {lifecycle}
       <!-- ref: status.json#/task_decomposition/0  status=pending -->
- [x] G2 — {goal}
       done_when : {done_when}
       evidence  : {evidence}
       <!-- ref: status.json#/task_decomposition/1  status=done  completed_at={ISO} -->
- [ ] G3 — ...

<!-- A_APPLY_GOAL_DONE 在全部 status=done 时在文件末尾追加 ALL_GOALS_DONE -->
```

### Sync Rule (status.json ↔ goal-checklist.md)

单向投影；status.json 为真源；冲突时直接重渲染，不合并。

1. 只有 ralph / ralph-execute 写 `task_decomposition[*].status`；markdown 不可写入状态。
2. `task_decomposition` / `execution_criteria` / `boundary_contract` 任一变化 → 立即重渲染 checklist。
3. 全部 `status="done"` → 在文件末追加 `ALL_GOALS_DONE` 哨兵行。
4. 检测到 checklist 缺失或与 JSON 漂移 → 直接重渲染覆盖；视 markdown 为可丢弃产物。
5. ralph-execute（可选、向后兼容）：完成 `lifecycle` 覆盖某子目标的 step 后，校验 evidence；满足则置 `status="done"` + 重渲染。无 `task_decomposition` 字段 → 不动作。

### Goal Prompt Template

链路概览后逐字显示（仅当 decomposition 已产出）：

```
📋 任务分解完成。复制下面一行设定目标，会话在子目标全部达成前不停：

/goal 目标达成条件: {session_dir}/status.json 中 task_decomposition[*].status 全部为 "done"（等价: {session_dir}/goal-checklist.md 末尾含 ALL_GOALS_DONE）。未达成时: 阅读 {session_dir}/goal-checklist.md 取得"执行准则/边界契约/子目标"作为行动手册, 然后调用 /maestro-ralph continue 推进下一步; 严禁手动执行 skill 或越界修改 status.json.boundary_contract.out_of_scope。

随后运行 /maestro-ralph continue 立即开始执行。
```

`/goal` 是 harness 命令，仅用户能输入；ralph 只能输出此提示词。判据以 status.json 为权威，哨兵为等价信号，避免视图漂移误判。

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no running session | Prompt for intent |
| E002 | error | Cannot infer lifecycle position | Show raw state, ask |
| E003 | error | Artifact dir not found for decision | Show glob, ask |
| E004 | error | Delegate verdict parse failed | Fallback: "fix" |
| E005 | error | Delegate execution failed | Fallback: "fix" |
| W001 | warning | Decision expanded chain | Auto-handled |
| W002 | warning | Max retries, escalating | Auto-handled |
| W003 | warning | Multiple running sessions | Use latest, warn |
| W004 | warning | Low delegate confidence | Show warning |

### Success Criteria

- [ ] Phase 先于 position 解析（S_RESOLVE_PHASE → S_INFER → S_QUALITY_MODE）；phase_is_new 标记写入 session
- [ ] phase_is_new=true 时 lifecycle_position 强制为 `analyze`（禁止用其他 phase 的 artifact 推断）
- [ ] artifact 过滤始终按 session.phase（不读 state.json.current_phase）
- [ ] quality_mode 显式由 A_DETERMINE_QUALITY_MODE 决定（full/standard/quick），过滤 build steps
- [ ] State parsed, position inferred from bootstrap + artifacts + result files
- [ ] Decomposition runs as initial step; broad intent boundary-clarified via ≤3 questions (ignores auto_confirm); narrow auto-derives
- [ ] status.json enriched additively with boundary_contract + execution_criteria + task_decomposition; absent fields = old behavior preserved
- [ ] status.json is single source of truth; goal-checklist.md is a regenerated projection (Sync Rule), never hand-edited
- [ ] goal-checklist.md carries explicit `status.json#/task_decomposition[i]` JSON-pointer refs per entry + last-sync timestamp
- [ ] Mutations to task_decomposition trigger checklist re-render; ALL_GOALS_DONE sentinel appended only when all entries status=done
- [ ] Goal Prompt names status.json as the authoritative judgement source, with ALL_GOALS_DONE sentinel as equivalent signal
- [ ] post-goal-audit decision node inserted before milestone-complete (only when decomposed)
- [ ] Unmet sub-goals DYNAMICALLY grow steps[] via scoped per-goal mini-loops (goal_ref tagged), looping until all_met or max retries → escalate
- [ ] Quality pipeline 按 quality_mode 生成（full=全管线 / standard=skip business-test / quick=仅 review --tier quick）
- [ ] Chain 末端硬约束：必须以 `milestone-complete` 结尾（goal-audit decision 紧前）
- [ ] 初始构建按 task_decomposition[*].lifecycle 给每个 step 打 goal_ref（verify/review 等共用 lifecycle 的 step 也有标签）
- [ ] Decision nodes delegate-evaluated via maestro delegate --role analyze
- [ ] Verdict parsed with confidence adjustment
- [ ] Fix-loop templates applied with retry tracking
- [ ] Ralph never executes steps — only creates sessions and evaluates decisions
- [ ] Handoff to maestro-ralph-execute via Skill() at creation and after decisions

</appendix>
