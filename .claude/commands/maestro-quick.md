---
name: maestro-quick
description: Execute a quick task with workflow guarantees but skip optional agents
argument-hint: "[description] [--full] [--discuss]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---
<purpose>
Execute small, ad-hoc tasks with workflow guarantees (atomic commits, state tracking) using a shortened pipeline. Invoked for tasks that are well-understood and do not require full phase-level planning. Produces scratch task directory with plan, execution results, and optional verification. Flags --discuss and --full enable additional pipeline stages.
</purpose>

<required_reading>
@~/.maestro/workflows/quick.md
</required_reading>

<context>
$ARGUMENTS

Parse for:
- `--full` flag -- Enables plan-checking (max 2 iterations) and post-execution verification
- `--discuss` flag -- Decision extraction before planning (gray areas, Locked/Free/Deferred classification)
- Remaining text as task description
</context>

<execution>
Follow '~/.maestro/workflows/quick.md' completely.

**Next-step routing on completion:**
- Task done, --full verification passed → Skill({ skill: "manage-status" })
- Task done, verification found gaps → Skill({ skill: "quality-debug", args: "{issue}" })
- Task done, want to sync docs → Skill({ skill: "quality-sync" })
- Need a full phase workflow instead → Skill({ skill: "maestro-plan", args: "{phase}" })
</execution>

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
- [ ] state.json updated with scratch task entry
- [ ] Commit created with task changes
</success_criteria>
