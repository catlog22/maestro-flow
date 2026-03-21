---
name: quality-integration-test
description: Self-iterating integration test cycle with reflection-driven strategy and L0-L3 progressive layers
argument-hint: "<phase> [--max-iter <N>] [--layer <L0|L1|L2|L3>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Run a self-iterating integration test cycle that combines exploration, test design, test execution, reflection, and adaptive strategy adjustment. Unlike quality-test (UAT with user) or quality-test-gen (generate missing tests), this command runs automated integration tests in a closed loop that self-corrects until convergence.

Key mechanisms from DMS3 integration-test-cycle:
- **6-phase cycle**: Explore -> Design -> Develop -> Test -> Reflect -> Adjust
- **Reflection-driven**: After each iteration, reflect on what worked/failed and adjust strategy
- **Adaptive strategy engine**: Conservative (iter 1-2) -> Aggressive (>80% similar) -> Surgical (regression) -> Reflective (stuck 3+)
- **L0-L3 progressive layers**: Static Analysis -> Unit -> Integration -> E2E
- **Self-iterating**: Loop continues until pass rate threshold met or max iterations reached
- **State persistence**: state.json + reflection-log.md survive context resets
</purpose>

<required_reading>
@~/.maestro/workflows/integration-test.md
</required_reading>

<context>
Phase: $ARGUMENTS (required -- phase number)

**Flags:**
- `--max-iter <N>` -- Maximum iterations (default: 5)
- `--layer <L0|L1|L2|L3>` -- Start from specific layer (default: auto-detect)

**L0-L3 Progressive Test Layers:**

| Layer | Name | What | Tools |
|-------|------|------|-------|
| L0 | Static Analysis | Type checking, lint, dead code | `tsc --noEmit`, `eslint`, `ruff` |
| L1 | Unit Tests | Function-level isolation tests | jest, vitest, pytest |
| L2 | Integration Tests | Cross-module, API, DB tests | supertest, pytest + fixtures |
| L3 | E2E Tests | Full user flow tests | playwright, cypress, selenium |

**State files (in `.tests/integration/`):**
- `state.json` -- iteration state, pass rates, strategy
- `reflection-log.md` -- per-iteration reflections
- `test-results-iter-{N}.json` -- results per iteration
</context>

<execution>
Follow '~/.maestro/workflows/integration-test.md' completely.

**Next-step routing on completion:**
- Converged (pass rate met) → Skill({ skill: "maestro-phase-transition", args: "{phase}" })
- Max iterations, pass rate close → Skill({ skill: "quality-debug", args: "{phase}" }) (investigate remaining failures)
- Regressions detected → Skill({ skill: "quality-debug", args: "{phase}" })
- Stuck 3+ iterations → Skill({ skill: "maestro-analyze", args: "{phase} -q" }) (reassess approach)
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase number required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | No test framework detected | Install test framework or verify project setup |
| W001 | warning | Max iterations reached without convergence | Review reflection log, consider manual intervention |
| W002 | warning | Regression detected, switching to Surgical strategy | Review reflection log, consider manual intervention |
| W003 | warning | Stuck 3+ iterations, switching to Reflective strategy | Review reflection log, consider manual intervention |
</error_codes>

<success_criteria>
- [ ] Integration test session initialized with state.json
- [ ] Codebase explored for integration points
- [ ] Test plan designed with L0-L3 layers
- [ ] Tests written following existing patterns
- [ ] Tests executed with results recorded per iteration
- [ ] Reflection logged with pattern analysis
- [ ] Strategy adapted based on results (conservative/aggressive/surgical/reflective)
- [ ] Iterations continue until convergence or max_iter
- [ ] summary.json written with final results
- [ ] reflection-log.md contains full iteration history
- [ ] index.json updated with integration test status
- [ ] Next step routed (phase-transition if converged, debug if failures, analyze -q if stuck)
</success_criteria>
