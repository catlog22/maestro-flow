---
name: maestro-plan
description: Explore, clarify, plan, check, and confirm a phase execution plan
argument-hint: "[phase] [--collab] [--spec SPEC-xxx] [--auto] [--gaps] [--dir <path>] [--revise [instructions]] [--check <plan-dir>]"
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

**Flags:**
- `--collab` -- Multi-planner collaborative mode (spawn N workflow-collab-planner agents with pre-allocated TASK ID ranges)
- `--spec SPEC-xxx` -- Reference a task-spec for requirements input
- `--auto` -- Skip interactive clarification (P2), use defaults
- `--gaps` -- Gap closure mode: load verification/issue gaps, skip exploration, plan only gap fixes
- `--dir <path>` -- Use arbitrary scratch directory as context source (e.g., from analyze session)
- `--revise [instructions]` -- Revise existing plan. Auto-discovers latest plan for current phase from state.json, or use with `--dir` to target specific plan. If instructions provided, apply directly (e.g. `--revise "add TASK-005 for error handling"`). If omitted, ask user via AskUserQuestion. Skips P1-P3 (exploration/clarification/planning), loads existing plan.json + tasks, applies targeted modifications, re-runs P4 (plan-checker).
- `--check <plan-dir>` -- Standalone plan verification. Run plan-checker (P4 only) against existing plan without modification. Also checks roadmap consistency and collision detection. Read-only.

**Scope routing:**

| Invocation | Precondition | Scope | Behavior |
|-----------|-------------|-------|----------|
| `plan` (no args) | init + roadmap | milestone | Plan all phases in current milestone |
| `plan 1` | init + roadmap | phase | Plan phase 1 only |
| `plan --dir scratch/analyze-xxx` | none | inherited | Plan against specified analyze session |
| `plan --revise "instructions"` | existing plan | revise | Modify existing plan with instructions |
| `plan --revise` | existing plan | revise | Modify existing plan, ask user for instructions |
| `plan --check scratch/plan-xxx` | existing plan | check | Verify existing plan (read-only) |

**Upstream context:**
- Reads `context.md` from prior analyze artifact (auto-discovered from state.json or via --dir)
- Reads `conclusions.json` if available (implementation_scope seeds task generation)

**Output directory** (relative to `.workflow/`):

| Scope | Directory format | Example |
|-------|-----------------|---------|
| Phase | `scratch/{YYYYMMDD}-plan-P{N}-{slug}/` | `20260420-plan-P1-auth` |
| Milestone | `scratch/{YYYYMMDD}-plan-M{N}-{slug}/` | `20260420-plan-M1-mvp` |
| Adhoc/Standalone | `scratch/{YYYYMMDD}-plan-{slug}/` | `20260420-plan-caching` |

**Output structure:**
```
{YYYYMMDD}-plan-P{N}-{slug}/
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
  "path": "scratch/{YYYYMMDD}-plan-P{N}-{slug}",  // P{N} for phase, M{N} for milestone, omit for adhoc/standalone
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

### Mode: Revise (`--revise [instructions]`)

Incrementally modify an existing plan without rebuilding from scratch.

**Plan discovery:**
- With `--dir`: use specified plan directory
- Without `--dir`: auto-discover latest completed plan for current phase from `state.json.artifacts[]` (type=plan, status=completed, matching phase)

**Execution flow:**

1. **Load existing plan**
   - Read `plan.json` + all `.task/TASK-*.json` from discovered directory
   - Show current plan summary: task count, waves, status per task

2. **Obtain revision instructions**
   - If `--revise "instructions"` provided → parse as change directive
   - If `--revise` without instructions → AskUserQuestion for what to change:
     - Add/remove tasks
     - Modify task scope, action, implementation
     - Reorder waves or adjust dependencies
     - Update convergence criteria
   - Parse instructions into concrete changes

3. **Apply targeted changes**
   - Modify affected TASK files in-place
   - If tasks added/removed: re-sequence task IDs, regenerate wave assignments
   - Update plan.json summary (task count, wave structure)
   - Preserve unmodified tasks completely

4. **Re-run plan-checker (P4)**
   - Validate modified plan with same checker as create mode
   - Re-run collision detection against same-milestone plans
   - Present check results for confirmation

5. **Update artifact**
   - Overwrite plan files in existing scratch directory
   - Update artifact timestamp in state.json (no new artifact created)

### Mode: Check (`--check <plan-dir>`)

Read-only plan verification without modification.

**Execution flow:**

1. **Load plan**
   - Read `plan.json` + `.task/TASK-*.json` from specified directory
   - Read `.workflow/roadmap.md` for consistency comparison

2. **Run checks**
   - Plan-checker (P4 pipeline stage) — task quality, convergence criteria
   - Roadmap consistency — plan tasks align with phase scope and requirements
   - Collision detection — file overlaps with other plans in same milestone
   - Dependency integrity — no broken cross-task dependencies

3. **Produce check report**
   ```
   === PLAN CHECK ===
   Plan: {plan_dir}/plan.json
   Tasks: {total} ({completed} done, {pending} pending)

   Checker: {PASS|WARN|FAIL} ({issues} issues)
   Roadmap: {aligned|drift detected}
   Collision: {clear|{N} overlaps}

   Issues:
     1. [{severity}] {description}

   Suggested actions:
     /maestro-plan --revise "fix instructions"  -- Apply fixes
     /maestro-execute --dir {plan_dir}          -- Execute as-is
   ```

**No file modifications.** Pure verification + report.
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
