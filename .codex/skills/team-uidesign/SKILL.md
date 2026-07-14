---
name: team-uidesign
description: Unified team skill for UI design team. Research -> design tokens -> audit -> implementation. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates dual-track pipeline with GC loops and sync points. Triggers on "team ui design", "ui design team".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - create_goal
  - followup_task
  - interrupt_agent
  - list_agents
  - mcp__maestro__edit_file
  - mcp__maestro__read_file
  - mcp__maestro__team_msg
  - mcp__maestro__write_file
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_goal
  - wait_agent
session-mode: run
---

> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Team UI Design

Systematic UI design pipeline: research -> design tokens -> review -> implementation. Built on **team-worker agent architecture** — all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_uidesign", message: "Execute skill team-uidesign, args: "task description"" })
                    |
         SKILL.md (this file) = Router
                    |
     +--------------+--------------+
     |                             |
  no --role flag              --role <name>
     |                             |
  Coordinator                  Worker
  roles/coordinator/role.md    roles/<name>/role.md
     |
     +-- analyze → dispatch → spawn workers → STOP
                                    |
                    +-------+-------+-------+-------+
                    v       v       v       v
           [team-worker agents, each loads roles/<role>/role.md]
          researcher  designer  reviewer  implementer
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| researcher | [roles/researcher/role.md](roles/researcher/role.md) | RESEARCH-* | false |
| designer | [roles/designer/role.md](roles/designer/role.md) | DESIGN-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | AUDIT-* | false |
| implementer | [roles/implementer/role.md](roles/implementer/role.md) | BUILD-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
3. **Wiki knowledge**: `maestro search "UI design tokens audit" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `UDS`
- **Session path**: `.workflow/.team/UDS-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/design-standards.md](specs/design-standards.md) — Impeccable design standards (OKLCH, typography, spacing, motion, interaction)
- [specs/anti-patterns.md](specs/anti-patterns.md) — AI slop detection catalog (20 items)
- [specs/scoring-guide.md](specs/scoring-guide.md) — 8-dimension quality scoring rubric
- [specs/ux-writing.md](specs/ux-writing.md) — UX writing standards (labels, errors, empty states, voice)

## Session Directory

```
.workflow/.team/UDS-<slug>-<date>/
├── .msg/
│   ├── messages.jsonl         # Team message bus
│   └── meta.json              # Pipeline config + GC state
├── research/                  # Researcher output
│   ├── design-system-analysis.json
│   ├── component-inventory.json
│   ├── accessibility-audit.json
│   ├── design-intelligence.json
│   └── visual-quality-baseline.json
├── design/                    # Designer output
│   ├── design-tokens.json
│   ├── component-specs/
│   └── layout-specs/
├── audit/                     # Reviewer output
│   └── audit-*.md
├── build/                     # Implementer output
│   ├── token-files/
│   └── component-files/
└── wisdom/                    # Cross-task knowledge
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| GC loop stuck > 2 rounds | Escalate to user: accept / retry / terminate |
