# Workflow: fork

Create a git worktree for an entire milestone, enabling inter-milestone parallel development. Copies `.workflow/` context into the worktree since `.workflow/` is gitignored.

Worktrees operate at the **milestone level** — all phases within a milestone are owned by one worktree and executed sequentially inside it. Per-phase parallelism within a milestone is not supported.

---

## Step 1: Parse Arguments and Flags

```
Timestamps use UTC+8 ISO format throughout.

Parse from $ARGUMENTS:
  --sync          → syncMode (sync existing worktree instead of forking)
  --base <ref>    → baseBranch (default: HEAD)
  -m <N> or bare <N> → milestoneNum (1-based)
```

---

## Step 2: Validate Prerequisites

```
Require: .workflow/state.json (E001), .workflow/roadmap.md (E002), milestoneNum (E004).
Reject: .workflow/worktree-scope.json present (E003 — cannot fork from inside a worktree).

Read projectState from state.json, config from config.json (defaults if missing).
worktreeRoot = config.worktree?.root ?? ".worktrees"
branchPrefix = config.worktree?.branch_prefix ?? "milestone/"
```

---

## Step 3: Resolve Milestone

```
Lookup milestoneEntry from projectState.milestones[milestoneNum - 1] (1-based).
E005 if no milestones array; E006 if index out of range (list available milestones).

Extract: milestoneName (.name), milestoneTitle (.title), milestonePhases (.phases).
milestoneSlug = kebab-case of milestoneName, max 40 chars.
```

---

## Step 4: Sync Mode (--sync)

If `syncMode` is true, this is a sync operation on an existing worktree, not a fork.

```
IF syncMode:
  Find active worktree entry for milestoneNum in worktrees.json → E007 if not found.
  Git merge main into worktree → warn and exit on conflict.
  Re-copy shared context: project.md, roadmap.md, config.json (if exists), specs/ (if exists).
  Display sync confirmation. EXIT.
```

---

## Step 5: Validate & Confirm

```
Derive phase statuses from artifact registry (execute artifacts → completed/in_progress/pending).
Reject if all phases completed (nothing to fork).
Reject if milestone already has active worktree (E008).

Display milestone info and phase list with statuses.
Confirm with user → exit if declined.
```

---

## Step 6: Create Worktree

```
forkSessionId = "fork-{UTC8_compact_timestamp}"
baseCommit = git rev-parse HEAD
branch = {branchPrefix}{milestoneSlug}
wtPath = {worktreeRoot}/m{milestoneNum}-{milestoneSlug}

6a: Clean up stale worktree/branch at wtPath if exists (ignore errors).
6b: git worktree add -b {branch} {wtPath} {baseBranch}
6c: mkdir -p {wtPath}/.workflow/scratch

6d: Copy shared context → wtPath/.workflow/:
    project.md, roadmap.md, config.json (if exists), specs/ (if exists)

6e: Copy milestone artifacts — all artifacts matching milestoneName.
6f: Copy dependency artifacts — phases from milestoneEntry.depends_on not in owned phases.

6g: Build phase_dependencies map (external deps per owned phase).
```

Write `{wtPath}/.workflow/worktree-scope.json`:

```json
{
  "worktree": true,
  "milestone_num": "{milestoneNum}",
  "milestone": "{milestoneName}",
  "owned_phases": ["{ownedPhaseNumbers}"],
  "phase_dependencies": "{phaseDeps}",
  "main_worktree": "{resolve(cwd)}",
  "branch": "{branch}",
  "base_commit": "{baseCommit}",
  "created_at": "{UTC8_ISO}"
}
```

```
6i: Write scoped state.json — clone mainState with current_milestone set,
    artifacts filtered to milestone-owned phases only.
```

---

## Step 7: Update Main Registry

```
Load or initialize .workflow/worktrees.json (default: { version:"1.0", worktrees:[], fork_sessions:[] }).

Append to worktrees[]:
  { milestone_num, milestone, slug, branch, path:wtPath, base_commit, status:"active",
    created_at, owned_phases, fork_session:forkSessionId }

Append to fork_sessions[]:
  { session_id:forkSessionId, created_at, milestone_num, milestone, base_branch, base_commit }

Write worktrees.json. Update mainState.last_updated, write state.json.
Note: worktrees.json owned_phases tracks forked state — no per-phase marking needed.
```

---

## Step 8: Display Summary

```
Display:
  === FORK COMPLETE ===
  Session:    {forkSessionId}
  Base:       {baseBranch} ({baseCommit.substring(0, 7)})
  Milestone:  M{milestoneNum} — {milestoneName} ({milestoneTitle})
  Branch:     {branch}
  Path:       {wtPath}
  Phases:     {ownedPhaseNumbers.join(', ')}

  Next steps (run in the worktree):
    cd {wtPath}

    # Sequential lifecycle for each phase:
    /maestro-analyze {firstPending.phase}
    /maestro-plan {firstPending.phase}
    /maestro-execute {firstPending.phase}
    /maestro-verify {firstPending.phase}
    # ... repeat for next phases in milestone

  Or delegate (automated):
    maestro delegate "run full lifecycle for milestone" --cd {wtPath} --mode write

  Sync worktree with main (if needed later):
    /maestro-fork -m {milestoneNum} --sync

  When all phases in milestone complete:
    /maestro-merge -m {milestoneNum}
```
