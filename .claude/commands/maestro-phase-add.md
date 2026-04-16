---
name: maestro-phase-add
description: Add or insert a new phase into the project roadmap with automatic renumbering
argument-hint: "<slug> <title> [--after N]"
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
Add a new phase to the project roadmap, either appending it at the end or inserting it after a specified phase number. Handles automatic renumbering of subsequent phase directories, updates roadmap.md with the new entry, and initializes the phase directory with an index.json so it is ready for planning.
</purpose>

<required_reading>
@~/.maestro/workflows/phase-add.md
</required_reading>

<deferred_reading>
- [index.json](~/.maestro/templates/index.json) — read when creating new phase index
</deferred_reading>

<context>
$ARGUMENTS -- phase slug and title (required), optional --after N flag.

**Flags:**
- `--after N` -- Insert after phase N (renumbers subsequent phases). If omitted, appends at end.

**State files:**
- `.workflow/roadmap.md` -- milestone and phase structure
- `.workflow/state.json` -- project-level state
- `.workflow/phases/` -- existing phase directories
</context>

<execution>
Follow '~/.maestro/workflows/phase-add.md' completely.

**Next-step routing on completion:**
- Plan the new phase → Skill({ skill: "maestro-plan", args: "{new_phase_number}" })
- Analyze before planning → Skill({ skill: "maestro-analyze", args: "{new_phase_number}" })
- View updated roadmap → Skill({ skill: "manage-status" })
</execution>

<error_codes>
| Code | Meaning                          |
|------|----------------------------------|
| E001 | Phase name/slug required         |
| E002 | roadmap.md not found             |
| E003 | Duplicate phase name/slug exists |
</error_codes>

<success_criteria>
- [ ] Phase directory created with NN-slug format
- [ ] roadmap.md updated with new phase entry at correct position
- [ ] index.json initialized in new phase directory with status = "pending"
- [ ] Subsequent phases renumbered correctly (if --after N used)
- [ ] state.json updated if renumbering affected tracked phases
</success_criteria>
