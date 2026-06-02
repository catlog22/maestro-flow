---
name: maestro-player
description: Play workflow templates with checkpoint resume
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
Load workflow template (from maestro-composer) → bind context variables → execute DAG nodes in topological order → persist state at checkpoints → support resume.

Session: `.workflow/.maestro/player-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<context>
$ARGUMENTS — template slug/path, or flags.

**Flags**:
- `--context key=value`: Bind context variables (repeatable)
- `-c [session-id]`: Resume paused/interrupted session
- `--list`: List available templates from index.json
- `--dry-run`: Show execution plan without executing

**Node execution mechanisms**:

| Node type | Mechanism | Blocking |
|-----------|-----------|----------|
| skill | `Skill(skill, args)` | sync |
| command | `Skill(skill, args)` | sync |
| cli | `maestro delegate --to tool --mode mode` via `Bash(run_in_background: true)` | async, STOP + wait |
| agent | `Agent(subagent_type, prompt)` | configurable |
| checkpoint | State save + optional user pause | — |

**Runtime reference resolution** in args_template:

| Reference | Resolves to |
|-----------|-------------|
| `{variable}` | session context[variable] |
| `{N-001.session_id}` | node's session_id |
| `{N-001.output_path}` | node's output_path |
| `{prev_session_id}` | previous non-checkpoint node's session_id |
| `{prev_output_path}` | previous non-checkpoint node's output_path |

**Session schema** (status.json — must align with maestro.md tracking):
```json
{
  "session_id": "player-<YYYYMMDD>-<HHmmss>",
  "status": "running|paused|completed|failed|aborted",
  "template_id": "wft-<slug>-<date>",
  "template_path": "<path>",
  "auto_mode": false,
  "context": { "goal": "..." },
  "steps": [{
    "index": 0, "node_id": "N-001", "skill": "<executor>",
    "args": "<resolved>", "type": "skill|cli|agent|checkpoint",
    "status": "pending|running|completed|skipped|failed",
    "session_id": null, "output_path": null, "artifacts": []
  }],
  "current_step": 0,
  "last_checkpoint": null
}
```
</context>

<state_machine>

<states>
S_ROUTE        — 入口路由（list/resume/dry-run/normal）     PERSIST: —
S_RESUME       — 恢复已暂停 session                         PERSIST: —
S_LOAD         — 加载模板、收集变量、绑定引用                 PERSIST: —
S_INIT         — 创建 session、拓扑排序、初始化 steps         PERSIST: status.json
S_EXEC_LOOP    — 逐步执行（核心循环）                        PERSIST: status.json (每步更新)
S_COMPLETE     — 标记完成、输出摘要                           PERSIST: status.json (final)
</states>

<transitions>

S_ROUTE:
  → handleList    WHEN: --list                              DO: scan index.json, display templates
  → S_RESUME      WHEN: -c flag
  → S_LOAD        WHEN: template slug/path provided
  → handleList    WHEN: no args                             DO: display templates + AskUserQuestion

S_RESUME:
  → S_EXEC_LOOP   WHEN: session found                      DO: A_RESUME_SESSION
  → ERROR(E004)   WHEN: no session found

S_LOAD:
  → S_INIT        DO: A_LOAD_AND_BIND

S_INIT:
  → END           WHEN: --dry-run                           DO: display execution plan
  → S_EXEC_LOOP   DO: A_INIT_SESSION (topological sort → steps[], write status.json, display banner)

S_EXEC_LOOP:
  → S_EXEC_LOOP   WHEN: step completed, more steps          DO: A_EXECUTE_STEP → advance current_step
  → S_COMPLETE     WHEN: all steps completed
  → END           WHEN: checkpoint pause                    DO: set status=paused, display resume command
  → END           WHEN: abort chosen                        DO: set status=aborted, save progress
  GUARD: cli nodes → Bash(run_in_background: true) + STOP, wait for callback
  GUARD: on failure → on_fail: skip (log, advance) | retry (once) | abort (AskUserQuestion: Retry/Skip/Abort)
  GUARD: after step 3+ → display context hint "可随时 /maestro-player -c 恢复"

S_COMPLETE:
  → END           DO: A_COMPLETE_SESSION

</transitions>

<actions>

### A_RESUME_SESSION

1. If session-id: load status.json. If none: scan player-*/status.json for running|paused.
2. Reset any "running" steps to "pending" (interrupted mid-execution)
3. Set current_step to resume point after last_checkpoint
4. Enter S_EXEC_LOOP

### A_LOAD_AND_BIND

1. Resolve template: absolute path → as-is; relative → from cwd; slug → index.json lookup
2. Parse `--context key=value` pairs
3. Validate template (template_id, nodes, edges, context_schema required)
4. Collect missing required variables via AskUserQuestion
5. Bind {variable} placeholders (leave {N-xxx.field} and {prev_*} for runtime)

### A_INIT_SESSION

1. Generate session_id: player-{YYYYMMDD-HHmmss}
2. Topological sort (Kahn's algorithm) → flatten to steps[] (parallel nodes share batch index)
3. All steps status: "pending"
4. Write status.json

### A_EXECUTE_STEP

1. Resolve runtime references ({N-xxx.field}, {prev_*}) in args
2. Set step status="running", write status.json
3. Execute by type:
   - **skill/command**: `Skill(skill, resolved_args)` → extract session_id, output_path, artifacts
   - **cli**: `Bash(run_in_background: true)` → STOP, wait for callback → `maestro delegate output <id>`
   - **agent**: `Agent(subagent_type, resolved_args)`
   - **checkpoint**: write checkpoint snapshot. If auto_continue==false:
     AskUserQuestion (single-select, header: "Checkpoint"):
     - **Continue** — proceed to next step
     - **Pause** — save progress, exit (resume with `-c`)
     - **Abort** — stop workflow
4. Set step status="completed" (or "skipped"/"failed"), write status.json

### A_COMPLETE_SESSION

Set status="completed", completed_at. Display summary: session, template, steps completed, context, per-step results, artifacts, session dir.
AskUserQuestion (single-select, header: "完成"):
- **Keep session** — preserve artifacts for reference
- **Run again** — re-execute with same template
- **Done** — clean up and exit

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | Template not found | Show --list, suggest closest match |
| E002 | Template JSON invalid (missing template_id/nodes/edges) | Point to template file for fix |
| E004 | Resume session not found | List available player-*/ sessions |
| E005 | DAG cycle in template | Point to template, suggest --edit |
| E006 | Node execution failed + abort chosen | Save state, suggest `-c` resume |
</error_codes>

<success_criteria>
- [ ] Template loaded, variables bound, session created with topological steps
- [ ] status.json written after every step change (resume-safe)
- [ ] CLI nodes use Bash(run_in_background) + STOP pattern
- [ ] Checkpoints saved, resume via -c works
</success_criteria>
