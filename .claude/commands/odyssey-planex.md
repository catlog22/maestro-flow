---
name: odyssey-planex
description: Requirement-driven iterative cycle — plan, execute, strict verify, fix loop until acceptance criteria met
argument-hint: "<requirement> [--max-iterations N] [--skip-generalize] [--auto] [-y] [-c]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Requirement-to-delivery closed loop: parse requirement → define strict acceptance criteria →
plan tasks → execute → verify against criteria → fix gaps → iterate until ALL criteria pass.

Core philosophy:
- **Acceptance criteria are sacred** — no "close enough", no manual override
- **Iterate, don't restart** — each fix cycle targets only the failing criteria
- **CLI-assisted verification** — delegate to external tools for objective quality checks
- **Evidence-based progress** — every iteration logged with pass/fail per criterion
</purpose>

<context>
$ARGUMENTS — requirement description and optional flags.

**Flags:**
| Flag | Description | Default |
|------|-------------|---------|
| `--max-iterations N` | Max verify→fix cycles before escalation | 3 |
| `--skip-generalize` | Skip S_GENERALIZE + S_DISCOVER | false |
| `--auto` | CLI delegate calls without confirmation | false |
| `-y` | Auto-confirm — decisions recorded as `deferred` | false |
| `-c` | Resume most recent session | — |

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-planex-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + criteria + iterations + plan
  ├── evidence.ndjson    # append-only log (phase distinguishes origin)
  └── understanding.md   # evolving narrative (8 sections, one per phase)
```

**session.json schema:**
```json
{
  "session_id": "planex-odyssey-{YYYYMMDD-HHmmss}",
  "requirement": "",
  "flags": { "max_iterations": 3, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "acceptance_criteria": [
    {"id":"AC1","criterion":"","verify_method":"test|grep|cli-review|manual","status":"pending","evidence":"","passed_at":null}
  ],
  "plan": { "tasks": [{"id":"T1","title":"","description":"","criteria_refs":["AC1"],"status":"pending","files_modified":[]}], "created_at":"" },
  "iterations": [
    {"iteration":1,"started_at":"","completed_at":"","criteria_before":{"passed":0,"total":0},"criteria_after":{"passed":0,"total":0},"gaps_fixed":[],"files_modified":[]}
  ],
  "current_iteration": 0,
  "patterns": [
    {"id":"P1","source":"AC1 fix","layer":"syntax|semantic|structural","signature":"","description":"","risk":"","fix_template":""}
  ],
  "generalization_stats": {"patterns_extracted":0,"total_hits":0,"cross_layer_confirmed":0,"by_layer":{"syntax":0,"semantic":0,"structural":0},"deepening_triggered":false},
  "phase_goals": [],
  "phase_goals_all_done": false,
  "self_iteration_log": [],
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson** — one JSON per line, `phase` field = `planning|execution|verification|fix|decision|generalization|discovery|self-iteration`

**understanding.md sections:** §1 Requirement & Criteria ← S_INTAKE, §2 Plan ← S_PLAN, §3 Execution ← S_EXECUTE, §4 Verification (per iter) ← S_VERIFY, §5 Fix Log (per iter) ← S_FIX, §6 Generalization ← S_GENERALIZE, §7 Discoveries ← S_DISCOVER, §8 Learnings ← S_RECORD

**phase_goals[]:**
| ID | Goal | Done When | Phase | Skip When |
|----|------|-----------|-------|-----------|
| G1 | Acceptance criteria defined | ≥1 criterion in acceptance_criteria[] | S_INTAKE | — |
| G2 | Plan created | session.json.plan populated | S_PLAN | — |
| G3 | Implementation complete | all plan tasks executed | S_EXECUTE | — |
| G4 | All criteria pass | all acceptance_criteria[].status == passed | S_VERIFY | — |
| G5 | Pattern generalized | patterns[] populated ≥1 entry | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | spec entries created OR no actionable | S_RECORD | — |

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，架构约束 |
| Wiki search | `maestro search "<requirement keywords>" --json` | 先前实现、相关决策（取 top 5） |
| Coding specs | `maestro spec load --category coding` | 编码规范 + 可发现的 knowhow 工具 |
| UI specs（条件） | 若涉及前端 → `maestro spec load --category ui` | UI 规范 |
| Role knowledge | `maestro search --category coding` → 选相关 → `maestro wiki load <id>` | 累积实现领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-planex-odyssey-*")` | 相关 odyssey 会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §8 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 多轮 fix cycle pattern | 问题场景 + fix 迭代过程 + 最终方案 | `/spec-add debug "..."` |
| 可复用实现模式 | 模式描述 + 适用场景 + 代码模板 | `/spec-add coding "..."` |
| 验收标准模板 | 标准模板 + verify_method 建议 | `/spec-add review "..."` |
| 泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `/spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户通过 next_step_routing 沉淀为永久知识。执行过程中不调用外部 Skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical stage. Insufficient → re-enter with expanded strategy.

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known files/modules analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | Only vague "consider" recommendations |

**Rules:** stage complete → evaluate 3 dims → any insufficient → re-enter (max **2 rounds** per stage). Record to evidence.ndjson `{"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{...},"expansion":"strategy"}`.

**Expansion:** Round 1 = broaden scope (more dirs, more delegate angles). Round 2 = shift perspective (different CLI tool, reverse-trace from expected result).

**Applies to:** S_PLAN, S_VERIFY, S_GENERALIZE
</self_iteration>

<state_machine>

<states>
S_INTAKE      — parse requirement, define acceptance criteria       PERSIST: session.json + understanding.md §1
S_PLAN        — decompose tasks, generate execution plan            PERSIST: session.json.plan + evidence (planning) + understanding.md §2
S_EXECUTE     — implement tasks                                     PERSIST: code + evidence (execution) + understanding.md §3
S_VERIFY      — iron gate: check every acceptance criterion         PERSIST: evidence (verification) + understanding.md §4
S_FIX         — targeted fix for failing criteria (loops to VERIFY) PERSIST: code + evidence (fix) + understanding.md §5
S_GENERALIZE  — extract patterns, 4-agent scan                     PERSIST: session.json.patterns + understanding.md §6
S_DISCOVER    — triage scan hits, route decisions                   PERSIST: evidence (discovery|decision) + understanding.md §7
S_RECORD      — persist learnings, final summary                   PERSIST: understanding.md §8 + spec entries
</states>

<transitions>
S_INTAKE → S_INTAKE  WHEN -c + session found (resume)
S_INTAKE → S_PLAN    WHEN requirement + criteria defined
S_INTAKE → S_INTAKE  WHEN no requirement → AskUserQuestion

S_PLAN → S_EXECUTE
S_EXECUTE → S_VERIFY

S_VERIFY → S_GENERALIZE  WHEN all passed AND NOT skip_generalize
S_VERIFY → S_RECORD      WHEN all passed AND skip_generalize
S_VERIFY → S_FIX         WHEN some failed AND iteration < max
S_VERIFY → S_RECORD      WHEN some failed AND iteration >= max (escalate)

S_FIX → S_VERIFY (loop)

S_GENERALIZE → S_DISCOVER  WHEN hits found
S_GENERALIZE → S_RECORD    WHEN no hits

S_DISCOVER → S_RECORD
S_RECORD → END
</transitions>

<actions>

### A_INTAKE

1. Parse requirement and flags, generate slug, create SESSION_DIR
2. **Define acceptance criteria** — analyze requirement → derive testable criteria. Each gets `verify_method`: test | grep | cli-review | manual
   - **Normal**: AskUserQuestion to confirm/edit
   - **`-y`**: auto-derive, record `{"phase":"decision","type":"criteria-confirmation","status":"deferred"}`
3. Search prior knowledge: `maestro search`, related sessions
4. Write session.json + understanding.md §1. Mark G1 done. Display Goal Prompt (see Appendix)

### A_PLAN

1. Decompose requirement into ordered tasks mapped to acceptance criteria
2. CLI-assisted planning (optional):
   ```bash
   maestro delegate "PURPOSE: Create implementation plan for: {requirement}
   TASK: Decompose into subtasks | Map to acceptance criteria | Identify dependencies
   MODE: analysis
   CONTEXT: @**/* | Criteria: {criteria_summary}
   EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]
   " --role analyze --mode analysis
   ```
   Run_in_background, STOP, wait for callback.
3. Write session.json.plan, append evidence (planning), update understanding.md §2. Mark G2 done.

### A_EXECUTE

1. Execute tasks sequentially — implement code changes
2. Per task: record evidence (execution) `{"phase":"execution","type":"task-completed","task_id":"T1","files_modified":[],"summary":""}`, update task status
3. Update understanding.md §3. Mark G3 done.

### A_VERIFY

Iron gate — every acceptance criterion checked objectively.

**Verify each criterion by method:**
| Method | Action |
|--------|--------|
| `test` | Run relevant tests, check pass/fail |
| `grep` | Grep for expected pattern |
| `cli-review` | `maestro delegate --role review --mode analysis` with criterion as focus |
| `manual` | **Normal**: AskUserQuestion / **`-y`**: record `deferred` |

Record per criterion: `{"phase":"verification","type":"criterion-check","criterion_id":"AC1","method":"","result":"passed|failed","evidence":"","iteration":N}`. Update acceptance_criteria[].status. Append to iterations[].

Update understanding.md §4 with pass/fail table.

**Route:** all passed → mark G4 done → next state. Some failed + iteration < max → S_FIX. Some failed + iteration >= max → **Normal**: AskUserQuestion (continue/lower bar/accept) / **`-y`**: `deferred`, proceed S_RECORD.

### A_FIX

1. Increment current_iteration
2. For each failed criterion: diagnose gap → targeted code fix
3. CLI fix review (optional):
   ```bash
   maestro delegate "PURPOSE: Review fixes for failing criteria
   TASK: Check fix correctness | Verify no regressions on passing criteria
   MODE: analysis
   CONTEXT: @{modified_files} | Passing: {passing} | Fixed: {fixed}
   EXPECTED: JSON {verdict, regression_risk, concerns}
   " --role review --mode analysis
   ```
4. Append evidence (fix), update understanding.md §5 → S_VERIFY

### A_GENERALIZE

Extract reusable patterns from implementation, scan codebase for similar sites.

**Pattern extraction (3 layers):**
| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Code regex patterns | validation/error handling patterns |
| Semantic | Logic pattern description | missing similar checks at other entry points |
| Structural | File/module structure match | sibling modules lacking same treatment |

**4-agent parallel scan** (spawn 4 Agents):
| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep syntax-layer signatures | full project |
| Semantic scan | Check for same anti-pattern in related modules | related modules |
| Structural match | Find structurally similar files | full project |
| Historical grep | `git log -S "{pattern}"` | full git history |

Each returns: `[{pattern_id, file, line, context, risk_level, layer, confidence}]`

**Cross-layer dedup:** multi-layer hit on same file:line → boost confidence. Historical hit with existing fix → `already_handled`. Single layer only → `needs_review`.

**Quality Gate** (self-iteration) → evaluate coverage/depth/actionability.

Write understanding.md §6, generalization_stats. Mark G5 done.

### A_DISCOVER

1. **Triage:** per hit, read context (+-10 lines), classify as `already_handled` | `needs_treatment` | `low_risk`
2. **Route:**
   | Classification | Normal | `-y` |
   |---------------|--------|------|
   | needs_treatment | AskUserQuestion: create issue / plan next iter | auto create issue, `deferred` |
   | low_risk | Record only | Record only |
   | already_handled | Skip | Skip |
3. Append evidence (discovery + decision), update understanding.md §7. Mark G6 done.

### A_RECORD

1. Finalize understanding.md §8 — iteration summary, what worked, what needed rework
2. Write learnings to understanding.md §8: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令
3. Pending decisions: **Normal** → AskUserQuestion. **`-y`** → display deferred count.
4. Goal audit: check all phase_goals[*].completion_confirmed. Mark G7 done.
5. Output completion summary:
   ```
   --- PLANEX ODYSSEY COMPLETE ---
   Requirement: {requirement}
   Criteria:    {passed}/{total} passed
   Iterations:  {N} cycles
   Patterns:    {patterns_extracted} ({by_layer} distribution)
   Scan hits:   {total_hits} ({cross_layer_confirmed} cross-layer confirmed)
   Issues:      {N} created | Decisions: {N} resolved, {M} pending, {K} deferred
   Learnings:   {N} spec entries
   Self-iter:   {N} rounds across {M} stages
   Goals:       {done}/{total} confirmed ({skipped} skipped)
   Status:      {ALL_PASSED|PARTIAL|ESCALATED}
   ---
   ```

</actions>

<appendix>

### Goal Prompt Template

**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次（session 创建后、开始 Plan 前）。A_RECORD 完成时禁止重新显示。**

```
📋 Planex Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 直到 {SESSION_DIR}/session.json 的 acceptance_criteria[*] 全部 status==passed
且 phase_goals_all_done=true 才停。每轮以 session.json 为唯一行动手册。
verify 失败时自动进入 fix 循环，不超过 max_iterations 次。
遇到 phase=decision 的 pending 条目必须 AskUserQuestion，不得自行 resolve。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_INTAKE criteria confirmation | AskUserQuestion | auto-derive, `deferred` |
| S_VERIFY manual criterion | AskUserQuestion | `deferred` |
| S_VERIFY max iteration reached | AskUserQuestion | auto accept, `deferred` |
| S_DISCOVER classification routing | AskUserQuestion | auto create issue, `deferred` |
| S_DISCOVER ambiguous items | AskUserQuestion | all `deferred` |
| S_RECORD decision list | AskUserQuestion | skip |
| S_RECORD goal audit | AskUserQuestion | auto accept |

### Iteration Model

```
S_EXECUTE → S_VERIFY ──all pass──→ S_GENERALIZE → S_DISCOVER → S_RECORD
                │                       │
           some fail + iter < max       no hits ─→ S_RECORD
                ▼
             S_FIX ──→ S_VERIFY (loop)
```

Max iterations (default 3) prevents infinite loops. Each iteration records criteria_before, gaps_fixed, criteria_after.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No requirement provided | Provide requirement |
| E003 | error | Resume but no session found | Start new |
| E004 | error | Delegate failed | Retry or proceed without |
| W001 | warning | No acceptance criteria derived | Manual definition needed |
| W002 | warning | Max iterations reached, criteria still failing | Escalate to user |
| W003 | warning | CLI review regression concern | Review before next iteration |
| W004 | warning | Delegate parse failed | Use raw output |
</error_codes>

<success_criteria>
- [ ] Requirement parsed and ≥1 acceptance criterion defined with verify_method
- [ ] Plan created with tasks mapped to criteria
- [ ] Tasks executed with evidence logged
- [ ] Every criterion verified by its method after each iteration
- [ ] Failing criteria trigger targeted fix (not full re-implementation)
- [ ] Iteration count tracked, max respected
- [ ] understanding.md updated per phase (§1-§8)
- [ ] Multi-layer generalization + 4-agent scan (unless --skip-generalize)
- [ ] Discoveries classified and routed (unless --skip-generalize)
- [ ] Quality Gate self-iteration triggered when insufficient, logged in self_iteration_log
- [ ] phase_goals G1-G7 tracked and audited
- [ ] Goal Prompt displayed once after intake
- [ ] `-y` mode: no blocking prompts, deferred counted
- [ ] Session resumable via -c
- [ ] Completion summary with iteration stats
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| All criteria passed | `/odyssey-review-test-fix <changed-files>` |
| Max iterations, still failing | `/odyssey-debug "<failing criterion>"` |
| Want formal review | `/quality-review <phase>` |
| Issues from discoveries | `/manage-issue list --source planex-odyssey` |
| Pattern worth documenting | `/learn-decompose <module>` |
</next_step_routing>
