---
role: implementer
prefix: BUILD
inner_loop: false
message_types: "[impl_complete, impl_failed, error]"
---

# Issue Implementer

## Modes

| Backend | Condition | Method |
|---------|-----------|--------|
| codex | task_count > 3 or explicit | `maestro delegate --to codex --mode write --id issue-<issueId>` |
| agy | task_count <= 3 or explicit | `maestro delegate --to agy --mode write --id issue-<issueId>` |
| qwen | explicit | `maestro delegate --to qwen --mode write --id issue-<issueId>` |

## Phase 2: Load Solution & Resolve Executor

| Input | Source | Required |
|-------|--------|----------|
| Issue ID | Task description (GH-\d+ or ISS-\d{8}-\d{3}) | Yes |
| Solution artifact | `{run_dir}/outputs/solutions/solution-<issueId>.json` | Yes |
| Explorer context | `{run_dir}/work/team/explorations/context-<issueId>.json` | No |
| Execution method | Task description (`execution_method: Codex|Agy|Qwen|Auto`) | Yes |
| Code review | Task description (`code_review: Skip|Agy Review|Codex Review`) | No |

1. Extract issue ID from task description
2. If no issue ID -> report error, STOP
3. Load solution artifact: `Read("{run_dir}/outputs/solutions/solution-<issueId>.json")`
4. If no solution artifact -> report error, STOP
5. Load explorer context (if available)
6. Resolve execution method (Auto: task_count <= 3 -> agy, else codex)
7. Update issue status: `Bash("maestro issue update <issueId> --status in_progress --json")`

## Phase 3: Implementation (Multi-Backend Routing)

**Execution prompt template** (all backends):

```
## Issue
ID: <issueId>
Title: <solution.bound.title>

## Solution Plan
<solution.bound JSON>

## Codebase Context (from explorer)
Relevant files: <explorerContext.relevant_files>
Existing patterns: <explorerContext.existing_patterns>
Dependencies: <explorerContext.dependencies>

## Implementation Requirements
1. Follow the solution plan tasks in order
2. Write clean, minimal code following existing patterns
3. Run tests after each significant change
4. Ensure all existing tests still pass
5. Do NOT over-engineer

## Quality Checklist
- All solution tasks implemented
- No TypeScript/linting errors
- Existing tests pass
- New tests added where appropriate
```

Route by executor:
- **codex**: `Bash("maestro delegate \\\"<prompt>\" --to codex --mode write --id issue-<issueId>", { run_in_background: false })`
- **agy**: `Bash("maestro delegate \\\"<prompt>\" --to agy --mode write --id issue-<issueId>", { run_in_background: false })`
- **qwen**: `Bash("maestro delegate \\\"<prompt>\" --to qwen --mode write --id issue-<issueId>", { run_in_background: false })`

On CLI failure, resume: `maestro delegate "Continue" --resume issue-<issueId> --to <tool> --mode write`

## Phase 4: Verify & Commit

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Tests pass | Detect and run test command | No new failures |
| Code review | Optional, per task config | Review output logged |

- Tests pass -> optional code review -> `Bash("maestro issue close <issueId> --status completed --resolution \"Implemented and verified\" --json")` -> report `impl_complete`
- Tests fail -> report `impl_failed` with truncated test output

Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `implementer` namespace:
- Read existing -> merge `{ "implementer": { issue_id, executor, test_status, review_status } }` -> write back
