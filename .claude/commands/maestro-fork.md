---
name: maestro-fork
description: Create a worktree for milestone-level parallel development, or sync existing worktree with main
argument-hint: "-m <milestone-number> [--base <branch>] [--sync]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Create a git worktree for an entire milestone, enabling inter-milestone parallel development. The worktree scope is milestone-level — all scratch artifacts for that milestone are owned by the worktree.

Since `.workflow/` is gitignored, this command explicitly copies project context and existing milestone scratch artifacts into the worktree. Per-phase parallelism within a milestone is NOT supported.

Also supports `--sync` mode to pull latest main branch changes and shared artifacts into an active worktree (prevents source and artifact drift for long-lived worktrees).

Produces `.workflow/worktrees.json` registry in the main worktree and `.workflow/worktree-scope.json` marker in the worktree.
</purpose>

<required_reading>
@~/.maestro/workflows/fork.md
</required_reading>

<deferred_reading>
- [worktrees.json](~/.maestro/templates/worktrees.json) — read when updating registry
- [worktree-scope.json](~/.maestro/templates/worktree-scope.json) — read when writing scope marker
</deferred_reading>

<context>
$ARGUMENTS -- milestone number and optional flags.

Modes (`Fork` / `Sync`), flags (`-m`, `--base`, `--sync`), milestone resolution, worktree layout, and artifact scoping are defined in workflow `fork.md`.
</context>

<execution>
Follow '~/.maestro/workflows/fork.md' completely.

Fork and sync algorithm steps are defined in workflow `fork.md`.

**Next-step routing on completion:**

Fork mode:
- Enter worktree → `cd {wt.path} && /maestro-analyze`
- Automated → `maestro delegate "run full lifecycle for milestone" --cd {wt.path} --mode write`
- Status → Skill({ skill: "manage-status" })

Sync mode:
- Sync complete → resume work in worktree
- Conflicts found → resolve manually, then retry
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Project not initialized | Run maestro-init first |
| E002 | error | No roadmap found | Run maestro-roadmap first |
| E003 | error | Running inside a worktree | Run from main worktree |
| E004 | error | No milestone number provided | Provide `-m <N>` |
| E005 | error | No milestones defined in state.json | Run maestro-roadmap first |
| E006 | error | Milestone number out of range | Check available milestones |
| E007 | error | No active worktree for milestone (--sync) | Check worktrees.json |
| E008 | error | Milestone already has active worktree | Merge or cleanup first |
</error_codes>

<success_criteria>
Fork mode:
- [ ] Milestone resolved from state.json.milestones[]
- [ ] Git worktree created with branch (`milestone/{slug}`)
- [ ] Shared `.workflow/` files copied (project.md, roadmap.md, config.json, specs/)
- [ ] Milestone scratch artifacts copied (filtered from artifact registry)
- [ ] `worktree-scope.json` written with milestone scope
- [ ] Scoped `state.json` written (only this milestone's artifacts)
- [ ] `worktrees.json` registry updated in main worktree
- [ ] Milestone marked as `"forked"` in main `state.json.milestones[]`
- [ ] Summary displayed with next-step commands

Sync mode:
- [ ] Git merge main into worktree branch
- [ ] Shared artifacts re-copied (project.md, roadmap.md, config.json, specs/)
- [ ] Conflicts reported if any
</success_criteria>
