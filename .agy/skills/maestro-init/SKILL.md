---
name: maestro-init
description: Initialize project with auto state detection
argument-hint: [-y] [--from <source>]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Initialize a new project through auto state detection and unified flow. Invoked when starting a fresh project or onboarding an existing codebase into workflow management. Produces the `.workflow/` directory structure with project.md, state.json, config.json, and specs. Does NOT create roadmap — use maestro-roadmap (light mode, default) or maestro-roadmap --mode full (spec package) as the next step.

Pipeline position: entry point (no upstream). Downstream: `maestro-roadmap` or `maestro-brainstorm`.
</purpose>

<required_reading>
@~/.maestro/workflows/init.md
</required_reading>

<deferred_reading>
- [project.md](~/.maestro/templates/project.md) — read when generating project description
- [state.json](~/.maestro/templates/state.json) — read when creating initial state
- [config.json](~/.maestro/templates/config.json) — read when creating workflow configuration
</deferred_reading>

<context>
$ARGUMENTS — none for interactive mode, or `-y` with `@file` reference for auto mode.

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Automatic mode. After config questions, runs research without further interaction. Expects idea document via @ reference. | `false` |
| `--from <source>` | Load upstream context package (brainstorm:ID, @file, or path). Consumes context-package.json to pre-fill project vision, goals, constraints, and terminology. Skips interactive questioning. Alias: `--from-brainstorm` | — |

**Load project state if exists:**
Check for `.workflow/state.json` -- loads context if project already initialized.
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): project type (greenfield / existing codebase onboarding) → tech stack detection and confirmation → directory structure preferences → initial configuration (specs categories, wiki bootstrap)
**Scope guard**: only init decisions; do not prejudge roadmap structure or plan scope
**Writeback target**: project.md (project description) + config.json (settings) + state.json (initial state)
**Additional skip conditions**: --from source (upstream context pre-fills decisions)
**Exit condition**: all configuration questions settled → proceed to workflow execution
</interview_protocol>

<execution>
### Pre-flight

1. Check if `.workflow/` already exists — if so, load state and warn (E002 for greenfield conflicts)
2. Validate `--from` source is accessible if provided

Follow '~/.maestro/workflows/init.md' completely.
</execution>

<completion>
### Standalone report

```
=== WORKFLOW INITIALIZED ===
Project: {project_name}
State:   .workflow/state.json (active)

Created:
  .workflow/project.md
  .workflow/state.json
  .workflow/config.json
  .workflow/specs/
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
| Roadmap needed (default light) | `/maestro-roadmap <requirement>` |
| Full spec package + roadmap | `/maestro-roadmap --mode full <idea>` |
| Explore ideas first | `/maestro-brainstorm <topic>` |
| View project dashboard | `/manage-status` |
| Quick ad-hoc task | `/maestro-quick <task>` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No arguments provided when -y requires @ reference | Check arguments format, re-run with correct input |
| E002 | error | .workflow/ already exists for greenfield init | Check .workflow/ directory state, resolve conflicts |
| E003 | error | Context source not found (--from / --from-brainstorm) | Check arguments format, re-run with correct input |
| W001 | warning | Research agent failed, continuing with partial results | Retry research or proceed with partial results |
</error_codes>

<success_criteria>
- [ ] `.workflow/project.md` created with Core Value, Requirements (Validated/Active/Out of Scope), Key Decisions
- [ ] `.workflow/state.json` created with artifacts[] array, initialized to idle state
- [ ] `.workflow/config.json` created with workflow / execution / git / gates / codebase / guard / collab / specInjection / dashboard segments
- [ ] `.workflow/specs/` initialized with convention files
- [ ] All interview decisions written to project.md / config.json before proceeding
- [ ] Research completed (if enabled) — parallel agents spawned with results merged
- [ ] Next-step routing displayed in completion report
</success_criteria>
