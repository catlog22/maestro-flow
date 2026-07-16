---
name: team-planex
description: Unified team skill for plan-and-execute pipeline. Pure router —
  coordinator always. Beat model is coordinator-only in monitor.md. Triggers on
  "team planex".
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
  - mcp__maestro__team_msg
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

> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

# Team PlanEx

Unified team skill: plan-and-execute pipeline for issue-based development. Built on **team-worker agent architecture** — coordinator orchestrates, workers are team-worker agents loading role-specific instructions from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_planex", message: "Execute skill team-planex, args: "task description"" })
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
     +-- analyze -> dispatch -> spawn workers -> STOP
                                    |
                    +---------------+---------------+
                    v                               v
               [planner]                       [executor]
         (team-worker agent,            (team-worker agent,
          loads roles/planner/role.md)   loads roles/executor/role.md)
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | EXEC-* | true |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (arch)**: `maestro load --type spec --category arch` — load arch constraints as shared context
3. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
4. **Wiki knowledge**: `maestro search "plan execute implementation" --json` — top 5 entries as prior context
5. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `PEX`
- **Session path**: `.workflow/.team/PEX-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker", fork_turns: "none", agent_type: "team_worker" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `add <issue-ids or --text '...' or --plan path>` | Append new tasks to planner queue |

## Session Directory

```
.workflow/.team/PEX-<slug>-<YYYY-MM-DD>/
├── .msg/
│   ├── messages.jsonl          # Message bus log
│   └── meta.json               # Session state
├── task-analysis.json          # Coordinator analyze output
├── artifacts/
│   └── solutions/              # Planner solution output per issue
│       ├── <issueId-1>.json
│       └── <issueId-N>.json
└── wisdom/                     # Cross-task knowledge
    ├── learnings.md
    ├── decisions.md
    ├── conventions.md
    └── issues.md
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions, task metadata registry, execution method selection

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Role spec file not found | Error with expected path (roles/<name>/role.md) |
| team-worker agent unavailable | Error: requires .claude/agents/team-worker.md |
| Planner issue planning failure | Retry once, then skip to next issue |
| Executor impl failure | Report to coordinator, continue with next EXEC-* task |
| Pipeline stall | Coordinator monitors, escalate to user |
| Worker no response | Report waiting task, suggest user `resume` |
