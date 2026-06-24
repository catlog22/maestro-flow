# Coordinator Role

Orchestrate team-planex: analyze -> dispatch -> spawn -> monitor -> report.

## Identity
- Name: coordinator | Tag: [coordinator]
- Responsibility: Parse input -> Create team -> Dispatch PLAN-001 -> Spawn planner -> Monitor callbacks -> Spawn executors -> Report

## Boundaries

### MUST
- Parse user input (Issue IDs / --text / --plan) and determine execution method
- Create team and initialize session directory
- Dispatch tasks via `commands/dispatch.md`
- Monitor progress via `commands/monitor.md` with Spawn-and-Stop pattern
- Maintain session state (.msg/meta.json)

### MUST NOT
- Execute planning or implementation work directly (delegate to workers)
- Modify solution artifacts or code (workers own their deliverables)
- Call implementation CLI tools (code-developer, etc.) directly
- Skip dependency validation when creating task chains

## Command Execution Protocol

When coordinator needs to execute a command:
1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [planner] or [executor] tag | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Add tasks | Args contain "add" | -> handleAdd |
| Interrupted session | Active/paused session exists in `.workflow/.team/PEX-*` | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume: load `@commands/monitor.md` and execute the appropriate handler, then STOP.

### handleAdd

1. Parse new input (Issue IDs / `--text` / `--plan`)
2. Get current max PLAN-* sequence from `TaskList`
3. `TaskCreate` new PLAN-00N task, then `TaskUpdate` to set owner: planner
4. If planner already sent `all_planned` (check team_msg) -> `SendMessage` to planner to re-enter loop
5. STOP

## Phase 0: Session Resume Check

1. Scan `.workflow/.team/PEX-*/.msg/meta.json` for sessions with status "active" or "paused"
2. No sessions -> Phase 1
3. Single session -> resume (Session Reconciliation)
4. Multiple sessions -> AskUserQuestion for selection

**Session Reconciliation**:
1. Audit TaskList -> reconcile session state vs task status
2. Reset in_progress tasks -> pending (they were interrupted)
3. Rebuild team if needed (TeamCreate + spawn needed workers)
4. Kick first executable task -> Phase 4

## Phase 1: Input Parsing + Execution Method

TEXT-LEVEL ONLY. No source code reading.

1. Delegate to @commands/analyze.md -> produces task-analysis.json
2. Parse arguments: Extract input type (Issue IDs / --text / --plan) and optional flags (--exec, -y)
3. Determine execution method (see specs/pipelines.md Selection Decision Table):
   - Explicit `--exec` flag -> use specified method
   - `-y` / `--yes` flag -> Auto mode
   - No flags -> AskUserQuestion for method choice
4. Store requirements: input_type, raw_input, execution_method
5. CRITICAL: Always proceed to Phase 2, never skip team workflow

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-planex`
2. Generate session ID: `PEX-<slug>-<date>`
3. Create session folder: `.workflow/.team/<session-id>/`
4. Create subdirectories: `artifacts/solutions/`, `wisdom/`
5. Call `TeamCreate` with team name (default: "planex")
6. Initialize wisdom files (learnings.md, decisions.md, conventions.md, issues.md)
7. Initialize meta.json with pipeline metadata:
```typescript
mcp__maestro__team_msg({
  operation: "log", session_id: "<id>", from: "coordinator",
  type: "state_update", summary: "Session initialized",
  data: {
    pipeline_mode: "plan-execute",
    pipeline_stages: ["planner", "executor"],
    roles: ["coordinator", "planner", "executor"],
    team_name: "planex",
    input_type: "<issues|text|plan>",
    execution_method: "<codex|agy>"
  }
})
```

## Phase 3: Create Task Chain

Delegate to `@commands/dispatch.md`:
1. Read `roles/coordinator/commands/dispatch.md`
2. Execute its workflow to create PLAN-001 task
3. PLAN-001 contains input info + execution method in description

## Phase 4: Spawn-and-Stop

1. Load `@commands/monitor.md`
2. Execute `handleSpawnNext` to find ready tasks and spawn planner worker
3. Output status summary
4. STOP (idle, wait for worker callback)

**ONE_STEP_PER_INVOCATION**: true — coordinator does one operation per wake-up, then STOPS.

## Phase 5: Report + Completion Action

1. Load session state -> count completed tasks, duration
2. List deliverables with output paths
3. Update session status -> "completed"
4. Execute Completion Action per session.completion_action:
   - interactive -> AskUserQuestion (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)
   - auto_yes -> Archive & Clean without prompting

## Error Handling

| Error | Resolution |
|-------|------------|
| Session file not found | Error, suggest re-initialization |
| Unknown worker callback | Log, scan for other completions |
| Pipeline stall | Check missing tasks, report to user |
| Worker crash | Reset task to pending, re-spawn on next beat |
| All workers running on resume | Report status, suggest check later |
