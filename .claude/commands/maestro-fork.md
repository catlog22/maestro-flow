---
name: maestro-fork
description: Create or sync milestone worktree for parallel dev
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
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates: { entry: [], exit: [] }
---

<run_mode>
**Session mode:** `run`. This block is MANDATORY and overrides legacy artifact-path examples below.

1. Before domain work, call `maestro run create maestro-fork -- $ARGUMENTS` and use the returned `run_id`, `run_dir`, and `upstream`.
2. Formal JSON/Markdown deliverables MUST be written under `{run_dir}/outputs/`; evidence goes to `{run_dir}/evidence/`; process narrative and handoff go to `{run_dir}/report.md`.
3. The model MUST NOT edit protocol JSON (`run.json`, `session.json`, `gates.json`, `artifacts.json`, `evidence.json`) or append to project `state.json.artifacts[]`.
4. Run `maestro run check {run_id}` before completion, repair blocking gaps, then run `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Any later reference to `scratch/`, hidden command session directories, `milestones/`, `phases/`, `context-package.json`, `understanding.md`, `evidence.ndjson`, or a secondary `status.json` is a legacy semantic label only. Map formal deliverables to `outputs/`, narrative to `report.md`, evidence attachments to `evidence/`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.
</run_mode>
<purpose>
Create or sync a milestone-level git worktree for parallel development.
Supports `--sync` mode to pull latest main changes into an active worktree.
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

### Phase Gates (MANDATORY, BLOCKING)

**Fork mode:**

**GATE 1: Validation → Worktree Creation**
- REQUIRED: Milestone resolved from state.json.milestones[].
- REQUIRED: No existing active worktree for this milestone (E008).
- REQUIRED: Not running inside a worktree (E003).
- BLOCKED if: milestone not found (E006), already forked (E008), or running inside worktree (E003).

**GATE 2: Worktree Creation → Artifact Copy**
- REQUIRED: Git worktree created with branch (`milestone/{slug}`).
- REQUIRED: Shared `.workflow/` files copied (project.md, roadmap.md, config.json, specs/).
- BLOCKED if missing: worktree creation failed or shared files not copied — do not proceed to artifact scoping.

**GATE 3: Artifact Copy → Completion**
- REQUIRED: AskUserQuestion confirmation before registry writes — show milestone scope, worktree path, and state entries to be written. User must confirm or abort.
- REQUIRED: `worktree-scope.json` written with milestone scope (after confirmation).
- REQUIRED: Scoped `state.json` written (only this milestone's artifacts) (after confirmation).
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
| Fork complete | `cd {wt.path} && /maestro-analyze` |
| Fork + automated | `maestro delegate "run full lifecycle for milestone" --cd {wt.path} --mode write` |
| Fork + status check | Skill({ skill: "manage-status" }) |
| Sync complete | Resume work in worktree |
| Sync conflicts found | Resolve manually, then retry |
</completion>

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
