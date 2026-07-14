---
name: maestro-ralph-execute
description: Execute next pending step in ralph session (Codex V2 collaboration protocol)
internal: true
argument-hint: "[-y] [session-id]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - spawn_agent
  - send_message
  - followup_task
  - wait_agent
  - interrupt_agent
  - list_agents
  - request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

> **Agent timeout**: 所有 `wait_agent` 调用 MUST 使用 `timeout_ms: 3600000`（最大值 1 小时）。

<purpose>
Single-step executor for ralph (adaptive) and maestro (static) sessions.
Each invocation: locate session → find next step → resolve args → execute → update → self-invoke next.

Mutual invocation with `/maestro-ralph` forms a self-perpetuating work loop.
Session: `.workflow/sessions/{id}/session.json` (engine=ralph) + `ralph-meta.json`
</purpose>

## Codex V2 Differences

本文件是 `maestro-ralph-execute.md` 的 Codex V2 特化版。核心逻辑完全一致，仅以下区域使用 V2 collaboration tools:

### 1. Decision Handoff（A_EXEC_DECISION）

Claude 版:
```
Skill({ skill: "maestro-ralph" })
```

Codex V2:
```ts
spawn_agent({
  task_name: `ralph_decision_${step_index}`,
  message: "Decision handoff: evaluate decision node and determine next action.\n\nSession: ${session_id}",
  fork_turns: "all"
})
wait_agent({ timeout_ms: 3600000 })
```

### 2. Self-Invocation（S_POST_EXEC → S_LOCATE）

Claude 版:
```
Skill({ skill: "maestro-ralph-execute" })
```

Codex V2:
```ts
spawn_agent({
  task_name: `ralph_exec_continue_${next_index}`,
  message: "Continue ralph execution. Session: ${session_id}",
  fork_turns: "all"
})
wait_agent({ timeout_ms: 3600000 })
```

### 3. Timeout Handling（新增）

Claude 版无显式超时。Codex V2:

```ts
const result = wait_agent({ timeout_ms: 3600000 });
if (result.timed_out) {
  interrupt_agent({ target: task_name });
  // → STATUS=BLOCKED, reason="executor_timeout"
  // → Bash("maestro ralph complete N --status BLOCKED --reason 'executor timeout after 3600s'")
  // → 转 S_HANDLE_FAIL
}
```

## Context / Invariants / State Machine

与 Claude 版 `maestro-ralph-execute.md` 完全一致。以下内容直接引用:

- **$ARGUMENTS parsing**: `-y` → auto, remaining → session_id
- **Step kinds**: decision step → spawn_agent handoff; 执行 step → `maestro ralph next` CLI
- **Invariants 1-10**: 全部保留，仅工具名替换（Agent→spawn_agent, Skill→spawn_agent）
- **State machine**: S_LOCATE → S_RESOLVE_ARGS → S_LOAD_CONTEXT → S_EXECUTE → S_POST_ANALYZE → S_POST_EXEC → S_LOCATE（循环）
- **Actions**: A_LOCATE_SESSION, A_RESOLVE_ARGS, A_LOAD_STEP_CONTEXT, A_EXEC_STEP, A_POST_ANALYZE_DRIFT — 全部一致

### 执行 step 核心流程（A_EXEC_STEP）不变

```
1. Bash("maestro ralph next --session <session_id>") — 全量捕获 stdout
   - Exit 0 → 按 stdout 内联执行
   - Exit 2 → S_LOCATE
   - Exit 3 → A_HANDLE_CONCURRENCY
   - Exit 1 → pause session
2. Goal context pre-injection (protocol < 2)
3. Inline execution — 按 stdout 执行
4. Extract signals → compose completion params
5. Bash("maestro ralph complete N --status <S> --summary ...")
6. Propagate context signals
```

执行 step 仍通过 `maestro ralph next` CLI 加载，不使用 spawn_agent。spawn_agent 仅用于:
- Decision handoff（A_EXEC_DECISION）
- Self-invocation（S_POST_EXEC 自调用链）
- Evaluation agents（如果需要 CLI delegate 评估）

### Error Codes

与 Claude 版一致，新增:

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_TIMEOUT | error | wait_agent timed out (3600s) | interrupt_agent → BLOCKED |
| E_SPAWN_FAIL | error | spawn_agent task_name 非法 | 检查名称格式（仅小写字母+数字+下划线） |

### Success Criteria

与 Claude 版完全一致（参考 `maestro-ralph-execute.md` 的 appendix）。
