---
name: maestro-merge
description: Merge session worktree branch back to main
argument-hint: --session <session_id> [--force] [--dry-run] [--no-cleanup] [--continue]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.6.0
---

<purpose>
Merge a session worktree branch back into main, sync Run artifacts,
and reconcile artifact registry. Two-step approach: git merge first (source code),
artifact sync second (only after git succeeds). Prevents partial state corruption
when merge conflicts occur.
</purpose>

<required_reading>
@~/.maestro/workflows/merge.md
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<context>
$ARGUMENTS — session ID (or intent slug) and optional flags.

**Flags:**
- `--session <id>`: Session ID or intent slug
- `--force`: Merge even if session has incomplete artifacts
- `--dry-run`: Show what would be merged
- `--no-cleanup`: Keep worktree and branch after merge
- `--continue`: Resume merge paused due to git conflict

**Merge sequence:**
1. Registry health check → 2. Session artifact completeness validation →
3. Pre-merge rebase → 4. Git merge (source) → 5. Session artifact sync →
6. Artifact registry reconciliation → 7. Cleanup

**Step 5 detail:**
- Merge canonical `.workflow/sessions/` records and referenced Run artifacts
- Merge artifact registry entries (worktree wins for same id)
- Update session lifecycle (clear `forked_from`)
</context>

<execution>
Follow '~/.maestro/workflows/merge.md' completely.

**Knowledge inquiry on completion:**
After successful merge, ask user once: "Record session learnings?" If yes, persist via `maestro spec add learning "<title>" "<insight>" --keywords <kw1>,<kw2> --description "<summary>"`.

**Next steps:**
- View dashboard → `$manage-status`
- Next dep-ready session → `$maestro-analyze --session {next-dep-ready-slug}`
</execution>

<invariants>
**Step order enforcement** — git merge MUST complete before artifact sync. Do NOT sync artifacts until git merge succeeds — prevents partial state corruption.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Running inside a worktree | Run from main worktree |
| E002 | error | No worktree registry found | Nothing to merge |
| E003 | error | --continue but no merge state | Start fresh merge |
| E004 | error | No session ID provided | Provide `--session <id>` |
| W001 | warning | Stale registry entries | Auto-cleaned |
| W002 | warning | Incomplete artifacts without --force | Confirm or use --force |
| W003 | warning | Conflict pulling main into worktree | Resolve first |
</error_codes>

<success_criteria>
- [ ] Registry health check passed
- [ ] Pre-merge rebase successful
- [ ] Git merge completed (or conflicts resolved via --continue)
- [ ] Run artifacts synced to main `sessions/{session_id}/runs/`
- [ ] Artifact registry reconciled (worktree entries merged)
- [ ] Session lifecycle updated (forked_from cleared)
- [ ] Worktree removed and branch deleted (unless --no-cleanup)
- [ ] Registry updated
</success_criteria>
