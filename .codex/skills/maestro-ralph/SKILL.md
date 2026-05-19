---
name: maestro-ralph
description: Use when the optimal command sequence is unclear and needs automated state-based determination
argument-hint: "\"intent\" [-y] | status | continue | execute"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Coordinator infers position -> decomposes intent into a goal-tracked sub-goal checklist ->
builds chain -> **directly invokes each skill in-context** -> delegates evaluation at
decision nodes -> dynamically grows the step chain until all sub-goals converge.

Entry: `"intent"` (new session), `execute`/`continue` (resume), `status` (display).
Node types: **skill** (direct in-context invocation) and **decision** (delegate / structural evaluate).
Session at `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`.

Codex specifics:
- **No agent spawning** — skills run directly in coordinator context, sequentially, one step at a time.
- **Goal created via built-in tool** — `create_goal` binds the decomposed sub-goal checklist as a
  hard objective; `update_plan` mirrors steps; `update_goal` releases on convergence. Codex
  registers the goal itself via `create_goal`.
</purpose>

<context>
$ARGUMENTS -- intent text, flags, or keywords.

**Parse**: `-y` -> auto_mode. `.md/.txt` path -> input_doc (supplementary, never substitutes lifecycle). Remaining -> intent.

**`-y` downstream propagation**:

| Skill | Flag | Effect |
|-------|------|--------|
| maestro-init | `-y` | skip interactive |
| maestro-analyze | `-y` | skip scoping |
| maestro-brainstorm | `-y` | skip questions |
| maestro-roadmap | `-y` | skip choices |
| maestro-plan | `-y` | skip confirmation |
| maestro-execute | `-y` | skip confirmation, auto-continue blocked |
| quality-auto-test | `-y` | skip plan confirmation |
| quality-test | `-y --auto-fix` | auto gap-fix loop |
| maestro-verify | `-y` | skip confirmation |
| quality-review | `-y` | skip confirmation |
| quality-debug | `-y` | skip confirmation |
| maestro-milestone-complete | `-y` | skip knowledge promotion |
| maestro-milestone-audit | `-y` | skip confirmation |

**State files**: `.workflow/state.json`, `.workflow/roadmap.md`, `.workflow/.maestro/ralph-*/status.json`
</context>

<invariants>
1. **Skills invoked DIRECTLY in-context** — coordinator runs `$skill {resolved_args}` itself, sequentially. NO spawn_agents_on_csv, NO wave, NO worker CSV.
2. **Coordinator owns the loop** — infer -> decompose -> build -> for each step: resolve args -> invoke skill -> read result -> persist -> next.
3. **Decision nodes evaluate, never execute** — quality-gate/goal-gate via `maestro delegate --role analyze`; structural decisions evaluated directly.
4. **Goal is tool-created, not prompt-emitted** — `A_DECOMPOSE_TASKS` calls `create_goal` with the sub-goal checklist as success criteria. `update_goal` on full convergence; never released while sub-goals unmet.
5. **task_decomposition drives DYNAMIC step growth** — sub-goals are the convergence spec; `steps[]` is a living array. `post-goal-audit` re-checks the checklist and **inserts scoped skill steps** for every unmet sub-goal (same insert+reindex+retry mechanism as fix-loops). Decomposition feeds adaptive branching, never freezes a plan.
6. **Status JSON: schema-additive + step-dynamic** — decomposition fields (`boundary_contract`, `execution_criteria`, `task_decomposition`, `goal_checklist_path`) are OPTIONAL; absent = old behavior. `steps[]` grows at runtime via decisions; `goal_ref` traces dynamically-added steps. Never remove/rename existing fields.
7. **Sequential execution** — one step at a time in index order; no parallelism (no spawning). Each step's result read before the next starts.
8. **Quality mode governs steps** — full/standard/quick determines quality stages.
9. **passed_gates skip** — already-passed gates not re-run unless code changed.
</invariants>

<state_machine>

<states>
S_PARSE_ROUTE     -- 解析参数、路由入口点                PERSIST: --
S_STATUS          -- 显示 session 进度后结束             PERSIST: --
S_INFER           -- 推断生命周期位置                    PERSIST: session.lifecycle_position
S_RESOLVE_PHASE   -- 解析目标 phase                      PERSIST: session.phase
S_QUALITY_MODE    -- 确定质量模式 full/standard/quick     PERSIST: session.quality_mode
S_DECOMPOSE       -- 边界澄清、写执行准则+子目标、建 goal  PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_BUILD_CHAIN     -- 构建步骤链                          PERSIST: session.steps[]
S_CREATE_SESSION  -- 写 status.json                      PERSIST: session (full)
S_CONFIRM         -- 用户确认（auto_mode skip）          PERSIST: --
S_LOAD_NEXT       -- 找下一个 pending step               PERSIST: --
S_STEP_EXEC       -- 直接调用 skill 执行该 step           PERSIST: session.steps[], context
S_DECISION_EVAL   -- 评估质量门 / 目标门                 PERSIST: --
S_APPLY_VERDICT   -- 应用裁决                            PERSIST: passed_gates[], retry_count
S_FIX_LOOP        -- 插入修复步骤、重索引                PERSIST: session.steps[] (expanded)
S_COMPLETE        -- 标记完成                            PERSIST: session.status = "completed"
S_PAUSED          -- 暂停等待人工                        PERSIST: session.status = "paused"
S_FALLBACK        -- 请求用户输入                        PERSIST: session.status = "paused"
</states>

<transitions>

S_PARSE_ROUTE:
  -> S_STATUS        WHEN: intent == "status"
  -> S_LOAD_NEXT     WHEN: intent == "execute" | "continue"
  -> S_DECISION_EVAL WHEN: running session with decision step in "running"
  -> S_INFER         WHEN: intent non-empty
  -> S_FALLBACK      WHEN: no intent AND no running session

S_STATUS -> END      DO: A_SHOW_STATUS

S_INFER:
  -> S_RESOLVE_PHASE WHEN: position resolved    DO: A_INFER_POSITION
  -> S_FALLBACK      WHEN: cannot infer

S_RESOLVE_PHASE:
  -> S_QUALITY_MODE  DO: A_RESOLVE_PHASE

S_QUALITY_MODE:
  -> S_DECOMPOSE     DO: A_DETERMINE_QUALITY_MODE

S_DECOMPOSE:
  -> S_BUILD_CHAIN   DO: A_DECOMPOSE_TASKS
                     GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) -> MUST clarify boundary even if auto_mode
                     GUARD: narrow intent (single file/function/bug) -> auto-derive, skip questions
                     GUARD: position in {brainstorm, init} -> skip decomposition (no concrete target yet)

S_BUILD_CHAIN:
  -> S_CREATE_SESSION DO: A_BUILD_STEPS

S_CREATE_SESSION:
  -> S_CONFIRM       WHEN: not auto_mode                       DO: A_CREATE_SESSION
  -> S_LOAD_NEXT     WHEN: auto_mode                           DO: A_CREATE_SESSION

S_CONFIRM:
  -> S_LOAD_NEXT     WHEN: "Proceed"
  -> S_BUILD_CHAIN   WHEN: "Edit"
  -> S_QUALITY_MODE  WHEN: "Change quality mode"
  -> S_PAUSED        WHEN: "Cancel"

S_LOAD_NEXT:
  -> S_DECISION_EVAL WHEN: next_step.type == "decision"
  -> S_STEP_EXEC     WHEN: next_step.type == "skill"
  -> S_COMPLETE      WHEN: no pending steps

S_STEP_EXEC:
  -> S_LOAD_NEXT     WHEN: success            DO: A_EXEC_STEP
  -> S_PAUSED        WHEN: failed             GUARD: auto_mode retry once then pause

S_DECISION_EVAL:
  -> S_APPLY_VERDICT WHEN: quality-gate        DO: A_DELEGATE_EVALUATE
  -> S_APPLY_VERDICT WHEN: goal-gate           DO: A_GOAL_AUDIT_EVALUATE
  -> S_APPLY_VERDICT WHEN: structural          DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  -> S_LOAD_NEXT     WHEN: proceed             DO: add gate to passed_gates
  -> S_LOAD_NEXT     WHEN: post-goal-audit + all sub-goals met   DO: A_APPLY_GOAL_DONE
  -> S_LOAD_NEXT     WHEN: post-goal-audit + unmet sub-goals      DO: A_APPLY_GOAL_FIX
  -> S_FIX_LOOP      WHEN: fix                 DO: clear passed_gates, increment retry
  -> S_PAUSED        WHEN: escalate
  -> S_LOAD_NEXT     WHEN: post-milestone + next milestone    DO: A_ADVANCE_MILESTONE
  -> S_COMPLETE      WHEN: post-milestone + no next
  -> S_PAUSED        WHEN: post-debug-escalate (always, even -y)
  GUARD: retry >= max_retries -> force escalate
  GUARD: confidence < 60 AND proceed -> override to fix
  GUARD: confidence > 95 AND fix AND retry > 0 -> suggest proceed

S_FIX_LOOP:
  -> S_LOAD_NEXT     DO: A_INSERT_FIX_LOOP

S_COMPLETE -> END    DO: A_FINALIZE
S_PAUSED -> END      DO: A_PAUSE_SESSION
S_FALLBACK -> S_PARSE_ROUTE WHEN: user input | -> END WHEN: cancel

</transitions>

<actions>

### A_INFER_POSITION

**Intent-based override**: brainstorm pattern -> position = brainstorm.

**Bootstrap detection**:

| Condition | Position |
|-----------|----------|
| No .workflow/ + no source | brainstorm |
| No .workflow/ + has source | init |
| Has .workflow/ but no state.json | init |
| Has state.json | artifact-based inference |

**Artifact-based inference:** Filter by current_milestone + target phase:

| Condition | Position |
|-----------|----------|
| no milestones defined or no roadmap.md | `roadmap` |
| no artifacts for target phase | `analyze` |
| latest artifact = analyze | `plan` |
| latest artifact = plan | `execute` |
| latest artifact = execute | `verify` |
| latest artifact = verify | → refine from result files |

**Refine from verify results:**

| Condition | Position |
|-----------|----------|
| verification.json: passed==false or gaps[] non-empty | `verify-failed` |
| passed==true, no review.json, has auto-test report | `review` |
| passed==true, no review.json, no auto-test report | `business-test` (full) / `review` (standard/quick) |
| review.json: verdict=="BLOCK" | `review-failed` |
| review.json: verdict!="BLOCK" | `test` |
| uat.md: all passed | `milestone-audit` |
| uat.md: has failures | `test-failed` |

### A_RESOLVE_PHASE

Priority: regex from intent `phase\s*(\d+)` -> latest in-progress artifact's phase -> first incomplete phase -> null (brainstorm/init/roadmap) -> request_user_input if ambiguous.

### A_DETERMINE_QUALITY_MODE

| Condition | Mode | Pipeline |
|-----------|------|----------|
| Has REQ-*.md + phase scope | full | verify -> business-test -> review -> test-gen -> test |
| Default | standard | verify -> review -> test (test-gen if coverage < 80%) |
| User --quality quick | quick | verify -> review --tier quick |

### A_DECOMPOSE_TASKS

Build the boundary contract + outcome sub-goal checklist, then **register it as a Codex goal via the built-in tool**. Runs once at session creation, before chain build. Skipped when position in {brainstorm, init}.

**1. Classify intent breadth:**

| Pattern | Breadth | Clarify? |
|---------|---------|----------|
| 重构/全面/重写/重做/整体/迁移 · overhaul/migrate/rewrite/revamp | broad | MUST (ignores auto_mode) |
| named single file/function/bug, "fix X", "add Y to Z" | narrow | skip — auto-derive |
| otherwise | medium | clarify unless auto_mode |

**2. Clarify boundary** (broad/medium) — `request_user_input`, ≤3 rounds, options pre-filled from intent + a quick Glob/Grep scan of the target module:

| Round | Question | Drives |
|-------|----------|--------|
| Scope | 哪些目录/文件/层在范围内?明确排除什么? | boundary_contract.in_scope / out_of_scope |
| Constraints | 必须向后兼容?公共 API 冻结?行为/性能预算?测试门槛? | boundary_contract.constraints + execution_criteria |
| Done | 什么可观测结果算"完成"?(如:测试全绿 + 行为零变更 + X 指标) | boundary_contract.definition_of_done |

narrow → derive defaults from intent + codebase, skip questions.

**3. Derive `execution_criteria`** (执行准则 — 3-6 short imperative rules every step obeys): backward-compat stance, scope-freeze ("只改请求范围"), test/coverage bar, fix-don't-hide, incremental commit.

**4. Derive `task_decomposition`** (子目标清单 — outcome-oriented, NOT lifecycle stages). Each entry:
```json
{ "id": "G1", "goal": "<deliverable>", "boundary": "<in/out note>",
  "done_when": "<objectively checkable condition>",
  "evidence": "verification.json|review.json|uat.md|<test path>",
  "lifecycle": ["analyze","execute","verify"], "status": "pending" }
```
**Cleverness rule**: `done_when` MUST be objectively verifiable and SHOULD reference an artifact ralph already produces, so `post-goal-audit` can re-verify after context loss. Map each sub-goal to the lifecycle phase(s) producing its evidence — the existing pipeline becomes the machinery that satisfies the goals.

**5. Persist** (additive) into session: `boundary_contract`, `execution_criteria`, `task_decomposition`, `goal_checklist_path` = `{session_dir}/goal-checklist.md`. Write the checklist file (see Appendix: Goal Checklist Template).

**6. Register goal via `create_goal`:**
```
create_goal({
  objective: "Ralph: {intent} — converge all {N} sub-goals within boundary",
  success_criteria: task_decomposition.map(g => `${g.id}: ${g.done_when}`),
  constraints: [...execution_criteria, "stay within boundary_contract"]
})
```
Goal stays bound until A_APPLY_GOAL_DONE / A_FINALIZE calls `update_goal`. Skipped feature → no create_goal beyond the default lifecycle goal in A_CREATE_SESSION.

### A_BUILD_STEPS

**Lifecycle stages:**

| Stage | Skill | Barrier | Quality Mode | Decision after |
|-------|-------|---------|-------------|----------------|
| brainstorm | maestro-brainstorm "{intent}" | yes | all | — |
| init | maestro-init | no | all | — |
| roadmap | maestro-roadmap "{intent}" | yes | all | — |
| analyze | maestro-analyze {phase} | yes | all | — |
| plan | maestro-plan {phase} | yes | all | — |
| execute | maestro-execute {phase} | yes | all | — |
| verify | maestro-verify {phase} | no | all | post-verify |
| business-test | quality-auto-test {phase} | no | full only | post-business-test |
| review | quality-review {phase} | no | all (quick: --tier quick) | post-review |
| test-gen | quality-auto-test {phase} | no | full; standard if coverage<80% | — |
| test | quality-test {phase} | no | full, standard | post-test |
| milestone-audit | maestro-milestone-audit | no | all | — |
| goal-audit | *(decision-only, no skill)* | — | all (only if decomposed) | post-goal-audit |
| milestone-complete | maestro-milestone-complete | no | all | post-milestone |

**Build rules:**
1. Start from `lifecycle_position`, end at `milestone-complete`
2. Skip stages with existing completed artifacts (check state.json)
3. Filter stages by `quality_mode` — skip non-applicable stages (see Quality Mode column)
4. Quick mode: `review` appends `--tier quick`; skips `business-test`, `test-gen`, `test`
5. Insert decision node after each stage with non-empty Decision column: `{ type: "decision", decision: "<gate>", retry_count: 0, max_retries: 2 }`
6. **If `task_decomposition` present**: insert a `goal-audit` pure-decision node (no skill) immediately before `milestone-complete` → `decision:post-goal-audit`
7. Step type for runnable stages = `"skill"` (executed directly in-context, no spawn). `barrier` field retained as optional metadata only — execution is sequential regardless
8. Args use placeholders `{phase}`, `{intent}`, `{dirs}` — resolved at step execution time
9. Append `-y` to all skill args when `auto_mode` is true (see -y propagation table in context)
10. Dynamically-inserted steps (by `post-goal-audit` / fix-loops) carry optional `goal_ref: "G{n}"`

### A_CREATE_SESSION

1. Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json` (see Session JSON Schema) — include decomposition fields only if produced (additive)
2. Initialize tracking:
   - If decomposed: goal already registered by A_DECOMPOSE_TASKS. Else: `create_goal({ objective: "Ralph lifecycle: {quality_mode} mode, {N} steps from {lifecycle_position}" })`
   - `update_plan({ plan: steps.map(step => ({ step, status: "pending" })) })`
3. If decomposed: display sub-goal checklist summary (path + G-ids + done_when). Display chain overview.

### A_EXEC_STEP

Direct in-context skill invocation — **replaces the old spawn/wave/CSV mechanism**.

1. Conditional step eval: `check_coverage` → read validation.json, skip step if ≥ threshold
2. Resolve `{phase}` / `{intent}` / `{dirs}` placeholders; arg enrichment (plan → `--dir {analysis_dir}`, execute → `--dir {plan_dir}`); append `-y` if auto_mode
3. Mark step `status="running"`, persist status.json + `update_plan` (this step → in_progress)
4. **Invoke the skill directly**: execute `$skill {resolved_args}` in the coordinator's own context (NO spawn_agents_on_csv, NO worker). Read its produced artifacts directly.
5. On success: capture summary + artifacts; mark step `status="done"`; update context (analyze→analysis_dir, plan→plan_dir, execute→exec_status, brainstorm→brainstorm_dir, roadmap→spec_session_id)
6. On failure: mark `status="failed"`; auto_mode → retry once → still failed → S_PAUSED
7. Persist status.json + `update_plan` after every step

### A_DELEGATE_EVALUATE

1. Resolve result files per decision type (post-verify: verification.json, post-business-test: report.json, post-review: review.json, post-test: uat.md + test-results.json)
2. Execute `maestro delegate` with analysis prompt → parse verdict: STATUS (proceed/fix/escalate), REASON, GAP_SUMMARY, CONFIDENCE_SCORE, WEAKEST_DIMENSION
3. Confidence adjustment: score < 60 + proceed → fix; score > 95 + fix + retry > 0 → suggest proceed

### A_GOAL_AUDIT_EVALUATE

Re-checks the goal-checklist and decides whether `steps[]` must dynamically grow. Only runs when `task_decomposition` present.

1. Read `session.task_decomposition` + `goal_checklist_path`
2. For each sub-goal `status != "done"`: resolve its `evidence` artifact under the current phase scratch dir
3. Delegate read-only audit:
   ```
   maestro delegate "PURPOSE: 审计子目标达成情况，决定是否需要补充执行步骤
   TASK: 逐个读取未完成子目标的 evidence 产物 | 对照 done_when 判定 met/unmet | 给出每个 unmet 子目标的差距与目标 phase
   CONTEXT: @{goal_checklist_path} @{evidence artifacts} | 执行准则: {execution_criteria} | 边界: {boundary_contract}
   EXPECTED: ---VERDICT--- STATUS(all_met|has_unmet) / UNMET=[{id:G2,gap:'...',target_phase:execute}] / CONFIDENCE_SCORE(0-100) ---END---
   CONSTRAINTS: 只评估不修改 | 严格按 done_when 判定 | 不得超出 boundary_contract"
   --role analyze --mode analysis
   ```
4. On result: parse UNMET. For each met sub-goal → set `task_decomposition[i].status="done"` + flip `[ ]→[x]` in goal-checklist.md
5. Verdict: `all_met` → A_APPLY_GOAL_DONE; `has_unmet` → A_APPLY_GOAL_FIX
   GUARD: retry_count >= max_retries AND still unmet → escalate (insert quality-debug, S_PAUSED for human)

### A_STRUCTURAL_EVALUATE

**post-milestone**: Read state.json → next milestone → update session (milestone, phase, reset gates), re-infer quality_mode, insert lifecycle steps. No next → complete.
**post-debug-escalate**: Pause (always, even -y). Display: max retries reached, manual intervention needed.

### A_INSERT_FIX_LOOP

Insert fix template by decision type after current position, reindex:
- **post-verify**: debug → plan --gaps → execute → verify → decision:post-verify
- **post-business-test**: debug --from-business-test → plan --gaps → execute → verify → decision:post-verify → auto-test → decision:post-business-test
- **post-review**: debug → plan --gaps → execute → verify → decision:post-verify → review → decision:post-review
- **post-test**: debug --from-uat → plan --gaps → execute → verify → decision:post-verify → [auto-test + decision:post-business-test (full)] → review → decision:post-review → [auto-test (full; standard if <80%)] → test → decision:post-test

### A_APPLY_GOAL_FIX

**Dynamic step-growth core.** For every unmet sub-goal, inject scoped skill steps so `steps[]` grows toward convergence:

1. For each `unmet` sub-goal `G{n}` (grouped by `target_phase` to avoid duplicate runs), insert before the `goal-audit` node a scoped mini-loop (see Appendix: Fix-Loop Templates → post-goal-audit), each inserted step tagged `goal_ref: "G{n}"`, type `"skill"`
2. Re-append a fresh `decision:post-goal-audit {retry+1}` after inserted steps (re-loops until all met or max retries)
3. Reindex steps, increment retry_count, persist status.json + `update_plan` (steps[] grew)
4. Display: ◆ Goal audit: {k} sub-goals unmet → +{N} steps inserted (G{ids}), retry {r}/{max}

### A_APPLY_GOAL_DONE

1. Set all `task_decomposition[*].status="done"`, persist status.json
2. Append `ALL_GOALS_DONE` sentinel to goal-checklist.md
3. `update_goal({ status: "complete" })` — releases the decomposition goal constraint
4. Mark goal-audit decision completed; proceed to `milestone-complete`
5. Display: ◆ Goal audit: 全部子目标达成 ✓ — goal 已释放

### A_ADVANCE_MILESTONE

Update session: milestone, phase, reset passed_gates. Re-infer quality_mode. Build + insert new lifecycle steps for next milestone (re-append goal-audit before milestone-complete if decomposed).

### A_FINALIZE

1. Set `session.status = "completed"`, write status.json
2. Sync `update_plan`: all steps → "completed"
3. `update_goal({ status: "complete" })` — release goal constraint (idempotent if already released by A_APPLY_GOAL_DONE)
4. Display completion report

### A_PAUSE_SESSION

1. Set `session.status = "paused"`, write status.json
2. Do NOT call `update_goal` — goal stays bound for `execute`/`continue` resume
3. Display: use `$maestro-ralph execute` to continue

### A_SHOW_STATUS

1. Find latest ralph session
2. Display: Session, Status, Position, Quality mode, Progress, Current step
3. List steps: [✓] done, [▸] running, [ ] pending, [◆] decision (with goal_ref if set)
4. If `task_decomposition` present: show `Sub-goals: {done}/{total}` + unmet G-ids (graceful skip if absent — backward compat)

</actions>

</state_machine>

<appendix>

### Session JSON Schema

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph", "intent": "", "status": "running|paused|completed",
  "lifecycle_position": "", "phase": null, "milestone": null,
  "auto_mode": false, "quality_mode": "standard", "passed_gates": [],
  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null, "analysis_dir": null, "brainstorm_dir": null },
  "steps": [{ "index": 0, "type": "skill|decision", "skill": "", "args": "", "barrier": false, "status": "pending", "goal_ref": null }],
  "waves": [], "current_step": 0,

  "_comment": "↓ OPTIONAL additive decomposition block. Absent → no decomposition; readers MUST tolerate missing keys. Never remove/rename above fields.",
  "boundary_contract": { "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": "" },
  "execution_criteria": [],
  "task_decomposition": [
    { "id": "G1", "goal": "", "boundary": "", "done_when": "", "evidence": "", "lifecycle": [], "status": "pending|done" }
  ],
  "goal_checklist_path": ""
}
```

> **Extensibility contract (two dimensions)**:
> 1. **Schema-additive** — decomposition block fields optional; absence = old behavior.
> 2. **Step-dynamic** — `steps[]` is a living array: `post-goal-audit` (and fix/escalate/milestone decisions) **append/reindex steps at runtime** until sub-goals converge. The JSON "extends" primarily by growing `steps[]`, not by freezing a plan. `goal_ref` (optional, default null) traces dynamically-added steps to the spawning sub-goal. `waves` retained as empty array for backward-compat (no longer populated — spawning removed).

### Goal Checklist Template

Written to `{session_dir}/goal-checklist.md`. Stable within the session; never renamed (so the registered `create_goal` success criteria stay traceable).

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

<!-- A_GOAL_AUDIT_EVALUATE flips [ ]→[x] when evidence confirms;
     A_APPLY_GOAL_DONE appends `ALL_GOALS_DONE` once all [x]. -->
```

### Fix-Loop Templates

- **post-verify**: `$quality-debug "{gap}"` → `$maestro-plan --gaps {phase}` → `$maestro-execute {phase}` → `$maestro-verify {phase}` → decision:post-verify {retry+1}
- **post-business-test**: debug --from-business-test → plan --gaps → execute → verify → decision:post-verify {0} → auto-test → decision:post-business-test {retry+1}
- **post-review**: debug → plan --gaps → execute → review → decision:post-review {retry+1}
- **post-test**: debug --from-uat → plan --gaps → execute → verify → decision:post-verify {0} → auto-test → decision:post-business-test {0} → review → decision:post-review {0} → auto-test → test → decision:post-test {retry+1}
- **post-goal-audit** (per unmet sub-goal group — dynamically grows steps[]):
  ```
  # for each unmet G{n}, scoped to its target_phase:
  $maestro-plan --gaps {target_phase} "G{n}: {gap}"   [goal_ref: G{n}]
  $maestro-execute {target_phase}                      [goal_ref: G{n}]
  $maestro-verify {target_phase}                       [goal_ref: G{n}]
  # after all unmet groups inserted:
  decision:post-goal-audit {retry+1}
  ```
  Only unmet sub-goals' phases re-run (no full-pipeline replay); loop exits on `all_met` (→ A_APPLY_GOAL_DONE) or retry max (→ escalate). Growth bounded.

### Error Codes

| Condition | Recovery |
|-----------|----------|
| No intent and no running session | Prompt for intent |
| Cannot infer lifecycle position | Show raw state, ask user |
| Artifact dir not found for decision | Show glob results, ask user |
| Delegate verdict parse failed | Fallback: treat as "fix" |
| Step skill invocation failed | Mark step failed; auto_mode retry once then pause |
| No session for execute/continue | Suggest $maestro-ralph "intent" |

### Success Criteria

- [ ] Lifecycle position inferred from bootstrap + artifact chain + result files
- [ ] Quality mode governs step generation
- [ ] Decomposition runs as initial step; broad intent boundary-clarified via ≤3 questions (ignores auto_mode); narrow auto-derives
- [ ] Goal registered via built-in `create_goal` with sub-goal success criteria (NOT a user-copied prompt)
- [ ] status.json enriched additively with boundary_contract + execution_criteria + task_decomposition; absent = old behavior preserved
- [ ] goal-checklist.md generated with verifiable done_when + ALL_GOALS_DONE sentinel
- [ ] post-goal-audit decision inserted before milestone-complete (only when decomposed)
- [ ] Unmet sub-goals DYNAMICALLY grow steps[] via scoped per-goal mini-loops (goal_ref tagged), loop until all_met or max retries → escalate
- [ ] Skills invoked DIRECTLY in-context — NO spawn_agents_on_csv, NO wave/CSV/worker
- [ ] Sequential execution; status.json + update_plan persisted after every step and decision
- [ ] Quality-gate / goal-gate decisions delegate-evaluated via maestro delegate --role analyze
- [ ] Confidence-based verdict adjustment applied
- [ ] -y: auto-follow verdict, no STOP (except post-debug-escalate)
- [ ] update_goal released on convergence (A_APPLY_GOAL_DONE / A_FINALIZE); held while paused

</appendix>
