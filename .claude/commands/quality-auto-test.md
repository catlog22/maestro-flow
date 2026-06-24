---
name: quality-auto-test
description: Use when test coverage needs automated expansion or existing tests need iterative convergence
argument-hint: "<phase> [-y] [-c N] [--max-iter N] [--layer L0|L1|L2|L3] [--dry-run] [--re-run]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Unified automated testing via CSV layer pipeline. Auto-selects scenario source from project state (specs / coverage gaps / code exploration), then: discover → plan → build CSV → write tests (parallel) → execute → diagnose failures (parallel) → iterate → report.

Layers L0→L3 sequential (fail-fast), scenarios within layer parallel. `--max-iter 1` = single-pass; default = full iterative cycle.
</purpose>

<required_reading>
@~/.maestro/workflows/auto-test.md
</required_reading>

<context>
Phase or task: $ARGUMENTS (required — phase number)

**Flags:**
- `--max-iter N` — Maximum outer iterations (default: 5). Set to 1 for single-pass generation only.
- `--layer L` — Start from or restrict to specific layer (L0|L1|L2|L3)
- `--dry-run` — Generate test plan only, do not execute
- `--re-run` — Re-run only previously failed/blocked scenarios

**Intelligent routing** (auto-detected from project state):

| Priority | Condition | Route | Reference skill |
|----------|-----------|-------|-----------------|
| 1 | Active session exists (state.json status=running) | Resume | — |
| 2 | --re-run flag + previous failures | Re-run | — |
| 3 | Spec package exists (REQ-*.md) | spec | quality-business-test (separate skill) |
| 4 | Nyquist gaps exist (verification.json) | gap | quality-test-gen (separate skill) |
| 5 | Default | code | quality-integration-test (separate skill) |

Flags, artifact context resolution, and output formats defined in workflow auto-test.md.

### Pre-load context (before test generation)

1. **Test specs + tools**: Run `maestro load --type spec --category test` to load test conventions (framework, patterns, naming). Apply to all generated tests.
2. **Coding specs**: Run `maestro load --type spec --category coding` to understand coding patterns for accurate test targeting.
3. **Role Knowledge**:
   - Browse: `maestro search --category test`
   - Load task-relevant entries: `maestro load --type knowhow --id <id1> [id2...]`
4. All are optional — proceed without if unavailable.
</context>

<execution>
Follow '~/.maestro/workflows/auto-test.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Setup → Plan** (Route Selection → CSV Generation)
- REQUIRED: Phase resolved from artifact registry. E001/E002 if missing.
- REQUIRED: Route auto-selected (spec/gap/code) from project state.
- REQUIRED: Test infrastructure discovered (framework, patterns, conventions).
- BLOCKED if missing: cannot generate test plan without route and framework.

**GATE 2: Plan → Write** (CSV → Test Generation)
- REQUIRED: test-plan.json generated with layer distribution (L0→L3).
- REQUIRED: User confirmed plan (unless `--dry-run` stops here).
- BLOCKED if plan missing or rejected: do not write tests.

**GATE 3: Write → Execute** (Test Generation → Execution)
- REQUIRED: All planned test files written following existing patterns.
- REQUIRED: Tests follow RED-GREEN methodology.
- BLOCKED if tests incomplete: finish writing before execution.

**GATE 4: Execute → Report** (Iteration → Completion)
- REQUIRED: Progressive execution completed (L0→L3, fail-fast on critical).
- REQUIRED: Iteration engine ran (inner: test_defect fix, outer: strategy adjust).
- REQUIRED: Confidence scored with 5-dimension factor model (>= 60%).
- REQUIRED: Pressure pass completed on highest-pass-rate layer.
- BLOCKED if iteration incomplete: continue iterating before reporting.

**Command-specific extensions (not in workflow):**

**Review findings integration** (from related review artifacts):
- Extract critical/high findings as additional test scenarios, marked `source: "review_finding"`
- When review verdict is "BLOCK" and review-finding tests fail, suggest quality-debug

**Debug root cause integration** (from related debug artifacts):
- Generate regression test scenarios from confirmed root causes, marked `source: "debug_root_cause"`

**Register artifact on completion:**
```
Append to state.json.artifacts[]:
{
  id: nextArtifactId(artifacts, "test"),  // TST-001
  type: "test",
  milestone: current_milestone,
  phase: target_phase,
  scope: "phase",
  path: "scratch/{YYYYMMDD}-auto-test-P{N}-{slug}",
  status: issues == 0 ? "completed" : "failed",
  depends_on: exec_art.id,
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```

**Next-step routing on completion:**
- Converged (>=95%) → `/quality-review {phase}`
- All requirements verified (spec source) → `/maestro-milestone-audit`
- Bugs discovered → `/quality-debug --from-uat {phase}`
- Max iter, >80% → `/quality-test {phase}` for manual UAT
- Max iter, <80% → `/quality-debug {phase}`
- Coverage still low → `/quality-auto-test {phase} --layer {missing}`
- Re-run all pass → `/quality-review {phase}`
- Single pass, all pass → `/quality-test {phase}`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required (no active sessions) | Prompt user for phase number |
| E002 | error | Phase not found in artifact registry | Check state.json artifacts |
| E003 | error | No test framework detected | Install test framework or configure test runner |
| W001 | warning | One or more test scenarios failed | Auto-iterate or suggest fix options |
| W002 | warning | Max iterations reached without convergence | Review reflection-log.md, suggest debug |
| W003 | warning | Degraded spec mode (no full spec package) | Consider running maestro-roadmap --mode full |
</error_codes>

<success_criteria>
- [ ] Phase resolved from artifact registry
- [ ] Route auto-selected from project state (spec/gap/code)
- [ ] Active sessions checked, resume offered if applicable
- [ ] Scenarios extracted and normalized to unified format
- [ ] Test infrastructure discovered (framework, patterns, conventions)
- [ ] test-plan.json generated with layer distribution
- [ ] User confirmed plan (or --dry-run stopped here)
- [ ] Tests written following RED-GREEN methodology and existing patterns
- [ ] Tests executed progressively (L0→L3) with fail-fast on critical
- [ ] Iteration engine ran (inner: test_defect fix, outer: strategy adjust)
- [ ] state.json, report.json, reflection-log.md written
- [ ] Test confidence scored per iteration (Step 7.5) with 5-dimension factor model
- [ ] Convergence check includes confidence >= 60% alongside pass_rate threshold
- [ ] Pressure pass completed on highest-pass-rate layer before completion
- [ ] report.json includes confidence section
- [ ] index.json updated with auto_test section
- [ ] If spec source: traceability matrix built, traceability.md written
- [ ] If failures: issues auto-created in issues.jsonl
- [ ] If gap source: validation.json gaps updated (MISSING→COVERED)
- [ ] Next step routed based on convergence status
</success_criteria>
