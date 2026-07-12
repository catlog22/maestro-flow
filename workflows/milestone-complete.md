<!-- session-mode: deprecated -->
# Workflow: milestone-complete

## Deprecated Workflow Boundary

This workflow is retained only for migration documentation. Entry commands MUST route to the Session/Run replacement and stop; do not execute the legacy writes below.

## Step 1: Validation

1. Read `.workflow/state.json`:
   - Determine target milestone (from $ARGUMENTS or current_milestone)
   - If no milestone: ERROR E001
   - Resolve milestone object from `milestones[]` by id
   - Determine milestone type: `milestone_obj.type` (default `"standard"` if field missing)

2. Check milestone audit status:
   - Read `.workflow/milestones/{milestone}/audit-report.md` if exists
   - If no audit report:
     - ERROR E004: "No audit report found. Audit is a required hard contract — cannot complete without it."
     - Guidance: "Run `/maestro-milestone-audit` first, then re-run this command."
     - Exit (skipping audit is not permitted)
   - If verdict is FAIL: ERROR E002

3. Verify all milestone artifacts have status "completed" → ERROR E003 if any incomplete (list ids and statuses)

---

## Step 2: Create Milestone Archive

1. Create archive directory:
   ```
   mkdir -p .workflow/milestones/{milestone}/artifacts/
   ```

2. Snapshot roadmap:
   - **Standard milestone**: `cp .workflow/roadmap.md .workflow/milestones/{milestone}/roadmap-snapshot.md`
   - **Adhoc milestone**: Skip roadmap snapshot (roadmap may not exist)

3. Archive scratch directories: copy each milestone artifact's `.workflow/{artifact.path}` to `.workflow/milestones/{milestone}/artifacts/{basename}/`. After each copy:

   a. If the destination contains `archive.json` with `lifecycle.status == "sealed"`:
      - Set `lifecycle.status = "archived"`
      - Set `lifecycle.archived_at = now`
      - Set `lifecycle.linked_milestone = {milestone}` if currently null

   b. If the destination contains `context-package.json`, prune it (scheme C — non-destructive):
      - Read full content as `orig`
      - Compute `pruned` = {
          `open_questions`: items without `answer` and without `resolved_in`,
          `constraints`: items where `status == "open"`,
          `insights`: items beyond index 20 (keep top 20 by source order),
          `references`: items whose `path` does not exist on disk (relative to session dir)
        }
      - If any `pruned.*` is non-empty:
        - Write `{session_dir}/context-package.pruned.json` containing the dropped items
        - Rewrite `context-package.json` keeping only:
          `open_questions` answered/resolved, `constraints` status=locked, `insights[0..20]`, `references` whose paths exist; all other top-level fields unchanged
        - Update `archive.json.pruned = { "at": now, "counts": { open_questions, constraints, insights, references }, "ref": "context-package.pruned.json" }`
      - Otherwise leave both files untouched and set `archive.json.pruned = { "at": now, "counts": {...zeros}, "ref": null }`

   c. If the session dir lacks `archive.json` (legacy session prior to lifecycle convention), skip (a) and (b); log W0xx "legacy session not indexed"; flag archive as [LOW CONFIDENCE] (lifecycle.indexed=false, legacy session).

---

## Step 2.5: Load Existing Learnings

```
existing_learnings = maestro spec load --category coding
```

Check existing entries to avoid duplicates when appending in Step 3.

---

## Step 3: Extract Learnings

1. For each execute artifact, read `.summaries/` and `reflection-log.md` if exists:
   - Extract strategy adjustments
   - Extract patterns discovered
   - Extract pitfalls encountered

2. Aggregate learnings and append to `.workflow/specs/learnings.md` using `<spec-entry>` closed-tag format. Each entry (strategy adjustment, pattern, or pitfall) follows this template:
   ```
   <spec-entry category="learning" keywords="{auto-extracted}" date="{YYYY-MM-DD}" source="milestone-complete">

   ### {summary}

   {content}
   Milestone: {milestone}

   </spec-entry>
   ```

   **Keyword extraction**: Extract 3-5 domain-specific terms from the content (same rules as `spec-add`).

---

## Step 4: Update State

1. Archive artifact entries to milestone_history:
   ```json
   {
     "milestone_history": [
       {
         "id": "{milestone}",
         "name": "{milestone_name}",
         "status": "completed",
         "completed_at": "{now}",
         "archive_path": "milestones/{milestone}/",
         "archived_artifacts": [ ...all milestone artifacts entries... ]
       }
     ]
   }
   ```

2. Clear artifacts array: remove all entries where `milestone == target_milestone`

3. Advance to next milestone:
   - **Standard milestone**: activate first pending milestone → set as `current_milestone`. If none pending → set `current_milestone = null`, `status = "completed"`
   - **Adhoc milestone**: Do NOT search for next milestone. Set `current_milestone = null`, `status = "idle"` (adhoc milestones are self-contained, no successor)

4. Write state.json (atomic)

---

## Step 5: Clean Scratch

Remove archived scratch directories: delete `.workflow/{artifact.path}` for each archived artifact.

---

## Step 6: Generate Summary

Write `.workflow/milestones/{milestone}/summary.md`:
```markdown
# Milestone: {milestone} — {name}

**Completed**: {date}
**Artifacts**: {count} (analyze: {n}, plan: {n}, execute: {n}, verify: {n})

## Key Outcomes
{extracted from audit report + learnings}

## Learnings
{top patterns and pitfalls}

## Next Milestone
{next milestone name and first phase, or "Project complete"}
```

Update `.workflow/project.md` Context section with milestone summary.

---

## Step 7: Report

```
=== MILESTONE COMPLETE ===
Milestone: {milestone} ({name})
Artifacts: {count} archived
Learnings: {learnings_count} extracted

Archive: .workflow/milestones/{milestone}/
Next:    {next_milestone or "Project complete" or "Ad-hoc task complete"}

Next steps:
  /maestro-milestone-release    -- Cut a release
  /maestro-analyze              -- Start next milestone (standard only)
  /manage-status                -- View project state
```
