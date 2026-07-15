---
name: test
prepare: test
commands: [quality-test]
session-mode: inherited
---

# Workflow: Test

Conversational UAT — persisted state, auto-diagnosis, gap closed-loop. Core: show the expected behavior, ask if reality matches, one scenario at a time.

```
"yes" / "y" / "next" / empty / "pass" → pass
"skip" / "can't test" / "n/a"          → skipped
anything else                          → recorded as an issue, severity auto-inferred
```

Never ask "how severe is this?".

---

## Step 1: Resolve target

| Input | Action |
|------|------|
| session/run scope | `TARGET_TYPE=scope`, resolve from the run registry |
| none | check for an active UAT session (Step 2), otherwise prompt the user |

Validate the target exists and has `latest-verification` (missing → E002).

---

## Step 2: Check for an active session

The runtime supplies the active UAT session state (session resolution and Run enumeration are handled by the runtime); an active UAT is identified by its `uat.md` (status, target, Current Test section).

**Active session and no arg**: show a list (number, target, status, current test, progress), wait for the user response. Number → resume (Step 9); scope → create new (Step 4).

**Active session and has arg**: if that target has a session, offer resume or restart.

**No active session and no arg**: prompt to provide a scope to start testing.

**No active session and has arg**: proceed to Step 3 or Step 4.

---

## Step 3: Smoke test (if --smoke)

Skip if not set. Inject basic sanity checks before UAT scenarios:

| Smoke | Check | Method |
|-------|------|------|
| App startup | process doesn't crash | run the start command, check exit code |
| Route response | key endpoints not erroring | curl/fetch the main routes |
| Clean build | no build errors | build command succeeds |
| Dependencies intact | no missing dependencies | install check |

Record results in the `## Smoke Tests` section of `uat.md`. Any failure → abort UAT, report as a blocker, suggest `debug` (E003).

---

## Step 4: Load verification context

Read `latest-verification`, report.md frontmatter, and execution task summaries from the target run. Build a testable checklist from success_criteria + must_haves + task outcomes (user-observable results only).

---

## Step 5: Design test scenarios

Build a scenario for each testable item: `id` (T-001…), `name`, `category` (e2e | integration | unit), `expected` (specific observable behavior), `requirement_ref`.

Write `outputs/test-plan.json` (artifact paths and metadata are declared in `prepare/test.md` contract):

```json
{
  "target": "{scope}",
  "generated_at": "{ISO}",
  "tests": [...],
  "coverage": { "requirements_mapped": ["SC-001"], "requirements_unmapped": ["SC-003"] }
}
```

Skip internal/unobservable items (refactors, type changes).

---

## Step 6: Create the UAT file

When an old `uat.md` exists, archive → `outputs/.history/uat-{YYYY-MM-DDTHH-mm-ss}.md`. Create `outputs/uat.md`:

```markdown
---
status: testing
target: {scope}
source: [list of summary files]
started: {ISO}
updated: {ISO}
---

## Current Test
number: 1
name: {first test name}
expected: |
  {what the user should observe}
awaiting: user response

## Smoke Tests
{results if run, otherwise omit}

## Tests

### 1. {test name}
expected: {observable behavior}
result: [pending]

## Summary
total: {N}
passed: 0
issues: 0
pending: {N}
skipped: 0

## Gaps
[none yet]
```

→ Step 7.

---

## Step 7: Present the test

```
------------------------------------------------------------
  TEST {number}/{total}: {name}
------------------------------------------------------------
Expected behavior:
{expected}
------------------------------------------------------------
> type "pass" or describe what's wrong
------------------------------------------------------------
```

Wait for the user's plain-text response.

---

## Step 8: Handle response

| Response | Action |
|------|------|
| empty / "yes" / "y" / "ok" / "pass" / "next" | Pass |
| "skip" / "can't test" / "n/a" | Skipped |
| anything else | Issue (severity auto-inferred) |

On an issue, update the Tests section (result: issue, reported: verbatim words, severity: inferred value), and append to the Gaps section:

```yaml
- test: {N}
  truth: "{expected behavior}"
  status: failed
  reason: "User reported: {verbatim}"
  severity: {inferred}
  requirement_ref: {if mapped}
```

**Issue candidate**: aggregate the UAT gap into `outputs/issue-candidates.json` (title "UAT: {test.name} - {response}", ≤100 chars, source "uat", severity/priority from inference). Back-fill `candidate_ref` into the gap YAML.

**Write triggers**: 1) an issue is found 2) session completes 3) every 5 passes (checkpoint).

More tests → Step 7; none → Step 10.

---

## Step 9: Resume from file

Read `uat.md` → find the first `result: [pending]` → update Current Test → Step 7.

---

## Step 10: Complete the session

Update `uat.md`: `status: complete`. Archive old test artifacts → `.history/`.

Write `outputs/test-results.json`:

```json
{
  "target": "{scope}",
  "completed_at": "{ISO}",
  "results": [ { "id": "T-001", "name": "...", "status": "pass|issue|skipped", "details": "..." } ],
  "summary": { "total": N, "passed": N, "issues": N, "skipped": N }
}
```

Write `outputs/acceptance.json` — per-criterion UAT conclusion and evidence.
Write `outputs/coverage.json`:

```json
{
  "target": "{scope}",
  "generated_at": "{ISO}",
  "requirements_covered": ["SC-001"],
  "requirements_uncovered": ["SC-003"],
  "coverage_percentage": 66.7
}
```

issues == 0 → Step 13; issues > 0 → Step 11.

---

## Step 11: Auto-diagnosis

1. **Cluster** gaps by component/area (same file/module → one cluster, same flow → one cluster).
2. **Mandatory, cannot be substituted with manual Read/Grep**: dispatch one debug agent per cluster (parallel, `run_in_background: false`), pre-fill symptoms, `goal: find_root_cause`, with candidate_ref.
3. Collect results, update `uat.md` gaps (add root_cause, fix_direction, affected_files).

---

## Step 12: Gap closed-loop decision

`AUTO_FIX` set → skip the prompt and enter the gap-fix loop directly. Otherwise present a diagnosis table (Gap, Severity, Root Cause, Fix Direction) with options:

| Choice | Action |
|------|------|
| 1 / "auto-fix" | enter the gap-fix loop |
| 2 / "debug" | suggest `debug` |
| 3 / "plan" | suggest `plan --gaps` |
| 4 / "manual" | complete, report the results |

**gap-fix loop (up to 2 rounds)**: `plan --gaps` → fix tasks → `execute` → fix → `execute` → retest. Issue lifecycle: `registered` → `planning` → `executing` → `completed` | `failed`.

Pass → update `uat.md` gap to resolved; still has gaps → report the remaining, suggest manual intervention.

---

## Step 12.5: UAT Confidence scoring

Dimensions (4): scenario_coverage, diagnostic_depth, observation_quality, closure_completeness. Factors (weights): requirements_mapped(.30), observation_specificity(.25), user_validation(.20), diagnostic_depth(.15), consistency(.10). Scoring points: init (Step 5), each user response (Step 8), after the gap-fix loop (Step 12).

Quality mechanisms: **Pressure Pass** — >80% pass → ask the user to try an edge case; **Devil's Advocate** — >70% first-pass → challenge scenario difficulty; **Stall Detection** — 2 rounds of gap-fix with no improvement → stop. **GATE: pass-rate-met** — each scenario has a real observed outcome (timeout / no-response / missing-entry may never be scored as pass); under `--frontend-verify`, any `[UI-observable]` failure or a write endpoint with no UI entry forces NEEDS_RETRY. (The pressure-pass mechanism above is a separate quality lever, not the gate's definition.)

**Readiness Gate** (blocks Step 13): scenario_coverage < 40% | blocker gap not diagnosed | no pressure pass (if >80%) | unconfirmed remaining gap. The confidence summary is appended to `uat.md`. **GATE: coverage-met** — two components must both hold: (1) every mapped scenario source has a corresponding UAT scenario, and (2) the Readiness Gate passes (scenario_coverage ≥ 40%).

---

## Step 13: Report

Write `report.md` with standard frontmatter + fixed five sections; frontmatter records target, verdict, smoke/UAT counts, coverage_percentage. Body:

```
=== UAT RESULTS ===
Target:      {scope}
Smoke Tests: {run} run, {pass} passed (if run)
UAT Tests:   {total} total
  Passed:    {passed}
  Issues:    {issues} ({blocker} blockers, {major} major)
  Skipped:   {skipped}
Diagnosis:   {diagnosed}/{issues} gaps diagnosed
Auto-fix:    {fixed} gaps resolved (if run)
```

---

## Success Criteria

- [ ] Target resolved (from scope or active session)
- [ ] Test scenarios designed from verification context
- [ ] UAT file created with structured format
- [ ] Tests presented to user with expected behaviors
- [ ] User responses recorded and gaps identified
- [ ] Auto-diagnosis run for failing scenarios
- [ ] Gap closed-loop decision applied (fix/accept/defer)
- [ ] UAT confidence scored with pressure pass
- [ ] Readiness gate passed (coverage ≥40%, blocker gaps diagnosed)
- [ ] test-results.json written

---

## Handoff routing

The report's needs includes `latest-test` accordingly:

| Result | Routing |
|------|------|
| all pass, no gaps | session wrap-up / audit |
| gaps auto-fixed | session wrap-up / audit |
| gaps remaining, diagnosed | `debug` or `plan --gaps` |
| gaps remaining, undiagnosed | `debug` (from test gaps) |
| coverage below threshold | generate additional tests |

`--frontend-verify` mode: follow `ref/frontend-verify.md`, produce `e2e-results.json` (schema `e2e-results/1.0`); any `[UI-observable]` fail or a write endpoint with no UI entry point → NEEDS_RETRY (does not pass).

---

## GateRecord

Inline-record one entry per declared gate (no separate evidence.json):

```json
{ "gate": "coverage-met", "verdict": "pass|fail", "checked_at": now(),
  "evidence": { "total": N, "sources_mapped": N, "coverage_pct": N },
  "artifact": "outputs/test-results.json" }
{ "gate": "pass-rate-met", "verdict": "pass|fail", "checked_at": now(),
  "evidence": { "passed": N, "issues": N, "needs_retry": false },
  "artifact": "outputs/test-results.json" }
```

BLOCKED conditions: Readiness Gate not passed, or `test-results.json` missing.

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No scope target and no active session | Prompt to provide a scope |
| E002 | Target not verified (no `latest-verification`) | Suggest running `execute` first (verification built in) |
| E003 | Smoke failed (app won't start) | Suggest `debug` |
| W001 | One or more scenarios failed | Auto-diagnose, suggest fix options |
| W002 | Coverage below threshold | Suggest generating additional tests |
