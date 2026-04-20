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

**Flags:**
- `--auto-commit` -- Automatically commit after each task completion
- `--method agent|cli|auto` -- Override execution method (default: from config.json)
- `--executor <tool>` -- Default CLI tool: gemini|codex|qwen|opencode|claude
- `--dir <path>` -- Execute specific plan directory (e.g., `scratch/plan-auth-2026-04-20`)

**Scope routing:**

| Invocation | Behavior |
|-----------|----------|
| `execute` (no args) | Find all pending plans for current milestone, execute sequentially |
| `execute 1` | Find pending plans for phase 1, execute sequentially |
| `execute --dir scratch/plan-xxx` | Execute the specific plan |

**Resolution logic (no-args / phase):**
```
1. Read state.json.artifacts
2. Filter: milestone=target, type=plan, status=completed, AND no corresponding EXC artifact
3. If phase specified: further filter by phase=target
4. Sort by phase dependency order (roadmap phase order), adhoc last
5. Execute each plan sequentially
```

**Output**: Task summaries written to plan's scratch dir:
```
scratch/plan-{slug}-{date}/
├── plan.json
├── .task/
│   ├── TASK-001.json    # status updated to completed|blocked
│   └── TASK-002.json
└── .summaries/          ← execute writes here
    ├── TASK-001-summary.md
    └── TASK-002-summary.md
```

**Incremental learning extraction**: After each plan completes, extract strategy adjustments / patterns / pitfalls from `.summaries/` and append to `specs/learnings.md`. Mark artifact `harvested: true`.

**Artifact registration**: For each plan executed, register in `state.json.artifacts[]`:
```jsonc
{
  "id": "EXC-{NNN}",
  "type": "execute",
  "milestone": "{current_milestone or null}",
  "phase": "{phase or null}",
  "scope": "{inherited from plan}",
  "path": "{same as plan path}",
  "status": "completed",
  "depends_on": "PLN-{NNN}",
  "harvested": false,
  "created_at": "...",
  "completed_at": "..."
}
```
</context>

<execution>
### Pre-flight: team conflict check

Before any task execution, run:
```
Bash("maestro collab preflight --phase <phase-number>")
```
If exit code is 1, present warnings and ask whether to proceed.

Follow '~/.maestro/workflows/execute.md' completely.

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
