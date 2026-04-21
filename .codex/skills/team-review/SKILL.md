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
| Scanner (SCAN-*) | (default) | medium | Toolchain scanning + pattern matching, less reasoning |
| Reviewer (REV-*) | (default) | high | Deep root cause analysis requires full reasoning |
| Fixer (FIX-*) | (default) | high | Code modification needs precision |

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
| `--full` | Enable scan + review + fix pipeline |
| `--fix` | Fix-only mode (skip scan/review) |
| `-q` / `--quick` | Quick scan only |
| `--dimensions=sec,cor,prf,mnt` | Custom dimensions |
| `-y` / `--yes` | Skip confirmations |

### v4 Agent Coordination

#### Message Semantics

| Intent | API | Example |
|--------|-----|---------|
| Send scan findings to running reviewer | `send_message` | Queue scan results to REV-* as supplementary context |
| Not used in this skill | `followup_task` | No resident agents -- sequential 3-stage pipeline |
| Check running agents | `list_agents` | Verify agent health during resume |

#### Pipeline Pattern

This is a **sequential 3-stage pipeline** (scan -> review -> fix). No parallel phases. Each stage completes before the next starts. The coordinator may skip stages (0 findings -> skip review+fix; user declines fix -> skip fix).

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
- `send_message({ target: "REV-001", message: "..." })` -- queue scan findings to running reviewer
- `close_agent({ target: "SCAN-001" })` -- cleanup by name after completion

### Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Review pipeline complete. What would you like to do?",
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
