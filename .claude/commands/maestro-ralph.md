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

Initial decomposition (S_DECOMPOSE): broad intents (重构/全面/迁移/重写) are boundary-clarified via ≤3 questions, producing 执行准则 + 子目标清单 written into status.json, plus a `goal-checklist.md` and a copy-paste `/goal` prompt for the user to bind.

Three node types:
- **internal**: `Skill()` call (synchronous, lightweight)
- **external**: `maestro delegate --to claude` (context-isolated, heavy computation)
- **decision**: Hand back to ralph for re-evaluation (adaptive branching)

Key difference from maestro coordinator:
- maestro: static chain → one-time selection → runs all steps
- ralph: living chain → decision nodes re-evaluate → chain grows/shrinks dynamically

Session: `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`
Mutual invocation with `/maestro-ralph-execute` forms a self-perpetuating work loop.
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
S_INFER           — 读 state.json、推断生命周期位置      PERSIST: session.lifecycle_position
S_RESOLVE_PHASE   — 解析目标 phase                      PERSIST: session.phase
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
  → S_INFER         WHEN: intent is non-empty
  → S_FALLBACK      WHEN: no intent AND no running session

S_STATUS:
  → END             DO: A_SHOW_STATUS

S_CONTINUE:
  → S_DISPATCH      WHEN: running session found
  → S_FALLBACK      WHEN: no running session               DO: display "无运行中的 ralph 会话"

S_INFER:
  → S_RESOLVE_PHASE WHEN: position resolved                 DO: A_INFER_POSITION
  → S_FALLBACK      WHEN: cannot infer

S_RESOLVE_PHASE:
  → S_DECOMPOSE     WHEN: phase resolved or null            DO: A_RESOLVE_PHASE
  → S_FALLBACK      WHEN: ambiguous
                     GUARD: auto_confirm does NOT skip phase ambiguity

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
4. If `task_decomposition` present: show `Sub-goals: {done}/{total}` and any unmet G-ids (graceful skip if field absent — backward compat)

### A_INFER_POSITION

**Intent-based override:** brainstorm/头脑风暴/探索/ideate/设计思路 → position = `brainstorm`

**Bootstrap detection:**

| Condition | Position |
|-----------|----------|
| No `.workflow/` + no source files | `brainstorm` |
| No `.workflow/` + has source files | `init` |
| Has `.workflow/` but no state.json | `init` |
| Has state.json | → artifact-based inference |

**Artifact-based inference:** Filter by current_milestone + target phase:

| Latest artifact type | Position |
|---------------------|----------|
| no milestones or no roadmap.md | `roadmap` |
| none for phase | `analyze` |
| analyze | `plan` |
| plan | `execute` |
| execute | `verify` |
| verify | → refine from result files |

**Refine from verify results:**

| Condition | Position |
|-----------|----------|
| verification.json: passed==false or gaps[] | `verify-failed` |
| passed==true, no review.json | `business-test` |
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `milestone-audit` |
| uat.md: has failures | `test-failed` |

### A_RESOLVE_PHASE

Priority: 1) regex from intent 2) latest artifact's phase 3) first incomplete phase 4) null if brainstorm/init/roadmap 5) AskUserQuestion if ambiguous

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

Generate steps from lifecycle_position to milestone-complete:

| Stage | Skill | Type | Decision after |
|-------|-------|------|----------------|
| brainstorm | `maestro-brainstorm "{intent}"` | external | — |
| init | `maestro-init` | internal | — |
| roadmap | `maestro-roadmap "{intent}"` | internal | — |
| analyze | `maestro-analyze {phase}` | external | — |
| plan | `maestro-plan {phase}` | internal | — |
| execute | `maestro-execute {phase}` | external | — |
| verify | `maestro-verify {phase}` | internal | `post-verify` |
| business-test | `quality-auto-test {phase}` | internal | `post-business-test` |
| review | `quality-review {phase}` | internal | `post-review` |
| test-gen | `quality-auto-test {phase}` | internal | — |
| test | `quality-test {phase}` | internal | `post-test` |
| milestone-audit | `maestro-milestone-audit` | internal | — |
| goal-audit | *(decision-only, no skill)* | decision | `post-goal-audit` |
| milestone-complete | `maestro-milestone-complete` | internal | `post-milestone` |

`goal-audit` row is inserted **only when `task_decomposition` present**, immediately before `milestone-complete`. It is a pure decision node (no skill step) — its job is to re-check the goal-checklist and **dynamically grow `steps[]`** for unmet sub-goals.

Type rationale: `internal` = Skill(), lightweight/interactive; `external` = delegate --to claude, context-isolated heavy computation

Build rules: start from position, skip completed, insert decision nodes with `{ retry_count: 0, max_retries: 2 }`, args use placeholders resolved at execution time by ralph-execute. Steps dynamically inserted by `post-goal-audit` carry optional `goal_ref: "G{n}"` tracing which sub-goal they serve.

### A_CREATE_SESSION

1. Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json` (see Appendix: Session Schema) — include decomposition fields only if produced (additive)
2. If `task_decomposition` present: write `{session_dir}/goal-checklist.md` (see Appendix: Goal Checklist Template) — stable within session, referenced verbatim by `/goal`
3. Display chain overview with step list
4. If `task_decomposition` present: display the **Goal Prompt block** (Appendix: Goal Prompt Template) — the copy-paste `/goal …` line binding the checklist as a Stop-hook target

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

Re-checks the goal-checklist and decides whether `steps[]` must dynamically grow. Only runs when `task_decomposition` present.

1. Read `session.task_decomposition` + `goal_checklist_path`
2. For each sub-goal `status != "done"`: resolve its `evidence` artifact (verification.json / review.json / uat.md / test path) under the current phase scratch dir
3. Delegate read-only audit (run_in_background, STOP, wait):
   ```
   maestro delegate "PURPOSE: 审计子目标达成情况，决定是否需要补充执行步骤
   TASK: 逐个读取每个未完成子目标的 evidence 产物 | 对照 done_when 判定 met/unmet | 给出每个 unmet 子目标的差距
   CONTEXT: @{goal_checklist_path} @{evidence artifacts} | 执行准则: {execution_criteria} | 边界: {boundary_contract}
   EXPECTED: ---VERDICT--- STATUS(all_met|has_unmet) / UNMET=[{id:G2,gap:'...',target_phase:execute}] / CONFIDENCE_SCORE(0-100) ---END---
   CONSTRAINTS: 只评估不修改 | 严格按 done_when 判定 | 不得超出 boundary_contract"
   --role analyze --mode analysis
   ```
4. On callback: parse UNMET list. For each met sub-goal → set `task_decomposition[i].status="done"` + flip `[ ]→[x]` in goal-checklist.md
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

1. Set all `task_decomposition[*].status="done"`, write status.json
2. Append `ALL_GOALS_DONE` sentinel line to goal-checklist.md (satisfies the user's `/goal` Stop hook)
3. Mark goal-audit decision completed; proceed to `milestone-complete`
4. Display: ◆ Goal audit: 全部子目标达成 ✓ — checklist 已写入 ALL_GOALS_DONE

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
  "phase": null, "milestone": "",
  "auto_mode": false, "quality_mode": "standard",
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
      "evidence": "", "lifecycle": [], "status": "pending|done" }
  ],
  "goal_checklist_path": ""
}
```

> **Extensibility contract (two dimensions)**:
> 1. **Schema-additive** — decomposition block fields are optional; absence = old behavior.
> 2. **Step-dynamic** — `steps[]` is a *living array*: `post-goal-audit` (and existing fix/escalate/milestone decisions) **append/reindex steps at runtime** until sub-goals converge. The JSON "extends" primarily by growing `steps[]`, not by freezing a plan. `goal_ref` (optional, default null) traces dynamically-added steps back to the sub-goal that spawned them.

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

### Goal Checklist Template

Written to `{session_dir}/goal-checklist.md`. Stable within the session; never renamed (so the `/goal` condition string stays valid across context compaction).

```markdown
# Ralph Goal Checklist — {session_id}
> Intent: {intent}

## 执行准则 / Execution Criteria
- {criterion 1}
- {criterion 2}

## 边界契约 / Boundary Contract
- In scope: {in_scope}
- Out of scope: {out_of_scope}
- Constraints: {constraints}
- Definition of Done: {definition_of_done}

## 子目标 / Sub-goals
- [ ] G1: {goal} — done when: {done_when} (evidence: {evidence})
- [ ] G2: {goal} — done when: {done_when} (evidence: {evidence})
- [ ] G3: ...

<!-- ralph-execute flips [ ]→[x] when a sub-goal's evidence artifact confirms done;
     appends the line `ALL_GOALS_DONE` once every box is [x]. -->
```

`maestro-ralph-execute` responsibility (additive, optional): after a step whose `lifecycle` covers a sub-goal, re-check that sub-goal's `evidence` artifact; if satisfied, set `task_decomposition[i].status="done"` in status.json AND flip its checkbox in goal-checklist.md. When all done → append `ALL_GOALS_DONE`. If decomposition fields absent → do nothing (old behavior).

### Goal Prompt Template

Displayed verbatim after the chain overview (only when decomposition produced):

```
📋 任务分解完成。可选(推荐)：复制下面一行设定目标，让会话在所有子目标达成前不停：

/goal 当 {session_dir}/goal-checklist.md 中所有子目标复选框均为 [x] 且文件含 ALL_GOALS_DONE 哨兵时目标达成；否则依据文件内"执行准则"继续推进未完成子目标，不得超出边界契约范围

然后运行 /maestro-ralph continue 开始执行。
```

> `/goal` 是 harness 命令、仅用户可输入 — ralph 只输出此提示词，不能自行注册。这与 status.json 的可扩展约定一致：绑定是用户侧、可选的增量能力。

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

- [ ] State parsed, position inferred from bootstrap + artifacts + result files
- [ ] Decomposition runs as initial step; broad intent boundary-clarified via ≤3 questions (ignores auto_confirm); narrow auto-derives
- [ ] status.json enriched additively with boundary_contract + execution_criteria + task_decomposition; absent fields = old behavior preserved
- [ ] goal-checklist.md generated with verifiable done_when mapped to ralph evidence + ALL_GOALS_DONE sentinel
- [ ] Goal Prompt emitted for user to bind via /goal
- [ ] post-goal-audit decision node inserted before milestone-complete (only when decomposed)
- [ ] Unmet sub-goals DYNAMICALLY grow steps[] via scoped per-goal mini-loops (goal_ref tagged), looping until all_met or max retries → escalate
- [ ] Quality pipeline generated: verify → business-test → review → test-gen → test
- [ ] Decision nodes delegate-evaluated via maestro delegate --role analyze
- [ ] Verdict parsed with confidence adjustment
- [ ] Fix-loop templates applied with retry tracking
- [ ] Ralph never executes steps — only creates sessions and evaluates decisions
- [ ] Handoff to maestro-ralph-execute via Skill() at creation and after decisions

</appendix>
