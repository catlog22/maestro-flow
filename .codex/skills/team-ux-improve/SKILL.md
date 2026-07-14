---
name: team-ux-improve
description: Unified team skill for UX improvement. Systematically discovers and fixes UI/UX interaction issues including unresponsive buttons, missing feedback, and state refresh problems. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team ux improve".
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

# Team UX Improve

Systematic UX improvement pipeline: scan -> diagnose -> design -> implement -> test. Built on **team-worker agent architecture** — all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_ux_improve", message: "Execute skill team-ux-improve, args: "<project-path> [--framework react|vue]"" })
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
                    v       v       v       v       v
           [team-worker agents, each loads roles/<role>/role.md]
          scanner  diagnoser  designer  implementer  tester
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | SCAN-* | false |
| diagnoser | [roles/diagnoser/role.md](roles/diagnoser/role.md) | DIAG-* | false |
| designer | [roles/designer/role.md](roles/designer/role.md) | DESIGN-* | false |
| implementer | [roles/implementer/role.md](roles/implementer/role.md) | IMPL-* | true |
| tester | [roles/tester/role.md](roles/tester/role.md) | TEST-* | false |

## Utility Member Registry

**Coordinator-only**: Utility members can only be spawned by Coordinator. Workers CANNOT call spawn_agent() to spawn utility members.

| Utility Member | Path | Callable By | Purpose |
|----------------|------|-------------|---------|
| explorer | [roles/explorer/role.md](roles/explorer/role.md) | Coordinator only | Explore codebase for UI component patterns and framework-specific patterns |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
3. **Wiki knowledge**: `maestro search "UX improvement interaction" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `ux-improve`
- **Session path**: `.workflow/.team/ux-improve-<timestamp>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max test iterations**: 5

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker for <task-id>", fork_turns: "none", agent_type: "team_worker" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/design-standards.md](specs/design-standards.md) — Impeccable visual design standards
- [specs/anti-patterns.md](specs/anti-patterns.md) — AI slop detection catalog (20 items)
- [specs/heuristics.md](specs/heuristics.md) — Nielsen's 10 usability heuristics evaluation framework

## Session Directory

```
.workflow/.team/ux-improve-<timestamp>/
├── .msg/
│   ├── messages.jsonl      # Team message bus
│   └── meta.json           # Pipeline config + role state snapshot
├── artifacts/              # Role deliverables
│   ├── scan-report.md      # Scanner output
│   ├── diagnosis.md        # Diagnoser output
│   ├── design-guide.md     # Designer output
│   ├── fixes/              # Implementer output
│   └── test-report.md      # Tester output
├── explorations/           # Explorer cache
│   └── cache-index.json
└── wisdom/                 # Session knowledge base
    ├── contributions/      # Worker contributions (write-only for workers)
    ├── principles/
    ├── patterns/
    └── anti-patterns/
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Project path invalid | Re-prompt user for valid path |
| Framework detection fails | request_user_input for framework selection |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| No UI issues found | Complete with empty fix list, generate clean bill report |
| Test iterations exceeded | Accept current state, continue to completion |
