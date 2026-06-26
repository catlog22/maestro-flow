---
name: odyssey-improve
description: "Long-running codebase improvement cycle — multi-dimensional audit, deep diagnosis, targeted fix, verify, generalize, and engineering knowledge persistence"
argument-hint: '"<target>" [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]'
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
Deep codebase improvement: survey → 6-dimension audit → diagnose → fix → verify → generalize → discover → persist.
Baseline-first approach with exhaustive iteration until zero remaining actionable findings.

Core philosophy:
- **Measure before improving** — baseline first, then optimize
- **Root cause over symptom** — trace each issue to its origin
- **Fix one, improve many** — every improvement reveals a class of opportunities
- **Verify improvement** — measure after fix, compare with baseline

**三句哲学约束（穷尽迭代）:**
1. **零遗留** — 每个 finding 必须是 action item（修复 / issue / 决策），不允许只报告不处理
2. **穷尽迭代** — 按 severity 从高到低逐轮修复，直到 0 remaining actionable findings 才退出 fix loop
3. **改进即标准** — 每次修复后重审同区域，发现新问题继续修，直到该区域无可改善
</purpose>

<boundary>
**范围内:** 目标代码的运行质量提升 — 性能/安全/架构/可靠性/可观测性/可维护性多维度审查 → 诊断 → 修复 → 泛化
**范围外:** UI 视觉优化 → `$odyssey-ui` | 新功能实现 → `$odyssey-planex` | 单一 bug 调查 → `$odyssey-debug` | 代码风格审查 → `$odyssey-review-test-fix`
**探索自由度:** 边界内自由探索 — 可 profiling、安全扫描、架构分析、依赖审计。在约束下尽可能发现深层问题。
**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
</boundary>

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
| `--heartbeat` | Enable /loop heartbeat protocol (see base) | false |

**Dimensions (6):**
1. **performance** — hot paths, N+1 queries, memory allocation, cache efficiency, bundle size, lazy loading
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulnerabilities, secrets
3. **architecture** — layer violations, circular dependencies, coupling metrics, interface contracts, SRP violations
4. **reliability** — error handling gaps, retry logic, timeout handling, graceful degradation, resource cleanup
5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks
6. **maintainability** — code complexity (cyclomatic), dead code, test coverage gaps, documentation debt

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-improve-odyssey-{slug}/`

**Output:** `session.json` (state + audit + diagnoses + patterns + goals) | `evidence.ndjson` (append-only) | `understanding.md` (9-section narrative)

**session.json unique fields:** `target`, `dimensions`, `baseline_metrics`, `audit_result`, `diagnoses`, `confirmation`, `generalization_stats` (`progress_metrics`, `directions_tried` from base)

**evidence.ndjson phase-specific fields:**
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

**understanding.md — 9 sections (written by owning phase):**
1. Target & Baseline ← S_INTAKE | 2. Current State Survey ← S_SURVEY | 3. Audit Findings ← S_AUDIT
4. Root Cause Diagnosis ← S_DIAGNOSE | 5. Fix & Verification ← S_FIX+S_VERIFY
6. Generalization ← S_GENERALIZE | 7. Discoveries ← S_DISCOVER
8. Improvement Metrics ← S_RECORD (before/after) | 9. Engineering Learnings ← S_RECORD

### Pre-load（可选，缺失不阻塞）
- ARCHITECTURE.md → 模块边界 | `maestro search "<target>" --json` → 先前优化（top 5）
- `maestro load --type spec --category coding` + `--category debug` → 编码规范 + 已知模式
- `maestro search --category coding` → knowhow | `Glob(".workflow/scratch/*-improve-odyssey-*")` → 先前会话

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §9 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 性能 pattern | 瓶颈类型 + 修复方案 + 度量方法 | `/spec-add coding "..."` |
| 安全规则 | 漏洞类别 + 修复 + 预防方法 | `/spec-add debug "..."` |
| 架构约束 | 违反描述 + 正确边界 + 检查方法 | `/spec-add arch "..."` |
| 可靠性 pattern | 故障模式 + 处理策略 + 验证手段 | `/spec-add coding "..."` |
</context>

<csv_schema>

### Shared Output Schema (all waves)
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings": { "type": "string", "maxLength": 500 },
    "evidence": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination contract:** Call `report_agent_job_result` EXACTLY ONCE. Read-only. Do NOT modify source files, tasks.csv, wave-*.csv, results.csv, or call spawn_agents_on_csv.

### tasks.csv
```csv
id,title,description,task_type,dimension,deps,wave,status,findings,evidence,error
```

**Waves:**
| Wave | Tasks | Parallelism |
|------|-------|-------------|
| 1 | Survey (dependency-audit, complexity-scan) | 2 agents |
| 2 | Audit (performance, security, architecture, reliability, observability, maintainability) | 6 agents |
| 3 | Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) | 4 agents |
</csv_schema>

Self-iteration 适用阶段: S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE

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
  → S_INTAKE      WHEN no target                  DO request_user_input

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
**spawn_agents_on_csv (Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
"survey-deps","Dependency Audit","Analyze dependencies for {target_files}: package versions, known CVEs, unused deps, circular imports, dep depth. Return [{dep,version,issue_type,severity,detail}].","survey","","","1","pending","","",""
"survey-complexity","Complexity Scan","Measure complexity for {target_files}: cyclomatic complexity, function length, nesting depth, file size, export count. Return [{file,metric,value,threshold,status}].","survey","","","1","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-1-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge → evidence.ndjson (phase: "survey"). Extract `baseline_metrics` from survey results. Update `understanding.md` §2. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): SURVEY — 现状调查"`

### A_AUDIT
**spawn_agents_on_csv (Wave 2)** — 6 agents (one per dimension, or `--dimensions` subset):

Append Wave 2 rows to `tasks.csv`:
```csv
"audit-perf","Performance","Hot paths, N+1 queries, memory allocation, cache strategy, bundle analysis, lazy loading for {target_files}","audit","performance","","2","pending","","",""
"audit-security","Security","OWASP Top 10: injection, broken auth, data exposure, XXE, access control, misconfig, XSS, deserialization, deps, logging for {target_files}","audit","security","","2","pending","","",""
"audit-arch","Architecture","Layer boundaries, circular deps, coupling metrics, interface contracts, SRP compliance, dependency direction for {target_files}","audit","architecture","","2","pending","","",""
"audit-reliability","Reliability","Error handling completeness, retry logic, timeout config, circuit breakers, graceful degradation, resource cleanup for {target_files}","audit","reliability","","2","pending","","",""
"audit-observability","Observability","Logging coverage, structured logs, metrics emission, trace propagation, error reporting, health endpoints for {target_files}","audit","observability","","2","pending","","",""
"audit-maintain","Maintainability","Dead code, complex conditionals, test coverage gaps, magic numbers, naming clarity, doc debt for {target_files}","audit","maintainability","","2","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:6, max_runtime_seconds:600, output_csv_path:"wave-2-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge → evidence.ndjson (phase: "audit"). Write `session.json.audit_result` with dimensions audited, finding count, severity distribution.
Update `understanding.md` §3 (findings by dimension + severity matrix). Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): AUDIT — 多维审查"`

### A_DIAGNOSE
Root cause analysis for critical/high findings — don't fix symptoms.

1. Group by dimension, prioritize by severity. For each: hypothesis → trace code path + git history → evidence.ndjson (phase: "diagnosis")
2. **Decision journal**: ambiguity → evidence (phase: "decision"); Normal: request_user_input | `-y`: defer
3. **CLI-assisted** for complex findings: `maestro delegate --role analyze --mode analysis` to trace code path, check systemic pattern, identify fix approach. Execute `run_in_background: true`.
4. Write `session.json.diagnoses[]`. Update `understanding.md` §4. Mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): DIAGNOSE — 根因诊断"`

### A_ESCALATE_DIAGNOSIS
Increment retries. If < 3: broaden scope via `maestro delegate --role analyze`, form new hypotheses, return to S_DIAGNOSE. If >= 3: Normal → request_user_input (broaden/new/INCONCLUSIVE) | `-y` → auto INCONCLUSIVE, proceed to S_RECORD.

### A_FIX
Skip if `--skip-fix`. Implement improvements for diagnosed root causes.

1. **穷尽修复**: Fix ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify modified area — new findings append to current tier.
2. For each fix: implement → record evidence.ndjson (phase: "fix")
3. **Normal**: request_user_input per-fix confirmation. **`-y`**: auto-proceed, record `deferred`.

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-improve({slug}): FIX — 改进实现"`

### A_VERIFY
1. Run tests covering modified areas
2. Re-capture metrics, compare with `session.json.baseline_metrics`
3. **CLI-assisted**: `maestro delegate --role review --mode analysis` to check fix correctness, test regressions, measure impact vs baseline. Execute `run_in_background: true`.
4. `needs_rework` → S_FIX. `verified` → mark G4 done, advance.
5. Write `session.json.confirmation`. Update `understanding.md` §5 (before/after metrics table).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): VERIFY — 改进验证"`

### A_GENERALIZE
Skip if `--skip-generalize`. Pattern 来源: diagnoses + fixes。

**Step 1 — Multi-layer pattern extraction:**

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex patterns (direct Grep) | Missing `await`, unclosed resources, `catch {}` empty |
| Semantic | Agent anti-pattern scan | Unvalidated input, missing error boundary, no timeout |
| Structural | Architecture-level similarity | Same import structure, identical anti-pattern |
| Historical | Git log for pattern introduction | When pattern was introduced, if ever fixed |

Write `session.json.patterns[]`: `[{id, source_diagnosis, layer, signature, description, risk, fix_template}]`

**Step 2 — 4-agent scan (spawn_agents_on_csv, Wave 3):**

Append Wave 3 rows to `tasks.csv`:
```csv
"gen-syntax","Syntax Grep","Grep syntax-layer signatures '${signatures}' across project. Return [{file,line,context,risk_level,layer:'syntax',confidence}].","generalization","syntax","","3","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for anti-pattern: ${description}. Return [{file,line,context,risk_level,layer:'semantic',confidence}].","generalization","semantic","","3","pending","","",""
"gen-structural","Structural Match","Find structurally similar files to ${diagnosed_files}, check for same anti-pattern. Return [{file,line,description,risk,layer:'structural',confidence}].","generalization","structural","","3","pending","","",""
"gen-historical","Historical Grep","Run git log -S '${signature}' --oneline. Return [{sha,file,date,type:'introduced|fixed',context}].","generalization","historical","","3","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:4, max_runtime_seconds:300, output_csv_path:"wave-3-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

**Step 3 — Cross-layer dedup**: same file:line multi-layer → boost confidence | single-layer → `needs_review` | historical fixed → `regression_risk`

**Step 4 — Iterative deepening**: module ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Quality Gate** (self-iteration).

**Step 6:** Write `generalization_stats`: `{patterns_extracted, total_hits, cross_layer_confirmed, regression_risks, by_layer, deepening_triggered}`. Update §6. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): GENERALIZE — 泛化扫描"`

### A_DISCOVER
按 base A_DISCOVER 执行。Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): DISCOVER — 发现分类"`

### A_RECORD
1. **understanding.md §8**: Improvement metrics — before/after comparison table from baseline_metrics vs current
2. **understanding.md §9**: Engineering learnings — 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令
3. Mark G7 done. Pending decisions: **Normal** → request_user_input. **`-y`** → skip, show deferred count.
4. 其余按 base A_RECORD 执行。
5. `current_state = "COMPLETED"`. Emit completion summary: Target, Dimensions, Findings (C/H/M/L), Diagnosed count, Fix count + verified, Metrics (improved/regressed), Patterns (count + layer distribution), Scan hits (cross-layer), Issues created, Decisions (resolved/pending/deferred), Learnings count, Self-iter rounds, Cross-loops used, Goals (done/total/skipped).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): RECORD — 指标总结与知识沉淀"`

</actions>

<appendix>

### Goal Prompt Template
**⚠️ 仅在 A_INTAKE 完成后显示一次，A_RECORD 完成时不重复。**

列出所有非 skipped 的 phase_goals，附加收敛规则：
- 穷尽迭代至所有 findings 已处理（fix/issue/decision）且 `phase_goals_all_done=true`
- 修复按 severity 逐轮迭代，每轮 re-verify
- Baseline 修复前采集，修复后对比确认改进
- pending decision 必须 request_user_input，不允许"只报告不处理"

### `-y` Auto-Confirm Behavior
| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX improvement confirmation | request_user_input | auto-proceed, `deferred` |
| A_DIAGNOSE ambiguity | request_user_input | best-effort, `deferred` |
| A_ESCALATE 3-strike | request_user_input 3-way | auto INCONCLUSIVE |
| A_DISCOVER hit routing | request_user_input | auto create issue, `deferred` |
| A_DISCOVER ambiguous items | request_user_input | all `deferred` |
| A_RECORD pending decisions | request_user_input | skip, show deferred count |
| A_RECORD goal audit | request_user_input | auto accept |

`deferred` items shown as "待决策" in completion summary; recoverable via `-c`.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target or use -c |
| E002 | error | Target path not found | Check path |
| W001 | warning | No dependency manifest found | Proceed without dep audit |
| W002 | warning | Some dimension agents failed | Partial audit coverage |
</error_codes>

<success_criteria>
- [ ] Target resolved, baseline metrics captured
- [ ] Survey + 6-dimension audit with structured findings and severity matrix
- [ ] Root causes diagnosed for critical/high findings
- [ ] Improvements implemented and verified with before/after metrics (unless --skip-fix)
- [ ] Multi-layer generalization + cross-phase loops (unless --skip-generalize)
- [ ] Every unfixed finding has individual classification and reason
- [ ] understanding.md §8 (metrics) and §9 (learnings) completed
- [ ] phase_goals G1-G7 tracked and audited
- [ ] Session resumable via -c
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Security findings need deep investigation | `$odyssey-debug "<finding>"` |
| UI-related findings | `$odyssey-ui "<component>"` |
| Issues created from discoveries | `/manage-issue list --source improve-odyssey` |
| Architecture pattern to document | `/spec-add arch "..."` |
| Performance pattern to persist | `/spec-add coding "..."` |
| Want formal review of changes | `$odyssey-review-test-fix <changed-files>` |
| Decisions still pending | Filter evidence.ndjson phase=decision status=pending |
</next_step_routing>
