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

Spawn via `team-worker` agent. Message includes: role, role_spec path (`<skill_root>/roles/<role>/role.md`), session folder/id, requirement, inner_loop flag, task context (id, title, description, pipeline_phase), upstream context. Worker executes: Phase 1 (discovery) -> role Phase 2-4 -> Phase 5 (report).

### Supervisor Spawn Template

Supervisor is a **resident agent** (`team_supervisor`), independent from team_worker.

- **Spawn** (Phase 2, once): Load role-spec from `roles/supervisor/role.md`, init baseline context, go idle
- **Wake** (per CHECKPOINT): `followup_task` with checkpoint task_id, upstream scope, progress. `wait_agent` (30 min)
- **Shutdown**: `close_agent({ target: "supervisor" })` at pipeline end

### Model Selection Guide

| Role | reasoning_effort |
|------|-------------------|
| Analyst (RESEARCH-*) | medium |
| Writer (DRAFT-*) | high |
| Planner (PLAN-*) | high |
| Executor (IMPL-*) | high |
| Tester (TEST-*) | high |
| Reviewer (REVIEW-*, QUALITY-*, IMPROVE-*) | high |
| Supervisor (CHECKPOINT-*) | medium |

Override via `model`/`reasoning_effort` params in spawn_agent for cost optimization.

### v4 Agent Coordination

**Message Semantics**: `send_message` for supplementary info to workers. `followup_task` to wake supervisor for checkpoints. `list_agents` for health checks.

**CRITICAL**: Supervisor is a **resident agent** woken via `followup_task`, NOT `send_message`. Regular workers are one-shot; supervisor persists across checkpoints.

**Agent Health Check**: Reconcile `tasks.json.active_agents` with `list_agents({})`. Reset orphaned tasks to pending. If supervisor missing but CHECKPOINT tasks pending, respawn.

**Named Targeting**: `send_message({ target: "IMPL-001" })`, `followup_task({ target: "supervisor" })`, `close_agent({ target: ... })`.

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

Present choice via `request_user_input`: **Archive & Clean** (recommended), **Keep Active**, **Export Results**.

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

Per wave: load state from `tasks.json` -> skip tasks with failed deps -> build upstream context from `discoveries/{id}.json` -> separate regular vs CHECKPOINT tasks -> spawn regular workers (`wait_agent` 30 min, timeout: STATUS_CHECK 3 min -> FINALIZE 3 min -> close) -> collect results to `discoveries/`, update `tasks.json` -> execute checkpoints via `followup_task` to supervisor -> handle `block` verdict (prompt: Override/Revise/Abort) -> persist state.
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
