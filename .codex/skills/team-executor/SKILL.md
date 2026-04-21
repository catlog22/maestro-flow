---
name: team-executor
description: Lightweight session execution skill. Resumes existing team-coordinate sessions for pure execution via team-worker agents. No analysis, no role generation -- only loads and executes. Session path required. Triggers on "Team Executor".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Lightweight session execution skill: load session -> reconcile state -> spawn team-worker agents -> execute -> deliver. **No analysis, no role generation** -- only executes existing team-coordinate sessions.

```
Skill(skill="team-executor")
  args="--session=<path>" [REQUIRED]
         |
  Session Validation
         |
  +-- valid? --+-- NO --> Error immediately
               +-- YES -> Orchestration Mode -> executor
                              |
              +-------+-------+-------+
              v       v       v       v
           [team-worker agents loaded from session role-specs]
```
</purpose>

<context>
$ARGUMENTS — session path (required).

**Parse:** `--session=<path>` — Path to team-coordinate session folder (REQUIRED)

**Validation Steps:**
1. Check `--session` provided
2. Directory exists at path
3. `team-session.json` exists and valid JSON
4. `task-analysis.json` exists and valid JSON
5. `role-specs/` directory has at least one `.md` file
6. Each role in `team-session.json#roles` has corresponding `.md` in `role-specs/`

**Dispatch:**
| Scenario | Action |
|----------|--------|
| No `--session` | ERROR immediately |
| `--session` invalid | ERROR with specific reason |
| Valid session | Orchestration Mode -> executor |

**User Commands** (wake paused executor):
| Command | Action |
|---------|--------|
| `check` / `status` | Output execution status graph, no advancement |
| `resume` / `continue` | Check worker states, advance next step |

**Role Registry:**
| Role | File | Type |
|------|------|------|
| executor | [roles/executor/role.md](roles/executor/role.md) | built-in orchestrator |
| (dynamic) | `<session>/role-specs/<role-name>.md` | loaded from session |

**Integration with team-coordinate:**
| Scenario | Skill |
|----------|-------|
| New task, no session | team-coordinate |
| Existing session, resume execution | **team-executor** |
| Session needs new roles | team-coordinate (with resume) |
| Pure execution, no analysis | **team-executor** |
</context>

<execution>

### Orchestration Lifecycle

```
Validate session
  -> Phase 0: Reconcile state (reset interrupted, detect orphans)
  -> Phase 1: Spawn first batch team-worker agents (background) -> STOP
  -> Worker executes -> callback -> executor advances next step
  -> Loop until pipeline complete -> Phase 2 report + completion action
```

### Worker Spawn Template

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

After spawning: `wait_agent({ timeout_ms: 1800000 })` (30 min). If `result.timed_out`: STATUS_CHECK via followup_task (3 min) → FINALIZE with interrupt (3 min) → mark timed_out, close agents.

### Model Selection Guide

Roles loaded dynamically from session role-specs:
- Implementation/fix roles: `reasoning_effort: "high"`
- Verification/test roles: `reasoning_effort: "medium"`
- Default when unclear: `reasoning_effort: "high"`

### State Reconciliation

On resume, reconcile session state with actual running agents:
```
const running = list_agents({})
// Compare with task-analysis.json active tasks
// Reset orphaned tasks (in_progress but agent gone) to pending
```

### Worker Communication

- `send_message({ target: "<task-id>", message: "..." })` — queue supplementary context
- `followup_task({ target: "<task-id>", message: "..." })` — assign new work to inner_loop worker
- `close_agent({ target: "<task-id>" })` — cleanup completed worker

### Completion Action

```
request_user_input({
  questions: [{
    question: "Team pipeline complete. What would you like to do?",
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory, then clean" }
    ]
  }]
})
```

| Choice | Steps |
|--------|-------|
| Archive & Clean | Update session status="completed" -> output final summary with artifact paths |
| Keep Active | Update session status="paused" -> output resume command |
| Export Results | request_user_input(target path) -> copy artifacts -> Archive & Clean |
</execution>

<error_codes>
| Scenario | Resolution |
|----------|------------|
| No --session provided | ERROR immediately with usage message |
| Session directory not found | ERROR with path, suggest checking path |
| team-session.json missing | ERROR, session incomplete, suggest re-run team-coordinate |
| task-analysis.json missing | ERROR, session incomplete, suggest re-run team-coordinate |
| No role-specs in session | ERROR, session incomplete, suggest re-run team-coordinate |
| Role-spec file not found | ERROR with expected path |
| capability_gap reported | Warn only, cannot generate new role-specs |
| Fast-advance spawns wrong task | Executor reconciles on next callback |
| Completion action fails | Default to Keep Active, log warning |
</error_codes>

<success_criteria>
- [ ] Session validated (all required files present)
- [ ] State reconciled on resume (orphaned tasks reset)
- [ ] Team-worker agents spawned with correct role-specs
- [ ] Workers complete or timeout handled gracefully
- [ ] Pipeline advances step-by-step through all tasks
- [ ] Completion action presented and executed
- [ ] Session state updated throughout lifecycle
</success_criteria>
