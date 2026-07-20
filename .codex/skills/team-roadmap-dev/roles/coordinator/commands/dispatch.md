
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Command: dispatch

## Purpose

Read the roadmap and create a linked task chain (PLAN -> EXEC -> VERIFY) for a given phase number. Tasks are assigned to the appropriate worker roles and linked via blockedBy dependencies.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `phaseNumber` | From coordinator | Phase to dispatch (1-based) |
| `sessionFolder` | From coordinator | Canonical `{run_dir}` root |

## Execution Steps

### Step 1: Read Roadmap and Extract Phase Requirements

```javascript
const roadmap = Read(`${sessionFolder}/outputs/roadmap.md`)
const config = JSON.parse(Read(`${sessionFolder}/work/team/config.json`))

// Parse phase section from roadmap
// Extract: goal, requirements (REQ-IDs), success criteria
const phaseGoal = extractPhaseGoal(roadmap, phaseNumber)
const phaseRequirements = extractPhaseRequirements(roadmap, phaseNumber)
const phaseSuccessCriteria = extractPhaseSuccessCriteria(roadmap, phaseNumber)
```

### Step 2: Create Phase Directory

```javascript
Bash(`mkdir -p "${sessionFolder}/outputs/phase-${phaseNumber}"`)
```

### Step 3: Create PLAN Task (Assigned to Planner)

```javascript
const planTaskId = update_plan({
  subject: `PLAN-${phaseNumber}01: Plan phase ${phaseNumber} - ${phaseGoal}`,
  description: `[coordinator] Plan creation for phase ${phaseNumber}.

## Session
- Folder: ${sessionFolder}
- Phase: ${phaseNumber}
- Depth: ${config.depth}

## Phase Goal
${phaseGoal}

## Requirements
${phaseRequirements.map(r => `- ${r}`).join('\n')}

## Success Criteria
${phaseSuccessCriteria.map(c => `- ${c}`).join('\n')}

## Deliverables
- ${sessionFolder}/outputs/phase-${phaseNumber}/context.md (research context)
- ${sessionFolder}/outputs/phase-${phaseNumber}/plan-01.md (execution plan with waves and must_haves)

## Instructions
1. Invoke spawn_agent({ task_name: "team_roadmap_dev", message: "Execute skill team-roadmap-dev, args: --role=planner" })
2. Follow planner role.md research + create-plans commands
3. Use roadmap requirements as input for plan generation
4. update_plan this task to completed when plan is written`,
  activeForm: `Planning phase ${phaseNumber}`
})
```

### Step 4: Create EXEC Task (Assigned to Executor, Blocked by PLAN)

```javascript
const execTaskId = update_plan({
  subject: `EXEC-${phaseNumber}01: Execute phase ${phaseNumber} - ${phaseGoal}`,
  description: `[coordinator] Execute plans for phase ${phaseNumber}.

## Session
- Folder: ${sessionFolder}
- Phase: ${phaseNumber}

## Phase Goal
${phaseGoal}

## Plan Reference
- ${sessionFolder}/outputs/phase-${phaseNumber}/plan-01.md (and any additional plans)

## Instructions
1. Invoke spawn_agent({ task_name: "team_roadmap_dev", message: "Execute skill team-roadmap-dev, args: --role=executor" })
2. Follow executor role.md implement command
3. Execute all plans in wave order
4. Write summary to ${sessionFolder}/outputs/phase-${phaseNumber}/summary-01.md
5. update_plan this task to completed when all plans executed`,
  activeForm: `Executing phase ${phaseNumber}`
})

// Set dependency: EXEC blocked by PLAN
update_plan({ taskId: execTaskId, addBlockedBy: [planTaskId] })
```

### Step 5: Create VERIFY Task (Assigned to Verifier, Blocked by EXEC)

```javascript
const verifyTaskId = update_plan({
  subject: `VERIFY-${phaseNumber}01: Verify phase ${phaseNumber} - ${phaseGoal}`,
  description: `[coordinator] Verify phase ${phaseNumber} against success criteria.

## Session
- Folder: ${sessionFolder}
- Phase: ${phaseNumber}

## Phase Goal
${phaseGoal}

## Success Criteria (from roadmap)
${phaseSuccessCriteria.map(c => `- ${c}`).join('\n')}

## References
- Roadmap: ${sessionFolder}/outputs/roadmap.md
- Plans: ${sessionFolder}/outputs/phase-${phaseNumber}/plan-*.md
- Summaries: ${sessionFolder}/outputs/phase-${phaseNumber}/summary-*.md

## Instructions
1. Invoke spawn_agent({ task_name: "team_roadmap_dev", message: "Execute skill team-roadmap-dev, args: --role=verifier" })
2. Follow verifier role.md verify command
3. Check each success criterion against actual implementation
4. Write verification to ${sessionFolder}/outputs/phase-${phaseNumber}/verification.md
5. If gaps found: list them with gap IDs in verification.md
6. update_plan this task to completed with result (passed/gaps_found)`,
  activeForm: `Verifying phase ${phaseNumber}`
})

// Set dependency: VERIFY blocked by EXEC
update_plan({ taskId: verifyTaskId, addBlockedBy: [execTaskId] })
```

### Step 6: Update state.md

```javascript
Edit(`${sessionFolder}/work/team/state.md`, {
  old_string: `- Phase: ${phaseNumber}\n- Status: ready_to_dispatch`,
  new_string: `- Phase: ${phaseNumber}\n- Status: in_progress\n- Tasks: PLAN-${phaseNumber}01 → EXEC-${phaseNumber}01 → VERIFY-${phaseNumber}01`
})
```

### Step 7: Log Dispatch Message

```javascript
mcp__maestro__team_msg({
  operation: "log", session_id: sessionId,
  from: "coordinator", to: "all",
  type: "phase_started",
  data: { ref: `${sessionFolder}/outputs/roadmap.md` }
})
```

## Task Description Format

All dispatched tasks follow this structure:

```
[coordinator] {action} for phase {N}.

## Session
- Folder: {sessionFolder}
- Phase: {N}
- Depth: {config.depth} (PLAN only)

## Phase Goal
{goal from roadmap}

## Requirements / Success Criteria
{from roadmap}

## Deliverables
{expected output files}

## Instructions
{step-by-step for the worker role}
```

## Task Naming Convention

| Task | Name Pattern | Example |
|------|-------------|---------|
| Plan | `PLAN-{phase}01` | PLAN-101 |
| Execute | `EXEC-{phase}01` | EXEC-101 |
| Verify | `VERIFY-{phase}01` | VERIFY-101 |
| Gap Plan | `PLAN-{phase}02` | PLAN-102 (gap closure iteration 1) |
| Gap Execute | `EXEC-{phase}02` | EXEC-102 |
| Gap Verify | `VERIFY-{phase}02` | VERIFY-102 |

## Dependency Chain

```
PLAN-{N}01  ←──  EXEC-{N}01  ←──  VERIFY-{N}01
(planner)        (executor)        (verifier)
```

Each task is blocked by its predecessor. Workers pick up tasks only when their blockedBy list is empty.

## Output

Returns the three task IDs as a structured result:

```javascript
{
  planTaskId: planTaskId,
  execTaskId: execTaskId,
  verifyTaskId: verifyTaskId
}
```
