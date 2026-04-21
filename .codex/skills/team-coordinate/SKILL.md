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

User just provides task description.

**Invocation**: `Skill(skill="team-coordinate", args="task description")`

**Lifecycle**:
```
User provides task description
  -> coordinator Phase 1: task analysis (detect capabilities, build dependency graph)
  -> coordinator Phase 2: generate role-specs + initialize session
  -> coordinator Phase 3: create task chain from dependency graph
  -> coordinator Phase 4: spawn first batch workers (background) -> STOP
  -> Worker executes -> callback -> coordinator advances next step
  -> Loop until pipeline complete -> Phase 5 report + completion action
```

**User Commands** (wake paused coordinator):

| Command | Action |
|---------|--------|
| `check` / `status` | Output execution status graph, no advancement |
| `resume` / `continue` | Check worker states, advance next step |
| `revise <TASK-ID> [feedback]` | Revise specific task with optional feedback |
| `feedback <text>` | Inject feedback into active pipeline |
| `improve [dimension]` | Auto-improve weakest quality dimension |

### Coordinator Spawn Template

#### v2 Worker Spawn (all roles)

When coordinator spawns workers, use `team-worker` agent with role-spec path:

```
spawn_agent({
  agent_type: "team_worker",
  task_name: "<task-id>",
  fork_turns: "none",
  message: `## Role Assignment
role: <role>
role_spec: <session-folder>/role-specs/<role>.md
session: <session-folder>
session_id: <session-id>
requirement: <task-description>
inner_loop: <true|false>

Read role_spec file to load Phase 2-4 domain instructions.

## Task Context
task_id: <task-id>
title: <task-title>
description: <task-description>
pipeline_phase: <pipeline-phase>

## Upstream Context
<prev_context>`
})
```

After spawning, use `wait_agent({ timeout_ms: 1800000 })` to collect results (30 min). If `result.timed_out`, send STATUS_CHECK via followup_task (wait 3 min), then FINALIZE with interrupt (wait 3 min), then mark timed_out and close agents. Use `close_agent({ target: <name> })` each worker.

**Inner Loop roles** (role has 2+ serial same-prefix tasks): Set `inner_loop: true`. The team-worker agent handles the loop internally.

**Single-task roles**: Set `inner_loop: false`.

### Model Selection Guide

Roles are **dynamically generated** at runtime. Select model/reasoning_effort based on the generated role's `responsibility_type`:

| responsibility_type | model | reasoning_effort | Rationale |
|---------------------|-------|-------------------|-----------|
| exploration | (default) | medium | Read-heavy, less reasoning needed |
| analysis | (default) | high | Deep analysis requires full reasoning |
| implementation | (default) | high | Code generation needs precision |
| synthesis | (default) | medium | Aggregation over generation |
| review | (default) | high | Quality assessment needs deep reasoning |

Map each generated role's `responsibility_type` (from `team-session.json#roles`) to the table above.

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
| Queue supplementary info (don't interrupt) | `send_message` | Send upstream task findings to a running downstream worker |
| Not used in this skill | `followup_task` | No resident agents -- all workers are one-shot |
| Check running agents | `list_agents` | Verify agent health during resume |

**Note**: Since roles are dynamically generated, the coordinator must resolve task prefixes and role names from `team-session.json#roles` at runtime. There are no hardcoded role-specific examples.

#### fork_turns Strategy

`fork_turns: "none"` is the default. Consider `fork_turns: "all"` only when:
- Runtime analysis reveals the task requires deep familiarity with the full conversation context
- The dynamically-generated role-spec indicates the worker needs project-wide understanding
- The coordinator has already accumulated significant context about the codebase

This decision should be made per-task during Phase 4 based on the role's `responsibility_type`.

#### Agent Health Check

Use `list_agents({})` in handleResume and handleComplete:

```
// Reconcile session state with actual running agents
const running = list_agents({})
// Compare with team-session.json active_workers
// Reset orphaned tasks (in_progress but agent gone) to pending
```

#### Named Agent Targeting

Workers are spawned with `task_name: "<task-id>"` enabling direct addressing:
- `send_message({ target: "<TASK-ID>", message: "..." })` -- queue upstream context without interrupting
- `close_agent({ target: "<TASK-ID>" })` -- cleanup by name

### Completion Action

When pipeline completes (all tasks done), coordinator presents an interactive choice:

```
request_user_input({
  questions: [{
    question: "Team pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory, then clean" }
    ]
  }]
})
```

#### Action Handlers

| Choice | Steps |
|--------|-------|
| Archive & Clean | Update session status="completed" -> output final summary with artifact paths |
| Keep Active | Update session status="paused" -> output: "Resume with: Skill(skill='team-coordinate', args='resume')" |
| Export Results | request_user_input(target path) -> copy artifacts to target -> Archive & Clean |

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

Coordinator supports `resume` / `continue` for interrupted sessions:

1. Scan `.workflow/.team/TC-*/team-session.json` for active/paused sessions
2. Multiple matches -> request_user_input for selection
3. Audit task states -> reconcile session state <-> task status
4. Reset in_progress -> pending (interrupted tasks)
5. Rebuild team and spawn needed workers only
6. Create missing tasks, set dependencies
7. Kick first executable task -> Phase 4 coordination loop
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
