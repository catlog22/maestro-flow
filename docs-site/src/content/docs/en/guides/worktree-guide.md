---
title: "Worktree Parallel Development Guide"
---

Maestro-Flow supports **milestone-level parallel development** based on git worktree. When a milestone is complete (even with lingering bugs), you can fork a worktree for the next milestone, develop on an independent branch, and merge back when finished.

## Core Concepts

- One milestone = one worktree (phase-level parallelism within a milestone is not supported)
- Phases within a worktree still execute sequentially (analyze -> plan -> execute -> verify -> transition)
- `.workflow/` is gitignored; it is explicitly copied into the worktree during fork

<details>
<summary>Directory Structure Diagram</summary>

```
Main worktree (master)              Worktree (.worktrees/m2-production/)
├── .workflow/                      ├── .workflow/
│   ├── state.json                  │   ├── state.json (scoped)
│   ├── worktrees.json (registry)   │   ├── worktree-scope.json (marker)
│   └── phases/                     │   ├── roadmap.md (read-only copy)
│       ├── 01-auth/ ✅             │   └── phases/
│       ├── 02-kanban/ ✅           │       ├── 03-realtime/ (owned)
│       ├── 03-realtime/ [forked]   │       └── 04-billing/ (owned)
│       └── 04-billing/ [forked]    │
│                                   │   Execute normally here:
│   Fix M1 bugs on main             │   /maestro-ralph --engine swarm --script wf-analyze 3
│                                   │   /maestro-next "<plan intent> 3"
│                                   │   /maestro-ralph continue
```

</details>

## Command Quick Reference

| Command | Purpose | Example |
|---------|---------|---------|
| `maestro-fork -m <N>` | Create worktree for milestone N | `/maestro-fork -m 2` |
| `maestro-fork -m <N> --sync` | Sync latest main code to worktree | `/maestro-fork -m 2 --sync` |
| `maestro-merge -m <N>` | Merge milestone N's worktree back to main | `/maestro-merge -m 2` |
| `maestro-merge --continue` | Continue merge after resolving conflicts | `/maestro-merge --continue` |

## Use Cases

### Scenario 1: Milestone completed with bugs — start next without waiting

```bash
/maestro-session-seal                 # M1 complete but has bugs
/maestro-fork -m 2                   # Fork M2 worktree

# Terminal A: Fix M1 bugs on main
cd /project

# Terminal B: Advance M2 in worktree
cd .worktrees/m2-production/
/maestro-ralph --engine swarm --script wf-analyze 3 && /maestro-next "<plan intent> 3" && /maestro-ralph continue

# M2 complete, merge back
/maestro-merge -m 2
```

### Scenario 2: Long-lived worktree needs main fixes synced

```bash
/maestro-fork -m 2 --sync
# → git merge main (source sync) + re-copy project.md, roadmap.md, specs/
```

### Scenario 3: Automate worktree development with delegate

```bash
/maestro-fork -m 2
maestro delegate "run full lifecycle for all phases" \
  --cd .worktrees/m2-production/ --mode write
```

## Detailed Flows

### Fork: Create Worktree

```bash
/maestro-fork -m 2
```

1. **Validate**: Project initialized, roadmap exists, not inside a worktree, M2 not already forked
2. **Parse milestone**: Read M2 info from state.json
3. **Create worktree**: `git worktree add -b milestone/production .worktrees/m2-production HEAD`
4. **Copy .workflow/**: Shared files (read-only) + Milestone phase directories
5. **Write markers**: `worktree-scope.json` (scope) + scoped `state.json`
6. **Update main**: `worktrees.json` registry + M2 marked `"forked"`

<details>
<summary>Example Output</summary>

```
=== FORK COMPLETE ===
Session:    fork-20260418T143022
Base:       HEAD (abc1234)
Milestone:  M2 — Production
Branch:     milestone/production
Path:       .worktrees/m2-production
Phases:     3, 4
```

</details>

### Sync: Synchronize Worktree

```bash
/maestro-fork -m 2 --sync
```

1. Find M2's worktree from `worktrees.json`
2. `git merge main` (source sync)
3. Re-copy shared files (artifact sync)
4. Report conflicts

Recommended timing: Main has bug fixes, shared files updated, periodic sync for long-lived worktrees.

### Merge: Merge Worktree

```bash
/maestro-merge -m 2
```

**Phase 1 — Git Merge:** Registry check → validate completion → pre-merge → `git merge --no-ff`

**Phase 2 — Artifact Sync (after Phase 1 succeeds):** Copy phases back → patch state.json → update roadmap.md → cleanup worktree

**Conflict handling:**

```bash
git add <resolved-files>
git merge --continue
/maestro-merge --continue    # Continue Phase 2
```

**Flags:**

| Flag | Effect |
|------|--------|
| `--force` | Merge even with incomplete phases |
| `--dry-run` | Show only, don't execute |
| `--no-cleanup` | Keep worktree after merge |
| `--continue` | Continue artifact sync after git conflict resolution |

## Scope Protection Mechanisms

Inside a worktree, new artifacts auto-belong to the milestone in `worktree-scope.json`. Modifying other milestones' artifacts is rejected.

### Global Command Blocking

| Command | Reason |
|---------|--------|
| `maestro-init` | Would reset project state |
| `/maestro-ralph --roadmap` | Would re-decompose phases |
| `/maestro "<specification intent>"` | Would modify global blueprint |
| `maestro-fork` | Cannot fork from within a worktree |
| `maestro-merge` | Must be executed from main |

## Dashboard Integration

`/manage status` displays worktree status:

<details>
<summary>Dashboard Output Examples</summary>

**From main:**
```
┌─────────────────────────────────────────┐
│ ACTIVE WORKTREES                        │
├─────────────────────────────────────────┤
│ M2 (Production) | milestone/production  │
│   Path: .worktrees/m2-production        │
│                                         │
│ Sync:  /maestro-fork -m 2 --sync        │
│ Merge: /maestro-merge -m 2              │
└─────────────────────────────────────────┘
```

**From a worktree:**
```
┌─────────────────────────────────────────┐
│ WORKTREE MODE                           │
├─────────────────────────────────────────┤
│ Milestone: M2 (Production)             │
│ Branch:    milestone/production          │
│ Phases:    3, 4                          │
│ Main:      /path/to/project              │
└─────────────────────────────────────────┘
```

</details>

## File Structure

| File | Location | Description |
|------|----------|-------------|
| `worktrees.json` | main `.workflow/` | Registry: all active worktrees |
| `worktree-scope.json` | worktree `.workflow/` | Marker file: owned phases, main path |
| `state.json` | worktree `.workflow/` | Scoped copy, independent from main |
| `project.md` | worktree `.workflow/` | Read-only copy |
| `roadmap.md` | worktree `.workflow/` | Read-only copy |

## Important Notes

1. Do not manually modify `worktree-scope.json`
2. Do not directly modify main's `.workflow/` from within a worktree
3. Sync regularly to reduce conflicts
4. Ensure worktree is clean before merge (all changes committed)
5. One milestone can only have one worktree
