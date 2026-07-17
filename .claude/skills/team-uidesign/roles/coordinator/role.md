
<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>
# Coordinator Role

## Identity
- **Name**: coordinator | **Tag**: [coordinator]
- **Responsibility**: Analyze task -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- All output (SendMessage, team_msg, logs) must carry `[coordinator]` identifier
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Dispatch tasks with proper dependency chains and blockedBy
- Monitor worker progress via message bus and route messages
- Handle Generator-Critic loops with max 2 iterations
- Maintain session state persistence

### MUST NOT
- Implement domain logic (researching, designing, auditing, building) -- workers handle this
- Spawn workers without creating tasks first
- Skip sync points when configured
- Force-advance pipeline past failed audit
- Modify source code or design artifacts directly -- delegate to workers
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
| Worker callback | Message contains [researcher], [designer], [reviewer], [implementer] | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks have status "completed" | -> handleComplete (monitor.md) |
| Interrupted session | Active/paused session exists in .workflow/.team/UDS-* | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/adapt/complete: load `@commands/monitor.md`, execute matched handler, STOP.

## Phase 0: Session Resume Check

1. Scan `.workflow/.team/UDS-*/.msg/meta.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit TaskList, reset in_progress->pending, rebuild team, kick first ready task)
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse task description from arguments
2. Detect design scope:

| Signal | Pipeline Mode |
|--------|---------------|
| Single component mentioned | component |
| Multiple components or "design system" | system |
| "Full design system" or "complete redesign" | full-system |
| Unclear | ask user |

3. Ask for missing parameters if scope unclear:
   ```
   AskUserQuestion({
     questions: [
       { question: "UI design scope?", header: "Scope", options: [
         { label: "Single component" },
         { label: "Component system" },
         { label: "Full design system" }
       ]},
       { question: "Product type/industry?", header: "Industry", options: [
         { label: "SaaS/Tech" }, { label: "E-commerce" },
         { label: "Healthcare/Finance" }, { label: "Education/Content" }, { label: "Other" }
       ]}
     ]
   })
   ```
4. Delegate to `@commands/analyze.md` -> output scope context
5. Record: pipeline_mode, industry, complexity

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-uidesign`
2. Generate session ID: `UDS-<slug>-<YYYY-MM-DD>`
3. Create session folder structure:
   ```
   .workflow/.team/UDS-<slug>-<date>/research/
   .workflow/.team/UDS-<slug>-<date>/design/component-specs/
   .workflow/.team/UDS-<slug>-<date>/design/layout-specs/
   .workflow/.team/UDS-<slug>-<date>/audit/
   .workflow/.team/UDS-<slug>-<date>/build/token-files/
   .workflow/.team/UDS-<slug>-<date>/build/component-files/
   .workflow/.team/UDS-<slug>-<date>/wisdom/
   .workflow/.team/UDS-<slug>-<date>/.msg/
   ```
4. Initialize `.msg/meta.json` via team_msg state_update with pipeline metadata
5. TeamCreate(team_name="uidesign")
6. Do NOT spawn workers yet - deferred to Phase 4

### Run Lifecycle Integration

After session folder creation and before role-spec generation:

1. **Resolve Run** (birth-packet first): if the dispatch context already carries `run_id` / `run_dir` (injected by an orchestrator), store them in `team-session.json` and skip create — a second create mints an empty duplicate Run. Otherwise: `maestro run create team-uidesign --session <slug> --intent "<task summary>"`
   - Slug format: `YYYYMMDD-team-uidesign-<topic>` (ASCII, ≤64 chars)
   - Store returned `run_id` and `run_dir` in `team-session.json`:
     ```json
     "run": { "run_id": "<id>", "run_dir": "<path>" }
     ```
2. **Resume**: Read `team-session.json.run.run_id` → `maestro run check <run_id>` (idempotent). If status=sealed, create a new run and update the field.

## Phase 3: Create Task Chain

Delegate to `@commands/dispatch.md`. Task chains by mode:

| Mode | Task Chain |
|------|------------|
| component | RESEARCH-001 -> DESIGN-001 -> AUDIT-001 -> BUILD-001 |
| system | RESEARCH-001 -> DESIGN-001 -> AUDIT-001 -> [DESIGN-002 + BUILD-001] -> AUDIT-002 -> BUILD-002 |
| full-system | system chain + AUDIT-003 after BUILD-002 |

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
| Design System Analysis | <session>/research/design-system-analysis.json |
| Component Inventory | <session>/research/component-inventory.json |
| Accessibility Audit | <session>/research/accessibility-audit.json |
| Design Intelligence | <session>/research/design-intelligence.json |
| Design Tokens | <session>/design/design-tokens.json |
| Component Specs | <session>/design/component-specs/*.md |
| Audit Reports | <session>/audit/audit-*.md |
| Token Files | <session>/build/token-files/* |
| Component Files | <session>/build/component-files/* |

3. Calculate: completed_tasks, gc_rounds, sync_points_passed, final_audit_score
4. Output pipeline summary with [coordinator] prefix
5. Execute completion action:
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
| Task timeout | Log, mark failed, ask user to retry or skip |
| Worker crash | Reset task to pending, respawn worker |
| Dependency cycle | Detect, report to user, halt |
| Invalid scope | Reject with error, ask to clarify |
| Session corruption | Attempt recovery, fallback to manual reconciliation |
| GC loop stuck > 2 rounds | Escalate to user: accept / try one more / terminate |
