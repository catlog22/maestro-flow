---
name: odyssey-review-test-fix
description: Deep review + fix cycle — archaeology, exploration, multi-dimensional review, targeted fix, generalization, discovery, and knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--fix-threshold critical|high|medium|low|all] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
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
archaeology → explore → multi-dimensional review → fix ALL findings → confirm → generalize → discover → persist. Zero-residual: every finding gets an action.
</purpose>

<boundary>
**In scope:** Multi-dimensional deep review of target code → exhaustive fix ALL findings by severity → generalize patterns project-wide.
**Out of scope:** Root cause debug → `/odyssey-debug` | Feature implementation → `/odyssey-planex` | UI visual optimization → `/odyssey-ui`

**Exploration freedom:** Free within boundary — cross-dimension correlation, git history tracing, project-wide generalization scan. Fix ALL findings within fix_threshold (default: all).
**Zero-residual:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" and "pre-existing skip" are forbidden.
</boundary>

<context>
$ARGUMENTS

**Target resolution:**

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | state.json → changed files |
| PR number | `git diff main...HEAD` |

**Flags:** `--dimensions <list>` subset of review dimensions | `--fix-threshold <level>` severity cutoff (default: all) | `--skip-fix` skip S_FIX+S_CONFIRM | `--skip-generalize` skip S_GENERALIZE+S_DISCOVER | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Session**: `.workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`
**Output**: `session.json` | `evidence.ndjson` | `explore.json` | `understanding.md`

**Output boundary**: ALL session artifacts MUST target the session directory (`.workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`) or `.workflow/state.json` only. Source code modifications during S_FIX are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json — review-specific fields:**
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
| G4 | Pattern generalized | patterns[] >=1 | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries or no actionable | S_RECORD | — |

**understanding.md — 8 sections:**
1. Target & Scope ← S_INTAKE | 2. Archaeology ← S_ARCHAEOLOGY | 3. Exploration ← S_EXPLORE
4. Review Results ← S_REVIEW | 5. Fix & Confirmation ← S_FIX+S_CONFIRM
6. Generalization ← S_GENERALIZE | 7. Discoveries ← S_DISCOVER | 8. Learnings ← S_RECORD

Specs: `maestro load --type spec --category review`

**Knowledge Persistence categories (section 8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Cross-dimension recurring pattern | Pattern + affected dimensions + coding standard | `/spec-add review` |
| Security finding | Vulnerability type + triggers + fix approach | `/spec-add debug` |
| Architecture violation pattern | Violation + correct boundary + verification | `/spec-add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `/spec-add coding` |
</context>

<invariants>
All invariants defined in base.
6. **Generalize is mandatory** — S_GENERALIZE and S_DISCOVER execute unless `skip_generalize == true`. "Zero remaining" or context pressure are NOT valid reasons to skip. The phase itself determines whether patterns exist.
</invariants>

<self_iteration>
Applies to: **S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE**. Logic in base.
</self_iteration>

<execution>
Follow base execution discipline completely. Actions defined in state_machine below.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: INTAKE → ARCHAEOLOGY**
- REQUIRED: Target resolved to file list, SESSION_DIR created, session.json initialized.
- REQUIRED: phase_goals[] derived from flags, understanding.md §1 written.
- BLOCKED if: no target specified (E001) or target path not found (E002).

**GATE 2: ARCHAEOLOGY → EXPLORE**
- REQUIRED: Git history analysis completed (timeline + blame agents), evidence phase=archaeology logged.
- REQUIRED: understanding.md §2 updated.
- BLOCKED if: both archaeology agents failed AND delegate failed (partial results via W003 are acceptable).

**GATE 3: EXPLORE → REVIEW**
- REQUIRED: explore.json written with call_chains/recent_changes/error_gaps/similar_patterns (or W006 skip logged).
- REQUIRED: Evidence phase=explore logged, understanding.md §3 updated, G2 marked done.
- BLOCKED if: exploration started but not completed (W006 skip is acceptable, incomplete is not).

**GATE 4: REVIEW → FIX**
- REQUIRED: All dimension agents completed, findings merged with severity classification.
- REQUIRED: review_result written to session.json, understanding.md §4 with severity matrix, G1 marked done.
- BLOCKED if: zero dimensions reviewed (W002 partial is allowed, zero is not).

**GATE 5: FIX → CONFIRM**
- REQUIRED: Current severity tier fully addressed — all findings in tier fixed or individually classified.
- REQUIRED: Per-fix evidence phase=fix logged, auto-commit per tier.
- BLOCKED if: tier incomplete — no partial tier advancement.

**GATE 6: CONFIRM → GENERALIZE**
- REQUIRED: Tests pass, remaining_actionable == 0, new findings == 0.
- REQUIRED: confirmation written, understanding.md §5 updated, G3 marked done.
- BLOCKED if: needs_rework → route back to S_FIX.

**GATE 7: GENERALIZE → DISCOVER**
- REQUIRED: ALL 3 layers (syntax/semantic/structural) attempted with evidence logged.
- REQUIRED: generalization_stats written with by_layer entries for all 3 layers, G4 marked done.
- BLOCKED if: any layer not attempted (thoroughness floor violation).

**GATE 8: DISCOVER → RECORD**
- REQUIRED: All hits triaged with per-item classification and reason.
- REQUIRED: remaining_actionable == 0 OR loops >= max_loops with per-item reasons logged.
- REQUIRED: G5 marked done.
- BLOCKED if: unclassified hits remain.

</execution>

<state_machine>

<states>
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME_SESSION
S_INTAKE → S_ARCHAEOLOGY  : target resolved → A_INTAKE
S_INTAKE → S_INTAKE       : no target → AskUserQuestion

S_ARCHAEOLOGY → S_EXPLORE     : complete
S_EXPLORE     → S_REVIEW      : complete

S_REVIEW  → S_FIX          : !skip_fix AND findings
S_REVIEW  → S_GENERALIZE   : skip_fix OR no findings, !skip_generalize
S_REVIEW  → S_RECORD       : both skip

S_FIX     → S_CONFIRM      : tier complete
S_CONFIRM → S_GENERALIZE   : confirmed, !skip_generalize
S_CONFIRM → S_RECORD       : confirmed, skip_generalize
S_CONFIRM → S_FIX          : needs_rework

S_GENERALIZE → S_DISCOVER  : similar code found
S_GENERALIZE → S_RECORD    : all 3 layers scanned with evidence, total_hits == 0

S_DISCOVER → S_FIX         : fixable sibling → cross_phase_loops++
S_DISCOVER → S_REVIEW      : new target, loops < max_loops → cross_phase_loops++
S_DISCOVER → S_RECORD      : remaining_actionable == 0 OR loops >= max_loops
</transitions>

<actions>

### A_INTAKE
1. Parse target + flags → file list. Create SESSION_DIR, derive phase_goals[]
2. `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + Grep keywords
3. Write `session.json` + `understanding.md` section 1, emit Goal Prompt

Commit: `"odyssey-review({slug}): INTAKE — parse target and load context"`

### A_RESUME_SESSION
Glob latest session → read `session.json` → jump to `current_state`.

### A_ARCHAEOLOGY
2 parallel Agents: Timeline (`git log --oneline -20 -- {files}`) + Blame (top 3 files `git blame -L {region}`). Evidence phase=archaeology.

**Error handling:** If any archaeology agent fails (Timeline or Blame), log W003 and proceed with available results. If delegate fails, log W003 and proceed with local agent results only.

`maestro delegate --role analyze --mode analysis` (`run_in_background: true`):
- PURPOSE: Review recent modifications related to {target}
- EXPECTED: JSON [{commit_sha, risk_level, analysis, could_cause_issue, explanation}]

Update section 2. Commit: `"odyssey-review({slug}): ARCHAEOLOGY — git history analysis"`

### A_EXPLORE
Skip if no CLI tools (W006).

`maestro delegate --role explore --mode analysis` (`run_in_background: true`):
- PURPOSE: Call chains, recent changes, error gaps, similar patterns
- EXPECTED: JSON {call_chains, recent_changes, error_gaps, similar_patterns}

Write `explore.json` + evidence phase=explore. Update section 3. Mark G2. Commit: `"odyssey-review({slug}): EXPLORE — codebase exploration"`

### A_REVIEW
Spawn N parallel Agents, one per dimension:
- **Correctness**: logic errors, boundary conditions, null/undefined, race conditions
- **Security**: injection, XSS, CSRF, data exposure, auth bypass
- **Performance**: hot paths, N+1, memory leaks, unnecessary recomputation
- **Architecture**: layer violations, circular deps, interface contracts, SoC

Each returns `[{title, severity, file, line, description, suggestion, cwe}]`. Merge → evidence phase=review. Write `review_result` + section 4 severity matrix. Mark G1.

Commit: `"odyssey-review({slug}): REVIEW — multi-dimension review complete"`

### A_FIX
Exhaustive iterative fix — descend by severity until `remaining_actionable == 0`.

```
for tier in [critical, high, medium, low].filter(>= threshold):
  for each unfixed candidate: read +/-20 lines → fix → evidence phase=fix
  re-review modified area (new findings → append, continue; max 2 per tier)
  tier done → auto-commit
```

Normal: AskUserQuestion per tier. `-y`: auto-fix all.
Remaining > 0 → retry (max_fix_rounds = 5). Unchanged 2 rounds → classify each individually. After 5 rounds with remaining > 0 → escalate: Normal: AskUserQuestion (continue/accept/reclassify) | `-y`: classify remaining as `deferred`, proceed.
Blanket "pre-existing" forbidden.

Commit per tier: `"odyssey-review({slug}): FIX-{tier} — {N} items fixed"`

### A_CONFIRM
Run tests + `maestro delegate --role review --mode analysis` (`run_in_background: true`) for zero-residual review.
- `remaining == 0 AND new == 0` → confirmed, mark G3
- Otherwise → needs_rework → S_FIX

Update `confirmation` + `remaining_actionable` + section 5.

Commit: `"odyssey-review({slug}): CONFIRM — zero-residual verified"`

### A_GENERALIZE

**MANDATORY — executes unless `skip_generalize == true`. Prior-phase convergence, "zero remaining," or context pressure are NOT valid skip reasons.**

Pattern source: review findings with severity >= medium.

**Step 1 — 3-layer pattern extraction** from confirmed findings:

| Layer | Method | Targets |
|-------|--------|---------|
| Syntax | Build regex from fix diffs → Grep | Unchecked return values, deprecated API calls, missing type assertion, unhandled await |
| Semantic | Understand anti-pattern per dimension → Agent scan | Logic inversion in edge case, unhandled rejection, incomplete state machine transition |
| Structural | Find files with same handler/validator shape | Similar route handlers, parallel DTO validators, analogous test fixtures |

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

**Step 5 — Persist:** Update understanding.md section 6 + write `session.json.generalization_stats`:
```json
{"patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {"syntax": 0, "semantic": 0, "structural": 0}, "deepening_triggered": false}
```

**Transition guard:** `S_GENERALIZE → S_RECORD` requires `by_layer` has entries for all 3 layers with search evidence logged. Mark G4 done.

Commit: `"odyssey-review({slug}): GENERALIZE — pattern scan complete"`

### A_DISCOVER

**Executes whenever `total_hits > 0`. Cannot be skipped without `skip_generalize == true`.**

1. **Triage** each hit with ±10 lines context → classify:
   - `bug` — same defect pattern confirmed in sibling code
   - `risk` — potential issue needing guard
   - `safe` — false positive (must log individual reason — blanket "pre-existing" forbidden)

2. **Route:**

   | Classification | Action |
   |---------------|--------|
   | fixable sibling | Immediate fix → back to S_FIX, `cross_phase_loops++` |
   | new target needing review | Route to S_REVIEW, `cross_phase_loops++` |
   | risk + guard addable | Fix directly |
   | risk + complex | Create issue |
   | safe | Skip with logged per-item reason |

   Normal: AskUserQuestion per hit | `-y`: auto-fix with template, create issue for rest

3. **Cross-phase loops:** `loops >= max_loops` → must log per-item reasons, advance to S_RECORD.

4. Append evidence phase=discovery. Update understanding.md section 7. Mark G5 done.

Commit: `"odyssey-review({slug}): DISCOVER — sibling triage complete"`

### A_RECORD

1. Finalize understanding.md section 8 — learnings by Knowledge Persistence categories:
   - Cross-dimension recurring pattern → `/spec-add review`
   - Security finding → `/spec-add debug`
   - Architecture violation pattern → `/spec-add arch`
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

Commit: `"odyssey-review({slug}): RECORD — summary and knowledge persistence"`

</actions>

<appendix>

### `-y` review-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| S_FIX tier candidates | AskUserQuestion | auto-fix, deferred |
| S_FIX re-review new findings | AskUserQuestion | auto-append |
| S_CONFIRM needs_rework | Display → S_FIX | auto proceed |
| A_DISCOVER hit routing | AskUserQuestion | auto-fix with template, create issue for rest |

### Goal Prompt convergence rules

```
Stop when remaining_actionable == 0, confirmation == confirmed,
generalization exhausted, phase_goals_all_done=true.
Fix iterates by severity tier; each tier re-reviews modified area, new findings appended.
Every finding must have action (fix/issue/decision). Decision pending must AskUserQuestion.
```

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| W001 | warning | No git history | Proceed |
| W002 | warning | Some dimension agents failed | Partial coverage |
| W003 | warning | Archaeology agent or delegate failure | Proceed with available results |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
</error_codes>

<success_criteria>
- [ ] Session + 4 output files + prior knowledge searched
- [ ] Archaeology + CLI review → evidence phase=archaeology
- [ ] CLI exploration → explore.json + evidence phase=explore
- [ ] All dimensions reviewed, ALL findings fixed (remaining_actionable == 0)
- [ ] Per-tier re-review gate; every unfixed finding individually classified
- [ ] understanding.md sections 1-8 progressive
- [ ] Fix + confirmed (unless --skip-fix)
- [ ] Generalization + scan (unless --skip-generalize)
- [ ] Discoveries classified; unfixed findings individually justified
- [ ] phase_goals G1-G6 audited, Goal Prompt once, `-y` no blocking, -c resumable
- [ ] Completion summary
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Deeper debug needed | `/odyssey-debug "<finding>"` |
| Issues created | `/manage-issue list --source review-odyssey` |
| Document pattern | `/learn-decompose <module>` |
| Plan fixes | `/maestro-plan --gaps` |
</next_step_routing>
</output>
