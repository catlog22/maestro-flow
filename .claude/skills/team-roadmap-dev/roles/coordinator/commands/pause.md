# Command: pause

## Purpose

Persist the current execution state (phase, step, pending tasks) to state.md so the session can be resumed from exactly where it stopped. This is the coordinator's mechanism for handling user "Stop" requests at phase boundaries or gap closure gates.

## When to Use

- User selects "Stop" at any interactive gate in monitor.md
- User requests pause during roadmap discussion
- External interruption requires graceful shutdown

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `sessionFolder` | From coordinator | Session artifact directory |
| `currentPhase` | From monitor loop | Phase number at pause time |
| `currentStep` | From monitor loop | Step within phase (plan/exec/verify/gap_closure) |
| `gapIteration` | From monitor loop | Current gap closure iteration (0 = none) |

## Execution Steps

### Step 1: Capture Current State

```javascript
const state = Read(`${sessionFolder}/state.md`)
const timestamp = new Date().toISOString().slice(0, 19)

// Capture pending task states
const allTasks = TaskList()
const pendingTasks = allTasks.filter(t =>
  t.status === 'pending' || t.status === 'in_progress'
)
```

### Step 2: Update state.md with Pause Marker

```javascript
// Find the current phase status line and update it
Edit(`${sessionFolder}/state.md`, {
  old_string: `- Status: in_progress`,
  new_string: `- Status: paused
- Paused At: ${timestamp}
- Paused Phase: ${currentPhase}
- Paused Step: ${currentStep}
- Gap Iteration: ${gapIteration}
- Pending Tasks: ${pendingTasks.map(t => t.subject).join(', ')}`
})
```

### Step 3: Log Pause Event

```javascript
mcp__maestro__team_msg({
  operation: "log", session_id: sessionId,
  from: "coordinator", to: "all",
  type: "phase_paused",
  data: { ref: `${sessionFolder}/state.md` }
})
```

### Step 4: Report to User

```javascript
// Output pause summary
const summary = `[coordinator] Session paused.
- Phase: ${currentPhase}
- Step: ${currentStep}
- Gap Iteration: ${gapIteration}
- Pending Tasks: ${pendingTasks.length}

To resume: Skill(skill="team-roadmap-dev", args="--resume ${sessionFolder}")
`
```

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| state.md | `{sessionFolder}/state.md` | Updated with paused status and resume coordinates |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| state.md edit fails | Write full state.md from scratch with pause info |
| Task list unavailable | Record phase/step only, skip task listing |
