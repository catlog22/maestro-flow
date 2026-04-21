---
name: team-lifecycle-v4
description: Full lifecycle team skill with clean architecture. SKILL.md is a universal router — all roles read it. Beat model is coordinator-only. Structure is roles/ + specs/ + templates/. Triggers on "team lifecycle v4".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), request_user_input(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Orchestrate multi-agent software development: specification -> planning -> implementation -> testing -> review.

```
Skill(skill="team-lifecycle-v4", args="task description")
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
     +-- analyze -> dispatch -> spawn -> wait -> collect
                                 |
                    +--------+---+--------+
                    v        v            v
            spawn_agent    ...     spawn_agent
          (team_worker)         (team_supervisor)
              per-task             resident agent
              lifecycle            followup_task-driven
                    |                     |
                    +-- wait_agent --------+
                              |
                         collect results
```
</purpose>

<context>
### Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | RESEARCH-* | false |
| writer | [roles/writer/role.md](roles/writer/role.md) | DRAFT-* | true |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | IMPL-* | true |
| tester | [roles/tester/role.md](roles/tester/role.md) | TEST-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REVIEW-*, QUALITY-*, IMPROVE-* | false |
| supervisor | [roles/supervisor/role.md](roles/supervisor/role.md) | CHECKPOINT-* | false |

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
| `Read` on `roles/`, `commands/`, `specs/`, `templates/` | ALLOWED | Loading own instructions |
| `Read/Grep/Glob` on project source code | BLOCKED | Delegate to worker |
| `Edit` on any file outside `.workflow/` | BLOCKED | Delegate to worker |
| `Bash("maestro delegate ...")` | BLOCKED | Only workers call CLI |
| `Bash` running build/test/lint commands | BLOCKED | Delegate to worker |

**If a tool call is BLOCKED**: STOP. Create a task, spawn a worker.

**No exceptions for "simple" tasks.** Even a single-file read-and-report MUST go through spawn_agent.

### Shared Constants

- **Session prefix**: `TLV4`
- **Session path**: `.workflow/.team/TLV4-<slug>-<date>/`
- **State file**: `<session>/tasks.json`
- **Discovery files**: `<session>/discoveries/{task_id}.json`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)

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
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).

## Task Context
task_id: <task-id>
title: <task-title>
description: <task-description>
pipeline_phase: <pipeline-phase>

## Upstream Context
<prev_context>`
})
```

### Supervisor Spawn Template

Supervisor is a **resident agent** (independent from team_worker). Spawned once during session init, woken via followup_task for each CHECKPOINT task.

#### Spawn (Phase 2 -- once per session)

```
supervisorId = spawn_agent({
  agent_type: "team_supervisor",
  task_name: "supervisor",
  fork_turns: "none",
  message: `## Role Assignment
role: supervisor
role_spec: <skill_root>/roles/supervisor/role.md
session: <session-folder>
session_id: <session-id>
requirement: <task-description>

Read role_spec file (<skill_root>/roles/supervisor/role.md) to load checkpoint definitions.
Init: load baseline context, report ready, go idle.
Wake cycle: orchestrator sends checkpoint requests via followup_task.`
})
```

#### Wake (per CHECKPOINT task)

```
followup_task({
  target: "supervisor",
  message: `## Checkpoint Request
task_id: <CHECKPOINT-NNN>
scope: [<upstream-task-ids>]
pipeline_progress: <done>/<total> tasks completed`
})
wait_agent({ timeout_ms: 1800000 })  // 30 min
```

#### Shutdown (pipeline complete)

```
close_agent({ target: "supervisor" })
```

### Model Selection Guide

| Role | model | reasoning_effort | Rationale |
|------|-------|-------------------|-----------|
| Analyst (RESEARCH-*) | (default) | medium | Read-heavy exploration, less reasoning needed |
| Writer (DRAFT-*) | (default) | high | Spec writing requires precision and completeness |
| Planner (PLAN-*) | (default) | high | Architecture decisions need full reasoning |
| Executor (IMPL-*) | (default) | high | Code generation needs precision |
| Tester (TEST-*) | (default) | high | Test generation requires deep code understanding |
| Reviewer (REVIEW-*, QUALITY-*, IMPROVE-*) | (default) | high | Deep analysis for quality assessment |
| Supervisor (CHECKPOINT-*) | (default) | medium | Gate checking, report aggregation |

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

### v4 Agent Coordination

#### Message Semantics

| Intent | API | Example |
|--------|-----|---------|
| Queue supplementary info (don't interrupt) | `send_message` | Send planning results to running implementers |
| Wake resident supervisor for checkpoint | `followup_task` | Trigger CHECKPOINT-* evaluation on supervisor |
| Supervisor reports back to coordinator | `send_message` | Supervisor sends checkpoint verdict as supplementary info |
| Check running agents | `list_agents` | Verify agent + supervisor health during resume |

**CRITICAL**: The supervisor is a **resident agent** woken via `followup_task`, NOT `send_message`. Regular workers complete and are closed; the supervisor persists across checkpoints. See "Supervisor Spawn Template" above.

#### Agent Health Check

Use `list_agents({})` in handleResume and handleComplete:

```
// Reconcile session state with actual running agents
const running = list_agents({})
// Compare with tasks.json active_agents
// Reset orphaned tasks (in_progress but agent gone) to pending
// ALSO check supervisor: if supervisor missing but CHECKPOINT tasks pending -> respawn
```

#### Named Agent Targeting

Workers are spawned with `task_name: "<task-id>"` enabling direct addressing:
- `send_message({ target: "IMPL-001", message: "..." })` -- queue planning context to running implementer
- `followup_task({ target: "supervisor", message: "..." })` -- wake supervisor for checkpoint
- `close_agent({ target: "IMPL-001" })` -- cleanup regular worker by name
- `close_agent({ target: "supervisor" })` -- shutdown supervisor at pipeline end

### User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID> [feedback]` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |
| `recheck` | Re-run quality check |
| `improve [dimension]` | Auto-improve weakest dimension |

### Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up resources" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
```

### Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/quality-gates.md](specs/quality-gates.md) -- Quality gate criteria and scoring
- [specs/knowledge-transfer.md](specs/knowledge-transfer.md) -- Artifact and state transfer protocols

### Session Directory

```
.workflow/.team/TLV4-<slug>-<date>/
+-- tasks.json                  # Task state (JSON)
+-- discoveries/                # Per-task findings ({task_id}.json)
+-- spec/                       # Spec phase outputs
+-- plan/                       # Implementation plan
+-- artifacts/                  # All deliverables
+-- wisdom/                     # Cross-task knowledge
+-- explorations/               # Shared explore cache
+-- discussions/                # Discuss round records
```
</context>

<execution>

### Wave Execution Engine

For each wave in the pipeline:

1. **Load state** -- Read `<session>/tasks.json`, filter tasks for current wave
2. **Skip failed deps** -- Mark tasks whose dependencies failed/skipped as `skipped`
3. **Build upstream context** -- For each task, gather findings from `context_from` tasks via tasks.json and `discoveries/{id}.json`
4. **Separate task types** -- Split into regular tasks and CHECKPOINT tasks
5. **Spawn regular tasks** -- For each regular task, call `spawn_agent({ agent_type: "team_worker", message: "..." })`, collect agent IDs
6. **Wait** -- `wait_agent({ timeout_ms: 1800000 })` (30 min). If `result.timed_out`, send STATUS_CHECK via followup_task (wait 3 min), then FINALIZE with interrupt (wait 3 min), then mark timed_out and close agents.
7. **Collect results** -- Read `discoveries/{task_id}.json` for each agent, update tasks.json status/findings/error, then `close_agent({ target })` each worker
8. **Execute checkpoints** -- For each CHECKPOINT task, `followup_task` to supervisor, `wait_agent`, read checkpoint report from `artifacts/`, parse verdict
9. **Handle block** -- If verdict is `block`, prompt user via `request_user_input` with options: Override / Revise upstream / Abort
10. **Persist** -- Write updated state to `<session>/tasks.json`
</execution>

<error_codes>

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Supervisor crash | Respawn with `recovery: true`, auto-rebuilds from existing reports |
| Supervisor not ready for CHECKPOINT | Spawn/respawn supervisor, wait for ready, then wake |
| Completion action fails | Default to Keep Active |
| Worker timeout | Mark task as failed, continue wave |
| Discovery file missing | Mark task as failed with "No discovery file produced" |
</error_codes>

<success_criteria>
- [ ] Role router correctly dispatches to coordinator or worker based on --role flag
- [ ] Coordinator spawns workers with correct role-spec paths and task context
- [ ] Supervisor spawned once and woken via followup_task for checkpoints
- [ ] Wave execution engine processes tasks in dependency order
- [ ] Checkpoint verdicts respected (block prompts user, pass continues)
- [ ] Session state persisted in tasks.json after each wave
- [ ] Agent health reconciled on resume (orphaned tasks reset to pending)
- [ ] Completion action presented and handled correctly
</success_criteria>
