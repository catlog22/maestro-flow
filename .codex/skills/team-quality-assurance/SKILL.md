---
name: team-quality-assurance
description: Unified team skill for quality assurance. Full closed-loop QA combining issue discovery and software testing. Triggers on "team quality-assurance", "team qa".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Orchestrate multi-agent QA: scout -> strategist -> generator -> executor -> analyst. Supports discovery, testing, and full closed-loop modes with parallel generation and GC loops.

```
Skill(skill="team-quality-assurance", args="task description")
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
</purpose>

<context>
### Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| scout | [roles/scout/role.md](roles/scout/role.md) | SCOUT-* | false |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | QASTRAT-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | QAGEN-* | false |
| executor | [roles/executor/role.md](roles/executor/role.md) | QARUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | QAANA-* | false |

### Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `roles/coordinator/role.md`, execute entry router

### Delegation Lock

**Coordinator is a PURE ORCHESTRATOR. It coordinates, it does NOT do.**

Before calling ANY tool, apply this check:

| Tool Call | Verdict | Reason |
|-----------|---------|--------|
| `spawn_agent`, `wait_agent`, `close_agent`, `send_message`, `followup_task` | ALLOWED | Orchestration |
| `list_agents` | ALLOWED | Agent health check |
| `request_user_input` | ALLOWED | User interaction |
| `mcp__maestro-tools__team_msg` | ALLOWED | Message bus |
| `Read/Write` on `.workflow/.team/` files | ALLOWED | Session state |
| `Read` on `roles/`, `commands/`, `specs/` | ALLOWED | Loading own instructions |
| `Read/Grep/Glob` on project source code | BLOCKED | Delegate to worker |
| `Edit` on any file outside `.workflow/` | BLOCKED | Delegate to worker |
| `Bash("maestro delegate ...")` | BLOCKED | Only workers call CLI |
| `Bash` running build/test/lint commands | BLOCKED | Delegate to worker |

**If a tool call is BLOCKED**: STOP. Create a task, spawn a worker.

**No exceptions for "simple" tasks.** Even a single-file read-and-report MUST go through spawn_agent.

### Shared Constants

- **Session prefix**: `QA`
- **Session path**: `.workflow/.team/QA-<slug>-<date>/`
- **Team name**: `quality-assurance`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro-tools__team_msg(session_id=<session-id>, ...)`

### Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({
  agent_type: "team_worker",
  task_name: "<task-id>",
  fork_turns: "none",
  message: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
requirement: <task-description>
inner_loop: <true|false>

Read role_spec file (<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.

## Task Context
task_id: <task-id>
title: <task-title>
description: <task-description>
pipeline_phase: <pipeline-phase>

## Upstream Context
<prev_context>`
})
```

After spawning, use `wait_agent({ timeout_ms: 1800000 })` to collect results (30 min). If `result.timed_out`, send STATUS_CHECK via followup_task (wait 3 min), then FINALIZE with interrupt (wait 3 min), then mark timed_out and close agents. Use `close_agent({ target })` each worker.

### Model Selection Guide

| Role | model | reasoning_effort | Rationale |
|------|-------|-------------------|-----------|
| Scout (SCOUT-*) | (default) | medium | Issue discovery scanning, less reasoning needed |
| Strategist (QASTRAT-*) | (default) | high | Test strategy design requires deep analysis |
| Generator (QAGEN-*) | (default) | high | Test code generation needs precision |
| Executor (QARUN-*) | (default) | medium | Running tests and collecting results |
| Analyst (QAANA-*) | (default) | high | Quality analysis and coverage assessment |

Override model/reasoning_effort in spawn_agent when cost optimization is needed:
```
spawn_agent({
  agent_type: "team_worker",
  task_name: "<task-id>",
  fork_turns: "none",
  model: "<model-override>",
  reasoning_effort: "<effort-level>",
  message: "..."
})
```

### User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--mode=discovery` | Force discovery mode |
| `--mode=testing` | Force testing mode |
| `--mode=full` | Force full QA mode |

### v4 Agent Coordination

#### Message Semantics

| Intent | API | Example |
|--------|-----|---------|
| Send scout findings to running strategist | `send_message` | Queue issue scan results to QASTRAT-* |
| Not used in this skill | `followup_task` | No resident agents -- all workers are one-shot |
| Check running agents | `list_agents` | Verify agent health during resume |

#### Pipeline Pattern

Sequential pipeline with GC loops: scout -> strategist -> generator -> executor -> analyst. The executor/generator may loop via GC fix tasks when coverage is below target (max 3 rounds).

#### Agent Health Check

Use `list_agents({})` in handleResume and handleComplete:

```
// Reconcile session state with actual running agents
const running = list_agents({})
// Compare with tasks.json active_agents
// Reset orphaned tasks (in_progress but agent gone) to pending
```

#### Named Agent Targeting

Workers are spawned with `task_name: "<task-id>"` enabling direct addressing:
- `send_message({ target: "QASTRAT-001", message: "..." })` -- queue scout findings to running strategist
- `close_agent({ target: "SCOUT-001" })` -- cleanup by name after completion

### Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Quality Assurance pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
```

### Session Directory

```
.workflow/.team/QA-<slug>-<date>/
+-- .msg/messages.jsonl     # Team message bus
+-- .msg/meta.json          # Session state + shared memory
+-- wisdom/                 # Cross-task knowledge
+-- scan/                   # Scout output
+-- strategy/               # Strategist output
+-- tests/                  # Generator output (L1/, L2/, L3/)
+-- results/                # Executor output
+-- analysis/               # Analyst output
```

### Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) -- Team configuration and shared memory schema
</context>

<error_codes>

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| Scout finds no issues | Report clean scan, skip to testing mode |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
</error_codes>

<success_criteria>
- [ ] Role router correctly dispatches to coordinator or worker based on --role flag
- [ ] Pipeline mode detected (discovery/testing/full) from task description
- [ ] Scout -> strategist -> generator -> executor -> analyst executed in order
- [ ] GC loops create fix tasks when coverage is below target (max 3 rounds)
- [ ] Session state persisted after each pipeline stage
- [ ] Completion action presented and handled correctly
</success_criteria>
