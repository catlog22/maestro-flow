<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: fork

## Step 1: Parse Arguments and Flags

```
Timestamps use UTC+8 ISO format throughout.

Parse from $ARGUMENTS:
  --session <id>  → sessionId (session_id or intent slug)
  --sync          → syncMode (sync existing worktree instead of forking)
  --base <ref>    → baseBranch (default: HEAD)
```

---

## Step 2: Validate Prerequisites

```
Require: .workflow/state.json (E001).
Require: state.json.sessions[] non-empty (E005).
Require: sessionId provided (E004).
Reject: .workflow/worktree-scope.json present (E003 — cannot fork from inside a worktree).

Read projectState from state.json, config from config.json (defaults if missing).
worktreeRoot = config.worktree?.root ?? ".worktrees"
branchPrefix = config.worktree?.branch_prefix ?? "session/"
```

---

## Step 3: Resolve Session

```
Lookup sessionEntry from projectState.sessions[] by:
  1. Exact match on session_id == sessionId, OR
  2. Intent slug match (kebab-case of intent) == sessionId.
E006 if no match (list available sessions with id + intent + status).

Extract: sessionId (.session_id), sessionIntent (.intent), sessionStatus (.status),
         sessionDeps (.depends_on ?? []).
sessionSlug = kebab-case derived from session_id (strip YYYYMMDD- prefix if present), max 40 chars.
```

---

## Step 4: Sync Mode (--sync)

If `syncMode` is true, treat as sync operation on existing worktree, not a fork.

```
IF syncMode:
  Find active worktree entry for sessionId in worktrees.json → E007 if not found.
  Git merge main into worktree → warn and exit on conflict.
  Re-copy shared context: project.md, config.json (if exists), specs/ (if exists).
  Display sync confirmation. EXIT.
```

---

## Step 5: Validate & Confirm

```
Reject if session already has active worktree in worktrees.json (E008).

Display session info:
  Session:   {sessionId}
  Intent:    {sessionIntent}
  Status:    {sessionStatus}
  Depends:   {sessionDeps.join(', ') || 'none'}

Confirm with user → exit if declined.
```

---

## Step 6: Create Worktree

```
forkSessionId = "fork-{UTC8_compact_timestamp}"
baseCommit = git rev-parse HEAD
branch = {branchPrefix}{sessionSlug}
wtPath = {worktreeRoot}/{sessionSlug}

6a: Clean up stale worktree/branch at wtPath if exists (ignore errors).
6b: git worktree add -b {branch} {wtPath} {baseBranch}
6c: mkdir -p {wtPath}/.workflow/sessions/{sessionId}/runs

6d: Copy shared context → wtPath/.workflow/:
    project.md, config.json (if exists), specs/ (if exists)

6e: Copy session artifacts — entire .workflow/sessions/{sessionId}/ directory
    (session.json, artifacts.json, runs/, context.md, etc.).
    Update copied session.json: set lifecycle.forked_from = main worktree path.

6f: Copy dependency session artifacts — for each dep in sessionDeps,
    copy .workflow/sessions/{dep}/ (read-only reference for upstream context).
```

Write `{wtPath}/.workflow/worktree-scope.json`:

```json
{
  "worktree": true,
  "session_id": "{sessionId}",
  "session_intent": "{sessionIntent}",
  "main_worktree": "{resolve(cwd)}",
  "branch": "{branch}",
  "base_commit": "{baseCommit}",
  "created_at": "{UTC8_ISO}"
}
```

```
6g: Write scoped state.json — clone mainState with active_session_id set to sessionId,
    sessions filtered to this session + its depends_on entries only.
```

---

## Step 7: Update Main Registry

```
Load or initialize .workflow/worktrees.json (default: { version:"1.0", worktrees:[], fork_sessions:[] }).

Append to worktrees[]:
  { session_id, session_intent, slug:sessionSlug, branch, path:wtPath, base_commit,
    status:"active", created_at, fork_session:forkSessionId }

Append to fork_sessions[]:
  { session_id:forkSessionId, created_at, target_session_id:sessionId,
    target_session_intent:sessionIntent, base_branch, base_commit }

Write worktrees.json. Update mainState.last_updated, write state.json.
```

---

## Step 8: Display Summary

```
Display:
  === FORK COMPLETE ===
  Fork ID:    {forkSessionId}
  Base:       {baseBranch} ({baseCommit.substring(0, 7)})
  Session:    {sessionId} — {sessionIntent}
  Branch:     {branch}
  Path:       {wtPath}
  Depends on: {sessionDeps.join(', ') || 'none'}

  Next steps (run in the worktree):
    cd {wtPath}

    # Continue session lifecycle:
    maestro run next --session {sessionId} --actor {actorId} --expected-orchestration-revision {orchestrationRevision} --json

  Or delegate (automated):
    maestro delegate "run full lifecycle for session" --cd {wtPath} --mode write

  Sync worktree with main (REQUIRED before merge):
    /maestro-fork --session {sessionId} --sync

  When session completes:
    /maestro-merge --session {sessionId}
```
