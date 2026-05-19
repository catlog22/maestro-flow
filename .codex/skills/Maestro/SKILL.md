---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--super]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Sequential pipeline coordinator. Classify intent → decompose (broad lifecycle intents) →
resolve chain → **directly invoke each skill in-context, one at a time** → report.

Entry points:
- **`$maestro "intent"`** — Classify → decompose → chain → execute
- **`$maestro --continue`** — Resume from first pending step
- **`$maestro --dry-run "intent"`** — Show chain, no execution
- **`$maestro --super "intent"`** — Production-ready mode (read maestro-super.md)

Codex specifics (parity with maestro-ralph):
- **No agent spawning** — skills run directly in coordinator context, sequentially.
- **Goal created via built-in tool** — `create_goal` binds the decomposed sub-goal checklist;
  `update_plan` mirrors steps; `update_goal` releases on convergence.
</purpose>

<deferred_reading>
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag is active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special flags.

**Flags:**
- `-y, --yes` — Auto mode: skip all prompts; propagate `-y` to each skill
- `--continue` — Resume latest paused session from first pending step
- `--dry-run` — Display planned chain without executing
- `--super` — Read and follow `maestro-super.md` completely

**Session state**: `.workflow/.maestro/{session-id}/`
</context>

<invariants>
1. **Skills invoked DIRECTLY in-context** — coordinator runs `$skill {resolved_args}` itself, sequentially. NO spawn_agents_on_csv, NO wave/CSV/worker.
2. **Coordinator owns the loop** — classify → decompose → resolve chain → for each step: resolve args → invoke skill → read result → persist → next.
3. **Decomposition contract shared with maestro-ralph** — broad/lifecycle intents run S_DECOMPOSE producing the SAME additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`, `goal_checklist_path`) + `goal-checklist.md`. Reference maestro-ralph `A_DECOMPOSE_TASKS`; do not duplicate logic.
4. **Goal is tool-created** — `A_DECOMPOSE_TASKS` calls `create_goal` with sub-goal success criteria. `update_goal` on convergence; held while aborted/paused.
5. **Status JSON: schema-additive + step-dynamic** — decomposition fields OPTIONAL (absent → old flat-chain behavior); `steps[]` is a living array grown at runtime by `post-goal-audit`. `goal_ref` traces dynamically-added steps. Never remove/rename existing fields. `waves` kept as empty array for backward-compat (spawning removed).
6. **Sequential execution** — one step at a time in index order; each step's result read before the next starts.
7. **Abort on failure** — failed step → mark remaining skipped → report (goal stays bound for `--continue`).
</invariants>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags              PERSIST: —
S_CONTINUE      — 加载已有 session，定位 resume 点   PERSIST: session (loaded)
S_CLASSIFY      — 意图分类、解析 chain (A_CLASSIFY)   PERSIST: —
S_DECOMPOSE     — 边界澄清、写执行准则+子目标、建 goal PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_CREATE        — 创建 session + status.json         PERSIST: session.status, session.steps[]
S_DRY_RUN       — 显示 chain 后结束                  PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）          PERSIST: —
S_STEP_LOOP     — 逐步直接调用 skill → 读结果 → 循环  PERSIST: session.current_step, session.steps[], session.context
S_DECISION_EVAL — 评估 post-goal-audit 决策节点       PERSIST: —
S_COMPLETE      — 标记完成、释放目标                  PERSIST: session.status = "completed"
S_ABORTED       — 失败中止、标记剩余 skipped          PERSIST: session.status = "aborted"
S_FALLBACK      — 意图无法分类，请求输入              PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_CONTINUE    WHEN: --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_FALLBACK    WHEN: no intent AND no flags

S_CONTINUE:
  → S_STEP_LOOP   WHEN: session found, has pending steps     DO: A_RESUME_SESSION
  → S_FALLBACK    WHEN: no session found

S_CLASSIFY:
  → S_DECOMPOSE   WHEN: chain resolved                      DO: A_CLASSIFY
  → S_FALLBACK    WHEN: no match AND auto_mode
  → S_CLASSIFY    WHEN: no match AND not auto_mode          DO: A_CLARIFY_INTENT
                   GUARD: max 1 clarification attempt → S_FALLBACK

S_DECOMPOSE:
  → S_CREATE      DO: A_DECOMPOSE_TASKS
                   GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) on multi-step lifecycle chain → MUST clarify even if auto_mode
                   GUARD: single-step chain OR narrow intent OR chain ∈ {status,init,quick} → skip decomposition (pass through)

S_CREATE:
  → S_DRY_RUN     WHEN: --dry-run flag                      DO: A_CREATE_SESSION
  → S_CONFIRM     WHEN: not auto_mode                       DO: A_CREATE_SESSION
  → S_STEP_LOOP   WHEN: auto_mode                           DO: A_CREATE_SESSION

S_DRY_RUN:
  → END           DO: display chain with step types + sub-goal summary

S_CONFIRM:
  → S_STEP_LOOP   WHEN: user confirms
  → S_ABORTED     WHEN: user cancels

S_STEP_LOOP:
  → S_DECISION_EVAL WHEN: next step.type == "decision"
  → S_STEP_LOOP   WHEN: next step.type == "skill"           DO: A_EXEC_STEP
  → S_COMPLETE    WHEN: no pending steps
  → S_ABORTED     WHEN: step failed (auto_mode: retry once then abort)

S_DECISION_EVAL:                                            ENTRY: A_GOAL_AUDIT_EVALUATE (produces verdict)
  → S_STEP_LOOP   WHEN: verdict == all_met                  DO: A_APPLY_GOAL_DONE
  → S_STEP_LOOP   WHEN: verdict == has_unmet                DO: A_APPLY_GOAL_FIX
  → S_ABORTED     WHEN: retry >= max_retries AND unmet      DO: escalate (insert quality-debug "{gaps}")

S_COMPLETE:
  → END           DO: A_FINALIZE

S_ABORTED:
  → END           DO: A_ABORT_REPORT

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent            DO: AskUserQuestion
  → END           WHEN: user cancels

</transitions>

<actions>

### A_CLASSIFY

**Layer 1: Exact-match (fast path)**
- `--chain <name>` flag → validate against chainMap, use directly (E002 if not found)
- `continue`/`next`/`go`/`继续`/`下一步` → `state_continue`
- `status`/`状态`/`dashboard` → `status`

If matched, skip to chain resolution.

**Layer 2: Semantic intent matching**

Directly match user intent to the best `task_type` (maps to chain in Chain Map). Use LLM semantic understanding — no rigid keyword lookup.

Extract:
```json
{
  "task_type": "<from chain catalog below>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low|normal|high>"
}
```

**Chain catalog — select by best semantic fit:**

| task_type | When user intent is about... |
|-----------|---------------------------|
| `quick` | Simple/small task, add a feature, quick change |
| `plan` | Plan, design, architect a phase |
| `execute` | Implement, develop, code a phase |
| `analyze` | Understand, investigate, evaluate code |
| `verify` | Check goals met, validate results |
| `review` | Code quality review |
| `test` | Run or create tests, UAT |
| `test_gen` | Generate tests for coverage gaps |
| `debug` | Diagnose, troubleshoot, fix broken behavior |
| `refactor` | Restructure, clean up, reduce tech debt |
| `init` | Initialize project |
| `sync` | Update/sync documentation |
| `retrospective` | Phase review, post-mortem, 复盘 |
| `learn` | Capture insights, record learnings |
| `release` | Publish, ship, tag version |
| `amend` | Revise workflow commands |
| `compose` | Design/compose reusable workflows |
| `overlay` | Create/edit command overlays |
| `update` | Update maestro itself |
| `harvest` | Extract knowledge from artifacts |
| `wiki` | Manage wiki graph |
| `knowhow` | Manage knowhow entries |
| `ui_design` | UI design, build new UI |
| `issue` | Issue CRUD — create, list, close, query |
| `issue_discover` | Discover/find issues in codebase |
| `issue_analyze` | Analyze a specific issue |
| `issue_plan` | Plan fix for an issue |
| `issue_execute` | Fix issue end-to-end (auto-upgrades to issue-full) |
| `feature` | Standard feature: plan→execute→verify |
| `full-lifecycle` | Complete phase: plan→execute→verify→review→test→audit→complete |
| `brainstorm-driven` | Start from exploration/brainstorm |
| `spec-driven` | From spec/requirements (heavy, with init) |
| `roadmap-driven` | From requirements (light, with init) |
| `analyze-plan-execute` | Fast track: analyze→plan→execute |
| `execute-verify` | Resume after planning |
| `review-fix` | Fix review-blocked issues |
| `quality-loop` | Full quality improvement cycle |
| `quality-loop-partial` | Partial quality fix |
| `quality-fix` | Analyze gaps→plan→execute→verify |
| `deploy` | Verify then release |
| `milestone-close` | Close/transition milestone |
| `milestone-release` | Release milestone with version tag |
| `phase_transition` | Transition phase: audit→complete |
| `next-milestone` | Advance to next milestone |
| `state_continue` | Continue from current project state |

**Selection priorities:**
1. `issue_id` present → prefer issue chains
2. UI/design/界面/页面/原型 → prefer `ui_design`
3. Multiple lifecycle steps implied → prefer multi-step chains
4. Single specific action → prefer single-step chains
5. "问题" describing broken behavior → `debug`; tracked item with ISS-ID → `issue`; ambiguous → `debug`
6. Simple task, no lifecycle context → `quick`
7. Global fallback → `quick`

**Clarity scoring**: 3=task_type+scope+phase, 2=task_type+scope, 1=task_type only, 0=empty.
If `clarity < 2` and not `auto_mode` → transition to A_CLARIFY_INTENT.

**Layer 4: State-based routing** (when `taskType === 'state_continue'`)

Read `.workflow/state.json` and route by condition:

| Condition | Chain |
|-----------|-------|
| Not initialized | `init` |
| No phases, no roadmap, has accumulated_context | `next-milestone` |
| No phases | `brainstorm-driven` |
| pending + has context | `plan` |
| pending, no context | `analyze` |
| exploring/planning + has plan | `execute-verify` |
| exploring/planning, no plan | `plan` |
| executing, all tasks done | `verify` |
| executing, tasks remain | `execute` |
| verifying, passed + no review | `review` |
| verifying, passed + BLOCK | `review-fix` |
| verifying, passed + UAT pending | `test` |
| verifying, passed + UAT passed | `milestone-close` |
| verifying, passed + UAT failed | `debug` |
| verifying, not passed | `quality-loop-partial` |
| testing, UAT passed | `milestone-close` |
| testing, UAT not passed | `debug` |
| completed | `milestone-close` |
| blocked | `debug` |
| fallback | `status` |

**Chain resolution order:**
1. `forceChain` → `chainMap[forceChain]` (E002 if not found)
2. `state_continue` → Layer 4 state routing → `{ chain, argsOverride? }`
3. `taskToChain[taskType]` → alias lookup (see Chain Aliases below)
4. `chainMap[taskType]` → direct lookup

**Phase resolution**: structured extraction `phase_ref` → fallback regex (`phase N` or bare number) → `projectState.current_phase`.

### A_CLARIFY_INTENT

1. `AskUserQuestion` with available chain types
2. Re-classify with user response

### A_DECOMPOSE_TASKS

Shares the decomposition contract with maestro-ralph `A_DECOMPOSE_TASKS` — **reference that spec; do not duplicate.** Condensed:

1. Classify intent breadth. Skip for narrow / single-step / {status,init,quick} chains
2. Broad/medium → `AskUserQuestion` ≤3 rounds: Scope (in/out) | Constraints (compat/API/perf/test bar) | Definition of Done
3. Derive `execution_criteria` (3-6 imperative rules) + `task_decomposition` (outcome sub-goals; each `done_when` objectively verifiable, mapped to a ralph evidence artifact: verification.json / review.json / uat.md / test path)
4. Write `{session_dir}/goal-checklist.md` (same template as maestro-ralph) with `ALL_GOALS_DONE` sentinel; set `goal_checklist_path`
5. Append `{ type: "decision", decision: "post-goal-audit", retry_count: 0, max_retries: 2 }` as the FINAL node — after the last evidence-producing step (verify/review/test), before a milestone-complete/close-out step if present (audit needs evidence artifacts) → dynamic step growth for unmet sub-goals
6. **Register goal via `create_goal`:**
   ```
   create_goal({ objective: "Maestro {chain}: {intent} — converge {N} sub-goals within boundary",
     success_criteria: task_decomposition.map(g => `${g.id}: ${g.done_when}`),
     constraints: [...execution_criteria, "stay within boundary_contract"] })
   ```

### A_CREATE_SESSION

1. Read `.workflow/state.json` for project context (current phase, milestone, workflow_name)
2. Resolve chain's skill list from Chain Map (see appendix)
3. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`:
   ```json
   { "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "phase", "milestone", "auto_mode", "context": { "issue_id", "scratch_dir",
     "plan_dir", "analysis_dir", "brainstorm_dir" },
     "steps": [{ "index", "type": "skill|decision", "skill", "args", "status": "pending", "goal_ref": null }],
     "waves": [], "current_step": 0, "status": "running",
     "_comment": "↓ OPTIONAL additive block — present only if S_DECOMPOSE ran; absent → flat-chain behavior",
     "boundary_contract": {}, "execution_criteria": [], "task_decomposition": [], "goal_checklist_path": "" }
   ```
   Decomposition fields written ONLY if A_DECOMPOSE_TASKS produced them (additive)
4. Initialize tracking:
   - If decomposed: goal already registered by A_DECOMPOSE_TASKS. Else: `create_goal({ objective: "Maestro {chain}: {N} steps [{skill list}]" })`
   - `update_plan({ plan: steps.map(step => ({ step, status: "pending" })) })`

### A_RESUME_SESSION

1. Glob `.workflow/.maestro/maestro-*/status.json` sorted desc, load most recent
2. Find first pending step → set as resume point
3. Rebuild `update_plan` from status.json (completed→"completed", current→"in_progress", rest→"open")

### A_EXEC_STEP

Direct in-context skill invocation — **replaces the old spawn/wave/CSV mechanism**.

1. **buildSkillCall**: replace placeholders `{phase}`/`{plan_dir}`/`{analysis_dir}`/`{brainstorm_dir}`/`{spec_session_id}`; append auto-yes flag if `auto_mode` (see Appendix: Auto-Yes Flag Map)
2. Mark step `status="running"`, persist status.json + `update_plan` (this step → in_progress)
3. **Invoke the skill directly**: execute `$skill {resolved_args}` in coordinator context (NO spawn). Read its produced artifacts directly
4. On success: capture summary; mark step `status="done"`. **Barrier-context update** (when step is a context-producing skill):
   | Skill | Read | Context Updates |
   |-------|------|-----------------|
   | maestro-analyze | context.md, state.json | analysis_dir, gaps, phase |
   | maestro-plan | plan.json, .task/TASK-*.json | plan_dir, task_count |
   | maestro-brainstorm | .brainstorming/ | brainstorm_dir, features |
   | maestro-roadmap | specs/ | spec_session_id |
   | maestro-execute | results.csv | exec_completed, exec_failed |
5. On failure: mark `status="failed"`; auto_mode → retry once → still failed → S_ABORTED
6. Persist status.json + `update_plan` after every step

### A_GOAL_AUDIT_EVALUATE

Entry action of S_DECISION_EVAL — mirrors maestro-ralph `A_GOAL_AUDIT_EVALUATE` (reference that spec; do not duplicate). Condensed:

1. Read `session.task_decomposition` + `goal_checklist_path`
2. For each sub-goal `status != "done"`: resolve its `evidence` artifact under current phase scratch dir
3. Delegate read-only audit (`maestro delegate --role analyze --mode analysis`): for each unmet sub-goal, read evidence, judge against `done_when`, return `STATUS(all_met|has_unmet) / UNMET=[{id,gap,target_phase}]`
4. For each met sub-goal → set `task_decomposition[i].status="done"` + flip `[ ]→[x]` in goal-checklist.md; persist
5. Produce verdict (`all_met` / `has_unmet`) consumed by S_DECISION_EVAL transition. GUARD: retry >= max_retries AND still unmet → escalate

### A_APPLY_GOAL_FIX

**Dynamic step-growth core** (mirrors maestro-ralph). For each unmet sub-goal (grouped by target_phase), insert before the post-goal-audit node a scoped mini-loop `$maestro-plan --gaps {phase} "G{n}: {gap}" → $maestro-execute {phase} → $maestro-verify {phase}`, each tagged `goal_ref: "G{n}"`, type `"skill"`. Re-append `decision:post-goal-audit {retry+1}`. Reindex, increment retry, persist + `update_plan`. `steps[]` grew.

### A_APPLY_GOAL_DONE

1. Set all `task_decomposition[*].status="done"`, persist; append `ALL_GOALS_DONE` to goal-checklist.md
2. `update_goal({ status: "complete" })` — release decomposition goal
3. Proceed to chain's terminal step

### A_FINALIZE

1. Set `session.status = "completed"`, write status.json
2. Sync `update_plan`: all steps → "completed"
3. `update_goal({ status: "complete" })` — release goal (idempotent if already released)
4. Generate completion report (see Appendix: Report Format)

### A_ABORT_REPORT

1. Mark remaining steps `skipped` in status.json
2. Set `session.status = "aborted"`, write status.json; sync `update_plan`
3. Do NOT call `update_goal` — goal stays for `--continue` resume
4. Display abort report with failure details

</actions>

</state_machine>

<appendix>

### Chain Map (Full)

**Single-step chains:**

| Chain | Command + Args |
|-------|---------------|
| `status` | `manage-status` |
| `init` | `maestro-init` |
| `analyze` | `maestro-analyze {phase}` |
| `ui_design` | `maestro-impeccable build "{phase}"` |
| `plan` | `maestro-plan {phase}` |
| `execute` | `maestro-execute {phase}` |
| `verify` | `maestro-verify {phase}` |
| `test_gen` | `quality-auto-test {phase}` |
| `auto_test` | `quality-auto-test {phase}` |
| `test` | `quality-test {phase}` |
| `debug` | `quality-debug "{description}"` |
| `integration_test` | `quality-auto-test {phase}` |
| `refactor` | `quality-refactor "{description}"` |
| `review` | `quality-review {phase}` |
| `retrospective` | `quality-retrospective {phase}` |
| `learn` | `maestro-learn "{description}"` |
| `sync` | `quality-sync` |
| `milestone_audit` | `maestro-milestone-audit` |
| `milestone_complete` | `maestro-milestone-complete` |
| `codebase_rebuild` | `manage-codebase-rebuild` |
| `codebase_refresh` | `manage-codebase-refresh` |
| `spec_setup` | `spec-setup` |
| `spec_add` | `spec-add "{description}"` |
| `spec_load` | `spec-load` |
| `spec_map` | `manage-codebase-rebuild` |
| `spec_remove` | `spec-remove "{description}"` |
| `knowhow_capture` | `manage-knowhow-capture "{description}"` |
| `knowhow` | `manage-knowhow "{description}"` |
| `issue` | `manage-issue "{description}"` |
| `issue_discover` | `manage-issue-discover "{description}"` |
| `issue_analyze` | `maestro-analyze --gaps "{description}"` |
| `issue_plan` | `maestro-plan --gaps` |
| `issue_execute` | `maestro-execute` |
| `quick` | `maestro-quick "{description}"` |
| `harvest` | `manage-harvest "{description}"` |
| `wiki` | `manage-wiki` |
| `wiki_connect` | `wiki-connect` |
| `wiki_digest` | `wiki-digest` |
| `business_test` | `quality-auto-test {phase}` |
| `amend` | `maestro-amend "{description}"` |
| `release` | `maestro-milestone-release` |
| `compose` | `maestro-composer "{description}"` |
| `play` | `maestro-player "{description}"` |
| `update` | `maestro-update` |
| `overlay` | `maestro-overlay "{description}"` |
| `link_coordinate` | `maestro-link-coordinate "{description}"` |

**Multi-step chains:**

| Chain | Steps (→ = sequential, [B] = context-producing barrier) |
|-------|---------------------------------------|
| `feature` | [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `quality-fix` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → maestro-verify |
| `deploy` | maestro-verify → maestro-milestone-release |
| `spec-driven` | maestro-init → [B] maestro-roadmap --mode full → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `brainstorm-driven` | [B] maestro-brainstorm → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `ui-craft-build` | maestro-impeccable build → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `roadmap-driven` | maestro-init → [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `next-milestone` | [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `full-lifecycle` | [B] maestro-plan → [B] maestro-execute → maestro-verify → quality-review → quality-test → maestro-milestone-audit → maestro-milestone-complete |
| `execute-verify` | [B] maestro-execute → maestro-verify |
| `analyze-plan-execute` | [B] maestro-analyze -q → [B] maestro-plan --dir {scratch_dir} → [B] maestro-execute --dir {scratch_dir} |
| `quality-loop` | maestro-verify → quality-review → quality-test → quality-debug --from-uat → [B] maestro-plan --gaps → [B] maestro-execute |
| `quality-loop-partial` | [B] maestro-plan --gaps → [B] maestro-execute → maestro-verify |
| `review-fix` | [B] maestro-plan --gaps → [B] maestro-execute → quality-review |
| `milestone-close` | maestro-milestone-audit → maestro-milestone-complete |
| `milestone-release` | maestro-milestone-audit → maestro-milestone-release |
| `phase_transition` | maestro-milestone-audit → maestro-milestone-complete |
| `issue-full` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → quality-review → manage-issue close |
| `issue-quick` | [B] maestro-plan --gaps → [B] maestro-execute → manage-issue close |

> When S_DECOMPOSE ran, a `decision:post-goal-audit` node is appended as the final node (after the last evidence-producing step; before milestone-complete/close-out if the chain ends with one). `[B]` now denotes a context-producing skill (artifacts read into `session.context`) — execution is still sequential (no parallelism; spawning removed).

**Chain Aliases** (taskType → chain):

| taskType | Chain |
|----------|-------|
| `spec_generate` | `spec-driven` |
| `brainstorm` | `brainstorm-driven` |
| `issue_execute` | `issue-full` |

### Auto-Yes Flag Map

| Skill | Flag |
|-------|------|
| maestro-init, maestro-analyze, maestro-brainstorm, maestro-impeccable, maestro-roadmap | `-y` |
| maestro-plan, maestro-execute, maestro-milestone-complete | `-y` |
| quality-auto-test, quality-retrospective | `-y` |
| quality-test | `-y --auto-fix` |

### Context-Producing Skills

`maestro-analyze`, `maestro-plan`, `maestro-brainstorm`, `maestro-roadmap`, `maestro-execute` — their artifacts are read into `session.context` after the step completes (see A_EXEC_STEP step 4). Other skills produce no coordinator context. No parallelism — all steps run sequentially.

### Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent unclassifiable after clarification | Default to `feature` chain |
| E002 | error | Intent unresolvable after retry | List chains, abort |
| E003 | error | Step skill invocation failed | auto_mode retry once, then abort chain |
| E004 | error | Context artifact not found | Retry step once, then abort |
| E005 | error | --continue: no session found | List sessions, prompt |
| W001 | warning | Context artifact partial | Continue with available context |

### Success Criteria

- [ ] Intent classified and chain resolved
- [ ] Broad lifecycle intents decomposed (S_DECOMPOSE, ≤3 boundary questions) sharing maestro-ralph contract; narrow/single-step skip
- [ ] Goal registered via built-in `create_goal`; status.json decomposition fields additive-only
- [ ] post-goal-audit node appended as final node (after evidence-producing steps); unmet sub-goals dynamically grow steps[] (goal_ref tagged)
- [ ] Session dir initialized with status.json before first step
- [ ] Every skill invoked DIRECTLY in-context — NO spawn_agents_on_csv, NO wave/CSV/worker
- [ ] Sequential execution; status.json + update_plan persisted after every step
- [ ] Context-producing skills' artifacts read into session.context before next step's args assembled
- [ ] Failed step → remaining skipped → abort reported (goal held for --continue)
- [ ] --dry-run shows chain + sub-goal summary, no execution
- [ ] --continue resumes from first pending step
- [ ] update_goal released on convergence (A_APPLY_GOAL_DONE / A_FINALIZE); held while aborted

### Report Format

```
=== MAESTRO COMPLETE ===
Session:  {sessionId}
Chain:    {chain}
Steps:    {completed}/{total}   Sub-goals: {done}/{total}

STEP RESULTS:
  [1] $maestro-analyze --gaps  →  ✓  found 3 gaps
  [2] $maestro-plan --gaps     →  ✓  12 tasks
  [◆] post-goal-audit          →  ✓  all sub-goals met
  ...

State:    .workflow/.maestro/{sessionId}/status.json
Resume:   $maestro --continue
```

</appendix>
