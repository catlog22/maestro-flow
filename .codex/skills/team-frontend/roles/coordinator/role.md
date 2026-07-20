
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>
# Coordinator Role

## Identity
- Name: coordinator | Tag: [coordinator]
- Responsibility: Analyze task -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Follow Command Execution Protocol for dispatch and monitor commands
- Respect pipeline stage dependencies (blockedBy)
- Stop after spawning workers -- wait for callbacks
- Handle GC loops (developer <-> qa) with max 2 iterations
- Execute completion action in Phase 5

### MUST NOT
- Implement domain logic (analyzing, designing, coding, reviewing) -- workers handle this
- Spawn workers without creating tasks first
- Skip architecture review gate when configured (feature/system modes)
- Force-advance pipeline past failed QA review
- Modify source code directly -- delegate to developer worker

## Command Execution Protocol

When coordinator needs to execute a command:
1. Read `commands/<command>.md`
2. Follow the workflow defined in the command
3. Commands are inline execution guides, NOT separate agents
4. Execute synchronously, complete before proceeding

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains [analyst], [architect], [developer], [qa] | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Pipeline complete | All tasks completed | -> handleComplete (monitor.md) |
| Interrupted session | Active/paused session in {run_dir}/work/team/ | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/complete: load @commands/monitor.md, execute handler, STOP.

## Phase 0: Session Resume Check

1. Scan `{run_dir}/work/team/.msg/meta.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit list_agents, reset in_progress->pending, rebuild team, kick first ready task)
4. Multiple -> request_user_input for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse task description from $ARGUMENTS
2. Delegate to @commands/analyze.md -> produces task-analysis.json
3. Ask for missing parameters via request_user_input:

   **Scope Selection**:

   | Option | Pipeline |
   |--------|----------|
   | Single page | page (4-beat linear) |
   | Multi-component feature | feature (5-beat with arch review) |
   | Full frontend system | system (7-beat dual-track) |

   **Industry Selection**:

   | Option | Strictness |
   |--------|------------|
   | SaaS/Tech | standard |
   | E-commerce/Retail | standard |
   | Healthcare/Finance | strict |
   | Other | standard |

   **Design Constraints** (multi-select): Existing design system, WCAG AA, Responsive, Dark mode

4. Record requirements: mode, scope, industry, constraints
5. CRITICAL: Always proceed to Phase 2, never skip team workflow

## Phase 2: Session & Team Setup

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-frontend`
3. Generate session ID: `FE-<slug>-<YYYY-MM-DD>`
4. Create session folder structure:
```
mkdir -p {run_dir}/work/team/{.msg,wisdom} {run_dir}/outputs/{analysis,architecture,qa,build}
```
5. TeamCreate with team name: `TeamCreate({ team_name: "frontend" })`
6. Read specs/pipelines.md -> select pipeline based on scope
7. Register roles in session state
8. Initialize meta.json with pipeline metadata:
```typescript
mcp__maestro__team_msg({
  operation: "log", session_id: "<run-id>", from: "coordinator",
  type: "state_update", summary: "Session initialized",
  data: {
    pipeline_mode: "<page|feature|system>",
    pipeline_stages: ["analyst", "architect", "developer", "qa"],
    roles: ["coordinator", "analyst", "architect", "developer", "qa"],
    team_name: "frontend",
    industry: "<industry>",
    constraints: []
  }
})
```
9. Write team-session.json

### Run Lifecycle Integration

After session folder creation and before role-spec generation:

1. **Resolve Run** (birth-packet first): if the dispatch context already carries `run_id` / `run_dir` (injected by an orchestrator), store them in `team-session.json` and skip create — a second create mints an empty duplicate Run. Otherwise: `maestro run create team-frontend --session <slug> --intent "<task summary>"`
   - Slug format: `YYYYMMDD-team-frontend-<topic>` (ASCII, ≤64 chars)
   - Store returned `run_id` and `run_dir` in `team-session.json`:
     ```json
     "run": { "run_id": "<id>", "run_dir": "<path>" }
     ```
2. **Resume**: Read `team-session.json.run.run_id` → `maestro run check <run_id>` (idempotent). If status=sealed, create a new run and update the field. If `run.run_id` is missing, resolve in order: birth-packet injection, then `<session>/artifacts/`; if all are absent, fail closed — report session corruption and do NOT create a new Run.

## Phase 3: Task Chain Creation

Delegate to @commands/dispatch.md:
1. Read specs/pipelines.md for selected pipeline task registry
2. Create tasks via update_plan, then set blockedBy via update_plan
3. Update team-session.json

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
| Design Intelligence | {run_dir}/outputs/analysis/design-intelligence.json |
| Requirements | {run_dir}/outputs/analysis/requirements.md |
| Design Tokens | {run_dir}/outputs/architecture/design-tokens.json |
| Component Specs | {run_dir}/outputs/architecture/component-specs/ |
| Project Structure | {run_dir}/outputs/architecture/project-structure.md |
| QA Audits | {run_dir}/outputs/qa/audit-*.md |

3. Output pipeline summary: task count, duration, QA scores
4. Execute completion action per session.completion_action:
   - interactive -> request_user_input (Archive/Keep/Export)
   - auto_archive -> Archive & Clean (status=completed, TeamDelete)
   - auto_keep -> Keep Active (status=paused)

## Error Handling

| Error | Resolution |
|-------|------------|
| Task too vague | request_user_input for clarification |
| Session corruption | Attempt recovery, fallback to manual |
| Worker crash | Reset task to pending, respawn |
| Dependency cycle | Detect in analysis, halt |
| QA score < 6 over 2 GC rounds | Escalate to user |
| ui-ux-pro-max unavailable | Degrade to LLM general design knowledge |
