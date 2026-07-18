---
title: "Maestro Ralph Adaptive Lifecycle Engine Guide"
---

Closed-loop decision engine — reads project state, infers lifecycle position, builds adaptive command chains, with decision nodes that dynamically expand/shrink the chain.

---

## Positioning

Maestro Ralph is the **fully automated progression engine** of Maestro Flow:

1. Read project state and automatically infer the current lifecycle position
2. Build a complete command chain from the current position to the target
3. Insert **decision nodes** at key checkpoints, dynamically adjusting the chain
4. On failure, automatically insert debug → fix → retry loops

**Live chain**: The chain can grow/shrink during execution. Difference from [Maestro](./maestro-coordinator-guide.en.md):

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **Chain type** | Static chain, fixed once determined | Live chain, decision nodes dynamically expand |
| **Loops** | None | Closed-loop (failure → debug → fix → retry) |
| **Decision nodes** | None | post-verify, post-review, post-test, post-milestone |
| **Use case** | One-off tasks, clear intent | Full milestone lifecycle progression |

---

## Usage

```bash
/maestro-ralph "implement user authentication system"  # New session
/maestro-ralph continue                                # Resume execution
/maestro-ralph -y "implement auth"                     # Fully automatic mode
/maestro-ralph status                                  # View progress
```

---

## Three Node Types

| Type | Execution Method | Description |
|------|------------------|-------------|
| **skill** | `Skill()` synchronous call | Actual command execution (plan, execute, review, etc.) |
| **cli** | `maestro delegate` background | CLI delegate execution |
| **decision** | Ralph re-evaluation | Reads execution results, decides to continue or insert fix loop |

---

## Lifecycle Stages

<details>
<summary>Full Flow Diagram</summary>

```
brainstorm → init → roadmap → analyze → plan → execute
    (0→1)                                        ↓
                                              verify
                                                ↓
                                        ◆ post-verify
                                                ↓
                                      business-test (full)
                                                ↓
                                      ◆ post-business-test
                                                ↓
                                            review
                                                ↓
                                        ◆ post-review
                                                ↓
                                          test-gen + test
                                                ↓
                                          ◆ post-test
                                                ↓
                                        session-seal
                                                ↓
                                      ◆ post-milestone
                                          ↓        ↓
                                    Next M     All Done
```

Each `◆` is a decision node. In non-`-y` mode, it pauses and waits for `continue`.

</details>

---

## Decision Nodes Explained

| Node | Reads File | Pass | Failure Handling |
|------|------------|------|------------------|
| **post-verify** | `verification.json` | Continue | Insert debug → plan --gaps → execute → verify loop |
| **post-review** | `review.json` | PASS/WARN continue | BLOCK → insert fix loop |
| **post-test** | `uat.md` + `test-results.json` | All passed | Lightweight retry of failed quality gates |
| **post-milestone** | `state.json` | Has next M → insert full chain | All complete → session ends |
| **post-debug-escalate** | — | — | Max retries reached, pause for manual intervention |

---

## Quality Pipeline Modes

| Mode | Quality Steps | Trigger Condition |
|------|---------------|-------------------|
| `full` | verify → business-test → review → test-gen → test | Has REQ-*.md and phase scope |
| `standard` | verify → review → test (test-gen based on coverage) | Default |
| `quick` | verify → CLI-review (skip business-test, test-gen, test) | User-specified |

`session.passed_gates[]` records passed quality gates. During retries: gates that passed with unchanged code are skipped; code modifications clear affected gates for re-execution.

---

## Session Files

Storage location: `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`

<details>
<summary>JSON Schema Example</summary>

```json
{
  "session_id": "ralph-20260503-143022",
  "source": "ralph",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "ralph-lifecycle",
  "task_type": "lifecycle",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "quality_mode": "standard",
  "passed_gates": ["verify"],
  "lifecycle_position": "plan",
  "target": "session-seal",
  "steps": [
    { "index": 0, "type": "skill", "skill": "maestro-next", "args": "<plan intent>", "status": "completed" },
    { "index": 1, "type": "skill", "skill": "maestro-ralph", "args": "continue", "status": "completed" },
    { "index": 2, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}", "status": "running" },
    { "index": 3, "type": "skill", "skill": "maestro-ralph", "args": "--engine swarm --script wf-review", "status": "pending" }
  ],
  "current_step": 2
}
```

**Step types**: `"skill"` actual command / `"cli"` CLI delegate / `"decision"` Ralph decision evaluation (Ralph-only)

</details>

---

## Execution Flow

| Mode | Flow |
|------|------|
| **New session** | Read state.json → infer position → build steps[] → confirm → execute |
| **Resume** | Find running session → read results → evaluate → may insert fix loop → continue |
| **`-y` automatic** | Build chain → execute → decision auto-evaluate → continue (or escalate pause) |

---

## Lifecycle Position Inference

| Condition | Inferred Position |
|-----------|-------------------|
| No `.workflow/` | `brainstorm` (empty project) or `init` (has code) |
| Has state.json, no milestones | `roadmap` |
| Has milestones, no artifacts | `analyze` |
| Latest artifact type == analyze | `plan` |
| Latest artifact type == plan | `execute` |
| Latest artifact type == execute | `verify` |
| verify passed | `post-verify` (follow-up depends on quality_mode) |
| verify failed | `verify-failed` (insert fix loop) |

---

## Unified Executor

Maestro and Ralph share `/maestro-ralph continue`:

- **skill nodes**: `Skill()` synchronous call, auto-advances to next step
- **cli nodes**: `maestro delegate` background execution, waits for callback
- **decision nodes**: Calls back to `maestro-ralph` for evaluation (Ralph sessions only)

Maestro sessions have no decision nodes — purely sequential execution.

---

## Max Retries and Escalation

Each decision node carries `retry_count` and `max_retries` (default 2):

- **retry 0**: First evaluation → failed → insert fix loop
- **retry 1**: Second evaluation → still failed → fix again
- **retry 2**: Limit reached → escalate to `post-debug-escalate` → pause

After escalation, session status becomes `paused`. User handles it, then `continue` to resume.

---

## Ralph CLI — Delegated Execution Mode

Ralph CLI is a **CLI-delegated variant** of Ralph. The core chain-building logic is identical, but each step is executed via `maestro delegate` to an external CLI tool rather than inline in the current session.

### Differences from Standard Ralph

| | Ralph | Ralph CLI |
|---|-------|-----------|
| **Execution** | `maestro ralph next` + inline execution | `maestro delegate` background delegation |
| **Context passing** | session_anchor auto-injection | 10-section prompt composition (A_COMPOSE_STEP_PROMPT) |
| **Inter-step analysis** | Direct artifact reads | Artifact scanning + signal extraction after each step |
| **CLI tool** | Fixed to current platform | Selectable (`--to claude\|codex\|opencode\|agy`, default claude) |
| **Session prefix** | `ralph-{ts}` | `ralph-cli-{ts}` |

### Usage

```bash
/maestro-ralph "refactor auth module"              # Default Claude execution
/maestro-ralph --to codex "implement auth"         # Specify Codex
/maestro-ralph -y "implement auth"                 # Fully automatic
/maestro-ralph continue                            # Resume execution
/maestro-ralph status                              # View progress
```

### Prompt Composition Engine

Before each delegation, A_COMPOSE_STEP_PROMPT assembles a structured prompt with 10 sections:

```
PURPOSE  — stage goal + success criteria
SESSION  — intent / phase / lifecycle / milestone
BOUNDARY — in_scope / out_of_scope / constraints / definition_of_done
ACTIVE GOALS — pending sub-goals with completion criteria
EXECUTION HISTORY — last 5 steps' summary / decisions / caveats (sliding window)
ACCUMULATED SIGNALS — all steps' caveats + deferred (full aggregation)
ARTIFACTS — stage-specific predecessor artifact injection
TASK     — concrete execution instruction
EXPECTED — expected output format
CONSTRAINTS — boundary + execution_criteria
```

### Execution Flow

```
maestro-ralph builds chain → maestro-ralph continue composes prompt → maestro delegate background
                                                                    ↓
                                                               STOP wait for callback
                                                                    ↓
                                                         callback → analyze artifacts → maestro ralph complete
                                                                    ↓
                                                         self-invoke next step → loop
```

### Extended Session Fields

```json
{
  "execution_mode": "cli-delegate",
  "cli_tool": "claude",
  "steps": [{
    "delegate_exec_id": "exe-143025-a1b2",
    "delegate_mode": "write",
    "delegate_role": "implement",
    "cli_output_summary": "Implemented 12 file changes, passed built-in verification",
    "artifacts_produced": ["verification.json"]
  }]
}
```
