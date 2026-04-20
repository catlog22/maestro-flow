---
name: maestro-plan
description: Explore, clarify, plan, check, and confirm a phase execution plan
argument-hint: "[phase] [--collab] [--spec SPEC-xxx] [--auto] [--gaps] [--dir <path>]"
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
Create a verified execution plan (plan.json + .task/TASK-*.json) through a 5-stage pipeline: Exploration, Clarification, Planning, Plan Checking, and Confirmation. Produces plan.json with waves, task definitions, and user-confirmed execution strategy.

All plan output goes to `.workflow/scratch/plan-{slug}-{date}/`. Registers PLN artifact in state.json. Performs collision detection against other plans in same milestone.
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

**Flags:**
- `--collab` -- Multi-planner collaborative mode (spawn N workflow-collab-planner agents with pre-allocated TASK ID ranges)
- `--spec SPEC-xxx` -- Reference a task-spec for requirements input
- `--auto` -- Skip interactive clarification (P2), use defaults
- `--gaps` -- Gap closure mode: load verification/issue gaps, skip exploration, plan only gap fixes
- `--dir <path>` -- Use arbitrary scratch directory as context source (e.g., from analyze session)

**Scope routing:**

| Invocation | Precondition | Scope | Behavior |
|-----------|-------------|-------|----------|
| `plan` (no args) | init + roadmap | milestone | Plan all phases in current milestone |
| `plan 1` | init + roadmap | phase | Plan phase 1 only |
| `plan --dir scratch/analyze-xxx` | none | inherited | Plan against specified analyze session |

**Upstream context:**
- Reads `context.md` from prior analyze artifact (auto-discovered from state.json or via --dir)
- Reads `conclusions.json` if available (implementation_scope seeds task generation)

**Output directory**: `scratch/plan-{slug}-{date}/` (relative to `.workflow/`)

**Output structure:**
```
scratch/plan-{slug}-{date}/
├── plan.json            # summary, task_ids[], waves[] with phase labels
└── .task/
    ├── TASK-001.json    # { phase: 1, phase_slug: "auth", ... }
    ├── TASK-002.json
    └── ...
```

**Collision detection**: After plan generation, before user confirmation, check for file overlaps with existing plans in same milestone. Non-blocking warning only.

**Artifact registration**: On completion, register in `state.json.artifacts[]`:
```jsonc
{
  "id": "PLN-{NNN}",
  "type": "plan",
  "milestone": "{current_milestone or null}",
  "phase": "{phase_number or null}",
  "scope": "{milestone|phase|adhoc|standalone}",
  "path": "scratch/plan-{slug}-{date}",
  "status": "completed",
  "depends_on": "{ANL-NNN or null}",
  "harvested": false,
  "created_at": "...",
  "completed_at": "..."
}
```
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

**Report format on completion:**

```
=== PLAN READY ===
Phase: {phase_name}
Tasks: {task_count} tasks in {wave_count} waves
Check: {checker_status} (iteration {check_count}/{max_checks})
Collision: {collision_status}

Plan: {scratch_dir}/plan.json
Tasks: {scratch_dir}/.task/TASK-*.json

Next steps:
  /maestro-execute              -- Execute the plan
  /maestro-execute --dir {dir}  -- Execute specific plan
  /maestro-plan {phase}         -- Re-plan with modifications
```
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No args and no roadmap (cannot determine scope) | Provide phase number or topic, or create roadmap |
| E003 | error | --gaps requires prior verification/issues to exist | Run maestro-verify first |
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
