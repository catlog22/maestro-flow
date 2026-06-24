---
name: odyssey-improve
description: "Long-running codebase improvement cycle — multi-dimensional audit, deep diagnosis, targeted fix, verify, generalize, and engineering knowledge persistence"
argument-hint: '"<target>" [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]'
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Deep codebase improvement: survey (dependency + complexity baseline) -> audit (6 dimensions) ->
diagnose (root cause analysis) -> fix -> verify -> generalize -> discover -> record.

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
**范围内:** 目标代码运行质量提升 — 性能/安全/架构/可靠性/可观测性/可维护性
**范围外:** UI → `$odyssey-ui` | 新功能 → `$odyssey-planex` | 单一 bug → `$odyssey-debug` | 代码审查 → `$odyssey-review-test-fix`
**探索自由度:** profiling、安全扫描、架构分析、依赖审计，在约束下尽可能发现深层问题

**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
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
3. **多 CLI 辅助** — `maestro delegate` 多 `--role`（analyze/review/explore）交叉验证关键判断
</execution_discipline>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Module/directory path | Analyze those source files |
| Package name | Resolve to source directory |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` (source files only) |
| Feature area keyword | Grep for keyword, collect relevant source files |

**Flags:**
| Flag | Effect |
|------|--------|
| `--dimensions <list>` | Comma-separated subset (default: all 6) |
| `--skip-fix` | Audit-only — skip S_FIX and S_VERIFY |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER |
| `--auto` | CLI delegates without confirmation |
| `-y` | Auto-confirm at all decision points (see appendix) |
| `-c` | Resume most recent session |

**Dimensions (6):**
1. **performance** — hot paths, N+1 queries, memory leaks, cache misses, bundle size
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulns
3. **architecture** — layer violations, circular deps, coupling, interface design, SRP
4. **reliability** — error handling, retry logic, timeout config, graceful degradation, resource cleanup
5. **observability** — logging coverage, metrics, traces, error reporting, health checks
6. **maintainability** — cyclomatic complexity, dead code, coverage gaps, doc debt

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-improve-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + baseline + audit_result + diagnoses + patterns + phase_goals
  ├── evidence.ndjson    # ALL evidence (phase: survey|audit|diagnose|fix|discovery|decision|self-iteration)
  └── understanding.md   # 9-section evolving narrative (§1-§9, one per major phase)
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
  "generalization_stats": null,
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson:** `{"ts":"","phase":"survey|audit|diagnose|fix|discovery|decision|self-iteration","type":"","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":"","metrics":{}}`

**phase_goals[] — auto-derived from flags:**

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Diagnosis completed | S_DIAGNOSE | — |
| G4 | Fix applied and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

Lifecycle: `pending -> done | skipped | failed` (all set `completion_confirmed`)

**understanding.md — 9 sections:**
§1 Target & Baseline (S_INTAKE) | §2 Survey (S_SURVEY) | §3 Audit Findings (S_AUDIT) |
§4 Root Cause Diagnosis (S_DIAGNOSE) | §5 Fix & Verification (S_FIX+S_VERIFY) |
§6 Generalization (S_GENERALIZE) | §7 Discoveries (S_DISCOVER) |
§8 Improvement Metrics (S_RECORD) | §9 Engineering Learnings (S_RECORD)

### Pre-load

| Layer | Command | Purpose |
|-------|---------|---------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | Module boundaries |
| Wiki search | `maestro search "<target keywords>" --json` | Prior investigations (top 5) |
| Specs | `maestro load --type spec --category coding --keyword "<target>"` | Coding conventions |
| Debug specs | `maestro load --type spec --category debug` | Known issues, workarounds |
| Role knowledge | `maestro search --category arch` -> select -> `maestro load --type knowhow --id <id>` | Domain knowledge |
| Prior sessions | `Glob(".workflow/scratch/*-improve-odyssey-*")` | Related sessions |

### Knowledge Persistence (two-step model)

Write to understanding.md §9 during execution (temporary). Completion summary suggests follow-up commands.

| Category | Content | Follow-up |
|----------|---------|-----------|
| Recurring root cause | Pattern + trigger + fix template | `$spec-add debug "..."` |
| Non-obvious workaround | Problem + solution + scope | `$spec-add learning "..."` |
| Architecture violation | Violation + correct boundary + check method | `$spec-add arch "..."` |
| Reusable pattern | Pattern signature + risk + fix template | `$spec-add coding "..."` |

**Two-step:** Execute writes to output files (temporary) -> completion suggests permanent knowledge capture commands. No external skill calls during execution.
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient -> re-enter (max **3 rounds**).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files/modules analyzed | Missed targets discoverable via grep/glob |
| Depth | >=80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more directories, deeper dependency analysis, additional delegate angles). Round 2 = shift perspective (different CLI tool, reverse trace, manual code reading). Round 3 = combine both + targeted deep-dive on remaining gaps.

**Applicable stages:** S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE

**Exit:** All sufficient -> advance | 3-round cap -> record gap, continue. Logged to `evidence.ndjson` + `session.json.self_iteration_log[]`.
</self_iteration>

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

<invariants>
1. **Measure before improve** — baseline metrics MUST precede any fix
2. **Root cause over symptom** — NO FIX without diagnosis evidence
3. **Evidence append-only** — evidence.ndjson is never overwritten
4. **Session is source of truth** — session.json holds all state
5. **Phase goal tracking** — each stage MUST mark its goal on completion
6. **`-y` defers, never drops** — auto-confirm records `deferred`, never silently skips
7. **CLI delegate is background** — all `maestro delegate` calls use run_in_background
8. **Goal is outcome-oriented** — odyssey outputs prompt then continues
9. **Verify improvement** — post-fix metrics MUST be compared with baseline
10. **Decision journal integrity** — all human-judgment items recorded phase=decision
11. **Resumable state** — current_state saved at every transition
12. **Invariant violation = BLOCK** — violating any invariant blocks the operation
</invariants>

<execution>

**States:** S_INTAKE -> S_SURVEY -> S_AUDIT -> S_DIAGNOSE -> S_FIX -> S_VERIFY -> S_GENERALIZE -> S_DISCOVER -> S_RECORD
- S_FIX/S_VERIFY skip when `--skip-fix`
- S_GENERALIZE/S_DISCOVER skip when `--skip-generalize`

**Cross-phase loops:**
- S_DIAGNOSE -> S_DIAGNOSE (hypothesis retry, max 3)
- S_VERIFY -> S_FIX (rework on failed verification)
- S_DISCOVER -> S_DIAGNOSE (new critical issue found, cross_phase_loops++)
- S_DISCOVER -> S_FIX (same-pattern fix with template)
- S_DISCOVER -> S_RECORD       : triage complete AND remaining_actionable == 0
- S_DISCOVER -> S_RECORD       : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

### S_INTAKE
1. Parse target + flags -> resolve file list
2. Generate slug, create `SESSION_DIR`
3. Search prior knowledge: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load (coding, debug)
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` §1
6. Display Goal Prompt (appendix), continue without blocking

**Resume (`-c`):** Glob latest session -> read `session.json` -> restore `current_state` -> jump.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_INTAKE — 目标解析"`

### S_SURVEY
**spawn_agents_on_csv (Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
"survey-deps","Dependency Audit","Analyze dependencies for {target_files}: package versions, known CVEs, unused deps, circular imports, dep depth. Return [{dep,version,issue_type,severity,detail}].","survey","","","1","pending","","",""
"survey-complexity","Complexity Scan","Measure complexity for {target_files}: cyclomatic complexity, function length, nesting depth, file size, export count. Return [{file,metric,value,threshold,status}].","survey","","","1","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-1-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge -> evidence.ndjson (phase: "survey"). Extract `baseline_metrics` from survey results. Update §2. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_SURVEY — 调查"`

### S_AUDIT
**spawn_agents_on_csv (Wave 2)** — 6 agents (one per dimension):

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

Merge -> evidence.ndjson (phase: "audit"). Write `audit_result` with dimensions audited, finding count, severity distribution. Update §3. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_AUDIT — 审查"`

### S_DIAGNOSE
Root cause analysis for top audit findings (severity >= high).

1. **Rank findings** from audit, group by root cause pattern
2. **CLI deep analysis** for top finding clusters:
```bash
maestro delegate "PURPOSE: Root cause analysis for codebase quality issues in {target}
TASK: Trace origin of each finding | Identify shared root causes | Map dependency chains | Assess blast radius
MODE: analysis
CONTEXT: @{target_files} | Audit findings: {top_findings_json}
EXPECTED: JSON [{finding_ids, root_cause, origin_file, origin_line, blast_radius, fix_approach, confidence}]
CONSTRAINTS: Trace to origin, not just symptoms | Group related findings
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

3. **Hypothesis testing**: for each root cause — design verification -> execute -> evidence (phase: "diagnose")
4. **Decision journal**: ambiguity -> evidence (phase: "decision"); Normal: request_user_input | `-y`: defer
5. **Confirmed diagnoses** -> `session.json.diagnoses[]`: `[{id, finding_ids, root_cause, evidence_refs, confidence, fix_approach}]`

**Escalation (3-strike):** Hypothesis fails -> retry with broader scope via `maestro delegate --role explore`. After 3 retries: Normal -> request_user_input | `-y` -> mark INCONCLUSIVE, proceed.

Update §4. Mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_DIAGNOSE — 诊断"`

### S_FIX
Skip if `--skip-fix`.

1. Present diagnoses + proposed fixes, prioritized by blast radius. Normal: `request_user_input` to confirm. `-y`: auto proceed.
2. Implement fixes in priority order (highest blast radius first)
3. Record each fix in evidence (phase: "fix" + "decision")
4. Update §5

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-improve({slug}): S_FIX — 修复"`

### S_VERIFY
Skip if `--skip-fix`.

1. **Tests**: auto-detect framework, run covering tests on modified files
2. **CLI fix review**:
```bash
maestro delegate "PURPOSE: Verify improvement fixes for: {target}
TASK: Check correctness | Assess regression risk | Verify no new issues introduced | Compare metrics
MODE: analysis
CONTEXT: @{modified_files} | Diagnoses: {summary} | Diff: {git_diff} | Baseline: {baseline_metrics}
EXPECTED: JSON {verdict, findings [{severity, description, suggestion}], regression_risk, metrics_comparison}
CONSTRAINTS: Focus on correctness and measurable improvement
" --role review --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

3. **Metrics comparison**: measure post-fix metrics, compare with `baseline_metrics`
4. `needs_rework` -> S_FIX (loop). `confirmed` -> mark G4 done, advance
5. Update §5 with before/after metrics

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_VERIFY — 验证"`

### S_GENERALIZE
Skip if `--skip-generalize`. Extract patterns from confirmed diagnoses, scan for siblings.

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

**Step 3 — Cross-layer dedup**: same file:line multi-layer -> boost confidence | single-layer -> `needs_review` | historical fixed -> `regression_risk`

**Step 4 — Iterative deepening**: module >= 3 hits -> targeted deep scan (max 1 round).

**Step 5 — Quality Gate** (self-iteration).

**Step 6:** Write `generalization_stats`: `{patterns_extracted, total_hits, cross_layer_confirmed, regression_risks, by_layer, deepening_triggered}`. Update §6. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_GENERALIZE — 泛化"`

### S_DISCOVER
Skip if no generalization hits.

1. **Triage** each hit: read +-10 lines -> classify `safe` / `risk` / `bug` / `issue`
2. **Route**:
   - `bug`/`issue` + directly fixable → **fix immediately** → back to S_FIX
   - `bug`/`issue` + requires cross-module/architectural decision → create issue (with fix suggestion + impact analysis)
   - `risk` → evaluate if guard/validation can mitigate directly; if yes, fix it
   - `safe` → mark skip
   See appendix for `-y` behavior. Append evidence (phase: "discovery" + "decision")
3. **Cross-phase loop**:
   - Discovery finds new critical issue → S_DIAGNOSE (cross_phase_loops++)
   - Same-pattern with fix template → S_FIX (!skip_fix)
   - S_DISCOVER → S_RECORD: triage complete AND remaining_actionable == 0
   - S_DISCOVER → S_RECORD: loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)
4. Update §7. Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_DISCOVER — 发现"`

### S_RECORD
1. Finalize §8: before/after metrics comparison table
2. Write §9: structured by Knowledge Persistence table (temporary)
3. Mark G7 done. Pending decisions: **Normal** -> `request_user_input`. **`-y`** -> skip, show deferred count
4. **Goal audit**: all confirmed -> `phase_goals_all_done = true`. Any false: **Normal** -> `request_user_input` (回退/跳过/接受). **`-y`** -> auto accept
5. **Completion**: `current_state = "COMPLETED"`, emit summary:
```
--- IMPROVE ODYSSEY COMPLETE ---
Target:      {target}
Dimensions:  {audited_list}
Baseline:    {baseline_summary}
Audit:       {C}C {H}H {M}M {L}L across {dim_count} dimensions
Diagnoses:   {N} root causes ({confirmed} confirmed, {inconclusive} inconclusive)
Fix:         {F} applied, {S} skipped | Before: {baseline} -> After: {post_fix}
Patterns:    {N} extracted ({by_layer} distribution)
Scan:        {total} hits ({cross_layer} cross-layer confirmed)
Issues:      {N} created
Decisions:   {resolved}/{pending}/{deferred}
Self-iter:   {R} quality gate rounds across {P} stages
Goals:       {done}/{total} ({skipped} skipped)
---
```
**Next steps:** `$manage-issue list --source improve-odyssey`, `$learn-decompose <module>`,
`$quality-review`, `$learn-second-opinion <understanding.md>`, `$learn-investigate "<question>"`

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-improve({slug}): S_RECORD — 总结"`
</execution>

<appendix>

### Goal Prompt Template

**Time guard: display ONCE after S_INTAKE completes (session created, before survey). NEVER redisplay at S_RECORD completion.**

```
Improve Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 穷尽迭代：直到所有 findings 均已处理（fix/issue/decision）
且 phase_goals_all_done=true 才停。修复按 severity 逐轮迭代，每轮修复后 re-verify。
Baseline metrics 必须在修复前采集，修复后必须与 baseline 对比。
不允许"只报告不处理"。遇到 phase=decision 的 pending 必须 request_user_input。
```

Odyssey outputs prompt then continues without blocking. `/goal` entered by user at any time.

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` mode |
|----------------|--------|-----------|
| S_DIAGNOSE ambiguity | request_user_input blocks | record `deferred`, best-effort continue |
| S_DIAGNOSE 3-strike | request_user_input 3-way | auto INCONCLUSIVE |
| S_FIX fix direction | request_user_input confirm | auto proceed by priority |
| S_DISCOVER bug triage | request_user_input per hit | auto create issue |
| S_DISCOVER ambiguous | request_user_input batch | all `deferred` |
| S_RECORD pending decisions | request_user_input per-item | skip, show deferred count |

`deferred` items shown as "待决策" in summary; recoverable via `-c`.

### Phase Goal Lifecycle

`pending -> done (confirmed=true)` normal | `pending -> skipped (confirmed=true)` flags/manual | `pending -> failed (confirmed=false)` incomplete

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target and no session to resume | Provide target or use -c |
| E002 | error | Target not found or no source files | Check path, ensure source files exist |
| E003 | error | Resume but no session found | Start new session |
| W001 | warning | No relevant git history | Proceed with limited context |
| W002 | warning | Audit dimension agent failed | Partial coverage, note gap |
| W003 | warning | Generalization scan 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved to source files, session created with 3 output files
- [ ] Prior knowledge searched (maestro search + sessions + architecture + specs)
- [ ] Survey via spawn Wave 1, baseline_metrics extracted, evidence phase=survey
- [ ] All 6 dimensions audited via spawn Wave 2, severity matrix produced
- [ ] Root causes diagnosed with evidence refs, hypotheses tested phase=diagnose
- [ ] Fixes applied priority-order and verified with metric comparison (unless --skip-fix)
- [ ] `--skip-fix`: no source code modifications
- [ ] Generalization via spawn Wave 3 + cross-layer dedup (unless --skip-generalize)
- [ ] Discoveries classified and routed (fix/issue/decision/skip)
- [ ] understanding.md tracks all 9 sections progressively
- [ ] phase_goals G1-G7 derived from flags, each phase marks its goal
- [ ] Goal Prompt displayed once; `-y` auto-resolves/defers
- [ ] State saved at each transition (resumable via -c)
- [ ] Quality Gate self-iteration logged in self_iteration_log
- [ ] Before/after metrics comparison in completion summary
- [ ] Completion summary with all stats
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
</success_criteria>
