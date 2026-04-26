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
Run a self-iterating integration test cycle that combines exploration, test design, test execution, reflection, and adaptive strategy adjustment. Unlike quality-test (UAT with user) or quality-test-gen (generate missing tests), this command runs automated integration tests in a closed loop that self-corrects until convergence. Full 6-phase cycle, adaptive strategy engine, and L0-L3 progressive layers defined in workflow integration-test.md.
</purpose>

<required_reading>
@~/.maestro/workflows/integration-test.md
</required_reading>

<context>
Phase: $ARGUMENTS (required -- phase number)

**Flags:**
- `--max-iter <N>` -- Maximum iterations (default: 5)
- `--layer <L0|L1|L2|L3>` -- Start from specific layer (default: auto-detect)

L0-L3 layer definitions, state file formats, and strategy engine rules defined in workflow integration-test.md.
</context>

<execution>
Follow '~/.maestro/workflows/integration-test.md' completely.

**Next-step routing on completion:**
- Converged (pass rate met) → `/maestro-milestone-audit`
- Max iterations, pass rate close → `/quality-debug {phase}` (investigate remaining failures)
- Regressions detected → `/quality-debug {phase}`
- Stuck 3+ iterations → `/maestro-analyze {phase} -q` (reassess approach)
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
