---
name: quality-auto-test
description: Use when test coverage needs automated expansion or existing tests need iterative convergence
argument-hint: "<phase> [-y] [-c N] [--max-iter N] [--layer L0-L3] [--dry-run] [--re-run]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
CSV-parallel automated testing pipeline via `spawn_agents_on_csv`.
Route -> Source Scenarios -> Write Tests (parallel per layer) -> Execute (L0->L3 sequential) -> Diagnose Failures (parallel) -> Iterate -> Report.

Topology: layers as waves (L0->L1->L2->L3 sequential, scenarios within layer parallel).
</purpose>

<context>
$ARGUMENTS -- phase number and optional flags.

**Flags**:
- `-y, --yes`: Skip all confirmations
- `-c, --concurrency N`: Max concurrent agents per layer (default: 5)
- `--max-iter N`: Max outer iterations (default: 5; 1 = single-pass)
- `--layer L`: Restrict to specific layer (L0|L1|L2|L3)
- `--strategy conservative|aggressive|surgical|reflective`: Override starting strategy
- `--dry-run`: Generate test plan only, no execution
- `--re-run`: Re-run only previously failed/blocked scenarios

**Intelligent routing** (auto-detected):

| Priority | Condition | Route |
|----------|-----------|-------|
| 1 | Active session (state.json running) | Resume |
| 2 | --re-run + previous failures | Re-run |
| 3 | REQ-*.md exists | spec (PRD-forward) |
| 4 | verification.json has gaps | gap (coverage-forward) |
| 5 | Default | code (exploration-forward) |

**Session**: `.tests/auto-test/.csv-session/`
**Output**: scenarios.csv, results.csv, discoveries.ndjson, report.json, state.json, reflection-log.md
</context>

<csv_schema>

### scenarios.csv (Test Writing Phase)

```csv
id,name,layer,priority,category,target_file,test_file,description,test_cases,fixtures,req_ref,infrastructure_hints,prev_context,status,red_result,findings,error
"AT-001","Auth token validation","L1","critical","api_contract","src/auth/token.ts","src/auth/__tests__/token.test.ts","Validate JWT verification","verify valid;verify expired;verify malformed","valid_token;expired_token","REQ-001:AC-1","vitest;describe/it;see hash.test.ts","","","","",""
```

**scenarios.csv column semantics**:
- Input: id (AT-NNN), name, layer (L1/L2/L3 = wave order), priority (critical/high/medium), category (api_contract/business_rule/state_transition/user_flow/...), target_file (source file tested), test_file (test file path to create), description (what scenario validates), test_cases (semicolon-sep, each -> one it() block), fixtures (required mocks/fixtures, semicolon-sep), req_ref (REQ-NNN:AC-N or gap-id or empty), infrastructure_hints (framework + pattern refs from infra discovery)
- Computed: prev_context (findings from prior layer scenarios, cross-layer propagation)
- Output: status (pending->written->passed->failed->blocked), red_result (expected_fail/unexpected_fail/pass), findings (patterns discovered, notes for dependents, max 500 chars), error

### diagnosis.csv (Iteration Phase)

```csv
id,scenario_id,layer,test_file,error_detail,expected,actual,target_file,source_context,classification,fix_code,evidence,error
"DX-001","AT-003","L1","token.test.ts","TypeError: not a function","verifyToken returns payload","Not exported","token.ts","exports: generateToken only","test_defect","fix import path","verify-token.ts:15",""
```

**diagnosis.csv column semantics**:
- Input: id (DX-NNN), scenario_id (ref to AT-NNN), layer, test_file, error_detail (full error/stack excerpt), expected (from scenario), actual (observed behavior), target_file, source_context (relevant code: exports, imports)
- Output: classification (test_defect/code_defect/env_issue), fix_code (for test_defect: "old → new" or full replacement; empty for code_defect/env_issue), evidence (file:line references), error
</csv_schema>

<invariants>
1. **Layer order sacred**: Never execute L(N+1) before L(N) completes (fail-fast on critical)
2. **CSV is source of truth**: Master scenarios.csv holds all state
3. **Context propagation**: prev_context from prior-layer findings in CSV
4. **Discovery board append-only**: Never modify/delete discoveries.ndjson
5. **Route auto-detected**: Read state, never ask user for mode
6. **RED-GREEN methodology**: Tests target real behavior; failing test = bug discovery (never fix source)
7. **Max 3 inner fix attempts**: Per layer, fix test_defects up to 3 times via diagnosis CSV
8. **Convergence threshold**: 95% pass rate = converged
</invariants>

<state_machine>

<states>
S_PARSE      -- 解析参数、路由检测                          PERSIST: --
S_SOURCE     -- 提取场景（spec/gap/code route）             PERSIST: --
S_INFRA      -- 发现测试基础设施（framework/patterns）      PERSIST: --
S_CSV_GEN    -- 生成 scenarios.csv                          PERSIST: scenarios.csv
S_L0         -- Static analysis (tsc + eslint, no CSV)       PERSIST: L0 results
S_LAYER_EXEC -- Per-layer write + run (L1->L2->L3)           PERSIST: test files + scenarios.csv
S_ITERATE    -- Diagnose failures + fix loop                  PERSIST: diagnosis CSV + reflection-log.md
S_REPORT     -- 输出报告、路由下一步                        PERSIST: report.json + state.json + results.csv
</states>

<transitions>

S_PARSE:
  -> S_SOURCE       DO: resolve phase dir, detect route (resume/re-run/spec/gap/code)

S_SOURCE:
  -> S_INFRA        DO: extract scenarios per route, normalize to unified format, integrate quality artifacts
  Route A (spec): Parse REQ-*.md acceptance criteria, classify layers, generate fixtures
  Route B (gap): Read verification/coverage gaps, classify files by type
  Route C (code): Explore module boundaries, API endpoints, integration points

  **Cross-artifact integration** (all routes, after primary extraction):
  - **Review findings**: Query state.json for type=review artifacts on same phase. Extract critical/high findings → additional scenarios marked `source: "review_finding"`. If review verdict=="BLOCK" and these tests fail, suggest quality-debug.
  - **Debug root causes**: Query state.json for type=debug artifacts on same phase. Generate regression test scenarios from confirmed root causes → marked `source: "debug_root_cause"`.

S_INFRA:
  -> S_CSV_GEN      DO: detect framework, read 2-3 existing tests, build infrastructure_hints

S_CSV_GEN:
  -> S_L0           DO: build scenarios.csv, set cross-layer prev_context
  -> END            WHEN: --dry-run (plan only)

S_L0:
  -> S_LAYER_EXEC   WHEN: L0 passes
  -> END            WHEN: L0 fails (stop, do not proceed)

S_LAYER_EXEC:
  -> S_ITERATE      WHEN: failures exist AND max_iter > 1    DO: A_PER_LAYER_WRITE_RUN
  -> S_REPORT       WHEN: all pass OR max_iter == 1          DO: A_PER_LAYER_WRITE_RUN

S_ITERATE:
  -> S_REPORT       WHEN: converged (>=95%) OR max_iter reached OR all remaining = code_defect
  -> S_ITERATE      WHEN: more iterations needed              DO: A_ITERATE_LOOP

S_REPORT:
  -> END            DO: A_REPORT

</transitions>

<actions>

### A_PER_LAYER_WRITE_RUN

For each layer L1->L3 (sequential, respecting --layer filter):

1. Extract layer rows from scenarios.csv (status==pending)
2. Populate prev_context from completed prior-layer findings in master CSV
3. Write layer-L{N}-write.csv -> `spawn_agents_on_csv` for parallel test writing
4. Merge write-results -> scenarios.csv
5. Run full layer test suite: `{run_command} --testPathPattern="{layer_pattern}"`
6. Record per-scenario pass/fail
7. Fail-fast: any critical-priority failed -> stop layer progression

**Test Writer Spawn output_schema** (strict JSON Schema, used for both writer + diagnosis spawns):

```json
{
  "type": "object",
  "properties": {
    "id":             { "type": "string" },
    "result_status":  { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "red_result":     { "type": "string", "enum": ["expected_fail", "pass", "unexpected_fail", ""] },
    "classification": { "type": "string", "enum": ["test_defect", "code_defect", "env_issue", ""] },
    "fix_code":       { "type": "string" },
    "evidence":       { "type": "string" },
    "findings":       { "type": "string", "maxLength": 500 },
    "files_modified": { "type": "string" },
    "error":          { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge: `result_status` → master `status`; copy `red_result` / `classification` / `fix_code` / `evidence` / `findings` / `files_modified` / `error`.

**Test Writer Agent Instruction** (injected into spawn_agents_on_csv):
```
You are a test writer. Write ONE test file for the given scenario.

## Task
- Read target_file to understand module under test
- Write test file at test_file path following infrastructure_hints patterns
- Each test_case in test_cases -> one it() block
- Use fixtures from fixtures column (infer from source if empty)
- Include scenario id in describe: describe("AT-NNN: {name}", ...)
- Run test file once after writing

## RED-GREEN Rules
- Test PASSES immediately: red_result="pass" — may need strengthening
- Test FAILS as expected (tests real behavior): red_result="expected_fail" — good
- Test FAILS unexpectedly (setup/import error): fix test setup, red_result="unexpected_fail"
- NEVER modify source code — only write/fix test files

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed (test file written + run executed; red_result populated)
- Failure → result_status=failed (cannot write test file, parse error, missing target)
- Blocked → result_status=blocked (test framework unavailable)
- Timeout → near max_runtime_seconds → result_status=failed with error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output (must match output_schema)
{
  "id": "<row id>",
  "result_status": "completed" | "failed" | "blocked",
  "red_result": "expected_fail" | "pass" | "unexpected_fail" | "",
  "findings": "<patterns discovered, notes for dependent scenarios, max 500 chars>",
  "files_modified": "<test file path>",
  "error": "<message if not completed, else empty>"
}

## Hard Constraints
- Do NOT modify source code under test (only test files).
- Do NOT write to scenarios.csv, layer-L*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).

## Context
- prev_context: {prev_context} (findings from prior layer)
- Read discoveries.ndjson for shared patterns before starting
- Append to discoveries.ndjson if you find reusable patterns
```

### A_ITERATE_LOOP

OUTER LOOP (max_iter iterations):
  FOR each layer with failures:
    INNER LOOP (max 3):
      1. Build diagnosis.csv from failed scenarios (exclude code_defect)
      2. `spawn_agents_on_csv` for parallel diagnosis
      3. Diagnosis agent (see instruction below). test_defect -> provide fix. code_defect -> document evidence.
      4. Apply test_defect fixes, re-run layer

**Diagnosis Agent Instruction** (injected into spawn_agents_on_csv; uses same output_schema as Test Writer):
```
You are a test failure diagnostician. Classify ONE test failure.

## Task
- Read test_file and target_file to understand failure context
- Analyze error_detail against expected vs actual
- Classify:
  - test_defect: Test wrong (bad import, wrong endpoint, bad fixture, incorrect assertion)
  - code_defect: Source violates business rule (actual != expected requirement)
  - env_issue: Environment problem (service down, config missing, timeout)

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed with concrete classification
- Failure → result_status=failed if you cannot read test_file or target_file
- Blocked → result_status=blocked when env_issue prevents diagnosis
- Timeout → near max_runtime_seconds → result_status=failed with error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output (must match output_schema)
{
  "id": "<row id>",
  "result_status": "completed" | "failed" | "blocked",
  "classification": "test_defect" | "code_defect" | "env_issue",
  "fix_code": "<old_line → new_line or full replacement (test_defect only); empty otherwise>",
  "evidence": "<file:line refs supporting classification>",
  "findings": "<one-sentence diagnosis summary, max 500 chars>",
  "error": "<message if not completed>"
}

## Hard Constraints
- NEVER suggest source code changes — only test fixes for test_defect
- Test correctly catching a real bug = code_defect, not test_defect
- When uncertain: prefer code_defect (conservative)
- Do NOT write to scenarios.csv, layer-L*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).
```
      5. If no test_defects remain: break inner
  REFLECT: analyze trends, log strategy, test confidence scoring (5 dims: scenario_coverage, test_quality, diagnostic_accuracy, strategy_effectiveness, infrastructure_fitness)
  ADJUST: auto-select strategy (conservative iter 1-2, aggressive >80%, surgical on regression, reflective stuck 3+)
  CONVERGENCE: >=95% -> report; max_iter -> report; all code_defect -> report

### A_REPORT

1. Export results.csv
2. Write state.json + report.json (with confidence section)
3. Conditional: traceability.md (spec route), issue creation (code_defect -> issues.jsonl)
4. Register artifact in state.json (type: test)
5. Display summary: route, iterations, convergence status, per-layer pass rates, bugs discovered
6. Route: converged -> quality-review; bugs -> quality-debug; >80% -> quality-test; <80% -> quality-debug; single pass all pass -> quality-test

</actions>

</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| test_pattern | data.name | {name, file, description} |
| mock_setup | data.target | {target, setup_code, file} |
| fixture | data.name | {name, schema, file} |
| convention | singleton | {describe_style, assertion_lib, import_pattern} |
| blocker | data.issue | {issue, severity, layer} |

Protocol: read before writing tests, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Phase not found in artifact registry | Abort: "Phase not found" |
| No test framework detected | Abort: E003, install framework |
| Agent spawn fails | Retry once, then mark scenario blocked |
| Convergence not met after max_iter | Report max_iter_reached, suggest debug |
| All scenarios in layer blocked | Stop layer, report env_issue |
| Resume: no session found | Start fresh |
</error_codes>

<success_criteria>
- [ ] Route auto-selected from project state (spec/gap/code)
- [ ] Review findings and debug root causes integrated as additional test scenarios
- [ ] Layers executed in order with fail-fast on critical
- [ ] Test writing + diagnosis parallelized via spawn_agents_on_csv
- [ ] Cross-layer context propagation via prev_context
- [ ] Iteration engine: inner test_defect fix, outer strategy adjust
- [ ] Test confidence scored per iteration (5-dimension model)
- [ ] Convergence check includes confidence >= 60% alongside pass_rate threshold
- [ ] Pressure pass completed on highest-pass-rate layer before completion
- [ ] state.json, report.json, reflection-log.md written
- [ ] TST artifact registered in state.json
- [ ] If spec: traceability.md written; if failures: issues auto-created in issues.jsonl
- [ ] If gap source: validation.json gaps updated (MISSING→COVERED)
- [ ] Next step routed (converged → quality-review, bugs → debug, >80% → quality-test, <80% → debug)
</success_criteria>
</output>
