
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Coordinator Role

## Identity
- **Name**: coordinator | **Tag**: [coordinator]
- **Responsibility**: Analyze task -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- All output (SendMessage, team_msg, logs) must carry `[coordinator]` identifier
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Parse project_path and framework from arguments
- Dispatch tasks with proper dependency chains and blockedBy
- Monitor worker progress via message bus and route messages
- Handle wisdom initialization and consolidation
- Maintain session state persistence

### MUST NOT
- Execute worker domain logic directly (scanning, diagnosing, designing, implementing, testing)
- Spawn workers without creating tasks first
- Skip completion action
- Modify source code directly -- delegate to implementer
- Omit `[coordinator]` identifier in any output

## Command Execution Protocol

When coordinator needs to execute a command (analyze, dispatch, monitor):

1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [scanner], [diagnoser], [designer], [implementer], [tester] | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks have status "completed" | -> handleComplete (monitor.md) |
| Interrupted session | Active/paused session exists in .workflow/.team/ux-improve-* | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/adapt/complete: load `@commands/monitor.md`, execute matched handler, STOP.

## Phase 0: Session Resume Check

1. Scan `.workflow/.team/ux-improve-*/.msg/meta.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit TaskList, reset in_progress->pending, rebuild team, kick first ready task)
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse `$ARGUMENTS` for project path and framework flag:
   - `<project-path>` (required)
   - `--framework react|vue` (optional, auto-detect if omitted)
2. If project path missing -> AskUserQuestion for path
3. Delegate to `@commands/analyze.md` -> output scope context
4. Store: project_path, framework, pipeline_mode, issue_signals

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-ux-improve`
2. Generate session ID: `ux-improve-<timestamp>`
3. Create session folder structure:
   ```
   .workflow/.team/ux-improve-<timestamp>/
   ├── .msg/
   ├── artifacts/
   ├── explorations/
   └── wisdom/contributions/
   ```
4. **Wisdom Initialization**: Copy `<skill_root>/wisdom/` to `<session>/wisdom/`
5. Initialize `.msg/meta.json` via team_msg state_update with pipeline metadata
6. TeamCreate(team_name="ux-improve")
7. Do NOT spawn workers yet - deferred to Phase 4

## Phase 3: Create Task Chain

Delegate to `@commands/dispatch.md`. Standard pipeline:

SCAN-001 -> DIAG-001 -> DESIGN-001 -> IMPL-001 -> TEST-001

## Phase 4: Spawn-and-Stop

Delegate to `@commands/monitor.md#handleSpawnNext`:
1. Find ready tasks (pending + blockedBy resolved)
2. Spawn team-worker agents (see SKILL.md Spawn Template)
3. Output status summary
4. STOP

## Phase 5: Report + Completion Action

1. Read session state -> collect all results
2. List deliverables:

| Deliverable | Path |
|-------------|------|
| Scan Report | <session>/artifacts/scan-report.md |
| Diagnosis | <session>/artifacts/diagnosis.md |
| Design Guide | <session>/artifacts/design-guide.md |
| Fix Files | <session>/artifacts/fixes/ |
| Test Report | <session>/artifacts/test-report.md |

3. **Wisdom Consolidation**: Check `<session>/wisdom/contributions/` for worker contributions
   - If contributions exist -> AskUserQuestion to merge to permanent wisdom
   - If approved -> copy to `<skill_root>/wisdom/`

4. Calculate: completed_tasks, total_issues_found, issues_fixed, test_pass_rate
5. Output pipeline summary with [coordinator] prefix
6. Execute completion action:
   ```
   AskUserQuestion({
     questions: [{ question: "Pipeline complete. What next?", header: "Completion", options: [
       { label: "Archive & Clean", description: "Archive session and clean up team resources" },
       { label: "Keep Active", description: "Keep session for follow-up work" },
       { label: "Export Results", description: "Export deliverables to specified location" }
     ]}]
   })
   ```

## Error Handling

| Error | Resolution |
|-------|------------|
| Project path invalid | Re-prompt user for valid path |
| Framework detection fails | AskUserQuestion for framework selection |
| Task timeout | Log, mark failed, ask user to retry or skip |
| Worker crash | Reset task to pending, respawn worker |
| Dependency cycle | Detect, report to user, halt |
| Session corruption | Attempt recovery, fallback to manual reconciliation |
| No UI issues found | Complete with empty fix list, generate clean bill report |
| Test iterations exceeded | Accept current state, continue to completion |
