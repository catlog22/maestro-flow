---
name: maestro-execute
description: Execute phase plan with wave-based parallel execution and atomic commits
argument-hint: "<phase> [--auto-commit] [--method agent|cli] [--dir <path>]"
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
Execute all tasks in a phase plan using wave-based parallel execution with dependency-aware ordering. Invoked after Skill({ skill: "maestro-plan" }) produces a confirmed plan.json. Produces task summaries, updated task statuses, commits, and execution progress in index.json.
</purpose>

<required_reading>
@~/.maestro/workflows/execute.md
</required_reading>

<deferred_reading>
- [task.json](~/.maestro/templates/task.json) — read when reading task definitions
- [index.json](~/.maestro/templates/index.json) — read when updating phase index
</deferred_reading>

<context>
Phase: $ARGUMENTS (required -- phase number or slug)

**Flags:**
- `--auto-commit` -- Automatically commit after each task completion
- `--method agent|cli` -- Override execution method (default: from config.json or index.json)
- `--dir <path>` -- Use arbitrary directory instead of phase resolution (scratch mode, skip roadmap validation)

Context files resolved from `.workflow/phases/{NN}-{slug}/` (or `--dir` path):
- index.json (phase metadata + plan.waves + execution progress)
- plan.json (plan overview)
- .task/TASK-{NNN}.json (individual task definitions, lazy-loaded per wave)

**executionContext handoff:** If received from Skill({ skill: "maestro-plan" }) confirmation, skip disk reload and use in-memory plan + explorations + clarifications.
</context>

<execution>
Follow '~/.maestro/workflows/execute.md' completely.

**Report format on completion:**

```
=== EXECUTION COMPLETE ===
Phase:     {phase_name}
Completed: {completed_count}/{total_count} tasks
Failed:    {failed_count} tasks
Waves:     {waves_executed}/{total_waves}

Summaries: {phase_dir}/.summaries/
Tasks:     {phase_dir}/.task/

Next steps:
  Skill({ skill: "maestro-verify", args: "{phase}" })  -- Verify execution results
  Skill({ skill: "manage-status" })          -- View project dashboard
```

If this was a gap-fix execution (plan originated from `--gaps`), emphasize re-verification:
  "Gap-fix execution complete. Run Skill({ skill: "maestro-verify", args: "{phase}" }) to confirm gaps are resolved."

If failed tasks exist, suggest Skill({ skill: "quality-debug" }) for investigation.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | plan.json not found in phase directory | Verify plan.json exists, run maestro-plan first |
| E004 | error | No pending tasks, all tasks already completed | Check task statuses, reset if needed |
| W001 | warning | Executor completed with partial failures | Check task dependencies, retry failed wave |
</error_codes>

<success_criteria>
- [ ] All pending tasks executed (completed or explicitly failed)
- [ ] `.summaries/TASK-{NNN}-summary.md` written for each completed task
- [ ] `.task/TASK-{NNN}.json` statuses updated
- [ ] index.json execution progress updated
- [ ] state.json project progress updated
</success_criteria>
