---
name: maestro-init
description: Initialize project with auto state detection (empty/code/existing)
argument-hint: "[--auto] [--from-brainstorm SESSION-ID]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Initialize a new project through auto state detection and unified flow. Invoked when starting a fresh project or onboarding an existing codebase into workflow management. Produces the `.workflow/` directory structure with project.md, state.json, config.json, and specs. Does NOT create roadmap — use maestro-roadmap (light mode, default) or maestro-roadmap --mode full (spec package) as the next step.
</purpose>

<required_reading>
@~/.maestro/workflows/init.md
@~/.maestro/templates/project.md
@~/.maestro/templates/state.json
@~/.maestro/templates/config.json
</required_reading>

<context>
**Flags:**
- `--auto` -- Automatic mode. After config questions, runs research without further interaction. Expects idea document via @ reference.
- `--from-brainstorm SESSION-ID` -- Import from a brainstorm session. Reads guidance-specification.md to pre-fill project vision, goals, constraints, and terminology. Skips interactive questioning.

**Load project state if exists:**
Check for `.workflow/state.json` -- loads context if project already initialized.
</context>

<execution>
Follow '~/.maestro/workflows/init.md' completely.

**Report format on completion:**

```
=== WORKFLOW INITIALIZED ===
Project: {project_name}
State:   .workflow/state.json (active)

Created:
  .workflow/project.md
  .workflow/state.json
  .workflow/config.json
  .workflow/specs/

Next steps (choose one path to create roadmap):
  /maestro-roadmap <requirement>                               -- Direct interactive roadmap (light, default)
  /maestro-roadmap --mode full <idea>                          -- Full spec package + roadmap (heavy)

Other commands:
  /manage-status                                               -- View project dashboard
  /maestro-brainstorm <topic>                                  -- Explore ideas first
  /maestro-quick <task>                                        -- Quick ad-hoc task
```
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No arguments provided when --auto requires @ reference | Check arguments format, re-run with correct input |
| E002 | error | .workflow/ already exists for greenfield init | Check .workflow/ directory state, resolve conflicts |
| E003 | error | Brainstorm session not found (--from-brainstorm) | Check arguments format, re-run with correct input |
| W001 | warning | Research agent failed, continuing with partial results | Retry research or proceed with partial results |
</error_codes>

<success_criteria>
- [ ] Deep questioning completed (threads followed, not rushed) — or extracted from document/brainstorm
- [ ] `.workflow/project.md` created with Core Value, Requirements (Validated/Active/Out of Scope), Key Decisions
- [ ] `.workflow/state.json` created with artifacts[] array, initialized to idle state
- [ ] `.workflow/config.json` created with user-selected granularity, workflow agents, gate preferences
- [ ] `.workflow/specs/` initialized with convention files
- [ ] Research completed (if enabled) — 4 parallel agents spawned
- [ ] User knows next step is `/maestro-roadmap` (light) or `/maestro-roadmap --mode full` (spec package)
</success_criteria>
