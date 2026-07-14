---
name: maestro-fork
description: Create or sync session worktree for parallel dev
argument-hint: "--session <session_id> [--base <branch>] [--sync]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<purpose>
Create or sync a session-level git worktree for parallel development.
Supports `--sync` mode to pull latest main changes into an active worktree.
</purpose>

<deferred_reading>
- [worktrees.json](~/.maestro/templates/worktrees.json) — read when updating registry
- [worktree-scope.json](~/.maestro/templates/worktree-scope.json) — read when writing scope marker
</deferred_reading>

<context>
$ARGUMENTS -- session ID (or slug) and optional flags.

Modes (`Fork` / `Sync`), flags (`--session`, `--base`, `--sync`), session resolution, worktree layout, and artifact scoping are defined in workflow `fork.md`.
</context>

<execution>
Follow '~/.maestro/workflows/fork.md' completely.

Fork and sync algorithm steps are defined in workflow `fork.md`.

### Gates (MANDATORY, BLOCKING)

**Fork mode:**

**GATE 1: Validation → Worktree Creation**
- REQUIRED: Session resolved from `state.json.sessions[]` by session_id or intent slug.
- REQUIRED: No existing active worktree for this session (E008).
- REQUIRED: Not running inside a worktree (E003).
- BLOCKED if: session not found (E006), already forked (E008), or running inside worktree (E003).

**GATE 2: Worktree Creation → Artifact Copy**
- REQUIRED: Git worktree created with branch (`session/{slug}`).
- REQUIRED: Shared `.workflow/` files copied (project.md, config.json, specs/).
- BLOCKED if missing: worktree creation failed or shared files not copied — do not proceed to artifact scoping.

**GATE 3: Artifact Copy → Completion**
- REQUIRED: AskUserQuestion confirmation before registry writes — show session scope, worktree path, and state entries to be written. User must confirm or abort.
- REQUIRED: `worktree-scope.json` written with session scope (after confirmation).
- REQUIRED: Scoped `state.json` written (only this session's data) (after confirmation).
- REQUIRED: `worktrees.json` registry updated in main worktree (after confirmation).
- BLOCKED if missing: scope marker, scoped state, or registry update absent — worktree is unusable without these.

**Sync mode:**

**GATE: Sync → Completion**
- REQUIRED: Git merge main into worktree branch completed.
- REQUIRED: Shared artifacts re-copied.
- BLOCKED if: merge has unresolved conflicts or shared artifacts failed to copy.

</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Fork complete | `cd {wt.path}` then step `analyze` (`maestro run prepare analyze` + `maestro run create analyze`) |
| Fork + automated | `maestro delegate "run full lifecycle for session" --cd {wt.path} --mode write` |
| Fork + status check | Skill({ skill: "manage", args: "status" }) |
| Sync complete | Resume work in worktree |
| Sync conflicts found | Resolve manually, then retry |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Project not initialized | Run maestro-init first |
| E002 | error | No roadmap found | Run step `roadmap` first (`maestro run prepare roadmap` + `maestro run create roadmap`) |
| E003 | error | Running inside a worktree | Run from main worktree |
| E004 | error | No session ID provided | Provide `--session <session_id>` |
| E005 | error | No sessions defined in state.json | Run step `roadmap` first (`maestro run prepare roadmap` + `maestro run create roadmap`) |
| E006 | error | Session not found in state.json.sessions[] | Check available sessions |
| E007 | error | No active worktree for session (--sync) | Check worktrees.json |
| E008 | error | Session already has active worktree | Merge or cleanup first |
</error_codes>

<success_criteria>
Fork mode:
- [ ] Session resolved from state.json.sessions[]
- [ ] Git worktree created with branch (`session/{slug}`)
- [ ] Shared `.workflow/` files copied (project.md, config.json, specs/)
- [ ] Session Run artifacts copied (filtered from artifact registry)
- [ ] `worktree-scope.json` written with session scope
- [ ] Scoped `state.json` written (only this session's data)
- [ ] `worktrees.json` registry updated in main worktree
- [ ] Session lifecycle recorded (`session.json.lifecycle.forked_from`)
- [ ] Summary displayed with next-step commands

Sync mode:
- [ ] Git merge main into worktree branch
- [ ] Shared artifacts re-copied (project.md, config.json, specs/)
- [ ] Conflicts reported if any
</success_criteria>
