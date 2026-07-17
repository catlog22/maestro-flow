---
name: team-quality-assurance
description: Unified team skill for quality assurance. Full closed-loop QA
  combining issue discovery and software testing. Triggers on "team
  quality-assurance", "team qa".
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

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

# Team Quality Assurance

Orchestrate multi-agent QA: scout -> strategist -> generator -> executor -> analyst. Supports discovery, testing, and full closed-loop modes with parallel generation and GC loops.

## Architecture

```
spawn_agent({ task_name: "team_quality_assurance", message: "Execute skill team-quality-assurance, args: "task description"" })
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
                    +-------+-------+-------+-------+-------+
                    v       v       v       v       v
                 [scout] [strat] [gen] [exec] [analyst]
                 team-worker agents, each loads roles/<role>/role.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scout | [roles/scout/role.md](roles/scout/role.md) | SCOUT-* | false |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | QASTRAT-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | QAGEN-* | false |
| executor | [roles/executor/role.md](roles/executor/role.md) | QARUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | QAANA-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `QA`
- **Session path**: `.workflow/.team/QA-<slug>-<date>/`
- **Team name**: `quality-assurance`
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
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--mode=discovery` | Force discovery mode |
| `--mode=testing` | Force testing mode |
| `--mode=full` | Force full QA mode |

## Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Quality Assurance pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
```

## Session Directory

```
.workflow/.team/QA-<slug>-<date>/
├── .msg/messages.jsonl     # Team message bus
├── .msg/meta.json          # Session state + shared memory
├── wisdom/                 # Cross-task knowledge
├── scan/                   # Scout output
├── strategy/               # Strategist output
├── tests/                  # Generator output (L1/, L2/, L3/)
├── results/                # Executor output
└── analysis/               # Analyst output
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) — Team configuration and shared memory schema

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| Scout finds no issues | Report clean scan, skip to testing mode |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
