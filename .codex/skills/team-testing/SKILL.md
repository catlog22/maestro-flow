---
name: team-testing
description: Unified team skill for testing team. Progressive test coverage through Generator-Critic loops, shared memory, and dynamic layer selection. Triggers on "team testing".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Orchestrate multi-agent test pipeline: strategist -> generator -> executor -> analyst. Progressive layer coverage (L1/L2/L3) with Generator-Critic loops for coverage convergence.

```
Skill(skill="team-testing", args="task description")
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
</purpose>

<context>
### Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | STRATEGY-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | TESTGEN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | TESTRUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | TESTANA-* | false |

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

- **Session prefix**: `TST`
- **Session path**: `.workflow/.team/TST-<slug>-<date>/`
- **Team name**: `testing`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro-tools__team_msg(session_id=<session-id>, ...)`

### Worker Spawn Template

Spawn via `team-worker` agent. Message includes: role, role_spec path, session folder/id, requirement, inner_loop flag, task context, upstream context. After spawning: `wait_agent` (30 min). Timeout: STATUS_CHECK (3 min) -> FINALIZE (3 min) -> close.

### Model Selection Guide

| Role | reasoning_effort |
|------|-------------------|
| Strategist (STRATEGY-*) | high |
| Generator (TESTGEN-*) | high |
| Executor (TESTRUN-*) | medium |
| Analyst (TESTANA-*) | high |

Override via `model`/`reasoning_effort` params in spawn_agent for cost optimization.

### User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID>` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |

### v4 Agent Coordination

**Message Semantics**: `send_message` to queue strategy to generators. `list_agents` for health checks. `followup_task` not used (all one-shot).

**Parallel Test Generation**: Spawn multiple generators per layer (L1/L2/L3) in parallel, then executors.

**GC Loop Coordination**: Create dynamic TESTGEN-fix and TESTRUN-fix tasks when coverage below target. Track `gc_rounds[layer]`.

**Agent Health Check**: Reconcile `tasks.json` with `list_agents({})`. Reset orphaned tasks to pending.

**Named Targeting**: `send_message({ target: "TESTGEN-001" })`, `close_agent({ target: "TESTRUN-001" })`.

### Completion Action

Present choice: **Archive & Clean** (recommended), **Keep Active**, **Deepen Coverage** (add layers or raise targets).

### Session Directory

```
.workflow/.team/TST-<slug>-<date>/
+-- .msg/messages.jsonl     # Team message bus
+-- .msg/meta.json          # Session metadata
+-- wisdom/                 # Cross-task knowledge
+-- strategy/               # Strategist output
+-- tests/                  # Generator output (L1-unit/, L2-integration/, L3-e2e/)
+-- results/                # Executor output
+-- analysis/               # Analyst output
```

### Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) -- Team configuration
</context>

<error_codes>

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
</error_codes>

<success_criteria>
- [ ] Role router correctly dispatches to coordinator or worker based on --role flag
- [ ] Pipeline executes strategist -> generator -> executor -> analyst in order
- [ ] Parallel generators spawned per test layer (L1/L2/L3)
- [ ] GC loops create fix tasks dynamically when coverage is below target
- [ ] Session state persisted after each wave
- [ ] Completion action presented and handled correctly
</success_criteria>
