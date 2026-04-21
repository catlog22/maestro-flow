---
name: quality-business-test
description: PRD-forward business testing with requirement traceability, multi-layer execution (L1 Interface -> L2 Business Rule -> L3 Scenario), fixture generation, and feedback loop.
argument-hint: "<phase> [--spec SPEC-xxx] [--layer L1|L2|L3] [--gen-code] [--dry-run] [--re-run] [--auto]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

<purpose>
Validate built features against PRD acceptance criteria through automated multi-layer business testing. Unlike quality-test (interactive UAT from code gaps) and quality-test-gen (generate tests from coverage gaps), this starts from REQ-*.md acceptance criteria and works forward.

**Three-track testing** (complementary, not replacements):

| Command | Input Source | Verification Angle |
|---------|-------------|-------------------|
| `quality-business-test` | REQ-*.md acceptance criteria | **PRD-forward** -- are business rules satisfied? |
| `quality-test` | verification.json must_haves | **Code-backward** -- does the code work? |
| `quality-test-gen` | validation.json gaps | **Coverage-backward** -- is coverage sufficient? |

**Layer definitions:**

| Layer | Name | Tests | Source |
|-------|------|-------|--------|
| L1 | Interface Contract | Single endpoint request/response, input validation, schema compliance | Architecture API endpoints + REQ AC |
| L2 | Business Rule | Multi-step logic, state transitions, business constraints, edge cases | REQ acceptance criteria + NFR |
| L3 | Business Scenario | Full user flows, multi-service chains, error propagation | Epic user stories |
</purpose>

<context>
$ARGUMENTS -- phase number plus optional flags.

**Usage**:

```bash
$quality-business-test "3"                          # test phase 3 against PRD
$quality-business-test "3 --layer L1"               # L1 interface tests only
$quality-business-test "3 --gen-code"               # generate framework-specific test classes
$quality-business-test "3 --dry-run"                # extract scenarios only, don't execute
$quality-business-test "3 --re-run"                 # re-run only previously failed scenarios
$quality-business-test "3 --spec SPEC-auth-2026-04" # explicit spec reference
$quality-business-test "3 --auto"                   # skip plan confirmation
```

**Flags**:
- `<phase>`: Phase number (required)
- `--spec SPEC-xxx`: Explicit spec package reference (default: auto-detect from index.json)
- `--layer L1|L2|L3`: Run only specific layer
- `--gen-code`: Generate framework-specific test classes (JUnit/RestAssured, supertest/vitest, pytest/httpx)
- `--dry-run`: Extract scenarios and fixtures only, don't execute
- `--re-run`: Re-run only previously failed/blocked scenarios
- `--auto`: Skip interactive confirmations

`--auto` skips interactive confirmation of test plan. `--dry-run` extracts scenarios only without execution.

**Output**: `{phase_dir}/.tests/business/business-test-plan.json` + `business-test-report.json` + `business-test-summary.md`
</context>

<invariants>
1. **PRD is source of truth** -- business rules drive test scenarios, not code structure
2. **RFC 2119 keyword priority** -- MUST = critical, SHOULD = high, MAY = medium
3. **Fail-fast across layers** -- critical L1 failures block L2/L3
4. **Generator-Critic loop max 3 iterations** per layer
5. **Traceability on every result** -- every pass/fail maps to REQ-NNN:AC-N
6. **Agent calls use `run_in_background: false`** for synchronous execution
7. **Auto-create issues** in `.workflow/issues/issues.jsonl` for every failure
8. **Degraded mode** works without spec package (from success_criteria + plan.json)
9. **Never modify source code** -- this command tests, it doesn't fix
</invariants>

<execution>

### Step 1: Resolve Target & Load Spec Package

1. Parse `$ARGUMENTS` for phase number and flags
2. Set `PHASE_DIR = .workflow/phases/{NN}-{slug}/`
3. Load `index.json` -> find `spec_ref` -> locate `.workflow/.spec/SPEC-xxx/`
4. **Full mode**: Read `requirements/_index.md` + all `REQ-*.md` + `NFR-*.md` + `architecture/_index.md` + `epics/EPIC-*.md`
5. **Degraded mode** (no spec package): Read `index.json.success_criteria` + `plan.json` convergence criteria + `.summaries/TASK-*.md`
6. If `--re-run`: load previous `business-test-report.json`, filter to failed/blocked scenarios

### Step 2: Extract Business Test Scenarios from PRD

For each `REQ-NNN-{slug}.md`:

1. Parse `## Acceptance Criteria` section
2. Map RFC 2119 keywords to priority:

| Keyword | Priority | Failure = |
|---------|----------|-----------|
| MUST / SHALL | critical | blocker |
| SHOULD / RECOMMENDED | high | major |
| MAY / OPTIONAL | medium | minor |

3. Classify scenario into layer:

| Source | Layer | Category |
|--------|-------|----------|
| Architecture API endpoints + REQ AC about request/response | L1 | api_contract |
| REQ AC about business logic, validation, state changes | L2 | business_rule |
| Architecture state machine transitions | L2 | state_transition |
| Epic user stories (multi-step flows) | L3 | user_flow |
| NFR performance/security constraints | L2 | non_functional |

4. Generate scenario JSON with `id`, `req_ref` (REQ-NNN:AC-N), `layer`, `priority`, `name`, `category`, `endpoint`, `input`, `expected`, `preconditions`, `postconditions`, `mock_services`

**Degraded mode**: Extract from success_criteria (each -> L2 scenario), plan.json convergence criteria (each -> L1/L2), all default priority: high. No L3 in degraded mode.

### Step 3: Generate Test Data (Fixtures)

Three tiers:

**Tier 1 -- Schema-derived**: From REQ data models, generate valid/invalid/boundary variants per entity:
- valid: satisfies all constraints
- invalid: violate each constraint individually (null, empty, overflow, wrong type)
- boundary: edge values (min, max, min-1, max+1)

**Tier 2 -- Criteria-derived**: From "MUST return X when Y" -> `{ input: Y, expected: X }`. From "MUST validate Z" -> `{ input: invalid_Z, expected: error }`.

**Tier 3 -- Scenario-derived (L3 only)**: From Epic user stories -> scenario packs with coordinated entity IDs across steps.

**Microservice mocks**: From architecture API contract -> request/response pairs for WireMock stubs.

### Step 4: Write Test Plan & Confirm

1. Archive previous `business-test-plan.json` to `.history/` if exists
2. Write `.tests/business/business-test-plan.json` with scenarios, fixtures, mock_contracts, requirement_coverage_plan
3. Display plan summary (scenario counts per layer, fixture counts, requirement coverage)
4. If not `--auto`: wait for user confirmation (yes/edit/cancel)
5. If `--dry-run`: stop here, report plan

### Step 5: Generate Test Code (if --gen-code)

Detect project tech stack from `.workflow/specs/project-tech.json` or codebase scan.

| Stack | L1 | L2 | L3 |
|-------|----|----|-----|
| Java/Spring Boot | RestAssured + MockMvc | JUnit 5 Parameterized + WireMock | TestContainers |
| TypeScript/Node | supertest + vitest | vitest + nock | playwright/cypress |
| Python | httpx + pytest | pytest + responses | pytest + selenium |

Each test method includes REQ-NNN:AC-N reference in display name. Test files placed in `.tests/business/{layer}/`.

If no `--gen-code`: scenarios stay as structured JSON for AI agent execution.

### Step 6: Execute Tests (Progressive L1 -> L2 -> L3)

**Fail-fast**: L1 critical failures -> STOP (don't run L2). L2 critical failures -> STOP (don't run L3).

**Generator-Critic loop per layer (max 3 iterations):**

| Iteration | Action |
|-----------|--------|
| 1 | Run all scenarios. Critic: classify failures as test_defect / code_defect / env_issue |
| 2 | Auto-fix test_defects, re-run ALL scenarios |
| 3 | Final confirmation. Remaining failures = confirmed code_defects |

**Execution modes:**
- `--gen-code`: run via test framework (`mvn test`, `npx vitest`, etc.)
- default: AI agent executes scenarios against running application

Record results in `.tests/business/test-results-iter-{N}.json`.

### Step 7: Build Traceability Matrix

Map each result to `REQ-NNN:AC-N`:

```
FOR each REQ:
  FOR each AC:
    ac_status = "passed" if ALL scenarios passed
                "failed" if ANY failed
                "blocked" if ANY blocked (none failed)
                "untested" if no scenarios mapped
  verdict = "verified" if all MUST+SHOULD passed
            "partial" if some failed
            "unverified" if all failed/untested
```

### Step 8: Generate Reports

1. Archive previous report/summary to `.history/`
2. Write `.tests/business/business-test-report.json` with:
   - `layers`: per-layer stats (total, passed, failed, blocked, pass_rate)
   - `requirement_coverage`: per-REQ criteria results with failure details
   - `failures`: each with req_ref, severity, expected/actual, fix_suggestion
   - `summary`: total_requirements, fully_verified, partially_verified, unverified, coverage_pct
3. Write `.tests/business/business-test-summary.md` (human-readable tables)
4. Update `index.json` with `business_test` section

### Step 9: Feedback Loop

1. Auto-create issues from failures in `.workflow/issues/issues.jsonl` (each with `req_ref`, `source: "business-test"`)
2. Report results
3. Route next step:

| Result | Suggestion |
|--------|------------|
| All requirements verified | Skill({ skill: "maestro-phase-transition", args: "{phase}" }) |
| Failures found | Skill({ skill: "quality-debug", args: "--from-business-test {phase}" }) |
| `--re-run` all pass | Skill({ skill: "maestro-verify", args: "{phase}" }) |
| Low coverage (< 60%) | Skill({ skill: "quality-test-gen", args: "{phase}" }) |

**Closure criteria**: Requirement marked "verified" ONLY when ALL MUST+SHOULD acceptance criteria pass.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase number required | Prompt user for phase number |
| E002 | error | Phase directory not found | Verify phase exists in .workflow/phases/ |
| E003 | error | No spec package AND no success_criteria | Run maestro-spec-generate or maestro-plan first |
| E004 | error | L1 critical failures block L2/L3 | Fix blockers via quality-debug |
| W001 | warning | Degraded mode (no spec package) | Consider running maestro-spec-generate |
| W002 | warning | Some REQs have no testable AC | Note in report |
| W003 | warning | Generator-Critic loop exhausted | Accept current state |
| W004 | warning | Mock services unavailable for L3 | Skip L3 or use --gen-code |
</error_codes>

<success_criteria>
- [ ] Phase resolved and spec package loaded (or degraded mode activated)
- [ ] Business test scenarios extracted from PRD acceptance criteria
- [ ] Fixtures generated for all layers
- [ ] Test plan written and confirmed (or --auto/--dry-run)
- [ ] Tests executed progressively L1 -> L2 -> L3 with fail-fast
- [ ] Traceability matrix maps every result to REQ-NNN:AC-N
- [ ] Reports generated (JSON + summary markdown)
- [ ] Issues auto-created for all failures
- [ ] Next step suggested based on results
</success_criteria>
