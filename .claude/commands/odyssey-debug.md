---
name: odyssey-debug
description: Long-running debug cycle — archaeology, diagnosis, fix, confirmation, generalization, discovery, and knowledge persistence
argument-hint: "<issue> [--template <name>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
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

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
archaeology → explore → diagnose → fix & confirm → generalize → discover siblings → persist.
Exhaustive iteration until root cause confirmed or INCONCLUSIVE.
</purpose>

<boundary>
**In scope:** Single bug/issue full loop.
**Out of scope:** Features → `/odyssey-planex` | Quality review → `/odyssey-review-test-fix` | UI → `/odyssey-ui` | Architecture → `/maestro-next plan`

**`--template <name>`:**

| Template | Strategy | Use case |
|----------|----------|----------|
| `performance` | profiling → hot path → allocation → cache | Performance degradation |
| `memory-leak` | heap snapshot → retention chain → lifecycle | Memory leaks |
| `race-condition` | timeline → concurrent access → lock analysis | Race conditions |
| `regression` | git bisect → diff analysis → boundary check | Regressions |
| `crash` | stack trace → null chain → error propagation | Crashes / exceptions |
</boundary>

<context>
$ARGUMENTS

**Flags:** `--skip-fix` analysis-only | `--skip-generalize` quick fix | `--template <name>` | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `explore.json` | `understanding.md`

**session.json — debug-specific fields:**
```json
{ "issue": "", "diagnosis_retries": 0, "root_cause": null, "confirmation": null,
  "patterns": [], "generalization_stats": null }
```

**evidence.ndjson phases:** `archaeology|explore|diagnosis|discovery|decision|self-iteration`
- `archaeology`: `sha`, `author`, `date`, `message`, `relevance`
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)
- `discovery`: `file`, `line`, `classification` (safe|risk|bug), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status`, `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

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

**understanding.md — 9 sections:**
1. Issue & Scope ← S_INTAKE | 2. Archaeology ← S_ARCHAEOLOGY | 3. Exploration ← S_EXPLORE
4. Hypotheses ← S_DIAGNOSE | 5. Root Cause ← S_DIAGNOSE | 6. Fix & Confirmation ← S_FIX+S_CONFIRM
7. Generalization ← S_GENERALIZE | 8. Discoveries ← S_DISCOVER | 9. Learnings ← S_RECORD

**Knowledge Persistence categories (§9):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Recurring root cause pattern | Type + triggers + fix + detection | `/spec-add debug` |
| Non-obvious workaround | Problem + steps + why obvious fix fails | `/spec-add learning` |
| Architecture boundary violation | Violation + correct boundary + verification | `/spec-add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `/spec-add coding` |
</context>

<invariants>
1. **Evidence append-only** — never delete or overwrite evidence.ndjson entries
2. **Phase goal tracking** — mark goal done/failed before transition; no silent skips
3. **Generalize is mandatory** — S_GENERALIZE and S_DISCOVER execute unless `skip_generalize == true`. "No findings" from prior phases, convergence signals, or context pressure are NOT valid reasons to skip. The phase itself determines whether patterns exist.
</invariants>

<self_iteration>
Applies to: **S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE**. Logic in base.
</self_iteration>

<state_machine>

<states>
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_DIAGNOSE → S_FIX → S_CONFIRM → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME_SESSION
S_INTAKE → S_ARCHAEOLOGY  : issue parsed → A_INTAKE
S_INTAKE → S_INTAKE       : no issue, no session → AskUserQuestion

S_ARCHAEOLOGY → S_EXPLORE     : complete
S_EXPLORE     → S_DIAGNOSE    : complete

S_DIAGNOSE → S_FIX          : confirmed, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : confirmed, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : confirmed, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : all hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : retries >= 3 → INCONCLUSIVE

S_FIX     → S_CONFIRM       : fix implemented
S_CONFIRM → S_GENERALIZE    : confirmed, !skip_generalize
S_CONFIRM → S_RECORD        : confirmed, skip_generalize
S_CONFIRM → S_FIX           : needs_rework

S_GENERALIZE → S_DISCOVER   : similar code found
S_GENERALIZE → S_RECORD     : all 3 layers scanned with evidence, total_hits == 0

S_DISCOVER → S_DIAGNOSE     : new bug → cross_phase_loops++
S_DISCOVER → S_FIX          : same-pattern bug + fix_template, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → log per-item reasons

S_RECORD   → END            : complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments, generate slug, create SESSION_DIR
2. `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + Grep keywords
3. Derive `phase_goals[]` from flags
4. Write `session.json` + `understanding.md` §1, emit Goal Prompt

Commit: `"odyssey-debug({slug}): INTAKE — parse target and load context"`

### A_RESUME_SESSION
Glob latest session → read `session.json` → jump to `current_state`.

### A_ARCHAEOLOGY
2 parallel Agents: Timeline (`git log --oneline -20 -- {files}`) + Blame (top 3 files `git blame -L {region}`). Evidence phase=archaeology.

`maestro delegate --role analyze --mode analysis` (`run_in_background: true`):
- PURPOSE: Review recent modifications related to {issue}
- EXPECTED: JSON [{commit_sha, risk_level, analysis, could_cause_issue, explanation}]

Update §2. Commit: `"odyssey-debug({slug}): ARCHAEOLOGY — git history analysis"`

### A_EXPLORE
Skip if no CLI tools (W006).

`maestro delegate --role explore --mode analysis` (`run_in_background: true`):
- PURPOSE: Call chains, recent changes, error gaps, similar patterns
- EXPECTED: JSON {call_chains, recent_changes, error_gaps, similar_patterns}

Write `explore.json` + evidence phase=explore. Update §3. Mark G2. Commit: `"odyssey-debug({slug}): EXPLORE — codebase exploration"`

### A_DIAGNOSE
1. Hypotheses from evidence, ranked [HIGH]/[MEDIUM]/[LOW] → §4
2. Test each → evidence phase=diagnosis
3. Ambiguity → evidence phase=decision; Normal: AskUserQuestion | `-y`: defer
4. Confirmed → `session.json.root_cause` + §5. Mark G1.

Commit: `"odyssey-debug({slug}): DIAGNOSE — root cause confirmed"`

### A_ESCALATE_DIAGNOSIS
`diagnosis_retries++`. < 3: `maestro delegate --role analyze`, new hypotheses, → S_DIAGNOSE. >= 3: Normal → AskUserQuestion | `-y` → INCONCLUSIVE → S_RECORD.

### A_FIX
1. Present root cause + proposed fix. Normal: AskUserQuestion | `-y`: auto proceed
2. Implement fix, evidence phase=decision

Commit: `"odyssey-debug({slug}): FIX — {summary}"`

### A_CONFIRM
1. Run covering tests
2. `maestro delegate --role review --mode analysis` (`run_in_background: true`):
   - EXPECTED: JSON {verdict, findings [{severity, description, suggestion}], regression_risk}
3. `session.json.confirmation`: `{test_result, cli_review, overall: "confirmed|needs_rework"}`
4. Update §6. `needs_rework` → S_FIX. `confirmed` → mark G3.

Commit: `"odyssey-debug({slug}): CONFIRM — fix verified"`

### A_GENERALIZE

**MANDATORY — executes unless `skip_generalize == true`. Prior-phase convergence, "no findings," or context pressure are NOT valid skip reasons.**

Pattern source: confirmed root cause + applied fix.

**Step 1 — 3-layer pattern extraction:**

| Layer | Method | Targets |
|-------|--------|---------|
| Syntax | Build regex from fix diff → Grep | Missing `await`, unchecked null, wrong comparison, identical error-handling gap |
| Semantic | Understand anti-pattern that caused the bug → Agent scan | Same async-without-catch, same boundary assumption, race on shared state |
| Structural | Find files with same module shape / import graph | Sibling handlers, parallel service implementations, same-shape error handlers |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template, confidence}]`

**Thoroughness floor:** ALL 3 layers must be attempted and logged. Each layer records search method, scope, hit count in evidence phase=generalization. "No hits" requires all 3 layers to return 0 with logged evidence — a single-layer quick grep does NOT satisfy.

**Step 2 — 4-agent concurrent scan** (single message, 4 Agents):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep regex from pattern signatures | Full project |
| Semantic scan | Anti-pattern understanding → scan same bug class | Related modules |
| Structural match | Find structurally similar files to buggy file | Full project |
| Historical grep | `git log -S` for pattern signatures | Git history |

**Step 3 — Cross-layer dedup:** multi-layer hit → boost | single-layer → `needs_review` | historically fixed → `regression_risk`

**Step 4 — Iterative deepening:** Module with ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Persist:** Update understanding.md §7 + write `session.json.generalization_stats`:
```json
{"patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {"syntax": 0, "semantic": 0, "structural": 0}, "deepening_triggered": false}
```

**Transition guard:** `S_GENERALIZE → S_RECORD` requires `by_layer` has entries for all 3 layers with search evidence logged. Mark G4 done.

Commit: `"odyssey-debug({slug}): GENERALIZE — pattern scan complete"`

### A_DISCOVER

**Executes whenever `total_hits > 0`. Cannot be skipped without `skip_generalize == true`.**

1. **Triage** each hit with ±10 lines context → classify:
   - `bug` — same defect pattern confirmed
   - `risk` — potential issue needing guard
   - `safe` — false positive (must log individual reason — blanket "pre-existing" forbidden)

2. **Route:**

   | Classification | Action |
   |---------------|--------|
   | bug + fix_template applicable | Immediate fix → back to S_FIX |
   | bug + cross-module or no template | Create issue (fix suggestion + impact) |
   | risk + guard addable directly | Fix directly |
   | risk + complex | Create issue |
   | safe | Skip with logged per-item reason |

   Normal: AskUserQuestion per hit | `-y`: auto-fix bugs with fix_template, create issue for rest

3. **Cross-phase loops:** `cross_phase_loops++` on fix/diagnose return. `loops >= max_loops` → must log per-item reasons.

4. Append evidence phase=discovery. Update understanding.md §8. Mark G5 done.

Commit: `"odyssey-debug({slug}): DISCOVER — sibling triage complete"`

### A_RECORD

1. Finalize understanding.md §9 — learnings by Knowledge Persistence categories:
   - Recurring root cause pattern → `/spec-add debug`
   - Non-obvious workaround → `/spec-add learning`
   - Architecture boundary violation → `/spec-add arch`
   - Reusable generalization pattern → `/spec-add coding`

2. Mark G6 done. Pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count).

3. **Goal audit (hardened):**
   - `done` → confirmed
   - `skipped` → confirmed ONLY if corresponding `skip_when` flag is true
   - **Hard rule:** G4 and G5 CANNOT be `skipped` unless `skip_generalize == true`. Pending without flag → `failed` (Normal: AskUserQuestion | `-y`: record `failed`)
   - `phase_goals_all_done = true` only when all goals pass this audit

4. `current_state = "COMPLETED"`, emit completion summary.

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

Commit: `"odyssey-debug({slug}): RECORD — summary and knowledge persistence"`

</actions>

<appendix>

### `-y` debug-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_DIAGNOSE ambiguity | AskUserQuestion | deferred |
| A_ESCALATE 3-strike | AskUserQuestion | INCONCLUSIVE |
| A_FIX direction | AskUserQuestion | auto proceed |
| A_DISCOVER hit routing | AskUserQuestion | auto-fix bugs with template, create issue for rest |

### Goal Prompt convergence rules

```
Stop when root cause confirmed (or INCONCLUSIVE), fix verified,
generalization exhausted, phase_goals_all_done=true.
All sibling bugs fixed or issued — no leftovers.
```

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No issue, no session | Provide issue or -c |
| W001 | warning | No relevant git history | Proceed |
| W002 | warning | 3 retries exhausted | INCONCLUSIVE |
| W003 | warning | Partial archaeology agent failure (Timeline or Blame) | Proceed with available results, log failed agent |
| W005 | warning | Pending decisions | Filter evidence phase=decision |
| W006 | warning | No CLI tools | Skip explore |
| W007 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
</error_codes>

<success_criteria>
- [ ] Session + 4 output files + prior knowledge searched
- [ ] Archaeology + CLI review → evidence phase=archaeology
- [ ] CLI exploration → explore.json + evidence phase=explore
- [ ] Hypotheses tested, root cause with evidence refs
- [ ] understanding.md 9 sections progressive
- [ ] Fix + confirmed (unless --skip-fix)
- [ ] Generalization + scan (unless --skip-generalize)
- [ ] Discoveries classified; unfixed findings individually justified
- [ ] phase_goals + goal audit + resumable via -c
- [ ] Completion summary
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Discovery issues | `/manage-issue list --source debug-odyssey` |
| Document pattern | `/learn-decompose <module>` |
| Formal review | `maestro run create review -- <phase>` |
| Second opinion | `/learn-second-opinion <understanding.md>` |
| Related question | `/learn-investigate "<question>"` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
