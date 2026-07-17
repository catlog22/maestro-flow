---
name: team-tech-debt
description: Unified team skill for tech debt identification and remediation.
  Scans codebase for tech debt, assesses severity, plans and executes fixes with
  validation. Uses team-worker agent architecture with roles/ for domain logic.
  Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on
  "team tech debt".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - update_plan
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
  - wait_agent
session-mode: run
version: 0.5.50
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

# Team Tech Debt

Systematic tech debt governance: scan -> assess -> plan -> fix -> validate. Built on **team-worker agent architecture** — all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_tech_debt", message: "Execute skill team-tech-debt, args: "task description"" })
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
          scanner  assessor  planner  executor  validator
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | TDSCAN-* | false |
| assessor | [roles/assessor/role.md](roles/assessor/role.md) | TDEVAL-* | false |
| planner | [roles/planner/role.md](roles/planner/role.md) | TDPLAN-* | false |
| executor | [roles/executor/role.md](roles/executor/role.md) | TDFIX-* | true |
| validator | [roles/validator/role.md](roles/validator/role.md) | TDVAL-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TD`
- **Session path**: `.workflow/.team/TD-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max GC rounds**: 3

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
| `--mode=scan` | Run scan-only pipeline (TDSCAN + TDEVAL) |
| `--mode=targeted` | Run targeted pipeline (TDPLAN + TDFIX + TDVAL) |
| `--mode=remediate` | Run full pipeline (default) |
| `-y` / `--yes` | Skip confirmations |

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry

## Session Directory

```
.workflow/.team/TD-<slug>-<date>/
├── .msg/
│   ├── messages.jsonl      # Team message bus
│   └── meta.json           # Pipeline config + role state snapshot
├── scan/                   # Scanner output
├── assessment/             # Assessor output
├── plan/                   # Planner output
├── fixes/                  # Executor output
├── validation/             # Validator output
└── wisdom/                 # Cross-task knowledge
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| Scanner finds no debt | Report clean codebase, skip to summary |
