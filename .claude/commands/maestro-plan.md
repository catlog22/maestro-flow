---
name: maestro-plan
description: Explore, clarify, plan, check, and confirm a phase execution plan
argument-hint: "[phase] [--collab] [--spec SPEC-xxx] [-y] [--gaps] [--dir <path>] [--revise [instructions]] [--check <plan-dir>]"
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
Create, revise, or verify an execution plan through a 5-stage pipeline: Exploration, Clarification, Planning, Plan Checking, and Confirmation. Produces plan.json with waves, task definitions, and user-confirmed execution strategy.

Supports three modes:
- **Create** (default): Build plan from analysis context or phase requirements
- **Revise** (`--revise`): Incrementally modify existing plan — edit tasks, adjust waves, add/remove tasks
- **Check** (`--check`): Standalone plan verification — run plan-checker against existing plan

All plan output goes to `.workflow/scratch/{YYYYMMDD}-plan-[P{N}-|M{N}-]{slug}/`. Date-first ordering enables chronological sorting. Scope prefix in directory name (`P{N}` for phase, `M{N}` for milestone, omit for adhoc/standalone) enables fallback identification. Registers PLN artifact in state.json. Performs collision detection against other plans in same milestone.
</purpose>

<required_reading>
@~/.maestro/workflows/plan.md
</required_reading>

<deferred_reading>
- [plan.json](~/.maestro/templates/plan.json) — read when generating plan output
- [task.json](~/.maestro/templates/task.json) — read when generating task files
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
</deferred_reading>

<context>
$ARGUMENTS — phase number, or no args for milestone-wide planning, with optional flags.

Scope routing, base flags (`--collab`, `--spec`, `-y`, `--gaps`, `--dir`), output directory format, and artifact registration are defined in workflow plan.md.

**Command-level flags** (extensions beyond workflow base):
- `--revise [instructions]` -- See workflow plan.md § Revise Mode
- `--check <plan-dir>` -- See workflow plan.md § Check Mode

**Upstream context:**
- Reads `context.md` from prior analyze artifact (auto-discovered from state.json or via --dir)
- Reads `conclusions.json` if available (implementation_scope seeds task generation)
</context>

<execution>
### Pre-flight: team conflict check

Before starting the plan pipeline, run:
```
Bash("maestro collab preflight --phase <phase-number>")
```
If exit code is 1, present warnings and ask whether to proceed.

Follow '~/.maestro/workflows/plan.md' completely.

### Wiki Knowledge Search (P1 addition)

During P1 Context Collection, after loading context files and before parallel exploration (step 5), search the wiki for prior knowledge related to the phase:

```
phase_keywords = extract key terms from goal/title (2-5 terms)
wiki_result = Bash("maestro wiki search ${phase_keywords} --json 2>/dev/null")

IF wiki_result exit code != 0 OR empty:
  display "W003: Wiki search unavailable, continuing without prior knowledge"
ELSE:
  entries = JSON.parse(wiki_result).entries (limit to first 10)
  wiki_context = structured block for downstream stages
```

### Issue Linkback (--gaps mode)

After plan generation and checking, if `--gaps` mode was used, link TASK files back to issues bidirectionally:

```
For each created TASK-{NNN}.json that has issue_id:
  Update corresponding issue in .workflow/issues/issues.jsonl:
    task_refs: append TASK-{NNN} to array
    task_plan_dir: relative path to .task/ directory
    status: "planned"
    updated_at: now()
  Append history entry: { action: "planned", at: <ISO>, by: "maestro-plan", summary: "Linked to TASK-{NNN}" }
```

This ensures issue → TASK traceability. The `task_refs[]` and `task_plan_dir` fields on the issue allow the dashboard to resolve and display associated TASK details.

**Report format on completion:**

```
=== PLAN READY ===
Phase: {phase_name}
Tasks: {task_count} tasks in {wave_count} waves
Check: {checker_status} (iteration {check_count}/{max_checks})
Collision: {collision_status}

Plan: scratch/{YYYYMMDD}-plan-P{N}-{slug}/plan.json
Tasks: scratch/{YYYYMMDD}-plan-P{N}-{slug}/.task/TASK-*.json

Next steps:
  /maestro-execute              -- Execute the plan
  /maestro-execute --dir {dir}  -- Execute specific plan
  /maestro-plan {phase}         -- Re-plan with modifications
```

### Mode: Revise / Check

Follow workflow plan.md § "Revise Mode" and § "Check Mode" respectively. These modes bypass the standard P1-P5 create pipeline.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No args and no roadmap (cannot determine scope) | Provide phase number or topic, or create roadmap |
| E003 | error | --gaps requires prior verification/issues to exist | Run maestro-verify first |
| E004 | error | No plan found to revise (--revise without target) | Use --dir to specify plan, or create plan first |
| E005 | error | Plan directory not found (--check) | Check path, use --dir |
| W001 | warning | Exploration agent returned incomplete results | Retry exploration or proceed with available context |
| W002 | warning | Plan-checker found minor issues, continuing | Review plan-checker feedback, adjust plan if needed |
| W003 | warning | Wiki search unavailable or returned no results | Continue without prior knowledge context |
| W004 | warning | Collision detected with existing plan | Review colliding files, confirm or adjust scope |
</error_codes>

<success_criteria>
- [ ] plan.json written to scratch directory with summary, approach, task_ids, waves (with phase labels)
- [ ] .task/TASK-*.json files created for each task
- [ ] Every task has `read_first[]` with at least the file being modified + source of truth files
- [ ] Every task has `convergence.criteria[]` with grep-verifiable conditions (no subjective language)
- [ ] Every task `action` and `implementation` contain concrete values (no "align X with Y")
- [ ] Collision detection executed against same-milestone plans (non-blocking)
- [ ] Plan-checker passed (or minor issues acknowledged)
- [ ] User confirmation captured (execute/modify/cancel)
- [ ] Artifact registered in state.json with correct scope/milestone/phase/depends_on
</success_criteria>
