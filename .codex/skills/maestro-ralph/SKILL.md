---
name: maestro-ralph
description: Adaptive lifecycle orchestrator — compose, dispatch executor via
  collaboration.spawn_agent, evaluate, loop
argument-hint: <intent> [-y] [--amend [change]] [--roadmap] [--engine
  swarm|universal] | status | continue
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - request_user_input
  - spawn_agent
  - send_message
  - followup_task
  - wait_agent
  - interrupt_agent
  - list_agents
  - spawn_agents_on_csv
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.50
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<purpose>
Adaptive lifecycle orchestrator: locate step → resolve args → load context → dispatch executor via `spawn_agent` per step → `wait_agent` for result → extract signals → drift check → ralph complete → evaluate decision → next step → loop.

Session: `.workflow/sessions/{id}/session.json` (engine=ralph) + `ralph-meta.json`
`{session_dir}` = `.workflow/sessions/{id}/`（标准 session 目录）
</purpose>

<deferred_reading>
- [ralph-amend-goal.md](~/.maestro/workflows/ralph-amend-goal.md) — read when `--amend` flag active for goal amendment flow
- [swarm scripts](~/.maestro/workflows/swarm/wf-*.js) — read `meta` block at swarm routing / universal scan（`--engine swarm|universal` 时）
- [dynamic scripts](~/.maestro/workflows/dynamic/uwf-*.js) — read `meta` block at universal scan（`--engine universal` 时）
</deferred_reading>

## Codex V2 Collaboration Protocol

本命令使用 Codex Multi-Agent V2 collaboration namespace 进行 agent 编排。核心 pattern:

### Executor Dispatch（每个 step）

```ts
// 1. spawn executor agent
const result = spawn_agent({
  task_name: `ralph_exec_step_${index}`,
  message: `Session: ${ralph_session_id}\n\n${loaded_step_context}`,
  fork_turns: "none",
  agent_type: "ralph_executor"
});

// 2. wait for completion (max 1 hour)
const status = wait_agent({ timeout_ms: 3600000 });

// 3. if timed out, interrupt and handle
if (status.timed_out) {
  interrupt_agent({ target: result.task_name });
  // → STATUS=BLOCKED, 转 S_HANDLE_FAIL
}
```

### Evaluation Agent（decision 节点）

```ts
spawn_agent({
  task_name: `ralph_eval_${decision_ref}`,
  message: `EVALUATE decision: ${decision_description}\n\nCONSTRAINTS: Read-only analysis\n\n${evidence}`,
  fork_turns: "none",
  agent_type: "ralph_executor"
});
wait_agent({ timeout_ms: 3600000 });
```

### Progress Monitoring

```ts
// 查看所有活跃 executor
list_agents({ path_prefix: "/root" });

// 向运行中的 executor 补充上下文
send_message({
  target: `ralph_exec_step_${index}`,
  message: "Additional context: ..."
});

// 向已完成的 executor 派发后续任务
followup_task({
  target: `ralph_exec_step_${index}`,
  message: "Continue with verification"
});
```

## Invariants

1. **Ralph owns the full loop** — locate step → resolve args → load context → spawn_agent → wait_agent → extract signals → drift → complete，全部在本命令内完成
2. **One agent per step** — 每个执行 step 通过 `spawn_agent` 派发，结果通过 `wait_agent` 获取
3. **Agent is a thin wrapper** — executor agent 调 `ralph next` 获取 skill prompt 并执行，返回输出文本；arg resolution、context loading、signal extraction、drift analysis、ralph complete 均由主流程完成
4. **spawn_agent for all dispatch** — executor 和 evaluator 均使用 `spawn_agent`，task_name 用于 display/日志标识
5. **主流程调 `ralph complete`** — 每个 step 完成后由主流程调 `maestro ralph complete`，非 agent 上报
6. **Decision evaluation inline** — decision 节点不 handoff，通过 `spawn_agent` 在本循环内评估
7. **wait_agent timeout = max** — 所有 `wait_agent` 调用 MUST 使用 `timeout_ms: 3600000`（最大值 1 小时）
8. **interrupt on timeout** — `wait_agent` 返回 `timed_out: true` 时，MUST 调 `interrupt_agent` 中断后转 S_HANDLE_FAIL

## State Machine

与 Claude 版本完全一致（S_LOCATE → S_COMPOSE → S_STEP_DISPATCH → S_STEP_ANALYZE → ...），仅 agent dispatch 方式不同：

| Claude | Codex V2 |
|--------|----------|
| `Agent({ subagent_type: "ralph-executor", prompt: "..." })` | `spawn_agent({ task_name: "ralph_exec_step_N", message: "...", agent_type: "ralph_executor" })` |
| 等待 task-notification `<result>` | `wait_agent({ timeout_ms: 3600000 })` |
| Agent failed → BLOCKED | `wait_agent.timed_out` → `interrupt_agent` → BLOCKED |
| `Agent()` for evaluation | `spawn_agent` for evaluation |
| `SendMessage` for context | `send_message` / `followup_task` |
| `AskUserQuestion` for confirmation | `request_user_input` for confirmation |

## Execution

其余执行逻辑（state machine 状态转换、signal extraction、drift check、chain management、session 生命周期）与 Claude 版本 `maestro-ralph.md` 完全一致。参考该文件获取完整状态机定义、action 详情、completion 路由。

仅以下区域需要 V2 适配：

### A_STEP_DISPATCH 替换

原文:
```
Agent({ subagent_type: "ralph-executor", description: "...", prompt: "..." })
```

替换为:
```ts
spawn_agent({
  task_name: `ralph_exec_step_${index}`,
  message: `Session: ${ralph_session_id}\n\n${loaded_step_context}`,
  fork_turns: "none",
  agent_type: "ralph_executor"
})
// 然后
wait_agent({ timeout_ms: 3600000 })
```

### A_AGENT_EVALUATE / A_AGENT_GOAL_AUDIT / A_AGENT_REGROUND 替换

原文:
```
Agent({ description: "评估...", prompt: "..." })
```

替换为:
```ts
spawn_agent({
  task_name: `ralph_eval_${decision_ref}`,
  message: "EVALUATE: ...\nCONSTRAINTS: Read-only",
  fork_turns: "none",
  agent_type: "ralph_executor"
})
wait_agent({ timeout_ms: 3600000 })
```

### Timeout Handling（新增）

Claude 版本无显式超时处理。Codex V2 新增:

```ts
const result = wait_agent({ timeout_ms: 3600000 });
if (result.timed_out) {
  interrupt_agent({ target: task_name });
  // 设置 STATUS=BLOCKED，reason="executor_timeout"
  // 写入 ralph-meta.json step_details[step_id].completion_status = "BLOCKED"
  // 转 S_HANDLE_FAIL
}
```

## Completion

与 Claude 版本 `maestro-ralph.md` 的 completion 路由表一致。

## Error Codes

与 Claude 版本一致，新增:

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_EXECUTOR_TIMEOUT | error | wait_agent timed out (1h) | interrupt_agent → retry or block |
| E_SPAWN_FAILED | error | spawn_agent returned error | check task_name format, retry |
