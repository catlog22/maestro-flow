---
name: manage-status
description: Display project dashboard with phase progress, active tasks, and next steps
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Display a unified project dashboard showing artifact progress, task counts, active work, and intelligent next-step suggestions.
Reads state.json artifact registry and roadmap to render a formatted overview with progress and status tables.
Provides situational awareness before continuing work. Uses virtual phase view derived from artifact registry.
</purpose>

<required_reading>
@~/.maestro/workflows/status.md
</required_reading>

<context>
$ARGUMENTS (no arguments required)

**State files read:**
- `.workflow/state.json` -- project-level state machine + artifact registry
- `.workflow/roadmap.md` -- milestone and phase structure
- `.workflow/scratch/*/plan.json` -- plan metadata (via artifact registry paths)
- `.workflow/scratch/*/.task/TASK-*.json` -- individual task statuses
</context>

<execution>
Follow '~/.maestro/workflows/status.md' completely.

Next-step decision table defined in workflow status.md Step 5.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | `state.json` missing or corrupt -- project state unrecoverable | parse_input |
</error_codes>

<success_criteria>
- [ ] Project state loaded from `state.json`
- [ ] Roadmap parsed with milestone/phase structure
- [ ] Per-phase progress calculated (task counts, completion %)
- [ ] Dashboard rendered with progress bars and status table
- [ ] Active work section shows current phase details
- [ ] Next steps suggested based on current state analysis
- [ ] Wiki health score displayed (or graceful unavailable message)
</success_criteria>
