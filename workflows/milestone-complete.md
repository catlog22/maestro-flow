# Workflow: milestone-complete

Archive completed milestone, move artifacts to history, and prepare for next.

---

## Step 1: Validation

1. Read `.workflow/state.json`:
   - Determine target milestone (from $ARGUMENTS or current_milestone)
   - If no milestone: ERROR E001

2. Check milestone audit status:
   - Read `.workflow/milestones/{milestone}/audit-report.md` if exists
   - If no audit report:
     - WARN: "No audit report found. Run `/maestro-milestone-audit` first."
     - Ask user: "Complete without audit?"
     - If NO → exit
   - If verdict is FAIL: ERROR E002

3. Verify all artifacts completed:
   ```
   milestone_artifacts = state.json.artifacts.filter(a => a.milestone == target_milestone)
   incomplete = milestone_artifacts.filter(a => a.status != "completed")
   IF incomplete.length > 0:
     ERROR E003: "Incomplete artifacts: {list ids and statuses}"
   ```

---

## Step 2: Create Milestone Archive

1. Create archive directory:
   ```
   mkdir -p .workflow/milestones/{milestone}/artifacts/
   ```

2. Snapshot roadmap:
   ```
   cp .workflow/roadmap.md .workflow/milestones/{milestone}/roadmap-snapshot.md
   ```

3. Archive scratch directories:
   ```
   FOR each artifact IN milestone_artifacts:
     IF directory exists at .workflow/{artifact.path}:
       cp -r .workflow/{artifact.path} .workflow/milestones/{milestone}/artifacts/{basename}/
   ```

---

## Step 2.5: Load Existing Learnings

```
existing_learnings = maestro spec load --category learning
```

Check existing entries to avoid duplicates when appending in Step 3.

---

## Step 3: Extract Learnings

1. For each execute artifact, read `.summaries/` and `reflection-log.md` if exists:
   - Extract strategy adjustments
   - Extract patterns discovered
   - Extract pitfalls encountered

2. Aggregate learnings and append to `.workflow/specs/learnings.md`:
   ```
   For each strategy adjustment:
     ### [YYYY-MM-DD HH:mm] decision: {summary}
     {content}
     Milestone: {milestone} | Source: milestone-complete

   For each pattern:
     ### [YYYY-MM-DD HH:mm] pattern: {summary}
     {content}
     Milestone: {milestone} | Source: milestone-complete

   For each pitfall:
     ### [YYYY-MM-DD HH:mm] bug: {summary}
     {content}
     Milestone: {milestone} | Source: milestone-complete
   ```

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

2. Clear artifacts array (remove milestone-affiliated entries):
   ```
   state.json.artifacts = state.json.artifacts.filter(a => a.milestone != target_milestone)
   ```

3. Advance to next milestone:
   ```
   next_milestone = state.json.milestones.find(m => m.status == "pending")
   IF next_milestone:
     state.json.current_milestone = next_milestone.id
     next_milestone.status = "active"
   ELSE:
     state.json.current_milestone = null
     state.json.status = "completed"
   ```

4. Write state.json (atomic)

---

## Step 5: Clean Scratch

Remove archived scratch directories:
```
FOR each artifact IN archived_artifacts:
  IF directory exists at .workflow/{artifact.path}:
    rm -rf .workflow/{artifact.path}
```

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
Next:    {next_milestone or "Project complete"}

Next steps:
  /maestro-milestone-release    -- Cut a release
  /maestro-analyze              -- Start next milestone
  /manage-status                -- View project state
```
