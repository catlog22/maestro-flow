---
name: quality-test
description: Use when implementation needs user acceptance testing with interactive verification and gap closure
argument-hint: "<phase> [-y] [--smoke] [--auto-fix] [--session ID]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Conversational UAT: present expected behavior one test at a time, user confirms or describes issues. Severity inferred from natural language (never asked). Session persists in `uat.md` across context resets. Failed tests trigger CSV-parallel diagnosis via `spawn_agents_on_csv` and optional gap-fix closure (max 2 iterations).

**Philosophy**: Show expected, ask if reality matches.
</purpose>

<context>
$ARGUMENTS -- phase number and optional flags.

**Flags**:
- `<phase>`: Phase number or scratch task ID
- `--smoke`: Run cold-start smoke tests before UAT
- `--auto-fix`: Auto-trigger gap-fix loop (plan --gaps -> execute -> re-verify)
- `--session ID`: Resume specific UAT session
- `-y`: Implies --auto-fix; UAT itself stays interactive

**Output**:
- `{target_dir}/uat.md` -- session file (persistent)
- `{target_dir}/.tests/test-plan.json` -- scenario definitions
- `{target_dir}/.tests/test-results.json` -- pass/fail results
- `{target_dir}/.tests/coverage-report.json` -- requirement coverage
- `.tests/.csv-session/diagnosis.csv` + `diagnosis-results.csv`
</context>

<csv_schema>

### diagnosis.csv (Gap Diagnosis Phase)

```csv
id,test_id,cluster,test_name,expected,reported,severity,target_files,issue_id,source_context,root_cause,fix_direction,affected_files,evidence,error
"DX-001","T-003","auth","Login validation","Valid login returns dashboard","Clicking login does nothing","major","src/auth/login.ts;src/routes/auth.ts","ISS-20260503-001","login.ts calls authService.verify","","","","",""
```

Input: id, test_id, cluster, test_name, expected, reported, severity, target_files, issue_id, source_context.
Output: root_cause, fix_direction, affected_files, evidence, error.
</csv_schema>

<invariants>
1. **One test at a time** -- never batch-present tests
2. **Never ask severity** -- always infer from natural language
3. **Session persistence** -- uat.md survives context resets, resume from any point
4. **Batched writes** -- on issue, every 5 passes, or completion
5. **Gap-fix loop max 2 iterations** -- prevent infinite loops
6. **CSV parallel diagnosis** -- spawn_agents_on_csv for gap clusters, not sequential
7. **Auto-create issues** -- every failed test -> issues.jsonl entry
8. **Issue lifecycle sync** -- registered -> planning -> executing -> completed/failed
</invariants>

<state_machine>

<states>
S_RESOLVE    -- 解析目标（phase/scratch）、检查活跃 session  PERSIST: --
S_SMOKE      -- 冒烟测试（--smoke, 可跳过）                  PERSIST: uat.md smoke section
S_DESIGN     -- 设计测试场景（verification context + quality artifacts） PERSIST: test-plan.json
S_CREATE_UAT -- 创建 uat.md                                   PERSIST: uat.md
S_PRESENT    -- 逐个呈现测试、收集用户反馈                    PERSIST: uat.md (batched)
S_COMPLETE   -- 完成 session、写结果文件                       PERSIST: test-results.json + coverage-report.json
S_DIAGNOSE   -- CSV 并行诊断 gap clusters                     PERSIST: diagnosis-results.csv
S_GAP_CLOSE  -- Gap 修复循环（--auto-fix, max 2 iter）        PERSIST: uat.md gaps updated
S_REPORT     -- 最终报告、路由下一步                          PERSIST: --
</states>

<transitions>

S_RESOLVE:
  -> S_PRESENT     WHEN: --session ID (resume from uat.md)
  -> S_SMOKE       WHEN: --smoke flag set
  -> S_DESIGN      WHEN: normal flow      DO: resolve target, validate verification.json exists

S_SMOKE:
  -> S_DESIGN      WHEN: all pass
  -> ERROR(E003)   WHEN: any fail (suggest quality-debug)

  **Smoke checks**:
  | Test | Method |
  |------|--------|
  | App starts | Run start command, check exit code |
  | Routes respond | curl/fetch main routes, check non-error |
  | Build clean | Build command succeeds |
  | Dependencies | Install check, no missing deps |

S_DESIGN:
  -> S_CREATE_UAT  DO: A_DESIGN_SCENARIOS

S_CREATE_UAT:
  -> S_PRESENT     DO: write uat.md (archive previous to .history/ if exists)

  **uat.md template**:
  ```markdown
  ---
  status: testing
  target: {phase slug or scratch ID}
  source: [list of summary files]
  started: {ISO}
  updated: {ISO}
  ---
  ## Current Test
  number: 1
  name: {first test}
  expected: |
    {observable behavior}
  awaiting: user response

  ## Tests
  ### 1. {Test Name}
  expected: {behavior}
  result: [pending]

  ## Summary
  total: {N}  passed: 0  issues: 0  pending: {N}  skipped: 0

  ## Gaps
  [none yet]
  ```

S_PRESENT:
  -> S_PRESENT     WHEN: more tests       DO: A_PRESENT_AND_PROCESS
  -> S_COMPLETE     WHEN: all tests done

S_COMPLETE:
  -> S_DIAGNOSE    WHEN: issues found      DO: write output files, register artifact in state.json
  -> S_REPORT      WHEN: no issues

  **test-results.json**: `{ target, completed_at, results: [...], summary: { total, passed, issues, skipped } }`
  **coverage-report.json**: `{ target, requirements_covered: [...], requirements_uncovered: [...], coverage_percentage }`

S_DIAGNOSE:
  -> S_GAP_CLOSE   DO: A_DIAGNOSE_GAPS

S_GAP_CLOSE:
  -> S_REPORT      WHEN: --auto-fix not set    DO: present options (auto-fix/debug/plan/manual)
  -> S_REPORT      WHEN: --auto-fix, loop done  DO: A_GAP_FIX_LOOP (plan --gaps -> execute -> verify, max 2)

S_REPORT:
  -> END           DO: A_REPORT

</transitions>

<actions>

### A_DESIGN_SCENARIOS

1. Load verification context: verification.json, validation.json, index.json, plan.json, summaries
2. Load quality artifacts: review findings (type=review) -> extra tests (source: review_finding); debug root causes (type=debug) -> regression tests (source: debug_root_cause)
3. Load test tools: `maestro spec load --category test --keyword <feature>` -> additional scenarios (source: tool)
4. Design scenarios from user-observable outcomes: id (T-NNN), name, category (e2e/integration/unit), expected, requirement_ref, source
5. Write test-plan.json

### A_PRESENT_AND_PROCESS

Present one test: `TEST {n}/{total}: {name}` + expected behavior + prompt.

Response processing:

| Response | Action |
|----------|--------|
| "pass"/"yes"/"ok"/"next"/empty | Mark pass |
| "skip"/"can't test"/"n/a" | Mark skipped |
| Anything else | Log issue, infer severity |

**Severity inference** (never ask):
- crashes/error/exception/fails/can't use -> blocker
- doesn't work/nothing happens/wrong/broken -> major
- works but.../slow/weird/minor/inconsistent -> minor
- color/spacing/alignment/looks off/typo -> cosmetic
- Default: major

On issue: auto-create in `.workflow/issues/issues.jsonl`:
```json
{ "id": "ISS-{YYYYMMDD}-{NNN}", "title": "UAT: {test.name} - {response truncated 100}",
  "status": "registered", "priority": "{from severity}", "severity": "{inferred}",
  "source": "uat", "phase_ref": "{phase}", "gap_ref": "{test.id}",
  "description": "Expected: {expected}. Reported: {verbatim}", "tags": ["uat"] }
```

### A_DIAGNOSE_GAPS

1. Cluster gaps by component/module/feature
2. Build diagnosis.csv with `status="pending"` per row, target_files, source_context
3. Filter `status=="pending"` -> write diagnosis-wave.csv -> `spawn_agents_on_csv` for parallel diagnosis with the contract below
4. **Diagnosis agent**: Find root cause (not symptom), suggest fix direction, list affected files. Do NOT modify files. Reference issue_id for traceability.
5. Merge results: map `result_status` → master `status`; copy `root_cause`, `fix_direction`, `affected_files`; update uat.md gaps

**output_schema**:

```json
{
  "type": "object",
  "properties": {
    "id":              { "type": "string" },
    "result_status":   { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "root_cause":      { "type": "string", "maxLength": 500 },
    "fix_direction":   { "type": "string" },
    "affected_files":  { "type": "string", "description": "Semicolon-separated file:line refs" },
    "findings":        { "type": "string", "maxLength": 500 },
    "error":           { "type": "string" }
  },
  "required": ["id", "result_status", "root_cause", "findings"]
}
```

**Diagnosis Worker Instruction** (embed in spawn instruction):
```
You are a UAT gap diagnostician. ONE gap row is assigned to you.

INPUT: id, target_files, source_context, issue_id, gap description

REQUIRED STEPS:
  1. Read target_files + source_context (read-only)
  2. Trace symptom backward through call chain to root cause
  3. Identify fix direction (high-level — orchestrator hands off to maestro-plan)
  4. List affected files with file:line refs
  5. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory):
  - Success → result_status=completed with root_cause + fix_direction populated
  - Failure → result_status=failed (cannot read files, parse error)
  - Blocked → result_status=blocked (insufficient context to diagnose; orchestrator may re-cluster)
  - Timeout → near max_runtime_seconds → result_status=blocked with error="timeout"
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

OUTPUT (must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed" | "blocked",
    "root_cause": "<concrete root cause with file:line, max 500 chars>",
    "fix_direction": "<high-level fix strategy, NOT code>",
    "affected_files": "<semicolon-separated file:line refs>",
    "findings": "<one-sentence summary>",
    "error": "<message if not completed>"
  }

CONSTRAINTS:
  - Read-only. Do NOT modify source files.
  - Do NOT write to uat.md, diagnosis.csv, issues.jsonl (orchestrator owns those).
  - Do NOT call spawn_agents_on_csv (no recursion).
```

### A_GAP_FIX_LOOP

Max 2 iterations:
1. `maestro-plan "{phase} --gaps"` (registered -> planning)
2. `maestro-execute "{phase}"` (planning -> executing, resolved -> completed, unresolved -> failed)

### A_REPORT

1. UAT confidence scoring (4 dims: scenario_coverage, diagnostic_depth, observation_quality, closure_completeness). Readiness gate: block if scenario_coverage < 40% or blocker without diagnosis.
2. Display summary: smoke results, pass/fail/skip counts, diagnosis stats, auto-fix results
3. Register artifact in state.json (type: test)
4. Route: all passed -> milestone-audit; auto-fix succeeded -> maestro-execute; gaps remain -> quality-debug; low coverage -> quality-auto-test

</actions>

</state_machine>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Phase/task target required, no active sessions | Prompt for phase number |
| No verification.json (phase not verified) | Suggest maestro-execute |
| Smoke test failed (app won't start) | Suggest quality-debug |
| Coverage below threshold | Suggest quality-auto-test |
</error_codes>

<success_criteria>
- [ ] Tests presented one at a time, severity inferred (never asked)
- [ ] Issues auto-created in issues.jsonl for all failures
- [ ] uat.md persists across context resets
- [ ] Quality artifacts loaded (review -> extra tests, debug -> regression tests)
- [ ] CSV parallel diagnosis via spawn_agents_on_csv
- [ ] Gap-fix loop max 2 iterations (if --auto-fix)
- [ ] Issue lifecycle synced through gap-fix loop
- [ ] UAT confidence scored (4-dimension model)
- [ ] test-results.json + coverage-report.json written
</success_criteria>
</output>
