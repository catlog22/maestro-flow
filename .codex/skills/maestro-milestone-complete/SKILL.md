---
name: maestro-milestone-complete
description: Archive completed milestone scratch artifacts to milestones/ dir, move artifact entries to milestone_history, extract learnings, advance state.
argument-hint: "[milestone] [--force] [-y]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Sequential milestone archival: validate audit → archive scratch dirs → extract learnings → move artifact entries to milestone_history → advance state → clean scratch.
</purpose>

<context>

```bash
$maestro-milestone-complete "M1"
$maestro-milestone-complete              # uses current_milestone from state.json
$maestro-milestone-complete --force "M1"  # skip audit check
```

**Output**: `.workflow/milestones/{milestone}/` archive directory

</context>

<invariants>
1. **Audit before archive** — refuse without passing audit (unless --force)
2. **Atomic state update** — write state.json via tmp+rename
3. **Learnings are mandatory** — always extract before archiving
4. **Clean after archive** — remove scratch dirs only after successful copy
5. **Advance state** — always set next milestone or mark project complete
</invariants>

<execution>

### Step 1: Parse & Validate

Read `.workflow/state.json` for `current_milestone`, `artifacts[]`, `milestones[]`. Determine target from args or current_milestone (E001 if none). Validate audit report at `.workflow/milestones/{milestone}/audit-report.md` with PASS verdict (E002 unless `--force`). Verify all milestone artifacts completed (E003 unless `--force`).

### Step 2: Archive Scratch Dirs

Copy each milestone artifact's directory to `.workflow/milestones/{milestone}/artifacts/`. Snapshot `roadmap.md` as `roadmap-snapshot.md` in the milestone archive.

### Step 3: Extract Learnings

Read `.summaries/` and `reflection-log.md` from execute artifacts. Extract patterns, pitfalls, strategy adjustments. Dedup against existing entries via `maestro spec load --category learning`. Append to `.workflow/specs/learnings.md` using `<spec-entry>` closed-tag format (category=`learning`, auto-extract keywords, date=today, source=`milestone-complete`).

### Step 3b: Knowledge Promotion Inquiry

1. **High-frequency patterns**: Scan learning entries for keyword overlap (>=2 entries) -- offer promotion to coding convention via `/spec-add coding`
2. **Convention drift**: Compare summaries against `coding-conventions.md` and `architecture-constraints.md` -- ask if conventions need updating
3. **Wiki island check**: Auto-trigger `wiki-connect --fix` to link new knowledge

If `-y`: auto-accept all promotions without asking.
If not `-y`: ask user for confirmation. If user confirms, append `<spec-entry>` to target category file preserving original date and source.

### Step 4: Archive Artifact Entries

Move milestone artifacts from `state.json.artifacts[]` to `milestone_history[]` with completion metadata (id, name, status, completed_at, archive_path, archived_artifacts). Remove from active `artifacts[]`.

### Step 5: Advance State

Set `current_milestone` to next pending milestone (mark it active), or set project `status: "completed"` if none remain. Atomic write to `state.json`.

### Step 6: Clean Scratch

Remove archived artifact directories from `.workflow/`.

### Step 7: Generate Summary & Report

Write `.workflow/milestones/{milestone}/summary.md` with outcomes and learnings. Update `.workflow/project.md` Context section. Display completion report with next steps: `$maestro-milestone-release`, `$maestro-analyze`, `$manage-status`, `$manage-wiki health`, `$wiki-digest`.

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Milestone identifier required | Specify milestone |
| E002 | error | Audit not passed | Run milestone-audit first |
| E003 | error | Incomplete artifacts remain | Complete work first |

</error_codes>

<success_criteria>
- [ ] Audit report validated (or --force used)
- [ ] Scratch directories archived to milestones/
- [ ] Learnings extracted and appended to specs/learnings.md
- [ ] Artifact entries moved to milestone_history in state.json
- [ ] State advanced to next milestone (or project marked complete)
- [ ] Scratch directories cleaned
- [ ] Summary and completion report generated
</success_criteria>
