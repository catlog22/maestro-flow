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

**Step kinds:**

| Kind | Identifier | Execution | Flow after |
|------|-----------|-----------|------------|
| decision step | `step.decision` 非空 | `Skill("maestro-ralph")` | Execution ends here |
| 执行 step | `step.decision == null` | `view_file({file_path: step.command_path})` + 内联解释执行 | Self-invoke next |

HARD RULES:
- 执行 step：通过 `view_file({command_path})` 把命令 .md 加载进当前会话，再按内容执行
- **必须遵循 `<required_reading>` / `<deferred_reading>` 标签**：命令 .md 通常采用"入口 + workflow"形式，主体逻辑放在 workflow 文件中并通过 `<required_reading>` 引用；缺失 required_reading 视为加载失败
- decision step：A_EXEC_DECISION 通过 `view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph/SKILL.md") + execute inline` handoff 给 ralph 评估
- `command_path` 由 ralph 在 A_BUILD_STEPS 写入 status.json（缺失 → 报错 E002）
- 每个 step 必须产出 `--- COMPLETION STATUS ---` 块，否则视为 NEEDS_RETRY
</context>

<invariants>
1. **执行 = Read + inline** — 通过 Read 读取 `step.command_path`，按其指令在当前 session 内执行
2. **Required reading must be loaded** — 命令 .md 中的 `<required_reading>` 引用的所有文件必须立即 Read；缺一 → 视为加载失败，pause session（E007）
3. **Deferred reading recorded only** — `<deferred_reading>` 列出的文件路径需记录，执行过程按需 Read；不在加载阶段读取
4. **Skill loaded confirmation** — 所有 required_reading 加载完成后必须输出一行确认：`✓ skill {step.skill} 加载完成 (required: N, deferred: M)`
5. **必须显式 completion confirmation** — 每个 step 完成时需有 `STATUS: DONE` 且写入 `step.completion_confirmed = true`
6. **Self-invocation chain** — 持续直到全部 `completion_confirmed` 或 paused
7. **status.json 每步骤后写盘** — resume-safe
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
  → END             WHEN: step.decision != null              DO: A_EXEC_DECISION
  → S_POST_EXEC     WHEN: step.decision == null + success    DO: A_EXEC_STEP
  → S_HANDLE_FAIL   WHEN: step.decision == null + failure    DO: A_EXEC_STEP

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
2. Display: `[{index}/{total}] ◆ {step.decision} Retry: {retry}/{max}`
3. `view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph/SKILL.md") + execute inline` — ralph 评估 + handoff
4. 执行在此结束

### A_EXEC_STEP

1. Validate `step.command_path != null`；否则 raise E002，pause session
2. Mark step running, write status.json
3. Display: `[{index}/{total}] {step.skill} [{step.command_scope}]`
4. `view_file({ file_path: step.command_path })` — 把命令 .md 全文加载进当前会话
5. **解析 reading 标签**（"入口 + workflow"形式核心步骤）：
   - 抽取 frontmatter `argument-hint` / `allowed-tools`
   - 抽取 `<required_reading>` 块的所有 `@path` 引用 → 立刻 `view_file({ file_path: <expanded path> })` 加载（`~/` / `@~/` 展开为用户主目录）；任一文件缺失或读取失败 → raise E007，pause session
   - 抽取 `<deferred_reading>` 块的所有路径 → 仅记录到 `step.deferred_reads = [...]`，执行阶段按需 Read
   - 抽取 `<purpose>/<context>/<state_machine>/<execution>/<actions>` 等指令块
6. **加载完成确认**：required_reading 全部成功 Read 后，输出一行：
   ```
   ✓ skill {step.skill} 加载完成 (required: {N}, deferred: {M})
   ```
   其中 N = required_reading 引用数，M = deferred_reading 路径数（缺省块按 0 计）
7. 计算 `effective_args`：`step.args` + (`auto ? " -y" : ""`)
8. 按读到的指令在本会话中**内联执行**：调用允许的工具完成命令所规定的工作；执行过程中如触发 deferred_reading 引用的资源 → 按需 Read
9. 执行结束：要求最后一段必须包含 `--- COMPLETION STATUS ---` 块（见 A_MARK_COMPLETE）
10. Return success / failure

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

     [✓] 0.   maestro-plan 1            [global]
     [✓] 1.   maestro-execute 1         [project]
     [✓] 2.   maestro-verify 1          [global]
     [✓] 3. ◆ post-verify               [decision]
     ...
   ============================================================
   ```
   Icons: `✓` confirmed, `—` skipped, `✗` failed, `◆` decision

</actions>

</state_machine>

<appendix>

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No running session found | Suggest /maestro or /maestro-ralph |
| E002 | error | step.command_path missing for 执行 step | Pause, ask ralph to rebuild step |
| E003 | error | status.json corrupt | Show path, manual check |
| E005 | error | COMPLETION STATUS block missing | Trigger NEEDS_RETRY |
| E007 | error | required_reading file 缺失或读取失败 | List missing paths, pause session |
| W001 | warning | Step completed with concerns | Log and continue |
| W002 | warning | command .md 无 `<required_reading>` 标签 | 直接执行 .md 主体，跳过加载阶段 |

### Success Criteria

- [ ] Session discovery covers maestro-* and ralph-*
- [ ] `-y` parsed from args 或 session.auto_mode；auto=true 时透传 `-y` 到 skill args
- [ ] Placeholders resolved；per-skill enrichment 正确
- [ ] Decision 节点（`step.decision != null`）Skill("maestro-ralph") handoff
- [ ] 执行 step 通过 view_file({step.command_path}) 内联执行
- [ ] 执行 step Read 后必须解析并加载 `<required_reading>` 引用的文件；缺失 → E007 pause
- [ ] `<deferred_reading>` 仅记录路径到 `step.deferred_reads`，执行阶段按需 Read
- [ ] required_reading 加载完成后输出 `✓ skill {name} 加载完成 (required: N, deferred: M)`
- [ ] 每个 step 强制 `--- COMPLETION STATUS ---`；缺失 → NEEDS_RETRY
- [ ] step.completion_confirmed = true 仅在 STATUS: DONE/DONE_WITH_CONCERNS 时设置
- [ ] step.completion_evidence 记录 artifact path / 输出节选
- [ ] Context signals 传播 status.json
- [ ] Auto mode: retry 一次后 pause；interactive 提供 retry/skip/abort
- [ ] 自调用持续到全部 completion_confirmed 或 paused
- [ ] A_COMPLETE_SESSION 校验全部 step confirmed + sub-goal all_done

</appendix>
