# Auto-Test Workflow (Unified)

Unified automated testing with intelligent state-based routing. Merges test generation (gap-forward), business testing (PRD-forward), and integration testing (code-forward) into a single pipeline.

**Core idea: read project state → auto-select scenario source → shared pipeline from plan through iteration.**

Pipeline: Parse → Route → Source Scenarios → Discover Infrastructure → Plan → Write Tests → Execute → Iterate → Report
Only Step 2 diverges (scenario source). Everything else is shared.

---

### Step 0: Parse Input & Load Specs

**Parse arguments:**

| Input | Result |
|-------|--------|
| No arguments | Error E001 |
| Phase number | Resolve phase dir from artifact registry |
| `--max-iter N` | Set MAX_ITER = N (default 5). **1 = single-pass** (no iteration loop) |
| `--layer L` | Start from / restrict to specific layer (L0\|L1\|L2\|L3) |
| `--dry-run` | Generate plan only, do not execute |
| `--re-run` | Re-run only previously failed scenarios |

**Resolve phase dir:** from `state.json` artifact registry (`type='execute'`, matching phase). Error E002 if not found.

**Load specs:**
```
specs_test = maestro spec load --category test
specs_arch = maestro spec load --category arch
```

`specs_test` for test conventions (Steps 3-5); `specs_arch` for module boundaries (Step 2).

---

### Step 1: Read State & Route

Read project state signals and auto-select scenario source. This is the **sole branch point** in the pipeline.

```
Priority: Resume > Re-run > Spec > Gap > Code

1. RESUME:
   Check: ${PHASE_DIR}/.tests/auto-test/state.json exists AND status == "running"
   Compat: also check ${PHASE_DIR}/.tests/integration/state.json (old format)
   Action: offer resume or restart
   If resume: restore session, jump to Step 6 at saved iteration/layer
   If restart: archive to .history/, continue as new

2. RE-RUN:
   Check: --re-run flag AND .tests/auto-test/report.json has failed/blocked scenarios
   Compat: also check .tests/business/business-test-report.json (old format)
   Action: load failed/blocked scenarios with status reset to pending
   Skip to Step 4 (scenarios pre-loaded, plan confirmation)

3. SPEC:
   Check: .workflow/.spec/SPEC-*/requirements/REQ-*.md exists
   Resolve: SPEC_DIR from index.json.spec_ref or most recent SPEC-*/
   If SPEC_DIR found: set ROUTE = "spec", SPEC_MODE = "full"
   If no spec but has success_criteria: set ROUTE = "spec", SPEC_MODE = "degraded"

4. GAP:
   Check: ${PHASE_DIR}/verification.json has gaps[] with status MISSING or PARTIAL
   OR: ${PHASE_DIR}/.tests/coverage-report.json has requirements_uncovered[]
   Action: set ROUTE = "gap"

5. CODE:
   Default fallback when no spec package and no gaps detected.
   Action: set ROUTE = "code"
```

**Display route selection:**
```
=== AUTO-TEST ===
来源: {ROUTE} ({reason})
阶段: {phase_name}
{IF spec: "Spec: {SPEC_DIR} (mode: {SPEC_MODE})"}
```

---

### Step 2: Source Scenarios

Execute the route-specific scenario extraction, then normalize ALL scenarios into the unified format. **After this step, the pipeline is identical regardless of source.**

#### Route A: `spec` source (PRD-forward)

1. Load spec package:
   - `requirements/REQ-*.md` — functional requirements with acceptance criteria
   - `requirements/NFR-*.md` — non-functional requirements
   - `architecture/_index.md` — API endpoints, data model, state machines
   - `epics/EPIC-*.md` — user stories for E2E scenarios

2. For each `REQ-NNN-{slug}.md`, parse `## Acceptance Criteria`:
   - Extract each numbered criterion as a scenario seed
   - Map RFC 2119 keywords to priority:

   | Keyword | Priority | Failure Severity |
   |---------|----------|-----------------|
   | MUST / MUST NOT / SHALL / SHALL NOT | critical | blocker |
   | SHOULD / SHOULD NOT / RECOMMENDED | high | major |
   | MAY / OPTIONAL | medium | minor |

3. Classify scenario into layer:

   | Source | Layer | Category |
   |--------|-------|----------|
   | Architecture API endpoints + REQ AC about request/response | L1 | api_contract |
   | REQ AC about business logic, validation, state changes | L2 | business_rule |
   | REQ AC about state transitions (from architecture state machines) | L2 | state_transition |
   | Epic user stories (multi-step flows) | L3 | user_flow |
   | NFR performance/security constraints | L2 | non_functional |

4. **Generate Fixtures** (conditional sub-step):

   **Tier 1: Schema-derived fixtures**
   ```
   FOR each entity in REQ data model:
     valid: object satisfying all field constraints
     invalid: one variant per constraint violation (null_required, empty_string, overflow, wrong_type)
     boundary: edge value variants (min_value, max_value, min_minus_one, max_plus_one)
   ```

   **Tier 2: Acceptance-criteria-derived expectations**
   ```
   FOR each "MUST return X when Y": fixture { input: Y, expected: X }
   FOR each "MUST validate Z": fixture { input: invalid_Z, expected: validation_error }
   ```

   **Tier 3: Business-scenario-derived data sets (L3 only)**
   ```
   FOR each Epic user story:
     scenario_pack: coordinated data set across story steps
   ```

   **Mock contracts:**
   ```
   FOR each API endpoint in architecture/_index.md:
     mock_contract: { request_pattern, response_fixture }
   ```

5. **Degraded mode** (SPEC_MODE = "degraded"):
   - Extract from `index.json.success_criteria` (each → one L2 scenario)
   - Extract from `plan.json` task convergence criteria (each → one L1/L2 scenario)
   - Extract from `.summaries/TASK-*-summary.md` (each → one L1 scenario)
   - All default to priority: "high". No L3 in degraded mode.

6. Convert to unified scenario format.

#### Route B: `gap` source (coverage-forward)

1. Read gap sources:
   - `verification.json` → `gaps[]` with status MISSING or PARTIAL
   - `coverage-report.json` → `requirements_uncovered[]`
   - Task summaries → modified files list

2. Priority: MISSING or uncovered → HIGH; PARTIAL → MEDIUM.

3. Classify each changed file:

   | File Type | Category | Layer |
   |-----------|----------|-------|
   | Pure function / utility | unit | L1 |
   | React component | unit + e2e | L1 + L3 |
   | API route / handler | integration | L2 |
   | Database model / query | integration | L2 |
   | CLI command | e2e | L3 |
   | Config / types / constants / CSS / test files | skip | — |

4. **Optional: CLI supplementary analysis** (skip if no CLI tools enabled or all files "skip"):
   ```
   Bash({
     command: 'maestro delegate "PURPOSE: Analyze source files for test-worthy edge cases
   TASK: Identify error handling | boundary conditions | state transitions | external dependencies
   MODE: analysis
   CONTEXT: @${target_files}
   EXPECTED: JSON array of { file, edge_cases: [{ description, type, priority }] }
   CONSTRAINTS: Non-obvious cases only | Max 5 per file
   " --role analyze --mode analysis',
     run_in_background: true
   })
   ```
   On callback: merge edge_cases into scenarios, mark `source: "cli-analysis"`.

5. Convert to unified scenario format.

#### Route C: `code` source (exploration-forward)

1. Explore codebase for testable integration points:
   - Module boundaries and cross-module calls
   - API endpoints and their handlers
   - Database interactions and queries
   - External service integrations
   - Event flows and message passing

2. Scan for cross-module imports, API route definitions, database calls.

3. Map integration points: which modules communicate through what interfaces.

4. Infer layer from integration type:
   - Isolated function → L1
   - Cross-module call / API handler → L2
   - Full user flow → L3

5. Convert to unified scenario format.

#### Unified Scenario Format

All routes produce this identical structure:

```json
{
  "id": "AT-{NNN}",
  "source": "spec|gap|code|re-run",
  "layer": "L0|L1|L2|L3",
  "priority": "critical|high|medium",
  "category": "api_contract|business_rule|state_transition|user_flow|non_functional|unit|integration|e2e|static",
  "name": "descriptive scenario name",
  "target_file": "src/path/to/file.ts",
  "test_file": "src/path/__tests__/file.test.ts",
  "req_ref": "REQ-NNN:AC-N | gap-id | null",
  "description": "what this scenario validates",
  "test_cases": ["case 1", "case 2"],
  "input": { "$fixture_ref": "..." },
  "expected": {
    "status": 200,
    "behavior": "description of expected outcome"
  },
  "preconditions": [],
  "postconditions": [],
  "mock_services": [],
  "fixtures": {}
}
```

**Field population by route:**

| Field | spec | gap | code |
|-------|------|-----|------|
| `req_ref` | REQ-NNN:AC-N | gap ID from verification.json | null |
| `fixtures` | Tier 1-3 generated | empty (inferred in Step 5) | empty (inferred in Step 5) |
| `mock_services` | from architecture/_index.md | empty | discovered from imports |
| `preconditions` | from REQ AC text | empty | empty |

---

### Step 3: Discover Test Infrastructure

Detect existing test framework and patterns:

1. **Config files**: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `pyproject.toml`, `.mocharc.*`
2. **Existing tests**: `*.test.*`, `*.spec.*`, `test_*` (exclude node_modules, .git)
3. **Utilities**: `test-utils.*`, `testHelper*`, `conftest.py`, `setup.*`

Extract: framework, directory structure, naming convention, test utilities, run command.

Read 2-3 existing test files to learn: import style, describe/it nesting, assertion library, mock patterns, setup/teardown.

**Detect tech stack for generation:**

| Stack | L1 | L2 | L3 |
|-------|----|----|-----|
| Java/Spring Boot | MockMvc | JUnit 5 + WireMock | TestContainers |
| TypeScript/Node | vitest | supertest + nock | playwright/cypress |
| Python | pytest | httpx + responses | selenium |

If no test framework detected: Error E003.

Output: `infrastructure` object passed to Steps 5-6.

---

### Step 4: Generate Test Plan & Confirm

1. **Merge pre-existing tests** from `.tests/test-gen-report.json` (if exists):
   - Mark as "pre-existing" so Step 5 skips writing them
   - Step 6 includes them in execution

2. Apply `--layer` filter if specified.

3. **Archive previous plan** to `.history/` if exists.

4. Write `.tests/auto-test/test-plan.json`:
```json
{
  "phase": "{phase}",
  "source_route": "{ROUTE}",
  "spec_ref": "{SPEC_DIR name or null}",
  "spec_mode": "full|degraded|null",
  "generated_at": "{ISO timestamp}",
  "infrastructure": { "framework": "...", "run_command": "..." },
  "layers": {
    "L0": { "scenario_count": N, "commands": ["tsc --noEmit", "eslint src/"] },
    "L1": { "scenario_count": N, "priority_distribution": { "critical": X, "high": Y, "medium": Z } },
    "L2": { "scenario_count": N, "priority_distribution": { ... } },
    "L3": { "scenario_count": N, "priority_distribution": { ... } }
  },
  "scenarios": [ "...unified format..." ],
  "fixtures": { "...if spec source..." },
  "requirement_coverage_plan": { "requirements_targeted": [], "requirements_skipped": [] }
}
```

5. Display and confirm:
```
=== AUTO-TEST PLAN ===
来源:  {ROUTE}
阶段:  {phase_name}
Spec:  {spec_ref or "N/A"}

层级分布:
  L0 Static:      {N} checks
  L1 Unit/API:    {N} scenarios ({X} critical, {Y} high)
  L2 Integration: {N} scenarios ({X} critical, {Y} high)
  L3 E2E:         {N} scenarios ({X} critical, {Y} high)

Total: {N} scenarios, {M} test cases
Max iterations: {max_iter}

Proceed? (yes/edit/cancel)
```

- `--dry-run`: stop here, report plan
- User "edit": modify plan interactively
- User "cancel": abort

---

### Step 5: Write Tests (RED-GREEN) via CSV Parallel

**Parallel strategy**: Build `layer-L{N}-write.csv` per layer, execute via `spawn_agents_on_csv`. Each agent writes one test file independently.

#### 5a. Build Write CSV

For each layer (L1, L2, L3 — sequential):

```
Extract pending scenarios for this layer from test-plan.json
Build layer-L{N}-write.csv:
  Columns: id, name, target_file, test_file, description, test_cases, fixtures, req_ref, infrastructure_hints, prev_context

  prev_context = findings from completed prior-layer scenarios (cross-layer propagation)
```

#### 5b. Parallel Test Writing via spawn_agents_on_csv

```javascript
spawn_agents_on_csv({
  csv_path: `.tests/auto-test/.csv-session/layer-L${N}-write.csv`,
  id_column: "id",
  instruction: `
    Write ONE test file for the given scenario using RED-GREEN methodology.

    Rules:
    - Read target_file to understand module under test
    - Write test at test_file path following infrastructure_hints patterns
    - Each test_case → one it() block, include id in describe("AT-NNN: {name}")
    - Use fixtures column (infer from source if empty)
    - Run test once after writing: report red_result
    - NEVER modify source code — only write/fix test files

    RED results:
    - pass: test passes immediately (may need strengthening)
    - expected_fail: test correctly targets real behavior
    - unexpected_fail: setup/import error — fix test, re-run

    Read discoveries.ndjson for shared patterns. Append if you find reusable ones.
  `,
  max_concurrency: 5,
  max_runtime_seconds: 1800,
  output_csv_path: `.tests/auto-test/.csv-session/layer-L${N}-write-results.csv`,
  output_schema: { id, status: [written|failed], red_result: [expected_fail|unexpected_fail|pass], findings, error }
})
```

#### 5c. Merge & Continue

Merge write-results into master state. Delete temp CSV. Proceed to next layer or Step 6.

**If `--max-iter 1`:** After all layers written and run once, jump directly to Step 8 (single-pass mode, replaces test-gen behavior). Skip Steps 6-7.

---

### Step 6: Execute (Progressive Layers)

Run tests progressively through layers with fail-fast on critical:

- L0: `tsc --noEmit` + `eslint src/` (static analysis)
- L1: unit tests (`--testPathPattern="unit|__tests__"`)
- L2: integration tests (`--testPathPattern="integration"`)
- L3: E2E tests (`--testPathPattern="e2e"`)

**Fail-fast rule:**
- L0 must pass before L1
- If ANY "critical" priority failure in L1 → do NOT proceed to L2
- If ANY "critical" priority failure in L2 → do NOT proceed to L3
- "high" and "medium" failures do NOT block next layer

Record per-scenario results: `{ status, actual_response, duration_ms, error_detail, classification: null }`.

Write iteration results to `.tests/auto-test/results-iter-{N}.json`.

---

### Step 7: Reflect & Adjust (Unified Iteration Engine)

Single engine that subsumes both Generator-Critic (per-layer inner) and Reflect-Adjust (global outer). Uses `spawn_agents_on_csv` for parallel failure diagnosis.

```
OUTER LOOP (max_iter iterations):

  FOR each active layer (L0 through current):

    INNER LOOP (max 3 iterations per layer — Generator-Critic):

      1. Build diagnosis CSV from failed scenarios:

         Build diagnosis-iter-{N}.csv:
           Columns: id, scenario_id, layer, test_file, error_detail, expected, actual, target_file, source_context

         spawn_agents_on_csv({
           csv_path: `.tests/auto-test/.csv-session/diagnosis-iter-${iter}.csv`,
           id_column: "id",
           instruction: `
             Classify ONE test failure and provide fix if applicable.

             Classifications:
             - test_defect: Test wrong (bad import, endpoint, fixture, assertion)
             - code_defect: Source violates business rule (actual != expected)
             - env_issue: Environment problem (service down, config missing)

             If test_defect: provide fix_code (old → new)
             If code_defect/env_issue: leave fix_code empty, provide evidence

             Rules:
             - NEVER suggest source code changes
             - A test correctly catching a real bug = code_defect, not test_defect
             - When uncertain: prefer code_defect (conservative)
           `,
           max_concurrency: 5,
           max_runtime_seconds: 1200,
           output_csv_path: `.tests/auto-test/.csv-session/diagnosis-iter-${iter}-results.csv`,
           output_schema: { id, classification, fix_code, evidence, error }
         })

      2. Merge diagnosis results:
         - test_defect with fix_code → apply fix to test file
         - code_defect → mark as confirmed failure (stop retrying)
         - env_issue → mark as blocked

      3. IF test_defects found:
         Re-run ALL scenarios in this layer (catch regressions)

      4. IF no test_defects remain: break inner loop

    END INNER

    Record final layer results
    IF critical code_defects in this layer: stop layer progression (fail-fast)

  END FOR

  REFLECT:
    Analyze: which tests failed, pass rate improving/plateauing/regressing,
    failures clustered by component, strategy effectiveness.
    Append to reflection-log.md:
      iteration, strategy, pass_rate delta, what worked/failed,
      detected patterns, strategy assessment (effective/ineffective + recommendation)

  ADJUST (Adaptive Strategy Engine):

    | Condition | Strategy | Behavior |
    |-----------|----------|----------|
    | Iteration 1-2 | Conservative | Fix obvious test_defects only, don't refactor |
    | Pass rate >80% AND failures similar | Aggressive | Batch-fix related failures together |
    | New regressions appeared | Surgical | Revert last changes, fix regression only |
    | Stuck 3+ iterations (rate not improving) | Reflective | Step back, re-analyze root cause pattern |

    Transitions:
      Conservative --(>80%)--> Aggressive
      Aggressive --(regression)--> Surgical --(fixed)--> Aggressive
      Any --(stuck 3+ iters)--> Reflective --(insight)--> Conservative

  CONVERGENCE CHECK:
    pass_rate >= threshold (95%) → Step 8 (converged)
    iteration >= max_iter → Step 8 (max_iter_reached)
    all remaining failures = code_defect → Step 8 (confirmed_defects)
    ELSE → next outer iteration (back to Execute)

END OUTER
```

**Degenerate cases:**
- `max_iter=1`: Step 5 writes tests, Step 6 executes once, Step 7 runs Reflect only (log results), no Adjust, no loop → Step 8. Equivalent to test-gen single pass.
- `max_iter=3`: Inner loop cleans test_defects. Up to 3 outer passes. Similar to business-test.
- `max_iter=5`: Full adaptive strategy progression. Similar to integration-test.

---

### Step 8: Complete & Write Artifacts

1. Update session state:
```json
// .tests/auto-test/state.json
{
  "session_id": "auto-test-{YYYYMMDD-HHmmss}",
  "phase": "{phase}",
  "phase_dir": "{PHASE_DIR}",
  "source_route": "spec|gap|code|re-run",
  "spec_ref": "SPEC-001 | null",
  "spec_mode": "full|degraded|null",
  "status": "converged|max_iter_reached|confirmed_defects|single_pass",
  "flags": { "max_iter": 5, "layer": null, "dry_run": false, "re_run": false },
  "iteration": 2,
  "strategy": "conservative",
  "strategy_history": ["conservative", "aggressive"],
  "threshold": 95,
  "current_layer": "L2",
  "layer_state": {
    "L0": { "inner_iter": 1, "pass_rate": 100.0, "status": "passed" },
    "L1": { "inner_iter": 2, "pass_rate": 95.0, "status": "passed" },
    "L2": { "inner_iter": 1, "pass_rate": 87.5, "status": "completed" },
    "L3": { "inner_iter": 0, "pass_rate": 0, "status": "pending" }
  },
  "pass_rate_history": [72.0, 85.0, 95.0],
  "scenario_count": 30,
  "infrastructure": { "framework": "vitest", "run_command": "npm test" },
  "started_at": "{ISO}",
  "updated_at": "{ISO}"
}
```

2. Archive previous report to `.history/` if exists.

3. Write `.tests/auto-test/report.json`:
```json
{
  "phase": "{phase}",
  "source_route": "{ROUTE}",
  "spec_ref": "{spec ref or null}",
  "spec_mode": "full|degraded|null",
  "completed_at": "{ISO timestamp}",
  "convergence": {
    "status": "converged|max_iter_reached|confirmed_defects|single_pass",
    "iterations": N,
    "final_pass_rate": 95.0,
    "threshold": 95,
    "strategy_history": ["conservative", "aggressive"]
  },
  "infrastructure": { "framework": "vitest", "test_dir": "__tests__/", "run_command": "npm test" },
  "layers": {
    "L0": { "total": N, "passed": P, "failed": F, "blocked": B, "pass_rate": 100.0 },
    "L1": { "total": N, "passed": P, "failed": F, "blocked": B, "pass_rate": 95.0 },
    "L2": { ... },
    "L3": { ... }
  },
  "scenarios": [
    {
      "id": "AT-001", "source": "spec", "layer": "L1", "name": "...",
      "test_file": "...", "req_ref": "REQ-001:AC-1",
      "status": "passed|failed|blocked",
      "classification": "null|test_defect|code_defect|env_issue",
      "iterations_to_pass": 2
    }
  ],
  "failures": [
    {
      "id": "AF-001", "scenario_id": "AT-005", "req_ref": "REQ-001:AC-3",
      "layer": "L1", "severity": "critical", "classification": "code_defect",
      "description": "...", "expected": "...", "actual": "...",
      "fix_suggestion": { "file": "src/...", "line": 42, "direction": "..." }
    }
  ],
  "requirement_coverage": [],
  "summary": {
    "source_route": "{ROUTE}",
    "total_scenarios": 30, "total_passed": 26, "total_failed": 3, "total_blocked": 1,
    "bugs_discovered": 3, "test_defects_fixed": 5, "coverage_pct": 85.0
  }
}
```

4. Update `validation.json`: if gap source, change MISSING → COVERED for passing tests.
5. Update `index.json` with `auto_test` section.

**Artifact file mapping (old → new):**

| Old file | New file |
|----------|----------|
| `.tests/test-gen-report.json` | `.tests/auto-test/report.json` (source_route: "gap") |
| `.tests/integration/state.json` | `.tests/auto-test/state.json` |
| `.tests/integration/summary.json` | Merged into report.json |
| `.tests/integration/reflection-log.md` | `.tests/auto-test/reflection-log.md` |
| `.tests/business/business-test-report.json` | `.tests/auto-test/report.json` (source_route: "spec") |
| `.tests/business/business-test-summary.md` | `.tests/auto-test/traceability.md` (conditional) |

---

### Step 9: Post-Processing & Routing

#### Conditional: Traceability Matrix (spec source only)

Build REQ → AC → scenario → result mapping:

```
FOR each REQ in requirements targeted:
  FOR each AC in REQ:
    scenarios_for_ac = filter scenarios where req_ref == "REQ-NNN:AC-{N}"
    ac_status = "passed" if ALL passed
                "failed" if ANY failed
                "blocked" if ANY blocked and none failed
                "untested" if no scenarios mapped

  req.coverage_pct = passed_criteria / total_criteria * 100
  req.verdict = "verified" if all MUST+SHOULD passed
                "partial" if some failed
                "unverified" if all failed or untested
```

Populate `requirement_coverage[]` in report.json.
Write `.tests/auto-test/traceability.md` (human-readable table).

#### Conditional: Issue Creation (when failures exist)

```
FOR each failure in report.failures WHERE classification == "code_defect":
  issue = {
    id: "ISS-{YYYYMMDD}-{counter:03d}",
    title: "Auto-Test: " + failure.req_ref + " - " + failure.description,
    status: "registered",
    priority: severity_to_priority(failure.severity),
    source: "auto-test",
    phase_ref: PHASE_NUM,
    description: "Expected: " + failure.expected + ". Actual: " + failure.actual,
    fix_direction: failure.fix_suggestion.direction,
    context: { location: failure.fix_suggestion.file + ":" + failure.fix_suggestion.line },
    tags: ["auto-test", failure.layer]
  }
  Append to .workflow/issues/issues.jsonl
```

#### Report Display

```
=== AUTO-TEST RESULTS ===
阶段:      {phase_name}
来源:      {ROUTE}
迭代:      {N} (策略: {strategy_history})
收敛:      {status} ({final_pass_rate}%)

层级结果:
  L0 Static:      {pass_rate}% ({passed}/{total})
  L1 Unit/API:    {pass_rate}% ({passed}/{total})
  L2 Integration: {pass_rate}% ({passed}/{total})
  L3 E2E:         {pass_rate}% ({passed}/{total})

场景: {passed} passed, {failed} failed, {blocked} blocked
Bugs: {N} discovered
{IF spec: "需求覆盖: {pct}% | 已验证: {n}/{total}"}

Files:
  .tests/auto-test/state.json
  .tests/auto-test/test-plan.json
  .tests/auto-test/report.json
  .tests/auto-test/reflection-log.md
  {IF spec: ".tests/auto-test/traceability.md"}
```

#### Next-step routing

| Result | Suggestion |
|--------|------------|
| Converged (>=threshold) | `/maestro-verify {phase}` to update validation |
| All requirements verified (spec) | `/maestro-milestone-audit` |
| Bugs discovered (code_defects) | `/quality-debug --from-auto-test {phase}` |
| Max iter, >80% | `/quality-test {phase}` for manual UAT on remaining gaps |
| Max iter, <80% | `/quality-debug {phase}` for deep investigation |
| Coverage still low | `/quality-auto-test {phase} --layer {missing}` |
| Re-run all pass | `/maestro-verify {phase}` |
| Single pass (max_iter=1), bugs found | `/quality-debug --from-auto-test {phase}` |
| Single pass, all pass | `/quality-test {phase}` |
