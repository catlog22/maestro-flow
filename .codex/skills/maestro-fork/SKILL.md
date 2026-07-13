---
name: maestro-fork
description: Create or sync milestone worktree for parallel dev
argument-hint: -m <milestone-number> [--base <branch>] [--sync]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
version: 0.5.50
---

<purpose>
Create a git worktree for an entire milestone, enabling inter-milestone parallel development.
The worktree scope is milestone-level — all Run artifacts for that milestone are owned by
the worktree. Since `.workflow/` is gitignored, this command explicitly copies project context
and milestone Run artifacts into the worktree.

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
$ARGUMENTS — milestone number and optional flags.

**Modes:**
| Mode | Trigger | Behavior |
|------|---------|----------|
| Fork | `-m 2` or `2` | Create worktree for milestone 2 |
| Sync | `-m 2 --sync` | Sync existing worktree with main |

**Flags:**
- `-m <N>` or bare `<N>`: Milestone number
- `--base <branch>`: Override base branch (default: HEAD)
- `--sync`: Pull main into existing worktree, re-copy shared artifacts

**Worktree layout:**
```
.worktrees/m{N}-{slug}/
├── .workflow/
│   ├── worktree-scope.json     (milestone scope marker)
│   ├── state.json              (project metadata only)
│   ├── project.md, roadmap.md, config.json, specs/  (read-only copies)
│   └── sessions/               (canonical Session/Run records)
└── <source code>
```

**Artifact scoping:**
Fork copies canonical Session/Run records needed by the target milestone. New work creates Runs normally; runtime-owned Session registries remain authoritative.
</context>

<execution>
Follow '~/.maestro/workflows/fork.md' completely.

**Fork flow:**
1. Validate: initialized, roadmap exists, not inside worktree, milestone not forked
2. Resolve milestone: `state.json.milestones[N-1]`
3. Create worktree: `git worktree add -b milestone/{slug} .worktrees/m{N}-{slug} {base_branch}` (where `base_branch` = `--base` flag value or `HEAD` if not specified)
4. Copy `.workflow/`: shared files + milestone Run artifacts
5. Write `worktree-scope.json` with milestone scope
6. Write scoped project metadata and copy required canonical Session/Run records
7. Update main: `worktrees.json` registry, mark milestone `"forked"`

**Sync flow:**
1. Find worktree from `worktrees.json`
2. Resolve sync source: use `--base <branch>` if provided, else use `base_branch` from `fork_sessions[]` entry, else default to `main`
3. `cd worktree && git merge {base_branch}`
4. Re-copy shared files (project.md, roadmap.md, config.json, specs/)

**Registry: `worktrees.json`** (`.workflow/worktrees.json` in main worktree):

Initialize if not exists: `{ "version": "1.0", "worktrees": [], "fork_sessions": [] }`

On fork, append to `worktrees[]`:
```json
{
  "milestone_num": "{milestoneNum}",
  "milestone": "{milestoneName}",
  "slug": "{milestoneSlug}",
  "branch": "milestone/{milestoneSlug}",
  "path": "{worktreeRoot}/m{milestoneNum}-{milestoneSlug}",
  "base_commit": "{baseCommit}",
  "status": "active",
  "created_at": "{UTC8_ISO}",
  "owned_phases": ["{ownedPhaseNumbers}"],
  "fork_session": "{forkSessionId}"
}
```

Append to `fork_sessions[]`:
```json
{
  "session_id": "fork-{UTC8_compact_timestamp}",
  "created_at": "{UTC8_ISO}",
  "milestone_num": "{milestoneNum}",
  "milestone": "{milestoneName}",
  "base_branch": "{baseBranch}",
  "base_commit": "{baseCommit}"
}
```

**Scope marker: `worktree-scope.json`** (`{wtPath}/.workflow/worktree-scope.json`):
```json
{
  "worktree": true,
  "milestone_num": "{milestoneNum}",
  "milestone": "{milestoneName}",
  "owned_phases": ["{ownedPhaseNumbers}"],
  "phase_dependencies": "{phaseDeps}",
  "main_worktree": "{resolve(cwd)}",
  "branch": "milestone/{milestoneSlug}",
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
| E002 | error | No roadmap found | Run maestro-roadmap |
| E003 | error | Running inside a worktree | Run from main worktree |
| E004 | error | No milestone number | Provide `-m <N>` |
| E006 | error | Milestone out of range | Check available milestones |
| E008 | error | Milestone already has active worktree | Merge or cleanup first |
</error_codes>

<success_criteria>
Fork mode:
- [ ] Milestone resolved from state.json.milestones[]
- [ ] Git worktree created with branch `milestone/{slug}`
- [ ] Shared `.workflow/` files copied (project.md, roadmap.md, config.json, specs/)
- [ ] Milestone Run artifacts copied (filtered from artifact registry)
- [ ] `worktree-scope.json` written with milestone scope
- [ ] Scoped project metadata and Session/Run records written
- [ ] `worktrees.json` registry updated in main worktree
- [ ] Milestone marked `"forked"` in main state.json

Sync mode:
- [ ] Git merge main into worktree branch
- [ ] Shared artifacts re-copied
- [ ] Conflicts reported if any
</success_criteria>
