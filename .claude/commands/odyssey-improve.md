---
name: odyssey-improve
description: Long-running codebase improvement cycle — multi-dimensional audit, deep diagnosis, targeted fix, verify, generalize, and engineering knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--fix-threshold <severity>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
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
<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
survey → 6-dimension audit → diagnose → fix → verify → generalize → discover → persist.
Exhaustive iteration until zero remaining actionable findings.
</purpose>

<boundary>
**In scope:** Runtime quality improvement — performance/security/architecture/reliability/observability/maintainability audit → diagnose → fix → generalize.
**Out of scope:** UI visual → `/odyssey-ui` | New features → `/odyssey-planex` | Single bug → `/odyssey-debug` | Style review → `/odyssey-review-test-fix`
**Exploration freedom:** Free exploration within boundary — profiling, security scanning, architecture analysis, dependency audit.
**Zero-residual:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason.
</boundary>

<context>
$ARGUMENTS

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan (use with caution) |

**Flags:** `--dimensions <list>` dimension subset | `--fix-threshold <severity>` fix cutoff (default: all) | `--skip-fix` audit+diagnose only | `--skip-generalize` skip S_GENERALIZE+S_DISCOVER | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Dimensions (6):**
1. **performance** — hot paths, N+1 queries, memory allocation, cache efficiency, bundle size, lazy loading
2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulnerabilities, secrets
3. **architecture** — layer violations, circular dependencies, coupling metrics, interface contracts, SRP violations
4. **reliability** — error handling gaps, retry logic, timeout handling, graceful degradation, resource cleanup
5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks
6. **maintainability** — code complexity (cyclomatic), dead code, test coverage gaps, documentation debt

**Session**: `.workflow/scratch/{YYYYMMDD}-improve-odyssey-{slug}/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md`

**Output boundary**: ALL file writes MUST target the session directory (`.workflow/scratch/{YYYYMMDD}-improve-odyssey-{slug}/`) or `.workflow/state.json` only. Source code modifications during S_FIX are in-scope but MUST be committed per action. NEVER write artifacts outside these paths.

**session.json — improve-specific fields:**
```json
{ "target": "", "dimensions": [], "baseline_metrics": {},
  "audit_result": {}, "diagnoses": [], "confirmation": null,
  "generalization_stats": null }
```

**evidence.ndjson phases:** `survey|audit|diagnosis|fix|discovery|decision|self-iteration`
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
| G4 | Zero remaining: all findings fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

**understanding.md — 9 sections:**
1. Target & Baseline ← S_INTAKE | 2. Current State Survey ← S_SURVEY | 3. Audit Findings ← S_AUDIT
4. Root Cause Diagnosis ← S_DIAGNOSE | 5. Fix & Verification ← S_FIX+S_VERIFY
6. Generalization ← S_GENERALIZE | 7. Discoveries ← S_DISCOVER
8. Improvement Metrics ← S_RECORD (before/after) | 9. Engineering Learnings ← S_RECORD

**Knowledge Persistence categories (§9):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Performance pattern | Bottleneck type + fix approach + measurement method | `/spec-add coding` |
| Security rule | Vulnerability class + fix + prevention method | `/spec-add debug` |
| Architecture constraint | Violation description + correct boundary + check method | `/spec-add arch` |
| Reliability pattern | Failure mode + handling strategy + verification method | `/spec-add coding` |
</context>

<invariants>
All invariants (evidence append-only, session-as-state, phase goal tracking, auto-commit, zero-residual) defined in base.
6. **Generalize is mandatory** — S_GENERALIZE and S_DISCOVER execute unless `skip_generalize == true`. "All verified" or context pressure are NOT valid reasons to skip. The phase itself determines whether patterns exist.
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
- REQUIRED: Current state survey completed — dependency audit, complexity scan, test coverage map, error handling scan.
- REQUIRED: Evidence phase=survey logged, understanding.md §2 updated, G1 marked done.
- BLOCKED if: survey incomplete — all 4 scan types must be attempted.

**GATE 3: AUDIT → DIAGNOSE**
- REQUIRED: All dimension agents completed (or --dimensions subset), findings merged with severity classification.
- REQUIRED: audit_result written to session.json, understanding.md §3 with severity matrix, G2 marked done.
- BLOCKED if: zero dimensions reviewed (W002 partial is allowed, zero is not).

**GATE 4: DIAGNOSE → FIX**
- REQUIRED: Root causes identified for all critical/high findings with evidence.
- REQUIRED: diagnoses[] written, understanding.md §4 updated, G3 marked done.
- BLOCKED if: hypotheses failed 3 times without escalation decision (A_ESCALATE_DIAGNOSIS).

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
- REQUIRED: remaining_actionable == 0 OR loops >= max_loops with per-item reasons logged.
- REQUIRED: G6 marked done.
- BLOCKED if: unclassified hits remain.

</execution>

<state_machine>

<states>
S_INTAKE → S_SURVEY → S_AUDIT → S_DIAGNOSE → S_FIX → S_VERIFY → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE      : -c + session found → A_RESUME
S_INTAKE → S_SURVEY      : target resolved → A_INTAKE
S_INTAKE → S_INTAKE      : no target → AskUserQuestion

S_SURVEY   → S_AUDIT       : complete

S_AUDIT → S_DIAGNOSE     : critical/high findings exist
S_AUDIT → S_GENERALIZE   : no critical/high, !skip_generalize
S_AUDIT → S_RECORD       : no findings OR skip_generalize

S_DIAGNOSE → S_FIX          : root causes identified, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : root causes identified, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : root causes identified, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : retries >= 3 → INCONCLUSIVE

S_FIX      → S_VERIFY      : fix implemented

S_VERIFY → S_GENERALIZE   : verified, !skip_generalize
S_VERIFY → S_RECORD       : verified, skip_generalize
S_VERIFY → S_FIX          : needs_rework

S_GENERALIZE → S_DISCOVER   : hits found
S_GENERALIZE → S_RECORD     : all 3 layers scanned with evidence, total_hits == 0

S_DISCOVER → S_DIAGNOSE     : new critical issue → cross_phase_loops++
S_DISCOVER → S_FIX          : same-pattern fix, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → MUST log per-item reasons

S_RECORD   → END            : complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target description, flags, `--dimensions` subset
2. Generate slug, create `SESSION_DIR`
3. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load coding/debug
4. **Baseline capture**: Record current metrics (test pass rate, bundle size, dependency count, complexity hotspots) to `session.json.baseline_metrics`
5. Derive `phase_goals[]` from flags
6. Write `session.json` + `understanding.md` §1, emit Goal Prompt

Commit: `"odyssey-improve({slug}): INTAKE — parse target and capture baseline"`

### A_RESUME
Glob latest session → read `session.json` → display summary → jump to `current_state`.

### A_SURVEY
Current state survey — understand what exists before proposing changes.

1. Dependency audit (package.json/lock), complexity scan (size/nesting), test coverage map, error handling scan (empty catch, unhandled promise)
2. **CLI-assisted** (optional): `maestro delegate --role analyze --mode analysis` for dependency health, complexity hotspots, coverage gaps, error patterns. Execute `run_in_background: true`.
3. Evidence phase=survey. Update §2. Mark G1.

Commit: `"odyssey-improve({slug}): SURVEY — current state analysis"`

### A_AUDIT
Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset).
Each returns: `[{title, severity, dimension, file, line, description, suggestion, measurement}]`

Merge → evidence phase=audit. Write `session.json.audit_result`.
Update §3 (findings by dimension + severity matrix). Mark G2.

Commit: `"odyssey-improve({slug}): AUDIT — multi-dimension review"`

### A_DIAGNOSE
Root cause analysis for critical/high findings — don't fix symptoms.

1. Group by dimension, prioritize by severity. For each: hypothesis → trace code path + git history → evidence phase=diagnosis
2. Ambiguity → evidence phase=decision; Normal: AskUserQuestion | `-y`: defer
3. CLI-assisted for complex findings: `maestro delegate --role analyze --mode analysis` (`run_in_background: true`)
4. Write `session.json.diagnoses[]`. Update §4. Mark G3.

Commit: `"odyssey-improve({slug}): DIAGNOSE — root cause analysis"`

### A_ESCALATE_DIAGNOSIS
`retries++`. < 3: `maestro delegate --role analyze`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → AskUserQuestion | `-y` → INCONCLUSIVE → S_RECORD.

### A_FIX
1. Exhaustive fix: ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify **current tier's dimension only** (not all dimensions) — new findings at same or higher severity append to current tier. Cross-dimension regression checks run once at S_VERIFY after all tiers complete.
2. For each fix: implement → evidence phase=fix
3. Normal: AskUserQuestion per-fix confirmation | `-y`: auto-proceed, record `deferred`

Commit: `"odyssey-improve({slug}): FIX — improvements applied"`

### A_VERIFY
1. Run tests covering modified areas
2. Re-capture metrics, compare with `session.json.baseline_metrics`
3. CLI-assisted: `maestro delegate --role review --mode analysis` (`run_in_background: true`)
4. `needs_rework` → S_FIX. `verified` → mark G4, advance.
5. Write `session.json.confirmation`. Update §5 (before/after metrics table).

Commit: `"odyssey-improve({slug}): VERIFY — improvements verified"`

### A_GENERALIZE

**MANDATORY — executes unless `skip_generalize == true`. Prior-phase convergence, "all verified," or context pressure are NOT valid skip reasons.**

Pattern source: diagnosed root causes + applied fixes across all dimensions.

**Step 1 — 3-layer pattern extraction** from diagnoses and fixes:

| Layer | Method | Targets |
|-------|--------|---------|
| Syntax | Build regex from fix diffs → Grep | N+1 query patterns, missing error type check, unescaped interpolation, inline eval |
| Semantic | Understand anti-pattern per dimension → Agent scan | Cache bypass in hot path, auth check gap, circular import chain, missing timeout |
| Structural | Find modules with same shape / dependency graph | Controllers sharing validation shape, middleware with same hook pattern, parallel services |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template, confidence}]`

**Thoroughness floor:** ALL 3 layers must be attempted and logged. Each layer records search method, scope, hit count in evidence phase=generalization. "No hits" requires all 3 layers to return 0 with logged evidence.

**Step 2 — 4-agent concurrent scan** (single message, 4 Agents):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep regex from pattern signatures | Full project |
| Semantic scan | Per-dimension anti-pattern check | Related modules |
| Structural match | Find structurally similar files | Full project |
| Historical grep | `git log -S` for pattern signatures | Git history |

**Step 3 — Cross-layer dedup:** multi-layer hit → boost | single-layer → `needs_review` | historically fixed → `regression_risk`

**Step 4 — Iterative deepening:** Module with ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Persist:** Update understanding.md §6 + write `session.json.generalization_stats`:
```json
{"patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {"syntax": 0, "semantic": 0, "structural": 0}, "deepening_triggered": false}
```

**Transition guard:** `S_GENERALIZE → S_RECORD` requires `by_layer` has entries for all 3 layers with search evidence logged. Mark G5 done.

Commit: `"odyssey-improve({slug}): GENERALIZE — generalization scan complete"`

### A_DISCOVER

**Executes whenever `total_hits > 0`. Cannot be skipped without `skip_generalize == true`.**

1. **Triage** each hit with ±10 lines context → classify:
   - `bug` — confirmed improvement defect (same dimension)
   - `risk` — potential degradation or violation
   - `safe` — false positive (must log individual reason — blanket "pre-existing" forbidden)

2. **Route:**

   | Classification | Action |
   |---------------|--------|
   | bug + fix_template applicable | Immediate fix → back to S_FIX |
   | bug + cross-module decision or no template | Create issue (fix suggestion + impact + dimension) |
   | risk + guard addable directly | Fix directly |
   | risk + complex | Create issue |
   | safe | Skip with logged per-item reason |

   Normal: AskUserQuestion per hit | `-y`: auto-fix bugs with fix_template, create issue for rest

3. **Cross-phase loops:** `cross_phase_loops++` on fix/diagnose return. `loops >= max_loops` → must log per-item reasons.

4. Append evidence phase=discovery. Update understanding.md §7. Mark G6 done.

Commit: `"odyssey-improve({slug}): DISCOVER — discovery triage complete"`

### A_RECORD

1. understanding.md §8: improvement metrics — before/after comparison from `baseline_metrics` vs current. Re-capture metrics, build comparison table.
2. understanding.md §9: learnings by Knowledge Persistence categories:
   - Performance pattern → `/spec-add coding`
   - Security rule → `/spec-add debug`
   - Architecture constraint → `/spec-add arch`
   - Reliability pattern → `/spec-add coding`
   Completion summary lists suggested `/spec-add` commands.

3. Mark G7 done. Pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count).

4. **Goal audit (hardened):**
   - `done` → confirmed
   - `skipped` → confirmed ONLY if corresponding `skip_when` flag is true
   - **Hard rule:** G5 and G6 CANNOT be `skipped` unless `skip_generalize == true`. Pending without flag → `failed` (Normal: AskUserQuestion | `-y`: record `failed`)
   - `phase_goals_all_done = true` only when all goals pass this audit

5. `current_state = "COMPLETED"`, emit completion summary.

**Completion summary:**
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

Commit: `"odyssey-improve({slug}): RECORD — summary and knowledge persistence"`

</actions>

<appendix>

### `-y` improve-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX improvement confirmation | AskUserQuestion | auto-proceed, `deferred` |
| A_DIAGNOSE ambiguity | AskUserQuestion | best-effort, `deferred` |
| A_ESCALATE 3-strike | AskUserQuestion 3-way | auto INCONCLUSIVE |
| A_DISCOVER hit routing | AskUserQuestion | auto create issue |
| A_DISCOVER ambiguous items | AskUserQuestion | all `deferred` |

`deferred` items shown in completion summary; recoverable via `-c`.

### Goal Prompt convergence rules

```
Exhaust iteration until all findings actioned (fix/issue/decision)
and phase_goals_all_done=true.
Fix by severity tiers, re-verify after each tier.
Baseline captured before fix, compared after to confirm improvement.
Pending decisions must AskUserQuestion — no silent resolve.
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
| W003 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
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
- [ ] Completion summary
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Security findings need deep investigation | `/odyssey-debug "<finding>"` |
| UI-related findings | `/odyssey-ui "<component>"` |
| Issues created from discoveries | `/manage-issue list --source improve-odyssey` |
| Architecture pattern to document | `/spec-add arch "..."` |
| Performance pattern to persist | `/spec-add coding "..."` |
| Formal review of changes | `/odyssey-review-test-fix <changed-files>` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
</output>
