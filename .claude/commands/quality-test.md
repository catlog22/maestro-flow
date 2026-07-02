---
name: quality-test
description: Use when implementation needs user acceptance testing with interactive verification and gap closure
argument-hint: "[phase] [--smoke] [--auto-fix] [--frontend-verify]"
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
UAT-style conversational testing for a completed phase. Interactive scenario walk-through with severity inference. Issues trigger parallel debug agents and optional gap-fix loop (--auto-fix).
</purpose>

<required_reading>
@~/.maestro/workflows/test.md
</required_reading>

<context>
Phase or task: $ARGUMENTS (optional)

Flags, artifact context resolution, and output directory format defined in workflow test.md.

**Output boundary**: ALL file writes MUST target `.workflow/scratch/{YYYYMMDD}-test-P{N}-{slug}/`, `.workflow/state.json`, or `.workflow/issues.jsonl` only. NEVER modify source code or execution artifacts outside these paths. `--frontend-verify` additionally writes `e2e-results.json` to the same scratch directory.
</context>

<invariants>
1. **UAT is observational** — test execution observes behavior and records results. NEVER modify source code during testing. Source fixes belong to debug→plan→execute cycle.
2. **Severity is inferred, not asked** — severity MUST be inferred from user's natural language description of issues. NEVER explicitly ask the user to assign severity levels.
3. **One scenario at a time** — tests MUST be presented individually for user verification. NEVER batch-present multiple scenarios or assume outcomes.
4. **Evidence before verdict** — UAT confidence MUST be scored with the 4-dimension factor model from actual test results. NEVER emit a verdict without running the readiness gate.
5. **Existing UAT is resumable** — when uat.md exists for the target phase, offer resume. NEVER silently overwrite prior test progress.
6. **Frontend-verify is deterministic** — `--frontend-verify` mode uses browser assertions with concrete pass/fail per criterion. NEVER treat "no response" or timeout as pass.
7. **Auto-fix has bounds** — `--auto-fix` gap-fix loop MUST NOT exceed 2 iterations. Persistent failures escalate to debug, not infinite retry.
</invariants>

<execution>
**Mode select:** `--frontend-verify` → 走下方 **Frontend Verify Mode**（确定性浏览器 smoke，**不是**对话式 UAT）；否则 Follow '~/.maestro/workflows/test.md' completely.

### Frontend Verify Mode (`--frontend-verify`)

1. **Resolve targets**: 读 phase 的 `plan.json` / `.task/TASK-*.json`，提取所有 `[UI-observable]` convergence.criteria（plan 阶段产出）；缺失则枚举后端写端点（POST/PUT/PATCH/DELETE）作为待验证清单。
2. **Start app**: `next start`（或从 dashboard/package.json 解析的既有启动脚本）；启动失败 → E003。
3. **Drive browser**: 用 chrome-devtools MCP（`mcp__claude_dms3-chrome-devtools__*`：navigate / click / fill / take_snapshot / list_network_requests）逐条执行每个 `[UI-observable]` 流程，断言：UI 入口存在且可触发 → 对应写请求返回 2xx → DOM 出现预期结果。
4. **Write evidence**: 产出 `e2e-results.json`（结构见下），逐条记 pass/fail + 证据（网络状态码、快照引用）。**确定性断言，禁止"无人应答=全过"**。
5. **Verdict**: 任一 `[UI-observable]` fail 或写端点无 UI 入口 → STATUS=NEEDS_RETRY（ralph 经 post-frontend-verify 触发 Fix-Loop）；全过 → DONE。

```json
// e2e-results.json
{ "phase": "{phase}", "app_url": "http://localhost:3000",
  "checks": [ { "criterion": "[UI-observable] ...", "ui_entry": "<selector/route>",
    "request": "POST /api/notes", "status": 201, "dom_assert": "list shows new item",
    "passed": true } ],
  "summary": { "total": 0, "passed": 0, "failed": 0 }, "verdict": "pass|fail" }
```

Ralph-invoked 完成：`maestro ralph complete <idx> --status {STATUS} --evidence e2e-results.json`。

---

Follow '~/.maestro/workflows/test.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Setup → Test Design**
- REQUIRED: Target resolved (phase or scratch task). E001 if missing.
- REQUIRED: Smoke tests pass (if --smoke). E003 if fail.
- BLOCKED if missing: cannot design tests without resolved target.

**GATE 2: Test Design → Execution**
- REQUIRED: test-plan.json generated with categorized tests mapped to requirements.
- REQUIRED: uat.md created or resumed.
- BLOCKED if plan missing: do not start interactive testing without plan.

**GATE 3: Execution → Completion**
- REQUIRED: All tests presented and responses processed.
- REQUIRED: UAT confidence scored with 4-dimension factor model.
- REQUIRED: Pressure pass completed if > 80% pass rate.
- BLOCKED if incomplete: finish all scenarios before reporting.

**Command-specific extensions (not in workflow):**

**Knowledge context loading** (before test design):
- Wiki search: `maestro search "<phase/feature keywords>" --json` → prior test strategies, recipes, decisions
- Role knowledge: `maestro search --category test` → select relevant → `maestro load --type knowhow --id <id>`
- Specs + tools: `maestro load --type spec --category test` → test conventions + discoverable knowhow tools

**Test tool discovery** (knowhow tools as scenario source):
- Load registered test tools: `maestro load --type spec --category test --keyword <feature>`
- If tools found, extract their steps as additional test scenarios marked `source: "tool"`
- Each numbered step in a tool becomes a UAT test with its assertion as `expected` behavior

**Review findings integration** (from related review artifacts):
- Extract critical/high findings as additional test scenarios, marked `source: "review_finding"`
- When review verdict is "BLOCK" and review-finding tests fail, auto-enter gap-fix loop

**Debug root cause integration** (from related debug artifacts):
- Generate regression test scenarios from confirmed root causes, marked `source: "debug_root_cause"`

**Register artifact on completion:**

Confirm before writing:
```
AskUserQuestion("Register test artifact TST-{NNN} in state.json? (yes/no)")
→ yes: proceed with write
→ no: skip registration, continue to completion
```

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

</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY
CONCERNS: {description if applicable}
--- END STATUS ---
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| All tests pass | `/maestro-milestone-audit` |
| --auto-fix succeeded | `/maestro-execute {phase}` |
| --auto-fix gaps remain | `/quality-debug --from-uat {phase}` |
| Manual fix needed | `/quality-debug --from-uat {phase}` |
| Coverage below threshold | `/quality-auto-test {phase}` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or task target required (no active sessions) | Prompt user for phase number |
| E002 | error | Phase not verified yet (no verification.json) | Suggest `/maestro-execute` first (verification is built-in) |
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
- [ ] UAT confidence scored with 4-dimension factor model
- [ ] Readiness gate checked before final report
- [ ] Pressure pass completed if > 80% pass rate
- [ ] Confidence summary appended to uat.md
- [ ] index.json uat fields updated
- [ ] If issues: confirm with user before spawning parallel debug agents per gap cluster
- [ ] Gaps updated with root_cause, fix_direction, affected_files
- [ ] Gap-fix loop triggered if --auto-fix (max 2 iterations)
- [ ] Next step routed (phase-transition if pass, verify if auto-fix success, debug --from-uat if issues, test-gen if low coverage)
- [ ] `--frontend-verify`: 每条 [UI-observable] criterion 经真实浏览器断言，产出 e2e-results.json；任一 fail → NEEDS_RETRY（不放行）
</success_criteria>
