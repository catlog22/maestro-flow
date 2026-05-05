---
name: maestro-ralph-execute
description: Single-step executor — find next pending step in session, execute by type (decision/skill/cli), hand off to next iteration
argument-hint: "[-y] [session-id]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
---
<purpose>
Single-step executor for ralph (adaptive) and maestro (static) sessions.
Sessions stored at `.workflow/.maestro/*/status.json` with unified JSON schema.

Each invocation: find next pending step → execute → update status → hand off to next iteration.

Three node types:
- **decision** (ralph-only): `Skill("maestro-ralph")` — ralph re-evaluates, may expand chain
- **skill**: `Skill({ skill, args })` — synchronous in-session → self-invoke next
- **cli**: `maestro delegate` background → STOP → callback → self-invoke next

Session sources:
- **source: "ralph"** — Adaptive chain with decision nodes. Primary use case.
- **source: "maestro"** — Static chain, skill/cli only. No decision callbacks.

Mutual invocation with `/maestro-ralph` forms a self-perpetuating work loop.
</purpose>

<context>
$ARGUMENTS — optional `-y` flag + optional session ID.

**Flag parsing:**
```
-y / --yes → auto = true (remove from remaining args)
Remaining  → session_id (if matches maestro-* or ralph-* pattern)
```

Also read `session.auto_mode` from status.json — if `true`, treat as `-y` even without flag.
</context>

<execution>

## Step 1: Locate Session

```
If $ARGUMENTS matches maestro-* or ralph-* pattern:
  session_path = .workflow/.maestro/{$ARGUMENTS}/status.json
Else:
  Scan .workflow/.maestro/*/status.json
  Filter: status == "running"
  Sort: updated_at DESC (or dir mtime DESC)
  Take first

If no session found:
  Output: "无运行中的会话。使用 /maestro 或 /maestro-ralph 创建新会话。"
  End.
```

Read status.json → extract: `session_id`, `source`, `steps[]`, `current_step`, `status`, `phase`, `milestone`, `intent`, `auto_mode`, `context`, `cli_tool`.

## Step 2: Find Next Pending Step

```
next = steps.find(step => step.status == "pending")
If no pending step → Step 6 (Complete)
```

## Step 3: Resolve Args (context propagation)

Before execution, enrich `next.args` with session context and prior outputs.

**Placeholder substitution:**

| Placeholder | Source |
|-------------|--------|
| `{phase}` | status.phase |
| `{milestone}` | status.milestone |
| `{intent}` | status.intent |
| `{description}` | status.intent (alias) |
| `{scratch_dir}` | status.context.scratch_dir or latest artifact path |
| `{plan_dir}` | status.context.plan_dir |
| `{analysis_dir}` | status.context.analysis_dir |
| `{issue_id}` | status.context.issue_id |
| `{milestone_num}` | status.context.milestone_num |

**Per-skill enrichment** (when args is empty or only has phase number):

| Skill | Required context | Source |
|-------|-----------------|--------|
| maestro-brainstorm | topic description | `"{intent}"` |
| maestro-roadmap | description + context | `"{intent}"` |
| maestro-analyze | phase or topic | `{phase}` or `"{intent}"` if no phase |
| maestro-plan | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| maestro-execute | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| maestro-verify | phase | `{phase}` |
| quality-debug | gap context | Read previous step's error/gap summary from artifact dir |
| quality-* | phase | `{phase}` |

**Artifact dir resolution for --dir args:**
```
Read .workflow/state.json
Filter artifacts: milestone == session.milestone, phase == session.phase
For plan commands: find latest type=="analyze" artifact → --dir .workflow/scratch/{path}
For execute commands: find latest type=="plan" artifact → --dir .workflow/scratch/{path}
```

Write enriched args back to status.json (resume-safe).

## Step 4: Mark Running

```
next.status = "running"
next.started_at = ISO timestamp
status.current_step = next.index
status.updated_at = ISO timestamp
Write status.json
```

Display step banner:
```
------------------------------------------------------------
  [{next.index}/{steps.length - 1}] {next.skill} [{next.type}]
------------------------------------------------------------
  Session: {session_id} [{source}]
  Args: {next.args}
```

If decision node: also show `Retry: {retry_count}/{max_retries}` from parsed args.

Context weight hint (non-auto only, after 4+ completed steps):
```
⚡ 已执行 {completed_count} 步，上下文较重。可 /maestro-ralph continue 在新上下文恢复。
```

## Step 5: Execute by Type

### 5a. decision node (ralph-only)

Hand control back to ralph for re-evaluation.

```
Skill({ skill: "maestro-ralph" })
```

Ralph will: detect running decision → evaluate results → optionally expand steps[] → mark completed → call ralph-execute to resume.

**After Skill("maestro-ralph") returns, this execution ends.** Ralph handles the handoff.

### 5b. skill node

HARD RULE: Every skill step MUST be executed via `Skill({ skill, args })`.
Never "simulate" or "inline" a skill's work. If Skill() is not called, the step has NOT been executed.

**Auto flag propagation** (when `auto == true`):

| Skill | Flag appended |
|-------|---------------|
| maestro-init | `-y` |
| maestro-analyze | `-y` |
| maestro-brainstorm | `-y` |
| maestro-roadmap | `-y` |
| maestro-ui-design | `-y` |
| maestro-plan | `-y` |
| maestro-execute | `-y` |
| quality-auto-test | `-y` |
| quality-test | `-y --auto-fix` |
| quality-retrospective | `-y` |
| maestro-milestone-complete | `-y` |

```
flag = auto_flag_map[next.skill] || ""
effective_args = flag ? `${next.args} ${flag}` : next.args

Skill({ skill: next.skill, args: effective_args })
```

**On success** → Step 5d (Mark Complete).
**On failure** → Step 5e (Handle Failure).

### 5c. cli node

Background delegate execution with stop-and-wait pattern.

```
cli_tool = session.cli_tool

Bash({
  command: `maestro delegate "PURPOSE: 执行 /${next.skill} ${next.args}
TASK: 运行 /${next.skill} ${next.args}
MODE: write
CONTEXT: @**/*
EXPECTED: 产出写入 .workflow/scratch/，artifact 注册到 state.json
CONSTRAINTS: 严格按照 /${next.skill} 的正常流程执行" --to ${cli_tool} --mode write`,
  run_in_background: true,
  timeout: 600000
})

STOP — wait for background callback.
```

**On callback:**
- Retrieve output: `maestro delegate output <exec_id>`
- **On success** → Step 5d (Mark Complete)
- **On failure** → Step 5e (Handle Failure)

### 5d. Mark Complete (shared)

```
next.status = "completed"
next.completed_at = ISO timestamp

Scan output for context propagation signals:
  PHASE: N         → status.phase
  scratch_dir: path → context.scratch_dir
  SPEC-xxx         → context.spec_session_id

Write status.json
Display: [{next.index}/{total}] ✓ {next.skill} completed {next.type == "cli" ? "[cli]" : ""}
```

Then hand off:
```
Skill({ skill: "maestro-ralph-execute" })
```

### 5e. Handle Failure (shared)

```
next.status = "failed"
next.error = "{error message}"
next.completed_at = ISO timestamp
Write status.json

Display: [{next.index}/{total}] ✗ {next.skill} failed: {error}
```

**Auto mode:**
```
If not next.retried:
  next.retried = true, next.status = "pending", next.error = null
  Write status.json → Skill("maestro-ralph-execute")  // retry once
Else:
  next.status = "skipped"
  Write status.json
  Display: [{next.index}/{total}] ⏭ {next.skill} auto-skipped after retry
  → Skill("maestro-ralph-execute")  // continue
```

**Interactive mode (non-auto):**
```
AskUserQuestion: "retry / skip / abort"
  retry → next.status = "pending", next.error = null → Skill("maestro-ralph-execute")
  skip  → next.status = "skipped" → Skill("maestro-ralph-execute")
  abort → status.status = "paused" → Write status.json → End.
```

## Step 6: Complete Session

When no pending steps remain:

```
status.status = "completed"
status.updated_at = ISO timestamp
Write status.json
```

Display completion report:
```
============================================================
  SESSION COMPLETE
============================================================
  Session:  {session_id} [{source}]
  Chain:    {chain_name}
  Phase:    {phase}
  Steps:    {completed}/{total}

  [✓] 0.   maestro-plan 1            [skill]
  [✓] 1. ⚡ maestro-execute 1         [cli]
  [✓] 2.   maestro-verify 1          [skill]
  [✓] 3. ◆ post-verify               [decision]
  [—] 4.   quality-auto-test 1       [skill]  (skipped)
  ...
============================================================
```

Status icons: `✓` completed, `—` skipped, `✗` failed, ` ` pending.
Type badges: `◆` decision, `⚡` cli, (none) skill.

**End.**

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running session found | Suggest /maestro or /maestro-ralph |
| E002 | error | Session status.json corrupt | Show path, suggest manual check |
| E003 | error | CLI delegate failed + user abort | Mark paused, suggest resume |
| W001 | warning | Step completed with warnings | Log and continue |
| W002 | warning | Context heavy (step >= 4) | Hint: /maestro-ralph continue |
</error_codes>

<success_criteria>
- [ ] Session discovery scans .workflow/.maestro/ (covers both maestro-* and ralph-*)
- [ ] `-y` flag parsed from args OR inherited from session.auto_mode
- [ ] Placeholder substitution resolves all `{...}` tokens from session context
- [ ] Per-skill enrichment provides correct args when empty/minimal
- [ ] Artifact dir resolution finds latest artifact for --dir args
- [ ] decision nodes hand off to maestro-ralph via Skill() (ralph sessions only)
- [ ] skill nodes execute via Skill() with auto flag propagation
- [ ] cli nodes use maestro delegate with run_in_background + STOP pattern
- [ ] Context propagation: output signals update status.json.context
- [ ] status.json updated after every status change (resume-safe)
- [ ] Auto mode: retry once then skip; interactive: AskUserQuestion retry/skip/abort
- [ ] Completion report shows all steps with status icons and type badges
- [ ] Self-invocation chain continues until all steps complete or session paused
</success_criteria>
