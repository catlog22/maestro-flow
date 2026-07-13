---
name: maestro-ralph-cli-execute
description: Skill execution wrapper for delegate — execute skill, return structured result
argument-hint: <skill-name> [args...]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Thin execution wrapper for CLI delegation.

### Notation

`Skill(name)` / `Skill(name, args)` = 加载 `~/.codex/skills/{name}/SKILL.md` 或 `.codex/skills/{name}/SKILL.md`（project 覆盖 global）。严禁翻译为 `Bash("maestro {name} {args}")`。

Job: receive skill name + args → execute the skill → scan artifacts → output structured `---RESULT---` block.

This command does NOT manage sessions, compose prompts, or make decisions. Those are `Skill(maestro-ralph-cli)`'s responsibility.
</purpose>

<context>
$ARGUMENTS — `<skill-name> [args...]`

**Parse:**
```
First token  → skill_name (e.g., maestro-plan, maestro-execute, quality-review)
Remaining    → skill_args
```

**Execution context** is injected by the delegation prompt from ralph-cli as `<execution_context>` block. The wrapper passes this through to the skill.

**Session context**: delegation prompt may include `--session <id>` — if present, read `status.json` to get `active_step_index` for `ralph complete`.

**Platform**: `session.platform == "codex"`
</context>

<invariants>
1. **Execute exactly one skill** — parse skill_name, execute it, return
2. **Structured output** — always end with `---RESULT---` / `---END---` block
3. **No session management** — never create/modify sessions or make decisions
4. **No self-invocation** — execute once and return
5. **Artifact scanning** — after skill execution, scan for produced artifacts
6. **CLI ≠ Skill** — `maestro ralph complete` 是 CLI 子命令；`Skill(name)` 是 skill 直调
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

1. Extract `skill_name` (first token) and `skill_args` (remaining)
2. Parse `<execution_context>` block from delegation prompt if present
3. Parse `--session <id>` if present → `session_id`

### A_EXECUTE_SKILL

1. If `session_id` present → `Bash("maestro ralph next --session {session_id}")` — CLI loads SKILL.md + required_reading
   - Exit 0 → inline execute per stdout
   - Exit 1 → set `status = "BLOCKED"`, skip to S_OUTPUT
2. If no session → `Skill(skill_name, skill_args)` — direct skill call
3. Track execution: note start time, watch for errors

### A_SCAN_ARTIFACTS

After skill execution, scan for produced artifacts:

| Pattern | Stage signal |
|---------|-------------|
| `conclusions.json` | `analysis_dir` |
| `TASK-*.json` | `plan_dir` |
| `verification.json` | `run_dir` |
| `review.json` | review stage |
| `test-results.json`, `uat.md` | test stage |
| `grill-report.md` | `grill_id` |
| `.brainstorming/*` | `brainstorm_dir` |

Extract signals from output: artifact IDs (`ANL-xxx`, `PLN-xxx`, `BLP-xxx`), path signals, phase signals.

### A_OUTPUT_RESULT

Output structured result block:

```
---RESULT---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY|BLOCKED
SUMMARY: <动词开头，≤100 字>
ARTIFACTS: <逗号分隔的产物路径>
DECISIONS: <关键决策，分号分隔>
CAVEATS: <后续注意事项>
DEFERRED: <推迟工作项，分号分隔>
SIGNALS: <key=value 对，分号分隔>
---END---
```

**STATUS determination:**
- 正常完成 + 有产物 → `DONE`
- 完成但有 warnings → `DONE_WITH_CONCERNS`
- 出错可重试 → `NEEDS_RETRY`
- 出错不可重试 → `BLOCKED`

</actions>

</state_machine>

<appendix>

### Output Example

```
---RESULT---
STATUS: DONE
SUMMARY: 生成 8 个 task 覆盖认证模块 3 个子系统，wave 1 含 5 个独立 task
ARTIFACTS: {run_dir}/outputs/PLN-20260628/TASK-001.json,{run_dir}/outputs/PLN-20260628/plan.json
DECISIONS: 选择 wave 模式分 2 波执行；JWT 和 session 分离为独立 task
CAVEATS: 模块 X 的外部 API 尚未确认，TASK-003 可能需调整
DEFERRED: 性能基准测试留到 review 后
SIGNALS: plan_dir={run_dir}/outputs/PLN-20260628;PLN-xxx=PLN-20260628
---END---
```

### Success Criteria

- [ ] Parse skill_name + skill_args from $ARGUMENTS
- [ ] Execute via `maestro ralph next` (session mode) or `Skill()` (direct mode)
- [ ] Scan artifacts after execution using Glob
- [ ] Always output `---RESULT---` / `---END---` block
- [ ] STATUS correctly reflects execution outcome
- [ ] SUMMARY 动词开头，≤100 字
- [ ] No session management, no self-invocation, no decisions
- [ ] Platform: only processes codex sessions (or absent → codex)

</appendix>
</output>
