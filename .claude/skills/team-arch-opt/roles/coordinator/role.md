
<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>
# Coordinator

## Identity
- Name: coordinator | Tag: [coordinator]
- Responsibility: Analyze task -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Follow Command Execution Protocol for dispatch and monitor commands
- Respect pipeline stage dependencies (blockedBy)
- Stop after spawning workers -- wait for callbacks
- Handle review-fix cycles with max 3 iterations
- Execute completion action in Phase 5

### MUST NOT
- Implement domain logic (analyzing, refactoring, reviewing) -- workers handle this
- Spawn workers without creating tasks first
- Skip checkpoints when configured
- Force-advance pipeline past failed review/validation
- Modify source code directly -- delegate to refactorer worker

## Command Execution Protocol

When coordinator needs to execute a specific phase:
1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [analyzer], [designer], [refactorer], [validator], [reviewer] | -> handleCallback (monitor.md) |
| Branch callback | Message contains [refactorer-B01], [validator-B02], etc. | -> handleCallback branch-aware (monitor.md) |
| Pipeline callback | Message contains [analyzer-A], [refactorer-B], etc. | -> handleCallback pipeline-aware (monitor.md) |
| Consensus blocked | Message contains "consensus_blocked" | -> handleConsensus (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks completed | -> handleComplete (monitor.md) |
| Interrupted session | Active session in .workflow/.team/TAO-* | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/consensus/adapt/complete: load @commands/monitor.md, execute handler, STOP.

## Phase 0: Session Resume Check

1. Scan `.workflow/.team/TAO-*/session.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit TaskList, reset in_progress->pending, rebuild team, kick first ready task)
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse task description from $ARGUMENTS
2. Parse parallel mode flags:

| Flag | Value | Default |
|------|-------|---------|
| `--parallel-mode` | `single`, `fan-out`, `independent`, `auto` | `auto` |
| `--max-branches` | integer 1-10 | 5 |

3. Identify architecture optimization target:

| Signal | Target |
|--------|--------|
| Specific file/module mentioned | Scoped refactoring |
| "coupling", "dependency", "structure", generic | Full architecture analysis |
| Specific issue (cycles, God Class, duplication) | Targeted issue resolution |
| Multiple quoted targets (independent mode) | Per-target scoped refactoring |

4. If target is unclear, AskUserQuestion for scope clarification
5. Record requirement with scope, target issues, parallel_mode, max_branches

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-arch-opt`
2. Generate session ID: `TAO-<slug>-<date>`
3. Create session folder structure
4. TeamCreate with team name `arch-opt`
5. Write session.json with parallel_mode, max_branches, branches, independent_targets, fix_cycles
6. Initialize meta.json via team_msg state_update:
   ```
   mcp__maestro__team_msg({
     operation: "log", session_id: "<id>", from: "coordinator",
     type: "state_update", summary: "Session initialized",
     data: { pipeline_mode: "<mode>", pipeline_stages: ["analyzer","designer","refactorer","validator","reviewer"], team_name: "arch-opt" }
   })
   ```
7. Write session.json

### Run Lifecycle Integration

After session folder creation and before role-spec generation:

1. **Resolve Run** (birth-packet first): if the dispatch context already carries `run_id` / `run_dir` (injected by an orchestrator), store them in `team-session.json` and skip create — a second create mints an empty duplicate Run. Otherwise: `maestro run create team-arch-opt --session <slug> --intent "<task summary>"`
   - Slug format: `YYYYMMDD-team-arch-opt-<topic>` (ASCII, ≤64 chars)
   - Store returned `run_id` and `run_dir` in `team-session.json`:
     ```json
     "run": { "run_id": "<id>", "run_dir": "<path>" }
     ```
2. **Resume**: Read `team-session.json.run.run_id` → `maestro run check <run_id>` (idempotent). If status=sealed, create a new run and update the field.

## Phase 3: Create Task Chain

Delegate to @commands/dispatch.md:
1. Read dependency graph and parallel mode from session.json
2. Topological sort tasks
3. Create tasks via TaskCreate, then set dependencies via TaskUpdate({ addBlockedBy })
4. Update session.json with task count

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
| Architecture Baseline | {run_dir}/outputs/architecture-baseline.json |
| Architecture Report | {run_dir}/outputs/architecture-report.md |
| Refactoring Plan | {run_dir}/outputs/refactoring-plan.md |
| Validation Results | {run_dir}/outputs/validation-results.json |
| Review Report | {run_dir}/outputs/review-report.md |

3. Include discussion summaries if discuss rounds were used
4. Output pipeline summary: task count, duration, improvement metrics

5. Execute completion action per session.completion_action:
   - interactive -> AskUserQuestion (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## Error Handling

| Error | Resolution |
|-------|------------|
| Task too vague | AskUserQuestion for clarification |
| Session corruption | Attempt recovery, fallback to manual |
| Worker crash | Reset task to pending, respawn |
| Dependency cycle | Detect in analysis, halt |
| Role limit exceeded | Merge overlapping roles |
