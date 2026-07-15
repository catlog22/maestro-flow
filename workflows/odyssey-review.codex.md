<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Workflow: Odyssey Review (Codex)

Codex-adapted: uses `spawn_agents_on_csv`, `request_user_input`, `create_goal`/`update_goal`.

## State Chain

```
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → [back-half]
```

Back-half: `S_GENERALIZE → S_DISCOVER → S_RECORD → END` (see odyssey-base-codex.md).

---

## Boundary

**In scope:** Multi-dimensional deep review of target code → exhaustive fix ALL findings by severity → generalize patterns project-wide.
**Out of scope:** Root cause debug → `--mode debug` | Feature implementation → `--mode planex` | UI visual optimization → `--mode ui`. Zero-residual applies (fix ALL findings within fix_threshold, default all).

---

## Target Resolution

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | state.json → changed files |
| PR number | `git diff main...HEAD` |

---

## Session Fields

```json
{ "target": "", "dimensions": [], "review_result": {"remaining_actionable": 0},
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

---

## evidence.ndjson Phases

`archaeology|explore|review|fix|discovery|decision|self-iteration`

---

## phase_goals[]

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Review completed | all dimensions reviewed | S_REVIEW | — |
| G2 | Explore context | explore.json populated | S_EXPLORE | — |
| G3 | Zero remaining | `remaining_actionable == 0` | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries or no actionable | S_RECORD | — |

`create_goal({ description: "Review: {intent_summary}", condition: "G1-G6 all done or skipped per flags" })`

---

## understanding.md — 8 Sections

1. Target & Scope
2. Archaeology
3. Exploration
4. Review Results
5. Fix & Confirmation
6. Generalization
7. Discoveries
8. Learnings

Specs: `maestro load --type spec --category review`.

---

## State Machine — Transitions

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

---

## Actions

### A_ARCHAEOLOGY

Generate `archaeology.csv` with 2 rows for parallel agents:

```csv
id,title,description,target,deps,status,findings,error
"1","Timeline","Run git log --oneline -20 -- {files} for target files. Identify recent changes, authors, and change frequency. Return JSON: [{commit_sha, date, author, message, files_changed}]","{target}","","","",""
"2","Blame","Run git blame -L {region} on top 3 files by change frequency. Identify ownership patterns and recent modifications. Return JSON: [{file, line_range, author, commit_sha, date, content_summary}]","{target}","","","",""
```

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/archaeology.csv`,
  id_column: "id",
  instruction: "You are performing git archaeology on target code. Read 'description' for your specific task and 'target' for the files to analyze. Use git commands to gather evidence. Write findings as a concise summary.",
  max_concurrency: 2,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/archaeology-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, error }
})
```

Evidence phase=archaeology.

`maestro delegate --role analyze --mode analysis` (`run_in_background: true`):
- PURPOSE: review recent modifications related to {target}
- EXPECTED: JSON `[{commit_sha, risk_level, analysis, could_cause_issue, explanation}]`

Update §2 (Archaeology).

If an archaeology agent fails, log W003 and proceed with available results.

### A_EXPLORE

Skip if no CLI tools (W006).

`maestro delegate --role explore --mode analysis` (`run_in_background: true`):
- PURPOSE: call chains, recent changes, error gaps, similar patterns
- EXPECTED: JSON `{call_chains, recent_changes, error_gaps, similar_patterns}`

Write `explore.json` + evidence phase=explore. Update §3 (Exploration). Mark G2. `update_goal({ id: explore_goal_id, status: "completed" })`

**GATE: discovery-complete** — archaeology/explore evidence logged, understanding.md §2-§3 updated, G2 marked (W003 partial / W006 skip acceptable).

### A_REVIEW

Generate `review-dimensions.csv` with 4 dimension rows:

```csv
id,dimension,focus,target,deps,status,findings_json,error
"1","Correctness","Logic errors, boundary conditions, null/undefined handling, race conditions, type mismatches, off-by-one errors, missing error handling","{target}","","","",""
"2","Security","Injection vulnerabilities, XSS, CSRF, data exposure, auth bypass, insecure defaults, secret leakage, path traversal","{target}","","","",""
"3","Performance","Hot paths, N+1 queries, memory leaks, unnecessary recomputation, missing caching, blocking operations, large allocations","{target}","","","",""
"4","Architecture","Layer violations, circular dependencies, interface contract breaks, separation of concerns, abstraction leaks, coupling issues","{target}","","","",""
```

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/review-dimensions.csv`,
  id_column: "id",
  instruction: "You are reviewing code for a specific dimension. Read 'dimension' and 'focus' columns for your review scope. Read 'target' for the files to review. Scan target files thoroughly, identify issues matching your dimension. Return findings_json as a JSON array: [{title, severity, file, line, description, suggestion, cwe}]. Severity levels: critical, high, medium, low.",
  max_concurrency: 4,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/review-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings_json, error }
})
```

Merge all dimension findings → evidence phase=review. Write `review_result` + §4 severity matrix. Mark G1. `update_goal({ id: review_goal_id, status: "completed" })`

**GATE: all-dimensions-reviewed** — all 4 dimension agents (correctness, security, performance, architecture) completed, findings merged into review_result with severity classification, evidence phase=review logged, §4 severity matrix written, G1 marked. Zero dimensions reviewed is BLOCKED (W002 partial with ≥1 dimension allowed).

### A_FIX

Exhaustive iterative fix — descend by severity until `remaining_actionable == 0`:
```
for tier in [critical, high, medium, low].filter(>= threshold):
  for each unfixed candidate: read ±20 lines → fix → evidence phase=fix
  re-review modified area (new findings → append, continue; max 2 per tier)
  tier done → auto-commit
```
Normal: `request_user_input` per tier | `-y`: auto-fix all. Remaining > 0 → retry (**MANDATORY hard limit: max_fix_rounds = 5**). Unchanged 2 rounds → classify each individually. After 5 rounds remaining > 0 → escalate: Normal: `request_user_input` (continue/accept/reclassify) | `-y`: classify remaining as `deferred`, proceed. **No partial-tier advancement** — a tier is complete only when every finding is fixed or individually classified. Blanket "pre-existing" forbidden. Commit per tier: `"odyssey-review({slug}): FIX-{tier} — {N} items fixed"`.

### A_CONFIRM

Run tests + `maestro delegate --role review --mode analysis` (`run_in_background: true`) zero-residual review. `remaining == 0 AND new == 0` → confirmed, mark G3 `update_goal({ id: confirm_goal_id, status: "completed" })`; otherwise → needs_rework → S_FIX. Update `confirmation` + `remaining_actionable` + §5.

**GATE: zero-remaining** — exhaustive fix applied tier-by-tier, `remaining_actionable == 0` (or all remaining individually classified as deferred after 5-round escalation), tests pass, CLI re-review confirms no new findings, confirmation + §5 written, G3 marked. `needs_rework` routes back to FIX; skippable only when `skip_fix == true`.

---

## Generalize Source

Review findings with severity >= medium.

**Discover routing:** fixable sibling → S_FIX; new target → S_REVIEW.

---

## Knowledge Persistence (§8)

| Category | Content | Follow-up |
|----------|---------|-----------|
| Cross-dimension recurring pattern | Pattern + affected dimensions + coding standard | `$spec add review` |
| Security finding | Vulnerability type + triggers + fix approach | `$spec add debug` |
| Architecture violation pattern | Violation + correct boundary + verification | `$spec add arch` |
| Reusable generalization pattern | Signature + risk + fix template + scope | `$spec add coding` |

---

## Completion Summary

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

---

## `-y` Decision Points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| S_FIX tier candidates | `request_user_input` | auto-fix `deferred` |
| S_FIX re-review new findings | `request_user_input` | auto-append |
| S_CONFIRM needs_rework | `request_user_input` | auto proceed |
| A_DISCOVER routing | `request_user_input` | auto-fix w/ template, issue for rest |

---

## Mode-Specific Phase Gates

- **Discovery gate** (ARCHAEOLOGY/EXPLORE): evidence logged, understanding.md updated. Archaeology partial via W003 acceptable; explore W006 skip acceptable.
- **Audit gate** (REVIEW): all dimension agents completed, findings merged. Zero dimensions reviewed is BLOCKED (W002 partial allowed).
- **FIX gate:** current severity tier fully addressed. Per-fix evidence logged. Auto-commit per tier. No partial-tier advancement.
- **CONFIRM gate:** tests pass; `remaining_actionable == 0` and new findings == 0; confirmation written. needs_rework → route back to FIX.

---

## Error Codes (review-specific)

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| W003 | warning | Archaeology agent failure | Proceed with available results |
| W006 | warning | No CLI tools | Skip explore |

---

## Success Criteria (review-specific)

- [ ] Session + 4 output files + prior knowledge searched
- [ ] Archaeology + CLI review → evidence
- [ ] CLI exploration → explore.json
- [ ] All 4 dimensions reviewed with findings merged
- [ ] understanding.md 8 sections progressive
- [ ] Exhaustive fix by severity tier + confirmed (unless --skip-fix)
- [ ] Generalization + scan (unless --skip-generalize)
- [ ] Discoveries classified; unfixed findings individually justified
- [ ] phase_goals + goal audit + resumable via -c
- [ ] Completion summary

---

## Next Step Routing (review-specific)

| Condition | Next |
|-----------|------|
| Discovery issues | `$manage issue list --source review-odyssey` |
| Document pattern | `$learn decompose <module>` |
| Debug root cause | `$odyssey <issue> --mode debug` |
| Second opinion | `$learn consult <understanding.md>` |
| Related question | `$learn investigate "<question>"` |
| Pending decisions | Filter evidence phase=decision status=pending |
