
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Dispatch Debug Tasks

## Workflow

1. Read task-analysis.json -> extract pipeline_type and dependency_graph
2. Read specs/pipelines.md -> get task registry for selected pipeline
3. Topological sort tasks (respect blockedBy)
4. Validate all owners exist in role registry (SKILL.md)
5. For each task (in order):
   - create_goal with structured description (see template below)
   - update_goal with blockedBy + owner assignment
6. Update team-session.json with pipeline.tasks_total
7. Validate chain (no orphans, no cycles, all refs valid)

## Task Description Template

```
PURPOSE: <goal> | Success: <criteria>
TASK:
  - <step 1>
  - <step 2>
CONTEXT:
  - Session: <session-folder>
  - Base URL / Bug URL: <url>
  - Upstream artifacts: <list>
EXPECTED: <artifact path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: <true|false>
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/<role>/role.md
```

---

## Test Pipeline Tasks (mode: test-pipeline)

### TEST-001: Feature Testing

```
PURPOSE: Test all features from feature list and discover issues | Success: All features tested with pass/fail results
TASK:
  - Parse feature list from task description
  - For each feature: navigate to URL, explore page, generate test scenarios
  - Execute test scenarios using Chrome DevTools MCP (click, fill, hover, etc.)
  - Capture evidence: screenshots, console logs, network requests
  - Classify results: pass / fail / warning
  - Compile test report with discovered issues
CONTEXT:
  - Session: <session-folder>
  - Base URL: <base-url>
  - Features: <feature-list-from-task-analysis>
EXPECTED: <session>/artifacts/TEST-001-report.md + <session>/artifacts/TEST-001-issues.json
CONSTRAINTS: Use Chrome DevTools MCP only | Do not modify any code | Test all listed features
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/tester/role.md
```

### ANALYZE-001 (Test Mode): Analyze Discovered Issues

```
PURPOSE: Analyze issues discovered by tester to identify root causes | Success: RCA for each discovered issue
TASK:
  - Load test report and issues list from TEST-001
  - For each high/medium severity issue: analyze evidence, identify root cause
  - Correlate console errors, network failures, DOM anomalies to source code
  - Produce consolidated RCA report covering all issues
CONTEXT:
  - Session: <session-folder>
  - Upstream: <session>/artifacts/TEST-001-issues.json
  - Test evidence: <session>/evidence/
EXPECTED: <session>/artifacts/ANALYZE-001-rca.md with root causes for all issues
CONSTRAINTS: Read-only analysis | Skip low-severity warnings unless user requests
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/analyzer/role.md
```

**Conditional**: If TEST-001 reports zero issues → skip ANALYZE-001, FIX-001, VERIFY-001. Pipeline completes.

### FIX-001 (Test Mode): Fix All Issues

```
PURPOSE: Fix all identified issues from RCA | Success: All high/medium issues resolved
TASK:
  - Load consolidated RCA report from ANALYZE-001
  - For each root cause: locate code, implement fix
  - Run syntax/type check after all modifications
  - Document all changes
CONTEXT:
  - Session: <session-folder>
  - Upstream: <session>/artifacts/ANALYZE-001-rca.md
EXPECTED: Modified source files + <session>/artifacts/FIX-001-changes.md
CONSTRAINTS: Minimal changes per issue | Follow existing code style
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/fixer/role.md
```

### VERIFY-001 (Test Mode): Re-Test After Fix

```
PURPOSE: Re-run failed test scenarios to verify fixes | Success: Previously failed scenarios now pass
TASK:
  - Load original test report (failed scenarios only)
  - Re-execute failed scenarios using Chrome DevTools MCP
  - Capture evidence and compare with original
  - Report pass/fail per scenario
CONTEXT:
  - Session: <session-folder>
  - Original test report: <session>/artifacts/TEST-001-report.md
  - Fix changes: <session>/artifacts/FIX-001-changes.md
  - Failed features: <from TEST-001-issues.json>
EXPECTED: <session>/artifacts/VERIFY-001-report.md with pass/fail per previously-failed scenario
CONSTRAINTS: Only re-test failed scenarios | Use Chrome DevTools MCP only
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/verifier/role.md
```

---

## Debug Pipeline Tasks (mode: debug-pipeline)

### REPRODUCE-001: Evidence Collection

```
PURPOSE: Reproduce reported bug and collect debug evidence | Success: Bug reproduced with evidence artifacts
TASK:
  - Navigate to target URL
  - Execute reproduction steps using Chrome DevTools MCP
  - Capture evidence: screenshots, DOM snapshots, console logs, network requests
  - If performance dimension: run performance trace
  - Package all evidence into session evidence/ directory
CONTEXT:
  - Session: <session-folder>
  - Bug URL: <target-url>
  - Steps: <reproduction-steps>
  - Evidence plan: <from task-analysis.json>
EXPECTED: <session>/evidence/ directory with all captures + reproduction report
CONSTRAINTS: Use Chrome DevTools MCP only | Do not modify any code
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/reproducer/role.md
```

### ANALYZE-001 (Debug Mode): Root Cause Analysis

```
PURPOSE: Analyze evidence to identify root cause | Success: RCA report with specific file:line location
TASK:
  - Load evidence from REPRODUCE-001
  - Analyze console errors and stack traces
  - Analyze failed/abnormal network requests
  - Compare DOM snapshot against expected structure
  - Correlate findings to source code location
CONTEXT:
  - Session: <session-folder>
  - Upstream: <session>/evidence/
  - Bug description: <bug-description>
EXPECTED: <session>/artifacts/ANALYZE-001-rca.md with root cause, file:line, fix recommendation
CONSTRAINTS: Read-only analysis | Request more evidence if inconclusive
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/analyzer/role.md
```

### FIX-001 (Debug Mode): Code Fix

```
PURPOSE: Fix the identified bug | Success: Code changes that resolve the root cause
TASK:
  - Load RCA report from ANALYZE-001
  - Locate the problematic code
  - Implement fix following existing code patterns
  - Run syntax/type check on modified files
CONTEXT:
  - Session: <session-folder>
  - Upstream: <session>/artifacts/ANALYZE-001-rca.md
EXPECTED: Modified source files + <session>/artifacts/FIX-001-changes.md
CONSTRAINTS: Minimal changes | Follow existing code style | No breaking changes
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/fixer/role.md
```

### VERIFY-001 (Debug Mode): Fix Verification

```
PURPOSE: Verify bug is fixed | Success: Original bug no longer reproduces
TASK:
  - Navigate to same URL as REPRODUCE-001
  - Execute same reproduction steps
  - Capture evidence and compare with original
  - Confirm bug is resolved and no regressions
CONTEXT:
  - Session: <session-folder>
  - Original evidence: <session>/evidence/
  - Fix changes: <session>/artifacts/FIX-001-changes.md
EXPECTED: <session>/artifacts/VERIFY-001-report.md with pass/fail verdict
CONSTRAINTS: Use Chrome DevTools MCP only | Same steps as reproduction
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/verifier/role.md
```

---

## Dynamic Iteration Tasks

### REPRODUCE-002 (Debug Mode): Supplemental Evidence

Created when Analyzer requests more evidence:
```
PURPOSE: Collect additional evidence per Analyzer request | Success: Targeted evidence collected
TASK: <specific evidence requests from Analyzer>
CONTEXT: Session + Analyzer request
---
InnerLoop: false
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/reproducer/role.md
```

### FIX-002 (Either Mode): Re-Fix After Failed Verification

Created when Verifier reports fail:
```
PURPOSE: Re-fix based on verification failure feedback | Success: Issue resolved
TASK: Review VERIFY-001 failure details, apply corrective fix
CONTEXT: Session + VERIFY-001-report.md
---
InnerLoop: true
RoleSpec: ~  or <project>/.claude/skills/team-frontend-debug/roles/fixer/role.md
```

## Conditional Skip Rules

| Condition | Action |
|-----------|--------|
| test-pipeline + TEST-001 finds 0 issues | Skip ANALYZE/FIX/VERIFY → pipeline complete |
| test-pipeline + TEST-001 finds only warnings | request_user_input: fix warnings or complete |
| debug-pipeline + REPRODUCE-001 cannot reproduce | request_user_input: retry with more info or abort |

## InnerLoop Flag Rules

- true: tester (iterates over features), fixer (may need multiple fix passes)
- false: reproducer, analyzer, verifier (single-pass tasks)

## Dependency Validation

- No orphan tasks (all tasks have valid owner)
- No circular dependencies
- All blockedBy references exist
- Session reference in every task description
- RoleSpec reference in every task description
