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
Audit milestone completion using the artifact registry. Checks:
1. Phase coverage — every phase in roadmap has plan + execute artifacts (completed)
2. Ad-hoc completeness — all adhoc artifacts are completed (or explicitly skipped)
3. Execution completeness — all tasks in executed plans are completed
4. Cross-artifact integration — interfaces, data contracts, configuration consistency

Data source: `state.json.artifacts[]` filtered by current milestone.
Produces audit report at `.workflow/milestones/{milestone}/audit-report.md`.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-audit.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** All phases in the milestone should have completed execute artifacts.

**Data source:**
- `.workflow/state.json` — artifacts[], current_milestone, milestones[]
- `.workflow/roadmap.md` — milestone-to-phase mapping
- Plan scratch dirs — for task status verification
</context>

<execution>
Follow '~/.maestro/workflows/milestone-audit.md' completely.

**Audit checklist (from architecture):**
1. Phase coverage: each phase in roadmap has analyze → plan → execute chain
2. Ad-hoc completeness: all adhoc artifacts completed or skipped
3. Execution completeness: all tasks in executed plans completed
4. Cross-artifact integration: interface compatibility, data contracts, config consistency

**Next-step routing on completion:**
- Verdict PASS → `/maestro-milestone-complete {milestone}`
- Verdict FAIL, integration gaps → `/maestro-plan --gaps`
- Verdict FAIL, incomplete execution → `/maestro-execute`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments format |
| E002 | error | Milestone not found in state.json | Check milestone ID |
| E003 | error | No execute artifacts found for milestone | Run maestro-execute first |
| W001 | warning | Some phases lack complete artifact chains | Review incomplete phases |
</error_codes>

<success_criteria>
- [ ] All phases in milestone identified from roadmap
- [ ] Artifact chains verified (ANL→PLN→EXC) per phase
- [ ] Ad-hoc artifacts checked for completion
- [ ] Integration check completed (shared interfaces, data contracts)
- [ ] Audit report written with clear PASS/FAIL verdict
- [ ] Next-step routing provided
</success_criteria>
