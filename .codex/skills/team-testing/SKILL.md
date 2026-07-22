---
name: team-testing
disable-model-invocation: true
description: Unified team skill for testing team. Progressive test coverage
  through Generator-Critic loops, shared memory, and dynamic layer selection.
  Triggers on "team testing".
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
  - mcp__maestro__team_msg
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_plan
  - wait_agent
session-mode: run
version: 0.5.55
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

# Team Testing

Orchestrate multi-agent test pipeline: strategist -> generator -> executor -> analyst. Progressive layer coverage (L1/L2/L3) with Generator-Critic loops for coverage convergence.

## Architecture

```
spawn_agent({ task_name: "team_testing", message: "Execute skill team-testing, args: task description" })
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
                    +-------+-------+-------+-------+
                    v       v       v       v
                [strat] [gen]  [exec]  [analyst]
                team-worker agents, each loads roles/<role>/role.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | STRATEGY-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | TESTGEN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | TESTRUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | TESTANA-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TST`
- **Session path**: `{run_dir}/work/team/`
- **Team name**: `testing`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "testing",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: testing
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <run-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final send_message.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID>` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |

## Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Testing pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Deepen Coverage", description: "Add more test layers or increase coverage targets" }
    ]
  }]
})
```

## Session Directory

```
{run_dir}/work/team/
├── .msg/messages.jsonl     # Team message bus
├── .msg/meta.json          # Session metadata
├── wisdom/                 # Cross-task knowledge
├── {run_dir}/outputs/strategy/               # Strategist output
├── {run_dir}/outputs/tests/                  # Generator output (L1-unit/, L2-integration/, L3-e2e/)
├── {run_dir}/outputs/results/                # Executor output
└── {run_dir}/outputs/analysis/               # Analyst output
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) — Team configuration

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
