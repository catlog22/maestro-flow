---
title: "Maestro Team Lite — User Guide"
---

A Git-native collaboration extension for small teams of 2-8 people. For architecture and design rationale, see
[team-lite-design.md](./team-lite-design.md) — this document only covers "how to use it".

## Quick Start

```bash
# 1. Confirm git identity (uid is derived from the local-part of user.email)
git config user.name && git config user.email

# 2. Register as a member (idempotent)
maestro collab join

# 3. Enable the PostToolUse heartbeat hook
maestro hooks install --project
```

After completion, `maestro collab whoami` should print your uid / host / role. Every tool invocation triggers `maestro-team-monitor` to append a heartbeat to `activity.jsonl`.

## Daily Workflow

```bash
maestro collab status              # See who is doing what (last 30 min)
maestro collab sync                # One-click sync (stash → pull --rebase → pop → push)
```

`/maestro-plan` and `/maestro-execute` templates already integrate preflight calls — no manual triggering needed.

## Core Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `join` | Idempotently register git identity | `maestro collab join` |
| `whoami` | Display local member profile | `maestro collab whoami` |
| `status [--window N]` | Teammate activity from last N min (default 30) | `maestro collab status` |
| `report --action <name>` | Manually report an activity | `maestro collab report --action build --phase 3` |
| `sync [--dry-run] [--with-overlays]` | One-click sync | `maestro collab sync` |
| `preflight --phase N [--force]` | Conflict pre-scan | `maestro collab preflight --phase 3` |

<details>
<summary>Command Output Examples</summary>

```
$ maestro collab join
Joined as alice <alice@example.com> on alice-laptop (admin)

$ maestro collab status
Active in last 30 min:
  alice@alice-laptop    maestro-execute     P3/TASK-001    2 min ago
  bob@bob-desktop       wiki-update         spec-auth      5 min ago

$ maestro collab sync --with-overlays
Stashing local changes (maestro-team-sync-auto)...
Pulling from origin/HEAD (rebase)...
Pushing...
Importing team overlays...
  bob-bundle.json — imported (newer than local)
Sync complete.

$ maestro collab preflight --phase 3
⚠ bob@bob-desktop is active on phase 3 (last: maestro-execute, 4 min ago)
exit: 1
```

</details>

## Statusline

After installing the hook, the status bar displays a teammates section:

```
model | P3 | TASK-001 | ~/proj | 👥 alice (P3/001) | bob (spec-auth) +2
```

- Starts with `👥`, showing up to 3 most active teammates
- `alice (P3/001)` — active on phase 3 / TASK-001
- `+2` — 2 more teammates collapsed

Activation: `join` executed + `activity.jsonl` has non-self events within 30 min. Cached 10 seconds.

## Conflict Alerts

`preflight --phase N` tails the last 500 activity entries, filters same-phase non-self heartbeats, exits code 1 if matched.

**When to use `--force`:**
- Already coordinated with teammate
- Teammate's heartbeat is a historical remnant
- Temporary patch with no scope overlap

**Do not use `--force`**: When unsure, unconfirmed, or the action is `maestro-execute`.

## Incremental Sync Fast Path

`team sync` performs SHA comparison before the full flow:

| Scenario | Behavior | Duration |
|----------|----------|----------|
| Local == remote | Skip (SKIP) | < 1s |
| Local ahead | Push only (PUSH-ONLY) | fetch + push |
| Local behind | Pull only (PULL-ONLY) | fetch + pull |
| Diverged | Full flow | Normal |

`--dry-run` prints SHA info without executing git operations.

## Overlay Team Sharing

### Push overlays

```bash
maestro overlay push                  # Bundle all overlays
maestro overlay push -n my-overlay    # Push specific overlays only
```

### Sync teammate overlays

```bash
maestro collab sync --with-overlays
```

Scans `*-bundle.json` files, skips your own, compares against `manifest.json` import timestamps, imports only newer ones.

<details>
<summary>Directory Structure</summary>

```
.workflow/collab/overlays/
├── alice-bundle.json     # alice's overlay export
├── bob-bundle.json       # bob's overlay export
└── manifest.json         # Last import timestamp per member
```

`.gitignore` uses negation rules to enable git tracking for this directory.

</details>

## Spec Personalization (Three-Layer Loading)

| Layer | Directory | Purpose |
|-------|-----------|---------|
| Baseline | `.workflow/specs/` | Project baseline specs (shared by all) |
| Team | `.workflow/collab/specs/` | Team-shared specs |
| Personal | `.workflow/collab/specs/{uid}/` | Personal spec overrides |

```bash
maestro collab spec list              # List personal spec files
maestro collab spec edit my-rules     # Create/edit personal spec
```

Personal specs automatically take effect in the agent's spec injection.

## Namespace Protection

Namespace Guard prevents accidental writes to teammates' files. v1 is advisory mode — warnings only.

Each member can only write to:
- `.workflow/collab/members/{own uid}.json`
- All files under `.workflow/collab/specs/{own uid}/`
- `.workflow/collab/overlays/{own uid}-bundle.json`
- **Shared**: `activity.jsonl` (append), `overlays/manifest.json`

```bash
$ maestro collab guard          # View boundaries
```

## Role Permissions

First member gets `admin` by default; subsequent members get `member`. Sensitive operations require admin. Read operations and daily commands (`sync`, `join`, `status`) are open to all roles.

## Sync Strategy

**When to sync**: Before new phase, after preflight block, after > 2 hours without pulling.

| Issue | Behavior |
|-------|----------|
| Stash pop conflict | Exit 4, changes in stash. Resolve with `git add + commit` |
| Rebase failure | Auto `git rebase --abort` + `git stash pop` |
| Push rejected | Auto-retry once with pull --rebase + push. Exit 3 on double failure |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Team mode not enabled" | Check `git config user.email` has value + `.workflow/collab/members/{uid}.json` exists |
| Hook not firing | `maestro hooks status` check PostToolUse for `maestro-team-monitor.js` |
| Cross-machine uid collision | Join auto-appends numeric suffix (`alice-2`) |
| Log rotation | Files > 10 MB or every Monday 00:00 auto-rotate |
| Clear activity | `rm .workflow/collab/activity.jsonl`, next heartbeat recreates it |

## Agent Collaboration Boundary

`maestro team` commands **only** read/write `.workflow/collab/` (human collaboration domain). `.workflow/.team/` is the agent pipeline message bus — strictly isolated. Do not manually place anything under `.workflow/.team/`.

## Testing Notes

All tests use `node:test` (not vitest):

```bash
npx tsx --test src/utils/__tests__/jsonl-log.test.ts \
  src/tools/__tests__/team-members.test.ts \
  src/tools/__tests__/team-activity.test.ts \
  src/tools/__tests__/namespace-guard.test.ts \
  src/tools/__tests__/spec-loader.test.ts \
  src/hooks/__tests__/team-monitor.test.ts \
  src/commands/__tests__/team-preflight.test.ts \
  src/hooks/__tests__/statusline-team.test.ts
```

End-to-end smoke: `node scripts/team-lite-smoke.mjs`
