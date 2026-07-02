---
name: maestro-quick
description: Quick task execution, skip optional agents
argument-hint: "[description] [--full] [--discuss] [-y]"
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
Execute small, ad-hoc tasks with workflow guarantees (atomic commits, state tracking) via a shortened pipeline.
Flags --discuss and --full enable additional pipeline stages.
**Implicit write**: state.json scratch task entry is written automatically as part of workflow tracking (no confirmation gate).
</purpose>

<required_reading>
@~/.maestro/workflows/quick.md
</required_reading>

<context>
$ARGUMENTS

Parse for:
- `--full` flag -- Enables plan-checking (max 2 iterations) and post-execution verification
- `--discuss` flag -- Decision extraction before planning (gray areas, Locked/Free/Deferred classification)
- `-y` / `--yes` flag -- Auto mode: skip commit confirmation, auto-approve state writes
- Remaining text as task description

### Pre-load context

1. **Coding specs + tools**: Run `maestro load --type spec --category coding` to load coding conventions and discoverable tools. Apply to implementation.
2. **UI specs (conditional)**: If the task involves frontend/UI work (description contains component, page, style, layout, CSS, HTML, frontend), also run `maestro load --type spec --category ui`.
3. **Role Knowledge**:
   - Browse: `maestro search --category coding`
   - Load task-relevant entries: `maestro load --type knowhow --id <id1> [id2...]`
3. All are optional — proceed without if unavailable.

**Output boundary**: ALL file writes MUST target `.workflow/scratch/` (task directory, plan.json, summaries) and modified source files as defined in plan.json tasks. State.json scratch entry is implicit workflow tracking.
</context>

<invariants>
1. **Atomic commits** — each task execution MUST produce a commit with only the files modified by that task; NEVER stage unrelated files
2. **Evidence-based summaries** — task summaries MUST include concrete evidence (files changed, tests run, commands executed); NEVER accept "task completed successfully" as a summary
3. **Plan before execute** — plan.json MUST be written before any task execution begins; NEVER skip planning even for single-task workflows
4. **Scratch isolation** — all workflow artifacts MUST live under `.workflow/scratch/{task-dir}/`; NEVER write workflow metadata outside this directory
5. **Commit confirmation** — staged files and commit message MUST be shown via AskUserQuestion before committing (unless `-y`); NEVER auto-commit without user awareness
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Setup → Planning**
- REQUIRED: Task description parsed and scratch directory created.
- REQUIRED: Coding specs loaded (optional but attempted).
- BLOCKED if: no task description (E001) or scratch directory creation failed (E002).

**GATE 2: Planning → Execution**
- REQUIRED: plan.json written with task definitions.
- REQUIRED: --discuss decisions extracted and recorded (if flag set).
- BLOCKED if: plan.json missing or empty.

**GATE 3: Execution → Completion**
- REQUIRED: All tasks executed with `.summaries/TASK-*-summary.md` written per task.
- REQUIRED: Each summary contains concrete evidence of completion.
- REQUIRED: --full verification passed (if flag set).
- BLOCKED if: any task summary missing or lacking evidence.

Follow '~/.maestro/workflows/quick.md' completely.

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  "plan.json",                              // Task definitions
  ".summaries/TASK-*-summary.md" (per task)  // Execution results
]
```
If any artifact is missing: DO NOT report completion. Complete the missing step first.

Task summaries MUST include concrete evidence of completion (files changed, tests run, commands executed) — not just "task completed successfully."

</execution>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Task done, --full verification passed | `/manage-status` |
| Task done, verification found gaps | `/quality-debug {issue}` |
| Task done, want to sync docs | `/quality-sync` |
| Need a full phase workflow instead | `/maestro-plan {phase}` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Task description required (no text provided) | Check arguments format, re-run with correct input |
| E002 | error | Scratch directory creation failed | Check disk space and .workflow/ permissions |
| W001 | warning | Verification found minor gaps | Review gaps and determine if they need fixing |
</error_codes>

<success_criteria>
- [ ] Scratch task directory created under .workflow/scratch/
- [ ] plan.json written with task definitions
- [ ] All tasks executed with summaries written
- [ ] state.json updated with scratch task entry (implicit — part of workflow tracking, no confirmation needed)
- [ ] Commit created with task changes: stage ONLY files modified by the task (from `.summaries/TASK-*-summary.md` "Files modified" list); confirm with `AskUserQuestion` showing staged files and proposed commit message — unless `-y` is active, in which case auto-commit
</success_criteria>
