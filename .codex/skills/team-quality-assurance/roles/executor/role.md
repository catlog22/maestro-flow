---
role: executor
prefix: QARUN
inner_loop: true
additional_prefixes: [QARUN-gc]
message_types:
  success: tests_passed
  failure: tests_failed
  coverage: coverage_report
  error: error
---

# Test Executor

Run test suites, collect coverage data, and perform automatic fix cycles when tests fail. Implements the execution side of the Generator-Executor (GC) loop.

## Phase 2: Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Test strategy | meta.json -> test_strategy | Yes |
| Generated tests | meta.json -> generated_tests | Yes |
| Target layer | task description `layer: L1/L2/L3` | Yes |

1. Extract session path and target layer from task description
2. Load validation specs: Run `maestro spec load --category quality` for verification rules and acceptance criteria
3. Read .msg/meta.json for strategy and generated test file list
3. Detect test command by framework:

| Framework | Command |
|-----------|---------|
| vitest | `npx vitest run --coverage --reporter=json --outputFile=test-results.json` |
| jest | `npx jest --coverage --json --outputFile=test-results.json` |
| pytest | `python -m pytest --cov --cov-report=json -v` |
| mocha | `npx mocha --reporter json > test-results.json` |
| unknown | `npm test -- --coverage` |

4. Get test files from `generated_tests[targetLayer].files`

## Phase 3: Iterative Test-Fix Cycle

**Max iterations**: 5. **Pass threshold**: 95% or all tests pass.

Per iteration:
1. Run test command, capture output
2. Parse results: extract passed/failed counts, parse coverage from output or `coverage/coverage-summary.json`
3. If all pass (0 failures) -> exit loop (success)
4. If pass rate >= 95% and iteration >= 2 -> exit loop (good enough)
5. If iteration >= MAX -> exit loop (report current state)
6. Extract failure details (error lines, assertion failures)
7. Delegate fix via CLI tool with constraints:
   - ONLY modify test files, NEVER modify source code
   - Fix: incorrect assertions, missing imports, wrong mocks, setup issues
   - Do NOT: skip tests, add `@ts-ignore`, use `as any`
8. Increment iteration, repeat

## Phase 4: Result Analysis & Output

1. Build result data: layer, framework, iterations, pass_rate, coverage, tests_passed, tests_failed, all_passed
2. Save results to `<session>/results/run-<layer>.json`
3. Save last test output to `<session>/results/output-<layer>.txt`
4. Update `<session>/wisdom/.msg/meta.json` under `execution_results[layer]` and top-level `execution_results.pass_rate`, `execution_results.coverage`
5. Message type: `tests_passed` if all_passed, else `tests_failed`
