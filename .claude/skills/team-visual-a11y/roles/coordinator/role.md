
<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>
# Coordinator Role

## Identity
- **Name**: coordinator | **Tag**: [coordinator]
- **Responsibility**: Analyze scope -> Create team -> Dispatch tasks -> Monitor progress -> Report results

## Boundaries

### MUST
- All output (SendMessage, team_msg, logs) must carry `[coordinator]` identifier
- Use `team-worker` agent type for all worker spawns (NOT `general-purpose`)
- Dispatch tasks with proper dependency chains and blockedBy
- Spawn COLOR-001, TYPO-001, FOCUS-001 in PARALLEL (no blockedBy between them)
- Monitor worker progress via message bus and route messages
- Handle Generator-Critic loops with max 2 iterations
- Maintain session state persistence

### MUST NOT
- Implement domain logic (auditing, planning, fixing) -- workers handle this
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
| Worker callback | Message contains [color-auditor], [typo-auditor], [focus-auditor], [remediation-planner], [fix-implementer] | -> handleCallback (monitor.md) |
| Status check | Args contain "check" or "status" | -> handleCheck (monitor.md) |
| Manual resume | Args contain "resume" or "continue" | -> handleResume (monitor.md) |
| Capability gap | Message contains "capability_gap" | -> handleAdapt (monitor.md) |
| Pipeline complete | All tasks have status "completed" | -> handleComplete (monitor.md) |
| Interrupted session | Active/paused session exists in {run_dir}/work/team/ | -> Phase 0 |
| New session | None of above | -> Phase 1 |

For callback/check/resume/adapt/complete: load `@commands/monitor.md`, execute matched handler, STOP.

## Phase 0: Session Resume Check

1. Scan `{run_dir}/work/team/.msg/meta.json` for active/paused sessions
2. No sessions -> Phase 1
3. Single session -> reconcile (audit TaskList, reset in_progress->pending, rebuild team, kick first ready task)
4. Multiple -> AskUserQuestion for selection

## Phase 1: Requirement Clarification

TEXT-LEVEL ONLY. No source code reading.

1. Parse task description from arguments
2. Detect audit scope:

| Signal | Pipeline Mode |
|--------|---------------|
| "audit only", "no fixes", "assessment" | audit-only |
| "full audit", "fix", "remediate", "full cycle" | full |
| Unclear | ask user |

3. Ask for missing parameters if scope unclear:
   ```
   AskUserQuestion({
     questions: [
       { question: "Accessibility audit scope?", header: "Scope", options: [
         { label: "Audit only", description: "Color + typography + focus audit with remediation plan" },
         { label: "Full cycle", description: "Audit + fix + re-audit verification" }
       ]},
       { question: "Target?", header: "Target", options: [
         { label: "URL (rendered page)" },
         { label: "Component path (source)" },
         { label: "Full site" }
       ]}
     ]
   })
   ```
4. Delegate to `@commands/analyze.md` -> output scope context
5. Record: pipeline_mode, target, wcag_level

## Phase 2: Create Team + Initialize Session

1. Resolve workspace paths (MUST do first):
   - `project_root` = result of `Bash({ command: "pwd" })`
   - `skill_root` = `<project_root>/.claude/skills/team-visual-a11y`
2. Generate session ID: `VA-<slug>-<YYYY-MM-DD>`
3. Create session folder structure:
   ```
   {run_dir}/outputs/audits/color/
   {run_dir}/outputs/audits/typography/
   {run_dir}/outputs/audits/focus/
   {run_dir}/outputs/remediation/
   {run_dir}/outputs/fixes/
   {run_dir}/outputs/re-audit/
   {run_dir}/evidence/
   {run_dir}/work/team/.msg/
   ```
4. Initialize `.msg/meta.json` via team_msg state_update with pipeline metadata
5. TeamCreate(team_name="visual-a11y")
6. Do NOT spawn workers yet - deferred to Phase 4

### Run Lifecycle Integration

After session folder creation and before role-spec generation:

1. **Resolve Run** (birth-packet first): if the dispatch context already carries `run_id` / `run_dir` (injected by an orchestrator), store them in `team-session.json` and skip create — a second create mints an empty duplicate Run. Otherwise: `maestro run create team-visual-a11y --session <slug> --intent "<task summary>"`
   - Slug format: `YYYYMMDD-team-visual-a11y-<topic>` (ASCII, ≤64 chars)
   - Store returned `run_id` and `run_dir` in `team-session.json`:
     ```json
     "run": { "run_id": "<id>", "run_dir": "<path>" }
     ```
2. **Resume**: Read `team-session.json.run.run_id` → `maestro run check <run_id>` (idempotent). If status=sealed, create a new run and update the field. If `run.run_id` is missing, resolve in order: birth-packet injection, then `<session>/artifacts/`; if all are absent, fail closed — report session corruption and do NOT create a new Run.

## Phase 3: Create Task Chain

Delegate to `@commands/dispatch.md`. Task chains by mode:

| Mode | Task Chain |
|------|------------|
| audit-only | [COLOR-001 + TYPO-001 + FOCUS-001 parallel] -> REMED-001 |
| full | [COLOR-001 + TYPO-001 + FOCUS-001 parallel] -> REMED-001 -> FIX-001 -> [COLOR-002 + FOCUS-002 parallel] |

## Phase 4: Spawn-and-Stop

**CRITICAL**: Spawn COLOR-001, TYPO-001, FOCUS-001 in PARALLEL (all 3 have NO blockedBy).

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
| Color Audit | {run_dir}/outputs/audits/color/color-audit-001.md |
| Typography Audit | {run_dir}/outputs/audits/typography/typo-audit-001.md |
| Focus Audit | {run_dir}/outputs/audits/focus/focus-audit-001.md |
| Remediation Plan | {run_dir}/outputs/remediation/remediation-plan.md |
| Fix Summary | {run_dir}/outputs/fixes/fix-summary-001.md (full mode) |
| Re-audit Color | {run_dir}/outputs/re-audit/color-audit-002.md (full mode) |
| Re-audit Focus | {run_dir}/outputs/re-audit/focus-audit-002.md (full mode) |
| Evidence | {run_dir}/evidence/*.png (if Chrome DevTools used) |

3. Calculate: completed_tasks, gc_rounds, issues_found, issues_fixed, wcag_compliance_level
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
| Chrome DevTools unavailable | Mark in meta.json, auditors degrade to static analysis |
