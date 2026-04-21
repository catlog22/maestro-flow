---
name: maestro-link-coordinate
description: Step-mode graph coordinator via maestro coordinate CLI endpoint. Walks chain graphs node by node using start/next/status subcommands. Decision and gate nodes auto-resolve between steps. Session persisted for resume via -c.
argument-hint: "\"intent text\" [--list] [-c [sessionId]] [--chain <name>] [--tool <tool>] [-y]"
allowed-tools: Read, Write, Bash, Glob, Grep
---

<purpose>
Step-mode coordinator that drives `maestro coordinate` CLI subcommands one node at a time. Each call to `maestro coordinate next` advances the walker one graph node forward. Decision nodes resolve via `strategy: 'expr'` fast-path with LLM decider fallback. Gate nodes auto-bypass when conditions are met. The driver loop calls `next` until session status is `completed` or `step_paused` (on user checkpoint). Sessions are persisted by the server; `-c` resumes from the last paused node.

```
+-------------------------------------------------------------------+
|  maestro-link-coordinate Driver Loop                               |
+-------------------------------------------------------------------+
|                                                                   |
|  Phase 1: Session Start                                           |
|     +-- Parse flags                                               |
|     +-- [--list] exec: coordinate list -> display -> stop         |
|     +-- [-c] exec: coordinate status [sessionId] -> resume loop   |
|     +-- exec: coordinate start "intent" --chain X                 |
|     +-- Parse sessionId from output                               |
|                                                                   |
|  Phase 2: Step Driver Loop                                        |
|     +-- while (status != completed):                              |
|     |   +-- exec: coordinate next [sessionId]                     |
|     |   +-- Parse node type from output:                          |
|     |   |   command    -> display result, [confirm?]              |
|     |   |   decision   -> auto-resolved by walker (expr / llm)    |
|     |   |   gate       -> auto-bypassed if conditions met         |
|     |   |   checkpoint -> pause, display status, await user       |
|     |   +-- Update progress display                               |
|     +-- exec: coordinate status [sessionId] after completion      |
|                                                                   |
|  Phase 3: Completion Summary                                       |
|     +-- Display per-node execution results                        |
|     +-- Show final session state                                  |
+-------------------------------------------------------------------+
```
</purpose>

<context>
$ARGUMENTS -- user intent text, or special flags.

**Usage**:

```bash
$maestro-link-coordinate "implement OAuth2 authentication"
$maestro-link-coordinate "--list"
$maestro-link-coordinate -c "MLC-20260401-143022"
$maestro-link-coordinate --chain quality-full-cycle "fix all test failures"
$maestro-link-coordinate -y "refactor auth module"
```

**Flags**:
- `--list` -- List all available chain graphs (uses `maestro coordinate list`)
- `-c / --continue [sessionId]` -- Resume `step_paused` session; uses last session if no id given
- `--chain <name>` -- Force a specific chain graph
- `--tool <tool>` -- CLI tool override for command nodes (default: claude)
- `-y / --yes` -- Auto mode: no step confirmations

When `-y` or `--yes`: Skip step confirmations between nodes. Runs to completion without pausing.

**CLI endpoints used**:
- `maestro coordinate list` -- enumerate available chains
- `maestro coordinate start "intent" --chain X` -- begin step-mode session
- `maestro coordinate next [sessionId]` -- advance one step
- `maestro coordinate status [sessionId]` -- query current state
- `maestro coordinate run "intent"` -- autonomous full run (used when `-y`)
- `maestro coordinate watch <sessionId> [--follow]` -- read-only event tail
- `maestro coordinate report` -- agent-invoked result writer (authoritative result channel)
</context>

<invariants>
1. **Quick-exit for `--list`**: Never start a session if user only wants to list chains
2. **One step at a time**: Drive with `coordinate next` calls -- never batch-advance multiple nodes
3. **Decision nodes are walker-owned**: Never try to resolve decision nodes manually; trust walker output
4. **Checkpoint is a hard pause**: Never auto-advance past a checkpoint node without explicit user confirmation
5. **Resume is server-side**: Session state is held by the server; `-c` only provides the sessionId -- the walker has all state
6. **Auto mode uses `run`**: When `-y`, use `coordinate run` directly rather than the start + next loop
7. **Status is authoritative**: After loop exits, always call `coordinate status` to get the canonical final state
</invariants>

<execution>

### Phase 1: Session Start

```javascript
functions.update_plan({
  explanation: "Starting link-coordinate session",
  plan: [
    { step: "Phase 1: Session start", status: "in_progress" },
    { step: "Phase 2: Step driver loop", status: "pending" },
    { step: "Phase 3: Completion summary", status: "pending" }
  ]
})
```

**Quick-exit: `--list`**
```javascript
functions.exec_command({
  cmd: "maestro coordinate list",
  workdir: "."
})
// Display output and stop
```

**Resume mode: `-c [sessionId]`**
```javascript
functions.exec_command({
  cmd: `maestro coordinate status ${sessionId || ''}`,
  workdir: "."
})
// Parse sessionId from output, skip to Phase 2 driver loop
```

**Fresh session**:
```javascript
functions.exec_command({
  cmd: `maestro coordinate start "${intent}"${chain ? ' --chain ' + chain : ''}`,
  workdir: "."
})
// Parse sessionId from JSON output: { "session_id": "...", "chain": "...", "first_node": "..." }
```

### Phase 2: Step Driver Loop

```javascript
functions.update_plan({
  explanation: "Stepping through chain graph",
  plan: [
    { step: "Phase 1: Session start", status: "completed" },
    { step: "Phase 2: Step driver loop", status: "in_progress" },
    { step: "Phase 3: Completion summary", status: "pending" }
  ]
})
```

Main loop:
```javascript
while (status !== 'completed' && status !== 'failed') {
  functions.exec_command({
    cmd: `maestro coordinate next ${sessionId}`,
    workdir: "."
  })
  // Parse response JSON: { node_type, node_id, status, result, next_status }
}
```

**Node type handling**:

| node_type | Action |
|-----------|--------|
| `command` | Display result summary; if `!AUTO_YES`, call `request_user_input` to confirm before next |
| `decision` | Auto-resolved by walker (expr fast-path or LLM). Display resolved edge. |
| `gate` | Auto-bypassed if conditions met. Display gate status. |
| `checkpoint` | Pause loop, display current state, await explicit user `$maestro-link-coordinate -c` |
| `eval` | Display evaluation result and score |

**Auto mode (`-y`)**: Use `maestro coordinate run "${intent}"` instead of start + next loop for autonomous execution.

**Watch mode** (optional, for long-running steps):
```javascript
functions.exec_command({
  cmd: `maestro coordinate watch ${sessionId} --follow`,
  workdir: "."
})
```

### Phase 3: Completion Summary

```javascript
functions.exec_command({
  cmd: `maestro coordinate status ${sessionId}`,
  workdir: "."
})
```

```javascript
functions.update_plan({
  explanation: "Link-coordinate complete",
  plan: [
    { step: "Phase 1: Session start", status: "completed" },
    { step: "Phase 2: Step driver loop", status: "completed" },
    { step: "Phase 3: Completion summary", status: "completed" }
  ]
})
```

Display:
```
=== GRAPH WALK COMPLETE ===
Session:  <sessionId>
Chain:    <chain>
Nodes:    <N> executed

NODE RESULTS:
  [1] <node_id> (command)  -- completed
  [2] <node_id> (decision) -- resolved: <edge>
  [3] <node_id> (command)  -- completed

To re-run: $maestro-link-coordinate "<intent>" --chain <chain>
```
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no `--list`/`--chain` provided | Suggest `--list` to see available chains |
| E002 | error | Chain graph not found | Display `maestro coordinate list` output |
| E003 | error | Step execution failed on a command node | Check node result, use `-c` to retry from that node |
| E004 | error | Resume session not found | List sessions in coordinate status |
| E005 | error | `maestro coordinate` CLI endpoint unavailable | Check maestro installation |
</error_codes>

<success_criteria>
- [ ] Session started or resumed successfully
- [ ] Each node advanced one at a time via `coordinate next`
- [ ] Decision and gate nodes auto-resolved by walker
- [ ] Checkpoint nodes pause execution and await explicit resume
- [ ] Auto mode (`-y`) uses `coordinate run` for unattended execution
- [ ] Completion summary displays per-node results
- [ ] `--list` quick-exits without starting a session
- [ ] `-c` resumes from last paused node
</success_criteria>
