---
name: maestro-ralph-execute
description: Execute next pending step in ralph session
argument-hint: "[-y] [session-id]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<purpose>
Single-step executor for ralph (adaptive) and maestro (static) sessions.
Each invocation: locate session → find next step → resolve args → execute → update → self-invoke next.

Mutual invocation with `$maestro-ralph` forms a self-perpetuating work loop.

**Session**: `.workflow/.maestro/{session_id}/status.json` — 工作流唯一真源。session_id 格式 `ralph-{YYYYMMDD-HHmmss}`（$maestro-ralph 创建，自适应链）或 `maestro-{YYYYMMDD-HHmmss}`（$maestro 创建，静态链）。两类都由本 skill 推进；省略 `[session-id]` 时取最新 `status=="running"`。Schema 详见 `$maestro-ralph` 的 Session Schema。
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
| decision step | `step.decision` 非空 | `$maestro-ralph` | Execution ends here |
| 执行 step | `step.decision == null` | `Bash("maestro ralph next")` → 内联按其 stdout 执行 → `Bash("maestro ralph complete N --status ...")` | Self-invoke next |

HARD RULES:
- 执行 step：**统一通过 `maestro ralph next` CLI 加载**。CLI 负责读 command_path（codex SKILL.md）、解析 `<required_reading>` + `<deferred_reading>`、拼接 prompt、写 `step.load.*` + `active_step_index` + `step.status="running"`。不要再在会话里手动 Read + 解析 required_reading
- decision step：A_EXEC_DECISION 通过 `$maestro-ralph` 直调 handoff 给 ralph 评估（不走 CLI）
- `command_path` 由 ralph 在 A_BUILD_STEPS 写入 status.json（通过 `maestro ralph skills --platform codex` 预校验；缺失 → ralph next 返回 E006/E007 并拒绝执行）
- 每个 step 结束必须调用 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`。STATUS 仅 4 个合法值：`DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`
- Platform：`session.platform == "codex"`；ralph next CLI 自动按 platform 解析 SKILL.md（无需额外参数）
</context>

<invariants>
1. **执行 = `ralph next` + inline + `ralph complete`** — 调 `maestro ralph next` 拿到 skill 内容，按 stdout 内联执行
2. **Required reading 由 CLI 负责** — `ralph next` 自动展开 + 加载 `<required_reading>` 引用的所有文件，缺失 → 退出码 1（E007），不写 active_step_index，不进入执行
3. **Deferred reading recorded only** — `<deferred_reading>` 路径由 CLI 记录到 `step.load.deferred_files`，执行阶段按需 Read
4. **一致性取代锁** — 同一 session 同时最多一个 step 持 `active_step_index`；CLI 校验失败直接退出码 3，不静默推进
5. **Completion 通过 CLI 调用** — 每个 step 末尾调 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`，由 CLI 写 `completion_*` + 清 `active_step_index`
6. **Self-invocation chain** — 持续直到全部 `completion_confirmed` 或 paused
7. **status.json 每步骤后由 CLI 原子写盘** — resume-safe
8. **STATUS 枚举受限** — 仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`
9. **Platform binding** — 仅处理 `session.platform == "codex"` 的会话；platform 缺失视为 codex（向前兼容）
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
  → S_POST_EXEC     WHEN: step.decision == null + ralph complete invoked with DONE|DONE_WITH_CONCERNS  DO: A_EXEC_STEP
  → S_HANDLE_FAIL   WHEN: step.decision == null + ralph next exit≠0 OR ralph complete with NEEDS_RETRY|BLOCKED  DO: A_EXEC_STEP

S_POST_EXEC:
  → S_LOCATE        DO: Bash("maestro ralph complete ...") + $maestro-ralph-execute
                     NOTE: CLI 已写完 completion_*, status, active_step_index；无需额外写盘

S_HANDLE_FAIL:
  → S_LOCATE        WHEN: auto + not retried               DO: A_RETRY
  → END             WHEN: auto + retried                    DO: A_PAUSE_SESSION
  → S_LOCATE        WHEN: interactive + user selects retry  DO: A_RETRY
  → S_LOCATE        WHEN: interactive + user selects skip   DO: A_SKIP_STEP
  → END             WHEN: interactive + user selects abort  DO: A_PAUSE_SESSION

S_COMPLETE:
  → END             DO: A_COMPLETE_SESSION

S_FALLBACK:
  → END             DO: display "无运行中的会话。使用 $maestro 或 $maestro-ralph 创建。"

</transitions>

<actions>

### A_LOCATE_SESSION

1. If session_id provided → load `.workflow/.maestro/{session_id}/status.json`
2. Else: scan `.workflow/.maestro/*/status.json`, filter `status == "running"`, sort DESC, take first
3. Extract: session_id, source, steps[], phase, milestone, intent, auto_mode, context, cli_tool, platform, active_step_index
4. **不在此处选 pending step**——pending 选择由 `maestro ralph next` CLI 内部完成；A_LOCATE_SESSION 只确认 session 存在且 running，由 A_EXEC_STEP 调 CLI 推进

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
3. `$maestro-ralph` — 直调 ralph 评估 + handoff
4. 执行在此结束

### A_EXEC_STEP

1. **Load** — `Bash("maestro ralph next")`
   - 退出码 0 → 按 stdout 内联执行
   - 退出码 2 → 交给 S_LOCATE
   - 退出码 3 → active_step_index 已被占用
   - 退出码 1 → pause session
2. **Inline execution** — 按 stdout 执行；deferred_reading 按需 Read
3. **Complete**:
   - `Bash("maestro ralph complete N --status DONE [--evidence <path>]")`
   - `Bash("maestro ralph complete N --status DONE_WITH_CONCERNS --concerns \"...\"")`
   - `Bash("maestro ralph retry N")`
   - `Bash("maestro ralph complete N --status BLOCKED --reason \"...\"")`
4. **Propagate context signals** — 关键信号 (`PHASE: N` / `scratch_dir: path` / `BLP-xxx`) 写入 `status.json.context`

完成后 S_LOCATE 触发 `$maestro-ralph-execute` 直调自调用。

### A_RETRY

1. `Bash("maestro ralph retry N")` — CLI 设 `step.retried = true`, `step.status = "pending"`, `step.completion_confirmed = false`, 清 `active_step_index`
2. Display: `[{index}/{total}] ↻ {step.skill} retry`

### A_SKIP_STEP

跳过执行 step — 手动编辑 `status.json`：将该 step `status` 设为 `"skipped"`，`completion_confirmed` 设为 `false`，并清 `active_step_index`（若指向此 step）。
（不提供 CLI 子命令；跳过是非常规操作，避免自动化误用。）

### A_PAUSE_SESSION

通常由 `ralph complete N --status BLOCKED --reason "..."` 触发，CLI 已写 `session.status = "paused"`。手动 pause 场景下直接编辑 status.json。
Display: `[{index}/{total}] ✗ {step.skill} 失败，会话已暂停。$maestro-ralph continue 恢复。`

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
     [✓] 2.   quality-review 1           [global]
     [✓] 3. ◆ post-review               [decision]
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
| E001 | error | No running session found | Suggest $maestro or $maestro-ralph |
| E006 | error | command_path missing/unreachable for 执行 step | `ralph next` 拒绝；编辑 status.json 或重 build |
| E007 | error | required_reading 引用文件缺失 | `ralph next` 拒绝；CLI stderr 列出缺失路径 |
| E008 | error | `ralph complete` idx ≠ active_step_index | 编辑 status.json 修正一致性 |
| E009 | error | `ralph complete` step.status ≠ running | 重复 complete 或非法跳跃；编辑 status.json |
| E010 | error | status.json schema 损坏 | `ralph check` 显示具体损坏字段 |
| W001 | warning | Step completed with concerns | Log and continue |
| W005 | warning | active_step_index 指向已 completed step | `ralph next` 自动清理后继续 |
| W007 | warning | step.skill ≠ SKILL.md frontmatter.name | 提示但不阻塞 |

### Success Criteria

- [ ] Session discovery covers maestro-* and ralph-*
- [ ] `-y` parsed from args 或 session.auto_mode；auto=true 时透传 `-y` 到 skill args
- [ ] Placeholders resolved；per-skill enrichment 正确
- [ ] Decision 节点（`step.decision != null`）走 `$maestro-ralph` 直调 handoff（**不调 ralph next CLI**）
- [ ] 执行 step 通过 `Bash("maestro ralph next")` 加载；CLI 返回拼好的 prompt + completion 协议
- [ ] required_reading 由 CLI 自动加载并拼入 prompt；缺失 → CLI 退出码 1，pause session
- [ ] `<deferred_reading>` 由 CLI 记录到 `step.load.deferred_files`，执行阶段按需 Read
- [ ] 每个 step 末尾必须调 `maestro ralph complete N --status <S>` 或 `maestro ralph retry N`
- [ ] STATUS 枚举仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`
- [ ] active_step_index 一致性由 CLI 维护；E008/E009 直接退出，不静默推进
- [ ] step.completion_evidence 通过 `--evidence` 传入并记录
- [ ] Context signals 由执行 step 显式写回 status.json.context（非 ralph-execute 内嵌扫描）
- [ ] Auto mode: retry 一次后 pause；interactive 提供 retry/skip/abort
- [ ] 自调用持续到全部 completion_confirmed 或 paused
- [ ] 只处理 session.platform == "codex" 的会话

</appendix>
