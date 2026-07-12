---
name: maestro-merge
description: Merge milestone worktree branch back to main
argument-hint: "-m <milestone-number> [--force] [--dry-run] [--no-cleanup] [--continue]"
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

1. Before domain work, call `maestro run create maestro-merge -- $ARGUMENTS` and use the returned `run_id`, `run_dir`, and `upstream`.
2. Formal JSON/Markdown deliverables MUST be written under `{run_dir}/outputs/`; evidence goes to `{run_dir}/evidence/`; process narrative and handoff go to `{run_dir}/report.md`.
3. The model MUST NOT edit protocol JSON (`run.json`, `session.json`, `gates.json`, `artifacts.json`, `evidence.json`) or append to project `state.json.artifacts[]`.
4. Run `maestro run check {run_id}` before completion, repair blocking gaps, then run `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Any later reference to `scratch/`, hidden command session directories, `milestones/`, `phases/`, `context-package.json`, `understanding.md`, `evidence.ndjson`, or a secondary `status.json` is a legacy semantic label only. Map formal deliverables to `outputs/`, narrative to `report.md`, evidence attachments to `evidence/`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.
</run_mode>
<purpose>
Merge a milestone worktree branch back into main, sync scratch artifacts, and reconcile the artifact registry.
Two-phase: git merge first, artifact sync second (only after git succeeds).
</purpose>

<required_reading>
@~/.maestro/workflows/merge.md
</required_reading>

<context>
$ARGUMENTS -- milestone number and optional flags.

Flags (`-m`, `--force`, `--dry-run`, `--no-cleanup`, `--continue`), merge sequence, artifact sync detail, and conflict handling are defined in workflow `merge.md`.
</context>

<execution>
Follow '~/.maestro/workflows/merge.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Pre-merge → Git Merge**
- REQUIRED: Registry health check completed (stale entries cleaned or flagged).
- REQUIRED: Pre-merge rebase successful (worktree has latest main).
- BLOCKED if rebase has conflicts: resolve in worktree first (W003).

**GATE 2: Git Merge → Artifact Sync**
- REQUIRED: Git merge completed without conflicts (or conflicts resolved via --continue).
- BLOCKED if: merge has unresolved conflicts — do NOT sync artifacts until git merge succeeds (prevents partial state corruption).

**GATE 3: Artifact Sync → Completion**
- REQUIRED: All scratch artifacts synced to main `.workflow/scratch/`.
- REQUIRED: `state.json.artifacts[]` reconciled (worktree entries merged into main).
- REQUIRED: Worktree cleaned up (unless --no-cleanup).
- BLOCKED if missing: artifacts not synced or registry not reconciled — main worktree would have incomplete state.

</execution>

<completion>
### Knowledge inquiry

After successful merge, use `AskUserQuestion` to confirm knowledge persistence:

```
question: "Merge 完成。是否记录里程碑经验教训？"
options:
  - label: "记录经验"
    description: "通过 spec-add 持久化此次里程碑的关键洞察"
  - label: "跳过"
    description: "不记录，直接完成"
```

User selects "记录经验" → prompt for title/insight, then persist via `Skill("spec-add", "learning \"<title>\" \"<insight>\" --keywords <kw1>,<kw2> --description \"<summary>\"")`. User selects "跳过" → proceed to next-step routing.

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Merge complete | Skill({ skill: "manage-status" }) |
| Audit needed | Skill({ skill: "maestro-milestone-audit" }) |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Running inside a worktree | Run from main worktree |
| E002 | error | No worktree registry found | Nothing to merge |
| E003 | error | --continue but no merge state | Start fresh merge |
| E004 | error | No milestone number provided | Provide `-m <N>` |
| W001 | warning | Stale registry entries found | Auto-cleaned |
| W002 | warning | Incomplete artifacts (without --force) | Confirm or use --force |
| W003 | warning | Conflict pulling main into worktree | Resolve in worktree first |
</error_codes>

<success_criteria>
- [ ] Registry health check passed (stale entries cleaned)
- [ ] Pre-merge rebase successful (worktree has latest main)
- [ ] Git merge completed without conflicts (or conflicts resolved via --continue)
- [ ] All scratch artifacts synced to main `.workflow/scratch/`
- [ ] `state.json.artifacts[]` reconciled (worktree entries merged into main)
- [ ] Milestone `"forked"` flag removed in `state.json.milestones[]`
- [ ] `roadmap.md` completed phases marked
- [ ] Worktree removed and branch deleted (unless --no-cleanup)
- [ ] `worktrees.json` registry updated (entry removed)
</success_criteria>
