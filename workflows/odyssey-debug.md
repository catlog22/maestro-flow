---
name: odyssey-debug
prepare: odyssey-debug
session-mode: inherited
---

# Workflow: Odyssey Debug

## State Chain

```
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_DIAGNOSE → S_FIX → S_CONFIRM → [back-half]
```

Back-half: `S_GENERALIZE → S_DISCOVER → S_RECORD → END` (see odyssey-base.md).

---

## Boundary

**In scope:** Single bug/issue full loop — symptom → root cause → fix → confirm → generalize.
**Out of scope:** Features → `--mode planex` | Quality review → `--mode review` | UI → `--mode ui` | Architecture → `/maestro-next plan`

---

## `--template <name>`

| Template | Strategy | Use case |
|----------|----------|----------|
| `performance` | profiling → hot path → allocation → cache | Performance degradation |
| `memory-leak` | heap snapshot → retention chain → lifecycle | Memory leaks |
| `race-condition` | timeline → concurrent access → lock analysis | Race conditions |
| `regression` | git bisect → diff analysis → boundary check | Regressions |
| `crash` | stack trace → null chain → error propagation | Crashes / exceptions |

---

## Target Resolution

Issue description parsed from `<intent>`.

---

## Session Fields

```json
{ "issue": "", "diagnosis_retries": 0, "root_cause": null, "confirmation": null,
  "patterns": [], "generalization_stats": null }
```

---

## evidence.ndjson Phases

`archaeology|explore|diagnosis|discovery|decision|self-iteration`

- `archaeology`: `sha`, `author`, `date`, `message`, `relevance`
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)
- `discovery`: `file`, `line`, `classification` (safe|risk|bug), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status` (pending|resolved|deferred), `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

---

## explore.json

```json
{"call_chains": [], "recent_changes": [], "error_gaps": [], "similar_patterns": [], "cli_tool": "", "timestamp": ""}
```

---

## phase_goals[]

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Root cause identified | phase=diagnosis result=confirmed | S_DIAGNOSE | — |
| G2 | Explore context gathered | explore.json ≥1 category | S_EXPLORE | — |
| G3 | Fix applied and confirmed | confirmation.overall == confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR none actionable | S_RECORD | — |

---

## understanding.md — 9 Sections

1. Issue & Scope
2. Archaeology
3. Exploration
4. Hypotheses
5. Root Cause
6. Fix & Confirmation
7. Generalization
8. Discoveries
9. Learnings

---

## State Machine — Transitions

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

---

## Actions

### A_ARCHAEOLOGY

2 parallel Agents:
- **Timeline**: `git log --oneline -20 -- {files}`
- **Blame**: top 3 files `git blame -L {region}`

Evidence phase=archaeology.

`maestro delegate --role analyze --mode analysis` (`run_in_background: true`):
- PURPOSE: review recent modifications related to {issue}
- EXPECTED: JSON `[{commit_sha, risk_level, analysis, could_cause_issue, explanation}]`

Update §2 (Archaeology).

If an archaeology agent fails, log W003 and proceed with available results.

### A_EXPLORE

Skip if no CLI tools (W006).

`maestro delegate --role explore --mode analysis` (`run_in_background: true`):
- PURPOSE: call chains, recent changes, error gaps, similar patterns
- EXPECTED: JSON `{call_chains, recent_changes, error_gaps, similar_patterns}`

Write `explore.json` + evidence phase=explore. Update §3 (Exploration). Mark G2.

**GATE: discovery-complete** — archaeology/explore evidence logged, understanding.md §2-§3 updated, G2 marked (W003 partial / W006 skip acceptable).

### A_DIAGNOSE

1. Generate hypotheses from evidence, ranked [HIGH]/[MEDIUM]/[LOW] → §4.
2. Test each hypothesis → evidence phase=diagnosis.
3. Ambiguity → evidence phase=decision:
   - Normal: [@ask] AskUserQuestion
   - `-y`: defer
4. Confirmed → `session.json.root_cause` + §5 (Root Cause). Mark G1.

**GATE: diagnosis-confirmed** — all hypotheses tested with evidence, root cause confirmed with reproduction or code/log evidence (or INCONCLUSIVE after 3-strike), understanding.md §4-§5 written. Zero hypotheses tested is BLOCKED.

### A_ESCALATE_DIAGNOSIS

`diagnosis_retries++`.

- **retries < 3**: `maestro delegate --role analyze`, generate new hypotheses, → S_DIAGNOSE.
- **retries >= 3**:
  - Normal: [@ask] AskUserQuestion
  - `-y`: INCONCLUSIVE → S_RECORD

### A_FIX

1. Present root cause + proposed fix.
   - Normal: [@ask] AskUserQuestion
   - `-y`: auto proceed
2. Implement fix, evidence phase=decision.

### A_CONFIRM

1. Run covering tests.
2. `maestro delegate --role review --mode analysis` (`run_in_background: true`):
   - EXPECTED: JSON `{verdict, findings [{severity, description, suggestion}], regression_risk}`
3. `session.json.confirmation`:
   ```json
   {"test_result": "", "cli_review": {}, "overall": "confirmed|needs_rework"}
   ```
4. Update §6 (Fix & Confirmation).
   - `needs_rework` → S_FIX
   - `confirmed` → mark G3

**GATE: fix-confirmed** — fix implemented and tests pass, CLI review done, `confirmation.overall` set, understanding.md §6 written, G3 marked. `needs_rework` routes back to FIX; skippable only when `skip_fix == true`.

---

## Generalize Source

Confirmed root cause + applied fix.

**Thoroughness floor:** ALL 3 layers (syntax/semantic/structural) must be attempted and logged.

**Discover routing:** `bug` → back to S_FIX; new bug → S_DIAGNOSE.

---

## Knowledge Persistence (§9)

| Category | Content | Follow-up |
|----------|---------|-----------|
| Recurring root cause pattern | Type + triggers + fix + detection | `/maestro-spec add debug` |
| Non-obvious workaround | Problem + steps + why obvious fix fails | `/maestro-spec add learning` |
| Architecture boundary violation | Violation + correct boundary + verification | `/maestro-spec add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `/maestro-spec add coding` |

---

## Completion Summary

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

---

## `-y` Decision Points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_DIAGNOSE ambiguity | [@ask] AskUserQuestion | deferred |
| A_ESCALATE 3-strike | [@ask] AskUserQuestion | INCONCLUSIVE |
| A_FIX direction | [@ask] AskUserQuestion | auto proceed |

---

## Mode-Specific Phase Gates

- **Discovery gate** (ARCHAEOLOGY/EXPLORE): evidence for the phase logged, understanding.md updated, discovery goal marked. Archaeology partial via W003 acceptable; explore W006 skip acceptable.
- **Audit gate** (DIAGNOSE): all hypotheses tested or confirmed, findings merged with severity classification. Zero dimensions reviewed is BLOCKED (W002 partial allowed).
- **FIX gate:** current severity tier fully addressed. Per-fix evidence phase=fix logged. Auto-commit per tier.
- **CONFIRM gate:** tests pass; `remaining_actionable == 0` and new findings == 0; confirmation written, understanding.md updated, verify goal marked. needs_rework → route back to FIX.

---

## Error Codes (debug-specific)

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No issue, no session | Provide issue or -c |
| W003 | warning | Archaeology agent or delegate failure | Proceed with available results |
| W006 | warning | No CLI tools | Skip explore |

---

## Success Criteria (debug-specific)

- [ ] Session + 4 output files + prior knowledge searched
- [ ] Archaeology + CLI review → evidence
- [ ] CLI exploration → explore.json
- [ ] Hypotheses tested, root cause with evidence refs
- [ ] understanding.md 9 sections progressive
- [ ] Fix + confirmed (unless --skip-fix)
- [ ] Generalization + scan (unless --skip-generalize)
- [ ] Discoveries classified; unfixed findings individually justified
- [ ] phase_goals + goal audit + resumable via -c
- [ ] Completion summary

---

## Next Step Routing (debug-specific)

| Condition | Next |
|-----------|------|
| Discovery issues | `/maestro-manage issue list --source debug-odyssey` |
| Document pattern | `/maestro-learn decompose <module>` |
| Formal review | `/maestro-odyssey <changed-files> --mode review` |
| Second opinion | `/maestro-learn consult <understanding.md>` |
| Related question | `/maestro-learn investigate "<question>"` |
| Pending decisions | Filter evidence phase=decision status=pending |
