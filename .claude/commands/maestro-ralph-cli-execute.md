---
name: maestro-ralph-cli-execute
description: Skill execution wrapper for delegate — execute skill, return structured result
argument-hint: "--session <id> | <skill-name> [args...]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates: { entry: [], exit: [] }
---

<run_mode>
**Session mode:** `run`. This block is MANDATORY and overrides legacy artifact-path examples below.

1. Before domain work, call `maestro run create maestro-ralph-cli-execute -- $ARGUMENTS` and use the returned `run_id`, `run_dir`, and `upstream`.
2. Formal JSON/Markdown deliverables MUST be written under `{run_dir}/outputs/`; evidence goes to `{run_dir}/evidence/`; process narrative and handoff go to `{run_dir}/report.md`.
3. The model MUST NOT edit protocol JSON (`run.json`, `session.json`, `gates.json`, `artifacts.json`, `evidence.json`) or append to project `state.json.artifacts[]`.
4. Run `maestro run check {run_id}` before completion, repair blocking gaps, then run `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Any later reference to `scratch/`, hidden command session directories, `milestones/`, `phases/`, `context-package.json`, `understanding.md`, `evidence.ndjson`, or a secondary `status.json` is a legacy semantic label only. Map formal deliverables to `outputs/`, narrative to `report.md`, evidence attachments to `evidence/`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.
</run_mode>
<purpose>
Thin execution wrapper for CLI delegation.

Job: receive session ID (or skill name + args) → load via `maestro ralph next` → execute the skill → scan artifacts → output structured `---RESULT---` block.

This command does NOT manage sessions, compose prompts, make decisions, or call `maestro ralph complete`. Completion 由 orchestrator (`/maestro-ralph-cli`) 负责：orchestrator 解析 `---RESULT---` 块后调用 `maestro ralph complete N --status <STATUS> --summary <SUMMARY> [--evidence ...] [--decisions ...] [--caveats ...] [--deferred ...]`，清 `active_step_index`。
</purpose>

<context>
$ARGUMENTS — `--session <id>` (session mode) 或 `<skill-name> [args...]` (direct mode)

**Parse:**
```
--session <id>  → session_id (session mode: skill 由 ralph next 从 status.json 解析，无需传 skill name)
First token     → skill_name (direct mode only, e.g., maestro-plan, maestro-execute)
Remaining       → skill_args (direct mode only)
```

`<execution_context>` 块由 ralph-cli delegation prompt 注入于 `$ARGUMENTS` 之前，含 intent、boundary、goals 等，透传给 skill。
</context>

<invariants>
1. **Execute exactly one skill** — session mode 由 `ralph next` 解析，direct mode 由 skill_name 确定；执行一次即返回
2. **Structured output** — always end with `---RESULT---` / `---END---` block
3. **No session management** — never create/modify sessions, make decisions, or call `maestro ralph complete`（completion 由 orchestrator 负责）
4. **No self-invocation** — execute once and return
5. **Artifact scanning** — after skill execution, scan for produced artifacts
6. **Required reading 由 CLI 负责** — session mode 下 `ralph next` 自动展开 + 加载 `<required_reading>`，缺失 → exit 1（E007），cli-execute 不手动处理
7. **Deferred reading 只记录** — `<deferred_reading>` 路径由 CLI 记录到 `step.load.deferred_files`，执行阶段按需 Read，不提前批量读取
8. **并发保护** — 同一 session 最多一个 step 持 `active_step_index`；`ralph next` exit 3 表示冲突，不静默推进
9. **STATUS 枚举受限** — 仅 `DONE | DONE_WITH_CONCERNS | NEEDS_RETRY | BLOCKED`；`NEEDS_CONTEXT` 已废除
10. **CLI 输出禁止截断** — `maestro ralph next` 的 stdout 必须全量捕获，严禁 `| head`/`| tail` 等截断管道
</invariants>

<state_machine>

<states>
S_PARSE     — 解析 skill name + args              PERSIST: —
S_EXECUTE   — 执行 skill                          PERSIST: —
S_SCAN      — 扫描产物 + 提取信号                   PERSIST: —
S_OUTPUT    — 输出结构化结果                        PERSIST: —
</states>

<transitions>
S_PARSE → S_EXECUTE    DO: A_PARSE_ARGS
S_EXECUTE → S_SCAN     DO: A_EXECUTE_SKILL
S_SCAN → S_OUTPUT      DO: A_SCAN_ARTIFACTS
S_OUTPUT → END         DO: A_OUTPUT_RESULT
</transitions>

<actions>

### A_PARSE_ARGS

1. Parse `--session <id>` → `session_id`（session mode）
2. 无 `--session` → extract `skill_name`（first token）and `skill_args`（remaining）为 direct mode
3. Parse `<execution_context>` block from delegation prompt if present:
   ```
   intent, phase, boundary_contract, active_goals, execution_criteria
   ```

### A_EXECUTE_SKILL

1. If `session_id` present → `Bash("maestro ralph next --session {session_id}")` — CLI loads skill + required_reading, returns prompt
   - **必须全量捕获 stdout，严禁 `| head`/`| tail` 等任何截断管道**（stdout 含完整 skill prompt，截断会导致执行内容不完整）
   - Exit 0 → 按 stdout 内联执行（stdout 含 CLI 拼接好的完整 prompt + session_anchor）
   - Exit 1 → required_reading 缺失或 schema 错误 → set `status = "BLOCKED"`, skip to S_OUTPUT, SUMMARY 引用 CLI stderr
   - Exit 2 → 无 pending step（已全部完成）→ set `status = "DONE"`, SUMMARY = "所有 step 已完成", skip to S_OUTPUT
   - Exit 3 → active_step_index 冲突（另一进程占用）→ set `status = "BLOCKED"`, SUMMARY = "并发冲突", skip to S_OUTPUT
2. If no session → `Skill({ skill: skill_name, args: skill_args })` — direct skill call
3. **Goal context**: `ralph next` CLI 输出的 session_anchor 已含 goal context（`ralph_protocol_version >= "2"`），无需额外注入
4. **Deferred reading**: `ralph next` 将 `<deferred_reading>` 路径记录到 `step.load.deferred_files`，执行阶段按需 Read
5. **Inline execution** — 按 stdout 内容执行 skill 逻辑；执行完成后进入 S_SCAN
6. Track execution: note start time, watch for errors

### A_SCAN_ARTIFACTS

After skill execution, scan for produced artifacts:

| Pattern | Stage signal |
|---------|-------------|
| `conclusions.json` | `analysis_dir` |
| `TASK-*.json` | `plan_dir` |
| `verification.json` | `scratch_dir` |
| `review.json` | review stage |
| `test-results.json`, `uat.md` | test stage |
| `grill-report.md` | `grill_id` |
| `.brainstorming/*` | `brainstorm_dir` |

Use `Glob` to find files created/modified during execution.

Extract signals from output:
- Artifact IDs: `ANL-xxx`, `PLN-xxx`, `BLP-xxx`
- Path signals: `scratch_dir:`, `plan_dir:`
- Phase signals: `PHASE: N`

### A_OUTPUT_RESULT

Output structured result block.

```
---RESULT---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY|BLOCKED
SUMMARY: <动词开头，≤100 字的执行总结>
ARTIFACTS: <逗号分隔的产物路径>
EVIDENCE: <验证产物路径，如 verification.json、uat.md、e2e-results.json>
DECISIONS: <本步做出的关键决策，分号分隔>
CAVEATS: <后续步骤需注意的事项；DONE_WITH_CONCERNS 时同时作为 concerns>
DEFERRED: <推迟到后续的工作项，分号分隔>
SIGNALS: <key=value 对，分号分隔，如 plan_dir=.workflow/scratch/PLN-xxx;phase=2>
---END---
```

**Rules:**
- STATUS 必填，从执行结果推断（仅 4 个合法值，NEEDS_CONTEXT 已废除）
- SUMMARY 必填（DONE/DONE_WITH_CONCERNS 时为 MUST），动词开头
- ARTIFACTS 列出所有新增/修改的产物文件路径
- EVIDENCE 为 SHOULD，列出验证产物路径
- DECISIONS/CAVEATS/DEFERRED 为 SHOULD，有则填
- SIGNALS 提取 A_SCAN_ARTIFACTS 发现的 key=value 对

**SIGNALS→context 映射：**

| Signal key | 写入 status.json 字段 |
|------------|----------------------|
| `analysis_dir` | `context.analysis_dir` |
| `plan_dir` | `context.plan_dir` |
| `scratch_dir` | `context.scratch_dir` |
| `grill_id` | `context.grill_id` |
| `brainstorm_dir` | `context.brainstorm_dir` |
| `blueprint_dir` | `context.blueprint_dir` |
| `ANL-xxx` | `session.analyze_macro_id` |
| `BLP-xxx` | `session.blueprint_id` |
| `phase` | `session.context.phase` |

**Stage-specific SUMMARY 提取指引：**

| Stage | SUMMARY 应包含 | EVIDENCE 来源 |
|-------|---------------|---------------|
| analyze | scope_verdict + key_findings 数量 + 依赖图摘要 | `conclusions.json` |
| plan | TASK-*.json 数量 + 主要模块 + 波次划分 | — |
| execute | 修改文件数 + verification passed/failed | `verification.json` |
| review | verdict + findings 数量 + severity 分布 | `review.json` |
| test | pass/fail 统计 | `uat.md`, `test-results.json` |
| debug | root cause + 修复内容 | — |
| grill | 核心质疑点数量 + 术语表 | `grill-report.md` |
| brainstorm | 候选方案数量 + 推荐方案 | — |

**STATUS determination:**
- Skill 正常完成 + 有产物 → `DONE`
- 完成但有 warnings/concerns → `DONE_WITH_CONCERNS`
- 执行出错但可重试 → `NEEDS_RETRY`
- 执行出错且无法重试 → `BLOCKED`

</actions>

</state_machine>

<appendix>

### Output Example

```
---RESULT---
STATUS: DONE
SUMMARY: 生成 8 个 task 覆盖认证模块 3 个子系统，wave 1 含 5 个独立 task
ARTIFACTS: .workflow/scratch/PLN-20260628/TASK-001.json,.workflow/scratch/PLN-20260628/TASK-002.json,.workflow/scratch/PLN-20260628/plan.json
EVIDENCE:
DECISIONS: 选择 wave 模式分 2 波执行；JWT 和 session 分离为独立 task
CAVEATS: 模块 X 的外部 API 尚未确认，TASK-003 可能需调整
DEFERRED: 性能基准测试留到 review 后
SIGNALS: plan_dir=.workflow/scratch/PLN-20260628;PLN-xxx=PLN-20260628
---END---
```

### Error Output

```
---RESULT---
STATUS: BLOCKED
SUMMARY: maestro-plan 执行失败：required_reading 文件 analyze-guide.md 缺失
ARTIFACTS:
EVIDENCE:
DECISIONS:
CAVEATS:
DEFERRED:
SIGNALS:
---END---
```

### Error Codes

| Code | Exit | Severity | Description | STATUS |
|------|------|----------|-------------|--------|
| E006 | 1 | error | command_path 缺失/不可达 | BLOCKED |
| E007 | 1 | error | required_reading 引用文件缺失 | BLOCKED |
| E008 | 1 | error | active_step_index 与 complete idx 不匹配 | BLOCKED |
| E009 | 1 | error | step.status ≠ running（重复 complete 或非法跳跃）| BLOCKED |
| E010 | 1 | error | status.json schema 损坏 | BLOCKED |
| — | 2 | info | 无 pending step（全部已完成）| DONE |
| — | 3 | error | active_step_index 并发冲突 | BLOCKED |
| W001 | 0 | warning | Step completed with concerns | DONE_WITH_CONCERNS |

### Success Criteria

- [ ] Session mode 只需 `--session <id>`，skill 由 `ralph next` 从 status.json 解析
- [ ] Direct mode 解析 `skill_name` + `skill_args`
- [ ] Session mode 通过 `maestro ralph next --session {id}` 加载；stdout 全量捕获，禁止截断管道
- [ ] Exit codes 完整处理：0→执行，1→BLOCKED，2→DONE，3→BLOCKED
- [ ] Execute via `maestro ralph next` (session mode) or `Skill()` (direct mode)
- [ ] Scan artifacts after execution using Glob
- [ ] Extract artifact IDs and path signals from output
- [ ] Always output `---RESULT---` / `---END---` block
- [ ] STATUS 仅 4 个合法值：DONE / DONE_WITH_CONCERNS / NEEDS_RETRY / BLOCKED
- [ ] SUMMARY 在 DONE/DONE_WITH_CONCERNS 时为 MUST（动词开头，≤100 字）
- [ ] EVIDENCE 字段列出验证产物路径
- [ ] SIGNALS 含 stage-specific key=value 对（参照 SIGNALS→context 映射表）
- [ ] Stage-specific SUMMARY 提取指引（analyze→scope_verdict，plan→TASK 数量 等）
- [ ] No session management, no self-invocation, no decisions, no `ralph complete`
- [ ] Deferred reading 按需 Read，不提前批量读取

</appendix>
</output>
