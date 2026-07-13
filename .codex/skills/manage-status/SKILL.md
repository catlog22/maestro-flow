---
name: manage-status
description: Show project dashboard with progress and next steps
argument-hint: ""
allowed-tools: Read, Bash, Glob, Grep
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
version: 0.5.50
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Display project dashboard with phase progress, active tasks, and suggested next steps. Reads `.workflow/` state files and renders a formatted project overview. No arguments required.
</purpose>

<context>
$ARGUMENTS — none required.

```bash
$manage-status
```

Reads from:
- `.workflow/state.json` — project-level state machine
- `.workflow/roadmap.md` — milestone and phase structure
- `{run_dir}/outputs/index.json` — per-phase metadata and progress (resolved via Session `artifacts.json` registry)
- `{run_dir}/outputs/.task/TASK-*.json` — individual task statuses (resolved via Session `artifacts.json` registry)
- `.workflow/wiki-index.json` — unified wiki graph index (entry counts, health)

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

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Load → Render** (State loading → Dashboard display)
- REQUIRED: `.workflow/` exists and `state.json` is readable (E001/E002 if not).
- REQUIRED: Project state loaded with milestone and artifact registry.
- BLOCKED if state.json missing or corrupt (E002).

**GATE 2: Render → Route** (Dashboard → Next-step suggestions)
- REQUIRED: Dashboard sections rendered with available data.
- REQUIRED: Next-step suggestion computed from state decision table.
- BLOCKED: never — graceful degradation for missing sections.

### Step 1: Validate Project

Verify `.workflow/` exists (E001) and `state.json` is present (E002).

### Step 2: Load State Files

Read: `state.json`, `roadmap.md`, Session Run metadata and typed plan artifacts (all resolved via artifact registry).

### Step 3: Calculate Progress

For each phase directory found:
1. Count total tasks, completed, failed, blocked, pending
2. Calculate completion percentage
3. Determine phase status from index.json

### Step 4: Render Dashboard

Display sections: **Milestones & Phases** (per-phase status, progress bars, completion %), **Active Work** (in-progress and blocked tasks), **Knowledge Graph** (wiki entry counts by type, health score, orphans), **Next Steps** (state-based suggestion).

### Step 5: Suggest Next Steps

Use this decision table to suggest the next action:

| Current State | Suggestion |
|---------------|------------|
| No phases planned | `$maestro-brainstorm` or `$maestro-plan` |
| Phase planned, not executed | `$maestro-execute "<N>"` |
| Phase executed, not reviewed | `$quality-review "<N>"` |
| Phase reviewed PASS/WARN | `$quality-test "<N>"` |
| UAT passed | `$maestro-milestone-audit` |
| All milestone phases done | `$maestro-milestone-audit` |
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized -- run `$maestro-init` first |
| E002 | fatal | `state.json` missing or corrupt |
</error_codes>

<success_criteria>
- [ ] `.workflow/` and `state.json` validated
- [ ] All state sources loaded (state.json, roadmap, phase indexes, task files)
- [ ] Progress calculated per phase (total, completed, failed, blocked, pending, percentage)
- [ ] Dashboard rendered with milestones, phases, active work, and next steps
- [ ] Next step suggestion matches current project state via decision table
</success_criteria>
