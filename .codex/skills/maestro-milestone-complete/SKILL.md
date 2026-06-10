---
name: maestro-milestone-complete
description: Archive completed milestone and prepare for next
argument-hint: "[milestone] [--force] [-y]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
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
6. **Prerequisite enforcement** — audit report MUST be verified as PASS before archival proceeds. Artifact verification: milestones/{M}/artifacts/ directory, milestone_history in state.json, project.md update all MUST exist before reporting completion.
</invariants>

<execution>

### Step 1: Parse & Validate

Read `.workflow/state.json` for `current_milestone`, `artifacts[]`, `milestones[]`. Determine target from args or current_milestone (E001 if none).

Validate audit report at `.workflow/milestones/{milestone}/audit-report.md`:
- Parse for `## Verdict` section (or `**Verdict:**` inline)
- PASS condition: verdict line contains the word `PASS` (case-insensitive)
- Any other verdict (FAIL, PARTIAL, missing section) → E002 unless `--force`

Verify all milestone artifacts completed (E003 unless `--force`).

### Step 2: Archive Scratch Dirs

Copy each milestone artifact's directory to `.workflow/milestones/{milestone}/artifacts/`.

**Source path resolution**: For each entry in `state.json.artifacts[]`, resolve the source directory from `artifact.path`:
- If `artifact.path` is relative (e.g. `scratch/M1-auth`), resolve from `.workflow/` (→ `.workflow/scratch/M1-auth`)
- If `artifact.path` is absolute, use as-is
- Copy the entire resolved directory to `.workflow/milestones/{milestone}/artifacts/{artifact.name}/`

**After each copy** (per archived session dir):

a. If destination contains `archive.json` with `lifecycle.status == "sealed"`:
   - Set `lifecycle.status = "archived"`, `lifecycle.archived_at = now`, `lifecycle.linked_milestone = {milestone}` (if null).

b. If destination contains `context-package.json`, prune (scheme C — non-destructive):
   - Compute `pruned` = { `open_questions` without answer/resolved_in; `constraints` status=open; `insights` beyond top 20; `references` whose path does not exist on disk }
   - If any `pruned.*` non-empty: write `context-package.pruned.json` with the dropped items; rewrite `context-package.json` keeping only answered/resolved questions, locked constraints, `insights[0..20]`, valid-path references; update `archive.json.pruned = { at: now, counts, ref: "context-package.pruned.json" }`
   - Otherwise: set `archive.json.pruned = { at: now, counts: zeros, ref: null }`

c. If session dir lacks `archive.json` (legacy): skip a+b silently — legacy sessions are not indexed.

Snapshot `roadmap.md` as `roadmap-snapshot.md` in the milestone archive.

### Step 3: Extract Learnings

**Source files** (read in order):
1. `.workflow/milestones/{milestone}/artifacts/**/.summaries/*.md` — task completion summaries
2. `.workflow/milestones/{milestone}/artifacts/**/reflection-log.md` — retrospective entries

**Extraction**: Parse each source for patterns, pitfalls, strategy adjustments. Look for recurring themes across summaries and explicit lessons in reflection logs.

**Dedup**: Run `maestro spec load --category coding` to load existing entries. Skip any extracted learning whose keywords fully overlap with an existing entry.

**Write**: Append to `.workflow/specs/learnings.md` using `<spec-entry>` closed-tag format:
```
<spec-entry category="learning" keywords="kw1, kw2" date="YYYY-MM-DD" title="{title}" description="{one-line summary}" source="milestone-complete:{milestone}">

### {title}

Learning content here.

</spec-entry>
```

### Step 3b: Knowledge Promotion Inquiry

1. **High-frequency patterns**: Scan all `<spec-entry category="learning">` entries for keyword overlap. Trigger threshold: **>=2 entries sharing the same keyword**. For each triggered keyword, ask: "Keyword '{keyword}' appears in {N} learning entries. Promote to formal coding convention?"
2. **Convention drift**: Compare executed task summaries against `coding-conventions.md` and `architecture-constraints.md`. Trigger threshold: **any deviation found** (technique used but not documented, or documented convention not followed). Ask: "Convention '{convention}' was bypassed during this milestone. Update conventions?"
3. **Wiki island check**: Auto-trigger `wiki-connect --fix` to link new knowledge. Trigger threshold: **always runs** (no user confirmation needed).

If `-y`: auto-accept all promotions without asking.
If not `-y`: ask user for confirmation via `request_user_input`:
```json
{ "questions": [{ "id": "promote_learning", "header": "Knowledge Promotion", "question": "Keyword '{keyword}' appears in {N} learning entries. Promote to coding convention?", "options": [{ "label": "Yes, promote (Recommended)", "description": "Add as formal coding convention via spec-add" }, { "label": "No, keep as learning", "description": "Leave in learnings.md without promotion" }] }] }
```
If user confirms, append `<spec-entry>` to target category file preserving original date and source.

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
