---
name: maestro-merge
description: Merge session worktree branch back to main
argument-hint: --session <session_id> [--force] [--dry-run] [--no-cleanup] [--continue]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.52
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Merge a session worktree branch back into main, sync Run artifacts, and reconcile the artifact registry.
Two-step: git merge first, artifact sync second (only after git succeeds).
</purpose>

<context>
$ARGUMENTS -- session ID (or slug) and optional flags.

Flags (`--session`, `--force`, `--dry-run`, `--no-cleanup`, `--continue`), merge sequence, artifact sync detail, and conflict handling are defined in workflow `merge.md`.
</context>

<execution>
Follow '~/.maestro/workflows/merge.md' completely.

### Gates (MANDATORY, BLOCKING)

**GATE 1: Pre-merge → Git Merge**
- REQUIRED: Registry health check completed (stale entries cleaned or flagged).
- REQUIRED: Pre-merge rebase successful (worktree has latest main).
- BLOCKED if rebase has conflicts: resolve in worktree first (W003).

**GATE 2: Git Merge → Artifact Sync**
- REQUIRED: Git merge completed without conflicts (or conflicts resolved via --continue).
- BLOCKED if: merge has unresolved conflicts — do NOT sync artifacts until git merge succeeds (prevents partial state corruption).

**GATE 3: Artifact Sync → Completion**
- REQUIRED: All Run artifacts synced to main `sessions/{session_id}/runs/`.
- REQUIRED: Artifact registry reconciled (worktree entries merged into main).
- REQUIRED: Worktree cleaned up (unless --no-cleanup).
- BLOCKED if missing: artifacts not synced or registry not reconciled — main worktree would have incomplete state.

</execution>

<completion>
### Knowledge inquiry

After successful merge, use `request_user_input` to confirm knowledge persistence:

```
question: "Merge 完成。是否记录本次工作经验教训？"
options:
  - label: "记录经验"
    description: "通过 maestro-spec add 持久化此次工作的关键洞察"
  - label: "跳过"
    description: "不记录，直接完成"
```

User selects "记录经验" → prompt for title/insight, then persist via `Skill("maestro-spec", "add learning \"<title>\" \"<insight>\" --keywords <kw1>,<kw2> --description \"<summary>\"")`. User selects "跳过" → proceed to next-step routing.

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Merge complete | spawn_agent({ task_name: "manage", message: "Execute skill manage, args: "status"" }) |
| Next dep-ready session | step `analyze` for session (`maestro run prepare --platform codex analyze --session {next-dep-ready-slug}` + `maestro run create analyze --session {next-dep-ready-slug} --intent "{goal}"`) |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Running inside a worktree | Run from main worktree |
| E002 | error | No worktree registry found | Nothing to merge |
| E003 | error | --continue but no merge state | Start fresh merge |
| E004 | error | No session ID provided | Provide `--session <session_id>` |
| W001 | warning | Stale registry entries found | Auto-cleaned |
| W002 | warning | Incomplete artifacts (without --force) | Confirm or use --force |
| W003 | warning | Conflict pulling main into worktree | Resolve in worktree first |
</error_codes>

<success_criteria>
- [ ] Registry health check passed (stale entries cleaned)
- [ ] Pre-merge rebase successful (worktree has latest main)
- [ ] Git merge completed without conflicts (or conflicts resolved via --continue)
- [ ] All Run artifacts synced to main `sessions/{session_id}/runs/`
- [ ] Artifact registry reconciled (worktree entries merged into main)
- [ ] Session lifecycle updated (forked_from cleared)
- [ ] Worktree removed and branch deleted (unless --no-cleanup)
- [ ] `worktrees.json` registry updated (entry removed)
</success_criteria>
