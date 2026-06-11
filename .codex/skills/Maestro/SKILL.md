---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--super]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
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
3. **Decomposition contract shared with maestro-ralph** — broad/lifecycle intents run S_DECOMPOSE producing the SAME additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`). Reference maestro-ralph `A_DECOMPOSE_TASKS`
4. **Goal is tool-created** — `A_DECOMPOSE_TASKS` calls `create_goal` with sub-goal success criteria. `update_goal` on convergence; held while aborted/paused
5. **status.json 唯一真源** — 不生成 `goal-checklist.md`；step 含 `command_scope` + `command_path` + `completion_confirmed`
6. **Topology awareness** — chain catalog 含 grill / brainstorm / blueprint / analyze-macro(text) / analyze(numeric) / roadmap / plan(三路径) / execute / ...
6.5. **Grill is interactive-only** — auto_mode MUST skip grill stage and route directly to brainstorm; grill requires Socratic Q&A with the user
7. **D-007 milestone 反查** — 数字 phase 步骤的 `milestone_id` 由 `state.json.milestones[].phase_slugs` 反查
8. **schema 向后兼容** — decomposition 字段可选；`steps[]` 由 post-goal-audit 动态生长（goal_ref tagged）；既有字段不删不改；`waves` 保留空数组
9. **Sequential execution** — one step at a time in index order; each step's result read before the next starts
10. **Abort on failure** — failed step → mark remaining skipped → report (goal stays bound for `--continue`)
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
  → S_CLASSIFY    WHEN: user provides new intent            DO: request_user_input
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
| `grill` | Stress-test, challenge assumptions, Socratic questioning on a plan/idea (**skip when auto_mode — grill is interactive-only**) |
| `quick` | Simple/small task, add a feature, quick change |
| `blueprint` | Formal spec generation (Product Brief / PRD / Architecture / Epics) |
| `analyze_macro` | Broad/medium intent w/o numeric phase — explore impact, produce scope_verdict |
| `plan_from_analyze` | Plan directly from analyze artifact (no roadmap, scope=standalone) |
| `plan_from_blueprint` | Plan directly from blueprint artifact (scope=standalone) |
| `plan` | Plan, design, architect a phase |
| `execute` | Implement, develop, code a phase |
| `analyze` | Understand, investigate, evaluate code (numeric phase) |
| `verify` | Check goals met, validate results (routes to quality-review) |
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
| `feature` | Standard feature: plan→execute→review |
| `full-lifecycle` | Complete phase: plan→execute→review→test→audit→complete |
| `brainstorm-driven` | Start from exploration/brainstorm |
| `spec-driven` | From spec/requirements (heavy, with init) |
| `roadmap-driven` | From requirements (light, with init) |
| `analyze-plan-execute` | Fast track: analyze→plan→execute |
| `execute-review` | Resume after planning |
| `review-fix` | Fix review-blocked issues |
| `quality-loop` | Full quality improvement cycle |
| `quality-loop-partial` | Partial quality fix |
| `quality-fix` | Analyze gaps→plan→execute→review |
| `deploy` | Verify then release |
| `milestone-close` | Close/transition milestone |
| `milestone-release` | Release milestone with version tag |
| `phase_transition` | Transition phase: audit→complete |
| `next-milestone` | Advance to next milestone |
| `state_continue` | Continue from current project state |

**Selection priorities:**
1. `issue_id` present → prefer issue chains
2. UI/design/界面/页面/原型 → prefer `ui_design`
3. 正式规格/spec-generate/7-phase → `blueprint` (single-step) 或 `blueprint-driven`
4. 压力测试/拷问/grill/stress-test → `grill` (single-step); **auto_mode → skip grill, route to `brainstorm-driven` instead**
5. 头脑风暴/探索 → `brainstorm-driven`
5. Broad/medium intent + 无数字 phase → `analyze_macro`（产 scope_verdict）；后续 large→roadmap链；medium/small→`plan_from_analyze`
6. 已有 analyze artifact 直达 plan → `plan_from_analyze`
7. 已有 blueprint artifact 直达 plan → `plan_from_blueprint`
8. Multiple lifecycle steps implied → prefer multi-step chains
9. Single specific action → prefer single-step chains
10. "问题" describing broken behavior → `debug`; tracked item with ISS-ID → `issue`
11. Simple task, no lifecycle context → `quick`
12. Global fallback → `quick`

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
| exploring/planning + has plan | `execute-review` |
| exploring/planning, no plan | `plan` |
| executing, all tasks done | `review` |
| executing, tasks remain | `execute` |
| reviewing, verdict == BLOCK | `review-fix` |
| reviewing, verdict != BLOCK + UAT pending | `test` |
| reviewing, verdict != BLOCK + UAT passed | `milestone-close` |
| reviewing, verdict != BLOCK + UAT failed | `debug` |
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

1. `request_user_input` with available chain types
2. Re-classify with user response

### A_DECOMPOSE_TASKS

与 maestro-ralph `A_DECOMPOSE_TASKS` 共享分解契约。Condensed:

1. 分类意图广度。narrow / 单步 / `{status,init,quick}` 链跳过
2. broad/medium → `request_user_input` ≤3 轮：Scope / Constraints / Definition of Done
3. 派生 `execution_criteria` + `task_decomposition`（每个 sub-goal 含 `done_when` + `evidence` + `lifecycle` + `completion_confirmed: false`）
4. **status.json 唯一真源**：写入 `boundary_contract` / `execution_criteria` / `task_decomposition`；不生成 markdown 清单
5. 链路末尾（evidence 产出步骤后、milestone-complete/close-out 前）追加 `decision:post-goal-audit`。S_DECISION_EVAL 据此动态生长 `steps[]`
6. **Register goal via `create_goal`:**
   ```
   create_goal({ objective: "Maestro {chain}: {intent} — converge {N} sub-goals within boundary",
     success_criteria: task_decomposition.map(g => `${g.id}: ${g.done_when}`),
     constraints: [...execution_criteria, "stay within boundary_contract; resume via $maestro --continue"] })
   ```

### A_CREATE_SESSION

1. Read `.workflow/state.json` 获取 phase / milestone（D-007 反查 `phase_slugs`）；读最新 macro analyze artifact 注入 `scope_verdict` + `analyze_macro_id`；读最新 blueprint artifact 注入 `blueprint_id`
2. Resolve chain's skill list from Chain Map (see appendix)
3. **Prevalidate via `Bash("maestro ralph skills --platform codex --json --quiet")`** 一次性拉取所有可用 codex skills（global `~/.codex/skills/` + project `.codex/skills/`，project 覆盖 global），匹配 skill 名得到：
   - 命中 → `command_scope = "global" | "project"`，`command_path = <绝对 SKILL.md 路径>`
   - 未命中 → `command_scope = "missing"`, `command_path = null`
4. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`（与 ralph 共用 schema）:
   ```json
   {
     "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "phase", "phase_is_new": false, "milestone": "",
     "scope_verdict": null, "analyze_macro_id": null, "blueprint_id": null,
     "auto_mode": false,
     "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null,
       "analysis_dir": null, "brainstorm_dir": null, "blueprint_dir": null },
     "steps": [{
       "index": 0, "type": "skill|decision",
       "skill": "", "args": "",
       "stage": "", "scope": null,
       "command_scope": "global|project|missing|null",
       "command_path": "~/.codex/skills/{name}/SKILL.md | .codex/skills/{name}/SKILL.md | null",
       "milestone_id": null, "source_artifact_ref": null,
       "status": "pending", "goal_ref": null,
       "completion_confirmed": false, "completion_status": null,
       "completion_evidence": null, "completed_at": null
     }],
     "waves": [], "current_step": 0, "status": "running",
     "boundary_contract": {}, "execution_criteria": [],
     "task_decomposition": [{ "id": "G1", "goal": "", "done_when": "", "evidence": "",
       "status": "pending|done", "completion_confirmed": false, "completed_at": null }],
     "task_decomposition_all_done": false
   }
   ```
   Decomposition fields written ONLY if A_DECOMPOSE_TASKS produced them (additive)
5. Validate: 所有 step 的 `command_scope != "missing"`；否则 raise E006 列出缺失 skill
6. Initialize tracking:
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

S_DECISION_EVAL 入口；镜像 maestro-ralph `A_GOAL_AUDIT_EVALUATE`。Condensed:

1. 读 `session.task_decomposition`（status.json，真源）
2. 对每个 `status != "done"` 的子目标：解析 `evidence` 产物
3. `maestro delegate --role analyze --mode analysis` 读取 evidence、对照 done_when 判定，返回 `STATUS=all_met|has_unmet / UNMET=[{id,gap,target_phase}] / CONFIDENCE_SCORE`
4. status.json 为写入目标：每个达成子目标 `status="done"` + `completed_at=now`；然后从 status.json 重渲染 checklist（Sync Rule）
5. Verdict（`all_met` / `has_unmet`）由 S_DECISION_EVAL 消费。GUARD: retry >= max_retries AND still unmet → escalate

### A_APPLY_GOAL_FIX

**Dynamic step-growth core** (mirrors maestro-ralph). For each unmet sub-goal (grouped by target_phase), insert before the post-goal-audit node a scoped mini-loop `$maestro-plan --gaps {phase} "G{n}: {gap}" → $maestro-execute {phase}`, each tagged `goal_ref: "G{n}"`, type `"skill"`. Re-append `decision:post-goal-audit {retry+1}`. Reindex, increment retry, persist + `update_plan`. `steps[]` grew.

### A_APPLY_GOAL_DONE

1. status.json：全部 `task_decomposition[*].status="done"` + `completion_confirmed=true` + `completed_at=now` + `task_decomposition_all_done=true`
2. `update_goal({ status: "complete" })`
3. 继续到 chain 的终结步骤

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
| `grill` | `maestro-grill "{intent}"` |
| `status` | `manage-status` |
| `init` | `maestro-init` |
| `blueprint` | `maestro-blueprint "{intent}"` |
| `analyze_macro` | `maestro-analyze "{intent}"` |
| `analyze` | `maestro-analyze {phase}` |
| `ui_design` | `maestro-impeccable build "{phase}"` |
| `plan` | `maestro-plan {phase}` |
| `plan_from_analyze` | `maestro-plan --from analyze:{analyze_macro_id}` |
| `plan_from_blueprint` | `maestro-plan --from blueprint:{blueprint_id}` |
| `execute` | `maestro-execute {phase}` |
| `verify` | `quality-review {phase}` |
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
| `feature` | [B] maestro-plan → [B] maestro-execute → quality-review |
| `quality-fix` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → quality-review |
| `deploy` | quality-review → maestro-milestone-release |
| `blueprint-driven` | maestro-init → [B] maestro-blueprint → [B] maestro-plan --from blueprint:{BLP} → [B] maestro-execute → quality-review |
| `analyze-macro-driven` | [B] maestro-analyze "{intent}" → ◆ post-analyze-scope → (large: [B] maestro-roadmap --from analyze:{ANL} → [B] maestro-analyze {phase} → [B] maestro-plan {phase}) / (medium\|small: [B] maestro-plan --from analyze:{ANL}) → [B] maestro-execute → quality-review |
| `grill-brainstorm` | [B] maestro-grill → [B] maestro-brainstorm --from grill:{GRL} → [B] maestro-plan → [B] maestro-execute → quality-review (**auto_mode: skip grill step, fall back to brainstorm-driven**) |
| `brainstorm-driven` | [B] maestro-brainstorm → [B] maestro-plan → [B] maestro-execute → quality-review |
| `ui-craft-build` | maestro-impeccable build → [B] maestro-plan → [B] maestro-execute → quality-review |
| `roadmap-driven` | maestro-init → [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → quality-review |
| `next-milestone` | [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → quality-review |
| `full-lifecycle` | [B] maestro-plan → [B] maestro-execute → quality-review → quality-test → maestro-milestone-audit → maestro-milestone-complete |
| `execute-review` | [B] maestro-execute → quality-review |
| `analyze-plan-execute` | [B] maestro-analyze -q → [B] maestro-plan --dir {scratch_dir} → [B] maestro-execute --dir {scratch_dir} |
| `quality-loop` | quality-review → quality-test → quality-debug --from-uat → [B] maestro-plan --gaps → [B] maestro-execute |
| `quality-loop-partial` | [B] maestro-plan --gaps → [B] maestro-execute → quality-review |
| `review-fix` | [B] maestro-plan --gaps → [B] maestro-execute → quality-review |
| `milestone-close` | maestro-milestone-audit → maestro-milestone-complete |
| `milestone-release` | maestro-milestone-audit → maestro-milestone-release |
| `phase_transition` | maestro-milestone-audit → maestro-milestone-complete |
| `issue-full` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → quality-review → manage-issue close |
| `issue-quick` | [B] maestro-plan --gaps → [B] maestro-execute → quality-review → manage-issue close |

> When S_DECOMPOSE ran, a `decision:post-goal-audit` node is appended as the final node (after the last evidence-producing step; before milestone-complete/close-out if the chain ends with one). `[B]` now denotes a context-producing skill (artifacts read into `session.context`) — execution is still sequential (no parallelism; spawning removed).

**Chain Aliases** (taskType → chain):

| taskType | Chain |
|----------|-------|
| `spec_generate` | `blueprint-driven` |
| `spec-driven` | `blueprint-driven` |
| `brainstorm` | `brainstorm-driven` |
| `issue_execute` | `issue-full` |
| `analyze_macro` | `analyze-macro-driven` |

### Auto-Yes Flag Map

| Skill | Flag |
|-------|------|
| maestro-init, maestro-analyze, maestro-brainstorm, maestro-blueprint, maestro-impeccable, maestro-roadmap | `-y` |
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
| E006 | error | command_scope == "missing" for one or more steps | List missing skills, abort build |
| W001 | warning | Context artifact partial | Continue with available context |

### Success Criteria

- [ ] Intent classified and chain resolved
- [ ] Chain catalog 覆盖 blueprint / analyze_macro / plan_from_analyze / plan_from_blueprint / blueprint-driven / analyze-macro-driven 等新拓扑路径
- [ ] D-007: 数字 phase 步骤的 `milestone_id` 通过 `state.json.milestones[].phase_slugs` 反查；写入 step
- [ ] plan step args 支持 `{phase}` / `--from analyze:{ANL_ID}` / `--from blueprint:{BLP_ID}` 三路径，`source_artifact_ref` 写入
- [ ] Broad lifecycle intents decomposed (≤3 boundary questions); narrow/single-step skip
- [ ] Goal registered via built-in `create_goal`; status.json decomposition fields additive-only
- [ ] status.json 唯一真源；无 markdown 清单
- [ ] 每个 step 含 `command_scope` + `command_path` + `completion_confirmed` 字段
- [ ] post-goal-audit node appended as final node; unmet sub-goals dynamically grow steps[] (goal_ref tagged)
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
