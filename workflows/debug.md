---
name: debug
prepare: debug
commands: [quality-debug]
session-mode: inherited
---

# Workflow: Debug

Scientific method for root-cause isolation — subagent isolation, persisted investigation state, confidence scoring. Three entry modes (standalone / from-test / parallel), produces only diagnosis and fix directions.

Full investigation discipline (Iron Law, Red Flags, Rationalization Table, 3-strike architecture check, backward tracing) is in `ref/scientific-debug.md`.

---

## Step 1: Check for an active session

The runtime supplies active debug investigation state (session resolution and Run enumeration are handled by the runtime); an active investigation is identified by its `understanding.md` header (status and current hypothesis).

**Active session and no arg**: show a list (number, location, status, current hypothesis), wait for response. Number → resume (load state, Step 12 dispatches a continuation agent); text → new issue (Step 3 or Step 2).

| Result | Action |
|------|------|
| has session, no arg | offer a resume list |
| has session, has arg | start a new investigation |
| no session, no arg | error E001 |
| no session, has arg | enter the corresponding mode |

On resume, load `understanding.md` + `evidence.ndjson`, dispatch a continuation agent.

---

## Step 1.5: Load specs

```
# Mandatory, cannot be substituted with manual Read/Grep
specs_content = maestro spec load --category debug
→ passed to the debug agent as prior knowledge
```

---

## Step 2: Load test gaps (if --from-test)

If not set, skip to Step 3. Read the Gaps section of `latest-test`. Each gap:

```yaml
- test: T-003
  truth: "User can reply to comments"
  status: failed
  reason: "User reported: clicking reply does nothing"
  severity: major
  requirement_ref: SC-002
```

**Cluster by component/area**: parse the affected features from truth + reason, group by likely component (same module/same flow/same file area), each cluster becomes one investigation.

| Cluster | Example |
|------|----|
| same component | T-003(reply) + T-004(edit) → "comment-actions" |
| same flow | T-001(login) + T-002(session) → "auth-flow" |
| unrelated | T-005(nav color) → standalone "nav-styling" |

**candidate enrichment**: for each gap with a `candidate_ref`, look up the issue candidate and attach `issue_context`.

`--parallel` → Step 5; otherwise → Step 6 (sequential).

---

## Step 3: Collect symptoms (standalone)

Skip when `--from-test`. Generate a slug from the issue description (lowercase, hyphenated, ≤40 chars).

Ask 5 questions: 1) what should happen (expected) 2) what actually happens (actual) 3) error message 4) when it started, was it ever working 5) how to trigger (reproduction steps). Also collect `git log --oneline -10`, `git diff --stat HEAD~3`.

Store responses → create the debug session directory → Step 6.

---

## Step 4: Determine output directory

| Mode | Directory |
|------|------|
| scope-scoped (from test) | current run's `outputs/debug/{gap-slug}/` |
| standalone | current run's `outputs/debug-{slug}/` |

Create the directory.

---

## Step 5: Parallel debug agents — mandatory, not substitutable

Dispatch an agent per cluster concurrently (`run_in_background: false`):

- **Input**: cluster name, scope, all gaps (test_id, truth, reason, severity). Mode: `symptoms_prefilled`.
- **Process**: form 2-3 hypotheses per gap, search code for evidence, record NDJSON, confirm/refute.
- **Output per gap**: `root_cause`, `fix_direction`, `affected_files` (file:line), `confidence` (multi-factor), `evidence` summary.
- **Files**: `{debug_dir}/evidence-{cluster_slug}.ndjson`, `{debug_dir}/understanding-{cluster_slug}.md`.

---

## Step 5.5: CLI supplementary evidence-gathering (optional)

Skip if no CLI tool is enabled or the standalone context is minimal. Use the symptom summary to ask the CLI to trace the call chain, find recent changes to related files, identify error-handling gaps, and find similar patterns. See `ref/cli-supplementary.md`. Append the callback results as evidence with `type: "cli-exploration"`, and pass them as supplementary_context to the Step 5/6 agent.

---

## Step 6: Single debug agent (sequential) — mandatory, not substitutable

Dispatch an agent (`run_in_background: false`):

- **Input**: slug, description, symptoms. `symptoms_prefilled: {true when from test}`, goal: `find_and_fix`.
- **Process**: form hypotheses, test each one, record NDJSON evidence, update `understanding.md`.
- **Returns**: `## ROOT CAUSE FOUND` | `## CHECKPOINT REACHED` | `## INVESTIGATION INCONCLUSIVE`.
- **Files**: `{debug_dir}/understanding.md`, `{debug_dir}/evidence.ndjson`.

---

## Step 7: Collect unified results

Write `outputs/diagnosis.json` (artifact paths and metadata are declared in `prepare/debug.md` contract):

```json
{
  "session_id": "{debug session ID}",
  "completed_at": "{ISO}",
  "status": "confirmed|partial|inconclusive",
  "clusters": [
    { "name": "{cluster}", "gaps": [
      { "test_id": "T-003", "root_cause": "...", "fix_direction": "...",
        "affected_files": ["src/components/Comments.tsx:42"],
        "confidence": { "overall": 0.78, "dimensions": {} } } ] }
  ],
  "confidence": { "overall": 0, "dimensions": {} },
  "pressure_pass": {}
}
```

Also write `outputs/reproduction.json` and `outputs/hypotheses.json`, each item containing commands/steps, observation, file:line, status, and contradicting evidence.

### Step 7.0: Debug Confidence scoring

Dimensions (4): hypothesis_quality, evidence_completeness, root_cause_isolation, fix_confidence. Factors (weights): evidence_depth(.30), evidence_strength(.25), coverage_breadth(.20), reproduction(.15), consistency(.10). Mapping: <40% low, 40-70% medium, >70% high.

Quality mechanisms: **Pressure Pass** (before Step 9) cross-checks confirmed vs refuted; **Devil's Advocate** (root_cause_isolation > 0.7) "is the root cause deeper?"; **Stall Detection** (no new evidence + delta < 5% for 2 consecutive continuations) "investigation may be stalling".

**Readiness Gate** (blocks Step 9): evidence_completeness ≥ 40% | pressure pass done | no contradicting evidence | fix_direction has specific files. If blocked, ask: supplement the investigation or ignore risk and confirm. The confidence table is appended to `understanding.md`. **GATE: evidence-grounded**

### Step 7.1: Update issue candidate diagnosis

For each diagnosed gap with a `candidate_ref`, add to the issue candidate: `suggested_fix: fix_direction`, `notes: root_cause`, `diagnosed: true`.

---

## Step 8: Update test gaps (if --from-test)

Skip when standalone. For each diagnosed gap, update the uat.md Gaps of `latest-test` (add root_cause, fix_direction, affected_files).

---

## Step 9: Handle ROOT CAUSE FOUND

Reached when hypotheses have been tested to confirmation. **GATE: hypothesis-tested**

```
------------------------------------------------------------
  ROOT CAUSE IDENTIFIED
------------------------------------------------------------
{root cause description}
Evidence: {key evidence points, with file:line}
Recommended fix: {fix suggestion}
------------------------------------------------------------
Options:
1. Fix now  -- quickly apply the fix
2. Plan fix -- plan --gaps
3. Manual   -- investigate/fix yourself
------------------------------------------------------------
```

Write `outputs/fix-directions.json` — contains only root-cause-level change directions, affected files, regression tests, and risks, **not the actual patch**.

---

## Step 10-12: Checkpoint / Inconclusive / Continuation

- **Checkpoint**: present to the user → on input dispatch a continuation agent; on pause store state and exit.
- **Inconclusive**: show items checked/ruled out, offer: continue (new agent with prior state) / add context / manual investigation.
- **Continuation**: load prior state (understanding.md + evidence.ndjson) + the user's checkpoint response, handling returns to Step 6.

---

## report.md

Write `report.md` with standard frontmatter + fixed five sections; frontmatter records mode, target, diagnosis status, clusters/gaps counts. Body:

```
=== DEBUG SESSION ===
Mode:        {standalone | from-test | parallel}
Target:      {issue or scope}
Clusters:    {N} investigated
Gaps:        {total}
  Diagnosed: {N} root causes found
  Uncertain: {N} need more investigation
```

---

## Handoff routing

The report's needs includes `latest-debug` accordingly:

| Result | Routing |
|------|------|
| root cause confirmed, needs fix | `plan --gaps` (required `[latest-debug]`) |
| root cause confirmed (from test), auto-fix | `test --auto-fix` |
| inconclusive | new `debug` run (`-c` resume), record missing evidence in concerns |
| standalone, fix applied | `execute` |

---

## GateRecord

Inline-record (no separate gate artifact):

```json
{ "gate": "debug", "status": "confirmed|partial|inconclusive", "checked_at": now(),
  "evidence": { "clusters": N, "diagnosed": N, "confidence": 0.0 },
  "artifact": "outputs/diagnosis.json" }
```

BLOCKED conditions: `understanding.md` or `evidence.ndjson` missing, or Readiness Gate not passed.

---

## Evidence format

**evidence.ndjson** — one JSON per line, append-only:

```json
{"timestamp":"2026-03-14T10:30:00+08:00","hypothesis":"JWT token not refreshed on 401","action":"grep for 401 handler","result":"Found handler but no refresh call","conclusion":"confirmed"}
```

---

## Error Handling

| Error | Action |
|------|------|
| E001 | no issue description and no active session → check the argument format and re-run |
| E002 | test artifact for `--from-test` not found → verify this scope has test-results |
| W001 | existing debug session found → offer resume |
| W002 | Checkpoint, needs user input → provide the requested input |
| W003 | some gaps inconclusive → review partial results, retry |
