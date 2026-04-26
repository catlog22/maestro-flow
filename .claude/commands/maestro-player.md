---
name: maestro-player
description: Workflow template player — load JSON template, bind variables, execute DAG nodes in order, persist state at checkpoints, support resume
argument-hint: "<template-slug|path> [--context key=value...] [-c [session-id]] [--list] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - Skill
---
<purpose>
Load a workflow template (produced by maestro-composer) → bind context variables →
execute DAG nodes in topological order → persist state at checkpoints → support resume.

Node execution mechanisms:
- `skill` node → `Skill()` (synchronous)
- `command` node → `Skill()` with namespace (synchronous)
- `cli` node → `maestro delegate` (background + wait for callback)
- `agent` node → `Agent()` (sync or background per config)
- `checkpoint` node → state save, optional user pause

Session state persisted at `.workflow/.maestro/<session_id>/status.json` (same tracking
location as maestro.md), enabling resume from any checkpoint via `-c`.
</purpose>

<context>
$ARGUMENTS — template slug/path, or flags.

**Flags:**
- `--context key=value` — Bind context variables (repeatable)
- `-c` / `--continue [session-id]` — Resume paused/interrupted session (consistent with maestro.md)
- `--list` — List available templates from `~/.maestro/templates/workflows/index.json`
- `--dry-run` — Show execution plan without executing

**Entry routing:**

| Detection | Condition | Handler |
|-----------|-----------|---------|
| List templates | `--list` in args | handleList |
| Resume session | `-c [session-id]` | Phase 0: Resume |
| Dry run | `--dry-run` in args | Phase 1 + 2, print plan, exit |
| Normal | Template slug/path provided | Phase 1 |
| No args | Empty args | handleList + AskUserQuestion |

**Shared constants (aligned with maestro.md tracking):**

| Constant | Value |
|----------|-------|
| Session prefix | `player` |
| Session dir | `.workflow/.maestro/player-<YYYYMMDD>-<HHmmss>/` |
| State file | `status.json` |
| Template dir (global) | `~/.maestro/templates/workflows/` |
| Template index (global) | `~/.maestro/templates/workflows/index.json` |

**Session status.json schema (aligned with maestro.md):**

```json
{
  "session_id": "player-<YYYYMMDD>-<HHmmss>",
  "created_at": "<ISO>",
  "intent": "<template_name> with context",
  "task_type": "player",
  "chain_name": "<template_id>",
  "template_id": "wft-<slug>-<date>",
  "template_path": "~/.maestro/templates/workflows/<slug>.json",
  "template_name": "<name>",
  "auto_mode": false,
  "status": "running | paused | completed | failed | aborted",
  "context": { "goal": "...", "scope": "..." },
  "steps": [
    {
      "index": 0,
      "node_id": "N-001",
      "skill": "<executor>",
      "args": "<resolved_args>",
      "type": "skill | cli | command | agent | checkpoint",
      "status": "pending | running | completed | skipped | failed",
      "started_at": null,
      "completed_at": null,
      "session_id": null,
      "output_path": null,
      "artifacts": [],
      "error": null
    }
  ],
  "current_step": 0,
  "last_checkpoint": null,
  "updated_at": "<ISO>",
  "completed_at": null
}
```

**Session directory structure (under .workflow/.maestro/):**

```
.workflow/.maestro/player-<YYYYMMDD>-<HHmmss>/
├── status.json             # Main state file (maestro.md compatible)
├── checkpoints/
│   ├── CP-01.json
│   └── CP-02.json
└── artifacts/
    └── N-001-output.md
```

**Node execution mechanisms:**

| Node type | Mechanism | Blocking |
|-----------|-----------|----------|
| skill | `Skill(skill=executor, args=resolved_args)` | sync |
| command | `Skill(skill=executor, args=resolved_args)` | sync |
| cli | `maestro delegate "prompt" --to tool --mode mode --rule rule` via `Bash(run_in_background: true)` | async, wait for callback |
| agent | `Agent(subagent_type=executor, prompt=resolved_args)` | configurable |
| checkpoint | State save + optional user pause | — |

**Runtime reference resolution:**

Before executing each node, resolve `{ref}` patterns in `args_template`:

| Reference | Resolves To |
|-----------|-------------|
| `{variable}` | `session_state.context[variable]` |
| `{N-001.session_id}` | `node_states["N-001"].session_id` |
| `{N-001.output_path}` | `node_states["N-001"].output_path` |
| `{prev_session_id}` | session_id of previous non-checkpoint node |
| `{prev_output_path}` | output_path of previous non-checkpoint node |

Fallback: if referenced field is null, substitution results in empty string.
</context>

<execution>

### handleList

Scan `~/.maestro/templates/workflows/index.json`. Display:
```
Available workflow templates:
  feature-tdd-review    [feature, complex]   3 work nodes, 2 checkpoints
  quick-bugfix          [bugfix, simple]     2 work nodes, 1 checkpoint

Run: /maestro-player <slug> --context goal="..."
```

If index not found, output: "No templates found. Create one with /maestro-composer"

---

### Phase 0: Resume — Session Reconciliation

**Trigger**: `-c [session-id]`

1. If session-id provided: load `.workflow/.maestro/<session-id>/status.json`
2. If no session-id: scan `.workflow/.maestro/player-*/status.json` for `status = "running" | "paused"`
3. Multiple found → AskUserQuestion for selection
4. None found → error E004
5. Reset any `running` steps back to `pending` (interrupted mid-execution)
6. Determine next executable step from `steps[]` after `last_checkpoint`
7. Set `current_step` to resume point
8. Resume at Phase 3 (Execute Loop) from that step

---

### Phase 1: Load & Bind

**Objective**: Load template, collect missing variables, bind all references.

**Step 1.1** — Resolve template path:
1. Absolute path → use as-is
2. Relative path (`.` prefix) → resolve from cwd
3. Slug only → look up in `~/.maestro/templates/workflows/index.json`
4. Partial match → scan index, confirm with user
5. Not found → show available templates, AskUserQuestion

**Step 1.2** — Parse `--context key=value` pairs into `bound_context`.

**Step 1.3** — Load and validate template JSON (`template_id`, `nodes`, `edges`, `context_schema` must be present).

**Step 1.4** — Collect missing required variables:
- For each `context_schema` entry where `required: true` and not in `bound_context`:
  AskUserQuestion to collect value
- For optional variables: use `default` or empty string

**Step 1.5** — Bind variables: replace `{variable_name}` with values in all `args_template` strings. Leave `{N-xxx.field}` and `{prev_*}` unresolved (runtime Phase 3).

**Step 1.6** — If `--dry-run`: print execution plan and exit:
```
Workflow: <template.name>
Context:  goal = "<value>"

Execution Plan:
  [1] N-001  [skill]       maestro-plan        "<goal>"
  [2] CP-01  [checkpoint]  After Plan          auto-continue
  [3] N-002  [skill]       maestro-execute     --resume-session {N-001.session_id}

To execute: /maestro-player <slug> --context goal="..."
```

---

### Phase 2: Instantiate — Init Session State

**Objective**: Create session directory, init state, compute execution plan.

**Step 2.1** — Generate session ID: `player-<YYYYMMDD>-<HHmmss>`. Create directory at `.workflow/.maestro/<session_id>/`.

**Step 2.2** — Topological sort via Kahn's algorithm. Flatten nodes into `steps[]` array (maestro.md format). Parallel nodes get same batch index.

**Step 2.3** — Init all steps as `status: "pending"`.

**Step 2.4** — Write `status.json` (see schema in Context section).

**Step 2.5** — Show execution start banner:
```
============================================================
  MAESTRO PLAYER
============================================================
  Template: <template.name>
  Session:  <session_id>
  Context:  goal="<value>"

  Pipeline:
    1. N-001 [skill]      maestro-plan
    2. CP-01 [checkpoint] After Plan
    3. N-002 [skill]      maestro-execute
============================================================
```

---

### Phase 3: Execute Loop

**Objective**: Execute each step in order. Save state after every step.

**CRITICAL**: After each step status change, write `status.json` immediately. This enables resume on interruption.

**For each step starting at `current_step`:**

**3a. Display step banner** (consistent with maestro.md):
```
------------------------------------------------------------
  STEP {i+1}/{total}: {node_id} [{type}] {executor}
------------------------------------------------------------
  Args: {resolved_args}
```

**3b. Update status.json**: Set step status = `"running"`, started_at = now.

**3c. Execute by node type:**

**skill / command node**:
```
resolved_args = resolveArgs(step.args_template, status)
Skill(skill=step.skill, args=resolved_args)

Extract from result: session_id (WFS-*), output_path, artifacts
Update step: status="completed", session_id, output_path, artifacts, completed_at
Write status.json
```

**cli node — CRITICAL: background + stop**:
```
resolved_args = resolveArgs(step.args_template, status)

Bash({
  command: `maestro delegate "${resolved_args}" --to ${step.cli_tool} --mode ${step.cli_mode} --rule ${step.cli_rule}`,
  run_in_background: true
})

Write status.json  // persist "running" state
STOP — wait for background callback
```

On callback:
```
Load status.json
Find step with status "running"
Retrieve output: maestro delegate output <exec_id>
Update step: status="completed", output_path, completed_at
Write status.json
Advance to next step
```

**agent node**:
```
resolved_args = resolveArgs(step.args_template, status)

Agent({
  subagent_type: step.skill,
  prompt: resolved_args,
  run_in_background: step.run_in_background ?? false,
  description: step.node_id
})

Update step: status="completed", output_path, completed_at
Write status.json
```

**checkpoint node**:
```
// 1. Write checkpoint snapshot
Write <session_dir>/checkpoints/<step.node_id>.json with:
  session_id, checkpoint_id, saved_at, steps_snapshot, last_completed_step

// 2. Update status.json
status.last_checkpoint = step.node_id
Mark step completed, write status.json

// 3. If auto_continue == false: pause for user
AskUserQuestion:
  - Continue → proceed
  - Pause → set status="paused", write status.json, output resume command, EXIT
  - Abort → set status="aborted", EXIT
```

**3d. Handle result** (consistent with maestro.md):

On success: update step status = `"completed"`, advance `current_step`.

On failure:
```
on_fail = step.on_fail || "abort"

skip   → mark "skipped", log warning, advance
retry  → retry once, if still fails → fall to abort
abort  → AskUserQuestion: Retry / Skip / Abort
         On Abort: save progress, display: "Resume with: /maestro-player -c"
```

**3e. Context cleanup hint** (after step 3+, consistent with maestro.md):
```
  ⚡ 已执行 {i} 步，上下文较重。可随时 /maestro-player -c 在新上下文中恢复。
```

---

### Phase 4: Complete — Archive + Summary

**Objective**: Mark session complete, output summary.

**Step 4.1** — Set `status = "completed"`, `completed_at = <ISO>`, write `status.json`.

**Step 4.2** — Collect all artifacts from steps.

**Step 4.3** — Display execution summary (consistent with maestro.md):
```
============================================================
  MAESTRO PLAYER SESSION COMPLETE
============================================================
  Session:   <session_id>
  Template:  <template_name> (<template_id>)
  Steps:     <completed>/<total> completed
  Context:   goal="<value>"

  Results:
    [✓] 1. N-001 maestro-plan         — completed (WFS-plan-xxx)
    [✓] 2. CP-01 After Plan           — completed (checkpoint)
    [✓] 3. N-002 maestro-execute      — completed (WFS-exec-xxx)
    [✓] 4. N-003 quality-test    — completed (WFS-test-xxx)

  Artifacts:
    - IMPL_PLAN.md         (N-001)
    - src/auth/index.ts    (N-002)
    - test/auth.test.ts    (N-003)

  Session dir: .workflow/.maestro/<session_id>/
============================================================
```

**Step 4.4** — AskUserQuestion completion action:
- **Keep session** → leave at current path
- **Run again** → AskUserQuestion for same/new context, re-enter Phase 1
- **Nothing** → done
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Template not found | Show --list output, suggest closest match |
| E002 | error | Template JSON invalid (missing required fields) | Point to template file for fix |
| E003 | error | Required context variable missing and user declined | Cannot proceed without required vars |
| E004 | error | Resume session not found | Scan `.workflow/.maestro/player-*/`, list available |
| E005 | error | DAG cycle in template | Point to template for fix, suggest maestro-composer --edit |
| E006 | error | Node execution failed + abort chosen | Save state, suggest --resume |
| W001 | warning | Node completed with warnings | Log and continue |
| W002 | warning | Runtime reference resolved to empty string | Log, executor handles gracefully |
</error_codes>

<success_criteria>
- [ ] Template loaded from `~/.maestro/templates/workflows/` and validated
- [ ] All required context variables bound (from --context or user input)
- [ ] Session directory created at `.workflow/.maestro/player-*/` with `status.json`
- [ ] Steps array computed via topological sort (maestro.md compatible format)
- [ ] Each step executed with correct mechanism (Skill/delegate/Agent)
- [ ] Runtime references ({N-xxx.field}, {prev_*}) resolved before each step
- [ ] `status.json` written after every step status change (resume-safe)
- [ ] Checkpoints saved with snapshots under `checkpoints/`
- [ ] CLI nodes use `maestro delegate` with `Bash(run_in_background: true)` + stop pattern
- [ ] Step banners and completion report match maestro.md format
- [ ] Resume via `-c` scans `.workflow/.maestro/player-*/status.json`
</success_criteria>
