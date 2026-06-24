---
name: odyssey-improve
description: Long-running codebase improvement cycle — multi-dimensional audit, deep diagnosis, targeted fix, verify, generalize, and engineering knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
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
Deep codebase improvement: survey → 6-dimension audit → diagnose → fix → verify → generalize → discover → persist.
Baseline-first approach with exhaustive iteration until zero remaining actionable findings.
</purpose>

<boundary>
**范围内:** 目标代码的运行质量提升 — 性能/安全/架构/可靠性/可观测性/可维护性多维度审查 → 诊断 → 修复 → 泛化
**范围外:** UI 视觉优化 → `/odyssey-ui` | 新功能实现 → `/odyssey-planex` | 单一 bug 调查 → `/odyssey-debug` | 代码风格审查 → `/odyssey-review-test-fix`
**探索自由度:** 边界内自由探索 — 可 profiling、安全扫描、架构分析、依赖审计。在约束下尽可能发现深层问题。
**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**

1. **Phase auto-commit** — 每个阶段完成后**自动** `git commit`，无需用户确认
   - 代码变更 + understanding.md → `git add` → `git commit -m "odyssey-improve({slug}): {phase} — {摘要}"`
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
   - survey 阶段: `--role explore` 发现依赖/复杂度热点
   - audit/diagnose: `--role analyze` 获取多视角分析
   - fix 前后: `--role review` 确认改进正确性

4. **禁止以上下文消耗为由中断** — harness 自动处理 context compression，以"上下文不足"或"已执行 N 个阶段"为由中断属于纪律违反；必须完整走完状态机直到 S_RECORD → END
</execution_discipline>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan (use with caution) |

**Flags:**
| Flag | Effect | Default |
|------|--------|---------|
| `--dimensions <list>` | Comma-separated subset of 6 dimensions | all 6 |
| `--fix-threshold <severity>` | 修复到哪个 severity 为止（all = 全部修复）| all |
| `--skip-fix` | Audit + diagnose only, no code changes | false |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER | false |
| `--auto` | CLI delegates without confirmation | false |
| `-y` | Auto-confirm all decisions (see appendix) | false |
| `-c` | Resume most recent session | — |

**Dimensions (6):**
1. **performance** — hot paths, N+1 queries, memory allocation, cache efficiency, bundle size, lazy loading
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulnerabilities, secrets
3. **architecture** — layer violations, circular dependencies, coupling metrics, interface contracts, SRP violations
4. **reliability** — error handling gaps, retry logic, timeout handling, graceful degradation, resource cleanup
5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks
6. **maintainability** — code complexity (cyclomatic), dead code, test coverage gaps, documentation debt

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-improve-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + audit_result + diagnoses + patterns + phase_goals
  ├── evidence.ndjson    # append-only (phase: survey|audit|diagnosis|fix|discovery|decision|self-iteration)
  └── understanding.md   # 9-section evolving narrative
```

**session.json schema:**
```json
{
  "session_id": "improve-odyssey-{YYYYMMDD-HHmmss}",
  "target": "", "dimensions": [],
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "baseline_metrics": {},
  "audit_result": { "dimensions_audited": [], "finding_count": 0, "severity_distribution": {} },
  "diagnoses": [],
  "patterns": [],
  "confirmation": null,
  "generalization_stats": null,
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson unified schema:** `{"ts":"","phase":"<phase>","type":"<type>","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":"","measurement":""}`

Phase-specific fields:
- `survey`: `category` (dependency|complexity|coverage|error_pattern), `detail`
- `audit`: `dimension`, `severity`, `measurement`
- `diagnosis`: `finding_ref`, `hypothesis`, `result` (confirmed|disproved|inconclusive), `root_cause`
- `fix`: `finding_ref`, `change_summary`, `risk`
- `discovery`: `file`, `line`, `classification` (safe|risk|issue), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status` (pending|resolved|deferred), `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Diagnosis completed | S_DIAGNOSE | — |
| G4 | Zero remaining: all findings fixed and verified | `remaining_actionable == 0` within fix_threshold | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

Lifecycle: `pending → done | skipped | failed` (all set `completion_confirmed`)

**understanding.md — 9 sections (written by owning phase):**
1. Target & Baseline ← S_INTAKE | 2. Current State Survey ← S_SURVEY | 3. Audit Findings ← S_AUDIT
4. Root Cause Diagnosis ← S_DIAGNOSE | 5. Fix & Verification ← S_FIX+S_VERIFY
6. Generalization ← S_GENERALIZE | 7. Discoveries ← S_DISCOVER
8. Improvement Metrics ← S_RECORD (before/after) | 9. Engineering Learnings ← S_RECORD

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，作为分析上下文 |
| Wiki search | `maestro search "<target keywords>" --json` | 先前优化、相关决策（取 top 5） |
| Coding specs | `maestro load --type spec --category coding` | 编码规范 |
| Debug specs | `maestro load --type spec --category debug` | 已知性能/安全模式 |
| Role knowledge | `maestro search --category coding` → 选相关 → `maestro load --type knowhow --id <id>` | 累积领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-improve-odyssey-*")` | 相关会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §9 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 性能 pattern | 瓶颈类型 + 修复方案 + 度量方法 | `/spec-add coding "..."` |
| 安全规则 | 漏洞类别 + 修复 + 预防方法 | `/spec-add debug "..."` |
| 架构约束 | 违反描述 + 正确边界 + 检查方法 | `/spec-add arch "..."` |
| 可靠性 pattern | 故障模式 + 处理策略 + 验证手段 | `/spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户通过 next_step_routing 沉淀为永久知识。执行过程中不调用外部 Skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient → re-enter (max **3 rounds**).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All target files/modules analyzed across dimensions | Missed files discoverable via grep/glob |
| Depth | ≥80% findings have file:line evidence + measurement | Most findings lack specifics |
| Actionability | Each conclusion has concrete fix or issue action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more modules, deeper import chain, extra delegate angles). Round 2 = shift perspective (different CLI tool, reverse dependency trace, manual code reading). Round 3 = combine both + targeted deep-dive on remaining gaps.

**Log:** `evidence.ndjson ← {"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{},"expansion":""}`

**Applicable stages:** S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE
</self_iteration>

<state_machine>

<states>
S_INTAKE     — Parse target, load context, establish baseline metrics       PERSIST: session.json + understanding.md §1
S_SURVEY     — Current state: dependency audit, complexity scan, coverage   PERSIST: evidence.ndjson (survey) + understanding.md §2
S_AUDIT      — 6-dimension parallel deep audit                             PERSIST: evidence.ndjson (audit) + understanding.md §3
S_DIAGNOSE   — Root cause analysis for critical/high findings              PERSIST: evidence.ndjson (diagnosis|decision) + understanding.md §4
S_FIX        — Implement improvements (skip if --skip-fix)                 PERSIST: code changes + evidence.ndjson (fix)
S_VERIFY     — Tests + measurement comparison (skip if --skip-fix)         PERSIST: session.json.confirmation + understanding.md §5
S_GENERALIZE — Pattern extraction + 4-agent scan (skip if --skip-gen)      PERSIST: session.json.patterns + understanding.md §6
S_DISCOVER   — Classify hits, create issues (skip if --skip-gen)           PERSIST: evidence.ndjson (discovery|decision) + understanding.md §7
S_RECORD     — Persist metrics + learnings + final report                  PERSIST: understanding.md §8-9 + spec entries
</states>

<transitions>
S_INTAKE:
  → S_INTAKE      WHEN -c + session found        DO A_RESUME
  → S_SURVEY      WHEN target resolved            DO A_INTAKE
  → S_INTAKE      WHEN no target                  DO AskUserQuestion

S_SURVEY       → S_AUDIT        DO A_SURVEY

S_AUDIT:
  → S_DIAGNOSE     WHEN critical/high findings exist       DO A_AUDIT
  → S_GENERALIZE   WHEN no critical/high AND !skip_gen     DO A_AUDIT
  → S_RECORD       WHEN no findings OR skip_gen            DO A_AUDIT

S_DIAGNOSE:
  → S_FIX          WHEN root causes identified AND !skip_fix           DO A_DIAGNOSE
  → S_GENERALIZE   WHEN root causes identified AND skip_fix AND !skip_gen  DO A_DIAGNOSE
  → S_RECORD       WHEN root causes identified AND skip_fix AND skip_gen   DO A_DIAGNOSE
  → S_DIAGNOSE     WHEN hypotheses failed AND retries < 3             DO A_ESCALATE_DIAGNOSIS
  → S_RECORD       WHEN hypotheses failed AND retries >= 3            DO mark INCONCLUSIVE

S_FIX          → S_VERIFY       DO A_FIX

S_VERIFY:
  → S_GENERALIZE   WHEN verified AND !skip_gen    DO A_VERIFY
  → S_RECORD       WHEN verified AND skip_gen     DO A_VERIFY
  → S_FIX          WHEN needs_rework              DO A_VERIFY

S_GENERALIZE:
  → S_DISCOVER     WHEN hits found                DO A_GENERALIZE
  → S_RECORD       WHEN no hits                   DO A_GENERALIZE

S_DISCOVER → S_DIAGNOSE     : new critical issue found → cross_phase_loops++
S_DISCOVER → S_FIX          : same-pattern fix, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : triage complete AND remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

S_RECORD   → END            DO A_RECORD
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target description, flags, `--dimensions` subset
2. Generate slug, create `SESSION_DIR`
3. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load coding/debug
4. **Baseline capture**: Record current metrics (test pass rate, bundle size, dependency count, complexity hotspots) to `session.json.baseline_metrics`
5. Derive `phase_goals[]` from flags (apply `skip_when`)
6. Write `session.json` + `understanding.md` §1 (Target & Baseline)
7. Emit Goal Prompt (see Appendix)

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): INTAKE — 目标解析与基线采集"`

### A_RESUME
Find latest session via Glob → read `session.json` → display summary → jump to `current_state`.

### A_SURVEY
Current state survey — understand what exists before proposing changes.

1. **Dependency audit**: Read package.json/lock files, scan for outdated/vulnerable deps
2. **Complexity scan**: Identify high-complexity files (file size, function count, nesting depth)
3. **Test coverage map**: Which modules have coverage, which don't
4. **Error handling scan**: Grep for empty catch, unhandled promise, missing error boundaries
5. **CLI-assisted survey** (optional):
```bash
maestro delegate "PURPOSE: Survey codebase health of: {target}
TASK: Dependency health | Complexity hotspots | Test coverage gaps | Error handling patterns
MODE: analysis
CONTEXT: @{target_files}
EXPECTED: JSON {dependency_health, complexity_hotspots, coverage_gaps, error_patterns}
CONSTRAINTS: Focus on runtime quality, not style
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

6. Append evidence.ndjson (phase: "survey"). Update `understanding.md` §2. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): SURVEY — 现状调查"`

### A_AUDIT
Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset):

| Agent | Dimension | Focus |
|-------|-----------|-------|
| Performance | performance | Hot paths, N+1 queries, memory allocation, cache efficiency, bundle size, lazy loading |
| Security | security | OWASP Top 10, injection, auth bypass, data exposure, dependency vulns, secrets |
| Architecture | architecture | Layer violations, circular deps, coupling, interface contracts, SRP violations |
| Reliability | reliability | Error handling gaps, retry logic, timeout handling, graceful degradation, cleanup |
| Observability | observability | Logging coverage, metric gaps, trace propagation, error reporting, health checks |
| Maintainability | maintainability | Cyclomatic complexity, dead code, test coverage gaps, documentation debt |

Each returns: `[{title, severity, dimension, file, line, description, suggestion, measurement}]`

Merge → evidence.ndjson (phase: "audit"). Write `session.json.audit_result`.
Update `understanding.md` §3 (findings by dimension + severity matrix). Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): AUDIT — 多维审查"`

### A_DIAGNOSE
Root cause analysis for critical/high findings — don't fix symptoms.

1. Group findings by dimension, prioritize by severity
2. For each critical/high finding:
   - Form hypothesis about root cause
   - Test: trace code path, check git history, verify with evidence
   - Record to evidence.ndjson (phase: "diagnosis")
3. **Decision journal**: ambiguity → evidence (phase: "decision"); Normal: AskUserQuestion | `-y`: defer
4. **CLI-assisted diagnosis** for complex findings:
```bash
maestro delegate "PURPOSE: Diagnose root cause of: {finding}
TASK: Trace code path | Check for systemic pattern | Identify fix approach
MODE: analysis
CONTEXT: @{relevant_files} | Finding: {finding_detail}
EXPECTED: JSON {root_cause, systemic, fix_approach, risk}
CONSTRAINTS: Focus on root cause, not symptom
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

5. Write `session.json.diagnoses[]`. Update `understanding.md` §4. Mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): DIAGNOSE — 根因诊断"`

### A_ESCALATE_DIAGNOSIS
Increment retries. If < 3: broaden scope via `maestro delegate --role analyze`, form new hypotheses, return to S_DIAGNOSE. If >= 3: Normal → AskUserQuestion (broaden/new/INCONCLUSIVE) | `-y` → auto INCONCLUSIVE, proceed to S_RECORD.

### A_FIX
Skip if `--skip-fix`. Implement improvements for diagnosed root causes.

1. **穷尽修复**: Fix ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify modified area — new findings append to current tier.
2. For each fix: implement → record evidence.ndjson (phase: "fix")
3. **Normal**: AskUserQuestion per-fix confirmation. **`-y`**: auto-proceed, record `deferred`.

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-improve({slug}): FIX — 改进实现"`

### A_VERIFY
Verify improvements with measurement comparison.

1. Run tests covering modified areas
2. **Measure improvement**: re-capture metrics, compare with `session.json.baseline_metrics`
3. **CLI-assisted verification**:
```bash
maestro delegate "PURPOSE: Verify improvements for: {target}
TASK: Check fix correctness | Test regressions | Measure impact | Compare with baseline
MODE: analysis
CONTEXT: @{modified_files} | Baseline: {baseline_metrics} | Fixes: {fix_summary}
EXPECTED: JSON {verdict, metrics_improved, regressions, remaining_issues}
CONSTRAINTS: Focus on correctness and measurable improvement
" --role review --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

4. `needs_rework` → S_FIX. `verified` → mark G4 done, advance.
5. Write `session.json.confirmation`. Update `understanding.md` §5 (before/after metrics table).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): VERIFY — 改进验证"`

### A_GENERALIZE
Multi-layer pattern extraction from diagnoses + fixes → 4-agent scan → cross-layer dedup.

**Pattern extraction** from root causes + improvements:

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex → direct Grep | Missing `await`, unclosed resource, empty catch, `eval(` |
| Semantic | Agent understands anti-pattern → scans | Unhandled async errors, missing retry, N+1 query |
| Structural | File/module structure similarity | Same import pattern, missing error boundary |
| Historical | `git log -S "{pattern}"` | When similar issues were introduced/fixed |

Write `session.json.patterns[]`: `[{id, source_finding, layer, signature, description, risk, fix_template, confidence}]`

**4-agent parallel scan** (single message):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep patterns matching found issues | Full project |
| Semantic scan | Find modules with same anti-pattern | Related modules |
| Structural match | Find structurally similar files | Full project |
| Historical grep | `git log -S "{pattern}"` | Git history |

**Cross-layer dedup**: Multi-layer hit → boost confidence. Single-layer → `needs_review`. Historical match on fixed code → `regression_risk`.

**Iterative deepening**: Module with ≥3 hits → targeted deep scan (max 1 round).

Update `understanding.md` §6. Write `session.json.generalization_stats`. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): GENERALIZE — 泛化扫描"`

### A_DISCOVER
1. **Triage** each hit: read ±10 lines context → classify `safe`/`risk`/`issue`
2. **Route**:
   - `issue` + directly fixable → **fix immediately** → back to S_FIX
   - `issue` + requires cross-module/architectural decision → create issue (with fix suggestion + impact analysis)
   - `risk` → evaluate if guard/validation can mitigate directly; if yes, fix it
   - `safe` → mark skip
   **Normal**: AskUserQuestion for routing ambiguity. **`-y`**: auto-fix what's fixable, create issue for rest.
3. **Cross-phase loops**: new critical issue → S_DIAGNOSE; same-pattern fix → S_FIX.
4. Append evidence (phase: "discovery" + "decision"). Update `understanding.md` §7. Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): DISCOVER — 发现分类"`

### A_RECORD
1. **understanding.md §8**: Improvement metrics — before/after comparison table from baseline_metrics vs current
2. **understanding.md §9**: Engineering learnings — 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令
3. Mark G7 done. Pending decisions: **Normal** → AskUserQuestion. **`-y`** → skip, show deferred count.
4. **Goal audit**: all `phase_goals[*].completion_confirmed` true → `phase_goals_all_done = true`. Any false: **Normal** → AskUserQuestion (回退/跳过/接受) | **`-y`** → auto accept.
5. `current_state = "COMPLETED"`. Emit completion summary:
```
--- IMPROVE ODYSSEY COMPLETE ---
Target:      {target}
Dimensions:  {dimensions_audited}
Findings:    {C}C {H}H {M}M {L}L
Diagnosed:   {diagnosed_count} root causes identified
Fix:         {fixed_count} improvements, verified={yes|skipped}
Metrics:     {improved} improved, {regressed} regressed
Patterns:    {extracted} ({by_layer} distribution)
Scan hits:   {total} ({cross_layer} cross-layer confirmed)
Issues:      {N} created
Decisions:   {N} resolved, {M} pending, {K} deferred
Learnings:   {N} entries in understanding.md §9
Self-iter:   {N} quality gate rounds across {M} stages
Cross-loops: {cross_phase_loops}/{max_loops} used
Goals:       {done}/{total} ({skipped} skipped)
---
```

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): RECORD — 指标总结与知识沉淀"`

</actions>

<appendix>

### Goal Prompt Template
**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次。A_RECORD 完成时禁止重新显示。**

```
📋 Improve Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
穷尽迭代：直到 session.json 的 audit_result 中所有 findings 均已处理（fix/issue/decision）
且 phase_goals_all_done=true 才停。修复按 severity 逐轮迭代，每轮修复后 re-verify 修改区域。
Baseline metrics 必须在修复前采集，修复后必须与 baseline 对比确认改进。
遇到 phase=decision 的 pending 必须 AskUserQuestion。不允许"只报告不处理"。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm Behavior
| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX improvement confirmation | AskUserQuestion | auto-proceed, `deferred` |
| A_DIAGNOSE ambiguity | AskUserQuestion | best-effort, `deferred` |
| A_ESCALATE 3-strike | AskUserQuestion 3-way | auto INCONCLUSIVE |
| A_DISCOVER hit routing | AskUserQuestion | auto create issue, `deferred` |
| A_DISCOVER ambiguous items | AskUserQuestion | all `deferred` |
| A_RECORD pending decisions | AskUserQuestion | skip, show deferred count |
| A_RECORD goal audit | AskUserQuestion | auto accept |

`deferred` items shown as "待决策" in completion summary; recoverable via `-c`.

### Phase Goal Lifecycle
`pending → done (confirmed=true)` normal | `pending → skipped (confirmed=true)` flags/manual | `pending → failed (confirmed=false)` exception

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target or use -c |
| E002 | error | Target path not found | Check path |
| E003 | error | Resume but no session found | Start new session |
| W001 | warning | No dependency manifest found | Proceed without dep audit |
| W002 | warning | Some dimension agents failed | Partial audit coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved, baseline metrics captured in session.json
- [ ] Dependency + complexity + coverage survey completed
- [ ] All dimensions audited (6 parallel agents) with structured findings
- [ ] Severity matrix produced
- [ ] Root causes diagnosed for critical/high findings (hypothesis-driven)
- [ ] Improvements implemented and verified with before/after metrics (unless --skip-fix)
- [ ] Multi-layer generalization scan + cross-layer dedup (unless --skip-generalize)
- [ ] Cross-phase loops used when discoveries warrant
- [ ] Quality Gate self-iteration triggered when insufficient
- [ ] Discoveries classified and routed
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
- [ ] understanding.md §8: improvement metrics (before/after comparison)
- [ ] understanding.md §9: engineering learnings
- [ ] phase_goals G1-G7 tracked and audited
- [ ] Goal Prompt displayed once
- [ ] `-y`: no blocking prompts, deferred counted
- [ ] Session resumable via -c
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Security findings need deep investigation | `/odyssey-debug "<finding>"` |
| UI-related findings | `/odyssey-ui "<component>"` |
| Issues created from discoveries | `/manage-issue list --source improve-odyssey` |
| Architecture pattern to document | `/spec-add arch "..."` |
| Performance pattern to persist | `/spec-add coding "..."` |
| Want formal review of changes | `/odyssey-review-test-fix <changed-files>` |
| Decisions still pending | Filter evidence.ndjson phase=decision status=pending |
</next_step_routing>
