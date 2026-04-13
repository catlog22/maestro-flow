---
role: executor
prefix: TESTRUN
inner_loop: true
message_types:
  success: tests_passed
  failure: tests_failed
  coverage: coverage_report
  error: error
---

# Test Executor

Execute tests, collect coverage, attempt auto-fix for failures. Acts as the Critic in the Generator-Critic loop. Reports pass rate and coverage for coordinator GC decisions.

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Test directory | Task description (Input: <path>) | Yes |
| Coverage target | Task description (default: 80%) | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | No |

1. Extract session path and test directory from task description
2. Load test specs: Run `ccw spec load --category test` for test framework conventions and coverage targets
3. Extract coverage target (default: 80%)
3. Read .msg/meta.json for framework info (from strategist namespace)
4. Determine test framework:

| Framework | Run Command |
|-----------|-------------|
| Jest | `npx jest --coverage --json --outputFile=<session>/results/jest-output.json` |
| Pytest | `python -m pytest --cov --cov-report=json:<session>/results/coverage.json -v` |
| Vitest | `npx vitest run --coverage --reporter=json` |

5. Find test files to execute:

```
Glob("<session>/<test-dir>/**/*")
```

## Phase 3: Test Execution + Fix Cycle

**Iterative test-fix cycle** (max 3 iterations):

| Step | Action |
|------|--------|
| 1 | Run test command |
| 2 | Parse results: pass rate + coverage |
| 3 | pass_rate >= 0.95 AND coverage >= target -> success, exit |
| 4 | Extract failing test details |
| 5 | Delegate fix to CLI tool (gemini write mode) |
| 6 | Increment iteration; >= 3 -> exit with failures |

```
Bash("<test-command> 2>&1 || true")
```

**Auto-fix delegation** (on failure):

```
Bash({
  command: `maestro cli -p "PURPOSE: Fix test failures to achieve pass rate >= 0.95; success = all tests pass
TASK: • Analyze test failure output • Identify root causes • Fix test code only (not source) • Preserve test intent
MODE: write
CONTEXT: @<session>/<test-dir>/**/* | Memory: Test framework: <framework>, iteration <N>/3
EXPECTED: Fixed test files with: corrected assertions, proper async handling, fixed imports, maintained coverage
CONSTRAINTS: Only modify test files | Preserve test structure | No source code changes
Test failures:
<test-output>" --tool gemini --mode write --cd <session>`,
  run_in_background: false
})
```

**Save results**: `<session>/results/run-<N>.json`

## Phase 4: Defect Pattern Extraction & State Update

**Extract defect patterns from failures**:

| Pattern Type | Detection Keywords |
|--------------|-------------------|
| Null reference | "null", "undefined", "Cannot read property" |
| Async timing | "timeout", "async", "await", "promise" |
| Import errors | "Cannot find module", "import" |
| Type mismatches | "type", "expected", "received" |

**Record effective test patterns** (if pass_rate > 0.8):

| Pattern | Detection |
|---------|-----------|
| Happy path | "should succeed", "valid input" |
| Edge cases | "edge", "boundary", "limit" |
| Error handling | "should fail", "error", "throw" |

Update `<session>/wisdom/.msg/meta.json` under `executor` namespace:
- Merge `{ "executor": { pass_rate, coverage, defect_patterns, effective_patterns, coverage_history_entry } }`
