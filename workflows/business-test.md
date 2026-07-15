<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Business Test Workflow (PRD-Forward)

> **DEPRECATED** — superseded by `auto-test`. This workflow is equivalent to `auto-test max_iter=3` (inner loop cleans test defects, up to 3 outer passes; see `auto-test.md` "Degenerate cases"). Artifacts and gate mapping are covered by the `auto-test.md` migration table. Prefer `auto-test` for new work; this file is retained for backward compatibility.

## Requirement Coverage

| REQ | Title | AC Total | Passed | Failed | Coverage | Verdict |
|-----|-------|----------|--------|--------|----------|---------|
| REQ-001 | ... | 5 | 4 | 1 | 80% | partial |
| REQ-002 | ... | 3 | 3 | 0 | 100% | verified |

## Layer Results

| Layer | Total | Passed | Failed | Blocked | Pass Rate |
|-------|-------|--------|--------|---------|-----------|
| L1 Interface | 10 | 9 | 1 | 0 | 90.0% |
| L2 Business | 15 | 13 | 1 | 1 | 86.7% |
| L3 E2E | 5 | 5 | 0 | 0 | 100.0% |

## Failures

### BF-001: REQ-001:AC-3 (critical)
- Layer: L1
- Expected: 201 Created with user object
- Actual: 400 Bad Request
- Fix: Add email validation bypass for internal accounts (src/auth.ts:42)

## Next Steps
{routing suggestion}
```

Update `index.json` with business_test section:
```json
{
  "business_test": {
    "status": "passed|gaps_found",
    "spec_mode": "full|degraded",
    "req_coverage_pct": 85.0,
    "layers": {
      "L1": { "pass_rate": 90.0 },
      "L2": { "pass_rate": 86.7 },
      "L3": { "pass_rate": 100.0 }
    },
    "failures": [
      { "id": "BF-001", "req_ref": "REQ-001:AC-3", "severity": "critical" }
    ]
  }
}
```

---

**GATE Step 8→9**: Glob `${PHASE_DIR}/.tests/business/business-test-report.json` MUST exist before Step 9 issue creation; BLOCKED if missing.

### Step 9: Feedback Loop

**Auto-create issues from failures:**
```
FOR each failure in report.failures:
  mkdir -p ".workflow/issues"

  today = format(now(), "YYYYMMDD")
  counter = next available sequence for today

  issue = {
    id: "ISS-{today}-{counter:03d}",
    title: "Business Test: " + failure.req_ref + " - " + failure.description (truncated 100 chars),
    status: "registered",
    priority: severity_to_priority(failure.severity),
    severity: failure.severity,
    source: "business-test",
    phase_ref: PHASE_NUM,
    gap_ref: failure.id,
    description: "Business test failed for " + failure.req_ref + ". Expected: " + failure.expected + ". Actual: " + failure.actual,
    fix_direction: failure.fix_suggestion.direction,
    context: {
      location: failure.fix_suggestion.file + ":" + failure.fix_suggestion.line,
      suggested_fix: failure.fix_suggestion.direction,
      notes: "req_ref: " + failure.req_ref + ", layer: " + failure.layer
    },
    tags: ["business-test", failure.layer],
    affected_components: [failure.fix_suggestion.file],
    feedback: [],
    issue_history: [],
    created_at: now(),
    updated_at: now(),
    resolved_at: null,
    resolution: null
  }
  Append JSON line to .workflow/issues/issues.jsonl
```

**Report:**
```
=== BUSINESS TEST RESULTS ===
Phase:       {phase_name}
Spec mode:   {full|degraded}

Requirement Coverage: {coverage_pct}%
  Verified:    {fully_verified}/{total_requirements}
  Partial:     {partially_verified}
  Unverified:  {unverified}

Layer Results:
  L1 Interface:  {pass_rate}% ({passed}/{total})
  L2 Business:   {pass_rate}% ({passed}/{total})
  L3 E2E:        {pass_rate}% ({passed}/{total})

Failures: {failure_count} ({blocker_count} blockers)
Issues:   {issue_count} auto-created

Files:
  {PHASE_DIR}/.tests/business/business-test-plan.json
  {PHASE_DIR}/.tests/business/business-test-report.json
  {PHASE_DIR}/.tests/business/business-test-summary.md

Next steps:
  {suggested_next_command}
```

**Next step routing:**

| Result | Suggestion |
|--------|------------|
| All requirements verified | Skill({ skill: "maestro-phase-transition", args: "{phase}" }) |
| Failures found | Skill({ skill: "quality-debug", args: "--from-business-test {phase}" }) |
| `--re-run` all pass after fix | Skill({ skill: "maestro-execute", args: "{phase}" }) |
| Low coverage (< 60%) | Skill({ skill: "quality-auto-test", args: "{phase}" }) |
| Need integration tests | Skill({ skill: "quality-auto-test", args: "{phase}" }) |

**Closure criteria:**
A requirement is marked "verified" ONLY when:
- ALL acceptance criteria with MUST/SHALL keywords: passed
- ALL acceptance criteria with SHOULD keywords: passed
- No blocker-severity failures remain for this requirement
