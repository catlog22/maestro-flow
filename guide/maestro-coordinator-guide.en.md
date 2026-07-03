---
title: "Maestro Coordinator Guide"
---

Static chain selector — analyzes user intent, reads project state, selects the optimal command chain, and hands it off to the unified executor for sequential execution.

---

## Positioning

Maestro is the **main entry point** of Maestro Flow. It does not execute any skills itself:

1. Parse user intent (action + object + scope)
2. Read project state (`.workflow/state.json`)
3. Select the optimal chain from 40+ command chains
4. Create a session and hand it off to `maestro-ralph-execute`

**Static chain**: Once determined, it does not change. No decision nodes, no closed-loop cycles. One-pass sequential execution.

Difference from [Maestro Ralph](./maestro-ralph-guide.en.md):

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **Positioning** | Static chain selector | Adaptive lifecycle engine |
| **Chain type** | Fixed chain, immutable after creation | Live chain, decision nodes dynamically expand/shrink |
| **Loops** | None | Closed-loop (failure → debug → fix → retry) |
| **Use case** | One-off tasks, clear intent | Full milestone progression, automated closed-loop |
| **Executor** | `maestro-ralph-execute` (unified) | `maestro-ralph-execute` (unified) |

---

## Usage

```bash
/maestro "implement user authentication"  # Intent-driven
/maestro continue                          # Auto-advance based on state
/maestro status                            # View project dashboard
```

### Flags

| Flag | Description |
|------|-------------|
| `-y` | Auto mode: skip confirmations, auto-propagate to downstream commands |
| `-c` | Resume mode: continue from the last interrupted session |
| `--dry-run` | Show the planned chain without executing |
| `--exec auto\|cli\|internal` | Force execution engine |
| `--super` | Super mode: fully automated delivery |

---

## Intent Routing

Maestro uses an `action x object` matrix for semantic routing:

| action | Trigger Semantics |
|--------|-------------------|
| `create` | Build new features, components, specs |
| `fix` | Fix bugs, resolve errors |
| `analyze` | Analyze, evaluate, investigate |
| `plan` | Design approach, plan, decompose |
| `execute` | Implement, develop, code |
| `review` | Code review |
| `test` | Run/create tests |
| `debug` | Diagnose, troubleshoot |
| `refactor` | Restructure, clean up tech debt |
| `explore` | Brainstorm, diverge |
| `manage` | CRUD / lifecycle management |
| `continue` | Resume, continue |

### Routing Examples

| Input | Route | Command Chain |
|-------|-------|---------------|
| `"Add API endpoint"` | quick | `maestro-quick` |
| `"plan phase 2"` | plan | `maestro-plan 2` |
| `"debug auth crash"` | debug | `quality-debug` |
| `"fix issue ISS-abc-001"` | issue-full | analyze → plan → execute → review → close |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm → plan → execute → verify |
| `"continue"` | state_continue | Auto-infer from project state |

---

## Command Chains

### Single-Step Chains

| Chain Name | Command |
|------------|---------|
| `analyze` | `maestro-analyze {milestone}` |
| `plan` | `maestro-plan {milestone}` |
| `execute` | `maestro-execute {phase}` |
| `review` | `quality-review {phase}` |
| `test` | `quality-test {phase}` |
| `debug` | `quality-debug "{description}"` |
| `quick` | `maestro-quick "{description}"` |

### Multi-Step Chains

| Chain Name | Steps | Use Case |
|------------|-------|----------|
| `full-lifecycle` | plan → execute → review → test → audit | Complete milestone |
| `roadmap-driven` | init → roadmap → plan → execute | Starting from requirements |
| `brainstorm-driven` | brainstorm → plan → execute | Starting from exploration |
| `execute-review` | execute → review | Resume after planning |
| `review-fix` | plan --gaps → execute → review | Fix review issues |
| `issue-full` | analyze → plan → execute → review → close | Issue closed-loop |
| `milestone-close` | audit → complete | Close milestone |

---

## Session Files

Storage location: `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`

<details>
<summary>JSON Schema Example</summary>

```json
{
  "session_id": "maestro-20260503-143022",
  "source": "maestro",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "full-lifecycle",
  "task_type": "execute",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "exec_mode": "auto",
  "steps": [
    {
      "index": 0,
      "type": "skill",
      "skill": "maestro-plan",
      "args": "1",
      "status": "pending"
    }
  ],
  "current_step": 0
}
```

**Step type**: `"skill"` in-session call (lightweight) / `"cli"` CLI delegate background execution (heavyweight)

Maestro sessions do **not** have `"decision"` type steps — the core difference from Ralph.

</details>

---

## Execution Flow

```
User Input → Intent Parsing → Chain Selection → Session Creation → maestro-ralph-execute → Sequential Execution
```

1. **Intent Parsing**: Extract action, object, scope, phase_ref
2. **State Reading**: Read `.workflow/state.json`
3. **Chain Selection**: Select command chain from chainMap
4. **Type Selection**: Pre-compute step type (auto: heavyweight → cli, lightweight → skill)
5. **Session Creation**: Write status.json
6. **Execution Dispatch**: Call unified executor

### State Inference (continue mode)

| Current State | Inferred Chain |
|---------------|----------------|
| Not initialized | `init` |
| Has roadmap, target phase has no artifacts | `analyze` |
| Latest artifact is analyze | `plan` |
| Latest is plan | `execute-verify` |
| Verify passed, no review | `review` |
| UAT passed | `milestone-close` |
| All phases complete | `milestone-close` |

---

## `-y` Auto Mode Propagation

When `-y` is enabled, Maestro propagates the auto flag to downstream commands:

| Command | Flag | Effect |
|---------|------|--------|
| maestro-init | `-y` | Skip interactive questioning |
| maestro-analyze | `-y` | Skip interactive scoping |
| maestro-plan | `-y` | Skip confirmations and clarification |
| maestro-execute | `-y` | Skip confirmations, auto-continue on blocked |
| quality-test | `-y --auto-fix` | Auto-trigger gap-fix loop |
| maestro-milestone-complete | `-y` | Skip knowledge promotion |

---

## Resume Execution

```bash
/maestro -c    # Resume from the most recent session
```

Resume mode skips intent parsing and chain selection, continuing directly from the next pending step in status.json.
