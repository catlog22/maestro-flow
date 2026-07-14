---
name: odyssey
description: Long-running iterative cycle — one entry, five modes (debug|improve|planex|review|ui). Shared archaeology/audit → fix → verify → generalize → discover → persist skeleton with mode-specific dimensions.
argument-hint: "<intent> --mode debug|improve|planex|review|ui [--template <name>] [--dimensions <list>] [--fix-threshold <severity>] [--max-iterations N] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
Long-running, evidence-driven iterative cycle. A single entry dispatches to one of five modes; all share the same
skeleton — discovery → domain audit → fix → verify → generalize → discover siblings → persist knowledge —
and iterate exhaustively until the mode's exit condition is met or escalation is required.
</purpose>

<mode_dispatch>

**Mode selection precedence:** explicit `--mode <name>` > intent keyword auto-detection > AskUserQuestion (Normal) / error E000 (`-y`).

**Auto-detection from `<intent>` keywords** (first match wins, ordered):

| Keywords in intent | Detected mode |
|--------------------|---------------|
| bug, crash, error, broken, fails, regression, race, leak, "why does" | `debug` |
| requirement, implement, build, add feature, deliver, "I need", user story | `planex` |
| ui, visual, layout, style, component, page, responsive, a11y, accessibility, design | `ui` |
| improve, optimize, performance, security, refactor quality, reliability, observability | `improve` |
| review, audit, check, inspect, "look over", zero-residual | `review` |

Ambiguous / no match → Normal: AskUserQuestion (5-way mode pick) | `-y`: E000.

**Mode registry:**

| Mode | Purpose | Discovery phases | Audit phase | Fix→verify pair | Unique states |
|------|---------|------------------|-------------|-----------------|---------------|
| `debug` | Symptom → root cause → fix → confirm | ARCHAEOLOGY, EXPLORE | DIAGNOSE (hypothesis test) | FIX → CONFIRM | ESCALATE_DIAGNOSIS |
| `improve` | 6-dimension quality audit → diagnose → fix | SURVEY | AUDIT (6 dims) + DIAGNOSE | FIX → VERIFY | ESCALATE_DIAGNOSIS |
| `planex` | Requirement → plan → execute → verify loop | (none) | PLAN + EXECUTE | (EXECUTE) → VERIFY → FIX loop | — |
| `review` | Multi-dimension deep review → zero-residual fix | ARCHAEOLOGY, EXPLORE | REVIEW (4+ dims) | FIX → CONFIRM | — |
| `ui` | Visual survey → 6-dim audit → diverge → fix | SURVEY | AUDIT (6 dims) + DIVERGE | FIX → VERIFY | — |

The **back half is identical across all modes**: `GENERALIZE → DISCOVER → RECORD → END` (see §Shared Back-Half).

</mode_dispatch>

<context>
$ARGUMENTS

**Universal flags:** `--mode <name>` mode selector | `--skip-fix` audit/diagnose only, skip fix+verify | `--skip-generalize` skip GENERALIZE+DISCOVER | `--auto` no delegate confirmation | `-y` auto-confirm (decisions → `deferred`) | `-c` resume most recent session | `--heartbeat` /loop periodic progress

**Mode-scoped flags:**

| Flag | Modes | Description | Default |
|------|-------|-------------|---------|
| `--template <name>` | debug, planex | Predefined strategy/criteria template | — |
| `--dimensions <list>` | improve, review, ui | Audit dimension subset | all |
| `--fix-threshold <sev>` | improve, review, ui | Severity cutoff (critical\|high\|medium\|low\|all) | all |
| `--max-iterations N` | planex | Max verify-fix cycles before escalation | 3 |
| `--method agent\|cli\|auto` | planex | Task execution method | auto |
| `--executor <tool>` | planex | Explicit CLI executor | first enabled |
| `--skip-verify` | planex | Skip post-execution validation gate | false |

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md` | `explore.json` (debug/review only)

**Output boundary**: ALL session artifacts MUST target the session directory (`{run_dir}/outputs/`) or `.workflow/state.json` only. Source code modifications during fix/execute phases are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json — shared core + mode fields:**
```json
{ "mode": "debug|improve|planex|review|ui",
  "target": "", "dimensions": [],
  "patterns": [], "confirmation": null, "generalization_stats": null,
  "cross_phase_loops": 0 }
```
Each mode extends the core — see the mode section's **session fields** block.

**Commit convention:** `"odyssey-{mode}({slug}): {STATE} — {summary}"` (mode = active mode short name; review mode uses `odyssey-review`).

</context>

<invariants>
All base invariants apply (evidence append-only, session-as-state, phase goal tracking, auto-commit per action, zero-residual). Additionally:

1. **Evidence append-only** — never delete or overwrite evidence.ndjson entries.
2. **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
3. **Generalize is mandatory** — GENERALIZE and DISCOVER execute unless `skip_generalize == true`. Prior-phase convergence, "no findings / all verified / zero remaining," or context pressure are NOT valid skip reasons. The phase itself determines whether patterns exist.
4. **Zero-residual** (improve/review/ui) — every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" and blanket "pre-existing" skips are forbidden.
5. **Acceptance criteria are sacred** (planex) — no "close enough", no manual override without explicit escalation.
6. **Browser is truth** (ui) — verify in real rendering, not just code review. Diverge before converge.
</invariants>

<self_iteration>
Self-iteration (logic in base) applies to each mode's discovery + audit + GENERALIZE stages:

| Mode | Self-iterating stages |
|------|----------------------|
| debug | S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE |
| improve | S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE |
| planex | S_PLAN, S_VERIFY, S_GENERALIZE |
| review | S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE |
| ui | S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE |
</self_iteration>

<execution>
Follow base execution discipline completely. On entry: resolve mode (§mode_dispatch), then run that mode's state machine below. All modes converge on the Shared Back-Half.

### Phase Gates (MANDATORY, BLOCKING) — apply to whichever states the active mode traverses

- **INTAKE gate:** mode resolved, target/requirement resolved, SESSION_DIR created, session.json initialized (with baseline_metrics for improve; acceptance_criteria for planex), phase_goals[] derived from flags, understanding.md §1 written. BLOCKED if no target (E001) / no requirement (planex E001) / target path not found (E002) / mode unresolved (E000).
- **Discovery gate** (ARCHAEOLOGY/EXPLORE/SURVEY): evidence for the phase logged, understanding.md updated, discovery goal marked. Archaeology partial via W003 acceptable; explore W006 skip acceptable; survey requires all scan types attempted.
- **Audit gate** (DIAGNOSE/AUDIT/REVIEW/PLAN+EXECUTE/DIVERGE): all dimension agents (or subset) completed, findings merged with severity classification, result written to session.json, understanding.md updated, audit goal marked. Zero dimensions reviewed is BLOCKED (W002 partial allowed). For planex: plan tasks mapped to criteria; all tasks executed or blocked after 3 retries.
- **FIX gate:** current severity tier fully addressed — all findings in tier fixed or individually classified. Per-fix evidence phase=fix logged. Auto-commit per tier. No partial-tier advancement.
- **VERIFY/CONFIRM gate:** tests pass; for improve/ui metrics re-captured; for review/debug `remaining_actionable == 0` and new findings == 0; for planex every criterion verified by its method. confirmation written, understanding.md updated, verify goal marked. needs_rework → route back to FIX.
- **GENERALIZE gate:** ALL 3 layers (syntax/semantic/structural) attempted with evidence logged; generalization_stats written with by_layer entries for all 3 layers; generalize goal marked. Any layer not attempted = thoroughness-floor violation (BLOCKED).
- **DISCOVER gate:** all hits triaged with per-item classification and reason; `remaining_actionable == 0` OR `loops >= max_loops` with per-item reasons logged; discover goal marked. Unclassified hits = BLOCKED.

</execution>

<state_machine>

## Shared skeleton

```
S_INTAKE → [mode discovery] → [mode audit] → [mode fix] → [mode verify]
         → S_GENERALIZE → S_DISCOVER → S_RECORD → END
```

The bracketed phases are mode-specific (defined per mode below). Every mode joins the shared tail
`S_GENERALIZE → S_DISCOVER → S_RECORD → END` under identical rules.

### A_INTAKE (shared)
1. Resolve mode (§mode_dispatch). Parse arguments, generate slug, create `SESSION_DIR`.
2. Resolve target/requirement per mode's **target resolution** table.
3. Search prior knowledge: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + mode-relevant `maestro load --type spec` (debug→debug/coding, improve→coding/debug, review→review, ui→ui/coding, planex→coding).
4. Mode-specific intake step (baseline capture for improve; acceptance-criteria derivation for planex — see mode section).
5. Derive `phase_goals[]` from flags. Write `session.json` + `understanding.md` §1, emit Goal Prompt.

Commit: `"odyssey-{mode}({slug}): INTAKE — parse target and load context"`

### A_RESUME (shared)
`-c` + session found → Glob latest session → read `session.json` → display summary → jump to `current_state` for the recorded mode.

---

## Shared Back-Half (identical for all modes)

### A_GENERALIZE

**MANDATORY — executes unless `skip_generalize == true`. Prior-phase convergence, "no findings / all verified / zero remaining," or context pressure are NOT valid skip reasons.**

Pattern source is mode-specific (see each mode's **generalize source** note); the mechanism is identical.

**Step 1 — 3-layer pattern extraction:**

| Layer | Method | Targets (mode-tuned — see mode note) |
|-------|--------|--------------------------------------|
| Syntax | Build regex from fix diffs → Grep | Missing await, unchecked null/return, wrong comparison, identical error-handling gap, hardcoded values, N+1 shapes, missing aria |
| Semantic | Understand the anti-pattern → Agent scan | Same async-without-catch, boundary assumption, race on shared state, cache bypass, auth gap, missing hover/focus/timeout |
| Structural | Find files with same module/component shape or import graph | Sibling handlers, parallel services, same-shape validators, sibling components/pages |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template, confidence}]`

**Thoroughness floor:** ALL 3 layers must be attempted and logged. Each layer records search method, scope, hit count in evidence phase=generalization. "No hits" requires all 3 layers to return 0 with logged evidence — a single-layer quick grep does NOT satisfy.

**Step 2 — 4-agent concurrent scan** (single message, 4 Agents):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep regex from pattern signatures | Full project |
| Semantic scan | Anti-pattern understanding → scan same class | Related modules/components |
| Structural match | Find structurally similar files | Full project |
| Historical grep | `git log -S` for pattern signatures | Git history |

**Step 3 — Cross-layer dedup:** multi-layer hit → boost | single-layer → `needs_review` | historically fixed → `regression_risk`

**Step 4 — Iterative deepening:** Module/component with ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Persist:** Update understanding.md generalization section + write `session.json.generalization_stats`:
```json
{"patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {"syntax": 0, "semantic": 0, "structural": 0}, "deepening_triggered": false}
```

**Transition guard:** `S_GENERALIZE → S_RECORD` requires `by_layer` has entries for all 3 layers with search evidence logged. Mark generalize goal done.

Commit: `"odyssey-{mode}({slug}): GENERALIZE — pattern scan complete"`

### A_DISCOVER

**Executes whenever `total_hits > 0`. Cannot be skipped without `skip_generalize == true`.**

1. **Triage** each hit with ±10 lines context → classify:
   - `bug` — same defect pattern confirmed (mode-specific: same code defect / degradation / UI defect / area needing same implementation)
   - `risk` — potential issue needing guard
   - `safe` — false positive (must log individual reason — blanket "pre-existing" forbidden)

2. **Route** (mode-tuned target for `bug` — see mode's **discover routing** note):

   | Classification | Action |
   |---------------|--------|
   | bug + fix_template applicable | Immediate fix → back to mode's FIX state, `cross_phase_loops++` |
   | bug + needs re-audit/review | Route to mode's audit state (REVIEW/AUDIT), `cross_phase_loops++` |
   | bug + needs same implementation (planex) | Route to S_EXECUTE with new task, `cross_phase_loops++` |
   | bug + cross-module or no template | Create issue (fix suggestion + impact + dimension) |
   | risk + guard addable directly | Fix directly |
   | risk + complex | Create issue |
   | safe | Skip with logged per-item reason |

   Normal: AskUserQuestion per hit | `-y`: auto-fix bugs with fix_template, create issue for rest

3. **Cross-phase loops:** `cross_phase_loops++` on fix/audit/execute return. `loops >= max_loops` → must log per-item reasons, advance to S_RECORD.

4. Append evidence phase=discovery. Update understanding.md discoveries section. Mark discover goal done.

Commit: `"odyssey-{mode}({slug}): DISCOVER — sibling triage complete"`

### A_RECORD

1. Finalize understanding.md learnings section — persist by the active mode's **Knowledge Persistence categories** (see mode section). For improve/ui, also emit the metrics/before-after section. Completion summary lists suggested `/spec add` commands.

2. Mark record goal done. Pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count).

3. **Goal audit (hardened):**
   - `done` → confirmed
   - `skipped` → confirmed ONLY if corresponding `skip_when` flag is true
   - **Hard rule:** generalize + discover goals CANNOT be `skipped` unless `skip_generalize == true`. Fix/verify goals CANNOT be `skipped` unless `skip_fix == true`. Pending without flag → `failed` (Normal: AskUserQuestion | `-y`: record `failed`)
   - `phase_goals_all_done = true` only when all goals pass this audit

4. `current_state = "COMPLETED"`, emit the mode's completion summary.

Commit: `"odyssey-{mode}({slug}): RECORD — summary and knowledge persistence"`

### Shared `-y` decision points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| Mode ambiguous at dispatch | AskUserQuestion (5-way) | E000 |
| Fix/improvement confirmation | AskUserQuestion | auto-proceed, `deferred` |
| A_DISCOVER hit routing | AskUserQuestion | auto-fix bugs w/ template, issue for rest |
| A_RECORD pending decisions | AskUserQuestion | skip (show deferred count) |
| Goal audit unflagged-pending | AskUserQuestion | record `failed` |

### Shared Goal Prompt convergence rules

```
Stop when the mode's exit condition holds AND phase_goals_all_done=true:
  debug   — root cause confirmed (or INCONCLUSIVE), fix verified
  improve — zero remaining actionable findings, metrics re-captured
  planex  — all acceptance_criteria[*].status==passed (no "close enough")
  review  — remaining_actionable==0, confirmation==confirmed
  ui      — audit+diverge findings all addressed (fix/issue/decision)
Generalization exhausted (3 layers). All siblings fixed or issued — no leftovers.
Pending decisions must AskUserQuestion — no silent resolve.
```

---

## MODE: debug

**State chain:** `S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_DIAGNOSE → S_FIX → S_CONFIRM → [back-half]`

**Boundary — In scope:** Single bug/issue full loop. **Out of scope:** Features → `--mode planex` | Quality review → `--mode review` | UI → `--mode ui` | Architecture → `/maestro-next plan`

**`--template <name>`:**

| Template | Strategy | Use case |
|----------|----------|----------|
| `performance` | profiling → hot path → allocation → cache | Performance degradation |
| `memory-leak` | heap snapshot → retention chain → lifecycle | Memory leaks |
| `race-condition` | timeline → concurrent access → lock analysis | Race conditions |
| `regression` | git bisect → diff analysis → boundary check | Regressions |
| `crash` | stack trace → null chain → error propagation | Crashes / exceptions |

**Target resolution:** issue description parsed from `<intent>`.

**Session fields:**
```json
{ "issue": "", "diagnosis_retries": 0, "root_cause": null, "confirmation": null,
  "patterns": [], "generalization_stats": null }
```

**evidence.ndjson phases:** `archaeology|explore|diagnosis|discovery|decision|self-iteration`
- `archaeology`: `sha`, `author`, `date`, `message`, `relevance`
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)

**explore.json**: `{call_chains, recent_changes, error_gaps, similar_patterns, cli_tool, timestamp}`

**phase_goals[]:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Root cause identified | phase=diagnosis result=confirmed | S_DIAGNOSE | — |
| G2 | Explore context gathered | explore.json ≥1 category | S_EXPLORE | — |
| G3 | Fix applied and confirmed | confirmation.overall == confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR none actionable | S_RECORD | — |

**understanding.md — 9 sections:** 1. Issue & Scope | 2. Archaeology | 3. Exploration | 4. Hypotheses | 5. Root Cause | 6. Fix & Confirmation | 7. Generalization | 8. Discoveries | 9. Learnings

**Transitions:**
```
S_ARCHAEOLOGY → S_EXPLORE   : complete
S_EXPLORE     → S_DIAGNOSE  : complete
S_DIAGNOSE → S_FIX          : confirmed, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : confirmed, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : confirmed, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : all hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : retries >= 3 → INCONCLUSIVE
S_FIX     → S_CONFIRM       : fix implemented
S_CONFIRM → S_GENERALIZE    : confirmed, !skip_generalize
S_CONFIRM → S_RECORD        : confirmed, skip_generalize
S_CONFIRM → S_FIX           : needs_rework
```

**A_ARCHAEOLOGY** — 2 parallel Agents: Timeline (`git log --oneline -20 -- {files}`) + Blame (top 3 files `git blame -L {region}`). Evidence phase=archaeology. `maestro delegate --role analyze --mode analysis` (`run_in_background: true`): PURPOSE review recent modifications related to {issue}; EXPECTED JSON `[{commit_sha, risk_level, analysis, could_cause_issue, explanation}]`. Update §2. If an archaeology agent fails, log W003 and proceed with available results.

**A_EXPLORE** — Skip if no CLI tools (W006). `maestro delegate --role explore --mode analysis` (`run_in_background: true`): PURPOSE call chains, recent changes, error gaps, similar patterns; EXPECTED JSON `{call_chains, recent_changes, error_gaps, similar_patterns}`. Write `explore.json` + evidence phase=explore. Update §3. Mark G2.

**A_DIAGNOSE** — (1) Hypotheses from evidence, ranked [HIGH]/[MEDIUM]/[LOW] → §4. (2) Test each → evidence phase=diagnosis. (3) Ambiguity → evidence phase=decision; Normal: AskUserQuestion | `-y`: defer. (4) Confirmed → `session.json.root_cause` + §5. Mark G1.

**A_ESCALATE_DIAGNOSIS** — `diagnosis_retries++`. < 3: `maestro delegate --role analyze`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → AskUserQuestion | `-y` → INCONCLUSIVE → S_RECORD.

**A_FIX** — (1) Present root cause + proposed fix. Normal: AskUserQuestion | `-y`: auto proceed. (2) Implement fix, evidence phase=decision.

**A_CONFIRM** — (1) Run covering tests. (2) `maestro delegate --role review --mode analysis` (`run_in_background: true`): EXPECTED JSON `{verdict, findings [{severity, description, suggestion}], regression_risk}`. (3) `session.json.confirmation`: `{test_result, cli_review, overall: "confirmed|needs_rework"}`. (4) Update §6. `needs_rework` → S_FIX. `confirmed` → mark G3.

**Generalize source:** confirmed root cause + applied fix. **Discover routing:** `bug` → back to S_FIX; new bug → S_DIAGNOSE.

**Knowledge Persistence (§9):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Recurring root cause pattern | Type + triggers + fix + detection | `/spec add debug` |
| Non-obvious workaround | Problem + steps + why obvious fix fails | `/spec add learning` |
| Architecture boundary violation | Violation + correct boundary + verification | `/spec add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `/spec add coding` |

**Completion summary:**
```
--- DEBUG ODYSSEY COMPLETE ---
Issue:      {issue}
Root cause: {root_cause.hypothesis}
Fix:        {applied|skipped|inconclusive}
Patterns:   {patterns_extracted} ({by_layer})
Scan hits:  {total_hits} ({cross_layer_confirmed} confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} persisted
Self-iter:  {N} rounds across {M} stages
Goals:      {done}/{total} ({skipped} skipped)
---
```

**Mode `-y` points:** A_DIAGNOSE ambiguity → deferred | A_ESCALATE 3-strike → INCONCLUSIVE | A_FIX direction → auto proceed.

---

## MODE: improve

**State chain:** `S_INTAKE → S_SURVEY → S_AUDIT → S_DIAGNOSE → S_FIX → S_VERIFY → [back-half]`

**Boundary — In scope:** Runtime quality improvement — performance/security/architecture/reliability/observability/maintainability audit → diagnose → fix → generalize. **Out of scope:** UI visual → `--mode ui` | New features → `--mode planex` | Single bug → `--mode debug` | Style review → `--mode review`. Zero-residual applies.

**Target resolution:**

| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan (use with caution) |

**Dimensions (6):** 1. **performance** — hot paths, N+1, memory allocation, cache efficiency, bundle size, lazy loading | 2. **security** — OWASP Top 10, injection, auth bypass, data exposure, dependency vulns, secrets | 3. **architecture** — layer violations, circular deps, coupling, interface contracts, SRP | 4. **reliability** — error handling gaps, retry, timeout, graceful degradation, resource cleanup | 5. **observability** — logging coverage, metric gaps, trace propagation, error reporting, health checks | 6. **maintainability** — cyclomatic complexity, dead code, test coverage gaps, doc debt

**Session fields:**
```json
{ "target": "", "dimensions": [], "baseline_metrics": {},
  "audit_result": {}, "diagnoses": [], "confirmation": null,
  "generalization_stats": null }
```

**evidence.ndjson phases:** `survey|audit|diagnosis|fix|discovery|decision|self-iteration`
- `survey`: `category` (dependency|complexity|coverage|error_pattern), `detail`
- `audit`: `dimension`, `severity`, `measurement`
- `diagnosis`: `finding_ref`, `hypothesis`, `result`, `root_cause`
- `fix`: `finding_ref`, `change_summary`, `risk`

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

**understanding.md — 9 sections:** 1. Target & Baseline | 2. Current State Survey | 3. Audit Findings | 4. Root Cause Diagnosis | 5. Fix & Verification | 6. Generalization | 7. Discoveries | 8. Improvement Metrics (before/after) | 9. Engineering Learnings

**Transitions:**
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

**A_INTAKE extra** — Baseline capture: record current metrics (test pass rate, bundle size, dependency count, complexity hotspots) to `session.json.baseline_metrics`.

**A_SURVEY** — (1) Dependency audit (package.json/lock), complexity scan (size/nesting), test coverage map, error handling scan (empty catch, unhandled promise). (2) CLI-assisted (optional): `maestro delegate --role analyze --mode analysis` for dependency health / complexity hotspots / coverage gaps / error patterns (`run_in_background: true`). (3) Evidence phase=survey. Update §2. Mark G1.

**A_AUDIT** — Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset). Each returns `[{title, severity, dimension, file, line, description, suggestion, measurement}]`. Merge → evidence phase=audit. Write `session.json.audit_result`. Update §3 (findings by dimension + severity matrix). Mark G2.

**A_DIAGNOSE** — Root cause analysis for critical/high findings — don't fix symptoms. (1) Group by dimension, prioritize by severity; for each: hypothesis → trace code path + git history → evidence phase=diagnosis. (2) Ambiguity → evidence phase=decision; Normal: AskUserQuestion | `-y`: defer. (3) CLI-assisted for complex findings (`run_in_background: true`). (4) Write `session.json.diagnoses[]`. Update §4. Mark G3.

**A_ESCALATE_DIAGNOSIS** — `retries++`. < 3: `maestro delegate --role analyze`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → AskUserQuestion | `-y` → INCONCLUSIVE → S_RECORD.

**A_FIX** — (1) Exhaustive fix: ALL diagnosed issues by severity tier (critical → high → medium → low within fix_threshold), one dimension at a time. After each tier, re-verify **current tier's dimension only**; new findings at same or higher severity append to current tier. Cross-dimension regression checks run once at S_VERIFY after all tiers. (2) For each fix: implement → evidence phase=fix. (3) Normal: AskUserQuestion per-fix | `-y`: auto-proceed, record `deferred`.

**A_VERIFY** — (1) Run tests covering modified areas. (2) Re-capture metrics, compare with `baseline_metrics`. (3) CLI-assisted: `maestro delegate --role review --mode analysis` (`run_in_background: true`). (4) `needs_rework` → S_FIX; `verified` → mark G4. (5) Write `confirmation`. Update §5 (before/after metrics table).

**Generalize source:** diagnosed root causes + applied fixes across all dimensions. **Discover routing:** `bug` → S_FIX; new critical → S_DIAGNOSE.

**A_RECORD extra** — §8 improvement metrics: re-capture and build before/after comparison table from `baseline_metrics` vs current.

**Knowledge Persistence (§9):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Performance pattern | Bottleneck type + fix approach + measurement | `/spec add coding` |
| Security rule | Vulnerability class + fix + prevention | `/spec add debug` |
| Architecture constraint | Violation + correct boundary + check | `/spec add arch` |
| Reliability pattern | Failure mode + handling strategy + verification | `/spec add coding` |

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

**Mode `-y` points:** A_FIX confirmation → auto-proceed `deferred` | A_DIAGNOSE ambiguity → best-effort `deferred` | A_ESCALATE 3-strike → auto INCONCLUSIVE | A_DISCOVER routing → auto create issue | ambiguous items → all `deferred`.

---

## MODE: planex

**State chain:** `S_INTAKE → S_PLAN → S_EXECUTE → S_VERIFY → S_FIX → [back-half]` (FIX↔VERIFY loop until all criteria pass)

**Boundary — In scope:** Single requirement delivery loop — requirement parsing → all acceptance criteria passing + generalization. **Out of scope:** Multi-requirement orchestration → `/maestro-next roadmap` | Deep debugging → `--mode debug` | Code review → `--mode review` | UI optimization → `--mode ui`

**`--template <name>`:**

| Template | Criteria pattern | Use case |
|----------|-----------------|----------|
| `feature` | User story acceptance + boundary tests + UI verification | New feature |
| `bugfix` | Regression tests + root cause confirmation + boundary coverage | Bug fix |
| `refactor` | Behavior preservation + performance baseline + API compatibility | Refactoring |
| `migration` | Data consistency + rollback verification + performance comparison | Data/API migration |
| `api-endpoint` | Request/response contract + error handling + permission checks | API development |

**Target resolution:** requirement parsed from `<intent>`.

**Session fields:**
```json
{ "requirement": "",
  "acceptance_criteria": [{"id":"AC1","criterion":"","verify_method":"test|grep|cli-review|manual","status":"pending","evidence":"","passed_at":null}],
  "plan": {"tasks":[{"id":"T1","title":"","description":"","criteria_refs":["AC1"],"status":"pending","files_modified":[],"domain":"general","executor":"agent"}],"created_at":""},
  "execution_config": {"method":"auto","default_executor":"","domain_routing":{"frontend":"","backend":"","default":"agent"},"code_review_tool":"Skip","verification_tool":"Auto","confirmed":false},
  "iterations": [{"iteration":1,"started_at":"","completed_at":"","criteria_before":{"passed":0,"total":0},"criteria_after":{"passed":0,"total":0},"gaps_fixed":[],"files_modified":[]}],
  "current_iteration": 0,
  "patterns": [], "generalization_stats": null }
```

**evidence.ndjson phases:** `planning|execution|verification|fix|decision|generalization|discovery|self-iteration`

**phase_goals[]:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Acceptance criteria defined | ≥1 criterion in acceptance_criteria[] | S_INTAKE | — |
| G2 | Plan created | session.json.plan populated | S_PLAN | — |
| G3 | Implementation complete | all plan tasks executed | S_EXECUTE | — |
| G4 | All criteria pass | all acceptance_criteria[].status == passed | S_VERIFY | — |
| G5 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | spec entries created OR no actionable | S_RECORD | — |

**understanding.md — 8 sections:** 1. Requirement & Criteria | 2. Plan | 3. Execution | 4. Verification | 5. Fix Log | 6. Generalization | 7. Discoveries | 8. Learnings

**Transitions:**
```
S_PLAN    → S_EXECUTE
S_EXECUTE → S_VERIFY
S_VERIFY → S_GENERALIZE   : all passed AND !skip_generalize
S_VERIFY → S_RECORD       : all passed AND skip_generalize
S_VERIFY → S_FIX          : some failed AND iteration < max
S_VERIFY → S_PLAN         : fundamental plan flaw → cross_phase_loops++ (replan). Criteria preservation: acceptance_criteria[] statuses preserved; only plan.tasks[] regenerated. Passed criteria retain `passed`; failed criteria reset to `pending` for re-verification.
S_VERIFY → S_RECORD       : some failed AND iteration >= max (escalate)
S_FIX → S_VERIFY (loop)
```
Discover routes to S_EXECUTE (not FIX): area needing same implementation → new task, `cross_phase_loops++`.

**A_INTAKE extra** — Define acceptance criteria: analyze requirement → derive testable criteria, each with `verify_method` (test|grep|cli-review|manual). Normal: AskUserQuestion to confirm/edit | `-y`: auto-derive, record `{"phase":"decision","type":"criteria-confirmation","status":"deferred"}`. Mark G1.

**A_PLAN** — (1) Decompose requirement into ordered tasks mapped to acceptance criteria. (2) CLI-assisted planning (optional):
```bash
maestro delegate "PURPOSE: Create implementation plan for: {requirement}
TASK: Decompose into subtasks | Map to acceptance criteria | Identify dependencies
MODE: analysis
CONTEXT: @**/* | Criteria: {criteria_summary}
EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]
" --role analyze --mode analysis
```
Run `run_in_background: true`, wait for callback. (3) Write `session.json.plan`, append evidence (planning), update §2. Mark G2.

**A_EXECUTE** —
- **Step 1 — Execution Options Confirmation.** Skip if `-y` OR `--method` explicitly set OR `execution_config.confirmed == true` (resume). Load tools: `maestro delegate-config show --json`. AskUserQuestion 3 questions: Executor (Auto domain routing | Agent all | specific CLI | custom) / Review (Skip | {tool}) / Verify (Auto | specific tool | Skip). Parse → write `execution_config`, set `confirmed: true`. `--skip-verify` overrides verification to `"Skip"`.
- **Step 2 — Executor Resolution** (method == "auto"): domain routing — frontend (UI/component/page/style, .tsx/.jsx/.vue/.css/.html/.svelte) | backend (API/server/db/service, .go/.rs/.java/.py/.sql/.proto) | general (mixed/config/tests, .ts/.js/other). Resolution: `execution_config.domain_routing[domain]` → fallback `.default` ("agent").
- **Step 3 — Task Execution** per plan order (independent tasks may parallelize). **Agent path:** spawn Agent with task definition + criteria refs + prior task summaries + specs_content → implement → verify convergence → auto-fix (max 3) → return. **CLI path:**
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
Run `run_in_background: true`, wait for callback. **Deviation Rule** (max 3 auto-fix per task): first attempt normal dispatch → retry `--resume planex-${slug}-${task_id}` simplified → fallback to Agent path → all 3 fail → mark task `blocked`, checkpoint, continue remaining.
- **Step 4 — Per-Task Evidence:** `{"phase":"execution","type":"task-completed","task_id":"T1","executor":"...","files_modified":[],"summary":"","attempt":1}`; update task status.
- **Step 5 — Post-Execution Validation.** Skip if `verification_tool == "Skip"` OR `--skip-verify` OR no completed tasks. **Check 1** Summary Consistency (task status vs git diff). **Check 2** CLI Verification Gate:
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
Run `run_in_background: true`. `overall == "passed"` → proceed to S_VERIFY with boosted confidence; `gaps_found` → log findings, proceed. **Check 3** Code Review (if `code_review_tool != "Skip"`): `maestro delegate "Review git diff for correctness, style, bugs" --to ${code_review_tool} --mode analysis --rule analysis-review-code-quality`.
- **Step 6 — Completion:** update §3. Mark G3.

**A_VERIFY** — Iron gate; verify each criterion by method:

| Method | Action |
|--------|--------|
| `test` | Run relevant tests, check pass/fail |
| `grep` | Grep for expected pattern |
| `cli-review` | `maestro delegate "PURPOSE: Verify criterion {id}: {criterion}\nTASK: Read implementation \| Check behavior \| Report pass/fail with file:line\nMODE: analysis\nCONTEXT: @{relevant_files}\nEXPECTED: JSON {criterion_id, status, evidence}" --role review --mode analysis` |
| `manual` | Normal: AskUserQuestion / `-y`: record `deferred` |

Record per criterion: `{"phase":"verification","type":"criterion-check","criterion_id":"AC1","method":"","result":"passed|failed","evidence":"","iteration":N}`. Update `acceptance_criteria[].status`. Append to `iterations[]`. Update §4 pass/fail table. **Route:** all passed → mark G4 → next. Some failed + iteration < max → S_FIX. Some failed + iteration >= max → Normal: AskUserQuestion (continue/lower bar/accept) / `-y`: `deferred`, proceed S_RECORD.

**A_FIX** — (1) Increment `current_iteration`. (2) For each failed criterion: diagnose gap → targeted code fix (not re-implementation). (3) CLI fix review (optional): `maestro delegate` review fixes for regressions, EXPECTED `{verdict, regression_risk, concerns}`. (4) Append evidence (fix), update §5 → S_VERIFY.

**Generalize source:** implementation patterns from executed tasks (API contract shapes, validation shapes, error response format, config structure).

**Iteration model:**
```
S_EXECUTE → S_VERIFY ──all pass──→ S_GENERALIZE → S_DISCOVER → S_RECORD
                │                       │
           some fail + iter < max       3-layer scan, 0 hits ─→ S_RECORD
                ▼
             S_FIX ──→ S_VERIFY (loop)
```
Max iterations (default 3) prevents infinite loops.

**Knowledge Persistence (§8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Multi-round fix cycle pattern | Problem scenario + fix iteration + final approach | `/spec add debug` |
| Reusable implementation pattern | Pattern + applicable scope + code template | `/spec add coding` |
| Acceptance criteria template | Standard template + verify_method suggestion | `/spec add review` |
| Generalization pattern | Signature + risk + fix template | `/spec add coding` |

**Completion summary:**
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

**Mode `-y` points:** S_INTAKE criteria → auto-derive `deferred` | S_EXECUTE options → defaults (auto/Skip/Auto) `confirmed:true` | S_EXECUTE task blocked → auto continue, log blocked | S_VERIFY manual criterion → `deferred` | S_VERIFY max iteration → auto accept `deferred` | A_DISCOVER routing → auto-route to execute, issue for rest.

---

## MODE: review

**State chain:** `S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → [back-half]`

**Boundary — In scope:** Multi-dimensional deep review of target code → exhaustive fix ALL findings by severity → generalize patterns project-wide. **Out of scope:** Root cause debug → `--mode debug` | Feature implementation → `--mode planex` | UI visual optimization → `--mode ui`. Zero-residual applies (fix ALL findings within fix_threshold, default all).

**Target resolution:**

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | state.json → changed files |
| PR number | `git diff main...HEAD` |

**Session fields:**
```json
{ "target": "", "dimensions": [], "review_result": {"remaining_actionable": 0},
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

**evidence.ndjson phases:** `archaeology|explore|review|fix|discovery|decision|self-iteration`

**phase_goals[]:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Review completed | all dimensions reviewed | S_REVIEW | — |
| G2 | Explore context | explore.json populated | S_EXPLORE | — |
| G3 | Zero remaining | `remaining_actionable == 0` | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries or no actionable | S_RECORD | — |

**understanding.md — 8 sections:** 1. Target & Scope | 2. Archaeology | 3. Exploration | 4. Review Results | 5. Fix & Confirmation | 6. Generalization | 7. Discoveries | 8. Learnings. Specs: `maestro load --type spec --category review`.

**Transitions:**
```
S_ARCHAEOLOGY → S_EXPLORE  : complete
S_EXPLORE     → S_REVIEW   : complete
S_REVIEW  → S_FIX          : !skip_fix AND findings
S_REVIEW  → S_GENERALIZE   : skip_fix OR no findings, !skip_generalize
S_REVIEW  → S_RECORD       : both skip
S_FIX     → S_CONFIRM      : tier complete
S_CONFIRM → S_GENERALIZE   : confirmed, !skip_generalize
S_CONFIRM → S_RECORD       : confirmed, skip_generalize
S_CONFIRM → S_FIX          : needs_rework
```
Discover routes: fixable sibling → S_FIX; new target needing review → S_REVIEW (loops < max_loops).

**A_ARCHAEOLOGY** — Same as debug mode (Timeline + Blame agents, `maestro delegate --role analyze`). On agent/delegate failure, log W003 and proceed with available results. Update §2.

**A_EXPLORE** — Same as debug mode. Skip if no CLI tools (W006). Write `explore.json` + evidence phase=explore. Update §3. Mark G2.

**A_REVIEW** — Spawn N parallel Agents, one per dimension:
- **Correctness**: logic errors, boundary conditions, null/undefined, race conditions
- **Security**: injection, XSS, CSRF, data exposure, auth bypass
- **Performance**: hot paths, N+1, memory leaks, unnecessary recomputation
- **Architecture**: layer violations, circular deps, interface contracts, SoC

Each returns `[{title, severity, file, line, description, suggestion, cwe}]`. Merge → evidence phase=review. Write `review_result` + §4 severity matrix. Mark G1.

**A_FIX** — Exhaustive iterative fix — descend by severity until `remaining_actionable == 0`:
```
for tier in [critical, high, medium, low].filter(>= threshold):
  for each unfixed candidate: read ±20 lines → fix → evidence phase=fix
  re-review modified area (new findings → append, continue; max 2 per tier)
  tier done → auto-commit
```
Normal: AskUserQuestion per tier | `-y`: auto-fix all. Remaining > 0 → retry (max_fix_rounds = 5). Unchanged 2 rounds → classify each individually. After 5 rounds remaining > 0 → escalate: Normal: AskUserQuestion (continue/accept/reclassify) | `-y`: classify remaining as `deferred`, proceed. Blanket "pre-existing" forbidden. Commit per tier: `"odyssey-review({slug}): FIX-{tier} — {N} items fixed"`.

**A_CONFIRM** — Run tests + `maestro delegate --role review --mode analysis` (`run_in_background: true`) zero-residual review. `remaining == 0 AND new == 0` → confirmed, mark G3; otherwise → needs_rework → S_FIX. Update `confirmation` + `remaining_actionable` + §5.

**Generalize source:** review findings with severity >= medium. **Discover routing:** fixable sibling → S_FIX; new target → S_REVIEW.

**Knowledge Persistence (§8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Cross-dimension recurring pattern | Pattern + affected dimensions + coding standard | `/spec add review` |
| Security finding | Vulnerability type + triggers + fix approach | `/spec add debug` |
| Architecture violation pattern | Violation + correct boundary + verification | `/spec add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `/spec add coding` |

**Completion summary:**
```
--- REVIEW-TEST-FIX ODYSSEY COMPLETE ---
Target:     {target}          Dimensions: {dims}
Findings:   {C}C {H}H {M}M {L}L    Fix: {fixed}, confirmed={yes|skip}
Patterns:   {N} ({by_layer})        Scan hits: {total} ({cross} cross-layer)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} persisted
Self-iter:  {N} rounds across {M} stages
Goals:      {done}/{total} ({skipped} skipped)
---
```

**Mode `-y` points:** S_FIX tier candidates → auto-fix `deferred` | S_FIX re-review new findings → auto-append | S_CONFIRM needs_rework → auto proceed | A_DISCOVER routing → auto-fix w/ template, issue for rest.

---

## MODE: ui

**State chain:** `S_INTAKE → S_SURVEY → S_AUDIT → S_DIVERGE → S_FIX → S_VERIFY → [back-half]`

**Boundary — In scope:** Target component/page visual experience optimization — audit 6 dimensions, divergent exploration, fix, generalize to sibling components. **Out of scope:** Backend/data/API → `--mode planex` | Deep bug investigation → `--mode debug` | Code quality review → `--mode review`.

**Decision gate** — ONLY these qualify as decisions: brand/style direction requiring human creative judgment | layout restructuring that significantly changes user flow | requires new design tokens or breaking component API.

**Target resolution:** Component path → audit component | Page/route → audit page | `staged`/`HEAD` → diff UI changes | Feature area → resolve to components/pages.

**Dimensions (6):**

| Dimension | Focus |
|-----------|-------|
| visual_hierarchy | Spacing, typography scale, color contrast, alignment, whitespace, visual weight |
| interaction_states | Hover, focus, active, disabled, loading, error, empty, selected states |
| accessibility | WCAG AA contrast, focus management, aria labels, keyboard nav, screen reader |
| responsiveness | Breakpoints, overflow, touch targets, fluid typography, container queries |
| micro_interactions | Transitions, animations, feedback indicators, loading states, progress |
| edge_cases | Long text truncation, empty data, error states, extreme values, i18n, RTL |

**Session fields:**
```json
{ "target": "", "dimensions": [],
  "audit_result": { "dimensions_audited": 0, "finding_count": 0, "severity_distribution": {} },
  "diverge_result": { "improvements_proposed": 0, "creative_ideas": 0 },
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

**evidence.ndjson phases:** `survey|audit|diverge|fix|discovery|decision|self-iteration`

**phase_goals[]:**

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Divergent exploration done | S_DIVERGE | — |
| G4 | Zero remaining: all findings/ideas fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

**understanding.md — 8 sections:** 1. Target & Design Context | 2. Survey | 3. Audit | 4. Diverge | 5. Verify | 6. Generalize | 7. Discover | 8. Learnings

**Transitions:**
```
S_SURVEY  → S_AUDIT       : complete
S_AUDIT   → S_DIVERGE     : complete
S_DIVERGE → S_FIX         : !skip_fix AND actionable findings/ideas
S_DIVERGE → S_GENERALIZE  : (skip_fix OR no actionable) AND !skip_generalize
S_DIVERGE → S_RECORD      : (skip_fix OR no actionable) AND skip_generalize
S_FIX     → S_VERIFY      : fix implemented
S_VERIFY  → S_GENERALIZE  : verified, !skip_generalize
S_VERIFY  → S_RECORD      : verified, skip_generalize
S_VERIFY  → S_FIX         : needs_rework
```
Discover routes: new component to audit → S_AUDIT; fixable sibling → S_FIX.

**A_SURVEY** — (1) Design system inventory: scan for design tokens, CSS variables, theme imports. (2) Current state analysis: styling patterns, layout strategy, component hierarchy. (3) CLI-assisted: `maestro delegate --role analyze --mode analysis` — survey tokens, spacing, typography, hierarchy, consistency. (4) Evidence phase=survey. Update §2. Mark G1.

**A_AUDIT** — Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset; see Dimensions table). Each returns `[{title, severity, file, line, description, suggestion, dimension}]`. Merge → evidence phase=audit. Write `audit_result`. Update §3 severity matrix. Mark G2.

**A_DIVERGE** — Goes beyond defect fixing — "what would make this delightful?" **Step 1 — 2 parallel Agents:** Polish Agent (shadows, borders, transitions, hover, feedback, empty states, skeleton loading, scroll behavior) + Delight Agent (motion design, progressive disclosure, smart defaults, contextual hints, celebratory feedback, personality in copy). Each returns `[{idea, category (polish|delight), impact, effort, description, inspiration}]`. **Step 2 — CLI-assisted:** `maestro delegate --role analyze --mode analysis` — polish opportunities, micro-interactions, visual rhythm, delight moments. **Step 3 — Consolidate:** merge audit findings + divergent ideas → prioritized list (severity × impact × effort). Evidence phase=diverge. Update §4. Mark G3.

**A_FIX** — Skip if `--skip-fix`. (1) Exhaustive fix: ALL findings/ideas by priority tier (critical → high → medium → low + high-impact ideas). After each tier, re-review — new findings append. (2) Each fix → evidence phase=fix. (3) Normal: AskUserQuestion per-fix | `-y`: auto-proceed, record `deferred`.

**A_VERIFY** — (1) Run tests (lint, unit, visual regression). (2) `maestro delegate --role review --mode analysis` — visual correctness, interaction states, accessibility, responsive. (3) `needs_rework` → S_FIX; `verified` → mark G4. Update §5, write `confirmation`.

**Generalize source:** audit findings + diverge ideas (severity >= medium OR impact = high). **Discover routing:** new component → S_AUDIT; fixable sibling → S_FIX.

**Knowledge Persistence (§8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Design pattern | Component pattern + applicable scenarios + token references | `/spec add ui` |
| Interaction spec | State definitions + transition rules + feedback patterns | `/spec add ui` |
| Accessibility rule | WCAG requirement + implementation approach | `/spec add ui` |
| Reusable generalization pattern | Pattern signature + application scope | `/spec add coding` |

**Completion summary:**
```
--- UI ODYSSEY COMPLETE ---
Target:     {target} | Dimensions: {dimensions_audited}
Findings:   {C}C {H}H {M}M {L}L | Diverge: {improvements} polish + {creative} delight
Fix:        {fixed_count} applied, verified={yes|skipped}
Patterns:   {extracted} ({by_layer})
Scan hits:  {total} ({cross_layer} cross-layer)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} persisted
Self-iter:  {N} rounds
Goals:      {done}/{total} ({skipped} skipped)
---
```

**Mode `-y` points:** A_FIX confirmation → auto-proceed `deferred` | A_DISCOVER routing → auto-fix w/ template, issue for rest.

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E000 | error | Mode unresolved (`-y`, ambiguous intent, no `--mode`) | Provide `--mode` |
| E001 | error | No target / no requirement (planex) / no issue (debug) | Provide target or -c |
| E002 | error | Target path not found | Check path |
| W001 | warning | No relevant git history / no dependency manifest / no design system | Proceed with defaults |
| W002 | warning | Some dimension agents failed / 3 retries exhausted | Partial coverage / INCONCLUSIVE |
| W003 | warning | Archaeology agent or delegate failure (debug/review) | Proceed with available results, log failed agent |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
| W005 | warning | Pending decisions | Filter evidence phase=decision |
| W006 | warning | No CLI tools (debug/review explore) | Skip explore |
| W007 | warning | planex CLI review regression concern | Review before next iteration |
</error_codes>

<success_criteria>
- [ ] Mode resolved (explicit or auto-detected); session + output files created; prior knowledge searched
- [ ] Discovery phase(s) for the mode completed with evidence (archaeology/explore/survey)
- [ ] Domain audit completed with structured findings + severity matrix (or acceptance criteria + plan for planex)
- [ ] understanding.md sections written progressively per mode
- [ ] Fix + verify/confirm (unless --skip-fix); zero-residual for improve/review/ui; all criteria pass for planex
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize); every unfixed finding individually justified
- [ ] phase_goals derived, tracked, and hardened-audited; Goal Prompt once; `-y` no blocking prompts
- [ ] Session resumable via -c; mode-specific completion summary emitted
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Discovery issues created | `/manage issue list --source {mode}-odyssey` |
| Deeper debug needed (from any mode) | `/odyssey <finding> --mode debug` |
| Formal review of changes | `/odyssey <changed-files> --mode review` |
| UI-related findings | `/odyssey <component> --mode ui` |
| Document pattern | `/learn decompose <module>` |
| Second opinion | `/learn consult <understanding.md>` |
| Related question | `/learn investigate "<question>"` |
| Design/perf/arch pattern to persist | `/spec add ui\|coding\|arch "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
</output>
