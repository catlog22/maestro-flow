---
name: maestro-milestone-complete
description: Archive completed milestone and prepare for next
argument-hint: [<milestone>]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - run_command
  - send_message
  - view_file
  - write_to_file
---

<purpose>
Mark a milestone as complete after its audit has passed. Archives all scratch artifacts to `milestones/{M}/artifacts/`, moves artifact entries from `state.json.artifacts[]` to `milestone_history`, extracts final knowhow, and advances to the next milestone.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-complete.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** `/maestro-milestone-audit` should have passed.

**State files:**
- `.workflow/state.json` — artifacts[], milestones[] (with `type` field: `"standard"` | `"adhoc"`), current_milestone, milestone_history[]
- `.workflow/roadmap.md` — milestone structure (standard milestones only; adhoc milestones may not have roadmap)
- `.workflow/milestones/{milestone}/audit-report.md` — audit results
</context>

<execution>
Follow '~/.maestro/workflows/milestone-complete.md' completely.

Archive flow steps (validation, directory archival, artifact history, knowhow extraction, state advancement, cleanup) are defined in workflow `milestone-complete.md`.

### Knowledge Promotion Inquiry

After knowhow extraction (step 4), scan `learnings.md` for promotion candidates:

1. **High-frequency pattern detection**: Scan all `<spec-entry>` entries with `roles="implement"` for keyword overlap (≥2 entries sharing keywords):
   → Ask: "Keyword '{keyword}' appears in {N} knowhow entries. Should this be promoted to a formal coding convention? (`/spec-add coding`)"

2. **Convention drift detection**: Compare executed task summaries against `coding-conventions.md` and `architecture-constraints.md`:
   → Ask: "Were any established conventions bypassed during this milestone? Should conventions be updated?"

3. **Wiki island check**: Auto-trigger `wiki-connect --fix` to link newly extracted knowledge.

If user confirms promotion, invoke `view_file(AbsolutePath="<agy-skills-dir>/spec-add/SKILL.md") + execute inline (args: "<category> <content>")` with promoted content, preserving original date and source traceability.

**Next-step routing on completion:**
- Cut a release → `/maestro-milestone-release`
- Next milestone → `/maestro-analyze` or `/maestro-plan 1` (standard milestones only)
- View state → `/manage-status`

**Adhoc milestone (D-008):** When completing an adhoc milestone, skip roadmap snapshot and do not advance to next milestone. Set `current_milestone = null`, `status = "idle"`. Adhoc milestones are self-contained — no successor in roadmap chain.
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
- [ ] Knowhow extracted to specs/learnings.md
- [ ] state.json updated: next milestone as current (standard) or current_milestone=null (adhoc), artifacts[] cleared
- [ ] Roadmap snapshot saved (standard only; adhoc skips)
- [ ] project.md Context updated with milestone summary
</success_criteria>
