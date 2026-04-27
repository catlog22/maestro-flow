---
name: team-review
description: "Unified team skill for code review. 3-role pipeline: scanner, reviewer, fixer. Triggers on team-review."
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__ace-tool__search_context(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Orchestrate multi-agent code review: scanner -> reviewer -> fixer. Toolchain + LLM scan, deep analysis with root cause enrichment, and automated fix with rollback-on-failure.

```
Skill(skill="team-review", args="task description")
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
                    +-------+-------+-------+
                    v       v       v
                [scan]  [review]  [fix]
                team-worker agents, each loads roles/<role>/role.md
```
</purpose>

<context>
### Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | SCAN-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REV-* | false |
| fixer | [roles/fixer/role.md](roles/fixer/role.md) | FIX-* | true |

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

- **Session prefix**: `RV`
- **Session path**: `.workflow/.team/RV-<slug>-<date>/`
- **Team name**: `review`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro-tools__team_msg(session_id=<session-id>, ...)`

### Worker Spawn Template

Spawn via `team-worker` agent. Message includes: role, role_spec path, session folder/id, requirement, inner_loop flag, task context, upstream context. After spawning: `wait_agent` (30 min). Timeout: STATUS_CHECK (3 min) -> FINALIZE (3 min) -> close.

### Model Selection Guide

| Role | reasoning_effort |
|------|-------------------|
| Scanner (SCAN-*) | medium |
| Reviewer (REV-*) | high |
| Fixer (FIX-*) | high |

Override via `model`/`reasoning_effort` params in spawn_agent for cost optimization.

### User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--full` | Enable scan + review + fix pipeline |
| `--fix` | Fix-only mode (skip scan/review) |
| `-q` / `--quick` | Quick scan only |
| `--dimensions=sec,cor,prf,mnt` | Custom dimensions |
| `-y` / `--yes` | Skip confirmations |

### v4 Agent Coordination

**Message Semantics**: `send_message` to queue scan findings to reviewer. `list_agents` for health checks. `followup_task` not used (sequential pipeline).

**Pipeline Pattern**: Sequential 3-stage (scan -> review -> fix). May skip stages: 0 findings skips review+fix; user declines fix skips fix.

**Agent Health Check**: Reconcile `tasks.json` with `list_agents({})`. Reset orphaned tasks to pending.

**Named Targeting**: `send_message({ target: "REV-001" })`, `close_agent({ target: "SCAN-001" })`.

### Completion Action

Present choice: **Archive & Clean** (recommended), **Keep Active**, **Export Results**.

### Session Directory

```
.workflow/.team/RV-<slug>-<date>/
+-- .msg/messages.jsonl     # Team message bus
+-- .msg/meta.json          # Session state + cross-role state
+-- wisdom/                 # Cross-task knowledge
+-- scan/                   # Scanner output
+-- review/                 # Reviewer output
+-- fix/                    # Fixer output
```

### Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/dimensions.md](specs/dimensions.md) -- Review dimension definitions (SEC/COR/PRF/MNT)
- [specs/finding-schema.json](specs/finding-schema.json) -- Finding data schema
- [specs/team-config.json](specs/team-config.json) -- Team configuration
</context>

<error_codes>

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| Scanner finds 0 findings | Report clean, skip review + fix |
| User declines fix | Delete FIX tasks, complete with review-only results |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
</error_codes>

<success_criteria>
- [ ] Role router correctly dispatches to coordinator or worker based on --role flag
- [ ] Sequential pipeline: scan -> review -> fix executed in order
- [ ] Scanner findings passed as upstream context to reviewer
- [ ] Fix stage skipped when scanner finds 0 findings or user declines
- [ ] Session state persisted after each pipeline stage
- [ ] Completion action presented and handled correctly
</success_criteria>
