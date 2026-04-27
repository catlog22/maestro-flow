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

Validate session -> Phase 0 (reconcile state, reset interrupted tasks, detect orphans) -> Phase 1 (spawn first batch workers, STOP) -> callback loop (advance next step) -> Phase 2 (report + completion action).

### Worker Spawn Template

Spawn via `team-worker` agent with role-spec path from session. Message includes: role, role_spec, session folder/id, requirement, inner_loop flag, task context, upstream context. After spawning: `wait_agent` (30 min). Timeout: STATUS_CHECK (3 min) -> FINALIZE (3 min) -> mark timed_out, close.

### Model Selection

Implementation/fix roles: `reasoning_effort: "high"`. Verification/test: `"medium"`. Default: `"high"`.

### State Reconciliation

On resume: compare `list_agents({})` with task-analysis.json. Reset orphaned tasks to pending.

### Worker Communication

`send_message` (supplementary context), `followup_task` (assign work to inner_loop worker), `close_agent` (cleanup).

### Completion Action

Present choice: **Archive & Clean** (mark completed, output summary), **Keep Active** (mark paused, output resume command), **Export Results** (prompt path, copy, archive).
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
