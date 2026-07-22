---
name: team-lifecycle-v4
disable-model-invocation: true
description: Full lifecycle team skill — plan, develop, test, review in one
  coordinated session. Role-based architecture with coordinator-driven beat
  model. Triggers on "team lifecycle v4".
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
version: 0.5.54
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

# Team Lifecycle v4

Orchestrate multi-agent software development: specification → planning → implementation → testing → review.

## Architecture

```
spawn_agent({ task_name: "team_lifecycle_v4", message: "Execute skill team-lifecycle-v4, args: task description" })
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
     +-- analyze → dispatch → spawn → STOP
                                 |
                    +--------+---+--------+
                    v        v            v
             [team-worker]  ...    [team-supervisor]
              per-task               resident agent
              lifecycle              message-driven
                                     (woken via send_message)
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | RESEARCH-* | false |
| writer | [roles/writer/role.md](roles/writer/role.md) | DRAFT-* | true |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | IMPL-* | true |
| tester | [roles/tester/role.md](roles/tester/role.md) | TEST-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REVIEW-*, QUALITY-*, IMPROVE-* | false |
| supervisor | [roles/supervisor/role.md](roles/supervisor/role.md) | CHECKPOINT-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TLV4`
- **Session path**: `{run_dir}/work/team/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: <team-name>,
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: <team-name>
requirement: <task-description>
inner_loop: <true|false>
run_dir: <run-dir from team-session.json run.run_dir>

## Progress Milestones
session_id: <run-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final send_message.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

## Supervisor Spawn Template

Supervisor is a **resident agent** (independent from team-worker). Spawned once during session init, woken via send_message for each CHECKPOINT task.

### Spawn (Phase 2 — once per session)

```
spawn_agent({
  subagent_type: "team-supervisor",
  description: "Spawn resident supervisor",
  team_name: <team-name>,
  name: "supervisor",
  run_in_background: true,
  prompt: `## Role Assignment
role: supervisor
role_spec: <skill_root>/roles/supervisor/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: <team-name>
requirement: <task-description>
run_dir: <run-dir from team-session.json run.run_dir>

## Progress Milestones
session_id: <run-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final send_message.

Read role_spec file (@<skill_root>/roles/supervisor/role.md) to load checkpoint definitions.
Init: load baseline context, report ready, go idle.
Wake cycle: coordinator sends checkpoint requests via send_message.`
})
```

### Wake (handleSpawnNext — per CHECKPOINT task)

```
send_message({
  type: "message",
  recipient: "supervisor",
  content: `## Checkpoint Request
task_id: <CHECKPOINT-NNN>
scope: [<upstream-task-ids>]
pipeline_progress: <done>/<total> tasks completed`,
  summary: "Checkpoint request: <CHECKPOINT-NNN>"
})
```

### Shutdown (handleComplete)

```
send_message({
  type: "shutdown_request",
  recipient: "supervisor",
  content: "Pipeline complete, shutting down supervisor"
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID> [feedback]` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |
| `recheck` | Re-run quality check |
| `improve [dimension]` | Auto-improve weakest dimension |

## Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Pipeline complete. What would you like to do?",
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

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/quality-gates.md](specs/quality-gates.md) — Quality gate criteria and scoring
- [specs/knowledge-transfer.md](specs/knowledge-transfer.md) — Artifact and state transfer protocols

## Session Directory

```
{run_dir}/
├── outputs/
│   ├── spec/                   # Spec phase outputs
│   └── plan/                   # Implementation plan + TASK-*.json
├── evidence/
│   └── discussions/            # Discuss round records
├── report.md                   # Human-readable synthesis + handoff
└── work/team/                  # Team coordination (non-artifact)
    ├── team-session.json       # Session state + role registry
    ├── wisdom/                 # Cross-task knowledge
    ├── explorations/           # Shared explore cache
    └── .msg/                   # Team message bus
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Supervisor crash | Respawn with `recovery: true`, auto-rebuilds from existing reports |
| Supervisor not ready for CHECKPOINT | Spawn/respawn supervisor, wait for ready, then wake |
| Completion action fails | Default to Keep Active |
