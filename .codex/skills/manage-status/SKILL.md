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
- `.workflow/scratch/*/index.json` — per-phase metadata and progress (resolved via state.json artifact registry)
- `.workflow/scratch/*/.task/TASK-*.json` — individual task statuses (resolved via state.json artifact registry)
- `.workflow/wiki-index.json` — unified wiki graph index (entry counts, health)
</context>

<execution>

### Step 1: Validate Project

Verify `.workflow/` exists (E001) and `state.json` is present (E002).

### Step 2: Load State Files

Read: `state.json`, `roadmap.md`, per-phase `scratch/*/index.json`, task files `scratch/*/.task/TASK-*.json` (all resolved via artifact registry).

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
| No phases planned | `Skill({ skill: "maestro-brainstorm" })` or `Skill({ skill: "maestro-plan" })` |
| Phase planned, not executed | `Skill({ skill: "maestro-execute", args: "<N>" })` |
| Phase executed, not verified | `Skill({ skill: "maestro-verify", args: "<N>" })` |
| Phase verified with gaps | `Skill({ skill: "maestro-plan", args: "<N> --gaps" })` |
| Phase reviewed PASS/WARN | `Skill({ skill: "quality-test", args: "<N>" })` |
| UAT passed | `Skill({ skill: "maestro-milestone-audit" })` |
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
