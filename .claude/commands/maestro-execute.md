---
name: maestro-execute
description: Execute plan with wave-based parallel execution and atomic commits
argument-hint: "[phase] [--auto-commit] [--method agent|cli|auto] [--executor <tool>] [--dir <path>]"
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
Execute all tasks in a plan using wave-based parallel execution with dependency-aware ordering. Each plan is executed independently (plans串行, plan内wave并行). Task summaries are written to the plan's scratch directory under `.summaries/`. Registers EXC artifact in state.json.

Invoked after /maestro-plan produces a confirmed plan. When called without args on a milestone, finds all pending plans and executes them sequentially.
</purpose>

<required_reading>
@~/.maestro/workflows/execute.md
</required_reading>

<deferred_reading>
- [task.json](~/.maestro/templates/task.json) — read when reading task definitions
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
</deferred_reading>

<context>
$ARGUMENTS — phase number, or no args for milestone-wide execution, with optional flags.

Scope routing, flags, resolution logic, output directory format, artifact registration schema, and incremental learning extraction are defined in workflow `execute.md`.
</context>

<execution>
### Pre-flight: team conflict check

Before any task execution, run:
```
Bash("maestro collab preflight --phase <phase-number>")
```
If exit code is 1, present warnings and ask whether to proceed.

Follow '~/.maestro/workflows/execute.md' completely.

### Post-task Knowledge Inquiry

After each task completes, evaluate inquiry triggers:

1. **Execution deviation**: If task summary mentions approach change, dependency swap, or plan deviation:
   → Ask: "TASK-{NNN} deviated from the plan. Should this decision be recorded as an architecture constraint? (`/spec-add arch`)"

2. **Retry success**: If task required ≥2 retries before completion:
   → Ask: "TASK-{NNN} succeeded after {N} retries. Should this fix pattern be documented? (`/spec-add debug`)"

3. **Implicit knowledge**: If task summary contains design rationale ("chose X because", "rejected Y due to"):
   → Ask: "Design decision detected. Should it be recorded as a learning? (`/spec-add learning`)"

If user confirms, invoke `Skill({ skill: "spec-add", args: "<category> <content>" })` with extracted content.

### Issue Status Sync

On each task completion, if `task.issue_id` exists, sync status back to the issue in `.workflow/issues/issues.jsonl`:

```
For each completed/failed TASK with issue_id:
  Read issue from issues.jsonl by issue_id
  Collect all task_refs[] statuses for that issue:
    all task_refs completed → issue.status = "resolved"
    any task_ref failed    → issue.status = "in_progress"
  Append history entry: { action: "executed", at: <ISO>, by: "maestro-execute", summary: "TASK-{NNN} {status}" }
  Write updated issue back to issues.jsonl
```

**Report format on completion:**

```
=== EXECUTION COMPLETE ===
Plans executed: {plans_count}
Completed: {completed_count}/{total_count} tasks
Failed:    {failed_count} tasks

Summaries: {plan_dir}/.summaries/
Tasks:     {plan_dir}/.task/

Next steps:
  /maestro-verify              -- Verify execution results
  /maestro-verify --dir {dir}  -- Verify specific plan
  /manage-status               -- View project dashboard
```

If failed tasks exist, suggest /quality-debug for investigation.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No pending plans found | Verify plans exist, run maestro-plan first |
| E002 | error | Plan directory not found | Check --dir path |
| E003 | error | plan.json not found in directory | Verify plan.json exists, run maestro-plan first |
| E004 | error | No pending tasks, all tasks already completed | Check task statuses, reset if needed |
| W001 | warning | Executor completed with partial failures | Check task dependencies, retry failed wave |
</error_codes>

<success_criteria>
- [ ] All pending plans identified and executed sequentially
- [ ] Within each plan: waves executed in parallel, waves串行
- [ ] `.summaries/TASK-{NNN}-summary.md` written for each completed task
- [ ] `.task/TASK-{NNN}.json` statuses updated (completed|blocked)
- [ ] EXC artifact registered in state.json for each plan executed
- [ ] Incremental learnings extracted to specs/learnings.md
- [ ] state.json updated with execution progress
</success_criteria>
