---
role: validator
prefix: TDVAL
inner_loop: false
message_types: [state_update]
---

# Tech Debt Validator

Cleanup result validator. Run test suite, type checks, lint checks, and quality analysis to verify debt cleanup introduced no regressions. Compare before/after debt scores, produce validation-report.json.

## Phase 2: Load Context

| Input | Source | Required |
|-------|--------|----------|
| Session path | task description (regex: `session:\s*(.+)`) | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |
| Fix log | <session>/fixes/fix-log.json | No |

1. Extract session path from task description
2. Read .msg/meta.json for: worktree.path, debt_inventory, fix_results, debt_score_before
3. Determine command prefix: `cd "<worktree-path>" && ` if worktree exists
4. Read fix-log.json for modified files list
5. Detect available validation tools in worktree:

| Signal | Tool | Method |
|--------|------|--------|
| package.json + npm | npm test | Test suite |
| pytest available | python -m pytest | Test suite |
| npx tsc available | npx tsc --noEmit | Type check |
| npx eslint available | npx eslint | Lint check |

## Phase 3: Run Validation Checks

Execute 4-layer validation (all commands in worktree):

**1. Test Suite**:
- Run `npm test` or `python -m pytest` in worktree
- PASS if no FAIL/error/failed keywords; FAIL with regression count otherwise
- Skip with "no-tests" if no test runner available

**2. Type Check**:
- Run `npx tsc --noEmit` in worktree
- Count `error TS` occurrences for error count

**3. Lint Check**:
- Run `npx eslint --no-error-on-unmatched-pattern <modified-files>` in worktree
- Count error occurrences

**4. Quality Analysis** (optional, when > 5 modified files):
- Use gemini CLI to compare code quality before/after
- Assess complexity, duplication, naming quality improvements

**Debt Score Calculation**:
- debt_score_after = debt items NOT in modified files (remaining unfixed items)
- improvement_percentage = ((before - after) / before) * 100

**Auto-fix attempt** (when total_regressions <= 3):
- Use CLI tool to fix regressions in worktree:
  ```
  Bash({
    command: `cd "${worktreePath}" && maestro cli -p "PURPOSE: Fix regressions found in validation
  TASK: ${regressionDetails}
  MODE: write
  CONTEXT: @${modifiedFiles.join(' @')}
  EXPECTED: Fixed regressions
  CONSTRAINTS: Fix only regressions | Preserve debt cleanup changes | No suppressions" --tool gemini --mode write`,
    run_in_background: false
  })
  ```
- Re-run validation checks after fix attempt

## Phase 4: Compare & Report

1. Calculate: total_regressions = test_regressions + type_errors + lint_errors; passed = (total_regressions === 0)
2. Write `<session>/validation/validation-report.json` with: validation_date, passed, regressions, checks (per-check status), debt_score_before, debt_score_after, improvement_percentage
3. Update .msg/meta.json with `validation_results` and `debt_score_after`
4. Select message type: `validation_complete` if passed, `regression_found` if not
