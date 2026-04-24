---
name: quality-integration-test
description: Self-iterating integration test cycle via CSV wave pipeline. Progressive L0-L3 layers in linear pipeline topology with reflection-driven adaptive strategy engine. Replaces quality-integration-test command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--max-iterations N] [--target-coverage N]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Linear pipeline test execution using `spawn_agents_on_csv`. Progressive L0 -> L1 -> L2 -> L3 layers where each layer depends on the previous passing. Self-iterating 6-phase cycle (Explore -> Design -> Develop -> Test -> Reflect -> Adjust) with adaptive strategy engine.

**Core workflow**: Explore Codebase -> Design Test Plan -> Progressive Layer Execution -> Reflect -> Adjust Strategy -> Iterate

```
+-------------------------------------------------------------------------+
|              INTEGRATION TEST CSV WAVE WORKFLOW                          |
+-------------------------------------------------------------------------+
|                                                                          |
|  Phase 1: Exploration -> CSV                                             |
|     +-- Resolve phase directory from arguments                           |
|     +-- Explore codebase for integration points                          |
|     +-- Discover test infrastructure and existing tests                  |
|     +-- Load pre-generated tests from quality-test-gen                   |
|     +-- Design L0-L3 test plan                                           |
|     +-- Generate tasks.csv with rows per layer + module                  |
|     +-- User validates test plan (skip if -y)                            |
|                                                                          |
|  Phase 2: Wave Execution Engine (Linear Pipeline)                        |
|     +-- Wave 1: L0 Static Analysis                                       |
|     |   +-- Type checking (tsc --noEmit)                                 |
|     |   +-- Linting (eslint / ruff)                                      |
|     |   +-- Results: pass/fail per check                                 |
|     +-- Wave 2: L1 Unit Tests (parallel per module)                      |
|     |   +-- Each module agent runs unit tests independently              |
|     |   +-- Discoveries shared (test commands, fixtures)                 |
|     |   +-- Results: tests_passed + tests_failed per module              |
|     +-- Wave 3: L2 Integration Tests                                     |
|     |   +-- Cross-module + API + DB tests                                |
|     |   +-- Uses L1 context for test commands and patterns               |
|     |   +-- Results: tests_passed + tests_failed + coverage              |
|     +-- Wave 4: L3 E2E Tests                                             |
|     |   +-- Full user flow tests                                         |
|     |   +-- Uses L2 context for integration points                       |
|     |   +-- Results: tests_passed + tests_failed + coverage              |
|     +-- discoveries.ndjson shared across all waves (append-only)         |
|                                                                          |
|  Phase 3: Reflect + Iterate                                              |
|     +-- Calculate overall pass rate                                      |
|     +-- Reflect on results (what worked, what failed, patterns)          |
|     +-- Adjust strategy (conservative/aggressive/surgical/reflective)    |
|     +-- If pass_rate < target: iterate (back to Phase 2)                 |
|     +-- If pass_rate >= target OR max_iterations: finalize               |
|     +-- Export results.csv + summary.json                                |
|     +-- Generate context.md + reflection-log.md                          |
|     +-- Display summary with next steps                                  |
|                                                                          |
+-------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$quality-integration-test "3"
$quality-integration-test -c 4 "3 --max-iterations 8"
$quality-integration-test -y "3 --target-coverage 90"
$quality-integration-test --continue "20260318-integration-test-P3-auth"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 4)
- `--continue`: Resume existing session

When `--yes` or `-y`: Auto-confirm test plan, skip interactive validation, use defaults for layer detection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `summary.json` (structured output for downstream)
</context>

<csv_schema>
### tasks.csv (Master State)

```csv
id,title,description,test_layer,test_scope,deps,context_from,wave,status,findings,tests_passed,tests_failed,coverage,error
"1","L0 Type Check","Run TypeScript type checking with tsc --noEmit. Report all type errors with file:line references.","L0-static","src/**/*.ts","","","1","","","","","",""
"2","L0 Lint","Run ESLint on all source files. Report errors and warnings with file:line references.","L0-static","src/**/*.ts","","","1","","","","","",""
"3","L1 Auth Module","Run unit tests for auth module: token verification, session management, password hashing. Isolated tests with mocked dependencies.","L1-unit","src/auth/**/*.ts","1;2","1;2","2","","","","","",""
"4","L1 API Module","Run unit tests for API module: route handlers, middleware, validators. Isolated tests with mocked DB.","L1-unit","src/api/**/*.ts","1;2","1;2","2","","","","","",""
"5","L1 Utils Module","Run unit tests for utility functions: validation, formatting, helpers. Pure function tests.","L1-unit","src/utils/**/*.ts","1;2","1;2","2","","","","","",""
"6","L2 API Integration","Run integration tests: API endpoints with real middleware chain, DB fixtures, cross-module data flow.","L2-integration","src/api/**/*.ts;src/auth/**/*.ts","3;4;5","3;4;5","3","","","","","",""
"7","L2 DB Integration","Run integration tests: database queries, migrations, transaction handling with test DB.","L2-integration","src/db/**/*.ts","3;4;5","3;4;5","3","","","","","",""
"8","L3 User Flows","Run E2E tests: login flow, CRUD operations, error handling. Full browser/process execution.","L3-e2e","src/**/*.ts","6;7","6;7","4","","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed test execution instructions for this layer/scope |
| `test_layer` | Input | Test layer: L0-static/L1-unit/L2-integration/L3-e2e |
| `test_scope` | Input | Semicolon-separated file/module globs to test |
| `deps` | Input | Semicolon-separated dependency task IDs (previous layer tasks) |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number: 1=L0, 2=L1, 3=L2, 4=L3 |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary: failures, patterns, coverage notes (max 500 chars) |
| `tests_passed` | Output | Count of passing tests |
| `tests_failed` | Output | Count of failing tests |
| `coverage` | Output | Coverage percentage for this scope (e.g., `87.5%`) |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column populated from predecessor findings.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable integration test report | Created in Phase 3 |
| `summary.json` | Structured output for downstream commands | Created in Phase 3 |
| `reflection-log.md` | Per-iteration reflection history | Append-only across iterations |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-integration-test-P{N}-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- summary.json
+-- reflection-log.md
+-- state.json
+-- iteration-{N}/
|   +-- wave-{N}.csv (temporary)
|   +-- test-results.json
+-- wave-{N}.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave N+1 before wave N completes and results are merged
3. **Progressive Layers**: L0 -> L1 -> L2 -> L3 -- each layer gates the next
4. **CSV is Source of Truth**: Master tasks.csv holds all state
5. **Context Propagation**: prev_context built from master CSV, not from memory
6. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
7. **Self-Iterating**: Loop until convergence or max iterations -- do not stop after one pass
8. **Strategy is Adaptive**: Apply the strategy engine rules for transitions, never stay on a failing strategy
9. **Reflect Before Adjusting**: Always log reflection before changing strategy
10. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
11. **DO NOT STOP**: Continuous execution until convergence or max iterations reached
</invariants>

<execution>

### Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue')
const concurrencyMatch = $ARGUMENTS.match(/(?:--concurrency|-c)\s+(\d+)/)
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 4

// Parse integration-test-specific flags
const maxIterMatch = $ARGUMENTS.match(/--max-iterations\s+(\d+)/)
const maxIterations = maxIterMatch ? parseInt(maxIterMatch[1]) : 5
const coverageMatch = $ARGUMENTS.match(/--target-coverage\s+(\d+)/)
const targetCoverage = coverageMatch ? parseInt(coverageMatch[1]) : 95

// Clean phase text
const phaseArg = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+|--max-iterations\s+\d+|--target-coverage\s+\d+/g, '')
  .trim()

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `${dateStr}-integration-test-P${phaseArg}-${phaseSlug}`  // phaseSlug from index.json or roadmap
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)

// Initialize state.json
const state = {
  phase: phaseArg,
  started_at: getUtc8ISOString(),
  current_iteration: 0,
  max_iterations: maxIterations,
  strategy: "conservative",
  current_layer: "L0",
  pass_rates: [],
  convergence_threshold: targetCoverage,
  status: "running"
}
Write(`${sessionFolder}/state.json`, JSON.stringify(state, null, 2))

// Initialize reflection-log.md
Write(`${sessionFolder}/reflection-log.md`,
  `# Integration Test Reflection Log\nPhase: ${phaseArg}\nStarted: ${getUtc8ISOString()}\n\n## Iterations\n`)
```

### Phase 1: Exploration -> CSV

**Objective**: Explore codebase, discover integration points, design L0-L3 test plan, generate tasks.csv.

**Decomposition Rules**:

1. **Phase resolution**: Resolve `{phaseArg}` via artifact registry in `state.json` to `.workflow/scratch/{YYYYMMDD}-{type}-{slug}/`

2. **Related session discovery**: Query `state.json.artifacts[]` for all artifacts matching `phase === target_phase && milestone === current_milestone`. Each artifact's type determines its outputs: review → review.json (critical findings inform integration test focus), debug → understanding.md (root causes guide regression test layers), test → uat.md/.tests/ (prior results inform layer priorities). Extract conclusions that may affect integration test strategy.

3. **Codebase exploration**:
   - Cross-module imports and dependencies
   - API endpoints and route definitions
   - Database interactions and queries
   - External service integrations
   - Event flows and message passing

3. **Test infrastructure discovery**:
   - Detect frameworks (jest/vitest/pytest, playwright/cypress)
   - Find existing integration and E2E tests
   - Identify test utilities, fixtures, DB seed scripts

4. **Pre-generated test loading**:
   Check `{artifact_dir}/.tests/test-gen-report.json` for tests from `quality-test-gen`. Merge integration/e2e tests into plan (execute but don't re-generate).

5. **Layer design**:

| Layer | Wave | Tasks | Content |
|-------|------|-------|---------|
| L0 | 1 | 1-2 | Type check + lint commands |
| L1 | 2 | 1 per module | Unit tests per discovered module (parallel) |
| L2 | 3 | 1-3 | Integration tests (API, DB, cross-module) |
| L3 | 4 | 1-2 | E2E tests (user flows) |

6. **Dependency wiring**: L1 depends on L0, L2 depends on L1, L3 depends on L2.

7. **CSV generation**: Rows for all layers with correct wave assignments and deps.

**User validation**: Display layer breakdown with test counts (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Execute test layers wave-by-wave via spawn_agents_on_csv. Progressive -- each layer requires previous to pass.

#### Wave 1: L0 Static Analysis

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (first wave)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildL0Instruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 300,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      tests_passed: { type: "string" },
      tests_failed: { type: "string" },
      coverage: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`
8. **Gate check**: If all L0 tasks failed, skip remaining waves for this iteration

#### Wave 2: L1 Unit Tests (Parallel per Module)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps -- all L0 tasks must be completed (not failed)
4. Build `prev_context` from L0 findings:
   ```
   [Task 1: L0 Type Check] Clean -- 0 type errors
   [Task 2: L0 Lint] 3 warnings in auth module (non-blocking)
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute `spawn_agents_on_csv` for L1 agents (parallel per module)
7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`
9. **Gate check**: If all L1 tasks failed, skip L2 and L3

#### Wave 3: L2 Integration Tests

1. Read master `tasks.csv`
2. Filter rows where `wave == 3` AND `status == pending`
3. Build `prev_context` from L1 findings (test commands used, failures found, coverage gaps)
4. Write `wave-3.csv` with `prev_context`
5. Execute `spawn_agents_on_csv` for L2 agents
6. Merge results, delete temp CSV
7. **Gate check**: If all L2 tasks failed, skip L3

#### Wave 4: L3 E2E Tests

1. Read master `tasks.csv`
2. Filter rows where `wave == 4` AND `status == pending`
3. Build `prev_context` from L2 findings (integration points tested, coverage levels)
4. Write `wave-4.csv` with `prev_context`
5. Execute `spawn_agents_on_csv` for L3 agents
6. Merge results, delete temp CSV

### Phase 3: Reflect + Iterate

**Objective**: Evaluate results, reflect, adjust strategy, iterate or finalize.

#### Step 3a: Calculate Pass Rate

Aggregate across all layers:
```
overall_pass_rate = total_passed / (total_passed + total_failed) * 100
```

Record in `state.json.pass_rates[]`.

#### Step 3b: Reflect

Analyze iteration results:
- Which tests failed and why?
- Is pass rate improving, plateauing, or regressing?
- Are failures clustered in one layer/module or spread out?
- Is the current strategy working?

Append to `reflection-log.md`:
```markdown
## Iteration {N}
Strategy: {strategy_name}
Pass rate: {rate}% (previous: {prev_rate}%)
Delta: {+/-}%

### What worked
- {observation}

### What failed
- {test}: {reason}

### Pattern detected
- {pattern, e.g., "all failures in auth module"}

### Strategy assessment
- Current strategy: {effective|ineffective|partially_effective}
- Recommendation: {keep|switch_to_X}
```

#### Step 3c: Adjust Strategy (Adaptive Strategy Engine)

| Condition | Strategy | Behavior |
|-----------|----------|----------|
| Iteration 1-2 | Conservative | Fix obvious failures, don't refactor |
| Pass rate >80% AND failures similar to previous | Aggressive | Batch-fix related failures together |
| New regressions appeared | Surgical | Revert last changes, fix regression only |
| Stuck 3+ iterations (rate not improving) | Reflective | Step back, re-analyze root cause pattern |

**Strategy transitions**:
```
Conservative -> (pass rate >80%) -> Aggressive
Aggressive -> (regression) -> Surgical
Surgical -> (regression fixed) -> Aggressive
Any -> (stuck 3+ iters) -> Reflective
Reflective -> (new insight) -> Conservative (restart approach)
```

Update `state.json` with new strategy and iteration count.

#### Step 3d: Convergence Check

- If `overall_pass_rate >= target_coverage`: **CONVERGED** -> finalize
- If `iteration >= max_iterations`: **MAX_ITER_REACHED** -> finalize
- Otherwise: **ITERATE** -> reset pending tasks for failing layers, go back to Phase 2

#### Step 3e: Finalize

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. Build `summary.json`:

```json
{
  "phase": "<phase>",
  "completed_at": "<ISO>",
  "session_id": "<session-id>",
  "iterations": 3,
  "final_pass_rate": 97.5,
  "converged": true,
  "convergence_threshold": 95,
  "strategy_history": ["conservative", "conservative", "aggressive"],
  "layers": {
    "L0": { "status": "pass" },
    "L1": { "total": 15, "passed": 15, "failed": 0, "pass_rate": 100.0 },
    "L2": { "total": 8, "passed": 7, "failed": 1, "pass_rate": 87.5 },
    "L3": { "total": 4, "passed": 4, "failed": 0, "pass_rate": 100.0 }
  },
  "bugs_discovered": [],
  "regressions_fixed": []
}
```

4. Generate `context.md`:

```markdown
# Integration Test Report -- Phase {phase}

## Summary
- Iterations: {N}/{max_iter}
- Converged: {yes/no} (threshold: {threshold}%)
- Final pass rate: {rate}%
- Strategy: {final_strategy} (transitioned {N} times)

## Layer Results
| Layer | Status | Passed | Failed | Pass Rate | Coverage |
|-------|--------|--------|--------|-----------|----------|
| L0 Static | {pass/fail} | -- | -- | -- | -- |
| L1 Unit | {status} | {P} | {F} | {rate}% | {cov}% |
| L2 Integration | {status} | {P} | {F} | {rate}% | {cov}% |
| L3 E2E | {status} | {P} | {F} | {rate}% | {cov}% |

## Iteration History
| Iter | Strategy | Pass Rate | Delta | Action |
|------|----------|-----------|-------|--------|
| 1 | conservative | 72.0% | -- | fixed 3 type errors |
| 2 | conservative | 85.5% | +13.5% | fixed auth test fixtures |
| 3 | aggressive | 97.5% | +12.0% | batch-fixed API tests |

## Reflection Summary
{key insights from reflection-log.md}

## Bugs Discovered
{list of bugs found during testing}

## Next Steps
{suggested_next_command}
```

5. Copy `summary.json` to phase `.tests/integration/` directory.

6. Update `index.json` with integration test status.

7. **Register artifact**: Append to `state.json.artifacts[]` with `type: "test"`, `id: TST-NNN`, `path: "scratch/{YYYYMMDD}-integration-test-P{N}-{slug}"`, `depends_on: exec_art.id`. Output directory is independent scratch.

8. Display summary.

**Next step routing**:

| Result | Suggestion |
|--------|------------|
| Converged (>=target%) | `maestro-verify {phase}` to update validation |
| Max iter, >80% | `quality-test {phase}` for manual UAT on remaining gaps |
| Max iter, <80% | `quality-debug` for deep investigation |
| Bugs discovered | `maestro-plan {phase} --gaps` to plan fixes |

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `test_command` | `data.layer` | `{layer, command, flags, cwd}` | Working test command for a layer |
| `test_fixture` | `data.name` | `{name, file, setup, teardown}` | Shared test fixture or DB seed |
| `coverage_gap` | `data.module` | `{module, layer, uncovered_areas[]}` | Coverage gap in a module |
| `regression` | `data.test` | `{test, file, previous_status, current_status}` | Test that regressed |
| `flaky_test` | `data.test` | `{test, file, fail_rate, pattern}` | Intermittently failing test |

#### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own test execution
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"test_command","data":{"layer":"L1","command":"npx vitest run --reporter=verbose","flags":"--testPathPattern=unit","cwd":"."}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| No test framework detected | Abort with error: "No test framework detected (E003)" |
| L0 static analysis fails | Record failures, proceed to L1 (type errors are informational) |
| All tasks in a layer failed | Gate check: skip subsequent layers for this iteration |
| Agent timeout | Mark as failed, continue with remaining agents in wave |
| Max iterations without convergence | Finalize with current results, warn (W001) |
| Regression detected | Switch to Surgical strategy (W002) |
| Stuck 3+ iterations | Switch to Reflective strategy (W003) |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| state.json missing on resume | Rebuild from tasks.csv status column |
</error_codes>

<success_criteria>
- [ ] Session initialized with state.json and reflection-log.md
- [ ] tasks.csv generated with correct layer/wave assignments and dependencies
- [ ] All waves executed sequentially (L0 -> L1 -> L2 -> L3) with gate checks
- [ ] Reflection logged after each iteration with strategy assessment
- [ ] Strategy engine transitions applied correctly based on pass rates
- [ ] Convergence reached or max iterations exhausted
- [ ] results.csv, summary.json, and context.md generated
- [ ] Temporary wave-{N}.csv files cleaned up after merge
- [ ] discoveries.ndjson maintained as append-only across all waves
</success_criteria>
