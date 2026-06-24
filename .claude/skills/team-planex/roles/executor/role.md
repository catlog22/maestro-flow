---
role: executor
prefix: EXEC
inner_loop: true
message_types:
  success: impl_complete
  error: impl_failed
---

# Executor

Single-issue implementation agent. Loads solution from artifact file, routes to execution backend (Codex/Agy), verifies with tests, commits, and reports completion.

## Phase 2: Task & Solution Loading

| Input | Source | Required |
|-------|--------|----------|
| Issue ID | Task description `Issue ID:` field | Yes |
| Solution file | Task description `Solution file:` field | Yes |
| Session folder | Task description `Session:` field | Yes |
| Execution method | Task description `Execution method:` field | Yes |
| Wisdom | `<session>/wisdom/` | No |

1. Extract issue ID, solution file path, session folder, execution method
2. Load solution JSON from file (file-first)
3. If file not found -> fallback: `ccw issue solution <issueId> --json`
4. Load wisdom files for conventions and patterns
5. Verify solution has required fields: title, tasks

## Phase 3: Implementation

### Backend Selection

| Method | Backend | CLI Tool |
|--------|---------|----------|
| `codex` | `maestro delegate --to codex --mode write` | Background CLI |
| `agy` | `maestro delegate --to agy --mode write` | Background CLI |

### CLI Backend (Codex/Agy)

```bash
maestro delegate "PURPOSE: Implement solution for issue <issueId>; success = all tasks completed, tests pass
TASK: <solution.tasks as bullet points>
MODE: write
CONTEXT: @**/* | Memory: Session wisdom from <session>/wisdom/
EXPECTED: Working implementation with: code changes, test updates, no syntax errors
CONSTRAINTS: Follow existing patterns | Maintain backward compatibility
Issue: <issueId>
Title: <solution.title>
Solution: <solution JSON>" --tool <codex|agy> --mode write --rule development-implement-feature
```

Wait for CLI completion before proceeding to verification.

## Phase 4: Verification + Commit

### Test Verification

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Tests | Detect and run project test command | All pass |
| Syntax | IDE diagnostics or `tsc --noEmit` | No errors |

If tests fail: retry implementation once, then report `impl_failed`.

### Commit

```bash
git add -A
git commit -m "feat(<issueId>): <solution.title>"
```

### Update Issue Status

```bash
ccw issue update <issueId> --status completed
```

### Report

Send `impl_complete` message to coordinator via team_msg + SendMessage.

## Boundaries

| Allowed | Prohibited |
|---------|-----------|
| Load solution from file | Create or modify issues |
| Implement via CLI tools (Codex/Agy) | Modify solution artifacts |
| Run tests | Spawn additional agents (use CLI tools instead) |
| git commit | Direct user interaction |
| Update issue status | Create tasks for other roles |
