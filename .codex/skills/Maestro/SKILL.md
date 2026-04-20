---
name: Maestro
description: Intelligent coordinator — analyze intent + read project state → select optimal command chain → execute sequentially via team-agent pipeline. Classifies intent, maps to skill chain, spawns one agent per step whose prompt contains the skill invocation ($skill-name "intent"). Step results propagate as context to each successor.
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--chain <name>]"
allowed-tools: spawn_agent, wait_agent, send_message, close_agent, Read, Write, Bash, Glob, Grep
---

## Auto Mode

When `-y` or `--yes`: Skip clarification and confirmation prompts. Pass `-y` through to each step's skill invocation.

# Maestro

## Usage

```bash
$Maestro "implement user authentication with JWT"
$Maestro -y "refactor the payment module"
$Maestro --continue
$Maestro --dry-run "add rate limiting to API endpoints"
$Maestro --chain feature "add dark mode toggle"
```

**Flags**:
- `-y, --yes` — Auto mode: skip all prompts; propagate `-y` to each skill
- `--continue` — Resume latest paused session from last incomplete step
- `--dry-run` — Display planned chain without spawning any agents
- `--chain <name>` — Force a specific chain (skips intent classification)

**Session state**: `.workflow/.maestro-coordinate/{session-id}/state.json`

---

## Overview

Sequential pipeline coordinator (Pattern 2.5). Each chain step is one `spawn_agent` whose message contains a `$skill-name "intent"` invocation together with context accumulated from prior steps. The agent executes the skill and returns structured findings; those findings are injected into the next step's spawn message as `## Context from Previous Steps`.

```
Intent  →  Resolve Chain  →  Step 1  →  Step 2  →  …  →  Step N  →  Report
              (chainMap)     spawn         spawn               spawn
                             wait          wait                wait
                             close         close               close
                              │             │                   │
                           findings  →  prev_context  →  prev_context
```

---

## Chain Map

| Intent keywords | Chain | Steps (skills, in order) |
|----------------|-------|--------------------------|
| fix, bug, error, broken, crash | `quality-fix` | $maestro-analyze --gaps → $maestro-plan --gaps → $maestro-execute → $maestro-verify |
| test, spec, coverage | `quality-test` | $quality-test |
| refactor, cleanup, debt | `quality-refactor` | $quality-refactor |
| feature, implement, add, build | `feature` | $maestro-plan → $maestro-execute → $maestro-verify |
| review, check, audit | `quality-review` | $quality-review |
| deploy, release, ship | `deploy` | $maestro-verify → $maestro-execute |

---

## Implementation

> **Full implementation reference**: The complete `detectTaskType`, `detectNextAction`, and `chainMap` definitions (35+ intent patterns, 40+ chain types) are in `~/.maestro/workflows/maestro.codex.md`. Read that file for authoritative logic before executing any step.

### Session Initialization

```javascript
const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '')
const timeStr = new Date().toISOString().substring(11, 19).replace(/:/g, '')
const sessionId = `MCC-${dateStr}-${timeStr}`
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`

Bash(`mkdir -p ${sessionDir}`)

functions.update_plan({
  explanation: "Starting coordinate session",
  plan: [
    { step: "Phase 1: Resolve intent and chain", status: "in_progress" },
    { step: "Phase 2: Execute steps (pipeline)", status: "pending" },
    { step: "Phase 3: Completion report", status: "pending" }
  ]
})
```

### Phase 1: Resolve Intent and Chain

**`--continue` mode**: Glob `.workflow/.maestro-coordinate/MCC-*/state.json` sorted by name desc; load the most recent; skip to Phase 2 at the first step where `status === "pending"`.

**Fresh mode**:

1. Read `.workflow/state.json` for project context (`current_phase`, `workflow_name`)
2. If `--chain` is given, use it directly
3. Otherwise, classify intent with keyword heuristics (see Chain Map above)
4. If no keyword matches and not `AUTO_YES`: ask one clarifying question via `functions.request_user_input`
5. Resolve the chain's skill list from Chain Map
6. Write `state.json`:

```javascript
Write(`${sessionDir}/state.json`, JSON.stringify({
  id: sessionId,
  intent,
  chain: resolvedChain,
  auto_yes: AUTO_YES,
  status: "in_progress",
  started_at: new Date().toISOString(),
  steps: CHAIN_MAP[resolvedChain].map((skill, i) => ({
    step_n: i + 1,
    skill,
    status: "pending",
    findings: null,
    quality_score: null,
    hints_for_next: null
  }))
}, null, 2))
```

**`--dry-run`**: Display the chain plan and stop — no agents spawned.

```
Chain:  <resolvedChain>
Steps:
  1. <skill-1>
  2. <skill-2>
  3. <skill-3>
```

**User confirmation** (skip if `AUTO_YES`): Display the plan above and prompt `Proceed? (yes/no)`.

```javascript
functions.update_plan({
  explanation: "Chain resolved, starting pipeline",
  plan: [
    { step: "Phase 1: Resolve intent and chain", status: "completed" },
    { step: "Phase 2: Execute steps (pipeline)", status: "in_progress" },
    { step: "Phase 3: Completion report", status: "pending" }
  ]
})
```

---

### Phase 2: Execute Steps (Pipeline)

Sequential loop — each step spawns one agent, waits for it, extracts findings, then closes it before spawning the next.

```javascript
let prevContext = ''  // accumulates across steps

for (const step of state.steps.filter(s => s.status === 'pending')) {
  const skillFlag = AUTO_YES ? `-y` : ''

  // Assemble the agent prompt with the skill invocation embedded
  const stepPrompt = buildStepPrompt({
    step,
    totalSteps: state.steps.length,
    chain: state.chain,
    intent: state.intent,
    prevContext,
    skillFlag,
    sessionDir
  })

  // Spawn step agent
  const agent = spawn_agent({ message: stepPrompt })

  // Wait — initial spawn: 30 min
  let result = wait_agent({ timeout_ms: 1800000 })
  if (result.timed_out) {
    // Step 1: Status probe (non-interrupting, 3 min)
    followup_task({ target: agent, message: "STATUS_CHECK: Report current progress, findings so far, and estimated remaining work." })
    const status = wait_agent({ timeout_ms: 180000 })
    if (status.timed_out) {
      // Step 2: Force finalize (interrupt, 3 min)
      followup_task({ target: agent, message: "FINALIZE: Output all current findings immediately. Time limit reached.", interrupt: true })
      const forced = wait_agent({ timeout_ms: 180000 })
      if (forced.timed_out) {
        // Step 3: Abort
        close_agent({ target: agent })
      } else {
        result = forced
      }
    } else {
      result = status
    }
  }

  // Parse structured output from agent
  const output = parseLastJSON(result.status[agent].completed) ?? {
    quality_score: null,
    findings: result.status[agent].completed?.slice(-500) ?? "(no output)",
    hints_for_next: ""
  }

  close_agent({ target: agent })

  // Persist step result
  step.status = result.timed_out ? "failed" : "completed"
  step.findings = output.findings
  step.quality_score = output.quality_score
  step.hints_for_next = output.hints_for_next
  step.completed_at = new Date().toISOString()
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2))

  // Build prev_context for next step
  prevContext += `\n\n## Step ${step.step_n}: ${step.skill}\nFindings: ${step.findings}\nHints: ${step.hints_for_next ?? ''}`

  // Abort on failure — mark remaining steps as skipped
  if (step.status === "failed") {
    state.steps
      .filter(s => s.status === 'pending')
      .forEach(s => { s.status = 'skipped'; s.findings = `Blocked: step ${step.step_n} (${step.skill}) failed` })
    state.status = "aborted"
    Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2))
    break
  }
}
```

---

#### Step Agent Prompt Template (`buildStepPrompt`)

The assembled prompt embeds the skill call so the agent knows exactly what to invoke:

```
## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read: ~/.maestro/workflows/maestro-coordinate.codex.md
2. Read: ~/.codex/skills/{skill}/SKILL.md

---

**Coordinate Chain: {chain}  |  Step {step_n} of {totalSteps}**

## Skill Invocation
Execute this skill call to complete your task:

  ${skill} "{intent}" {skillFlag}

Follow the Implementation section of the skill file you read in step 2.
The intent above is your driving goal.

{#if prevContext}
## Context from Previous Steps
{prevContext}

Use hints from the previous step to guide execution priorities.
{/if}

## Output (required — last JSON block in your response)
After execution complete, output exactly:
```json
{
  "quality_score": <0-10>,
  "findings": "<what was accomplished — max 500 chars>",
  "hints_for_next": "<specific guidance for the next chain step>"
}
```

Session artifacts: {sessionDir}/
```

---

### Phase 3: Completion Report

```javascript
state.status = state.steps.every(s => s.status === 'completed') ? "completed" : state.status
Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2))

functions.update_plan({
  explanation: "Coordinate complete",
  plan: [
    { step: "Phase 1: Resolve intent and chain", status: "completed" },
    { step: "Phase 2: Execute steps (pipeline)", status: "completed" },
    { step: "Phase 3: Completion report", status: "completed" }
  ]
})
```

Display:
```
=== COORDINATE COMPLETE ===
Session:  <sessionId>
Chain:    <chain>
Steps:    <N completed>/<total>

STEP RESULTS:
  [1] <skill>  — score: <N>/10  ✓  <findings summary>
  [2] <skill>  — score: <N>/10  ✓  <findings summary>
  [3] <skill>  — score: <N>/10  ✓  <findings summary>

State:  .workflow/.maestro-coordinate/<sessionId>/state.json
Resume: $Maestro --continue
```

---

## Error Handling

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent unclassifiable after clarification | Default to `feature` chain; note in state.json |
| E002 | error | `--chain` value not in chain map | List valid chains, abort |
| E003 | error | Step agent timeout (4-step cascade exhausted) | Mark step `failed`; skip remaining steps; suggest `--continue` |
| E004 | error | Step agent failed (non-JSON output) | Mark step `failed`; preserve raw output in `findings`; skip remaining |
| E005 | error | `--continue`: no session found | Glob `.workflow/.maestro-coordinate/MCC-*/`, list sessions, prompt |
| W001 | warning | Step output JSON missing `hints_for_next` | Continue with empty hints; next step still gets `findings` |

---

## Core Rules

1. **Start Immediately**: Init session dir and write `state.json` before any spawn
2. **Sequential**: Never spawn step N+1 until step N agent is closed and results written
3. **Skill in Prompt**: Every step agent's message MUST contain `$skill-name "intent"` — this is how the agent knows which skill to execute
4. **State.json is source of truth**: Write after every step; `--continue` reads it to resume
5. **Skip on Failure**: Step failure immediately marks all remaining steps `skipped` and aborts the loop
6. **Close before spawn**: Always `close_agent` the current step agent before spawning the next
7. **Dry-run is read-only**: Stop after displaying the chain plan — never spawn agents
8. **Timeout handling**: 4-step cascade — status probe → force finalize → abort; if all timed out → mark `failed`
9. **No CLI fallback**: All execution is agent-native — no `exec_command("maestro delegate ...")`
