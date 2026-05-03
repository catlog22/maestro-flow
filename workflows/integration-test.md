# Integration Test Workflow

Self-iterating integration test cycle that combines exploration, test design, execution, reflection, and adaptive strategy adjustment. Runs automated tests in a closed loop that self-corrects until convergence.

6-phase cycle: Explore -> Design -> Develop -> Test -> Reflect -> Adjust
Adaptive strategy: Conservative -> Aggressive -> Surgical -> Reflective
L0-L3 progressive layers: Static Analysis -> Unit -> Integration -> E2E

---

### Step 1: Parse Input and Initialize

**Parse arguments:**

| Input | Result |
|-------|--------|
| No arguments | Error E001 |
| Phase number | Resolve phase dir from artifact registry |
| `--max-iter N` | Set MAX_ITER = N (default 5) |
| `--layer L2` | Start from L2 layer |

**Resolve phase dir:** from state.json artifact registry (type='execute', matching phase). Error if not found.

If existing session at `${PHASE_DIR}/.tests/integration/state.json`: offer resume or restart.

**Initialize session:** create `.tests/integration/` directory, write initial `state.json` (iteration=0, strategy=conservative, layer=L0, threshold=95, status=running), initialize `reflection-log.md`.

---

### Step 1.3: Load Project Specs

```
specs_content = maestro spec load --category test
arch_content = maestro spec load --category arch
```

`specs_content` for test conventions; `arch_content` for module boundaries in Step 2-3.

---

### Step 1.5: Load Previously Generated Tests

Load pre-generated integration/e2e tests from `${PHASE_DIR}/.tests/test-gen-report.json` (if exists).
These are merged into the test plan in Step 3 -- executed but not re-generated.

---

### Step 2: Explore

**Phase 1: Explore codebase for testable integration points.**

Discover:
- Module boundaries and cross-module calls
- API endpoints and their handlers
- Database interactions and queries
- External service integrations
- Event flows and message passing

Scan for cross-module imports, API route definitions, and database calls.
Map integration points: which modules communicate through what interfaces.

---

### Step 3: Design

**Phase 2: Design integration test plan.**

**Merge pre-generated tests** (from Step 1.5):
If `generated_tests` is not empty, incorporate them into the test plan directly — mark as "pre-existing" so Step 4 (Develop) skips writing them and Step 5 (Test Execute) includes them in the run.

Based on exploration (and pre-generated tests if available), design tests per layer:

**L0 - Static Analysis:**
- Type check command
- Lint command
- Dead code detection

**L1 - Unit Tests (isolation):**
- Critical functions identified in explore
- Edge cases for core logic

**L2 - Integration Tests:**
- API endpoint tests (request -> response)
- Cross-module interaction tests
- Database query tests (with fixtures)

**L3 - E2E Tests:**
- Critical user flows
- Happy path + error path

Write test plan to `.tests/integration/test-plan.json`:
```json
{
  "layers": {
    "L0": { "commands": ["tsc --noEmit", "eslint src/"], "expected_pass": true },
    "L1": { "test_files": [...], "test_count": N },
    "L2": { "test_files": [...], "test_count": N },
    "L3": { "test_files": [...], "test_count": N }
  },
  "total_tests": M
}
```

---

### Step 4: Develop

**Phase 3: Develop/write test code.**

For each layer (current and below), write tests following existing patterns.
Use auto-test's RED-GREEN methodology for test writing.

For integration tests (L2) specifically:
- Set up test fixtures (DB seeds, mock services)
- Write request/response assertions
- Test error handling paths
- Verify cross-module data flow

---

### Step 5: Test Execute

**Phase 4: Execute tests for current layer.**

Run tests progressively (L0 must pass before L1, etc.):
- L0: `tsc --noEmit` + `eslint src/`
- L1: unit tests (`--testPathPattern="unit|__tests__"`)
- L2: integration tests (`--testPathPattern="integration"`)
- L3: E2E tests (`--testPathPattern="e2e"`)

Record per-layer results (status, total/passed/failed/pass_rate) and overall_pass_rate in `test-results-iter-{N}.json`.

---

### Step 6: Reflect

**Phase 5: Reflect on iteration results.**

Analyze: which tests failed, is pass rate improving/plateauing/regressing, are failures clustered, is strategy working.

Append to `reflection-log.md`: iteration strategy, pass rate delta, what worked/failed, detected patterns, strategy assessment (effective/ineffective + recommendation).

---

### Step 7: Adjust

**Phase 6: Adjust strategy based on reflection.**

**Adaptive Strategy Engine:**

| Condition | Strategy | Behavior |
|-----------|----------|----------|
| Iteration 1-2 | Conservative | Fix obvious failures, don't refactor |
| Pass rate >80% AND failures similar to previous | Aggressive | Batch-fix related failures together |
| New regressions appeared | Surgical | Revert last changes, fix regression only |
| Stuck 3+ iterations (rate not improving) | Reflective | Step back, re-analyze root cause pattern |

**Strategy transitions:** Conservative --(>80%)--> Aggressive --(regression)--> Surgical --(fixed)--> Aggressive. Any --(stuck 3+ iters)--> Reflective --(insight)--> Conservative.

Update state.json. **Convergence:** pass_rate >= 95% -> Step 8. max_iterations reached -> Step 8. Otherwise -> Step 4.

---

### Step 8: Complete

Update state.json status to "complete" or "max_iter_reached".
Write `.tests/integration/summary.json`: iterations, final_pass_rate, converged flag, strategy_history, per-layer results, bugs_discovered, regressions_fixed.
Update index.json with integration test results.

---

### Step 9: Report

Display summary: iterations, convergence status, per-layer pass rates, overall rate, strategy transitions, bugs/regressions found.

List output files: state.json, reflection-log.md, summary.json.

**Next step routing:**

| Result | Suggestion |
|--------|------------|
| Converged (>=95%) | Skill({ skill: "maestro-verify", args: "{phase}" }) to update validation |
| Max iter, >80% | Skill({ skill: "quality-test", args: "{phase}" }) for manual UAT on remaining gaps |
| Max iter, <80% | Skill({ skill: "quality-debug" }) for deep investigation |
| Bugs discovered | Skill({ skill: "maestro-plan", args: "{phase} --gaps" }) to plan fixes |
