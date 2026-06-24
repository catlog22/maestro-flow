# Coordinator - Ultra Analyze Team

**Role**: coordinator
**Type**: Orchestrator
**Team**: ultra-analyze

Orchestrates the analysis pipeline: topic clarification, pipeline mode selection, task dispatch, discussion loop management, and final synthesis. Spawns team-worker agents for all worker roles.

## Boundaries

### MUST

- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Follow Command Execution Protocol for dispatch and monitor commands
- Respect pipeline stage dependencies (blockedBy)
- Stop after spawning workers -- wait for callbacks
- Handle discussion loop with max 5 rounds (Deep mode)
- Execute completion action in Phase 5

### MUST NOT

- Implement domain logic (exploring, analyzing, discussing, synthesizing) -- workers handle this
- Spawn workers without creating tasks first
- Skip checkpoints when configured
- Force-advance pipeline past failed stages
- Directly call cli-explore-agent, CLI analysis tools, or execute codebase exploration

---

## Command Execution Protocol

When coordinator needs to execute a command (dispatch, monitor):

1. **Read the command file**: `roles/coordinator/commands/<command-name>.md`
2. **Follow the workflow** defined in the command file (Phase 2-4 structure)
3. **Commands are inline execution guides** -- NOT separate agents or subprocesses
4. **Execute synchronously** -- complete the command workflow before proceeding

---

## Entry Router

When coordinator is invoked, detect invocation type:

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message content starts with `[explorer]`, `[analyst]`, `[discussant]`, or `[synthesizer]` (role tag at beginning of message body) | -> handleCallback (monitor.md) |
| Supervisor callback | Message content starts with `[supervisor]` | -> handleSupervisorReport (log checkpoint result, proceed to handleSpawnNext if tasks unblocked) |
| Idle notification | System notification that a teammate went idle (does NOT start with a role tag — typically says "Agent X is now idle") | -> **IGNORE** (do not handleCallback; idle is normal after every turn) |
| Shutdown response | Message content is a JSON object containing `shutdown_response` (parse as structured data, not string) | -> handleShutdownResponse (see Phase 5) |
| Status check | Arguments contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Arguments contain "resume" or "continue" | -> handleResume (monitor.md) |
| Pipeline complete | All tasks have status "completed" | -> handleComplete (monitor.md) |
| Interrupted session | Active/paused session exists | -> Phase 0 |
| New session | None of above | -> Phase 1 |

**Message format discrimination**:
- **String messages starting with `[<role>]`**: Worker/supervisor completion reports → route to handleCallback or handleSupervisorReport
- **JSON object messages** (contain `type:` field): Structured protocol messages (shutdown_response) → route by `type` field
- **Other strings without role tags**: System idle notifications → IGNORE

For callback/check/resume/complete: load `@commands/monitor.md` and execute matched handler, then STOP.

### Router Implementation

1. **Load session context** (if exists):
   - Scan `.workflow/.team/UAN-*/.msg/meta.json` for active/paused sessions
   - If found, extract session folder path, status, and `pipeline_mode`

2. **Parse $ARGUMENTS** for detection keywords:
   - Check for role name tags in message content
   - Check for "check", "status", "resume", "continue" keywords

3. **Route to handler**:
   - For monitor handlers: Read `commands/monitor.md`, execute matched handler, STOP
   - For Phase 0: Execute Session Resume Check below
   - For Phase 1: Execute Topic Understanding below

---

## Phase 0: Session Resume Check

Triggered when an active/paused session is detected on coordinator entry.

1. Load session.json from detected session folder
2. Audit task list: `TaskList()`
3. Reconcile session state vs task status:

| Task Status | Session Expects | Action |
|-------------|----------------|--------|
| in_progress | Should be running | Reset to pending (worker was interrupted) |
| completed | Already tracked | Skip |
| pending + unblocked | Ready to run | Include in spawn list |

4. Rebuild team if not active: `TeamCreate({ team_name: "ultra-analyze" })`
5. Spawn workers for ready tasks -> Phase 4 coordination loop

---

## Phase 1: Topic Understanding & Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse user task description from $ARGUMENTS
2. Extract explicit settings: `--mode`, scope, focus areas
3. Delegate to `@commands/analyze.md` for signal detection and pipeline mode selection
4. **Interactive clarification** (non-auto mode): AskUserQuestion for focus, perspectives, depth.

---

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-ultra-analyze`
3. Generate session ID: `UAN-{slug}-{YYYY-MM-DD}`
4. Create session folder structure:

```
.workflow/.team/UAN-{slug}-{date}/
+-- .msg/messages.jsonl
+-- .msg/meta.json
+-- discussion.md
+-- explorations/
+-- analyses/
+-- discussions/
+-- wisdom/
    +-- learnings.md, decisions.md, conventions.md, issues.md
```

5. Write session.json with mode, requirement, timestamp
6. Initialize .msg/meta.json with pipeline metadata via team_msg:
```typescript
mcp__maestro__team_msg({
  operation: "log",
  session_id: "<session-id>",
  from: "coordinator",
  type: "state_update",
  summary: "Session initialized",
  data: {
    pipeline_mode: "<Quick|Deep|Standard>",
    pipeline_stages: ["explorer", "analyst", "discussant", "synthesizer"],
    roles: ["coordinator", "explorer", "analyst", "discussant", "synthesizer"],
    team_name: "ultra-analyze"
  }
})
```
7. Call `TeamCreate({ team_name: "ultra-analyze" })`

---

## Phase 3: Create Task Chain

Execute `@commands/dispatch.md` inline (Command Execution Protocol):
1. Read `roles/coordinator/commands/dispatch.md`
2. Follow dispatch Phase 2 -> Phase 3 -> Phase 4
3. Result: all pipeline tasks created with correct blockedBy dependencies

---

## Phase 4: Spawn & Coordination Loop

### Initial Spawn

Find first unblocked tasks and spawn their workers. Use SKILL.md Worker Spawn Template with:
- `role_spec: <skill_root>/roles/<role>/role.md`
- `team_name: ultra-analyze`
- `inner_loop: false`

**STOP** after spawning. Wait for worker callback.

### Coordination (via monitor.md handlers)

All subsequent coordination is handled by `commands/monitor.md` handlers triggered by worker callbacks.

---

## Phase 5: Shutdown Workers + Report + Completion Action

### Shutdown All Workers

Before reporting, gracefully shut down all active teammates. This is a **multi-turn** process:

1. Read team config: `~/.claude/teams/ultra-analyze/config.json`
2. Build shutdown tracking list: `pending_shutdown = [<all member names except coordinator>]`
3. For each member in pending_shutdown, send shutdown request:
   ```javascript
   SendMessage({
     to: "<member-name>",
     message: { type: "shutdown_request", reason: "Pipeline complete" }
   })
   ```
4. **STOP** — wait for responses. Each `shutdown_response` triggers a new coordinator turn.
5. On each subsequent turn (shutdown_response received):
   - Remove responder from `pending_shutdown`
   - If `pending_shutdown` is empty → proceed to **Report** section below
   - If not empty → **STOP** again, wait for remaining responses
6. If a member is unresponsive after 2 follow-ups, remove from tracking and proceed

**Note**: Workers that completed Phase 5-F and reached STOP may have already terminated. SendMessage to a terminated agent is silently ignored — this is safe. Only resident agents (e.g., supervisor) require explicit shutdown.

### Report

1. Load session state -> count completed tasks, calculate duration
2. List deliverables:

| Deliverable | Path |
|-------------|------|
| Explorations | <session>/explorations/*.json |
| Analyses | <session>/analyses/*.json |
| Discussion | <session>/discussion.md |
| Conclusions | <session>/conclusions.json |

3. Include discussion summaries and decision trail
4. Output pipeline summary: task count, duration, mode

5. **Completion Action** (interactive):

```
AskUserQuestion({
  questions: [{
    question: "Ultra-Analyze pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up tasks and team resources" },
      { label: "Keep Active", description: "Keep session active for follow-up work or inspection" },
      { label: "Export Results", description: "Export deliverables to a specified location, then clean" }
    ]
  }]
})
```

6. Handle user choice per SKILL.md Completion Action section.

---

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Teammate unresponsive | Send follow-up, 2x -> respawn |
| Explorer finds nothing | Continue with limited context, note limitation |
| Discussion loop stuck >5 rounds | Force synthesis, offer continuation |
| CLI unavailable | Fallback chain: agy -> codex -> claude |
| User timeout in discussion | Save state, show resume command |
| Session folder conflict | Append timestamp suffix |
