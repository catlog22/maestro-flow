---
name: team-coordinate
description: Universal team coordination skill with dynamic role generation. Uses team-worker agent architecture with role-spec files. Only coordinator is built-in -- all worker roles are generated at runtime as role-specs and spawned via team-worker agent. Beat/cadence model for orchestration. Triggers on "Team Coordinate ".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Universal team coordination skill: analyze task -> generate role-specs -> dispatch -> execute -> deliver. Only the **coordinator** is built-in. All worker roles are **dynamically generated** as lightweight role-spec files and spawned via the `team-worker` agent.

```
+---------------------------------------------------+
|  Skill(skill="team-coordinate")                 |
|  args="task description"                           |
+-------------------+-------------------------------+
                    |
         Orchestration Mode (auto -> coordinator)
                    |
              Coordinator (built-in)
              Phase 0-5 orchestration
                    |
    +-------+-------+-------+-------+
    v       v       v       v       v
 [team-worker agents, each loaded with a dynamic role-spec]
  (roles generated at runtime from task analysis)

  CLI Tools (callable by any worker):
    maestro delegate --mode analysis  - analysis and exploration
    maestro delegate --mode write     - code generation and modification
```
</purpose>

<context>
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

**No exceptions for "simple" tasks.** Even a single-file read-and-report MUST go through spawn_agent. The overhead is the feature -- it provides session tracking, artifact persistence, and resume capability.

### Shared Constants

| Constant | Value |
|----------|-------|
| Session prefix | `TC` |
| Session path | `.workflow/.team/TC-<slug>-<date>/` |
| Worker agent | `team-worker` |
| Message bus | `mcp__maestro-tools__team_msg(session_id=<session-id>, ...)` |
| CLI analysis | `maestro delegate --mode analysis` |
| CLI write | `maestro delegate --mode write` |
| Max roles | 5 |

### Role Router

This skill is **coordinator-only**. Workers do NOT invoke this skill -- they are spawned as `team-worker` agents directly.

Parse `$ARGUMENTS`. No `--role` needed -- always routes to coordinator.

### Role Registry

Only coordinator is statically registered. All other roles are dynamic, stored as role-specs in session.

| Role | File | Type |
|------|------|------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | built-in orchestrator |
| (dynamic) | `<session>/role-specs/<role-name>.md` | runtime-generated role-spec |

### CLI Tool Usage

Workers can use CLI tools for analysis and code operations:

| Tool | Purpose |
|------|---------|
| maestro delegate --mode analysis | Analysis, exploration, pattern discovery |
| maestro delegate --mode write | Code generation, modification, refactoring |

### Orchestration Mode

**Invocation**: `Skill(skill="team-coordinate", args="task description")`

**Lifecycle**: Phase 1 (task analysis, dependency graph) -> Phase 2 (generate role-specs, init session) -> Phase 3 (create task chain) -> Phase 4 (spawn workers, STOP) -> callback loop -> Phase 5 (report + completion).

**User Commands** (wake paused coordinator):

| Command | Action |
|---------|--------|
| `check` / `status` | Output execution status graph, no advancement |
| `resume` / `continue` | Check worker states, advance next step |
| `revise <TASK-ID> [feedback]` | Revise specific task with optional feedback |
| `feedback <text>` | Inject feedback into active pipeline |
| `improve [dimension]` | Auto-improve weakest quality dimension |

### Worker Spawn Template

Spawn via `team-worker` agent with role-spec path. Message includes: role, role_spec path, session folder, session_id, requirement, inner_loop flag, task context (id, title, description, pipeline_phase), and upstream context from prior tasks.

After spawning: `wait_agent` (30 min timeout). On timeout: STATUS_CHECK via followup_task (3 min) -> FINALIZE with interrupt (3 min) -> mark timed_out, close agent.

**Inner Loop**: Set `inner_loop: true` for roles with 2+ serial same-prefix tasks. Single-task roles: `inner_loop: false`.

### Model Selection Guide

Map each role's `responsibility_type` (from `team-session.json#roles`) to reasoning effort:

| responsibility_type | reasoning_effort |
|---------------------|-------------------|
| exploration | medium |
| analysis | high |
| implementation | high |
| synthesis | medium |
| review | high |

Override via `model`/`reasoning_effort` params in spawn_agent for cost optimization.

### v4 Agent Coordination

**Message Semantics**: `send_message` to queue supplementary info to downstream workers (non-interrupting). `list_agents` for health checks. `followup_task` not used (all workers are one-shot).

**fork_turns**: Default `"none"`. Use `"all"` only when task requires deep familiarity with full conversation context (decided per-task in Phase 4).

**Agent Health Check**: On resume/complete, reconcile `team-session.json.active_workers` with `list_agents({})`. Reset orphaned tasks (in_progress but agent gone) to pending.

**Named Targeting**: Workers spawned with `task_name: "<task-id>"` for `send_message`/`close_agent` by name.

### Completion Action

Present interactive choice via `request_user_input`: **Archive & Clean** (recommended -- mark completed, output summary), **Keep Active** (mark paused, output resume command), **Export Results** (prompt target path, copy artifacts, then archive).

### Specs Reference

| Spec | Purpose |
|------|---------|
| [specs/pipelines.md](specs/pipelines.md) | Dynamic pipeline model, task naming, dependency graph |
| [specs/role-spec-template.md](specs/role-spec-template.md) | Template for dynamic role-spec generation |
| [specs/quality-gates.md](specs/quality-gates.md) | Quality thresholds and scoring dimensions |
| [specs/knowledge-transfer.md](specs/knowledge-transfer.md) | Context transfer protocols between roles |

### Session Directory

```
.workflow/.team/TC-<slug>-<date>/
+-- team-session.json           # Session state + dynamic role registry
+-- task-analysis.json          # Phase 1 output: capabilities, dependency graph
+-- role-specs/                 # Dynamic role-spec definitions (generated Phase 2)
|   +-- <role-1>.md             # Lightweight: frontmatter + Phase 2-4 only
|   +-- <role-2>.md
+-- artifacts/                  # All MD deliverables from workers
|   +-- <artifact>.md
+-- .msg/                       # Team message bus + state
|   +-- messages.jsonl          # Message log
|   +-- meta.json               # Session metadata + cross-role state
+-- wisdom/                     # Cross-task knowledge
|   +-- learnings.md
|   +-- decisions.md
|   +-- issues.md
+-- explorations/               # Shared explore cache
|   +-- cache-index.json
|   +-- explore-<angle>.json
+-- discussions/                # Inline discuss records
|   +-- <round>.md
```

#### team-session.json Schema

```json
{
  "session_id": "TC-<slug>-<date>",
  "task_description": "<original user input>",
  "status": "active | paused | completed",
  "team_name": "<team-name>",
  "roles": [
    {
      "name": "<role-name>",
      "prefix": "<PREFIX>",
      "responsibility_type": "<type>",
      "inner_loop": false,
      "role_spec": "role-specs/<role-name>.md"
    }
  ],
  "pipeline": {
    "dependency_graph": {},
    "tasks_total": 0,
    "tasks_completed": 0
  },
  "active_workers": [],
  "completed_tasks": [],
  "completion_action": "interactive",
  "created_at": "<timestamp>"
}
```

### Session Resume

Scan `TC-*/team-session.json` for active/paused sessions (prompt if multiple). Reconcile state: reset interrupted tasks to pending, rebuild team, spawn needed workers, resume Phase 4 loop.
</context>

<error_codes>

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Dynamic role-spec not found | Error, coordinator may need to regenerate |
| Command file not found | Fallback to inline execution |
| CLI tool fails | Worker proceeds with direct implementation, logs warning |
| Explore cache corrupt | Clear cache, re-explore |
| Fast-advance spawns wrong task | Coordinator reconciles on next callback |
| capability_gap reported | Coordinator generates new role-spec via handleAdapt |
| Completion action fails | Default to Keep Active, log warning |
</error_codes>

<success_criteria>
- [ ] Task analysis produces dependency graph and role definitions
- [ ] Role-spec files generated in session directory
- [ ] Workers spawned via team-worker agent with correct role-spec paths
- [ ] Pipeline executes wave-by-wave respecting dependency graph
- [ ] Session state persisted in team-session.json after each wave
- [ ] Completion action presented and handled correctly
- [ ] Session resumable after interruption
</success_criteria>
