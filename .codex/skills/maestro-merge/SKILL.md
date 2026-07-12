---
name: maestro-merge
description: Merge milestone worktree branch back to main
argument-hint: -m <milestone-number> [--force] [--dry-run] [--no-cleanup] [--continue]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<run_mode>
**Session mode:** `run`. This boundary is mandatory and overrides legacy Codex session-path examples below.

1. Before domain work, call `maestro run create maestro-merge -- $ARGUMENTS` and retain the returned `run_id`, `run_dir`, and `upstream`.
2. Formal deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; synthesis and handoff go to `{run_dir}/report.md`.
3. Do not edit protocol JSON or append to project `state.json.artifacts[]`.
4. Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` are semantic labels only. Map them into the active Run and never create a second formal truth source.
</run_mode>

<purpose>
Merge a completed milestone worktree branch back into main, sync scratch artifacts,
and reconcile artifact registry. Two-phase approach: git merge first (source code),
artifact sync second (only after git succeeds). Prevents partial state corruption
when merge conflicts occur.
</purpose>

<required_reading>
@~/.maestro/workflows/merge.md
</required_reading>

<context>
$ARGUMENTS — milestone number and optional flags.

**Flags:**
- `-m <N>` or bare `<N>`: Milestone number
- `--force`: Merge even if milestone has incomplete artifacts
- `--dry-run`: Show what would be merged
- `--no-cleanup`: Keep worktree and branch after merge
- `--continue`: Resume merge paused due to git conflict

**Merge sequence:**
1. Registry health check → 2. Milestone artifact completeness validation →
3. Pre-merge rebase → 4. Git merge (source) → 5. Scratch artifact sync →
6. Artifact registry reconciliation → 7. Cleanup

**Phase 2 detail:**
- Copy worktree `scratch/*` to main `.workflow/scratch/`
- Merge `state.json.artifacts[]` entries (worktree wins for same id)
- Remove milestone `"forked"` flag in main state.json
</context>

<execution>
Follow '~/.maestro/workflows/merge.md' completely.

**Knowledge inquiry on completion:**
After successful merge, ask user once: "Record milestone learnings?" If yes, persist via `maestro spec add learning "<title>" "<insight>" --keywords <kw1>,<kw2> --description "<summary>"`.

**Next steps:**
- View dashboard → `$manage-status`
- Audit milestone → `$maestro-milestone-audit`
</execution>

<invariants>
**Phase order enforcement** — git merge MUST complete before artifact sync. Do NOT sync artifacts until git merge succeeds — prevents partial state corruption.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Running inside a worktree | Run from main worktree |
| E002 | error | No worktree registry found | Nothing to merge |
| E003 | error | --continue but no merge state | Start fresh merge |
| E004 | error | No milestone number | Provide `-m <N>` |
| W001 | warning | Stale registry entries | Auto-cleaned |
| W002 | warning | Incomplete artifacts without --force | Confirm or use --force |
| W003 | warning | Conflict pulling main into worktree | Resolve first |
</error_codes>

<success_criteria>
- [ ] Registry health check passed
- [ ] Pre-merge rebase successful
- [ ] Git merge completed (or conflicts resolved via --continue)
- [ ] Scratch artifacts synced to main `.workflow/scratch/`
- [ ] `state.json.artifacts[]` reconciled (worktree entries merged)
- [ ] Milestone `"forked"` flag removed
- [ ] Worktree removed and branch deleted (unless --no-cleanup)
- [ ] Registry updated
</success_criteria>
