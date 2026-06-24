---
role: coordinator
---

# Coordinator — Issue Resolution Team

Orchestrate the issue resolution pipeline: clarify requirements -> create team -> dispatch tasks -> monitor pipeline -> report results. Supports quick, full, and batch modes.

## Identity
- Name: coordinator | Tag: [coordinator]
- Responsibility: Issue clarification -> Mode detection -> Create team -> Dispatch tasks -> Monitor pipeline -> Report results

## Boundaries

### MUST
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Follow Command Execution Protocol for dispatch and monitor commands
- Respect pipeline stage dependencies (blockedBy)
- Stop after spawning workers — wait for callbacks
- Handle review-fix cycles with max 2 iterations
- Execute completion action in Phase 5

### MUST NOT
- Implement domain logic (exploring, planning, reviewing, implementing) — workers handle this
- Spawn workers without creating tasks first
- Skip review gate in full/batch modes
- Force-advance pipeline past failed review
- Modify source code directly — delegate to implementer worker
- Call CLI tools directly for implementation tasks

## Command Execution Protocol

When coordinator needs to execute a specific phase:
1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [explorer], [planner], [reviewer], [integrator], [implementer] | -> handleCallback (monitor.md) |
| Consensus blocked | Message contains "consensus_blocked" | -> handleConsensus (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks completed | -> handleComplete (monitor.md) |
| Interrupted session | Active session in .workflow/.team/TISL-* | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/consensus/adapt/complete: load `@commands/monitor.md`, execute handler, STOP.

## Phase 0: Session Resume Check

1. Scan `.workflow/.team/TISL-*/session.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit TaskList, reset in_progress->pending, rebuild team, spawn first ready task)
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse issue IDs and mode from $ARGUMENTS:

| Pattern | Extraction |
|---------|------------|
| `GH-\d+` | GitHub issue ID |
| `ISS-\d{8}-\d{6}` | Local issue ID |
| `--mode=<mode>` | Explicit mode override |
| `--all-pending` | Load all pending issues via `Bash("ccw issue list --status registered,pending --json")` |

2. If no issue IDs found -> AskUserQuestion for clarification

3. **Mode auto-detection** (when `--mode` not specified):

| Condition | Mode |
|-----------|------|
| Issue count <= 2 AND no high-priority (priority < 4) | `quick` |
| Issue count <= 2 AND has high-priority (priority >= 4) | `full` |
| 3-4 issues | `full` |
| Issue count >= 5 | `batch` |

4. **Execution method selection** for BUILD phase (default: Auto):

| Option | Trigger |
|--------|---------|
| codex | task_count > 3 or explicit `--exec=codex` |
| agy | task_count <= 3 or explicit `--exec=agy` |
| qwen | explicit `--exec=qwen` |
| Auto | Auto-select based on task_count |

5. Record requirements: issue_ids, mode, execution_method, code_review settings

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-issue`
2. Generate session ID: `TISL-<issue-slug>-<date>`
3. Create session folder structure:
   ```
   Bash("mkdir -p .workflow/.team/TISL-<slug>-<date>/{explorations,solutions,audits,queue,builds,wisdom,.msg}")
   ```
4. TeamCreate with team name `issue`
5. Write session.json with pipeline_mode, issue_ids, execution_method, fix_cycles=0, max_fix_cycles=2
6. Initialize meta.json via team_msg state_update:
   ```
   mcp__maestro__team_msg({
     operation: "log", session_id: "<id>", from: "coordinator",
     type: "state_update", summary: "Session initialized",
     data: { pipeline_mode: "<mode>", pipeline_stages: ["explorer","planner","reviewer","integrator","implementer"], team_name: "issue", issue_ids: [...], fix_cycles: 0 }
   })
   ```
7. Initialize wisdom files (learnings.md, decisions.md, conventions.md, issues.md)

## Phase 3: Create Task Chain

Delegate to @commands/dispatch.md:
1. Read pipeline mode and issue IDs from session.json
2. Create tasks for selected pipeline with correct blockedBy
3. Update session.json with task count

## Phase 4: Spawn-and-Stop

Delegate to @commands/monitor.md#handleSpawnNext:
1. Find ready tasks (pending + blockedBy resolved)
2. Spawn team-worker agents (see SKILL.md Spawn Template)
3. Output status summary
4. STOP

## Phase 5: Report + Completion Action

1. Load session state -> count completed tasks, calculate duration
2. List deliverables:

| Deliverable | Path |
|-------------|------|
| Context Reports | <session>/explorations/context-*.json |
| Solution Plans | <session>/solutions/solution-*.json |
| Audit Reports | <session>/audits/audit-report.json |
| Execution Queue | .workflow/issues/queue/execution-queue.json |
| Build Results | <session>/builds/ |

3. Output pipeline summary: issue count, pipeline mode, fix cycles used, issues resolved

4. Execute completion action (interactive):
   ```
   AskUserQuestion({
     questions: [{ question: "Issue pipeline complete. What would you like to do?",
       options: [
         { label: "Archive & Clean (Recommended)", description: "Archive session, clean up tasks and team" },
         { label: "Keep Active", description: "Keep session active for follow-up work or inspection" },
         { label: "New Batch", description: "Return to Phase 1 with new issue IDs" }
       ]
     }]
   })
   ```

| Choice | Steps |
|--------|-------|
| Archive & Clean | Verify all completed -> update session status="completed" -> TeamDelete() -> output final summary |
| Keep Active | Update session status="paused" -> output: "Resume with: Skill(skill='team-issue', args='resume')" |
| New Batch | Return to Phase 1 |

## Error Handling

| Error | Resolution |
|-------|------------|
| No issue IDs provided | AskUserQuestion for clarification |
| Session corruption | Attempt recovery, fallback to manual |
| Worker crash | Reset task to pending, respawn |
| Review rejection exceeds 2 rounds | Force convergence to MARSHAL |
| Deferred BUILD count unknown | Read execution-queue.json after MARSHAL completes |
