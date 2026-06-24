---
name: maestro-execute
description: Use when a confirmed plan is ready for implementation
argument-hint: "[phase] [--auto-commit] [--method agent|cli|auto] [--executor <tool>] [--dir <path>] [-y]"
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
Execute confirmed plan tasks via wave-based parallel dispatch.
Consumes plan from maestro-plan; registers EXC artifact in state.json.
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

### Flags

| Flag | Effect | Default |
|------|--------|---------|
| `--auto-commit` | Auto-commit after each completed task | false |
| `--method agent\|cli\|auto` | Execution method: Agent tool, CLI delegate, or auto-select | `auto` |
| `--executor <tool>` | Explicit executor tool for CLI delegate mode | First enabled in config |
| `--dir <path>` | Execute a specific plan directory instead of auto-discovery | — |
| `-y` / `--yes` | Auto mode — skip interactive questions | false |

### Scope routing

| Input | Scope | Resolution |
|-------|-------|------------|
| numeric arg | phase | Resolve plan from roadmap phase |
| `--dir <path>` | explicit | Use specified plan directory |
| no args + milestone | milestone | Find all pending plans, execute sequentially |
| no args + no milestone | error E001 | No plan found |

Full resolution logic, output directory format, artifact registration schema, and incremental knowhow extraction are defined in workflow `execute.md`.

### Pre-load context (before task execution)

1. **Codebase docs**: If `.workflow/codebase/doc-index.json` exists, read `ARCHITECTURE.md` for module boundaries. Pass as shared context to executor agents.
2. **Wiki knowledge**: Run `maestro search "<phase keywords>" --json 2>/dev/null`. If results found, extract top 5 entries as prior knowledge context for agents.
3. **Coding specs + tools**: Run `maestro load --type spec --category coding` to load coding conventions AND discoverable knowhow tools (tool: true entries). Pass as specs context to all executor agents.
4. **UI specs (conditional)**: If any task involves frontend/UI work (task scope/description contains keywords like component, page, style, layout, CSS, HTML, frontend; or focus_paths in `src/components/`, `src/pages/`, `src/styles/`, `src/ui/`), also run `maestro load --type spec --category ui` and include in agent context.
5. All are optional — proceed without if unavailable (log warning).

### Role Knowledge
`maestro search --category coding` → select relevant → `maestro load --type knowhow --id`
</context>

<execution>
### Pre-flight: team conflict check

Before any task execution, run:
```
Bash("maestro collab preflight --phase <phase-number>")
```
If exit code is 1, present warnings and ask whether to proceed.

Follow '~/.maestro/workflows/execute.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Plan Load → Task Execution**
- REQUIRED: plan.json found and parsed with valid task definitions.
- REQUIRED: `.task/TASK-*.json` files exist for all tasks in plan.
- BLOCKED if no pending tasks: error E004.

**GATE 2: Per-Task Execution → Summary**
- REQUIRED: Each completed task has `.summaries/TASK-{NNN}-summary.md` written with concrete evidence (files changed, tests run, verification results).
- REQUIRED: `.task/TASK-{NNN}.json` status updated to completed|blocked.
- BLOCKED if missing: summary file absent or task status not updated — halt wave progression until evidence is recorded.
- Do NOT silently skip failed tasks — mark as blocked with reason.

**GATE 3: All Tasks → Completion**
- REQUIRED: All waves executed in dependency order.
- REQUIRED: EXC artifact registered in state.json.
- BLOCKED if missing: waves incomplete or EXC artifact not registered — do not report execution complete.

### Evidence Requirement

Task summaries MUST include:
- Files actually modified (not just planned targets)
- Convergence criteria verification results (pass/fail with evidence)
- Any deviations from the plan with rationale

### Post-task Knowledge Inquiry

After each task completion, check triggers:

| Condition | Ask | Route |
|-----------|-----|-------|
| Summary mentions approach change / plan deviation | "Record as arch constraint?" | spec-add arch |
| retry_count >= 2 | "Document fix pattern?" | spec-add debug |
| Summary contains design rationale ("chose X because") | "Record as knowhow?" | spec-add learning |

On confirm → `Skill("spec-add", "<category> <content> --description \"<summary>\"")`.
Include `--description` with a one-line summary for search result display.

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

</execution>

<completion>
### Standalone report

```
=== EXECUTION COMPLETE ===
Plans executed: {plans_count}
Completed: {completed_count}/{total_count} tasks
Failed:    {failed_count} tasks

Summaries: {plan_dir}/.summaries/
Tasks:     {plan_dir}/.task/
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| All tasks completed successfully | `/quality-review` |
| Failed tasks exist | `/quality-debug` |
| View project dashboard | `/manage-status` |
</completion>

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
- [ ] Incremental knowhow extracted to specs/learnings.md
- [ ] state.json updated with execution progress
</success_criteria>
