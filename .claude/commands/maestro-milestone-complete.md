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
Mark a milestone as complete after its audit has passed. Archives all scratch artifacts to `milestones/{M}/artifacts/`, moves artifact entries from `state.json.artifacts[]` to `milestone_history`, extracts final learnings, and advances to the next milestone.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-complete.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** `/maestro-milestone-audit` should have passed.

**State files:**
- `.workflow/state.json` — artifacts[], milestones[], current_milestone, milestone_history[]
- `.workflow/roadmap.md` — milestone structure
- `.workflow/milestones/{milestone}/audit-report.md` — audit results
</context>

<execution>
Follow '~/.maestro/workflows/milestone-complete.md' completely.

**Archive flow:**
1. Validate audit passed + all artifacts completed
2. Move scratch dirs to `milestones/{M}/artifacts/`
3. Move artifact entries to `milestone_history[M].archived_artifacts`
4. Extract learnings from summaries → `specs/learnings.md`
5. Update state.json: advance to next milestone, clear artifacts[]
6. Clean scratch dirs

**Next-step routing on completion:**
- Cut a release → `/maestro-milestone-release`
- Next milestone → `/maestro-analyze` or `/maestro-plan 1`
- View state → `/manage-status`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments |
| E002 | error | Audit not passed | Run maestro-milestone-audit first |
| E003 | error | Incomplete artifacts remain | Complete remaining work first |
</error_codes>

<success_criteria>
- [ ] Audit report verified as PASS
- [ ] Scratch artifacts moved to milestones/{M}/artifacts/
- [ ] Artifact entries archived to milestone_history
- [ ] Learnings extracted to specs/learnings.md
- [ ] state.json updated: next milestone as current, artifacts[] cleared
- [ ] Roadmap snapshot saved
- [ ] project.md Context updated with milestone summary
</success_criteria>
