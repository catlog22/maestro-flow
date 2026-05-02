---
name: maestro-ralph-execute
description: Single-step executor — find next pending command in ralph session, execute by type (decision/skill/cli), hand off to next iteration
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
Single-step executor for ralph command chains. Each invocation:
1. Finds the next pending command in the ralph session JSON
2. Executes it based on node type (decision → ralph, skill → Skill(), cli → delegate)
3. Updates status.json
4. Hands off to next iteration via self-invocation or ralph callback

Three node types drive different execution + handoff patterns:
- **decision**: `Skill("maestro-ralph")` — ralph re-evaluates state, may expand chain
- **skill**: `Skill({ skill, args })` — synchronous in-session → `Skill("maestro-ralph-execute")`
- **cli**: `maestro delegate` background → STOP → callback → `Skill("maestro-ralph-execute")`

Mutual invocation with `/maestro-ralph` forms a persistent self-perpetuating work loop.
</purpose>

<context>
$ARGUMENTS — optional `-y` flag + optional session ID. If session ID omitted, finds latest running ralph session.

**Flag parsing:**
```
Parse $ARGUMENTS:
  Contains "-y" or "--yes" → auto = true, remove flag from remaining args
  Remaining → session_id (if matches ralph-* pattern)
```

**Session discovery:**
Scan `.workflow/.ralph/ralph-*/status.json` for `status == "running"`, sorted by `created_at` descending.
If remaining args match a session ID pattern, use that specific session.
Also read `session.auto` from status.json — if `true`, treat as `-y` even if flag not passed（ralph 已写入）。
</context>

<execution>

## Step 1: Locate Session

```
If $ARGUMENTS matches ralph-* pattern:
  session_path = .workflow/.ralph/{$ARGUMENTS}/status.json
Else:
  Scan .workflow/.ralph/ralph-*/status.json
  Filter: status == "running"
  Sort: created_at DESC
  Take first

If no session found:
  Output: "无运行中的 ralph 会话。使用 /maestro-ralph 创建新会话。"
  End.
```

Read status.json → extract: `id`, `steps[]`, `current_step`, `status`, `phase`.

## Step 2: Find Next Pending Command

```
next = steps.find(step => step.status == "pending")

If no pending command:
  → Step 5 (Complete)
```

## Step 2.5: Assemble Args (context propagation)

Before execution, enrich `next.args` with context from session and prior outputs.

**Context sources (priority order):**
1. `status.json.intent` — user's original input text
2. `status.json.phase` — current phase number
3. `status.json.milestone` — current milestone name
4. `.workflow/state.json.artifacts[]` — latest artifacts for path resolution
5. Previous completed command outputs — scratch dirs, session IDs

**Placeholder substitution in args:**
```
{phase}       → status.phase
{milestone}   → status.milestone
{intent}      → status.intent
{scratch_dir} → latest artifact path for current phase from state.json
```

**Per-command enrichment** (when args is empty or only has phase number):

| Command | Required context | Source |
|---------|-----------------|--------|
| maestro-brainstorm | topic description | `status.intent` — pass as `"{intent}"` |
| maestro-roadmap | description + context | `status.intent` — pass as `"{intent}"` |
| maestro-analyze | phase or topic | `{phase}` or `"{intent}"` if no phase |
| maestro-plan | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| maestro-execute | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| maestro-verify | phase | `{phase}` |
| quality-debug | gap context | Read previous step's error or gap summary from artifact dir |
| quality-* | phase | `{phase}` |

**Artifact dir resolution for --dir args:**
```
Read .workflow/state.json
Filter artifacts: milestone == session.milestone, phase == session.phase
For plan commands: find latest type=="analyze" artifact → --dir .workflow/scratch/{path}
For execute commands: find latest type=="plan" artifact → --dir .workflow/scratch/{path}
```

**Write enriched args back to status.json** so resume preserves them:
```
next.args = enriched_args
Write status.json
```

## Step 3: Mark Running + Update JSON

```
next.status = "running"
next.started_at = new Date().toISOString()
status.current = next.index
status.updated_at = new Date().toISOString()

Write status.json
```

Display step banner:
```
------------------------------------------------------------
  [{next.index}/{steps.length - 1}] {next.skill} [{next.type}]
------------------------------------------------------------
  Args: {next.args}
  {next.type == "decision" ? "Retry: " + JSON.parse(next.args).retry_count + "/" + JSON.parse(next.args).max_retries : ""}
```

**Context weight hint** (after 4+ completed steps, skip if auto):
```
If completed_count >= 4 && !auto:
  Display: ⚡ 已执行 {completed_count} 步，上下文较重。可 /maestro-ralph continue 在新上下文恢复。
```

## Step 4: Execute by Type

### 4a. decision node

Decision nodes hand control back to ralph for re-evaluation.

```
Skill({ skill: "maestro-ralph" })
```

Ralph will:
1. Detect the running decision node in status.json
2. Evaluate execution results (verify gaps, test failures, etc.)
3. Optionally expand steps[] with fix loops
4. Mark the decision node completed
5. Call `Skill("maestro-ralph-execute")` to resume

**After Skill("maestro-ralph") returns, this execution ends.** Ralph handles the handoff.

### 4b. skill node

Synchronous in-session execution.

**`-y` auto flag 传播：** 当 `auto == true` 时，按传播表对目标 skill 附加 auto flag：
```
auto_flag_map = {
  "maestro-init": "-y",
  "maestro-analyze": "-y",
  "maestro-brainstorm": "-y",
  "maestro-roadmap": "-y",
  "maestro-plan": "-y",
  "maestro-execute": "-y",
  "quality-business-test": "-y",
  "quality-test": "-y --auto-fix",
  "maestro-milestone-complete": "-y"
}
flag = auto_flag_map[next.skill] || ""
effective_args = flag ? `${next.args} ${flag}` : next.args
```

```
Skill({ skill: next.skill, args: effective_args })
```

On success:
```
next.status = "completed"
next.completed_at = new Date().toISOString()
Write status.json

Display: [N/total] ✓ {next.skill} completed
```

On failure (Skill throws or produces error):
```
next.status = "failed"
next.error = "{error message}"
next.completed_at = new Date().toISOString()
Write status.json

Display: [N/total] ✗ {next.skill} failed: {error}

If auto:
  If not next.retried:
    next.retried = true, next.status = "pending", next.error = null → retry once
  Else:
    next.status = "skipped" → continue (auto-skip)
    Display: [N/total] ⏭ {next.skill} auto-skipped after retry
Else:
  AskUserQuestion: "retry / skip / abort"
    retry → reset next.status = "pending", next.error = null → Skill("maestro-ralph-execute")
    skip  → next.status = "skipped" → Skill("maestro-ralph-execute")
    abort → status.status = "paused" → Write status.json → End.
```

Then hand off:
```
Skill({ skill: "maestro-ralph-execute" })
```

### 4c. cli node

Background delegate execution with stop-and-wait pattern.

Resolve CLI tool from session or default config:
```
cli_tool = session.cli_tool || "gemini"   // from ralph status.json or fallback
```

```
Bash({
  command: `maestro delegate "PURPOSE: 执行 /${next.skill} ${next.args}; success = 命令正常完成并产出 artifact
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

```
Retrieve output: maestro delegate output <exec_id>

next.status = "completed"
next.completed_at = new Date().toISOString()
Write status.json

Display: [N/total] ✓ {next.skill} completed [cli]
```

On failure:
```
next.status = "failed"
next.error = "{error details}"
Write status.json

(same as 4b failure handling: auto → retry once then skip; else → AskUserQuestion)
```

Then hand off:
```
Skill({ skill: "maestro-ralph-execute" })
```

## Step 5: Complete Session

When no pending steps remain:

```
status.status = "completed"
status.updated_at = new Date().toISOString()
Write status.json
```

Display completion report:
```
============================================================
  RALPH COMPLETE
============================================================
  Session:  {id}
  Phase:    {phase}
  Steps:    {completed}/{total}

  {steps.map(cmd => {
    icon = cmd.status == "completed" ? "✓" :
           cmd.status == "skipped"   ? "—" :
           cmd.status == "failed"    ? "✗" : " "
    type_badge = cmd.type == "decision" ? "◆" :
                 cmd.type == "cli"      ? "⚡" : " "
    return `  [${icon}] ${cmd.index}. ${type_badge} ${cmd.skill} ${cmd.args} [${cmd.type}]`
  })}
============================================================
```

**End.**

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running ralph session found | Suggest /maestro-ralph to create |
| E002 | error | Session status.json corrupt or unreadable | Show path, suggest manual check |
| E003 | error | CLI delegate failed + user chose abort | Mark paused, suggest /maestro-ralph continue |
| W001 | warning | Step completed with warnings | Log and continue |
| W002 | warning | Context getting heavy (step >= 4) | Hint: /maestro-ralph continue for fresh context |
</error_codes>

<success_criteria>
- [ ] Session discovery finds latest running ralph session
- [ ] `-y` flag parsed from args OR inherited from session.auto
- [ ] Pending step correctly identified from steps[]
- [ ] decision nodes hand off to maestro-ralph via Skill()
- [ ] skill nodes execute synchronously via Skill() and self-invoke next
- [ ] `-y` auto flag 按传播表附加到目标 skill args
- [ ] cli nodes use maestro delegate with run_in_background + stop pattern
- [ ] status.json updated after every status change (resume-safe)
- [ ] auto 模式：失败重试一次后 auto-skip；非 auto：AskUserQuestion retry/skip/abort
- [ ] Completion report shows all steps with status icons
- [ ] Self-invocation chain continues until all steps complete
</success_criteria>
