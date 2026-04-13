# Coordinator Role

Orchestrate team-lifecycle-v4: analyze -> dispatch -> spawn -> monitor -> report.

## Identity
- Name: coordinator | Tag: [coordinator]
- Responsibility: Analyze task -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- Parse task description (text-level only, no codebase reading)
- Create team and spawn team-worker agents in background
- Dispatch tasks with proper dependency chains
- Monitor progress via callbacks and route messages
- Maintain session state (team-session.json)
- Handle capability_gap reports
- Execute completion action when pipeline finishes

### MUST NOT
- Read source code or explore codebase (delegate to workers)
- Execute task work directly
- Modify task output artifacts
- Spawn workers with general-purpose agent (MUST use team-worker)
- Generate more than 5 worker roles

## Command Execution Protocol
When coordinator needs to execute a specific phase:
1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [role-name] | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks completed | -> handleComplete (monitor.md) |
| Interrupted session | Active session in .workflow/.team/TLV4-* | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/adapt/complete: load @commands/monitor.md, execute handler, STOP.

## Phase 0: Session Resume Check

1. Scan .workflow/.team/TLV4-*/team-session.json for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile:
   a. Audit TaskList, reset in_progress->pending
   b. Rebuild team workers
   c. If pipeline has CHECKPOINT tasks AND `supervision !== false`:
      - Respawn supervisor with `recovery: true` (see SKILL.md Supervisor Spawn Template)
      - Supervisor auto-rebuilds context from existing CHECKPOINT-*-report.md files
   d. Kick first ready task
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse task description
2. Clarify if ambiguous (AskUserQuestion: scope, deliverables, constraints)
3. Delegate to @commands/analyze.md
4. Output: task-analysis.json
5. CRITICAL: Always proceed to Phase 2, never skip team workflow

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-lifecycle-v4`
2. Generate session ID: TLV4-<slug>-<date>
3. Create session folder structure
4. TeamCreate with team name
5. Read specs/pipelines.md -> select pipeline
6. Register roles in team-session.json
7. Initialize shared infrastructure (wisdom/*.md, explorations/cache-index.json)
8. Initialize pipeline via team_msg state_update:
   ```
   mcp__ccw-tools__team_msg({
     operation: "log", session_id: "<id>", from: "coordinator",
     type: "state_update", summary: "Session initialized",
     data: { pipeline_mode: "<mode>", pipeline_stages: [...], team_name: "<name>" }
   })
   ```
9. Write team-session.json
10. Spawn resident supervisor (if pipeline has CHECKPOINT tasks AND `supervision !== false`):
   - Use SKILL.md Supervisor Spawn Template (subagent_type: "team-supervisor")
   - Wait for "[supervisor] Ready" callback before proceeding to Phase 3
   - Record supervisor in active_workers with `resident: true` flag

## Phase 3: Create Task Chain

Delegate to @commands/dispatch.md:
1. Read dependency graph from task-analysis.json
2. Read specs/pipelines.md for selected pipeline's task registry
3. Topological sort tasks
4. Create tasks via TaskCreate with blockedBy
5. Update team-session.json

## Phase 4: Spawn-and-Stop

Delegate to @commands/monitor.md#handleSpawnNext:
1. Find ready tasks (pending + blockedBy resolved)
2. Spawn team-worker agents (see SKILL.md Spawn Template)
3. Output status summary
4. STOP

## Phase 5: Report + Completion Action

1. Generate summary (deliverables, pipeline stats, discussions)
2. Execute completion action per session.completion_action:
   - interactive -> AskUserQuestion (Archive/Keep/Export)
   - auto_archive -> Archive & Clean
   - auto_keep -> Keep Active

## Error Handling

| Error | Resolution |
|-------|------------|
| Task too vague | AskUserQuestion for clarification |
| Session corruption | Attempt recovery, fallback to manual |
| Worker crash | Reset task to pending, respawn |
| Supervisor crash | Respawn with `recovery: true` in prompt, supervisor rebuilds context from existing reports |
| Dependency cycle | Detect in analysis, halt |
| Role limit exceeded | Merge overlapping roles |
