---
name: maestro-milestone-audit
description: Audit current milestone for cross-phase integration gaps
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
Audit milestone completion with cross-phase integration checks. Identifies which phases belong to the milestone, spawns a workflow-integration-checker agent to validate that all phases work together correctly (shared interfaces, data contracts, dependency chains), and produces an audit report with gap analysis and fix suggestions.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-audit.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** All phases in the milestone should be completed or verifying.

**State files:**
- `.workflow/state.json` -- current_milestone, phases_completed
- `.workflow/roadmap.md` -- milestone-to-phase mapping
- `.workflow/phases/{NN}-{slug}/index.json` -- phase metadata per phase
- `.workflow/phases/{NN}-{slug}/verification.json` -- phase verification results
</context>

<execution>
Follow '~/.maestro/workflows/milestone-audit.md' completely.

**Next-step routing on completion:**
- Verdict PASS → Skill({ skill: "maestro-milestone-complete", args: "{milestone}" })
- Verdict FAIL, integration gaps → Skill({ skill: "maestro-plan", args: "{affected_phase} --gaps" })
- Verdict FAIL, incomplete phases → Skill({ skill: "maestro-execute", args: "{incomplete_phase}" })
- Gaps fixed, need re-audit → Skill({ skill: "maestro-milestone-audit", args: "{milestone}" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments format, re-run with correct input |
| E002 | error | Milestone not found in roadmap | Check arguments format, re-run with correct input |
| E003 | error | Phases incomplete for this milestone | Complete remaining phases before audit |
| W001 | warning | Phase lacks completed_at — may not have been formally transitioned | Run phase-transition for the phase first |
</error_codes>

<success_criteria>
- [ ] All phases in milestone identified and status checked
- [ ] Integration check completed via workflow-integration-checker agent
- [ ] Audit report written with gap analysis and fix suggestions
- [ ] Cross-phase integration issues identified and categorized
- [ ] Clear verdict (PASS/FAIL) with next-step routing
</success_criteria>
