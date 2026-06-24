---
name: odyssey-planex
description: Requirement-driven iterative cycle — plan, execute, strict verify, fix loop until acceptance criteria met
argument-hint: "<requirement> [--max-iterations N] [--skip-generalize] [--auto] [--method agent|cli|auto] [--executor <tool>] [--skip-verify] [-y] [-c]"
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
Requirement-to-delivery closed loop: parse requirement → define acceptance criteria →
plan → execute → verify → fix gaps → iterate until ALL criteria pass.
</purpose>

<boundary>
**范围内:** 单一需求的实现闭环 — 从需求解析到验收标准全部通过 + 泛化同类场景
**范围外:** 多需求编排 → `/maestro-roadmap` | 深度 debugging → `/odyssey-debug` | 代码审查 → `/odyssey-review-test-fix` | UI 优化 → `/odyssey-ui`
**探索自由度:** 边界内自由探索 — 可自主分解任务、选择实现策略、迭代修复。verify→fix 循环内可尝试不同方案。
**Zero-residual principle:** Every failing criterion MUST be fixed or explicitly escalated with specific reason. "Close enough" is not passing. "Pre-existing gap" is not a valid skip reason — if within scope, address it.
**模板支持:** `--template <name>` 从预定义需求模板启动，自动生成匹配的验收标准和任务分解：

| Template | 预设 criteria 模式 | 适用场景 |
|----------|-------------------|---------|
| `feature` | 用户故事验收 + 边界测试 + UI 验证 | 新功能开发 |
| `bugfix` | 回归测试 + 根因确认 + 边界覆盖 | Bug 修复 |
| `refactor` | 行为不变验证 + 性能基准 + API 兼容 | 重构 |
| `migration` | 数据一致性 + 回滚验证 + 性能对比 | 数据/API 迁移 |
| `api-endpoint` | 请求/响应契约 + 错误处理 + 权限校验 | API 开发 |
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**

1. **Phase auto-commit** — 每个阶段完成后**自动** `git commit`，无需用户确认
   - 代码变更 + understanding.md → `git add` → `git commit -m "odyssey-planex({slug}): {phase} — {摘要}"`
   - session.json / evidence.ndjson 为运行时状态，不纳入 commit

2. **Confident edits only, but must attempt** — only modify what you're confident about; record decisions only when genuinely requiring human judgment
   - Confident → edit code directly, commit
   - Needs decision → record `evidence.ndjson {"phase":"decision","status":"pending"}`, don't touch code
   - No speculative changes
   - ⚠️ **Decision gate** — ONLY these qualify as decisions (not fixes):
     - Cross-module architectural tradeoffs requiring human direction
     - Ambiguous business semantics where the fix could alter intended behavior
     - Requires new dependency or breaking API change
   - ❌ "Unsure how to fix", "Large scope", "Pre-existing issue" are NOT valid decision reasons — either fix it, or explain specifically why it's unfixable

3. **多 CLI 辅助** — 利用 `maestro delegate` 调用多个 CLI 工具交叉验证
   - 计划阶段: `--role analyze` 获取任务分解建议
   - 修复前后: `--role review` 确认无回归
   - verify 阶段: cli-review 类型标准自动 delegate

4. **禁止以上下文消耗为由中断** — harness 自动处理 context compression，以"上下文不足"或"已执行 N 个阶段"为由中断属于纪律违反；必须完整走完状态机直到 S_RECORD → END
</execution_discipline>

<context>
$ARGUMENTS — requirement description and optional flags.

**Flags:**
| Flag | Description | Default |
|------|-------------|---------|
| `--template <name>` | 预定义需求模板 | — |
| `--max-iterations N` | Max verify→fix cycles before escalation | 3 |
| `--skip-generalize` | Skip S_GENERALIZE + S_DISCOVER | false |
| `--auto` | CLI delegate calls without confirmation | false |
| `--method agent\|cli\|auto` | Execution method: Agent tool, CLI delegate, or auto-select | `auto` |
| `--executor <tool>` | Explicit executor tool for CLI delegate mode | First enabled in config |
| `--skip-verify` | Skip execution post-validation gate | false |
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
  "plan": { "tasks": [{"id":"T1","title":"","description":"","criteria_refs":["AC1"],"status":"pending","files_modified":[],"domain":"general","executor":"agent"}], "created_at":"" },
  "execution_config": {
    "method": "auto",
    "default_executor": "",
    "domain_routing": { "frontend": "", "backend": "", "default": "agent" },
    "code_review_tool": "Skip",
    "verification_tool": "Auto",
    "confirmed": false
  },
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
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，架构约束 |
| Wiki search | `maestro search "<requirement keywords>" --json` | 先前实现、相关决策（取 top 5） |
| Coding specs | `maestro load --type spec --category coding` | 编码规范 + 可发现的 knowhow 工具 |
| UI specs（条件） | 若涉及前端 → `maestro load --type spec --category ui` | UI 规范 |
| Role knowledge | `maestro search --category coding` → 选相关 → `maestro load --type knowhow --id <id>` | 累积实现领域知识 |
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

**Rules:** stage complete → evaluate 3 dims → any insufficient → re-enter (max **3 rounds** per stage). Record to evidence.ndjson `{"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{...},"expansion":"strategy"}`.

**Expansion:** Round 1 = broaden scope (more dirs, more delegate angles). Round 2 = shift perspective (different CLI tool, reverse-trace from expected result). Round 3 = combine both + targeted deep-dive on remaining gaps.

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
S_VERIFY → S_PLAN        WHEN fundamental plan flaw discovered, loops < max_loops → cross_phase_loops++ (重规划)
S_VERIFY → S_RECORD      WHEN some failed AND iteration >= max (escalate)

S_FIX → S_VERIFY (loop)

S_GENERALIZE → S_DISCOVER  WHEN hits found
S_GENERALIZE → S_RECORD    WHEN no hits

S_DISCOVER → S_EXECUTE     : discovery finds area needing same implementation → cross_phase_loops++
S_DISCOVER → S_RECORD      : triage complete AND remaining_actionable == 0
S_DISCOVER → S_RECORD      : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

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

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): INTAKE — 目标解析"`

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
   Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).
3. Write session.json.plan, append evidence (planning), update understanding.md §2. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): PLAN — 计划制定"`

### A_EXECUTE

#### Step 1: Execution Options Confirmation

**Skip if** `-y` flag OR `--method` explicitly set OR `execution_config.confirmed == true` (resume).

Load available tools: `maestro delegate-config show --json` → extract enabled tools and domain tags.

```
AskUserQuestion({
  questions: [
    {
      question: "任务如何执行？选择一种方式，或 Other 指定域路由规则（如 '前端agy 后端codex 其余agent'）",
      header: "Executor",
      options: [
        { label: "Auto (Recommended)", description: "域路由: frontend→{frontendTool}, backend→{backendTool}, general→agent" },
        { label: "Agent", description: "Claude Code Agent 执行所有任务（最快）" },
        // 每个 enabled CLI tool 一个选项
        ...availableTools.map(t => ({ label: t, description: `${t} CLI 执行所有任务` }))
      ]
    },
    {
      question: "执行后运行代码审查？",
      header: "Review",
      options: [
        { label: "Skip", description: "不审查" },
        ...availableTools.map(t => ({ label: `${t} Review`, description: `${t} CLI: git diff 质量审查` }))
      ]
    },
    {
      question: "验证门控？（外部模型检查收敛 + 结构 + 反模式）",
      header: "Verify",
      options: [
        { label: "Auto (Recommended)", description: `Delegate 到 ${availableTools[0]} 做收敛+结构+反模式检查` },
        ...availableTools.map(t => ({ label: t, description: `${t}: 验证门控` })),
        { label: "Skip", description: "不验证" }
      ]
    }
  ]
})
```

Parse response → write `execution_config` to session.json, set `confirmed: true`.

`--skip-verify` flag overrides verification to `"Skip"`.

#### Step 2: Executor Resolution

Per-task domain routing (when method == "auto"):

| Domain | Keywords / Patterns | File Extensions |
|--------|-------------------|-----------------|
| frontend | UI, component, page, style, layout, CSS, view | .tsx/.jsx/.vue/.css/.html/.svelte |
| backend | API, server, database, service, algorithm, worker | .go/.rs/.java/.py/.sql/.proto |
| general | mixed, config, tests, unclear | .ts/.js/other |

Resolution: `execution_config.domain_routing[domain]` → fallback `domain_routing.default` ("agent").

Log routing per task:
```
T1 [frontend] → agy
T2 [backend]  → codex
T3 [general]  → agent
```

#### Step 3: Task Execution

Execute tasks per plan order. Independent tasks (no cross-dependency) may run in parallel.

**Agent path:**
```
Spawn Agent with:
  task definition, acceptance criteria refs, prior task summaries, specs_content
Agent implements → verifies convergence criteria → auto-fix (max 3) → returns result
```

**CLI path (via maestro delegate):**
```bash
maestro delegate "PURPOSE: Implement task ${task_id}: ${title}; success = criteria ${criteria_refs} satisfied
TASK: ${description} | Read existing code first | Verify convergence criteria after changes
MODE: write
CONTEXT: @${scope}/**/* | Criteria: ${criteria_summary}
EXPECTED: Working code changes, convergence evidence, summary of what was done
CONSTRAINTS: Scope limited to task files | Follow project specs

## Acceptance Criteria (must satisfy)
${criteria_refs.map(ref => criteria[ref].criterion).join('\n')}

## Implementation Steps
${task.description}

## Project Specs
${specs_content}

## Prior Task Summaries
${prior_summaries}
" --to ${resolved_executor} --mode write --id planex-${slug}-${task_id}
```

Run CLI delegate with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

**Deviation Rule** — max 3 auto-fix attempts per task:
1. First attempt: normal dispatch
2. Retry: `--resume planex-${slug}-${task_id}` with simplified prompt
3. Final: fallback to Agent path
4. All 3 fail → mark task `blocked`, record checkpoint, continue remaining tasks

#### Step 4: Per-Task Evidence

Per completed task:
- Record evidence: `{"phase":"execution","type":"task-completed","task_id":"T1","executor":"agent|agy|...","files_modified":[],"summary":"","attempt":1}`
- Update task status in session.json plan

#### Step 5: Post-Execution Validation

**Skip if** `execution_config.verification_tool == "Skip"` OR `--skip-verify` OR no completed tasks.

**Check 1: Summary Consistency** — cross-check task status vs actual file changes (git diff).

**Check 2: CLI Verification Gate** — delegate to external model:
```bash
maestro delegate "PURPOSE: Verify execution output meets acceptance criteria; success = all criteria verified with file:line evidence
TASK:
1. CONVERGENCE: For each criterion, read actual code, verify behavior exists, report status with evidence
2. EXISTENCE: Verify all expected files exist on disk
3. SUBSTANCE: Verify real implementation — flag stubs, placeholders, TODO-only
4. ANTI-PATTERNS: Scan for TODO/FIXME/HACK, console.log debug, disabled tests
MODE: analysis
CONTEXT: @${modified_files}
EXPECTED: JSON { convergence: [{criterion, status, evidence}], issues: [{type, file, line, severity}], overall: passed|gaps_found }
CONSTRAINTS: Read-only | Check ALL criteria exhaustively | Evidence must be file:line

## Acceptance Criteria (verify each)
${acceptance_criteria.map(c => c.criterion).join('\n')}

## Modified Files
${modified_files.join('\n')}
" --to ${execution_config.verification_tool} --mode analysis
```

Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

On result:
- `overall == "passed"` → proceed to S_VERIFY (criteria gate) with boosted confidence
- `overall == "gaps_found"` → log findings, proceed to S_VERIFY (criteria will catch failures)

**Check 3: Code Review** (if `execution_config.code_review_tool != "Skip"`):
```bash
maestro delegate "Review git diff for correctness, style, bugs" --to ${code_review_tool} --mode analysis --rule analysis-review-code-quality
```

#### Step 6: Completion

Update understanding.md §3. Mark G3 done.

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-planex({slug}): EXECUTE — 实现执行"`

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

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): VERIFY — 验收验证"`

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

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-planex({slug}): FIX — 修复"`

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

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): GENERALIZE — 泛化扫描"`

### A_DISCOVER

1. **Triage:** per hit, read context (+-10 lines), classify as `already_handled` | `needs_treatment` | `low_risk`
2. **Route:**
   | Classification | Normal | `-y` |
   |---------------|--------|------|
   | needs_treatment | AskUserQuestion: create issue / plan next iter | auto create issue, `deferred` |
   | low_risk | Record only | Record only |
   | already_handled | Skip | Skip |
3. Append evidence (discovery + decision), update understanding.md §7. Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): DISCOVER — 发现分类"`

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

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-planex({slug}): RECORD — 会话总结"`

</actions>

<appendix>

### Goal Prompt Template

**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次（session 创建后、开始 Plan 前）。A_RECORD 完成时禁止重新显示。**

```
📋 Planex Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
验收标准：
{for each AC in acceptance_criteria:}
- {AC.id}: {AC.criterion} (验证方式: {AC.verify_method})
{end for}
穷尽迭代：直到 acceptance_criteria[*] 全部 status==passed
且 phase_goals_all_done=true 才停。verify 失败自动 fix→re-verify 循环。
每轮修复后重新验证，新发现的标准违反继续修，不超过 max_iterations。
遇到 phase=decision 的 pending 必须 AskUserQuestion，不得自行 resolve。
不允许"接近通过"，验收标准必须 ALL pass。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_INTAKE criteria confirmation | AskUserQuestion | auto-derive, `deferred` |
| S_EXECUTE execution options | AskUserQuestion (executor/review/verify) | use defaults (auto/Skip/Auto), `confirmed: true` |
| S_EXECUTE task blocked (3 retries) | AskUserQuestion: continue or stop | auto continue, log blocked |
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
- [ ] Execution options confirmed (executor/review/verify) before task dispatch
- [ ] Tasks dispatched via resolved executor (agent/cli/auto domain routing)
- [ ] Per-task deviation rule enforced (max 3 retries, fallback chain)
- [ ] Post-execution validation gate run (unless --skip-verify)
- [ ] Tasks executed with evidence logged (executor, attempt count, files_modified)
- [ ] Every criterion verified by its method after each iteration
- [ ] Failing criteria trigger targeted fix (not full re-implementation)
- [ ] Iteration count tracked, max respected
- [ ] **Every unfixed criterion has individual classification and reason** — blanket "pre-existing" labels are forbidden
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
