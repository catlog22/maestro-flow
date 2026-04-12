# Workflow: milestone-complete

Archive completed milestone and prepare for next.

---

## Step 1: Validation

1. Read `.workflow/state.json`:
   - Determine target milestone (from $ARGUMENTS or current_milestone)

2. Check milestone audit status:
   - Read `.workflow/milestones/{milestone}/audit-report.md` if exists
   - If no audit report exists:
     - WARN: "No audit report found. Run `/workflow:milestone-audit` first."
     - Ask user: "Complete without audit?"
     - If NO → exit with route to `/workflow:milestone-audit`

3. Verify all phases are completed:
   ```
   For each phase in milestone:
     Read phases/{NN}-{slug}/index.json
     if status != "completed":
       ERROR: "Phase {NN} ({title}) is not completed (status: {status})"
       Route: /workflow:execute {NN} or /workflow:verify {NN}
       EXIT
   ```

---

## Step 2: Create Milestone Archive

1. Create archive directory:
   ```
   mkdir -p .workflow/milestones/v{X.Y}/phases/
   ```

2. Snapshot roadmap:
   ```
   cp .workflow/roadmap.md .workflow/milestones/v{X.Y}/roadmap-snapshot.md
   ```

3. Archive phase directories:
   ```
   For each phase in milestone:
     cp -r .workflow/phases/{NN}-{slug}/ .workflow/milestones/v{X.Y}/phases/{NN}-{slug}/
   ```

4. Audit report:
   - Report already exists at `.workflow/milestones/{milestone}/audit-report.md` (written by milestone-audit)
   - No copy needed; verify file is present in archive directory

---

## Step 2.5: Load Existing Learnings

```
existing_learnings = maestro spec load --category general
```

Check existing entries to avoid duplicates when appending in Step 3.

---

## Step 3: Extract Learnings

1. For each phase in milestone, read `reflection-log.md` if exists:
   - Extract strategy adjustments
   - Extract patterns discovered
   - Extract pitfalls encountered

2. Aggregate learnings and append to `.workflow/specs/learnings.md` under "## Entries", using spec-add entry format for each item:
   ```
   For each strategy adjustment:
     ### [YYYY-MM-DD HH:mm] decision: {summary}

     {content}
     Milestone: {milestone} | Source: milestone-complete

   For each pattern discovered:
     ### [YYYY-MM-DD HH:mm] pattern: {summary}

     {content}
     Milestone: {milestone} | Source: milestone-complete

   For each pitfall encountered:
     ### [YYYY-MM-DD HH:mm] bug: {summary}

     {content}
     Milestone: {milestone} | Source: milestone-complete
   ```

---

## Step 3.5: Update project.md Context

```
Read .workflow/project.md

a. Append milestone summary to "## Context" section:
   - Milestone version, completion date
   - Key learnings summary (top 3 from Step 3 aggregated learnings)
   - Significant strategy adjustments that affect future work

   Format:
     **Milestone {milestone} ({date})**: {1-2 sentence summary of what was accomplished
     and key insights that inform future work.}

b. Update "Last updated" footer timestamp

Write updated project.md
Display: "project.md: Context updated with milestone {milestone} summary"
```

---

## Step 4: Update State

1. Read existing `.workflow/state.json` to preserve accumulated values.

2. Determine next milestone from roadmap (read BEFORE any delete):
   ```
   a. Read .workflow/roadmap.md
   b. Scan for all milestone headings (e.g. ## Milestone: vX.Y, ## v1.0, etc.)
   c. Locate the current milestone heading in the list
   d. next_milestone = the milestone heading immediately after current
      (If no next milestone exists in roadmap, next_milestone = null)
   e. If next_milestone is not null:
        Scan for phases belonging to next_milestone
        next_phase_count = count of phases in next milestone
      Else:
        next_phase_count = 0
   ```

3. Calculate updated phases_summary (derived pending):
   ```
   new_phases_summary = {
     "total": next_phase_count,
     "completed": 0,
     "in_progress": 0,
     "pending": next_phase_count - 0 - 0  // total - completed - in_progress
   }
   ```

4. Clean up completed phase directories:
   - Remove `.workflow/phases/{NN}-{slug}/` for archived phases
   - Keep `.workflow/phases/` directory (empty, ready for new milestone)

5. Remove stale roadmap:
   - Delete `.workflow/roadmap.md` (already archived as `milestones/v{X.Y}/roadmap-snapshot.md`)
   - This creates a clear "no roadmap" state that the maestro coordinator detects for next-milestone routing

6. Update milestone_history entry for completed milestone:
   ```
   FOR each entry IN existing_state.milestone_history:
     IF entry.name == completed_milestone OR entry.slug == completed_milestone:
       entry.status = "completed"
       entry.completed_at = "{timestamp}"
       entry.archive_path = ".workflow/milestones/{completed_milestone}/"
       BREAK
   ```

7. Record milestone transition in history:
   ```
   Append to state.transition_history[] (create array if absent):
     {
       "type": "milestone",
       "from_phase": null,
       "to_phase": null,
       "milestone": completed_milestone,
       "transitioned_at": "{timestamp}",
       "trigger": "milestone-complete",
       "force": was --force used (boolean),
       "snapshot": {
         "phases_completed": phases in this milestone,
         "phases_total": existing_state.phases_summary.total,
         "deferred_count": existing_state.accumulated_context.deferred.length,
         "verification_status": "completed",
         "learnings_count": retrospective learnings count (from Step 3)
       }
     }
   ```

8. Write updated `.workflow/state.json`:
   ```json
   // If next_milestone exists:
   {
     "current_milestone": "{next_milestone}",
     "current_phase": 1,
     "status": "idle",
     "phases_summary": new_phases_summary,
     "accumulated_context": existing_state.accumulated_context,
     "milestone_history": existing_state.milestone_history,
     "last_updated": "{timestamp}"
   }

   // If next_milestone is null (project complete):
   {
     "current_milestone": "{completed_milestone}",
     "current_phase": null,
     "status": "completed",
     "phases_summary": new_phases_summary,
     "accumulated_context": existing_state.accumulated_context,
     "milestone_history": existing_state.milestone_history,
     "last_updated": "{timestamp}"
   }
   ```
   Preserve `accumulated_context` and `milestone_history` -- decisions, deferred items, and milestone history carry forward.

---

## Step 5: Commit and Route

1. If git repo: commit with message `"chore: complete milestone {milestone}"`

2. Display completion summary:
   ```
   ====================================================
     MILESTONE COMPLETED: {milestone}
   ====================================================

   Archived:
     - {N} phases archived to .workflow/milestones/v{X.Y}/
     - Roadmap snapshot saved
     - Audit report archived
     - {M} learnings extracted to specs/learnings.md

   State reset:
     - Current milestone: {next_milestone or completed_milestone}
     - Current phase: {1 or null}
     - Status: {idle or completed}

   ====================================================
   ```

3. Route next steps:
   - If next_milestone exists:
     - Ask user: "Start planning next milestone?"
       - YES → Suggest Skill({ skill: "maestro", args: "continue" }) — coordinator auto-detects post-milestone state, loads deferred items from accumulated_context, and routes to roadmap creation
       - NO → "Project is idle." Suggest Skill({ skill: "manage-status" }) to check state anytime.
   - If next_milestone is null (project complete):
     - Display: "All milestones completed. Project is done."
     - Suggest Skill({ skill: "manage-status" }) to review final state.
