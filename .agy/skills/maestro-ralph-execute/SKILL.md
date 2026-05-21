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
| decision (ralph-only) | `Skill("maestro-ralph")` | Execution ends here |
| internal (default) | `view_file({file_path: step.command_path})` + 内联解释执行 | Self-invoke next |
| external (opt-in) | `maestro delegate --to claude --mode write` (STOP → callback) | Self-invoke next |

HARD RULES:
- internal step MUST 通过 `view_file({command_path})` 把命令 .md 加载进当前会话，再按内容执行；禁止 `Skill({skill})` 调用
- `command_path` 由 ralph 在 A_BUILD_STEPS 写入 status.json；ralph-execute 不再自行解析（缺失 → 报错 E002）
- external 仅在 `step.type == "external"` 显式声明时使用，并 always append `-y` 到 prompt args
- 每个 step 必须产出 `--- COMPLETION STATUS ---` 块，否则视为 NEEDS_RETRY
</context>

<invariants>
1. **Internal = Read + inline** — 通过 Read 读取 `step.command_path`，按其指令在当前 session 内执行
2. **External = explicit only** — `step.type == "external"` 才走 delegate；默认绝不发起
3. **必须显式 completion confirmation** — 每个 step 完成时需有 `STATUS: DONE` 且写入 `step.completion_confirmed = true`
4. **Self-invocation chain** — 持续直到全部 `completion_confirmed` 或 paused
5. **status.json 每步骤后写盘** — resume-safe
</invariants>

<state_machine>

<states>
S_LOCATE        — 定位 session + 找下一个 pending step   PERSIST: —
S_RESOLVE_ARGS  — 解析占位符 + 丰富参数                  PERSIST: step.args (enriched)
S_EXECUTE       — 执行当前 step                          PERSIST: step.status = "running", session.current_step
S_POST_EXEC     — 标记完成 + 传播上下文                   PERSIST: step.completion_*, step.status, session.context
S_HANDLE_FAIL   — 处理失败                               PERSIST: step.status, session.status
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
| maestro-plan | phase or --dir | `{phase}`, or `--dir {scratch_dir}` |
| maestro-execute | phase or --dir | `{phase}`, or `--dir {scratch_dir}` |
| quality-debug | gap context | Read previous step's error/gap |
| quality-* | phase | `{phase}` |

**Artifact dir resolution for --dir:**
```
Read state.json → filter artifacts by milestone + phase
plan commands: latest type=="analyze" → --dir .workflow/scratch/{path}
execute commands: latest type=="plan" → --dir .workflow/scratch/{path}
```

Write enriched args back to status.json.

### A_EXEC_DECISION

1. Mark step running, write status.json
2. Display: `[{index}/{total}] ◆ {decision} Retry: {retry}/{max}`
3. `view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph/SKILL.md") + execute inline` — ralph 评估 + handoff
4. 执行在此结束

### A_EXEC_INTERNAL

1. Validate `step.command_path != null`；否则 raise E002，pause session
2. Mark step running, write status.json
3. Display: `[{index}/{total}] {step.skill} [internal · {step.command_scope}]`
4. `view_file({ file_path: step.command_path })` — 把命令 .md 全文加载进当前会话
5. 解析 frontmatter `argument-hint` 与 `<purpose>/<state_machine>/<actions>` 等指令块
6. 计算 `effective_args`：`step.args` + auto flag（`auto ? (flag_map[step.skill] || "") : ""`）
7. 按读到的指令在本会话中**内联执行**：调用允许的工具完成命令所规定的工作，不再发起 Skill() 或 delegate
8. 执行结束：要求最后一段必须包含 `--- COMPLETION STATUS ---` 块（见 A_MARK_COMPLETE）
9. Return success / failure

**Auto flag map**: 所有 lifecycle skill → `-y`; `quality-test` → `-y --auto-fix`; 未列出 → 无 flag

### A_EXEC_EXTERNAL

仅当 `step.type == "external"` 时使用（默认链路不产生）。

1. Mark step running, write status.json
2. Display: `[{index}/{total}] ⚡ {step.skill} [external]`
3. 始终在 prompt 内追加 `-y`（delegate session 非交互）：`flag = flag_map[step.skill] || "-y"`
4. Execute:
   ```
   run_command({
     command: `maestro delegate "/${step.skill} ${effective_args}" --to claude --mode write`,
     run_in_background: true, timeout: 600000
   })
   STOP — wait for callback.
   ```
5. On callback: 把回调输出视为 step 的执行结果 → S_POST_EXEC / S_HANDLE_FAIL

### A_MARK_COMPLETE

1. 从 step 输出中提取 `--- COMPLETION STATUS ---` 块（required）
2. 解析并写入：
   - `STATUS: DONE` → `step.status = "completed"`, `step.completion_confirmed = true`, `step.completion_status = "DONE"`
   - `STATUS: DONE_WITH_CONCERNS` → `step.status = "completed"`, `step.completion_confirmed = true`, `step.completion_status = "DONE_WITH_CONCERNS"`, `step.concerns = <CONCERNS>`
   - `STATUS: NEEDS_RETRY` → `step.status = "pending"`, `step.retried = true`, `step.completion_confirmed = false`, → S_HANDLE_FAIL
   - `STATUS: BLOCKED` / `NEEDS_CONTEXT` → `session.status = "paused"`, `step.completion_status` 记录原因, `step.completion_confirmed = false`
   - 缺失 `--- COMPLETION STATUS ---` 块 → 视为 NEEDS_RETRY（不允许 heuristic fallback）
3. 写入 `step.completion_evidence`（artifact 路径 / 关键输出节选）
4. 扫描输出抓取 context 信号：`PHASE: N` → session.phase；`scratch_dir: path` → context.scratch_dir；`BLP-xxx` → context.blueprint_session_id
5. `step.completed_at = now`，写 status.json
6. **Sub-goal evidence 校验**（task_decomposition 存在时）：若 `step.goal_ref` 对应子目标的 `lifecycle` 覆盖当前 stage 且 evidence artifact 已生成 → 暂不直接置 done，仍交由 post-goal-audit 决策；仅在 step 显式确认时更新 `task_decomposition[*].completion_confirmed = false` 占位（保持 pending）
7. Display: `[{index}/{total}] ✓ {step.skill} completed (confirmed)`

### A_RETRY

1. `step.retried = true`, `step.status = "pending"`, `step.error = null`, `step.completion_confirmed = false`
2. Write status.json

### A_SKIP_STEP

1. `step.status = "skipped"`, `step.completion_confirmed = false`
2. Write status.json

### A_PAUSE_SESSION

1. `session.status = "paused"`, write status.json
2. Display: `[{index}/{total}] ✗ {step.skill} 失败，会话已暂停。/maestro-ralph continue 恢复。`

### A_COMPLETE_SESSION

1. 校验：所有 step `completion_confirmed == true`（除 skipped）；task_decomposition 存在时校验 `task_decomposition_all_done == true`
2. 任一校验失败 → 不标 completed，回 S_LOCATE 或 pause
3. `session.status = "completed"`, write status.json
4. Display completion report:
   ```
   ============================================================
     SESSION COMPLETE
   ============================================================
     Session:  {session_id} [{source}]
     Steps:    {completed}/{total}   confirmed: {confirmed}/{completed}

     [✓] 0.   maestro-plan 1            [internal · global]
     [✓] 1.   maestro-execute 1         [internal · project]
     [✓] 2.   maestro-verify 1          [internal · global]
     [✓] 3. ◆ post-verify               [decision]
     ...
   ============================================================
   ```
   Icons: `✓` confirmed, `—` skipped, `✗` failed, `◆` decision, `⚡` external

</actions>

</state_machine>

<appendix>

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running session found | Suggest /maestro or /maestro-ralph |
| E002 | error | step.command_path missing for internal step | Pause, ask ralph to rebuild step |
| E003 | error | status.json corrupt | Show path, manual check |
| E004 | error | Delegate failed + user abort | Mark paused, suggest resume |
| E005 | error | COMPLETION STATUS block missing | Trigger NEEDS_RETRY |
| W001 | warning | Step completed with concerns | Log and continue |

### Success Criteria

- [ ] Session discovery covers maestro-* and ralph-*
- [ ] `-y` parsed from args 或 session.auto_mode
- [ ] Placeholders resolved；per-skill enrichment 正确
- [ ] Decision 节点 Skill("maestro-ralph") handoff
- [ ] Internal 节点通过 view_file({step.command_path}) 内联执行，禁止 Skill()
- [ ] External 仅在显式声明时走 delegate，prompt 必带 `-y`
- [ ] 每个 step 强制 `--- COMPLETION STATUS ---`；缺失 → NEEDS_RETRY
- [ ] step.completion_confirmed = true 仅在 STATUS: DONE/DONE_WITH_CONCERNS 时设置
- [ ] step.completion_evidence 记录 artifact path / 输出节选
- [ ] Context signals 传播 status.json
- [ ] Auto mode: retry 一次后 pause；interactive 提供 retry/skip/abort
- [ ] 自调用持续到全部 completion_confirmed 或 paused
- [ ] A_COMPLETE_SESSION 校验全部 step confirmed + sub-goal all_done

</appendix>
