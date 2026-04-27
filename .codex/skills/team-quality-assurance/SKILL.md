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

Spawn via `team-worker` agent. Message includes: role, role_spec path, session folder/id, requirement, inner_loop flag, task context, upstream context. After spawning: `wait_agent` (30 min). Timeout: STATUS_CHECK (3 min) -> FINALIZE (3 min) -> close.

### Model Selection Guide

| Role | reasoning_effort |
|------|-------------------|
| Scout (SCOUT-*) | medium |
| Strategist (QASTRAT-*) | high |
| Generator (QAGEN-*) | high |
| Executor (QARUN-*) | medium |
| Analyst (QAANA-*) | high |

Override via `model`/`reasoning_effort` params in spawn_agent for cost optimization.

### User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--mode=discovery` | Force discovery mode |
| `--mode=testing` | Force testing mode |
| `--mode=full` | Force full QA mode |

### v4 Agent Coordination

**Message Semantics**: `send_message` to queue scout findings to strategist. `list_agents` for health checks. `followup_task` not used (all one-shot workers).

**Pipeline Pattern**: Sequential with GC loops: scout -> strategist -> generator -> executor -> analyst. Generator/executor may loop (max 3 rounds) when coverage below target.

**Agent Health Check**: Reconcile `tasks.json` with `list_agents({})`. Reset orphaned tasks to pending.

**Named Targeting**: `send_message({ target: "QASTRAT-001" })`, `close_agent({ target: "SCOUT-001" })`.

### Completion Action

Present choice: **Archive & Clean** (recommended), **Keep Active**, **Export Results**.

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
