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
Archive passed milestone: validate, archive artifacts, extract knowhow, advance state.
Requires audit PASS; produces milestone archive and learnings.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-complete.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when updating milestone_history and advancing state
</deferred_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).
If $ARGUMENTS is empty AND current_milestone is null → raise E001 with message "No milestone specified and no current_milestone set in state.json. Provide a milestone identifier as argument."

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
- BLOCKED if: audit not passed (E002) or incomplete artifacts remain (E003) — cannot archive unvalidated milestone.

**GATE 2: Archival → Knowhow Extraction**
- REQUIRED: Scratch artifacts moved to `milestones/{M}/artifacts/`.
- REQUIRED: Artifact entries archived to milestone_history in state.json.
- BLOCKED if missing: artifacts not moved or history not updated — knowhow extraction needs archived artifacts as input.

**GATE 3: Knowhow Extraction → State Advancement**
- REQUIRED: Knowhow extraction attempted (may produce 0 entries — W001).
- REQUIRED: `project.md` Context updated with milestone summary.
- BLOCKED if missing: knowhow extraction not attempted or project.md not updated — state advancement requires completed knowledge capture.

**GATE 4: State Advancement → Completion**
- REQUIRED: AskUserQuestion confirmation before state.json advancement — show current milestone, next milestone (or null for adhoc), and artifacts to clear. User must confirm or abort.
- REQUIRED: state.json updated — next milestone as current (standard) or current_milestone=null (adhoc) (after confirmation).
- REQUIRED: Roadmap snapshot saved (standard only).
- BLOCKED if missing: state.json not advanced — project remains stuck on completed milestone.

### Knowledge Promotion Inquiry

After knowhow extraction (step 4), scan `learnings.md` for promotion candidates:

1. **High-frequency pattern detection**: Scan all `<spec-entry>` entries with `roles="implement"` for keyword overlap (≥2 entries sharing keywords):
   → Ask: "Keyword '{keyword}' appears in {N} knowhow entries. Should this be promoted to a formal coding convention? (`/spec-add coding`)"

2. **Convention drift detection**: Compare executed task summaries against `coding-conventions.md` and `architecture-constraints.md`:
   → Ask: "Were any established conventions bypassed during this milestone? Should conventions be updated?"

3. **Wiki island check**: AskUserQuestion "Run wiki-connect --fix to link newly extracted knowledge?" — execute `manage-wiki connect --fix` only if user confirms.

Each promotion candidate requires explicit user confirmation via AskUserQuestion before writing:
- **"Promote"** → invoke `Skill({ skill: "spec-add", args: "<category> <content>" })` with promoted content, preserving original date and source traceability.
- **"Skip"** → do not promote this candidate; proceed to next.
- **"Skip all"** → skip remaining candidates.

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
| Next milestone (standard) | `/maestro-analyze {next_milestone}` or `/maestro-plan {next_milestone}` |
| View state | `/manage-status` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments |
| E002 | error | Audit not passed | Run maestro-milestone-audit first |
| E003 | error | Incomplete artifacts remain | Complete remaining work first |
| W001 | warning | Knowhow extraction produced 0 entries | Review milestone work for missed learnings |
| W002 | warning | Wiki-connect found unlinked knowledge islands | Run `manage-wiki connect --fix` manually |
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
