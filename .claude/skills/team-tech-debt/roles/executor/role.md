---
role: executor
prefix: TDFIX
inner_loop: true
message_types: [state_update]
---

# Tech Debt Executor

Debt cleanup executor. Apply remediation plan actions in worktree: refactor code, update dependencies, add tests, add documentation. Batch-delegate to CLI tools, self-validate after each batch.

## Phase 2: Load Remediation Plan

| Input | Source | Required |
|-------|--------|----------|
| Session path | task description (regex: `session:\s*(.+)`) | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |
| Remediation plan | <session>/plan/remediation-plan.json | Yes |
| Worktree info | meta.json:worktree.path, worktree.branch | Yes |
| Context accumulator | From prior TDFIX tasks (inner loop) | Yes (inner loop) |

1. Extract session path from task description
2. Read .msg/meta.json for worktree path and branch
3. Read remediation-plan.json, extract all actions from plan phases
4. Group actions by type: refactor, restructure, add-tests, update-deps, add-docs
5. Split large groups (> 10 items) into sub-batches of 10
6. For inner loop (fix-verify cycle): load context_accumulator from prior TDFIX tasks, parse review/validation feedback for specific issues

**Batch order**: refactor -> update-deps -> add-tests -> add-docs -> restructure

## Phase 3: Execute Fixes

For each batch, use CLI tool for implementation:

**Worktree constraint**: ALL file operations and commands must execute within worktree path. Use `cd "<worktree-path>" && ...` prefix for all Bash commands.

**Per-batch delegation**:

```bash
maestro cli -p "PURPOSE: Apply tech debt fixes in batch; success = all items fixed without breaking changes
TASK: <batch-type-specific-tasks>
MODE: write
CONTEXT: @<worktree-path>/**/* | Memory: Remediation plan context
EXPECTED: Code changes that fix debt items, maintain backward compatibility, pass existing tests
CONSTRAINTS: Minimal changes only | No new features | No suppressions | Read files before modifying
Batch type: <refactor|update-deps|add-tests|add-docs|restructure>
Items: <list-of-items-with-file-paths-and-descriptions>" --tool gemini --mode write --cd "<worktree-path>"
```

Wait for CLI completion before proceeding to next batch.

**Fix Results Tracking**:

| Field | Description |
|-------|-------------|
| items_fixed | Count of successfully fixed items |
| items_failed | Count of failed items |
| items_remaining | Remaining items count |
| batches_completed | Completed batch count |
| files_modified | Array of modified file paths |
| errors | Array of error messages |

After each batch, verify file modifications via `git diff --name-only` in worktree.

## Phase 4: Self-Validation

All commands in worktree:

| Check | Command | Pass Criteria |
|-------|---------|---------------|
| Syntax | `tsc --noEmit` or `python -m py_compile` | No new errors |
| Lint | `eslint --no-error-on-unmatched-pattern` | No new errors |

Write `<session>/fixes/fix-log.json` with fix results. Update .msg/meta.json with `fix_results`.

Append to context_accumulator for next TDFIX task (inner loop): files modified, fixes applied, validation results, discovered caveats.
