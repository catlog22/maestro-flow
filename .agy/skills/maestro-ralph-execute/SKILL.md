---
name: maestro-ralph-execute
description: Execute next pending step in ralph session
argument-hint: [-y] [session-id]
allowed-tools:
  - grep_search
  - replace_file_content
  - run_command
  - view_file
  - write_to_file
---
<purpose>
Single-step executor for ralph (adaptive) and maestro (static) sessions.
Each invocation: locate session → find next step → resolve args → execute → update → self-invoke next.

Mutual invocation with `/maestro-ralph` forms a self-perpetuating work loop.
Session: `.workflow/.maestro/*/status.json`
</purpose>

<context>
$ARGUMENTS — optional `-y` flag + optional session ID.

**Parse:**
```
-y / --yes → auto = true
Remaining  → session_id (if matches maestro-* or ralph-*)
```
Also read `session.auto_mode` from status.json — if true, treat as `-y`.

**Node types:**

| Type | Execution | Flow after |
|------|-----------|------------|
| decision (ralph-only) | `Skill("maestro-ralph")` — ralph re-evaluates | Execution ends here |
| internal | `Skill({ skill, args })` — synchronous | Self-invoke next |
| external | `maestro delegate --to claude --mode write` | STOP → callback → self-invoke |

HARD RULE: External nodes ALWAYS append `-y` to skill args inside the prompt — delegate sessions are non-interactive.
HARD RULE: External nodes ALWAYS delegate to `claude` — only Claude Code can execute slash-command skills.
</context>

<invariants>
1. **Every step via Skill() or delegate** — never simulate or inline a skill's work
2. **External → claude only** — `session.cli_tool` is for analysis delegates, NOT execution
3. **Self-invocation chain** — continues until all steps complete or session paused
4. **Status.json updated after every change** — resume-safe
</invariants>

<state_machine>

<states>
S_LOCATE        — 定位 session + 找下一个 pending step   PERSIST: —
S_RESOLVE_ARGS  — 解析占位符 + 丰富参数                  PERSIST: step.args (enriched)
S_EXECUTE       — 执行当前 step                          PERSIST: step.status = "running", session.current_step
S_POST_EXEC     — 标记完成 + 传播上下文                   PERSIST: step.status, session.context
S_HANDLE_FAIL   — 处理失败（重试/跳过/中止）              PERSIST: step.status, session.status
S_COMPLETE      — 所有 step 完成                         PERSIST: session.status = "completed"
S_FALLBACK      — 无 session 可执行                      PERSIST: —
</states>

<transitions>

S_LOCATE:
  → S_RESOLVE_ARGS  WHEN: pending step found                DO: A_LOCATE_SESSION
  → S_COMPLETE      WHEN: no pending steps
  → S_FALLBACK      WHEN: no running session

S_RESOLVE_ARGS:
  → S_EXECUTE       DO: A_RESOLVE_ARGS

S_EXECUTE:
  → END             WHEN: step.type == "decision"           DO: A_EXEC_DECISION
  → S_POST_EXEC     WHEN: step.type == "internal" + success DO: A_EXEC_INTERNAL
  → S_HANDLE_FAIL   WHEN: step.type == "internal" + failure DO: A_EXEC_INTERNAL
  → END             WHEN: step.type == "external"           DO: A_EXEC_EXTERNAL
                     (STOP after background delegate; on callback → S_POST_EXEC or S_HANDLE_FAIL)

S_POST_EXEC:
  → S_LOCATE        DO: A_MARK_COMPLETE + Skill("maestro-ralph-execute")

S_HANDLE_FAIL:
  → S_LOCATE        WHEN: auto + not retried               DO: A_RETRY
  → END             WHEN: auto + retried                    DO: A_PAUSE_SESSION
  → S_LOCATE        WHEN: interactive + user selects retry  DO: A_RETRY
  → S_LOCATE        WHEN: interactive + user selects skip   DO: A_SKIP_STEP
  → END             WHEN: interactive + user selects abort  DO: A_PAUSE_SESSION

S_COMPLETE:
  → END             DO: A_COMPLETE_SESSION

S_FALLBACK:
  → END             DO: display "无运行中的会话。使用 /maestro 或 /maestro-ralph 创建。"

</transitions>

<actions>

### A_LOCATE_SESSION

1. If session_id provided → load `.workflow/.maestro/{session_id}/status.json`
2. Else: scan `.workflow/.maestro/*/status.json`, filter `status == "running"`, sort DESC, take first
3. Extract: session_id, source, steps[], current_step, phase, milestone, intent, auto_mode, context, cli_tool
4. Find first step with `status == "pending"` → next step

### A_RESOLVE_ARGS

**Placeholder substitution:**

| Placeholder | Source |
|-------------|--------|
| `{phase}` | session.phase |
| `{milestone}` | session.milestone |
| `{intent}` | session.intent |
| `{description}` | session.intent (alias) |
| `{scratch_dir}` | session.context.scratch_dir or latest artifact path |
| `{plan_dir}` | session.context.plan_dir |
| `{analysis_dir}` | session.context.analysis_dir |
| `{issue_id}` | session.context.issue_id |
| `{milestone_num}` | session.context.milestone_num |

**Per-skill enrichment** (when args empty or minimal):

| Skill | Required context | Source |
|-------|-----------------|--------|
| maestro-brainstorm | topic | `"{intent}"` |
| maestro-roadmap | description | `"{intent}"` |
| maestro-analyze | phase or topic | `{phase}` or `"{intent}"` |
| maestro-plan | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| maestro-execute | phase or --dir | `{phase}`, or `--dir {scratch_dir}` if standalone |
| quality-debug | gap context | Read previous step's error/gap from artifact dir |
| quality-* | phase | `{phase}` |

**Artifact dir resolution for --dir:**
```
Read state.json → filter artifacts by milestone + phase
plan commands: latest type=="analyze" → --dir .workflow/scratch/{path}
execute commands: latest type=="plan" → --dir .workflow/scratch/{path}
```

Write enriched args back to status.json (resume-safe).

### A_EXEC_DECISION

1. Mark step running, write status.json
2. Display: `[{index}/{total}] ◆ {skill} [decision] Retry: {retry}/{max}`
3. `view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph/SKILL.md") + execute inline` — ralph detects running decision → evaluates → handoff
4. **This execution ends here** — ralph handles the handoff back

### A_EXEC_INTERNAL

1. Mark step running, write status.json
2. Display: `[{index}/{total}] {skill} [internal]`
3. Resolve auto flag: `auto ? (flag_map[skill] || "") : ""`
4. `Skill({ skill: next.skill, args: effective_args })`
5. Return success/failure

**Auto flag map:** all lifecycle skills → `-y`; `quality-test` → `-y --auto-fix`; unlisted internal → no flag

### A_EXEC_EXTERNAL

1. Mark step running, write status.json
2. Display: `[{index}/{total}] ⚡ {skill} [external]`
3. Always append `-y` to skill args (delegates are non-interactive): `flag = flag_map[skill] || "-y"`
4. Execute:
   ```
   run_command({
     command: `maestro delegate "/${skill} ${effective_args}" --to claude --mode write`,
     run_in_background: true, timeout: 600000
   })
   STOP — wait for callback.
   ```
5. On callback: retrieve output → S_POST_EXEC or S_HANDLE_FAIL

### A_MARK_COMPLETE

1. `step.status = "completed"`, `step.completed_at = now`
2. Scan output for context signals:
   - `PHASE: N` → session.phase
   - `scratch_dir: path` → context.scratch_dir
   - `SPEC-xxx` → context.spec_session_id
3. Scan output for `--- COMPLETION STATUS ---` block. If found, parse and map:
   - `STATUS: DONE` → `step.status = "completed"`
   - `STATUS: DONE_WITH_CONCERNS` → `step.status = "completed"`, `step.concerns = CONCERNS value`
   - `STATUS: NEEDS_RETRY` → trigger retry: set `step.status = "pending"`, `step.retried = true` → S_HANDLE_FAIL
   - `STATUS: BLOCKED` → `session.status = "paused"`, display blocker reason from CONCERNS
   - `STATUS: NEEDS_CONTEXT` → `session.status = "paused"`, display context gap from CONCERNS
   - If no `--- COMPLETION STATUS ---` block found → fall back to existing heuristic (backward compatible)
4. Write status.json
5. Display: `[{index}/{total}] ✓ {skill} completed`

### A_RETRY

1. `step.retried = true`, `step.status = "pending"`, `step.error = null`
2. Write status.json

### A_SKIP_STEP

1. `step.status = "skipped"`
2. Write status.json

### A_PAUSE_SESSION

1. `session.status = "paused"`, write status.json
2. Display: `[{index}/{total}] ✗ {skill} 失败，会话已暂停。/maestro-ralph continue 恢复。`

### A_COMPLETE_SESSION

1. `session.status = "completed"`, write status.json
2. Display completion report:
   ```
   ============================================================
     SESSION COMPLETE
   ============================================================
     Session:  {session_id} [{source}]
     Steps:    {completed}/{total}

     [✓] 0.   maestro-plan 1            [internal]
     [✓] 1. ⚡ maestro-execute 1         [external]
     [✓] 2.   maestro-verify 1          [internal]
     [✓] 3. ◆ post-verify               [decision]
     ...
   ============================================================
   ```
   Icons: `✓` completed, `—` skipped, `✗` failed, `◆` decision, `⚡` external

</actions>

</state_machine>

<appendix>

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running session found | Suggest /maestro or /maestro-ralph |
| E002 | error | status.json corrupt | Show path, suggest manual check |
| E003 | error | Delegate failed + user abort | Mark paused, suggest resume |
| W001 | warning | Step completed with warnings | Log and continue |

### Success Criteria

- [ ] Session discovery covers both maestro-* and ralph-*
- [ ] `-y` parsed from args OR inherited from session.auto_mode
- [ ] Placeholders resolved from session context
- [ ] Per-skill enrichment provides correct args
- [ ] Decision nodes hand off to maestro-ralph via Skill()
- [ ] Internal nodes execute via Skill() with auto flag
- [ ] External nodes delegate to claude with `-y` in prompt args, run_in_background + STOP
- [ ] Context signals propagate to status.json
- [ ] Auto mode: retry once then pause
- [ ] Interactive: ask_question retry/skip/abort
- [ ] Self-invocation continues until complete or paused

</appendix>
