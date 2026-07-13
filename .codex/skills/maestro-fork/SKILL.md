---
name: maestro-fork
description: Create or sync session worktree for parallel dev
argument-hint: --session <session_id> [--base <branch>] [--sync]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.6.0
---

<purpose>
Create a git worktree for a session, enabling inter-session parallel development.
The worktree scope is session-level — all Run artifacts for that session are owned by
the worktree. Since `.workflow/` is gitignored, this command explicitly copies project context
and session Run artifacts into the worktree.

Also supports `--sync` mode to pull latest main into an active worktree.
</purpose>

<required_reading>
@~/.maestro/workflows/fork.md
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<deferred_reading>
- [worktrees.json](~/.maestro/templates/worktrees.json) — read when initializing or updating worktree registry
- [worktree-scope.json](~/.maestro/templates/worktree-scope.json) — read when creating worktree scope marker
</deferred_reading>

<context>
$ARGUMENTS — session ID (or intent slug) and optional flags.

**Modes:**
| Mode | Trigger | Behavior |
|------|---------|----------|
| Fork | `--session auth-setup` | Create worktree for session auth-setup |
| Sync | `--session auth-setup --sync` | Sync existing worktree with main |

**Flags:**
- `--session <id>`: Session ID or intent slug (resolved from `state.json.sessions[]`)
- `--base <branch>`: Override base branch (default: HEAD)
- `--sync`: Pull main into existing worktree, re-copy shared artifacts

**Worktree layout:**
```
.worktrees/s-{slug}/
├── .workflow/
│   ├── worktree-scope.json     (session scope marker)
│   ├── state.json              (project metadata only)
│   ├── project.md, config.json, specs/  (read-only copies)
│   └── sessions/               (canonical Session/Run records)
└── <source code>
```

**Artifact scoping:**
Fork copies canonical Session/Run records for the target session. New work creates Runs normally; runtime-owned Session registries remain authoritative.
</context>

<execution>
Follow '~/.maestro/workflows/fork.md' completely.

**Fork flow:**
1. Validate: initialized, sessions exist, not inside worktree, session not already forked
2. Resolve session: match `--session` arg against `state.json.sessions[]` by `session_id` or intent slug
3. Create worktree: `git worktree add -b session/{slug} .worktrees/s-{slug} {base_branch}` (where `base_branch` = `--base` flag value or `HEAD` if not specified)
4. Copy `.workflow/`: shared files + session Run artifacts
5. Write `worktree-scope.json` with session scope
6. Write scoped project metadata and copy required canonical Session/Run records
7. Update main: `worktrees.json` registry, record `session.json.lifecycle.forked_from`

**Sync flow:**
1. Find worktree from `worktrees.json`
2. Resolve sync source: use `--base <branch>` if provided, else use `base_branch` from `fork_sessions[]` entry, else default to `main`
3. `cd worktree && git merge {base_branch}`
4. Re-copy shared files (project.md, config.json, specs/)

**Registry: `worktrees.json`** (`.workflow/worktrees.json` in main worktree):

Initialize if not exists: `{ "version": "1.0", "worktrees": [], "fork_sessions": [] }`

On fork, append to `worktrees[]`:
```json
{
  "session_id": "{sessionId}",
  "intent": "{sessionIntent}",
  "slug": "{sessionSlug}",
  "branch": "session/{sessionSlug}",
  "path": "{worktreeRoot}/s-{sessionSlug}",
  "base_commit": "{baseCommit}",
  "status": "active",
  "created_at": "{UTC8_ISO}",
  "fork_session": "{forkSessionId}"
}
```

Append to `fork_sessions[]`:
```json
{
  "session_id": "fork-{UTC8_compact_timestamp}",
  "created_at": "{UTC8_ISO}",
  "target_session_id": "{sessionId}",
  "intent": "{sessionIntent}",
  "base_branch": "{baseBranch}",
  "base_commit": "{baseCommit}"
}
```

**Scope marker: `worktree-scope.json`** (`{wtPath}/.workflow/worktree-scope.json`):
```json
{
  "worktree": true,
  "session_id": "{sessionId}",
  "intent": "{sessionIntent}",
  "depends_on": ["{dependencySessionIds}"],
  "main_worktree": "{resolve(cwd)}",
  "branch": "session/{sessionSlug}",
  "base_commit": "{baseCommit}",
  "created_at": "{UTC8_ISO}"
}
```

Presence of `worktree-scope.json` signals "inside a worktree" — used by E003 validation to prevent nested forks.

**Next steps:**
- Fork → `cd {wt.path} && $maestro-analyze`
- Sync → resume work in worktree
</execution>

<invariants>
**Artifact verification** — worktree-scope.json, scoped state.json, and worktrees.json registry update MUST all complete. If any missing: DO NOT report completion.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Project not initialized | Run maestro-init |
| E002 | error | No roadmap/sessions found | Run maestro-roadmap |
| E003 | error | Running inside a worktree | Run from main worktree |
| E004 | error | No session ID provided | Provide `--session <id>` |
| E006 | error | Session not found in state.json.sessions[] | Check available sessions |
| E008 | error | Session already has active worktree | Merge or cleanup first |
</error_codes>

<success_criteria>
Fork mode:
- [ ] Session resolved from state.json.sessions[]
- [ ] Git worktree created with branch `session/{slug}`
- [ ] Shared `.workflow/` files copied (project.md, config.json, specs/)
- [ ] Session Run artifacts copied (filtered from artifact registry)
- [ ] `worktree-scope.json` written with session scope
- [ ] Scoped project metadata and Session/Run records written
- [ ] `worktrees.json` registry updated in main worktree
- [ ] Session lifecycle recorded (`session.json.lifecycle.forked_from`)

Sync mode:
- [ ] Git merge main into worktree branch
- [ ] Shared artifacts re-copied
- [ ] Conflicts reported if any
</success_criteria>
