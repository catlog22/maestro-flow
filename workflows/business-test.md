# Business Test Workflow (PRD-Forward)

Validate built features against PRD acceptance criteria through automated multi-layer business testing with requirement traceability, fixture generation, and feedback loop.

PRD-forward: starts from REQ-*.md acceptance criteria, not from code coverage gaps.
Progressive layers: L1 Interface Contract -> L2 Business Rule -> L3 Business Scenario (E2E).
Generator-Critic loop: max 3 iterations per layer to distinguish test defects from code defects.

**Philosophy: Business rules are the source of truth. Code must satisfy them, not the other way around.**

---

### Step 1: Resolve Target & Load Spec Package

**Parse arguments:**

| Input | Result |
|-------|--------|
| No arguments | Error E001 |
| Phase number | Resolve `.workflow/phases/{NN}-{slug}/` |
| `--spec SPEC-xxx` | Explicit spec reference |
| `--layer L1\|L2\|L3` | Run only specific layer |
| `--gen-code` | Generate framework-specific test classes |
| `--dry-run` | Extract scenarios only, don't execute |
| `--re-run` | Re-run only previously failed scenarios |
| `--auto` | Skip interactive confirmations |

**Load spec package:**

```
1. Read ${PHASE_DIR}/index.json -> extract spec_ref (if present)
2. IF --spec provided: SPEC_DIR = .workflow/.spec/{spec_ref}/
   ELSE IF index.json.spec_ref: SPEC_DIR = .workflow/.spec/{spec_ref}/
   ELSE: try .workflow/.spec/SPEC-*/ (most recent)

3. IF SPEC_DIR found:
   - Read requirements/_index.md (requirement summary + traceability matrix)
   - Read all requirements/REQ-*.md (functional requirements with acceptance criteria)
   - Read all requirements/NFR-*.md (non-functional requirements)
   - Read architecture/_index.md (API endpoints, data model, state machines)
   - Read epics/EPIC-*.md (user stories -> E2E scenario source)
   SPEC_MODE = "full"

4. IF no spec package found (DEGRADED MODE):
   - Read index.json.success_criteria
   - Read plan.json tasks with convergence.criteria
   - Read .summaries/TASK-*-summary.md for implemented behavior
   SPEC_MODE = "degraded"
   Display: "No spec package found. Using success_criteria + plan.json for scenario extraction (degraded mode)."
```

Check for existing business test session:
```bash
ls ${PHASE_DIR}/.tests/business/business-test-report.json 2>/dev/null
```

If session exists AND `--re-run`: load previous report, filter to failed/blocked scenarios only.
If session exists AND no `--re-run`: offer resume or restart.

---

### Step 2: Extract Business Test Scenarios from PRD

**Full mode (SPEC_MODE = "full"):**

For each `REQ-NNN-{slug}.md`:

1. Parse `## Acceptance Criteria` section
2. Extract each numbered criterion as a test scenario seed
3. Map RFC 2119 keywords to test priority:

| Keyword | Priority | Failure Severity |
|---------|----------|-----------------|
| MUST / MUST NOT / SHALL / SHALL NOT | critical | blocker |
| SHOULD / SHOULD NOT / RECOMMENDED | high | major |
| MAY / OPTIONAL | medium | minor |

4. Classify scenario into layer:

| Source | Layer | Category |
|--------|-------|----------|
| Architecture API endpoints + REQ AC about request/response | L1 | api_contract |
| REQ AC about business logic, validation, state changes | L2 | business_rule |
| REQ AC about state transitions (from architecture state machines) | L2 | state_transition |
| Epic user stories (multi-step flows) | L3 | user_flow |
| NFR performance/security constraints | L2 | non_functional |

5. Generate scenario:
```json
{
  "id": "BT-{NNN}",
  "req_ref": "REQ-{NNN}:AC-{N}",
  "layer": "L1|L2|L3",
  "priority": "critical|high|medium",
  "name": "descriptive name derived from AC text",
  "category": "api_contract|business_rule|state_transition|user_flow|non_functional",
  "endpoint": "METHOD /path (if L1)",
  "input": { "$fixture_ref": "REQ-{NNN}/valid|invalid|boundary/name" },
  "expected": {
    "status": 200,
    "body_contains": [],
    "behavior": "description of expected outcome"
  },
  "preconditions": ["list of required state"],
  "postconditions": ["list of expected state changes"],
  "mock_services": ["list of services to mock for isolation"]
}
```

**Degraded mode (SPEC_MODE = "degraded"):**

- Extract scenarios from `index.json.success_criteria` (each criterion -> one L2 scenario)
- Extract from `plan.json` task convergence criteria (each criterion -> one L1 or L2 scenario)
- Extract from summaries (each implemented behavior -> one L1 scenario)
- All scenarios default to priority: "high"
- No L3 scenarios in degraded mode (no Epic stories available)

---

### Step 3: Generate Test Data (Fixtures)

For each REQ with data model definitions:

**Tier 1: Schema-derived fixtures**
```
FOR each entity in REQ data model:
  valid: object satisfying all field constraints
  invalid: one variant per constraint violation:
    - null_required: set required field to null
    - empty_string: set string field to ""
    - overflow: exceed max length or max value
    - wrong_type: provide string where number expected, etc.
  boundary: edge value variants:
    - min_value: exact minimum
    - max_value: exact maximum
    - min_minus_one: minimum - 1
    - max_plus_one: maximum + 1
```

**Tier 2: Acceptance-criteria-derived expectations**
```
FOR each "MUST return X when Y" in acceptance criteria:
  fixture: { input: Y, expected: X }
FOR each "MUST validate Z":
  fixture: { input: invalid_Z, expected: validation_error }
FOR each "SHOULD support W":
  fixture: { input: W_params, expected: W_result }
```

**Tier 3: Business-scenario-derived data sets (L3 only)**
```
FOR each Epic user story:
  scenario_pack: coordinated data set across story steps
  Example: { user: registered_user, order: valid_order, payment: valid_card }
  Entity IDs and relationships pre-coordinated across steps
```

**Microservice mock data:**
```
FOR each API endpoint in architecture/_index.md:
  mock_contract: { request_pattern, response_fixture }
  Used for: L2 WireMock stubs, L3 service isolation
```

Organize fixtures by REQ:
```json
{
  "REQ-001": {
    "valid": [{ "name": "standard_user", "data": {...} }],
    "invalid": [{ "name": "missing_email", "data": {...}, "expected_error": "email is required" }],
    "boundary": [{ "name": "max_length_name", "data": {...} }]
  }
}
```

---

### Step 4: Write Test Plan & Confirm

**Archive previous business test artifacts** before writing:
```
IF file exists "${PHASE_DIR}/.tests/business/business-test-plan.json":
  mkdir -p "${PHASE_DIR}/.history"
  TIMESTAMP = format(now(), "YYYY-MM-DDTHH-mm-ss")
  mv "${PHASE_DIR}/.tests/business/business-test-plan.json" "${PHASE_DIR}/.history/business-test-plan-${TIMESTAMP}.json"
```

Write `business-test-plan.json` to `.tests/business/`:
```json
{
  "phase": "{phase}",
  "spec_ref": "{SPEC_DIR name or 'degraded'}",
  "spec_mode": "full|degraded",
  "generated_at": "{ISO timestamp}",
  "layers": {
    "L1": { "scenario_count": N, "priority_distribution": { "critical": X, "high": Y, "medium": Z } },
    "L2": { "scenario_count": N, "priority_distribution": {...} },
    "L3": { "scenario_count": N, "priority_distribution": {...} }
  },
  "scenarios": [ ... ],
  "fixtures": { ... },
  "mock_contracts": [ ... ],
  "requirement_coverage_plan": {
    "requirements_targeted": ["REQ-001", "REQ-002"],
    "requirements_skipped": [],
    "skip_reasons": {}
  }
}
```

**If not `--auto`:**

Display plan summary:
```
=== BUSINESS TEST PLAN ===
Spec mode:   {full|degraded}
Requirements: {N} targeted, {M} skipped

Layer Distribution:
  L1 Interface:  {N} scenarios ({X} critical, {Y} high)
  L2 Business:   {N} scenarios ({X} critical, {Y} high)
  L3 E2E:        {N} scenarios ({X} critical, {Y} high)

Fixtures: {N} REQs × {avg} variants = {total} data sets

Proceed? (yes/edit/cancel)
```

Wait for user confirmation. If "edit": let user modify plan interactively.

**If `--dry-run`:** Stop here, report plan.

---

### Step 5: Generate Test Code (if --gen-code)

**Detect project tech stack:**
```
IF file exists ".workflow/project.md":
  tech = parse Tech Stack section from project.md
ELSE:
  Scan project for indicators (pom.xml -> Java, package.json -> Node, etc.)
```

**Generate framework-specific test classes:**

| Stack | L1 | L2 | L3 |
|-------|----|----|-----|
| Java/Spring Boot | RestAssured + MockMvc | JUnit 5 Parameterized + WireMock | TestContainers |
| TypeScript/Node | supertest + vitest | vitest + nock | playwright/cypress |
| Python | httpx + pytest | pytest + responses | pytest + selenium |

**Generation rules:**
- Follow existing test patterns (discover from codebase, same as test-gen Step 1)
- Each test method has `@DisplayName` (or equivalent) with REQ-NNN:AC-N reference
- Each test class has layer marker (`@Tag("business-L1")` or equivalent)
- Test files placed in `.tests/business/{layer}/` directory

**If no `--gen-code`:** Scenarios remain as structured JSON for AI agent execution mode (Step 6).

---

### Step 6: Execute Tests (Progressive L1 -> L2 -> L3)

**Fail-fast rule:**
- If L1 has ANY "critical" priority failure -> STOP. Do not proceed to L2.
- If L2 has ANY "critical" priority failure -> STOP. Do not proceed to L3.
- "high" and "medium" failures do NOT block next layer.

**For each layer (starting from `--layer` if specified, else L1):**

Run Generator-Critic loop (max 3 iterations):

**Iteration 1: Execute all scenarios**

`--gen-code` mode:
```bash
# Run generated test classes for current layer
{test_command} --testPathPattern="business-{layer}" 2>&1 | tail -50
```

Agent execution mode:
```
FOR each scenario in current layer:
  Execute scenario against running application
  Record: { status, actual_response, duration_ms, error_detail }
```

**Critic phase: Classify failures**

For each failed scenario:
```
Analyze failure evidence -> classify as:

| Classification | Meaning | Action |
|---------------|---------|--------|
| test_defect | Test itself is wrong (wrong endpoint, bad fixture) | Auto-fix test in next iteration |
| code_defect | Business rule violated (actual != expected per REQ) | Record as failure |
| env_issue | Service down, config missing, timeout | Record as blocked |
```

**Iteration 2: Re-run with fixed tests**
- Fix test_defects from iteration 1
- Re-run ALL scenarios (not just failed ones — catch regressions)

**Iteration 3: Final confirmation**
- Remaining failures = confirmed code_defects
- All test_defects should be resolved
- Blocked scenarios marked with env_issue reason

Record results per iteration in `.tests/business/test-results-iter-{N}.json`.

---

### Step 7: Build Traceability Matrix

Map each scenario result back to requirement:

```
FOR each REQ in requirements targeted:
  req_results = {
    req_id: "REQ-NNN",
    title: REQ.title,
    total_criteria: count of AC in REQ,
    criteria_results: []
  }

  FOR each AC in REQ:
    scenarios_for_ac = filter scenarios where req_ref == "REQ-NNN:AC-{N}"
    ac_status = "passed" if ALL scenarios passed
                "failed" if ANY scenario failed
                "blocked" if ANY blocked and none failed
                "untested" if no scenarios mapped

    req_results.criteria_results.push({
      ac_id: "AC-{N}",
      description: AC text,
      priority: mapped from RFC 2119 keyword,
      status: ac_status,
      tests: [scenario IDs],
      failure: { expected, actual, evidence } if failed
    })

  req_results.coverage_pct = passed_criteria / total_criteria * 100
  req_results.verdict = "verified" if all MUST+SHOULD passed
                        "partial" if some failed
                        "unverified" if all failed or untested
```

---

### Step 8: Generate Reports

**Archive previous reports:**
```
IF file exists "${PHASE_DIR}/.tests/business/business-test-report.json":
  mkdir -p "${PHASE_DIR}/.history"
  TIMESTAMP = format(now(), "YYYY-MM-DDTHH-mm-ss")
  mv report and summary to .history/
```

Write `.tests/business/business-test-report.json`:
```json
{
  "phase": "{phase}",
  "spec_ref": "{spec reference}",
  "spec_mode": "full|degraded",
  "completed_at": "{ISO timestamp}",
  "execution_mode": "gen-code|agent",
  "iterations": {
    "L1": { "count": N, "converged": true },
    "L2": { "count": N, "converged": true },
    "L3": { "count": N, "converged": false }
  },
  "layers": {
    "L1": { "total": N, "passed": P, "failed": F, "blocked": B, "pass_rate": 95.0 },
    "L2": { "total": N, "passed": P, "failed": F, "blocked": B, "pass_rate": 87.5 },
    "L3": { "total": N, "passed": P, "failed": F, "blocked": B, "pass_rate": 100.0 }
  },
  "requirement_coverage": [
    {
      "req_id": "REQ-001",
      "title": "...",
      "total_criteria": 5,
      "criteria_results": [
        {
          "ac_id": "AC-1",
          "description": "...",
          "priority": "critical",
          "status": "passed|failed|blocked|untested",
          "tests": ["BT-001", "BT-002"],
          "failure": null
        }
      ],
      "coverage_pct": 80.0,
      "verdict": "verified|partial|unverified"
    }
  ],
  "failures": [
    {
      "id": "BF-001",
      "test_id": "BT-005",
      "req_ref": "REQ-001:AC-3",
      "layer": "L1",
      "severity": "critical",
      "classification": "code_defect",
      "description": "...",
      "expected": "...",
      "actual": "...",
      "fix_suggestion": {
        "file": "src/...",
        "line": 42,
        "direction": "Add null guard for..."
      }
    }
  ],
  "summary": {
    "total_requirements": 10,
    "fully_verified": 8,
    "partially_verified": 1,
    "unverified": 1,
    "coverage_pct": 85.0,
    "total_scenarios": 30,
    "total_passed": 26,
    "total_failed": 3,
    "total_blocked": 1
  }
}
```

Write `.tests/business/business-test-summary.md`:
```markdown
---
phase: {phase}
spec_ref: {spec reference}
completed_at: {ISO timestamp}
verdict: passed|gaps_found
---

# Business Test Results

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
| `--re-run` all pass after fix | Skill({ skill: "maestro-verify", args: "{phase}" }) |
| Low coverage (< 60%) | Skill({ skill: "quality-auto-test", args: "{phase}" }) |
| Need integration tests | Skill({ skill: "quality-auto-test", args: "{phase}" }) |

**Closure criteria:**
A requirement is marked "verified" ONLY when:
- ALL acceptance criteria with MUST/SHALL keywords: passed
- ALL acceptance criteria with SHOULD keywords: passed
- No blocker-severity failures remain for this requirement
