---
name: maestro-plan
description: Explore, clarify, plan, check, and confirm a phase execution plan
argument-hint: "<phase> [--collab] [--spec SPEC-xxx] [--auto] [--gaps] [--dir <path>]"
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
Create a verified execution plan (plan.json + .task/TASK-*.json) for a roadmap phase through a 5-stage pipeline: Exploration, Clarification, Planning, Plan Checking, and Confirmation. Invoked when a phase is ready to be planned after init/brainstorm. Produces plan.json with waves, task definitions, and user-confirmed execution strategy.
</purpose>

<required_reading>
@~/.maestro/workflows/plan.md
</required_reading>

<deferred_reading>
- [plan.json](~/.maestro/templates/plan.json) — read when generating plan output
- [task.json](~/.maestro/templates/task.json) — read when generating task files
- [index.json](~/.maestro/templates/index.json) — read when updating phase index
</deferred_reading>

<context>
Phase: $ARGUMENTS (required -- phase number or slug)

**Flags:**
- `--collab` -- Multi-planner collaborative mode (spawn N workflow-collab-planner agents with pre-allocated TASK ID ranges)
- `--spec SPEC-xxx` -- Reference a task-spec for requirements input
- `--auto` -- Skip interactive clarification (P2), use defaults
- `--gaps` -- Gap closure mode: load verification.json gaps, skip exploration, plan only gap fixes
- `--dir <path>` -- Use arbitrary directory instead of phase resolution (scratch mode, skip roadmap validation)

Context files resolved from `.workflow/phases/{NN}-{slug}/` (or `--dir` path):
- context.md (user decisions from Skill({ skill: "maestro-analyze" }))
- index.json (phase metadata)
- spec-ref from index.json (if set)
- codebase/doc-index.json (if exists)
</context>

<execution>
Follow '~/.maestro/workflows/plan.md' completely.

**Report format on completion:**

```
=== PLAN READY ===
Phase: {phase_name}
Tasks: {task_count} tasks in {wave_count} waves
Check: {checker_status} (iteration {check_count}/{max_checks})

Plan: {phase_dir}/plan.json
Tasks: {phase_dir}/.task/TASK-*.json

Next steps:
  Skill({ skill: "maestro-execute", args: "{phase}" })  -- Execute the plan
  Skill({ skill: "maestro-plan", args: "{phase}" })     -- Re-plan with modifications

Note: If this was a --gaps plan, after execute run Skill({ skill: "maestro-verify", args: "{phase}" }) to confirm gaps are closed.
```
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | --gaps requires verification.json to exist | Check arguments format, re-run with correct input |
| W001 | warning | Exploration agent returned incomplete results | Retry exploration or proceed with available context |
| W002 | warning | Plan-checker found minor issues, continuing | Review plan-checker feedback, adjust plan if needed |
</error_codes>

<success_criteria>
- [ ] plan.json written to phase directory with summary, approach, task_ids, waves
- [ ] .task/TASK-*.json files created for each task
- [ ] Every task has `read_first[]` with at least the file being modified + source of truth files
- [ ] Every task has `convergence.criteria[]` with grep-verifiable conditions (no subjective language)
- [ ] Every task `action` and `implementation` contain concrete values (no "align X with Y")
- [ ] Plan-checker passed (or minor issues acknowledged)
- [ ] User confirmation captured (execute/modify/cancel)
- [ ] index.json updated with plan status and timestamps
</success_criteria>
