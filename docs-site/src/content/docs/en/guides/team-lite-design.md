---
title: "Maestro Team Lite Collaboration Design"
---

A minimalist collaboration extension for small teams of 2-8 people. Core strategy: **Git-native + file-driven + advisory collaboration**, zero infrastructure, backward compatible with single-machine mode.

## Namespace Boundaries (Important)

| Path | Meaning | Ownership | Do Not Mix |
|------|---------|-----------|------------|
| `.workflow/.team/` | **Agent pipeline** internal inter-role message bus | `src/tools/team-msg.ts` | Only written by agent team pipeline |
| `.workflow/collab/` | **Human team collaboration** members / activity / sync | This design | Only written by `maestro collab *` commands |

CLI commands are called `maestro collab *` (user-friendly), but disk layout uses `collab` to separate from the agent domain. Both domains share JSONL utilities, but data is strictly non-interoperable.

<details>
<summary>Removed complex concepts (vs Claude deep design)</summary>

| Removed | Reason | Replacement |
|---------|--------|-------------|
| Relay/Broker server | Ops cost + single point of failure | Git storage |
| Actor hierarchy identity | Abstract, high learning curve | Git config (name + email) |
| Commander arbitration | Automated conflict resolution error-prone | Activity alerts + manual coordination |
| WebSocket / P2P | VPN/firewall instability | Hook heartbeat |
| K8s-style Phase leases | Too heavy for small teams | `activity.jsonl` activity detection |
| Cross-machine Delegate Broker | Technical complexity | Not supported |
| Three-layer sync | Concept overload | Single-layer Git sync |

**Explicitly not in v1:**

| Not Included | Reason |
|---|---|
| `locks.json` advisory locks | Overlaps with activity alerts; `--force` can override |
| `pid` field | Meaningless across machines |
| `members.json` (single file) | JSON cannot `merge=union`; per-member files eliminate conflicts |

</details>

## The 4 Things We Keep

1. **Identity** — Map local Git identity to `.workflow/collab/members/{uid}.json`
2. **Shared activity log** — Team-wide append-only JSONL
3. **Conflict alerts** — `/maestro-next` / `/maestro-ralph continue` scan log before starting
4. **One-click sync** — `maestro collab sync` wraps `git stash + pull --rebase + pop + push`

## Prerequisites

| Task | Change | Effort |
|---|---|---|
| P0.1 | Add `current_task_id` to `state.json`, write/clear on TASK enter/exit | 0.5d |
| P0.2 | Extract `src/utils/jsonl-log.ts` (appendLine/readAll/tailLast/rotateIfLarge) | 0.5d |

## Data Model

<details>
<summary>Member file: .workflow/collab/members/{uid}.json</summary>

One JSON file per member, eliminating Git merge conflicts. `uid` derived from git config `user.email` local-part; numeric suffix on collision.

```json
{
  "uid": "alice",
  "name": "Alice",
  "email": "alice@example.com",
  "host": "alice-laptop",
  "role": "admin",
  "joinedAt": "2026-04-11T10:00:00Z"
}
```

</details>

<details>
<summary>Activity log: .workflow/collab/activity.jsonl</summary>

Team-wide append-only activity bus, auto-appended by PostToolUse hook.

```jsonl
{"ts":"2026-04-11T10:23:00Z","user":"alice","host":"alice-laptop","action":"maestro-next","phase_id":3}
{"ts":"2026-04-11T10:24:15Z","user":"bob","host":"bob-desktop","action":"wiki-update","target":"spec-auth"}
```

| Field | Required | Description |
|-------|----------|-------------|
| `ts` | Yes | ISO 8601 UTC |
| `user` | Yes | uid from members directory |
| `host` | Yes | `os.hostname()` |
| `action` | Yes | Command or tool name |
| `phase_id` | No | Associated phase |
| `task_id` | No | Associated TASK (depends on P0.1) |
| `target` | No | Operation target |

- **Merge strategy**: `.gitattributes` configures `merge=union`, line-level union merge
- **Log rotation**: > 10MB or every Monday 00:00, renamed to archive

</details>

## CLI Command List

| Subcommand | Description | Notes |
|------------|-------------|-------|
| `maestro collab join` | Read from git config, write to `members/{uid}.json` | Idempotent |
| `maestro collab whoami` | Show current uid / name / host / role | — |
| `maestro collab status` | Show who is doing what (reverse chronological) | Core command |
| `maestro collab report` | Manually report an activity | Usually hook-called |
| `maestro collab sync` | `git stash` → `pull --rebase` → `pop` → `push` + rotation | Core command |
| `maestro collab preflight --phase N` | Conflict pre-scan | See Coupling 3 |

### Usage Examples

```bash
maestro collab join
# > Joined as alice <alice@example.com> on alice-laptop (admin)

maestro collab status
# > alice@alice-laptop  maestro-ralph continue   phase 3 / TASK-001    2 min ago
# > bob@bob-desktop     wiki-update       spec-auth             5 min ago

maestro collab sync
# > Stashing... Pulling (rebase)... Pushing... Rotating (12.4 MB)... Done.

maestro collab preflight --phase 3
# > Warning: Bob is active on phase 3 (maestro-next, 3 min ago @ bob-desktop)  exit: 1
```

## Coupling Points with Existing Workflow

All coupling through "injection" — existing command code is not modified.

### Coupling 1: PostToolUse Hook (Zero-Awareness Heartbeat)

- Create `bin/maestro-team-monitor.js`, register third PostToolUse entry
- Async append to `activity.jsonl` after each tool call
- Dedupe: same `user+action+phase_id` writes once per 60 seconds
- Write failures silently ignored, exit 0

### Coupling 2: Statusline (Teammate Visibility)

- Display last 30-minute teammate activity summary in Claude Code status bar
- Performance: only `tailLast(activity.jsonl, 200)`, cached 10s

### Coupling 3: Execution Gate (Conflict Alert)

- Provides `maestro collab preflight` subcommand
- Algorithm: tail 500 recent entries → filter same phase + not self → exit 1 on match
- Caller adds `Bash("maestro collab preflight --phase $ARGUMENTS || confirm")` at top of `<execution>`

### Coupling 4: Commit Message Tags

- Only applies to `team sync` commits, not manual `git commit`
- Auto-inject `[P3][TASK-001]` prefix when sync needs merge commit

## 11-Day Implementation Checklist

### Week 1: Prerequisites + Identity + Visibility (5d)

| Task | Description | Effort |
|------|-------------|--------|
| P0.1 | state.json extension | 0.5d |
| P0.2 | jsonl-log util | 0.5d |
| T1.1 | Identity commands (join/whoami) | 1d |
| T1.2 | Activity module + report CLI | 1d |
| T1.3 | Status display (status CLI UI) | 1d |
| T1.4 | team-monitor bin + hooks registration | 1d |

### Week 2: Sync + Preflight + Statusline (5d)

| Task | Description | Effort |
|------|-------------|--------|
| T2.1 | Sync command (stash/pull/pop/push) | 2d |
| T2.2 | Preflight command | 1d |
| T2.3 | Command injection (modify plan/execute md) | 0.5d |
| T2.4 | Statusline integration | 1.5d |

### Week 3: Polish (1d)

| Task | Effort |
|---|---|
| Sync commit tag | 0.5d |
| Documentation + validation | 0.5d |

## Compatibility

- **`team join` not executed**: `maestro collab *` returns "not enabled"; hook silently exits 0; existing commands 100% unchanged
- **Joined but working alone**: Heartbeats write local only, status shows only yourself
- **Multiple people not syncing**: Each has independent `activity.jsonl`, locally consistent but not synchronized

## References

- `src/tools/team-msg.ts` — Agent domain JSONL bus (do not mix)
- `src/hooks/context-monitor.ts` + `bin/maestro-context-monitor.js` — PostToolUse hook boilerplate
- `src/hooks/delegate-monitor.ts` + `bin/maestro-delegate-monitor.js` — Second hook boilerplate
- `src/commands/hooks.ts` — Hook installation logic
- `src/hooks/statusline.ts` — Status bar
- `src/commands/wiki.ts` — CLI subcommand boilerplate
- `docs/wiki-endpoint-design.md` — Per-member file strategy reference
