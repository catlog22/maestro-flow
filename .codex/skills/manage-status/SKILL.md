---
name: manage-status
description: Display project dashboard with phase progress, active tasks, and next steps
argument-hint: ""
allowed-tools: Read, Bash, Glob, Grep
---

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
- `.workflow/phases/*/index.json` — per-phase metadata and progress
- `.workflow/phases/*/.task/TASK-*.json` — individual task statuses
</context>

<execution>

### Step 1: Validate Project

```bash
# Verify .workflow/ exists
test -d .workflow || exit 1  # E001: not initialized
test -f .workflow/state.json || exit 1  # E002: state missing
```

### Step 2: Load State Files

Read all state sources:
- `.workflow/state.json` -- project-level state machine
- `.workflow/roadmap.md` -- milestone and phase structure
- `.workflow/phases/*/index.json` -- per-phase metadata and progress
- `.workflow/phases/*/.task/TASK-*.json` -- individual task statuses

### Step 3: Calculate Progress

For each phase directory found:
1. Count total tasks, completed, failed, blocked, pending
2. Calculate completion percentage
3. Determine phase status from index.json

### Step 4: Render Dashboard

Display formatted output:

```
=== PROJECT DASHBOARD ===
Project: {name} | Status: {state}

--- Milestones & Phases ---
{For each milestone}
  M{N}: {title}
  {For each phase}
    Phase {N}: {title} [{status}] {progress_bar} {completed}/{total} ({pct}%)

--- Active Work ---
Phase {N}: {title}
  In-progress: {list}
  Blocked: {list}

--- Next Steps ---
Based on current state: {suggestion with Skill() reference}
```

### Step 5: Suggest Next Steps

Use this decision table to suggest the next action:

| Current State | Suggestion |
|---------------|------------|
| No phases planned | `Skill({ skill: "maestro-brainstorm" })` or `Skill({ skill: "maestro-plan" })` |
| Phase planned, not executed | `Skill({ skill: "maestro-execute", args: "<N>" })` |
| Phase executed, not verified | `Skill({ skill: "maestro-verify", args: "<N>" })` |
| Phase verified with gaps | `Skill({ skill: "maestro-plan", args: "<N> --gaps" })` |
| Phase reviewed PASS/WARN | `Skill({ skill: "quality-test", args: "<N>" })` |
| UAT passed | `Skill({ skill: "maestro-phase-transition" })` |
| All milestone phases done | `Skill({ skill: "maestro-milestone-audit" })` |
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized -- run `Skill({ skill: "maestro-init" })` first |
| E002 | fatal | `state.json` missing or corrupt |
</error_codes>

<success_criteria>
- [ ] `.workflow/` and `state.json` validated
- [ ] All state sources loaded (state.json, roadmap, phase indexes, task files)
- [ ] Progress calculated per phase (total, completed, failed, blocked, pending, percentage)
- [ ] Dashboard rendered with milestones, phases, active work, and next steps
- [ ] Next step suggestion matches current project state via decision table
</success_criteria>
