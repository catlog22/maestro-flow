---
name: quality-test
description: Conversational UAT with session persistence, auto-diagnosis, and gap-plan closure loop
argument-hint: "[phase] [--smoke] [--auto-fix]"
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
Run UAT-style conversational testing for a completed phase. Designs test scenarios from verification criteria, walks through each scenario interactively one at a time with plain text responses, and records pass/fail results with severity inference.

When issues are found, spawns parallel debug agents (one per gap cluster) to diagnose root causes, then optionally triggers the gap-fix loop (plan --gaps -> execute -> re-verify) to auto-close gaps.

Key mechanisms from GSD verify-work:
- **Session persistence**: uat.md survives context resets, resume from any point
- **Severity inference**: Natural language -> blocker/major/minor/cosmetic (never ask)
- **Cold-start smoke tests**: --smoke flag injects basic sanity tests before UAT
- **Parallel auto-diagnosis**: Spawn debug agents per gap cluster with pre-filled symptoms
- **Gap-plan closure loop**: --auto-fix triggers verify -> plan --gaps -> execute -> re-verify
</purpose>

<required_reading>
@~/.maestro/workflows/test.md
</required_reading>

<context>
Phase or task: $ARGUMENTS (optional)

Flags, artifact context resolution, and output directory format defined in workflow test.md.
</context>

<execution>
Follow '~/.maestro/workflows/test.md' completely.

**Command-specific extensions (not in workflow):**

**Review findings integration** (from related review artifacts):
- Extract critical/high findings as additional test scenarios, marked `source: "review_finding"`
- When review verdict is "BLOCK" and review-finding tests fail, auto-enter gap-fix loop

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
  path: "scratch/{YYYYMMDD}-test-P{N}-{slug}",
  status: issues == 0 ? "completed" : "failed",
  depends_on: exec_art.id,
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```

**Next-step routing on completion:**
- All tests pass → `/maestro-milestone-audit`
- Issues found, --auto-fix ran and succeeded → `/maestro-verify {phase}`
- Issues found, --auto-fix ran but gaps remain → `/quality-debug --from-uat {phase}`
- Issues found, manual fix needed → `/quality-debug --from-uat {phase}`
- Coverage below threshold → `/quality-auto-test {phase}`
- Need integration tests → `/quality-auto-test {phase}`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or task target required (no active sessions) | Prompt user for phase number |
| E002 | error | Phase not verified yet (no verification.json) | Suggest `/maestro-verify` first |
| E003 | error | Smoke test failed (app won't start) | Suggest `/quality-debug` |
| W001 | warning | One or more test scenarios failed | Auto-diagnose, suggest fix options |
| W002 | warning | Coverage below threshold | Suggest `/quality-auto-test` |
</error_codes>

<success_criteria>
- [ ] Target resolved (phase or scratch task)
- [ ] Active sessions checked, resume offered if applicable
- [ ] Smoke tests run if --smoke flag set
- [ ] test-plan.json generated with categorized tests mapped to requirements
- [ ] uat.md created/resumed with all tests
- [ ] Tests presented one at a time with expected behavior
- [ ] User responses processed as pass/issue/skip
- [ ] Severity inferred from natural language (never asked)
- [ ] Batched writes: on issue, every 5 passes, or completion
- [ ] test-results.json and coverage-report.json written
- [ ] index.json uat fields updated
- [ ] If issues: parallel debug agents spawned per gap cluster
- [ ] Gaps updated with root_cause, fix_direction, affected_files
- [ ] Gap-fix loop triggered if --auto-fix (max 2 iterations)
- [ ] Next step routed (phase-transition if pass, verify if auto-fix success, debug --from-uat if issues, test-gen if low coverage)
</success_criteria>
