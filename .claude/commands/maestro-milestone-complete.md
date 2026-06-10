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
Mark a milestone as complete after its audit has passed. Performs 6-step archival:
validation → directory archival → artifact history → knowhow extraction → state advancement → cleanup.

Produces `milestones/{M}/artifacts/` archive and `specs/learnings.md` knowhow entries.
Supports two milestone types: standard (advances to next milestone) and adhoc (self-contained, sets idle).

Pipeline position: downstream of `maestro-milestone-audit` (requires PASS verdict). Upstream of `maestro-milestone-release` (cut a release) or next milestone planning (`maestro-analyze` / `maestro-plan`).
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-complete.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when updating milestone_history and advancing state
</deferred_reading>

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

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Validation → Archival**
- REQUIRED: Audit report verified as PASS (E002 if not).
- REQUIRED: No incomplete artifacts remain (E003 if any).

**GATE 2: Archival → Knowhow Extraction**
- REQUIRED: Scratch artifacts moved to `milestones/{M}/artifacts/`.
- REQUIRED: Artifact entries archived to milestone_history in state.json.

**GATE 3: Knowhow Extraction → State Advancement**
- REQUIRED: Knowhow extraction attempted (may produce 0 entries — W001).
- REQUIRED: `project.md` Context updated with milestone summary.

**GATE 4: State Advancement → Completion**
- REQUIRED: state.json updated — next milestone as current (standard) or current_milestone=null (adhoc).
- REQUIRED: Roadmap snapshot saved (standard only).

### Knowledge Promotion Inquiry

After knowhow extraction (step 4), scan `learnings.md` for promotion candidates:

1. **High-frequency pattern detection**: Scan all `<spec-entry>` entries with `roles="implement"` for keyword overlap (≥2 entries sharing keywords):
   → Ask: "Keyword '{keyword}' appears in {N} knowhow entries. Should this be promoted to a formal coding convention? (`/spec-add coding`)"

2. **Convention drift detection**: Compare executed task summaries against `coding-conventions.md` and `architecture-constraints.md`:
   → Ask: "Were any established conventions bypassed during this milestone? Should conventions be updated?"

3. **Wiki island check**: Auto-trigger `manage-wiki connect --fix` to link newly extracted knowledge.

If user confirms promotion, invoke `Skill({ skill: "spec-add", args: "<category> <content>" })` with promoted content, preserving original date and source traceability.

**Adhoc milestone (D-008):** When completing an adhoc milestone, skip roadmap snapshot and do not advance to next milestone. Set `current_milestone = null`, `status = "idle"`. Adhoc milestones are self-contained — no successor in roadmap chain.
</execution>

<completion>
### Standalone report

```
=== MILESTONE COMPLETE ===
Milestone: {milestone_id}
Status: ARCHIVED
Artifacts archived: {count}
Knowhow extracted: {count} entries
Next milestone: {next_id | "none (adhoc)"}
==============================
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Cut a release | `/maestro-milestone-release` |
| Next milestone (standard) | `/maestro-analyze` or `/maestro-plan 1` |
| View state | `/manage-status` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments |
| E002 | error | Audit not passed | Run maestro-milestone-audit first |
| E003 | error | Incomplete artifacts remain | Complete remaining work first |
| W001 | warning | Knowhow extraction produced 0 entries | Review milestone work for missed learnings |
| W002 | warning | Wiki-connect found unlinked knowledge islands | Run `/manage-wiki --fix` manually |
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
