---
name: maestro-phase-transition
description: Mark current or specified phase as complete, extract learnings, advance to next phase
argument-hint: "[phase-number] [--force]"
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
Transition from one phase to the next after verification passes. Validates that the current phase meets all completion criteria (tasks done, verification passed, no unresolved gaps), marks it complete in the phase index, and advances the project state to the next phase. If the next phase directory does not exist, it is created and initialized.
</purpose>

<required_reading>
@~/.maestro/workflows/phase-transition.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when updating project state
- [index.json](~/.maestro/templates/index.json) — read when updating phase index
</deferred_reading>

<context>
$ARGUMENTS -- phase number to transition from (optional, defaults to current_phase from state.json).

**Flags:**
- `--force` -- Skip gap check and force transition even with warnings

**State files:**
- `.workflow/state.json` -- project-level state (current_phase, milestones)
- `.workflow/phases/{NN}-{slug}/index.json` -- phase metadata and status
- `.workflow/phases/{NN}-{slug}/verification.json` -- verification results
- `.workflow/phases/{NN}-{slug}/review.json` -- code review results (if exists)
</context>

<execution>
Follow '~/.maestro/workflows/phase-transition.md' completely.

**Next-step routing on completion:**
- Next phase exists, ready to plan → Skill({ skill: "maestro-plan", args: "{next_phase}" })
- Next phase needs analysis first → Skill({ skill: "maestro-analyze", args: "{next_phase}" })
- Next phase needs UI design → Skill({ skill: "maestro-ui-design", args: "{next_phase}" })
- All phases in milestone complete → Skill({ skill: "maestro-milestone-audit" })
- View updated dashboard → Skill({ skill: "manage-status" })
</execution>

<error_codes>
| Code | Meaning                                    |
|------|--------------------------------------------|
| E001 | Phase number required (could not determine) |
| E002 | Phase has not passed verification           |
| E003 | Phase has unresolved critical gaps          |
| W001 | Phase has warnings but no blockers          |
| W002 | UAT test failures exist (quality-test) — review recommended before transition |
| W003 | Code review verdict is BLOCK — Skill({ skill: "quality-review" }) findings should be fixed first |
| W004 | Code review not yet run — Skill({ skill: "quality-review" }) recommended before transition |
| W005 | Orphan specs found in wiki — consider linking or removing before transition |
</error_codes>

<success_criteria>
- [ ] Current phase index.json marked status = "complete" with completed_at timestamp
- [ ] Next phase directory created (if not already existing)
- [ ] Next phase index.json initialized with status = "pending"
- [ ] state.json current_phase updated to next phase number
- [ ] Wiki health score reported — warnings emitted if orphan specs found
- [ ] Learnings extracted and appended to specs/learnings.md
- [ ] project.md requirements moved Active → Validated for completed phase
- [ ] roadmap.md phase marked as ✅ COMPLETED
</success_criteria>
