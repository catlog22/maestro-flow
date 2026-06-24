---
name: odyssey-debug
description: Long-running debug cycle — archaeology, diagnosis, fix, confirmation, generalization, discovery, and knowledge persistence
argument-hint: "<issue> [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
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
Closed-loop deep debugging: archaeology → explore → diagnose → fix & confirm → generalize → discover siblings → persist.
Treats every bug as a learning signal with exhaustive iteration until root cause confirmed or INCONCLUSIVE.
</purpose>

<boundary>
**范围内:** 单一 bug/issue 的完整闭环 — 考古 → 探索 → 诊断 → 修复 → 确认 → 泛化同类 → 沉淀
**范围外:** 新功能开发 → `/odyssey-planex` | 代码质量审查 → `/odyssey-review-test-fix` | UI 视觉优化 → `/odyssey-ui` | 架构重设计 → `/maestro-plan`
**探索自由度:** 边界内自由探索 — 可追踪任意调用链、分析任意历史、测试任意假设。泛化阶段可扫描全项目寻找同类问题。
**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
**模板支持:** `--template <name>` 从预定义调查策略启动，跳过假设生成直接进入针对性诊断：

| Template | 调查策略 | 适用场景 |
|----------|---------|---------|
| `performance` | profiling → hot path → allocation → cache | 性能劣化 |
| `memory-leak` | heap snapshot → retention chain → lifecycle | 内存泄漏 |
| `race-condition` | timeline → concurrent access → lock analysis | 竞态条件 |
| `regression` | git bisect → diff analysis → boundary check | 回归问题 |
| `crash` | stack trace → null chain → error propagation | 崩溃/异常 |
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**

1. **Phase auto-commit** — 每个阶段完成后**自动** `git commit`，无需用户确认
   - 代码变更 + understanding.md → `git add` → `git commit -m "odyssey-debug({slug}): {phase} — {摘要}"`
   - session.json / evidence.ndjson 为运行时状态，不纳入 commit
   - 确保每个阶段的进展可回溯、可恢复

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
   - 关键判断用不同 `--role`（analyze / review / explore）获取多视角
   - 修复前后各做一次 CLI review 确认
   - 不同阶段可调用不同工具，综合多方意见再行动

4. **禁止以上下文消耗为由中断** — harness 自动处理 context compression，以"上下文不足"或"已执行 N 个阶段"为由中断属于纪律违反；必须完整走完状态机直到 S_RECORD → END
</execution_discipline>

<context>
$ARGUMENTS — issue description and optional flags.

**Flags:** `--skip-fix` analysis-only | `--skip-generalize` quick fix | `--template <name>` 预定义策略 | `--auto` no delegate confirmation | `-y` auto-confirm all decisions | `-c` resume last session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-debug-odyssey-{slug}/`

**Output — 4 files:**
```
SESSION_DIR/
  ├── session.json       # state + confirmation + patterns + phase_goals
  ├── evidence.ndjson    # append-only evidence trail (phase field distinguishes origin)
  ├── explore.json       # structured CLI exploration snapshot
  └── understanding.md   # evolving narrative — 9 sections
```

**session.json schema:**
```json
{
  "session_id": "debug-odyssey-{YYYYMMDD-HHmmss}", "issue": "",
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE", "diagnosis_retries": 0,
  "root_cause": null, "patterns": [], "confirmation": null,
  "phase_goals": [], "phase_goals_all_done": false, "self_iteration_log": [],
  "generalization_stats": null,
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson — unified trail:**
```json
{"ts":"","phase":"archaeology|explore|diagnosis|discovery|decision|self-iteration","type":"","source":"","content":"","note":""}
```
Phase-specific fields:
- `archaeology`: `sha`, `author`, `date`, `message`, `relevance` (high|medium|low)
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)
- `discovery`: `file`, `line`, `classification` (safe|risk|bug), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status` (pending|resolved|deferred), `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

**explore.json schema:**
```json
{
  "call_chains": [{"entry":"","chain":["file:line"]}],
  "recent_changes": [{"file":"","commits":[{"sha":"","message":"","date":""}]}],
  "error_gaps": [{"file":"","line":0,"description":""}],
  "similar_patterns": [{"file":"","line":0,"description":""}],
  "cli_tool": "", "timestamp": ""
}
```

**phase_goals[] — auto-derived from flags:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Root cause identified | evidence.ndjson has phase=diagnosis result=confirmed | S_DIAGNOSE | — |
| G2 | Explore context gathered | explore.json ≥1 category populated | S_EXPLORE | — |
| G3 | Fix applied and confirmed | confirmation.overall == confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR no actionable learnings | S_RECORD | — |

When `flags[skip_when] == true` → auto set `status: "skipped"`, `completion_confirmed: true`.

**understanding.md — 9 sections (written by owning phase):**
1. Issue & Scope ← S_INTAKE | 2. Archaeology Summary ← S_ARCHAEOLOGY | 3. Exploration ← S_EXPLORE
4. Hypotheses & Testing ← S_DIAGNOSE | 5. Root Cause ← S_DIAGNOSE | 6. Fix & Confirmation ← S_FIX+S_CONFIRM
7. Generalization ← S_GENERALIZE | 8. Discoveries & Decisions ← S_DISCOVER | 9. Learnings ← S_RECORD

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，作为所有分析的上下文 |
| Wiki search | `maestro search "<issue keywords>" --json` | 先前调查、相关决策（取 top 5） |
| Specs + tools | `maestro load --type spec --category debug --keyword "<symptom>"` | 已知 issue/workaround + 可发现的 knowhow 工具 |
| Role knowledge | `maestro search --category debug` → 选相关 → `maestro load --type knowhow --id <id>` | 累积领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-debug-odyssey-*")` | 相关 odyssey 会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §9 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 反复根因模式 | 模式描述 + 触发条件 + 修复模板 | `/spec-add debug "..."` |
| 非显而易见 workaround | 问题场景 + 解决方案 + 适用范围 | `/spec-add learning "..."` |
| 架构边界违反 | 违反描述 + 正确边界 + 检查方法 | `/spec-add arch "..."` |
| 可复用泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `/spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户通过 next_step_routing 沉淀为永久知识。执行过程中不调用外部 Skill。
</context>

<self_iteration>
**Quality Gate (适用: S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE)**

| 维度 | sufficient | insufficient |
|------|-----------|-------------|
| Coverage | 已知相关文件/模块均已分析 | 遗漏 grep/git log 可发现的目标 |
| Depth | ≥80% 发现有 file:line 级证据 | 多数仅泛泛描述 |
| Actionability | 每条结论有具体后续动作 | 仅"建议关注"类无操作性结论 |

**Rules:** phase complete → evaluate 3 dimensions → any insufficient → re-enter (max **3 rounds** per stage).
- Round 1: widen scope — more dirs, git log depth ×2, extra delegate angles
- Round 2: shift perspective — different CLI tool, reverse trace, manual code reading
- Round 3: combine both + targeted deep-dive on remaining gaps

**Exit:** all sufficient → advance | 3-round cap → log remaining gaps and continue. Record to `evidence.ndjson` + `session.json.self_iteration_log[]`.
</self_iteration>

<state_machine>

<states>
S_INTAKE       — 解析问题、加载上下文、检查/恢复 session     PERSIST: session.json + understanding.md §1
S_ARCHAEOLOGY  — 考古：git history + CLI 分析              PERSIST: evidence.ndjson (archaeology) + understanding.md §2
S_EXPLORE      — CLI 探索：调用链、错误间隙、相似模式        PERSIST: explore.json + evidence.ndjson (explore) + understanding.md §3
S_DIAGNOSE     — 假设驱动根因分析                          PERSIST: evidence.ndjson (diagnosis|decision) + understanding.md §4-5
S_FIX          — 实现修复 (skip_fix 时跳过)                PERSIST: code changes + evidence.ndjson (decision)
S_CONFIRM      — 测试 + CLI review 双重确认 (skip_fix 时跳过) PERSIST: session.json.confirmation + understanding.md §6
S_GENERALIZE   — 举一反三：提取 pattern，扫描相似代码       PERSIST: session.json.patterns + understanding.md §7
S_DISCOVER     — 评估发现，创建 issue / 记录决策            PERSIST: evidence.ndjson (discovery|decision) + understanding.md §8
S_RECORD       — 知识沉淀 + 目标审计                       PERSIST: understanding.md §9 + spec entries
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME_SESSION
S_INTAKE → S_ARCHAEOLOGY  : issue parsed → A_INTAKE
S_INTAKE → S_INTAKE       : no issue, no session → AskUserQuestion

S_ARCHAEOLOGY → S_EXPLORE     : A_ARCHAEOLOGY complete
S_EXPLORE     → S_DIAGNOSE    : A_EXPLORE complete

S_DIAGNOSE → S_FIX          : root cause confirmed, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : root cause confirmed, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : root cause confirmed, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : all hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : all hypotheses failed, retries >= 3 → mark INCONCLUSIVE

S_FIX     → S_CONFIRM       : fix implemented
S_CONFIRM → S_GENERALIZE    : confirmed, !skip_generalize
S_CONFIRM → S_RECORD        : confirmed, skip_generalize
S_CONFIRM → S_FIX           : needs_rework

S_GENERALIZE → S_DISCOVER   : similar code found
S_GENERALIZE → S_RECORD     : no similar code

S_DISCOVER → S_DIAGNOSE     : discovery finds new bug worth investigating → cross_phase_loops++
S_DISCOVER → S_FIX          : discovery finds same-pattern bug, fix template applies, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : triage complete AND remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

S_RECORD   → END            : A_RECORD complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: issue description, flags
2. Generate slug, create `SESSION_DIR`
3. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + Grep keywords
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` §1
6. Emit Goal Prompt (see Appendix)

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): INTAKE — 目标解析与上下文加载"`

### A_RESUME_SESSION
Find latest session via Glob → read `session.json` → display summary → jump to `current_state`.

### A_ARCHAEOLOGY
**Git archaeology (2 parallel Agents):**

| Agent | Task |
|-------|------|
| Timeline | `git log --oneline -20 -- {files}` → change timeline |
| Blame | Top 3 suspicious files: `git blame -L {region}` → critical paths |

Append findings to `evidence.ndjson` (phase: "archaeology").

**CLI-assisted change review:**
```bash
maestro delegate "PURPOSE: Review recent modifications related to: {issue}
TASK: Analyze intent behind changes | Identify risky modifications | Flag potential bug sources
MODE: analysis
CONTEXT: @{relevant_files} | Git log: {top_10_commits}
EXPECTED: JSON [{commit_sha, risk_level, analysis, could_cause_issue, explanation}]
CONSTRAINTS: Focus on behavioral changes, not formatting
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow). Append results to evidence.

Update `understanding.md` §2.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): ARCHAEOLOGY — git 考古分析"`

### A_EXPLORE
Skip if no enabled CLI tools (W006).

```bash
maestro delegate "PURPOSE: Gather codebase evidence for: {issue}
TASK: Trace call chains | Find recent changes | Identify error gaps | Check similar patterns
MODE: analysis
CONTEXT: @**/*
EXPECTED: JSON {call_chains, recent_changes, error_gaps, similar_patterns}
CONSTRAINTS: Max 20 entries/category | Symptom-related code paths
Symptoms: {issue}  Archaeology hints: {suspicious_commits}
" --role explore --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

Parse → write `explore.json` + append `evidence.ndjson` (phase: "explore"). Update §3. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): EXPLORE — 代码探索完成"`

### A_DIAGNOSE
1. **Form hypotheses** from evidence (archaeology + explore), ranked [HIGH]/[MEDIUM]/[LOW] → §4
2. **Test each** (rank order): design test → execute → append evidence (phase: "diagnosis")
3. **Decision journal**: ambiguity → evidence (phase: "decision"); Normal: AskUserQuestion | `-y`: defer
4. **Root cause**: confirmed → `session.json.root_cause` + §5. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): DIAGNOSE — 根因确认"`

### A_ESCALATE_DIAGNOSIS
Increment `diagnosis_retries`. If < 3: broaden scope via `maestro delegate --role analyze` (same delegate format), form new hypotheses, return to S_DIAGNOSE. If >= 3: Normal → AskUserQuestion (broaden/new/INCONCLUSIVE) | `-y` → auto INCONCLUSIVE, proceed to S_RECORD. See Appendix: `-y` behavior.

### A_FIX
1. Present root cause + proposed fix. Normal: AskUserQuestion | `-y`: auto proceed (see Appendix)
2. Implement fix
3. Record in evidence (phase: "decision")

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-debug({slug}): FIX — {修复摘要}"`

### A_CONFIRM
1. **Tests**: auto-detect framework, run covering tests
2. **CLI fix review**:
```bash
maestro delegate "PURPOSE: Review fix for: {issue}
TASK: Verify correctness | Check regressions | Assess completeness | Review edge cases
MODE: analysis
CONTEXT: @{modified_files} | Root cause: {summary} | Diff: {git_diff}
EXPECTED: JSON {verdict, findings [{severity, description, suggestion}], regression_risk}
CONSTRAINTS: Focus on correctness, not style
" --role review --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

3. Write `session.json.confirmation`: `{test_result, cli_review, overall: "confirmed|needs_rework", timestamp}`
4. Update §6. `needs_rework` → S_FIX. `confirmed` → mark G3 done, advance.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): CONFIRM — 修复验证"`

### A_GENERALIZE
举一反三: multi-layer pattern extraction → 4-agent scan → cross-layer dedup → iterative deepening.

**Pattern extraction** from root cause + fix:

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex patterns (direct Grep) | `eval(`, missing `await`, unclosed resource |
| Semantic | Anti-pattern description (Agent-driven) | Unhandled async errors, unvalidated input |
| Structural | Architecture-level (file/module similarity) | Same import structure, missing override |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template}]`

**4-agent parallel codebase scan:**

| Agent | Strategy | Input | Scope |
|-------|----------|-------|-------|
| Syntax grep | Grep syntax-layer regex | P*.signature | Full project |
| Semantic scan | Understand + check anti-pattern | P*.description | Related modules |
| Structural match | Find structurally similar files | Buggy file structure | Full project |
| Historical grep | `git log -S "{pattern}"` | P*.signature | Full git history |

Returns: `[{pattern_id, file, line, context, risk_level, layer, confidence}]`

**Cross-layer dedup**: same file:line multi-layer hit → boost confidence | single-layer → `needs_review` | historical hit on fixed record → `regression_risk`

**Iterative deepening**: module with ≥3 hits → targeted deep scan (max 1 round).

**Quality Gate** (self-iteration) → if insufficient, expand and re-scan.

Write §7 + `session.json.generalization_stats`: `{patterns_extracted, total_hits, cross_layer_confirmed, regression_risks, by_layer, deepening_triggered}`. Mark G4 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): GENERALIZE — 泛化扫描完成"`

### A_DISCOVER
1. **Triage** each hit: read ±10 lines context → classify `safe`/`risk`/`bug`
2. **Route**:
   - `bug` + directly fixable → **fix immediately** (not just log an issue) → back to S_FIX
   - `bug` + requires cross-module/architectural decision → create issue (with fix suggestion + impact analysis)
   - `risk` → evaluate if guard/validation can mitigate directly; if yes, fix it
   - `safe` → mark skip
   See Appendix `-y` behavior table. Append evidence (phase: "discovery" + "decision")
3. Update §8. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): DISCOVER — 发现分类完成"`

### A_RECORD
1. Finalize `understanding.md` §9
2. **Write learnings** to understanding.md §9: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令
3. Mark G6 done. Process pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count)
4. **Goal audit**: all `completion_confirmed` true → `phase_goals_all_done = true`. Any false: Normal → AskUserQuestion (回退/跳过/接受) | `-y` → auto accept
5. **Completion**: `current_state = "COMPLETED"`, emit summary:
```
--- DEBUG ODYSSEY COMPLETE ---
Issue:      {issue}
Root cause: {root_cause.hypothesis}
Fix:        {applied|skipped|inconclusive}
Patterns:   {patterns_extracted} ({by_layer} distribution)
Scan hits:  {total_hits} ({cross_layer_confirmed} cross-layer confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} spec entries persisted
Self-iter:  {N} quality gate rounds across {M} stages
Goals:      {done}/{total} confirmed ({skipped} skipped)
---
```

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): RECORD — 会话总结与知识沉淀"`

</actions>

<appendix>

### Goal Prompt Template

**时机守卫：仅在 A_INTAKE 完成后显示一次。A_RECORD 完成时禁止重新显示。**

```
📋 Debug Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
穷尽迭代：直到根因确认（或明确 INCONCLUSIVE）且修复验证通过
且泛化扫描穷尽（所有 hits 已分类处理）且 phase_goals_all_done=true 才停。
假设失败时扩范围→换视角→升级工具，不轻易放弃。
泛化发现的同类 bug 全部修复或创建 issue，不允许遗留。
遇到 phase=decision 的 pending 必须 AskUserQuestion，不得自行 resolve。
```

Odyssey 输出提示词后继续执行不阻塞。`/goal` 由用户任意时刻输入。

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` mode |
|---------------|--------|-----------|
| A_DIAGNOSE ambiguity | AskUserQuestion blocks | record `deferred`, best-effort continue |
| A_ESCALATE 3-strike | AskUserQuestion 3-way | auto INCONCLUSIVE |
| A_FIX direction | AskUserQuestion confirm | auto proceed with suggested fix |
| A_DISCOVER bug triage | AskUserQuestion route | auto create issue |
| A_DISCOVER ambiguous | AskUserQuestion batch | all `deferred` |
| A_RECORD decisions | AskUserQuestion per-item | skip, show deferred count |
| A_RECORD goal audit | AskUserQuestion 3-way | auto accept current state |

`deferred` items shown as "待决策" in completion summary; recoverable via `-c`.

### Phase Goal Lifecycle

`pending → done (confirmed=true)` normal | `pending → skipped (confirmed=true)` flags/manual | `pending → failed (confirmed=false)` INCONCLUSIVE

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No issue and no session to resume | Provide issue or use -c |
| E003 | error | Resume but no session found | Start new session |
| E004 | error | Delegate execution failed | Retry or proceed without CLI |
| W001 | warning | No relevant git history | Proceed with limited context |
| W002 | warning | All hypotheses inconclusive after 3 retries | INCONCLUSIVE |
| W003 | warning | Generalization scan 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
| W005 | warning | Pending decisions unresolved | Filter evidence.ndjson phase=decision |
| W006 | warning | CLI exploration skipped (no tools) | Proceed without explore.json |
</error_codes>

<success_criteria>
- [ ] Session directory created with 4 output files
- [ ] Prior knowledge searched (maestro search + sessions + architecture)
- [ ] Git archaeology (log + blame) + CLI change review, evidence.ndjson phase=archaeology
- [ ] CLI exploration, explore.json written, evidence phase=explore
- [ ] Hypotheses formed from archaeology + explore, tested and logged phase=diagnosis
- [ ] Root cause declared with evidence refs
- [ ] understanding.md tracks all 9 sections progressively
- [ ] Fix implemented + confirmed with test + CLI review (unless --skip-fix)
- [ ] Multi-layer patterns (syntax/semantic/structural) extracted (unless --skip-generalize)
- [ ] 4-agent scan + cross-layer dedup + iterative deepening for ≥3 hits/module
- [ ] Discoveries classified and routed (fix/issue/decision/skip)
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
- [ ] Decision journal: all human-judgment items in evidence.ndjson phase=decision
- [ ] phase_goals derived from flags, skip_when applied, each phase marks its goal
- [ ] Goal audit in A_RECORD — unmet goals surfaced, phase_goals_all_done set correctly
- [ ] Goal Prompt displayed once after session creation
- [ ] `-y`: all decisions auto-resolve/defer, deferred count in summary
- [ ] State saved at each transition (resumable via -c)
- [ ] Quality Gate self-iteration when insufficient, logged in self_iteration_log
- [ ] Spec entries persisted for reusable learnings
- [ ] Completion summary with all stats
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Issues from discoveries | `/manage-issue list --source debug-odyssey` |
| Pattern worth documenting | `/learn-decompose <module>` |
| Fix needs formal review | `/quality-review <phase>` |
| Second opinion on root cause | `/learn-second-opinion <understanding.md>` |
| Related question | `/learn-investigate "<question>"` |
| Decisions still pending | Filter evidence.ndjson phase=decision status=pending |
</next_step_routing>
