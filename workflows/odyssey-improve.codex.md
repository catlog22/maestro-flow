<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Workflow: Odyssey Improve (Codex)

6-dimension runtime quality improvement — performance/security/architecture/reliability/observability/maintainability audit → diagnose → fix → generalize. Codex-adapted: uses `spawn_agents_on_csv`, `request_user_input`, `create_goal`/`update_goal`.

---

## State Chain

```
S_INTAKE → S_SURVEY → S_AUDIT → S_DIAGNOSE → S_FIX → S_VERIFY → [back-half]
```

Back-half: `S_GENERALIZE → S_DISCOVER → S_RECORD → END` (see odyssey-base-codex.md Shared Back-Half).

---

## Boundary

**In scope:** Runtime quality improvement — performance/security/architecture/reliability/observability/maintainability audit → diagnose → fix → generalize. **Out of scope:** UI visual → `--mode ui` | New features → `--mode planex` | Single bug → `--mode debug` | Style review → `--mode review`. Zero-residual applies.

---

## Context

### Target Resolution

| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan (use with caution) |

### Dimensions (6)

1. **performance** — hot paths, N+1, memory allocation, cache efficiency, bundle size, lazy loading
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulns, secrets
3. **architecture** — layer violations, circular deps, coupling, interface contracts, SRP
4. **reliability** — error handling gaps, retry, timeout, graceful degradation, resource cleanup
5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks
6. **maintainability** — cyclomatic complexity, dead code, test coverage gaps, doc debt

### Session Fields

```json
{ "target": "", "dimensions": [], "baseline_metrics": {},
  "audit_result": {}, "diagnoses": [], "confirmation": null,
  "generalization_stats": null }
```

### evidence.ndjson Phases

`survey|audit|diagnosis|fix|discovery|decision|self-iteration`

- `survey`: `category` (dependency|complexity|coverage|error_pattern), `detail`
- `audit`: `dimension`, `severity`, `measurement`
- `diagnosis`: `finding_ref`, `hypothesis`, `result`, `root_cause`
- `fix`: `finding_ref`, `change_summary`, `risk`

### phase_goals[]

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Diagnosis completed | S_DIAGNOSE | — |
| G4 | Zero remaining: all findings fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

### understanding.md — 9 Sections

1. Target & Baseline
2. Current State Survey
3. Audit Findings
4. Root Cause Diagnosis
5. Fix & Verification
6. Generalization
7. Discoveries
8. Improvement Metrics (before/after)
9. Engineering Learnings

---

## State Machine

### Transitions

```
S_SURVEY   → S_AUDIT       : complete
S_AUDIT → S_DIAGNOSE       : critical/high findings exist
S_AUDIT → S_GENERALIZE     : no critical/high, !skip_generalize
S_AUDIT → S_RECORD         : no findings OR skip_generalize
S_DIAGNOSE → S_FIX         : root causes identified, !skip_fix
S_DIAGNOSE → S_GENERALIZE  : root causes identified, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD      : root causes identified, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE    : hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD      : retries >= 3 → INCONCLUSIVE
S_FIX      → S_VERIFY      : fix implemented
S_VERIFY → S_GENERALIZE    : verified, !skip_generalize
S_VERIFY → S_RECORD        : verified, skip_generalize
S_VERIFY → S_FIX           : needs_rework
```

### Actions

**A_INTAKE extra** — Baseline capture: record current metrics (test pass rate, bundle size, dependency count, complexity hotspots) to `session.json.baseline_metrics`. `create_goal({ description: "Improve: {target} across {dimensions}", condition: "所有 phase gates 通过 + END 状态" })`

**A_SURVEY** — (1) Dependency audit (package.json/lock), complexity scan (size/nesting), test coverage map, error handling scan (empty catch, unhandled promise). (2) CLI-assisted (optional): `maestro delegate --role analyze --mode analysis` for dependency health / complexity hotspots / coverage gaps / error patterns (`run_in_background: true`). (3) Evidence phase=survey. Update §2. `update_goal({ id: G1, status: "completed" })`.

Commit: `"odyssey-improve({slug}): SURVEY — current state survey complete"`

**A_AUDIT** — 6-dimension parallel audit via CSV wave (or `--dimensions` subset).

Generate `audit-dimensions.csv`:

```csv
id,dimension,focus,target_files,status,findings_json,error
"1","performance","hot paths, N+1, memory allocation, cache efficiency, bundle size, lazy loading","${target}","","",""
"2","security","OWASP Top 10, injection, auth bypass, data exposure, dependency vulns, secrets","${target}","","",""
"3","architecture","layer violations, circular deps, coupling, interface contracts, SRP","${target}","","",""
"4","reliability","error handling gaps, retry, timeout, graceful degradation, resource cleanup","${target}","","",""
"5","observability","logging coverage, metric gaps, trace propagation, error reporting, health checks","${target}","","",""
"6","maintainability","cyclomatic complexity, dead code, test coverage gaps, doc debt","${target}","","",""
```

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/audit-dimensions.csv`,
  id_column: "id",
  instruction: "You are auditing code quality for a specific dimension. Read the 'dimension' and 'focus' columns. Scan target files in the 'target_files' column, identify issues. Return: findings_json as a JSON array [{title, severity, dimension, file, line, description, suggestion, measurement}]. Severity levels: critical, high, medium, low. Be thorough — check all files in scope for this dimension.",
  max_concurrency: 6,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/audit-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings_json, error }
})
```

Merge results from all dimensions → evidence phase=audit. Write `session.json.audit_result`. Update §3 (findings by dimension + severity matrix). `update_goal({ id: G2, status: "completed" })`.

**GATE: all-dimensions-audited** — all 6 dimensions (or `--dimensions` subset) completed with structured findings, merged into severity matrix, evidence phase=audit logged per dimension. Zero dimensions reviewed is BLOCKED (W002 partial from agent failure is a warning).

Commit: `"odyssey-improve({slug}): AUDIT — dimension audit complete"`

**A_DIAGNOSE** — Root cause analysis for critical/high findings — don't fix symptoms. (1) Group by dimension, prioritize by severity; for each: hypothesis → trace code path + git history → evidence phase=diagnosis. (2) Ambiguity → evidence phase=decision; Normal: `request_user_input` | `-y`: defer. (3) CLI-assisted for complex findings (`run_in_background: true`). (4) Write `session.json.diagnoses[]`. Update §4. `update_goal({ id: G3, status: "completed" })`.

Commit: `"odyssey-improve({slug}): DIAGNOSE — root cause analysis complete"`

**A_ESCALATE_DIAGNOSIS** — `retries++`. < 3: `maestro delegate --role analyze`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → `request_user_input` | `-y` → INCONCLUSIVE → S_RECORD.

**A_FIX** — (1) Exhaustive fix: ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify **current tier's dimension only** (not all dimensions); new findings at same or higher severity append to current tier. Cross-dimension regression checks run once at S_VERIFY after all tiers. **No partial-tier advancement** — each tier fully addressed (fixed or individually classified) before advancing; blanket "pre-existing" skip forbidden. (2) For each fix: implement → evidence phase=fix. (3) Normal: `request_user_input` per-fix | `-y`: auto-proceed, record `deferred`.

Commit: `"odyssey-improve({slug}): FIX — {dimension} {tier} tier addressed"`

**A_VERIFY** — (1) Run tests covering modified areas. (2) Re-capture metrics, compare with `baseline_metrics`. (3) CLI-assisted: `maestro delegate --role review --mode analysis` (`run_in_background: true`). (4) `needs_rework` → S_FIX; `verified` → `update_goal({ id: G4, status: "completed" })`. (5) Write `confirmation`. Update §5 (before/after metrics table).

**GATE: zero-remaining-verified** — every diagnosed finding is fixed and verified, individually classified (issue / decision), or skipped via `--skip-fix`; tests pass over modified areas; metrics re-captured and compared against `baseline_metrics`; no unaddressed actionable findings; before/after table written to understanding.md §8.

Commit: `"odyssey-improve({slug}): VERIFY — fix verification complete"`

---

## Generalize Source

Diagnosed root causes + applied fixes across all dimensions. **Discover routing:** `bug` → S_FIX; new critical → S_DIAGNOSE.

---

## Knowledge Persistence (§9)

A_RECORD extra: §8 improvement metrics — re-capture and build before/after comparison table from `baseline_metrics` vs current.

| Category | Content | Follow-up |
|----------|---------|-----------|
| Performance pattern | Bottleneck type + fix approach + measurement | `/spec add coding` |
| Security rule | Vulnerability class + fix + prevention | `/spec add debug` |
| Architecture constraint | Violation + correct boundary + check | `/spec add arch` |
| Reliability pattern | Failure mode + handling strategy + verification | `/spec add coding` |

---

## Completion Summary

```
--- IMPROVE ODYSSEY COMPLETE ---
Target:      {target}
Dimensions:  {dimensions}
Findings:    {critical}C / {high}H / {medium}M / {low}L
Diagnosed:   {count}
Fixed:       {count} ({verified} verified)
Metrics:     {improved} improved / {regressed} regressed
Patterns:    {count} ({by_layer})
Scan hits:   {total} ({cross_layer_confirmed} confirmed)
Issues:      {N} created
Decisions:   {N} resolved, {M} pending, {K} deferred
Learnings:   {N} persisted
Self-iter:   {N} rounds across {M} stages
Cross-loops: {N}
Goals:       {done}/{total} ({skipped} skipped)
---
```

---

## Mode `-y` Points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX confirmation | `request_user_input` | auto-proceed `deferred` |
| A_DIAGNOSE ambiguity | `request_user_input` | best-effort `deferred` |
| A_ESCALATE 3-strike | `request_user_input` | auto INCONCLUSIVE |
| A_DISCOVER routing | `request_user_input` | auto create issue |
| Ambiguous items | `request_user_input` | all `deferred` |

---

## Phase Gates

- **Discovery gate** (SURVEY): evidence for the phase logged, understanding.md updated. Survey requires all scan types attempted.
- **Audit gate** (DIAGNOSE): all dimension agents completed, findings merged with severity classification. Zero dimensions reviewed is BLOCKED (W002 partial allowed).
- **FIX gate:** current severity tier fully addressed. Per-fix evidence phase=fix logged. Auto-commit per tier. No partial-tier advancement.
- **VERIFY gate:** tests pass; metrics re-captured; confirmation written, understanding.md updated, verify goal marked. needs_rework → route back to FIX.

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target provided | Provide target or -c |
| E002 | error | Target path not found | Check path |
| W001 | warning | No dependency manifest / no test coverage tool | Proceed with defaults |
| W002 | warning | Some dimension agents failed | Partial coverage accepted |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD |
| W005 | warning | Pending decisions | Filter evidence phase=decision |

---

## Success Criteria

- [ ] Target resolved; session + output files created; baseline metrics captured
- [ ] Survey completed with all scan types attempted (dependency, complexity, coverage, error handling)
- [ ] 6-dimension audit completed via `spawn_agents_on_csv` with structured findings + severity matrix
- [ ] understanding.md sections written progressively (§1-§9)
- [ ] Fix + verify (unless --skip-fix); zero-residual — every finding has concrete action
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize)
- [ ] phase_goals derived, tracked, and hardened-audited; Goal Prompt once
- [ ] §8 improvement metrics: before/after comparison table from baseline_metrics
- [ ] Session resumable via -c; completion summary emitted

---

## Next Step Routing

| Condition | Next |
|-----------|------|
| Discovery issues created | `/manage issue list --source improve-odyssey` |
| Deeper debug needed | `/odyssey <finding> --mode debug` |
| Formal review of changes | `/odyssey <changed-files> --mode review` |
| UI-related findings | `/odyssey <component> --mode ui` |
| Document pattern | `/learn decompose <module>` |
| Second opinion | `/learn consult <understanding.md>` |
| Design/perf/arch pattern to persist | `/spec add coding\|arch "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
