---
name: manage-status
description: Show project dashboard with progress and next steps
argument-hint: ""
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Project dashboard: artifact progress, task counts, active work, next-step suggestions.
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

**Output boundary**: Read-only command. MUST NOT write any files. All output is displayed to the user via text.
</context>

<invariants>
1. **Read-only** — MUST NOT write or modify any files; this is a pure display command
2. **Graceful degradation** — missing roadmap.md, plan.json, or task files MUST NOT cause failure; display available data and note missing sections
3. **State accuracy** — progress percentages MUST be calculated from actual task statuses, NEVER estimated or inferred
4. **Wiki health optional** — wiki health score display MUST degrade gracefully if wiki is unavailable
5. **Complete dashboard** — MUST include: milestone progress, phase status, task counts, active work, and next-step suggestions
</invariants>

<execution>
Follow '~/.maestro/workflows/status.md' completely.

Next-step decision table defined in workflow status.md Step 5.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Load → Render** (State loading → Dashboard display)
- REQUIRED: `.workflow/` exists and `state.json` is readable (E001/E002 if not).
- REQUIRED: Project state loaded with milestone and artifact registry.
- BLOCKED if state.json missing or corrupt (E002).

**GATE 2: Render → Route** (Dashboard → Next-step suggestions)
- REQUIRED: Per-phase progress calculated from actual task statuses.
- REQUIRED: Dashboard rendered with progress bars and status table.
- BLOCKED if state parsing fails entirely.
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

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Phase needs analysis | `/maestro-analyze {phase}` |
| Phase needs planning | `/maestro-plan {phase}` |
| Phase needs execution | `/maestro-execute {phase}` |
| Milestone ready for audit | `/maestro-milestone-audit` |
| Issues need triage | `/manage-issue list` |
</completion>
