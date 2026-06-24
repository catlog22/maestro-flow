---
name: odyssey-planex
description: "Requirement-driven iterative cycle — plan, execute, strict verify, fix loop until acceptance criteria met"
argument-hint: "<requirement> [--max-iterations N] [--skip-generalize] [--auto] [-y] [-c]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Requirement-to-delivery closed loop: parse requirement → define strict acceptance criteria →
plan tasks → execute → verify against criteria → fix gaps → iterate until ALL criteria pass.

Core philosophy:
- **Acceptance criteria are sacred** — no "close enough", no manual override
- **Iterate, don't restart** — each fix cycle targets only the failing criteria
- **CLI-assisted verification** — delegate to external tools for objective checks
- **Evidence-based progress** — every iteration logged with pass/fail per criterion

**三句哲学约束（穷尽迭代）:**
1. **零遗留** — 验收标准必须 ALL pass，不允许"接近通过"
2. **穷尽迭代** — verify 失败自动修复重试，直到全部通过或明确升级
3. **改进即标准** — 修复后重新验证同区域，新发现的标准违反继续修
</purpose>

<boundary>
**范围内:** 单一需求的实现闭环 — 需求 → 验收标准 → 计划 → 实现 → 验证 → 迭代 → 泛化
**范围外:** 多需求编排 → `/maestro-roadmap` | 深度 debug → `$odyssey-debug` | 代码审查 → `$odyssey-review-test-fix` | UI 优化 → `$odyssey-ui`
**探索自由度:** 边界内自由 — 可自主分解任务、选择实现策略、verify→fix 循环内尝试不同方案
**Zero-residual principle:** Every failing criterion MUST be fixed or explicitly escalated with specific reason. "Close enough" is not passing. "Pre-existing gap" is not a valid skip reason — if within scope, address it.
**模板:** `--template <name>` — feature | bugfix | refactor | migration | api-endpoint
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**
1. **Phase auto-commit** — 阶段完成后**自动** `git commit`，无需用户确认（session.json/evidence.ndjson 不纳入）
2. **Confident edits only, but must attempt** — only modify what you're confident about; record decisions only when genuinely requiring human judgment
   - Confident → edit code directly, commit
   - Needs decision → record `evidence.ndjson {"phase":"decision","status":"pending"}`, don't touch code
   - No speculative changes
   - ⚠️ **Decision gate** — ONLY these qualify as decisions (not fixes):
     - Cross-module architectural tradeoffs requiring human direction
     - Ambiguous business semantics where the fix could alter intended behavior
     - Requires new dependency or breaking API change
   - ❌ "Unsure how to fix", "Large scope", "Pre-existing issue" are NOT valid decision reasons — either fix it, or explain specifically why it's unfixable
3. **多 CLI 辅助** — plan 用 `--role analyze`，verify 用 cli-review delegate，fix 前后用 `--role review`
</execution_discipline>

<context>
$ARGUMENTS — requirement description and optional flags.

**Flags:**
| Flag | Description | Default |
|------|-------------|---------|
| `--max-iterations N` | Max verify→fix cycles before escalation | 3 |
| `--template <name>` | 预定义需求模板 | — |
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
  "cross_phase_loops": 0, "max_loops": 5,
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
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界 |
| Wiki search | `maestro search "<requirement keywords>" --json` | 先前实现（top 5） |
| Coding specs | `maestro load --type spec --category coding` | 编码规范 + knowhow 工具 |
| UI specs（条件） | 若涉及前端 → `maestro load --type spec --category ui` | UI 规范 |
| Role knowledge | `maestro search --category coding` → 选相关 → `maestro load --type knowhow --id <id>` | 领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-planex-odyssey-*")` | 相关会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 将可沉淀知识 **写入 understanding.md §8 Learnings**，按分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 多轮 fix cycle pattern | 问题场景 + 迭代过程 + 最终方案 | `$spec-add debug "..."` |
| 可复用实现模式 | 模式描述 + 适用场景 + 代码模板 | `$spec-add coding "..."` |
| 验收标准模板 | 标准模板 + verify_method 建议 | `$spec-add review "..."` |
| 泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `$spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户沉淀为永久知识。执行过程中不调用外部 skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical stage. Insufficient → re-enter with expanded strategy.

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known files/modules analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | Only vague "consider" recommendations |

**Rules:** stage complete → evaluate 3 dims → any insufficient → re-enter (max **3 rounds** per stage). Record to evidence.ndjson `{"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{...},"expansion":"strategy"}`.

**Expansion:** Round 1 = broaden scope (more dirs, more delegate angles). Round 2 = shift perspective (different CLI tool, reverse-trace from expected result). Round 3 = combine both + targeted deep-dive on remaining gaps.

**Applies to:** S_PLAN, S_VERIFY, S_GENERALIZE
</self_iteration>

<csv_schema>

### Shared Output Schema

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "evidence":      { "type": "string" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination Contract:** You MUST call `report_agent_job_result` EXACTLY ONCE before exiting. Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv.

### tasks.csv

```csv
id,title,description,task_type,criterion_refs,deps,wave,status,findings,evidence,error
```

**Waves:**
- Wave 1: Verification agents (one per `cli-review` criterion) — parallel
- Wave 2: Generalization agents (syntax-grep, semantic-scan, structural-match, historical-grep) — parallel
</csv_schema>

<invariants>
1. **Acceptance criteria are iron gates** — no bypass, no "close enough"
2. **Fix targets failing criteria only** — never re-implement passing parts
3. **Iteration cap respected** — max_iterations prevents infinite loops
4. **Evidence append-only** — evidence.ndjson never modified
5. **Session is source of truth** — session.json holds all state
6. **Phase goal tracking** — each stage MUST mark its goal
7. **`-y` defers, never drops** — records `deferred`, never silently skips
8. **CLI delegate is background** — all `maestro delegate` use run_in_background
9. **Goal is outcome-oriented** — `/goal` user-bound
10. **Invariant violation = BLOCK**
</invariants>

<execution>

### S_INTAKE

1. Parse requirement and flags, create SESSION_DIR
2. **Define acceptance criteria** — analyze requirement → derive testable criteria. Each gets `verify_method`: test | grep | cli-review | manual
   - **Normal**: `request_user_input` to confirm/edit
   - **`-y`**: auto-derive, record `{"phase":"decision","type":"criteria-confirmation","status":"deferred"}`
3. Search prior knowledge: `maestro search`, related sessions
4. Write session.json + understanding.md §1. Mark G1 done. Display Goal Prompt (see Appendix).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_INTAKE — 目标解析"`

### S_PLAN

1. Decompose requirement into ordered tasks mapped to acceptance criteria
2. CLI-assisted planning (optional):
   ```bash
   maestro delegate "PURPOSE: Create plan for: {requirement}
   TASK: Decompose into subtasks | Map to acceptance criteria | Identify dependencies
   MODE: analysis
   CONTEXT: @**/* | Criteria: {criteria_summary}
   EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]
   " --role analyze --mode analysis
   ```
   Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).
3. Write session.json.plan, append evidence (planning), update understanding.md §2. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_PLAN — 计划"`

### S_EXECUTE

1. Execute tasks sequentially — implement code changes
2. Per task: record evidence (execution), update task status
3. Update understanding.md §3. Mark G3 done.

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-planex({slug}): S_EXECUTE — 执行"`

### S_VERIFY

Iron gate — every acceptance criterion verified.

**Verify each criterion by method:**
| Method | Action |
|--------|--------|
| `test` | Run relevant tests, check pass/fail |
| `grep` | Grep for expected pattern |
| `cli-review` | `spawn_agents_on_csv` Wave 1 (see below) |
| `manual` | **Normal**: `request_user_input` / **`-y`**: `deferred` |

**Wave 1 — cli-review verification via spawn_agents_on_csv:**
```csv
"verify-AC1","Verify AC1","Review against criterion: {AC1.criterion}","verification","AC1","","1","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: VERIFICATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Record per criterion to evidence (verification). Update acceptance_criteria[].status. Append to iterations[]. Update understanding.md §4 with pass/fail table.

**Route:** all passed → mark G4 done → next state. Some failed + iteration < max → S_FIX. Fundamental plan flaw → S_PLAN (cross_phase_loops++, re-plan). Some failed + iteration >= max → **Normal**: `request_user_input` (continue/lower/accept) / **`-y`**: `deferred`, proceed S_RECORD.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_VERIFY — 验证"`

### S_FIX

1. Increment current_iteration
2. For each failed criterion: diagnose gap → targeted code fix
3. CLI fix review (optional): `maestro delegate --role review --mode analysis` for regression check
4. Append evidence (fix), update understanding.md §5 → S_VERIFY (loop)

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-planex({slug}): S_FIX — 修复"`

### S_GENERALIZE

Skip if `--skip-generalize`. Extract reusable patterns, scan codebase for similar sites.

**Pattern extraction (3 layers):**
| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Code regex patterns | validation/error handling patterns |
| Semantic | Logic pattern description | missing similar checks at other entry points |
| Structural | File/module structure match | sibling modules lacking same treatment |

**Wave 2 — 4-agent scan via spawn_agents_on_csv:**
```csv
"gen-syntax","Syntax Grep","Grep patterns across project","generalization","syntax","","2","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for anti-pattern","generalization","semantic","","2","pending","","",""
"gen-structural","Structural Match","Find files needing same treatment","generalization","structural","","2","pending","","",""
"gen-historical","Historical Grep","git log -S for similar patterns","generalization","historical","","2","pending","","",""
```

Each returns: `[{pattern_id, file, line, context, risk_level, layer, confidence}]`

**Cross-layer dedup:** multi-layer hit on same file:line → boost confidence. Historical hit with existing fix → `already_handled`. Single layer only → `needs_review`.

**Quality Gate** (self-iteration) → evaluate coverage/depth/actionability.

Write understanding.md §6, generalization_stats. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_GENERALIZE — 泛化"`

### S_DISCOVER

1. **Triage:** per hit, read context (+-10 lines), classify as `already_handled` | `needs_treatment` | `low_risk`
2. **Route:**
   | Classification | Normal | `-y` |
   |---------------|--------|------|
   | needs_treatment | `request_user_input`: create issue / plan next iter | auto create issue, `deferred` |
   | low_risk | Record only | Record only |
   | already_handled | Skip | Skip |
3. **Cross-phase loop / exit transitions:**
   - S_DISCOVER → S_EXECUTE: needs_treatment area → cross_phase_loops++
   - S_DISCOVER → S_RECORD: triage complete AND remaining_actionable == 0
   - S_DISCOVER → S_RECORD: loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)
4. Append evidence (discovery + decision), update understanding.md §7. Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_DISCOVER — 发现"`

### S_RECORD

1. Finalize understanding.md §8 — iteration summary, what worked, what needed rework
2. Write learnings to understanding.md §8: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的后续命令
3. Pending decisions: **Normal** → `request_user_input`. **`-y`** → display deferred count.
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

**Next steps:** `$odyssey-review-test-fix <changed-files>`, `$odyssey-debug "<failing>"`, `$quality-review`, `$manage-issue list --source odyssey-planex`

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): S_RECORD — 总结"`
</execution>

<appendix>

### Goal Prompt Template

**⚠️ 时机守卫：仅在 Stage 1 完成后显示一次（session 创建后、开始 Plan 前）。Stage 9 完成时禁止重新显示。**

```
📋 Planex Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 穷尽迭代：直到 acceptance_criteria[*] 全部 status==passed
且 phase_goals_all_done=true 才停。verify 失败自动 fix→re-verify 循环。
每轮修复后重新验证，新发现的标准违反继续修，不超过 max_iterations。
遇到 phase=decision 的 pending 必须 request_user_input，不得自行 resolve。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_INTAKE criteria confirmation | request_user_input | auto-derive, `deferred` |
| S_VERIFY manual criterion | request_user_input | `deferred` |
| S_VERIFY max iteration reached | request_user_input | auto accept, `deferred` |
| S_DISCOVER classification routing | request_user_input | auto create issue, `deferred` |
| S_DISCOVER ambiguous items | request_user_input | all `deferred` |
| S_RECORD decision list | request_user_input | skip |
| S_RECORD goal audit | request_user_input | auto accept |

### Iteration Model

```
S_EXECUTE → S_VERIFY ──all pass──→ S_GENERALIZE → S_DISCOVER ──remaining_actionable==0──→ S_RECORD
                │                       │               │
           some fail + iter < max       no hits ─→ S_RECORD
                ▼                                       │
             S_FIX ──→ S_VERIFY (loop)          needs_treatment → S_EXECUTE (cross_phase_loops++)
```

Max iterations (default 3) prevents infinite loops. Each iteration records criteria_before, gaps_fixed, criteria_after. S_DISCOVER exits to S_RECORD only when all actionable items are resolved or max_loops is reached (with per-item justification required).

### Phase Goal Lifecycle

`pending → done | skipped | failed`

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No requirement provided | Provide requirement |
| E003 | error | Resume but no session found | Start new |
| E004 | error | Delegate failed | Retry or skip |
| W001 | warning | No criteria derived | Manual definition |
| W002 | warning | Max iterations, criteria failing | Escalate |
| W003 | warning | CLI regression concern | Review before next |
| W004 | warning | Delegate parse failed | Raw output |
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
- [ ] **Every unfixed criterion has individual classification and reason** — blanket "pre-existing" labels are forbidden
</success_criteria>
