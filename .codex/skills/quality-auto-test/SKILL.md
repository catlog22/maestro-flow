---
name: quality-auto-test
description: Unified automated testing via CSV layer pipeline. Reads project state to auto-select scenario source, builds scenarios.csv, executes test writing + diagnosis in parallel per layer using spawn_agents_on_csv, with iterative convergence engine.
argument-hint: "<phase> [-y] [-c N] [--max-iter N] [--layer L0-L3] [--dry-run] [--re-run]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Unified automated testing using `spawn_agents_on_csv` for parallel test writing and failure diagnosis. Reads project state to auto-select scenario source (PRD specs, coverage gaps, or code exploration). All sources converge into a shared CSV pipeline: discover infrastructure → plan → write tests via CSV parallel → execute per layer → diagnose failures via CSV parallel → iterate → report.

**Core workflow**: Route → Source Scenarios → Build CSV → Layer-by-Layer Parallel Execution → Iterate (Diagnose CSV) → Report

**Topology**: Layers as waves (L0→L1→L2→L3 sequential, scenarios within layer parallel)

```
+---------------------------------------------------------------------------+
|                    AUTO-TEST CSV LAYER PIPELINE                            |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Route & Plan -> CSV                                             |
|     +-- Read project state, auto-select route (spec/gap/code)             |
|     +-- Extract scenarios per route, normalize to unified format          |
|     +-- Discover test infrastructure (framework, patterns)                |
|     +-- Build scenarios.csv with one row per scenario                     |
|     +-- Layers = waves (L1, L2, L3 sequential; L0 = static pre-check)    |
|     +-- User validates test plan (skip if -y)                             |
|                                                                           |
|  Phase 2: Layer Execution Engine (write + run)                            |
|     +-- L0: Static analysis (tsc + eslint) — no CSV needed               |
|     +-- For each layer L1→L3 (sequential, fail-fast on critical):         |
|     |   +-- Layer N: Write Tests (parallel via spawn_agents_on_csv)       |
|     |   |   +-- Each agent writes one test file (RED-GREEN)               |
|     |   |   +-- Agent reads target source + infrastructure patterns       |
|     |   |   +-- Agent verifies RED (run test, check it targets behavior)  |
|     |   |   +-- Results: test_file written, red_result, findings          |
|     |   +-- Merge write-results into master scenarios.csv                 |
|     |   +-- Run all layer tests together (full layer execution)           |
|     |   +-- Record per-scenario pass/fail results                         |
|                                                                           |
|  Phase 3: Iteration Engine (diagnose + fix)                               |
|     +-- OUTER LOOP (max_iter iterations):                                 |
|     |   +-- For each layer with failures:                                 |
|     |   |   +-- Build diagnosis.csv from failed scenarios                 |
|     |   |   +-- Diagnose & Fix (parallel via spawn_agents_on_csv)         |
|     |   |   |   +-- Each agent classifies one failure cluster             |
|     |   |   |   +-- test_defect: agent provides fix diff                  |
|     |   |   |   +-- code_defect: agent documents evidence                 |
|     |   |   +-- Apply test_defect fixes, re-run layer                     |
|     |   +-- Reflect: analyze trends, log strategy                         |
|     |   +-- Adjust: select next strategy (conservative/aggressive/...)    |
|     |   +-- Convergence check: >=95% → done                              |
|     +-- discoveries.ndjson shared across all iterations                   |
|                                                                           |
|  Phase 4: Results & Routing                                               |
|     +-- Export results.csv                                                |
|     +-- Write report.json, state.json, reflection-log.md                  |
|     +-- Conditional: traceability.md, issue creation                      |
|     +-- Route to next step based on convergence                           |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$quality-auto-test "3"                    # auto-detect source, full iteration
$quality-auto-test -c 4 "3"              # max 4 concurrent test writers per layer
$quality-auto-test -y "3 --max-iter 1"   # single-pass generation only
$quality-auto-test "3 --dry-run"          # plan only, no execution
$quality-auto-test "3 --re-run"           # re-run only previously failed scenarios
$quality-auto-test "3 --layer L2"         # restrict to L2 integration tests
```

**Flags**:
- `-y, --yes`: Skip all confirmations
- `-c, --concurrency N`: Max concurrent agents within each layer (default: 5)
- `--max-iter N`: Max outer iterations (default 5). **1 = single-pass** generation only
- `--layer L`: Start from or restrict to specific layer (L0|L1|L2|L3)
- `--strategy conservative|aggressive|surgical|reflective`: Override starting iteration strategy (default: auto-selected)
- `--dry-run`: Generate test plan only, do not execute
- `--re-run`: Re-run only previously failed/blocked scenarios

**Intelligent routing** (auto-detected, priority order):

| Priority | Condition | Route |
|----------|-----------|-------|
| 1 | Active session (state.json status=running) | Resume |
| 2 | --re-run flag + previous failures | Re-run |
| 3 | Spec package exists (REQ-*.md) | spec (PRD-forward) |
| 4 | Nyquist gaps exist (verification.json) | gap (coverage-forward) |
| 5 | Default | code (exploration-forward) |

**Session Directory**: `.tests/auto-test/.csv-session/`
**Core Output**: `scenarios.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared) + `report.json` + `state.json`
</context>

<csv_schema>

### scenarios.csv (Master State — Test Writing Phase)

```csv
id,name,layer,priority,category,target_file,test_file,description,test_cases,fixtures,req_ref,infrastructure_hints,prev_context,status,red_result,findings,error
"AT-001","Auth token validation","L1","critical","api_contract","src/auth/token.ts","src/auth/__tests__/token.test.ts","Validate JWT token verification returns correct payload","verify valid token returns payload;verify expired token throws;verify malformed token throws","valid_token fixture;expired_token fixture","REQ-001:AC-1","vitest;describe/it pattern;see src/utils/__tests__/hash.test.ts","","","","",""
"AT-002","Login endpoint integration","L2","high","business_rule","src/routes/login.ts","src/routes/__tests__/login.integration.test.ts","POST /api/login returns JWT on valid credentials","valid login returns 200+token;invalid password returns 401;missing email returns 400","user_fixture;credentials_fixture","REQ-002:AC-1","supertest;see src/routes/__tests__/health.test.ts","AT-001 findings: token module exports verifyToken/generateToken","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Scenario ID (AT-NNN format) |
| `name` | Input | Short scenario name |
| `layer` | Input | L1/L2/L3 (determines wave order) |
| `priority` | Input | critical/high/medium |
| `category` | Input | api_contract/business_rule/state_transition/user_flow/... |
| `target_file` | Input | Source file being tested |
| `test_file` | Input | Target test file path to create |
| `description` | Input | What this scenario validates |
| `test_cases` | Input | Semicolon-separated test cases |
| `fixtures` | Input | Required fixtures/mocks (semicolon-separated) |
| `req_ref` | Input | Requirement reference (REQ-NNN:AC-N or gap-id or empty) |
| `infrastructure_hints` | Input | Framework + pattern references from Step 3 |
| `prev_context` | Computed | Findings from prior layer scenarios (cross-layer propagation) |
| `status` | Output | pending → written → passed → failed → blocked |
| `red_result` | Output | expected_fail / unexpected_fail / pass (RED phase result) |
| `findings` | Output | Implementation notes, patterns discovered (max 500 chars) |
| `error` | Output | Error message if failed |

### diagnosis.csv (Iteration Phase — Failure Diagnosis)

```csv
id,scenario_id,layer,test_file,error_detail,expected,actual,target_file,source_context,classification,fix_code,evidence,error
"DX-001","AT-003","L1","src/auth/__tests__/token.test.ts","TypeError: verifyToken is not a function","verifyToken returns decoded payload","Function not exported from module","src/auth/token.ts","token.ts exports: generateToken only","test_defect","import { verifyToken } from '../token' → import { verifyToken } from '../verify-token'","src/auth/verify-token.ts:15 exports verifyToken",""
"DX-002","AT-005","L2","src/routes/__tests__/login.test.ts","Expected 200, received 500","POST /login returns 200 with valid credentials","Internal server error: database connection refused","src/routes/login.ts","login.ts calls UserModel.findByEmail","env_issue","","Database not available in test environment",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Diagnosis ID (DX-NNN) |
| `scenario_id` | Input | Reference to AT-NNN scenario |
| `layer` | Input | Layer where failure occurred |
| `test_file` | Input | Test file that failed |
| `error_detail` | Input | Full error message/stack trace excerpt |
| `expected` | Input | Expected behavior from scenario |
| `actual` | Input | Actual behavior observed |
| `target_file` | Input | Source file being tested |
| `source_context` | Input | Relevant source code context (exports, imports) |
| `classification` | Output | test_defect / code_defect / env_issue |
| `fix_code` | Output | Fix diff for test_defect (old → new) |
| `evidence` | Output | file:line references for diagnosis |
| `error` | Output | Agent error if diagnosis failed |

### Session Structure

```
.tests/auto-test/.csv-session/
+-- scenarios.csv           (master state)
+-- results.csv             (final export)
+-- discoveries.ndjson      (shared across iterations)
+-- layer-L{N}-write.csv    (temporary, per-layer write input)
+-- layer-L{N}-write-results.csv
+-- diagnosis-iter-{N}.csv  (temporary, per-iteration diagnosis)
+-- diagnosis-iter-{N}-results.csv
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization
2. **Layer Order is Sacred**: Never execute L(N+1) before L(N) completes (fail-fast on critical)
3. **CSV is Source of Truth**: Master scenarios.csv holds all test execution state
4. **Context Propagation**: prev_context built from prior-layer findings in CSV, not memory
5. **Discovery Board Append-Only**: Never clear or modify discoveries.ndjson
6. **Route Auto-Detected**: Read state, never ask user for mode
7. **RED-GREEN Methodology**: Tests target real behavior; failing test = bug discovery (never fix source)
8. **Max 3 Inner Fix Attempts**: Per layer, fix test_defects up to 3 times via diagnosis CSV
9. **Convergence Threshold**: 95% pass rate = converged
10. **DO NOT STOP**: Continuous execution until convergence, max_iter, or all remaining = code_defect
</invariants>

<execution>

### Session Initialization

```
Parse from $ARGUMENTS:
  AUTO_YES        ← --yes | -y
  maxConcurrency  ← --concurrency | -c N  (default: 5)
  MAX_ITER        ← --max-iter N  (default: 5)
  layerFilter     ← --layer L  (default: null = all)
  startStrategy   ← --strategy conservative|aggressive|surgical|reflective  (default: null = auto)
  dryRun          ← --dry-run
  reRun           ← --re-run
  phaseArg        ← remaining text

Derive:
  dateStr        ← UTC+8 YYYYMMDD
  sessionFolder  ← ".tests/auto-test/.csv-session"

mkdir -p {sessionFolder}
```

### Phase 1: Route & Plan → CSV

#### Step 0: Parse & Load

Resolve phase dir from `state.json` artifact registry (`type='execute'`, matching phase). Error E002 if not found.

```
specs_test = maestro spec load --category test
specs_arch = maestro spec load --category arch
```

#### Step 1: Read State & Route

```
Priority: Resume > Re-run > Spec > Gap > Code

1. RESUME: .csv-session/scenarios.csv exists AND state.json status == "running"
   → offer resume or restart (resume = reload CSV, jump to current iteration)

2. RE-RUN: --re-run flag AND report.json has failed/blocked scenarios
   → load failed scenarios into CSV with status reset to pending

3. SPEC: .workflow/.spec/SPEC-*/requirements/REQ-*.md exists
   → ROUTE = "spec", SPEC_MODE = "full" | "degraded"

4. GAP: verification.json has gaps[] (MISSING/PARTIAL)
   → ROUTE = "gap"

5. CODE: Default fallback → ROUTE = "code"
```

#### Step 2: Source Scenarios

Execute route-specific extraction, normalize to unified format.

**Route A: spec** — Parse REQ acceptance criteria, classify layers, generate fixtures.
**Route B: gap** — Read verification/coverage gaps, classify files by type.
**Route C: code** — Explore module boundaries, API endpoints, integration points.

All routes produce unified scenario objects (see csv_schema).

#### Step 3: Discover Infrastructure

Detect framework, read 2-3 existing tests for patterns. Build `infrastructure_hints` string per scenario.

#### Step 4: Build scenarios.csv & Confirm

1. Build master `scenarios.csv` — one row per scenario, grouped by layer
2. Set `prev_context` for L2 scenarios from L1 scenario descriptions (cross-layer dependency)
3. Set `prev_context` for L3 from L2 findings

Display plan summary:
```
=== AUTO-TEST PLAN ===
来源:  {ROUTE}  |  阶段:  {phase_name}  |  Spec:  {spec_ref or "N/A"}

  L0 Static:      {N} checks
  L1 Unit/API:    {N} scenarios ({X} critical, {Y} high)
  L2 Integration: {N} scenarios ({X} critical, {Y} high)
  L3 E2E:         {N} scenarios ({X} critical, {Y} high)

Total: {N} scenarios | Max iterations: {MAX_ITER} | Concurrency: {maxConcurrency}
Proceed? (yes/edit/cancel)
```

- `--dry-run`: stop here. `-y`: skip confirmation.

### Phase 2: Layer Execution Engine (Write + Run)

#### L0: Static Analysis (no CSV)

```bash
tsc --noEmit && eslint src/
```

If L0 fails → stop, do not proceed to L1.

#### Per-Layer Write Loop (L1 → L2 → L3)

For each layer (sequential, respecting --layer filter):

**1. Extract layer rows** from master `scenarios.csv` (filter by `layer == L{N}`, status == pending)

**2. Populate `prev_context`** from completed prior-layer findings in master CSV

**3. Write `layer-L{N}-write.csv`** then execute parallel test writing:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/layer-L${N}-write.csv`,
  id_column: "id",
  instruction: buildTestWriterInstruction(infrastructure, specsContent, phaseDir),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 1800,
  output_csv_path: `${sessionFolder}/layer-L${N}-write-results.csv`,
  output_schema: { id, status: [written|failed], red_result: [expected_fail|unexpected_fail|pass], findings, error }
})
```

**Test Writer Agent Instruction** (per scenario row):
```
You are a test writer. Write ONE test file for the given scenario.

## Task
- Read the target_file to understand the module under test
- Write test file at test_file path following infrastructure_hints patterns
- Each test case in test_cases becomes one it() block
- Use fixtures from fixtures column (infer from source if empty)
- Include scenario id in describe: describe("AT-NNN: {name}", ...)
- Run the test file once after writing

## RED-GREEN Rules
- If test PASSES immediately: note "pass" — may need strengthening
- If test FAILS as expected (tests real behavior): note "expected_fail" — good
- If test FAILS unexpectedly (setup/import error): fix test setup, note "unexpected_fail"
- NEVER modify source code — only write/fix test files

## Output
- status: "written" if test file created successfully, "failed" if unable
- red_result: the RED phase outcome
- findings: patterns discovered, notes for dependent scenarios (max 500 chars)
- error: only if status == "failed"

## Context
- prev_context: {prev_context} (findings from prior layer)
- Read discoveries.ndjson for shared patterns before starting
- Append to discoveries.ndjson if you find reusable patterns
```

**4. Merge write-results** into master `scenarios.csv`, delete temp CSV

**5. Run full layer test suite:**
```bash
{run_command} --testPathPattern="{layer_pattern}"
```

**6. Record per-scenario results** (pass/fail/blocked with error_detail)

**7. Fail-fast check:** If ANY critical-priority scenario failed → do NOT proceed to next layer

**If `--max-iter 1`:** After all layers written and run once, jump to Phase 4 (single-pass).

### Phase 3: Iteration Engine (Diagnose + Fix)

```
OUTER LOOP (max_iter iterations):

  FOR each layer with failures (L1 through current):

    INNER LOOP (max 3 per layer):

      1. Build diagnosis.csv from failed scenarios in master CSV
         (only scenarios with status=failed AND classification != code_defect)

      2. IF diagnosis rows >= 1:
         spawn_agents_on_csv({
           csv_path: `${sessionFolder}/diagnosis-iter-${iter}.csv`,
           id_column: "id",
           instruction: buildDiagnosisInstruction(infrastructure),
           max_concurrency: maxConcurrency,
           max_runtime_seconds: 1200,
           output_csv_path: `${sessionFolder}/diagnosis-iter-${iter}-results.csv`,
           output_schema: { id, classification, fix_code, evidence, error }
         })

      3. Merge diagnosis results:
         - test_defect with fix_code → apply fix, update scenario status to "pending"
         - code_defect → mark as confirmed failure (stop retrying)
         - env_issue → mark as blocked

      4. Re-run ALL scenarios in this layer (catch regressions)
      5. IF no test_defects remain: break inner loop

    END INNER

    Record final layer results
    IF critical code_defects: stop layer progression (fail-fast)

  END FOR

  REFLECT:
    Analyze: pass rate delta, failure clusters, strategy effectiveness
    Append to reflection-log.md

  ADJUST (Adaptive Strategy):
    IF startStrategy provided AND iteration == 1: use startStrategy as initial
    OTHERWISE auto-select:

    | Condition | Strategy |
    |-----------|----------|
    | Iteration 1-2 | Conservative: fix obvious test_defects only |
    | Pass rate >80% | Aggressive: batch-fix related failures |
    | New regressions | Surgical: revert, fix regression only |
    | Stuck 3+ iters | Reflective: re-analyze root cause pattern |

  CONVERGENCE:
    pass_rate >= 95% → Phase 4 (converged)
    iteration >= max_iter → Phase 4 (max_iter_reached)
    all remaining = code_defect → Phase 4 (confirmed_defects)
    ELSE → next iteration

END OUTER
```

**Diagnosis Agent Instruction** (per failure row):
```
You are a test failure diagnostician. Classify ONE test failure and provide fix if applicable.

## Task
- Read test_file and target_file to understand the failure context
- Analyze error_detail against expected vs actual
- Classify the failure:
  - test_defect: Test is wrong (bad import, wrong endpoint, bad fixture, incorrect assertion)
  - code_defect: Source code violates business rule (actual behavior != expected requirement)
  - env_issue: Environment problem (service down, config missing, timeout)

## Output
- classification: one of test_defect / code_defect / env_issue
- fix_code: If test_defect, provide the fix (format: "old_line → new_line" or full replacement)
             If code_defect or env_issue, leave empty
- evidence: file:line references supporting your classification
- error: only if you cannot determine classification

## Rules
- NEVER suggest source code changes — only test code fixes for test_defect
- A test that correctly catches a real bug is a code_defect, not test_defect
- When uncertain between test_defect and code_defect, prefer code_defect (conservative)
```

### Shared Discovery Board Protocol

| Type | Dedup Key | Data Schema |
|------|-----------|-------------|
| `test_pattern` | `data.name` | `{name, file, description}` |
| `mock_setup` | `data.target` | `{target, setup_code, file}` |
| `fixture` | `data.name` | `{name, schema, file}` |
| `convention` | singleton | `{describe_style, assertion_lib, import_pattern}` |
| `blocker` | `data.issue` | `{issue, severity, layer}` |

Read before writing tests. Append-only. Dedup by type+key.

### Phase 4: Results & Routing

1. Export final `scenarios.csv` as `results.csv`

2. Write `.tests/auto-test/state.json`:
```json
{
  "session_id": "auto-test-{YYYYMMDD-HHmmss}",
  "phase": "{phase}", "phase_dir": "{PHASE_DIR}",
  "source_route": "spec|gap|code|re-run",
  "status": "converged|max_iter_reached|confirmed_defects|single_pass",
  "iteration": N, "strategy": "conservative",
  "strategy_history": [...],
  "threshold": 95, "current_layer": "L2",
  "layer_state": {
    "L0": { "inner_iter": 1, "pass_rate": 100.0, "status": "passed" },
    "L1": { "inner_iter": 2, "pass_rate": 95.0, "status": "passed" },
    "L2": { ... }, "L3": { ... }
  },
  "pass_rate_history": [...],
  "scenario_count": 30,
  "csv_session": ".tests/auto-test/.csv-session/"
}
```

3. Write `.tests/auto-test/report.json` (same schema as workflow reference)

4. **Conditional: Traceability** (spec source only) — build REQ→AC→scenario→result mapping

5. **Conditional: Issue Creation** (code_defect failures):
```
FOR each failure WHERE classification == "code_defect":
  Append to .workflow/issues/issues.jsonl
```

6. **Register artifact** in state.json:
```json
{ "id": "TST-NNN", "type": "test", "status": "completed|failed" }
```

7. **Report Display:**
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

CSV Session: .tests/auto-test/.csv-session/
```

8. **Route:**

| Result | Next Step |
|--------|-----------|
| Converged (>=95%) | `$maestro-verify "{phase}"` |
| All requirements verified (spec) | `$maestro-milestone-audit` |
| Bugs discovered | `$quality-debug "--from-auto-test {phase}"` |
| Max iter, >80% | `$quality-test "{phase}"` for manual UAT |
| Max iter, <80% | `$quality-debug "{phase}"` |
| Coverage still low | `$quality-auto-test "{phase} --layer {missing}"` |
| Re-run all pass | `$maestro-verify "{phase}"` |
| Single pass, all pass | `$quality-test "{phase}"` |

</execution>

<error_codes>
| Error | Resolution |
|-------|------------|
| Phase not found in artifact registry | Abort: "Phase {N} not found" |
| No test framework detected | Abort: E003. Install framework or configure runner |
| Agent spawn fails (write or diagnosis) | Retry once, then mark scenario as blocked |
| Convergence not met after max_iter | Report max_iter_reached, suggest debug |
| All scenarios in layer blocked | Stop layer, report env_issue |
| CSV parse error | Validate format, show line |
| discoveries.ndjson corrupt | Ignore malformed lines, continue |
| Resume: no session found | Start fresh |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid scenarios.csv
- [ ] Route auto-selected from project state (spec/gap/code)
- [ ] All layers executed in order with fail-fast on critical
- [ ] Test writing parallelized via spawn_agents_on_csv per layer
- [ ] Failure diagnosis parallelized via spawn_agents_on_csv per iteration
- [ ] discoveries.ndjson append-only throughout
- [ ] Cross-layer context propagation via prev_context column
- [ ] Iteration engine ran (inner: test_defect fix, outer: strategy adjust)
- [ ] state.json, report.json, reflection-log.md written
- [ ] If spec: traceability.md produced
- [ ] If failures: issues auto-created in issues.jsonl
- [ ] Next step routed based on convergence status
</success_criteria>
