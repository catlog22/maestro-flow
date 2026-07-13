
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: resume

## Purpose

Restore execution context from a paused session and continue the monitor loop. This is the coordinator's mechanism for resuming long-running projects across sessions.

## When to Use

- User invokes `Skill(skill="team-roadmap-dev", args="--resume {sessionFolder}")`
- Coordinator detects a paused session during init

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `sessionFolder` | From --resume argument | Session artifact directory to resume |

## Execution Steps

### Step 1: Validate Session State

```javascript
const stateContent = Read(`${sessionFolder}/state.md`)

// Check for paused status
if (!stateContent.includes('Status: paused')) {
  // Session is not paused — check if it's in_progress or completed
  if (stateContent.includes('Status: completed')) {
    // Session already finished
    return { error: "Session already completed", sessionFolder }
  }
  // Not paused, not completed — treat as fresh continue
}

// Parse resume coordinates
const pausedPhase = parseInt(stateContent.match(/Paused Phase: (\d+)/)?.[1] || '1')
const pausedStep = stateContent.match(/Paused Step: (\w+)/)?.[1] || 'plan'
const gapIteration = parseInt(stateContent.match(/Gap Iteration: (\d+)/)?.[1] || '0')
```

### Step 2: Load Session Context

```javascript
const roadmap = Read(`${sessionFolder}/roadmap.md`)
const config = JSON.parse(Read(`${sessionFolder}/config.json`))

// Load project context
const projectTech = JSON.parse(Read('.workflow/project-tech.json'))
```

### Step 3: Update State to In-Progress

```javascript
const timestamp = new Date().toISOString().slice(0, 19)

Edit(`${sessionFolder}/state.md`, {
  old_string: `- Status: paused`,
  new_string: `- Status: in_progress
- Resumed At: ${timestamp}
- Resumed From Phase: ${pausedPhase}, Step: ${pausedStep}`
})
```

### Step 4: Log Resume Event

```javascript
mcp__maestro__team_msg({
  operation: "log", session_id: sessionId,
  from: "coordinator", to: "all",
  type: "phase_started",
  data: { ref: `${sessionFolder}/state.md` }
})
```

### Step 5: Re-enter Monitor Loop

```javascript
// Delegate to monitor.md with resume context
// monitor.md receives:
//   - startPhase: pausedPhase (instead of 1)
//   - startStep: pausedStep (plan/exec/verify/gap_closure)
//   - gapIteration: gapIteration (for gap closure continuity)

Read("commands/monitor.md")
// Monitor will:
//   1. Skip phases before pausedPhase
//   2. Within pausedPhase, skip steps before pausedStep
//   3. Continue normal execution from that point
```

### Step 6: Determine Resume Entry Point

```javascript
// Map pausedStep to monitor entry point
switch (pausedStep) {
  case 'plan':
    // Re-dispatch planner for current phase
    // Check if PLAN task exists and is pending/incomplete
    break

  case 'exec':
    // Re-dispatch executor for current phase
    // Check if EXEC task exists and is pending/incomplete
    break

  case 'verify':
    // Re-dispatch verifier for current phase
    break

  case 'gap_closure':
    // Re-enter gap closure loop at gapIteration
    break

  case 'transition':
    // Phase was complete, proceed to next phase
    break
}
```

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| state.md | `{sessionFolder}/state.md` | Updated with resumed status |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Session folder not found | Error with available session list |
| state.md missing | Error — session may be corrupted |
| Session not paused | Check if in_progress or completed, handle accordingly |
| Roadmap.md missing | Error — session artifacts may be incomplete |
| config.json missing | Use defaults (mode=interactive, depth=standard) |
| Tasks from prior run still pending | Re-use them, don't create duplicates |
