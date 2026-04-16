---
name: maestro-milestone-complete
description: Archive completed milestone and prepare for next
argument-hint: "[<milestone>]"
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
Mark a milestone as complete after its audit has passed. Validates that the audit report exists and shows a passing verdict, archives the milestone by updating state.json, generates a milestone summary document capturing key outcomes and learnings, and prepares the project state for the next milestone.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-complete.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** Skill({ skill: "maestro-milestone-audit" }) should have passed (all phases completed, no integration gaps).

**State files:**
- `.workflow/state.json` -- current_milestone, milestones array
- `.workflow/roadmap.md` -- milestone structure
- `.workflow/milestones/{milestone}/audit-report.md` -- audit results
</context>

<execution>
Follow '~/.maestro/workflows/milestone-complete.md' completely.

**Next-step routing on completion:**
- Cut a release for this milestone → Skill({ skill: "maestro-milestone-release" })
- Next milestone has phases → Skill({ skill: "maestro-plan", args: "{next_milestone_first_phase}" })
- Need to capture learnings → Skill({ skill: "manage-memory-capture", args: "compact" })
- View updated project state → Skill({ skill: "manage-status" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments format, re-run with correct input |
| E002 | error | Audit not passed (report missing or verdict FAIL) | Run maestro-milestone-audit first |
| E003 | error | Incomplete phases remain in this milestone | Complete remaining phases before milestone completion |
</error_codes>

<success_criteria>
- [ ] Audit report verified as PASS before proceeding
- [ ] Milestone marked complete in state.json with timestamp
- [ ] Milestone summary generated with outcomes and learnings
- [ ] Roadmap snapshot saved to milestones directory
- [ ] project.md Context updated with milestone summary and key learnings
- [ ] state.json updated with next milestone as current
</success_criteria>
