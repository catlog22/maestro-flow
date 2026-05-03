---
name: quality-auto-test
description: Unified automated testing via CSV layer pipeline — generates, executes, and iterates tests from PRD specs, coverage gaps, or code exploration
argument-hint: "<phase> [-y] [-c N] [--max-iter <N>] [--layer <L0-L3>] [--strategy <name>] [--dry-run] [--re-run]"
allowed-tools:
  - spawn_agents_on_csv
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Run unified automated testing via CSV layer pipeline. Reads project state to auto-select the optimal scenario source — PRD specs (when spec package exists), coverage gaps (when Nyquist audit found gaps), or code exploration (default). All sources converge into a CSV pipeline: discover infrastructure → plan → build scenarios.csv → write tests per layer (spawn_agents_on_csv parallel) → execute → diagnose failures (spawn_agents_on_csv parallel) → iterate → report.

Key mechanisms:
- **Intelligent routing**: Reads `.tests/`, `.workflow/.spec/`, `verification.json` to auto-select source — no mode flag needed
- **CSV parallel test writing**: Per-layer `spawn_agents_on_csv` — each agent writes one test file independently
- **CSV parallel failure diagnosis**: Failed scenarios dispatched via `spawn_agents_on_csv` for classification + fix
- **Unified iteration engine**: Nested inner loop (fix test_defects via diagnosis CSV, max 3/layer) + outer loop (adaptive strategy, max N iterations)
- **Layers as waves**: L0→L1→L2→L3 sequential (fail-fast on critical), scenarios within layer parallel
- **Discovery board**: `discoveries.ndjson` shared across all agents/iterations (append-only)
- **Degenerate modes**: `--max-iter 1` = single-pass generation; default = full iterative cycle
- **Session persistence**: CSV state + state.json survive context resets, resume from any point
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

| Priority | Condition | Route | Equivalent to |
|----------|-----------|-------|---------------|
| 1 | Active session exists (state.json status=running) | Resume | — |
| 2 | --re-run flag + previous failures | Re-run | — |
| 3 | Spec package exists (REQ-*.md) | spec | quality-business-test |
| 4 | Nyquist gaps exist (verification.json) | gap | quality-test-gen |
| 5 | Default | code | quality-integration-test |

Flags, artifact context resolution, and output formats defined in workflow auto-test.md.
</context>

<execution>
Follow '~/.maestro/workflows/auto-test.md' completely.

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
- Converged (>=95%) → `/maestro-verify {phase}`
- All requirements verified (spec source) → `/maestro-milestone-audit`
- Bugs discovered → `/quality-debug --from-auto-test {phase}`
- Max iter, >80% → `/quality-test {phase}` for manual UAT
- Max iter, <80% → `/quality-debug {phase}`
- Coverage still low → `/quality-auto-test {phase} --layer {missing}`
- Re-run all pass → `/maestro-verify {phase}`
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
- [ ] index.json updated with auto_test section
- [ ] If spec source: traceability matrix built, traceability.md written
- [ ] If failures: issues auto-created in issues.jsonl
- [ ] If gap source: validation.json gaps updated (MISSING→COVERED)
- [ ] Next step routed based on convergence status
</success_criteria>
