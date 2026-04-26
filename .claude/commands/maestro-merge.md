---
name: maestro-merge
description: Two-phase merge of milestone worktree branch back — git merge first, scratch artifact sync only on success
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
---
<purpose>
Merge a completed milestone worktree branch back into the main branch, sync scratch artifacts, and reconcile the artifact registry. Uses a two-phase approach: git merge first (source code), artifact sync second (only after git succeeds). This prevents partial state corruption when merge conflicts occur.

Includes registry health check, pre-merge rebase (pull main into worktree to minimize conflicts), and atomic state reconciliation (merge artifact entries, don't overwrite).
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

**Next-step routing on completion:**
- View dashboard → Skill({ skill: "manage-status" })
- Audit milestone → Skill({ skill: "maestro-milestone-audit" })
</execution>

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
