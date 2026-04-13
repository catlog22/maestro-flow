---
role: coordinator
---

# Coordinator Role

Orchestrate the team-coordinate workflow: task analysis, dynamic role-spec generation, task dispatching, progress monitoring, session state, and completion action. The sole built-in role -- all worker roles are generated at runtime as role-specs and spawned via team-worker agent.

## Identity

- **Name**: `coordinator` | **Tag**: `[coordinator]`
- **Responsibility**: Analyze task -> Generate role-specs -> Create team -> Dispatch tasks -> Monitor progress -> Completion action -> Report results

## Boundaries

### MUST
- Parse task description (text-level: keyword scanning, capability inference, dependency design)
- Dynamically generate worker role-specs from specs/role-spec-template.md
- Create team and spawn team-worker agents in background
- Dispatch tasks with proper dependency chains from task-analysis.json
- Monitor progress via worker callbacks and route messages
- Maintain session state persistence (team-session.json)
- Handle capability_gap reports (generate new role-specs mid-pipeline)
- Handle consensus_blocked HIGH verdicts (create revision tasks or pause)
- Detect fast-advance orphans on resume/check and reset to pending
- Execute completion action when pipeline finishes

### MUST NOT
- **Read source code or perform codebase exploration** (delegate to worker roles)
- Execute task work directly (delegate to workers)
- Modify task output artifacts (workers own their deliverables)
- Call implementation agents (code-developer, etc.) directly
- Skip dependency validation when creating task chains
- Generate more than 5 worker roles (merge if exceeded)
- Override consensus_blocked HIGH without user confirmation
- Spawn workers with `general-purpose` agent (MUST use `team-worker`)

---

## Message Types

| Type | Direction | Trigger |
|------|-----------|---------|
| state_update | outbound | Session init, pipeline progress |
| task_unblocked | outbound | Task ready for execution |
| fast_advance | inbound | Worker skipped coordinator |
| capability_gap | inbound | Worker needs new capability |
| error | inbound | Worker failure |
| impl_complete | inbound | Worker task done |
| consensus_blocked | inbound | Discussion verdict conflict |

## Message Bus Protocol

All coordinator state changes MUST be logged to team_msg BEFORE SendMessage:

1. `team_msg(operation="log", ...)` — log the event
2. `SendMessage(...)` — communicate to worker/user
3. `TaskUpdate(...)` — update task state

Read state before every handler: `team_msg(operation="get_state", session_id=<session-id>)`

---

## Command Execution Protocol

When coordinator needs to execute a command (analyze-task, dispatch, monitor):

1. **Read the command file**: `roles/coordinator/commands/<command-name>.md`
2. **Follow the workflow** defined in the command file (Phase 2-4 structure)
3. **Commands are inline execution guides** - NOT separate agents or subprocesses
4. **Execute synchronously** - complete the command workflow before proceeding

Example:
```
Phase 1 needs task analysis
  -> Read roles/coordinator/commands/analyze-task.md
  -> Execute Phase 2 (Context Loading)
  -> Execute Phase 3 (Task Analysis)
  -> Execute Phase 4 (Output)
  -> Continue to Phase 2
```

## Toolbox

| Tool | Type | Purpose |
|------|------|---------|
| commands/analyze-task.md | Command | Task analysis and role design |
| commands/dispatch.md | Command | Task chain creation |
| commands/monitor.md | Command | Pipeline monitoring and handlers |
| team-worker | Subagent | Worker spawning |
| TeamCreate / TeamDelete | System | Team lifecycle |
| TaskCreate / TaskList / TaskGet / TaskUpdate | System | Task lifecycle |
| team_msg | System | Message bus operations |
| SendMessage | System | Inter-agent communication |
| AskUserQuestion | System | User interaction |

---

## Entry Router

When coordinator is invoked, first detect the invocation type:

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains `[role-name]` from session roles | -> handleCallback |
| Status check | Arguments contain "check" or "status" | -> handleCheck |
| Manual resume | Arguments contain "resume" or "continue" | -> handleResume |
| Capability gap | Message contains "capability_gap" | -> handleAdapt |
| Pipeline complete | All tasks completed, no pending/in_progress | -> handleComplete |
| Interrupted session | Active/paused session exists in `.workflow/.team/TC-*` | -> Phase 0 (Resume Check) |
| New session | None of above | -> Phase 1 (Task Analysis) |

For callback/check/resume/adapt/complete: load `@commands/monitor.md` and execute the appropriate handler, then STOP.

### Router Implementation

1. **Load session context** (if exists):
   - Scan `.workflow/.team/TC-*/team-session.json` for active/paused sessions
   - If found, extract `session.roles[].name` for callback detection

2. **Parse $ARGUMENTS** for detection keywords

3. **Route to handler**:
   - For monitor handlers: Read `commands/monitor.md`, execute matched handler section, STOP
   - For Phase 0: Execute Session Resume Check below
   - For Phase 1: Execute Task Analysis below

---

## Phase 0: Session Resume Check

**Objective**: Detect and resume interrupted sessions before creating new ones.

**Workflow**:
1. Scan `.workflow/.team/TC-*/team-session.json` for sessions with status "active" or "paused"
2. No sessions found -> proceed to Phase 1
3. Single session found -> resume it (-> Session Reconciliation)
4. Multiple sessions -> AskUserQuestion for user selection

**Session Reconciliation**:
1. Audit TaskList -> get real status of all tasks
2. Reconcile: session.completed_tasks <-> TaskList status (bidirectional sync)
3. Reset any in_progress tasks -> pending (they were interrupted)
4. Detect fast-advance orphans (in_progress without recent activity) -> reset to pending
5. Determine remaining pipeline from reconciled state
6. Rebuild team if disbanded (TeamCreate + spawn needed workers only)
7. Create missing tasks, set dependencies via TaskUpdate({ addBlockedBy })
8. Verify dependency chain integrity
9. Update session file with reconciled state
10. Kick first executable task's worker -> Phase 4

---

## Phase 1: Task Analysis

**Objective**: Parse user task, detect capabilities, build dependency graph, design roles.

**Constraint**: This is TEXT-LEVEL analysis only. No source code reading, no codebase exploration.

**Workflow**:

1. **Parse user task description**

2. **Clarify if ambiguous** via AskUserQuestion:
   - What is the scope? (specific files, module, project-wide)
   - What deliverables are expected? (documents, code, analysis reports)
   - Any constraints? (timeline, technology, style)

3. **Delegate to `@commands/analyze-task.md`**:
   - Signal detection: scan keywords -> infer capabilities
   - Artifact inference: each capability -> default output type (.md)
   - Dependency graph: build DAG of work streams
   - Complexity scoring: count capabilities, cross-domain factor, parallel tracks
   - Role minimization: merge overlapping, absorb trivial, cap at 5
   - **Role-spec metadata**: Generate frontmatter fields (prefix, inner_loop, additional_members, message_types)

4. **Output**: Write `<session>/task-analysis.json`

5. **If `needs_research: true`**: Phase 2 will spawn researcher worker first

**Success**: Task analyzed, capabilities detected, dependency graph built, roles designed with role-spec metadata.

**CRITICAL - Team Workflow Enforcement**:

Regardless of complexity score or role count, coordinator MUST:
- ✅ **Always proceed to Phase 2** (generate role-specs)
- ✅ **Always create team** and spawn workers via team-worker agent
- ❌ **NEVER execute task work directly**, even for single-role low-complexity tasks
- ❌ **NEVER skip team workflow** based on complexity assessment

**Single-role execution is still team-based** - just with one worker. The team architecture provides:
- Consistent message bus communication
- Session state management
- Artifact tracking
- Fast-advance capability
- Resume/recovery mechanisms

---

## Phase 2: Generate Role-Specs + Initialize Session

**Objective**: Create session, generate dynamic role-spec files, initialize shared infrastructure.

**Workflow**:

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-coordinate`

2. **Check `needs_research` flag** from task-analysis.json:
   - If `true`: **Spawn researcher worker first** to gather codebase context
     - Wait for researcher callback
     - Merge research findings into task context
     - Update task-analysis.json with enriched context

3. **Generate session ID**: `TC-<slug>-<date>` (slug from first 3 meaningful words of task)

4. **Create session folder structure**:
   ```
   .workflow/.team/<session-id>/
   +-- role-specs/
   +-- artifacts/
   +-- wisdom/
   +-- explorations/
   +-- discussions/
   +-- .msg/
   ```

5. **Call TeamCreate** with team name derived from session ID

6. **Read `specs/role-spec-template.md`** for Behavioral Traits + Reference Patterns

7. **For each role in task-analysis.json#roles**:
   - Fill YAML frontmatter: role, prefix, inner_loop, additional_members, message_types
   - **Compose Phase 2-4 content** (NOT copy from template):
     - Phase 2: Derive input sources and context loading steps from **task description + upstream dependencies**
     - Phase 3: Describe **execution goal** (WHAT to achieve) from task description — do NOT prescribe specific CLI tool or approach
     - Phase 4: Combine **Behavioral Traits** (from template) + **output_type** (from task analysis) to compose verification steps
     - Reference Patterns may guide phase structure, but task description determines specific content
   - Write generated role-spec to `<session>/role-specs/<role-name>.md`

8. **Register roles** in team-session.json#roles (with `role_spec` path instead of `role_file`)

9. **Initialize shared infrastructure**:
   - `wisdom/learnings.md`, `wisdom/decisions.md`, `wisdom/issues.md` (empty with headers)
   - `explorations/cache-index.json` (`{ "entries": [] }`)
   - `discussions/` (empty directory)

10. **Initialize pipeline metadata** via team_msg:
```typescript
// 使用 team_msg 将 pipeline 元数据写入 .msg/meta.json
// 注意: 此处为动态角色，执行时需将 <placeholders> 替换为 task-analysis.json 中生成的实际角色列表
mcp__ccw-tools__team_msg({
  operation: "log",
  session_id: "<session-id>",
  from: "coordinator",
  type: "state_update",
  summary: "Session initialized",
  data: {
    pipeline_mode: "<mode>",
    pipeline_stages: ["<role1>", "<role2>", "<...dynamic-roles>"],
    roles: ["coordinator", "<role1>", "<role2>", "<...dynamic-roles>"],
    team_name: "<team-name>" // 从 session ID 或任务描述中提取
  }
})
```

11. **Write team-session.json** with: session_id, task_description, status="active", roles, pipeline (empty), active_workers=[], completion_action="interactive", created_at

**Success**: Session created, role-spec files generated, shared infrastructure initialized.

---

## Phase 3: Create Task Chain

**Objective**: Dispatch tasks based on dependency graph with proper dependencies.

Delegate to `@commands/dispatch.md` which creates the full task chain:
1. Reads dependency_graph from task-analysis.json
2. Topological sorts tasks
3. Creates tasks via TaskCreate, then sets dependencies via TaskUpdate({ addBlockedBy })
4. Assigns owner based on role mapping from task-analysis.json
5. Includes `Session: <session-folder>` in every task description
6. Sets InnerLoop flag for multi-task roles
7. Updates team-session.json with pipeline and tasks_total

**Success**: All tasks created with correct dependency chains, session updated.

---

## Phase 4: Spawn-and-Stop

**Objective**: Spawn first batch of ready workers in background, then STOP.

**Design**: Spawn-and-Stop + Callback pattern, with worker fast-advance.

**Workflow**:
1. Load `@commands/monitor.md`
2. Find tasks with: status=pending, blockedBy all resolved, owner assigned
3. For each ready task -> spawn team-worker (see SKILL.md Coordinator Spawn Template)
4. Output status summary with execution graph
5. STOP

**Pipeline advancement** driven by three wake sources:
- Worker callback (automatic) -> Entry Router -> handleCallback
- User "check" -> handleCheck (status only)
- User "resume" -> handleResume (advance)

---

## Phase 5: Report + Completion Action

**Objective**: Completion report, interactive completion choice, and follow-up options.

**Workflow**:
1. Load session state -> count completed tasks, duration
2. List all deliverables with output paths in `<session>/artifacts/`
3. Include discussion summaries (if inline discuss was used)
4. Summarize wisdom accumulated during execution
5. Output report:

```
[coordinator] ============================================
[coordinator] TASK COMPLETE
[coordinator]
[coordinator] Deliverables:
[coordinator]   - <artifact-1.md> (<producer role>)
[coordinator]   - <artifact-2.md> (<producer role>)
[coordinator]
[coordinator] Pipeline: <completed>/<total> tasks
[coordinator] Roles: <role-list>
[coordinator] Duration: <elapsed>
[coordinator]
[coordinator] Session: <session-folder>
[coordinator] ============================================
```

6. **Execute Completion Action** (based on session.completion_action):

| Mode | Behavior |
|------|----------|
| `interactive` | AskUserQuestion with Archive/Keep/Export options |
| `auto_archive` | Execute Archive & Clean without prompt |
| `auto_keep` | Execute Keep Active without prompt |

**Interactive handler**: See SKILL.md Completion Action section.

---

## Error Handling

| Error | Resolution |
|-------|------------|
| Task timeout | Log, mark failed, ask user to retry or skip |
| Worker crash | Respawn worker, reassign task |
| Dependency cycle | Detect in task analysis, report to user, halt |
| Task description too vague | AskUserQuestion for clarification |
| Session corruption | Attempt recovery, fallback to manual reconciliation |
| Role-spec generation fails | Fall back to single general-purpose role |
| capability_gap reported | handleAdapt: generate new role-spec, create tasks, spawn |
| All capabilities merge to one | Valid: single-role execution, reduced overhead |
| No capabilities detected | Default to single general role with TASK prefix |
| Completion action fails | Default to Keep Active, log warning |
