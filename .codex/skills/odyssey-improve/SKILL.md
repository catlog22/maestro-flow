---
name: odyssey-improve
description: Long-running codebase improvement cycle — multi-dimensional audit,
  deep diagnosis, targeted fix, verify, generalize, and engineering knowledge
  persistence
argument-hint: '"<target>" [--dimensions <list>] [--skip-fix]
  [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]'
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<base>@~/.maestro/workflows/odyssey-base-codex.md</base>

<required_reading>
Required reading: base (`odyssey-base-codex.md`) before any actions. Load and apply base invariants, execution discipline, and shared actions before proceeding.
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
survey → 6-dimension audit → diagnose → fix → verify → generalize → discover → persist.
Baseline-first, exhaustive iteration until zero remaining actionable findings.
</purpose>

<boundary>
**In scope:** Target code quality — performance/security/architecture/reliability/observability/maintainability audit → diagnose → fix → generalize.
**Out of scope:** UI → `$odyssey-ui` | Features → `$odyssey-planex` | Single bug → `$odyssey-debug` | Style review → `$odyssey-review-test-fix`
**Zero-residual:** Every finding MUST have action (fix/issue/decision). "Report and shelve" is forbidden.
</boundary>

<context>
$ARGUMENTS

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan |

**Flags:** `--dimensions <list>` subset of 6 | `--fix-threshold <severity>` fix cutoff (default: all) | `--skip-fix` audit+diagnose only | `--skip-generalize` skip generalize+discover | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Dimensions (6):**
1. **performance** — hot paths, N+1 queries, memory allocation, cache efficiency, bundle size, lazy loading
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulnerabilities, secrets
3. **architecture** — layer violations, circular dependencies, coupling metrics, interface contracts, SRP violations
4. **reliability** — error handling gaps, retry logic, timeout handling, graceful degradation, resource cleanup
5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks
6. **maintainability** — code complexity, dead code, test coverage gaps, documentation debt

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md`

**Output boundary**: ALL session artifacts MUST target the session directory (`{run_dir}/outputs/`) or `.workflow/state.json` only. Source code modifications during S_FIX are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json — improve-specific fields:**
```json
{ "target": "", "dimensions": [], "baseline_metrics": {},
  "audit_result": null, "diagnoses": [], "confirmation": null,
  "generalization_stats": null }
```

**evidence.ndjson phases:**
- `survey`: `category` (dependency|complexity|coverage|error_pattern), `detail`
- `audit`: `dimension`, `severity`, `measurement`
- `diagnosis`: `finding_ref`, `hypothesis`, `result` (confirmed|disproved|inconclusive), `root_cause`
- `fix`: `finding_ref`, `change_summary`, `risk`
- `discovery`: `file`, `line`, `classification` (safe|risk|issue), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status`, `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Diagnosis completed | S_DIAGNOSE | — |
| G4 | Zero remaining: all findings fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

**understanding.md — 9 sections:**
1. Target & Baseline ← S_INTAKE | 2. Current State Survey ← S_SURVEY | 3. Audit Findings ← S_AUDIT
4. Root Cause Diagnosis ← S_DIAGNOSE | 5. Fix & Verification ← S_FIX+S_VERIFY
6. Generalization ← S_GENERALIZE | 7. Discoveries ← S_DISCOVER
8. Improvement Metrics ← S_RECORD | 9. Engineering Learnings ← S_RECORD

**Knowledge Persistence categories (written to understanding.md section 9):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Performance pattern | Bottleneck type + fix + measurement | `/spec-add coding` |
| Security rule | Vulnerability class + fix + prevention | `/spec-add debug` |
| Architecture constraint | Violation + correct boundary + verification | `/spec-add arch` |
| Reliability pattern | Failure mode + handling strategy + validation | `/spec-add coding` |
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

<invariants>
Base invariants apply. Additional: baseline metrics captured before any fix; every fix re-verified against baseline.
</invariants>

<self_iteration>
Applies to: **S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE**. Logic in base.
</self_iteration>

<execution>
Follow base execution discipline completely. Actions defined in state_machine below.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: INTAKE → SURVEY**
- REQUIRED: Target resolved, SESSION_DIR created, session.json initialized with baseline_metrics.
- REQUIRED: phase_goals[] derived from flags.
- BLOCKED if: no target specified (E001) or target path not found (E002).

**GATE 2: SURVEY → AUDIT**
- REQUIRED: Current state survey completed — dependency audit, complexity scan.
- REQUIRED: Evidence phase=survey logged, understanding.md §2 updated, G1 marked done.
- BLOCKED if: survey incomplete — both scan types must be attempted.

**GATE 3: AUDIT → DIAGNOSE**
- REQUIRED: All dimension agents completed (or --dimensions subset), findings merged with severity classification.
- REQUIRED: audit_result written to session.json, understanding.md §3 with severity matrix, G2 marked done.
- BLOCKED if: zero dimensions reviewed (W002 partial is allowed, zero is not).

**GATE 4: DIAGNOSE → FIX**
- REQUIRED: Root causes identified for all critical/high findings with evidence.
- REQUIRED: diagnoses[] written, understanding.md §4 updated, G3 marked done.
- BLOCKED if: hypotheses failed 3 times without escalation decision.

**GATE 5: FIX → VERIFY**
- REQUIRED: ALL findings within fix_threshold fixed by severity tier (critical → high → medium → low).
- REQUIRED: Per-fix evidence phase=fix logged.
- BLOCKED if: tier incomplete — each tier must be fully addressed before advancing.

**GATE 6: VERIFY → GENERALIZE**
- REQUIRED: Tests pass, metrics re-captured, before/after comparison logged.
- REQUIRED: confirmation written, understanding.md §5 updated, G4 marked done.
- BLOCKED if: needs_rework → route back to S_FIX.

**GATE 7: GENERALIZE → DISCOVER**
- REQUIRED: ALL 3 layers (syntax/semantic/structural) attempted with evidence logged.
- REQUIRED: generalization_stats written with by_layer entries for all 3 layers, G5 marked done.
- BLOCKED if: any layer not attempted (thoroughness floor violation).

**GATE 8: DISCOVER → RECORD**
- REQUIRED: All hits triaged with per-item classification and reason.
- REQUIRED: remaining_actionable == 0 OR loops >= max_loops with per-item reasons logged, G6 marked done.
- BLOCKED if: unclassified hits remain.

</execution>

<state_machine>

<states>
S_INTAKE → S_SURVEY → S_AUDIT → S_DIAGNOSE → S_FIX → S_VERIFY → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME
S_INTAKE → S_SURVEY       : target resolved → A_INTAKE
S_INTAKE → S_INTAKE       : no target → request_user_input

S_SURVEY   → S_AUDIT        : complete

S_AUDIT → S_DIAGNOSE      : critical/high findings exist
S_AUDIT → S_GENERALIZE    : no critical/high, !skip_generalize
S_AUDIT → S_RECORD        : no findings OR skip_generalize

S_DIAGNOSE → S_FIX          : root causes identified, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : root causes identified, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : root causes identified, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : retries >= 3 → INCONCLUSIVE

S_FIX    → S_VERIFY       : fix implemented

S_VERIFY → S_GENERALIZE   : verified, !skip_generalize
S_VERIFY → S_RECORD       : verified, skip_generalize
S_VERIFY → S_FIX          : needs_rework

S_GENERALIZE → S_DISCOVER : hits found
S_GENERALIZE → S_RECORD   : no hits

S_DISCOVER → S_DIAGNOSE   : new critical issue → cross_phase_loops++
S_DISCOVER → S_FIX        : same-pattern fix, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD     : remaining_actionable == 0
S_DISCOVER → S_RECORD     : loops >= max_loops → log per-item reasons

S_RECORD   → END          : complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target, flags, `--dimensions` subset
2. Generate slug, create SESSION_DIR
3. `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load coding/debug
4. **Baseline capture**: Record current metrics (test pass rate, bundle size, dependency count, complexity hotspots) to `session.json.baseline_metrics`
5. Derive `phase_goals[]` from flags
6. Write `session.json` + `understanding.md` section 1, call `create_goal` with phase_goals as success_criteria

Commit: `"odyssey-improve({slug}): INTAKE — target parsed and baseline captured"`

### A_RESUME
Glob latest session → read `session.json` → jump to `current_state`.

### A_SURVEY
**spawn_agents_on_csv (Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
"survey-deps","Dependency Audit","Analyze dependencies for {target_files}: package versions, known CVEs, unused deps, circular imports, dep depth. Return [{dep,version,issue_type,severity,detail}].","survey","","","1","pending","","",""
"survey-complexity","Complexity Scan","Measure complexity for {target_files}: cyclomatic complexity, function length, nesting depth, file size, export count. Return [{file,metric,value,threshold,status}].","survey","","","1","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-1-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge → evidence.ndjson (phase: "survey"). Extract `baseline_metrics`. Update section 2. Mark G1.

Commit: `"odyssey-improve({slug}): SURVEY — current state survey"`

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

Merge → evidence.ndjson (phase: "audit"). Write `session.json.audit_result` with dimensions, finding count, severity distribution.
Update section 3. Mark G2.

Commit: `"odyssey-improve({slug}): AUDIT — multi-dimensional audit"`

### A_DIAGNOSE
Root cause analysis for critical/high findings.

1. Group by dimension, prioritize by severity. For each: hypothesis → trace code path + git history → evidence (phase: "diagnosis")
2. Ambiguity → evidence (phase: "decision"); Normal: request_user_input | `-y`: defer
3. Complex findings: `maestro delegate --to claude --mode analysis` (`run_in_background: true`)
4. Write `session.json.diagnoses[]`. Update section 4. Mark G3.

Commit: `"odyssey-improve({slug}): DIAGNOSE — root cause analysis"`

### A_ESCALATE_DIAGNOSIS
`retries++`. < 3: `maestro delegate --to claude --mode analysis`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → request_user_input | `-y` → INCONCLUSIVE → S_RECORD.

### A_FIX
Fix ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify modified area — new findings append to current tier.

For each fix: implement → evidence (phase: "fix"). Normal: request_user_input per-fix confirmation | `-y`: auto-proceed.

Commit: `"odyssey-improve({slug}): FIX — improvements implemented"`

### A_VERIFY
1. Run tests covering modified areas
2. Re-capture metrics, compare with `session.json.baseline_metrics`
3. `maestro delegate --to claude --mode analysis` (`run_in_background: true`) — check fix correctness, regressions, impact vs baseline
4. `needs_rework` → S_FIX. `verified` → mark G4.
5. Write `session.json.confirmation`. Update section 5.

Commit: `"odyssey-improve({slug}): VERIFY — improvements verified"`

### A_GENERALIZE
Base shared_actions. Improve overrides:
- Pattern source: diagnoses + fixes

**Wave 3 — spawn_agents_on_csv (4 agents):**

Append Wave 3 rows to `tasks.csv`:
```csv
"gen-syntax","Syntax Grep","Grep syntax-layer signatures '${signatures}' across project. Return [{file,line,context,risk_level,layer:'syntax',confidence}].","generalization","syntax","","3","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for anti-pattern: ${description}. Return [{file,line,context,risk_level,layer:'semantic',confidence}].","generalization","semantic","","3","pending","","",""
"gen-structural","Structural Match","Find structurally similar files to ${diagnosed_files}, check for same anti-pattern. Return [{file,line,description,risk,layer:'structural',confidence}].","generalization","structural","","3","pending","","",""
"gen-historical","Historical Grep","Run git log -S '${signature}' --oneline. Return [{sha,file,date,type:'introduced|fixed',context}].","generalization","historical","","3","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:4, max_runtime_seconds:300, output_csv_path:"wave-3-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Update section 6. Mark G5.

Commit: `"odyssey-improve({slug}): GENERALIZE — pattern scan"`

### A_DISCOVER, A_RECORD
Base shared_actions. Improve overrides:
- **A_RECORD** section 8: before/after comparison table from baseline_metrics vs current measurements
- **A_RECORD** section 9: learnings per Knowledge Persistence table. **Confirmation gate**: Before writing spec entries, present proposed entries to user via `request_user_input` for confirmation. Skip confirmation only if `-y` flag is set.

**Completion summary:**
```
--- IMPROVE ODYSSEY COMPLETE ---
Target:     {target}
Dimensions: {dimensions}
Findings:   {critical}/{high}/{medium}/{low}
Diagnosed:  {count}
Fixed:      {count} verified
Metrics:    {improved}/{regressed}
Patterns:   {count} ({by_layer})
Scan hits:  {total} ({cross_layer} confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} persisted
Self-iter:  {N} rounds across {M} stages
Cross-loops:{N} used
Goals:      {done}/{total} ({skipped} skipped)
---
```

</actions>

<appendix>

### `-y` improve-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX improvement confirmation | request_user_input | auto-proceed, deferred |
| A_DIAGNOSE ambiguity | request_user_input | best-effort, deferred |
| A_ESCALATE 3-strike | request_user_input | INCONCLUSIVE |

### Goal convergence rules

```
Exhaust all findings (fix/issue/decision) until remaining_actionable == 0
and phase_goals_all_done=true.
Fix by severity tier with re-verify per tier.
Baseline captured before fix, compared after to confirm improvement.
Pending decisions must request_user_input — no report-only.
```

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
- [ ] Survey + 6-dimension audit with severity matrix
- [ ] Root causes diagnosed for critical/high findings
- [ ] Improvements implemented and verified with before/after metrics (unless --skip-fix)
- [ ] Multi-layer generalization + cross-phase loops (unless --skip-generalize)
- [ ] Every unfixed finding individually classified with reason
- [ ] understanding.md sections 8-9 completed
- [ ] phase_goals G1-G7 tracked and audited
- [ ] Session resumable via -c
</success_criteria>

<next_step_routing>
<!-- suggest-only — do NOT auto-execute. Present these as suggestions to the user. -->
| Condition | Next |
|-----------|------|
| Security findings need deep investigation | `$odyssey-debug "<finding>"` |
| UI-related findings | `$odyssey-ui "<component>"` |
| Issues created from discoveries | `/manage-issue list --source improve-odyssey` |
| Architecture pattern to document | `/spec-add arch "..."` |
| Performance pattern to persist | `/spec-add coding "..."` |
| Formal review of changes | `$odyssey-review-test-fix <changed-files>` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
