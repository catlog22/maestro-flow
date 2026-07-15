---
name: verify
prepare: verify
commands: [maestro-verify]
session-mode: inherited
---

# Workflow: Verify

Dual verification: Goal-Backward structural verification + Nyquist test coverage. Verify each acceptance criterion, check existence/substance/wiring/regression/anti-patterns. Artifacts unified as `verification.json`; gaps handed to review/test or back to plan.

## Iron Law

No completion conclusion without fresh verification evidence. Before any completion claim: IDENTIFY the command → RUN (freshly this round) → READ (full output + exit code + failure count) → VERIFY (does the output support the claim) → only then conclude and inline the evidence. No "close enough", never treat execute's self-check as the final conclusion.

---

## Step 0: Load specs and constraint pre-check

```
specs_content = maestro spec load --category review  → as the quality standard
```

**Constraint compliance pre-check** (skip if specs have no tech stack/constraint definitions):

```
Extract allowed_libs / disallowed_imports / required_patterns from specs
Collect files changed by current-execution (change-manifest + Files Modified from task summaries)
Extract imports per file (language-aware TS/JS/Python/Go/Java), check against constraints:
  hit disallowed → violation { id:"CV-N", type:"disallowed_import", severity:"high", file, line, fix_direction }
  allowlist exists and external package not listed → violation { type:"unlisted_dependency", severity:"medium" }
scan required_pattern by file_glob, missing → violation { type:"missing_required_pattern" }
constraint_violations[] merged into the final verification.json
```

**CLI supplementary pre-check** (optional, skip if no CLI tool): maestro delegate (analysis) scans changed files for TODO/FIXME/stub/unused import/debug print, blocker items merged into constraint_violations, completeness_flags as supplementary context for Step 1.

---

## Step 1: Goal-Backward structural verification

### Establish must-haves

Priority: `current-plan`'s success_criteria (primary contract, each is a testable truth) > each task's convergence.criteria > 3-7 observable behaviors derived from the session goal.

Split each must-have into three layers:

```
Truths     — observable behavior ("user can see existing messages")
Artifacts  — file paths that must exist and have substance (src/components/Chat.tsx)
Key Links  — key wiring between artifacts ("Chat.tsx imports and calls /api/chat GET")
```

When there are UAT human findings (if present), parse their Gaps section into `uat_gaps[]` (type `human_verified_failure`), and merge into the final gaps.

### Layer 1: Verify observable Truths

For each truth: locate the supporting artifact → check artifact existence and substance → check wiring → determine truth status.

| Status | Meaning |
|------|------|
| VERIFIED | all supporting artifacts pass, wiring complete |
| FAILED | artifact missing, stub, or not wired |
| UNCERTAIN | needs manual verification (visual, real-time, external service); under `--strict`, UNCERTAIN does not pass |

### Layer 2: Verify Artifacts

| Level | Check | Fail status |
|------|------|----------|
| L1 Existence | file exists on disk | MISSING |
| L2 Substance | has real implementation (not stub/placeholder) | STUB (<~10 lines of real logic, or contains placeholder/coming soon/TODO: implement) |
| L3 Wiring | imported and used | ORPHANED |

```
Wiring check:
  grep -r "import.*{artifact_name}" src/ --include=*.ts --include=*.tsx --include=*.py
  grep -r "{artifact_name}" src/ ... | grep -v "import"

exists yes + substance yes + wiring yes → VERIFIED
exists yes + substance yes + wiring no  → ORPHANED
exists yes + substance no               → STUB
exists no                               → MISSING
```

### Layer 3: Verify Key Links

| Pattern | Check | Status |
|------|------|------|
| Component → API | fetch/axios calls the API path and uses the response | WIRED / PARTIAL / NOT_WIRED |
| API → DB | model has a query and returns results | WIRED / PARTIAL / NOT_WIRED |
| Form → Handler | onSubmit has real implementation (not console.log) | WIRED / STUB / NOT_WIRED |
| State → Render | state variable appears in JSX/template | WIRED / NOT_WIRED |
| Event → Handler | event listener has real handling logic | WIRED / STUB / NOT_WIRED |

Record status and file:line evidence for each key link.

### Identify gaps

```
Collect gaps from failed truths, missing/stub artifacts, broken links.
Each gap: { id:"GAP-N", type:"missing_feature"|"incomplete_implementation"|"broken_integration",
            severity:"critical"|"high"|"medium"|"low", description, fix_direction }
```

**GATE: goal-backward-verified** — all must-have truths resolved across Layers 1-3 (existence/substance/wiring) with gaps identified BEFORE anti-pattern scan.

---

## Step 2: Anti-pattern scan

`--skip-antipattern` skips. Take changed files from change-manifest, scan each file:

| Pattern | Search | Severity |
|------|------|--------|
| TODO/FIXME/XXX/HACK | `grep -n "TODO\|FIXME\|XXX\|HACK"` | Warning |
| placeholder content | `grep -n -i "placeholder\|coming soon\|will be here"` | Blocker |
| empty return | `grep -n "return null\|return {}\|return \[\]\|=> {}"` | Warning |
| log-only function | function body has only console.log/print | Warning |
| hardcoded test data | `grep -n "hardcoded\|dummy\|fake\|mock"` | Warning |
| disabled tests | `grep -n "skip\|xit\|xdescribe\|@disabled"` | Warning |

Classify Blocker (blocks goal) / Warning (incomplete) / Info. Write into `outputs/antipattern-report.json`. Blocker anti-patterns merged into gaps (severity critical).

---

## Step 3: Nyquist test coverage

`--skip-tests` skips.

```
1. Probe test infrastructure:
   find jest.config/vitest.config/pytest.ini/pyproject.toml
   find *.test.* / *.spec.* / test_* (exclude node_modules)
2. Build requirement→test mapping: for each success criterion / must-have truth, search for test files covering it
   (match by filename, import, test description)
3. Gap classification:
   COVERED — test exists, hits the behavior, runs green
   PARTIAL — test exists but fails or is incomplete
   MISSING — no test
4. When gaps exist, dispatch workflow-nyquist-auditor agent (mandatory, cannot be substituted with manual Read/Grep):
   pass the gap list, test infrastructure, session context
   the agent generates missing tests and returns GAPS FILLED / PARTIAL / ESCALATE
```

Write `outputs/requirement-coverage.json`:

```json
{ "test_framework": "...", "coverage": { "statements":0, "branches":0, "functions":0, "lines":0 },
  "requirement_coverage": [ { "requirement":"REQ-001", "tests":["auth.spec.ts"], "status":"covered" } ],
  "gaps": [ { "requirement":"REQ-002", "description":"...", "suggested_test":"..." } ] }
```

Each requirement must be explicitly marked covered/partial/uncovered, no silent omission. Coverage below threshold records a warning. **GATE: nyquist-covered** — every requirement explicitly classified covered/partial/uncovered (no silent omission).

---

## Step 4: Aggregate and write verification.json

Merge goal-backward, constraint pre-check, anti-pattern, and Nyquist results, determine the overall verdict:

```
pass  — all truths VERIFIED, all artifacts pass L1-L3, all key links WIRED,
        no blocker anti-patterns, no high/critical constraint violations
warn  — only medium/low gaps, no critical
fail  — any truth FAILED, artifact MISSING/STUB, key link NOT_WIRED,
        blocker anti-pattern, or high/critical constraint violation
blocked — critical path cannot be verified (missing dependency/environment)

score = verified_truths / total_truths
```

When an old file exists, archive first → `outputs/.history/verification-{YYYY-MM-DDTHH-mm-ss}.json`. Artifact paths and metadata are declared in `prepare/verify.md` contract.

```
Write outputs/verification.json:
{
  "scope": "{scope}",
  "verdict": "pass|warn|fail|blocked",
  "verified_at": now(),
  "criteria": [ { "id":"AC1", "status":"passed|failed|blocked",
                  "method":"test|grep|review|manual", "evidence":[...] } ],
  "must_haves": { "truths":[...], "artifacts":[...], "key_links":[...] },
  "gaps": [...],                        // includes uat_gaps
  "constraint_violations": [...],       // Step 0
  "antipatterns": [...],                // Step 2 summary
  "coverage_score": score
}
```

Every criterion must have method + status + evidence, and the verdict must be re-computable.

---

## report.md

Write `report.md` with standard frontmatter + fixed sections. frontmatter records scope, verdict, criteria counts, gap counts, coverage_score. Body references verification values via aref, does not copy content.

```
=== VERIFICATION RESULTS ===
Scope:         {scope}
Goal-Backward: {verified}/{total} truths verified
  Artifacts:   {ok}/{total} (L1-L3)
  Wiring:      {wired}/{total} key links
Constraints:   {N} violations ({high} high, {medium} medium)
Anti-patterns: {blocker} blockers, {warning} warnings
Nyquist:       {coverage}% coverage ({--skip-tests ? SKIPPED : status})
Gaps: {total}  Critical:{c} High:{h} Medium:{m} Low:{l}
Verdict: {pass|warn|fail|blocked}
```

---

## Handoff routing

The verdict decides the downstream run; the report's needs includes `latest-verification` (and `current-plan` where necessary) accordingly:

| verdict | Routing |
|---------|------|
| pass | `review` (code review), then `test` (UAT) |
| warn | acknowledge caveats then `review` / `test` |
| fail (only medium/low gaps) | `plan --gaps` → `execute` → re-run `verify` (gap-fix loop, cycle until gaps clear or user accepts) |
| fail/blocked (has critical) | `plan --gaps`, needs includes `latest-verification` |
| low test coverage | `quality-auto-test` generates missing tests |
| needs manual verification | `test` (interactive UAT) |

**gap-fix loop**: `verify → plan --gaps → execute → verify` repeats until all gaps close or the user accepts remaining gaps.

→ Wrap-up follows ref/finish-work.md

---

## Success Criteria

- [ ] Goal-backward verification covers all success criteria from plan
- [ ] Three layers checked: existence (L1), substance (L2), wiring (L3)
- [ ] Every criterion has method + status + fresh evidence
- [ ] Anti-pattern scan completed (TODO/FIXME/HACK, stubs, disabled tests)
- [ ] Nyquist test coverage computed from live run (unless --skip-tests)
- [ ] No silent coverage omissions (every requirement explicitly classified)
- [ ] verification.json written with verdict

---

## GateRecord

After verification completes, inline-record one entry per declared gate:

```json
{ "gate": "goal-backward-verified", "verdict": "pass|warn|fail|blocked", "checked_at": now(),
  "evidence": { "criteria_total": N, "passed": N, "failed": N, "gaps": N },
  "artifact": "outputs/verification.json" }
{ "gate": "nyquist-covered", "verdict": "pass|warn|fail|blocked", "checked_at": now(),
  "evidence": { "coverage_score": 0.0, "silent_omissions": N },
  "artifact": "outputs/requirement-coverage.json" }
```

BLOCKED conditions: `verification.json` missing, or a criterion not verified, or a failed criterion lacks a corresponding gap, or coverage has a silent omission.

---

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No plan/execution | Abort: `current-plan` or `current-execution` missing, run execute first |
| W001 | No summaries | Warning, analyze using task files only, mark [LOW CONFIDENCE] (partial, missing summaries) |
| W002 | No test framework detected | Skip coverage computation, warn the user |
| W003 | Coverage command failed | Do requirement mapping only, mark coverage [LOW CONFIDENCE] |
| W004 | Verifier/auditor agent failed | Retry once, if still failing write partial results, mark [LOW CONFIDENCE] |
