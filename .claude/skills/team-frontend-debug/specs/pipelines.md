

# Pipeline Definitions

## 1. Pipeline Selection Criteria

| Keywords | Pipeline |
|----------|----------|
| 功能, feature, 清单, list, 测试, test, 完成, done, 验收 | `test-pipeline` |
| bug, 错误, 报错, crash, 问题, 不工作, 白屏, 异常 | `debug-pipeline` |
| performance, 性能, slow, 慢, latency, memory | `debug-pipeline` (perf dimension) |
| Ambiguous / unclear | AskUserQuestion |

## 2. Test Pipeline (Feature-List Driven)

**4 tasks, linear with conditional skip**

```
TEST-001 → [issues found?] → ANALYZE-001 → FIX-001 → VERIFY-001
              |
              └─ no issues → Pipeline Complete (skip ANALYZE/FIX/VERIFY)
```

| Task | Role | Description | Conditional |
|------|------|-------------|-------------|
| TEST-001 | tester | Test all features, discover issues | Always |
| ANALYZE-001 | analyzer | Analyze discovered issues, produce RCA | Skip if 0 issues |
| FIX-001 | fixer | Fix all identified root causes | Skip if 0 issues |
| VERIFY-001 | verifier | Re-test failed scenarios to verify fixes | Skip if 0 issues |

### Conditional Skip Logic

After TEST-001 completes, coordinator reads `TEST-001-issues.json`:
- `issues.length === 0` → All pass. Skip downstream tasks, report success.
- `issues.filter(i => i.severity !== "low").length === 0` → Only warnings. AskUserQuestion: fix or complete.
- `issues.filter(i => i.severity === "high" || i.severity === "medium").length > 0` → Proceed with ANALYZE → FIX → VERIFY.

### Re-Fix Iteration

If VERIFY-001 reports failures:
- Create FIX-002 (blockedBy: VERIFY-001) → VERIFY-002 (blockedBy: FIX-002)
- Max 3 fix iterations

## 3. Debug Pipeline (Bug-Report Driven)

**4 tasks, linear with iteration support**

```
REPRODUCE-001 → ANALYZE-001 → FIX-001 → VERIFY-001
                     ↑                       |
                     |    (if fail)           |
                     +--- REPRODUCE-002 ←----+
```

| Task | Role | Description |
|------|------|-------------|
| REPRODUCE-001 | reproducer | Reproduce bug, collect evidence |
| ANALYZE-001 | analyzer | Analyze evidence, produce RCA report |
| FIX-001 | fixer | Implement code fix based on RCA |
| VERIFY-001 | verifier | Verify fix with same reproduction steps |

### Iteration Rules

- **Analyzer → Reproducer**: If Analyzer confidence < 50%, creates REPRODUCE-002 → ANALYZE-002
- **Verifier → Fixer**: If Verifier verdict = fail, creates FIX-002 → VERIFY-002

### Maximum Iterations

- Max reproduction iterations: 2
- Max fix iterations: 3
- After max iterations: report to user for manual intervention

## 4. Task Metadata Registry

| Task ID | Role | Pipeline | Depends On | Priority |
|---------|------|----------|------------|----------|
| TEST-001 | tester | test | - | P0 |
| REPRODUCE-001 | reproducer | debug | - | P0 |
| ANALYZE-001 | analyzer | both | TEST-001 or REPRODUCE-001 | P0 |
| FIX-001 | fixer | both | ANALYZE-001 | P0 |
| VERIFY-001 | verifier | both | FIX-001 | P0 |
| REPRODUCE-002 | reproducer | debug | (dynamic) | P0 |
| ANALYZE-002 | analyzer | debug | REPRODUCE-002 | P0 |
| FIX-002 | fixer | both | VERIFY-001 | P0 |
| VERIFY-002 | verifier | both | FIX-002 | P0 |

## 5. Evidence Types Registry

| Dimension | Evidence | MCP Tool | Collector Roles |
|-----------|----------|----------|----------------|
| Visual | Screenshots | take_screenshot | tester, reproducer, verifier |
| DOM | A11y snapshots | take_snapshot | tester, reproducer, verifier |
| Console | Error/warn messages | list_console_messages | tester, reproducer, verifier |
| Network | API requests/responses | list/get_network_request | tester, reproducer, verifier |
| Performance | Trace recording | performance_start/stop_trace | reproducer, verifier |
| Interaction | User actions | click/fill/hover | tester, reproducer, verifier |
