# Workflow: merge

Two-phase merge of a completed milestone worktree branch back into main. Phase 1: git merge (source code). Phase 2: artifact sync (workflow state). Artifact sync only proceeds after successful git merge.

Merges operate at the **milestone level** — one worktree per milestone, all phases merged together.

---

## Step 1: Parse Arguments and Flags

```
Timestamps use UTC+8 ISO format throughout.

Parse from $ARGUMENTS:
  --force       → force (skip incomplete-phase confirmation)
  --dry-run     → dryRun (preview only)
  --no-cleanup  → noCleanup (keep worktree after merge)
  --continue    → continueMode (resume after conflict resolution)
  -m <N> or bare <N> → milestoneNum (1-based)
```

---

## Step 2: Validate Context

```
Reject: .workflow/worktree-scope.json present (E001 — must run from main worktree).
Require: .workflow/worktrees.json (E002 — nothing to merge without registry).
Read registry from worktrees.json.
```

---

## Step 3: Registry Health Check

```
Detect worktree entries whose directories no longer exist.
If stale entries found → warn (W001), remove from registry, rewrite worktrees.json.
```

---

## Step 4: Resolve Merge Target

```
--continue → load target from .workflow/.merge-state.json (E003 if missing), skip to Step 7.
Otherwise → find active worktree for milestoneNum in registry (E004 if no milestone specified).
If no matching target → display active worktrees and exit.
```

---

## Step 5: Validate Readiness

```
Check phase completeness via worktree artifact registry (execute artifacts → completed or incomplete).
If incomplete phases and not --force → warn (W002), confirm with user.
If --dry-run → display merge preview (branch, milestone, completed/incomplete phases) and exit.
```

---

## Step 6: Phase 1 — Git Merge

```
6a: Pull main into worktree branch (cd {target.path} && git merge main --no-edit).
    On conflict → warn (W003), instruct to resolve in worktree, exit.

6b: Merge worktree branch into main (git merge {target.branch} --no-ff).
    On conflict → save .workflow/.merge-state.json {target, phase:"git_merge_conflict"},
    instruct: resolve, git merge --continue, then /maestro-merge --continue. Exit.

Display "Git merge successful."
```

---

## Step 7: Phase 2 — Artifact Sync

```
Step_7:

7a: Copy milestone artifact directories from worktree → main .workflow/.
    Filter: artifacts matching target.milestone or target.owned_phases.

7b: Merge artifact registries — update existing by ID, append new entries.

7c: Record in mainState.transition_history:
    { milestone_num, milestone, action:"worktree_merge", completed_at, branch, phases }

7d: Merge accumulated_context — deduplicate key_decisions, append deferred items.

Update mainState.last_updated, write .workflow/state.json.

7e: Mark completed phases in .workflow/roadmap.md with completion indicator.
```

---

## Step 8: Cleanup

```
Unless --no-cleanup: remove git worktree and delete branch.
Remove target entry from worktrees.json registry.
Clean up .workflow/.merge-state.json if present.
```

---

## Step 9: Summary

```
Display:
  === MERGE COMPLETE ===
  Milestone:  M{target.milestone_num} — {target.milestone}
  Branch:     {target.branch}
  Phases:     {target.owned_phases.join(', ')}
  Completed:  {completedPhases.length}/{target.owned_phases.length}

  State:   .workflow/state.json updated
  Roadmap: .workflow/roadmap.md updated

  Next steps:
    Skill({ skill: "manage-status" })          -- View dashboard
    Skill({ skill: "maestro-milestone-audit" }) -- Audit merged milestone
```
