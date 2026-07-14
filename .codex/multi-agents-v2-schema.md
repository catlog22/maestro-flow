# Multi Agents V2 Schema

基于 openai/codex HEAD `d7ba5ff`。默认工具 namespace: `collaboration`。

`spawn_agents_on_csv` 属于独立的 Agent Jobs/SpawnCsv 扩展，不属于以下 6 个核心 V2 collaboration tools。

## 方法总览

| 方法 | 作用 | 触发执行 |
|------|------|---------|
| `spawn_agent` | 创建子 Agent 并执行初始任务 | 是 |
| `send_message` | 向已有 Agent 投递消息 | 否 |
| `followup_task` | 向已有 Agent 派发后续任务 | 是 |
| `interrupt_agent` | 中断 Agent 当前 turn | 否 |
| `list_agents` | 列出 live Agents | — |
| `wait_agent` | 等待 mailbox 更新或 final 通知 | — |

## spawn_agent

```ts
collaboration.spawn_agent(input: SpawnAgentInput): SpawnAgentOutput
```

### 完整输入 Schema

```ts
interface SpawnAgentInput {
  task_name: string;       // 只允许小写字母、数字和下划线
  message: string;         // 初始任务
  fork_turns?: "none" | "all" | `${number}`;  // 上下文传递，默认 "all"
  agent_type?: string;     // Agent role，如 default/worker/explorer
  model?: string;          // 模型覆盖
  reasoning_effort?: string; // reasoning effort 覆盖
  service_tier?: string;   // service tier 覆盖
}
```

`agent_type`/`model`/`reasoning_effort`/`service_tier` 是否暴露由运行时配置决定。当前会话精简版仅暴露 `task_name`、`message`、`fork_turns`。

### 输出

```ts
type SpawnAgentOutput =
  | { task_name: string }
  | { task_name: string; nickname: string | null };
```

`task_name` 是 canonical task path，如 `/root/backend/api_audit`。

### 行为

- 子 Agent canonical name = `{parent_path}/{task_name}`
- 子 Agent 拥有同等工具能力，可继续创建子 Agent
- 完成后 final answer 回传调用方
- 并发上限: `max_concurrent_threads_per_session`（当前 = 4，含根 Agent）

## send_message

```ts
collaboration.send_message(input: { target: string; message: string }): unknown
```

只投递消息到 mailbox，**不触发**新 turn。适合补充上下文、约束、中间发现。

## followup_task

```ts
collaboration.followup_task(input: { target: string; message: string }): unknown
```

空闲时触发新 turn；运行中时在消息边界或当前工具调用结束后交付。

### send_message vs followup_task

| 方法 | 语义 | 触发执行 | 典型用途 |
|------|------|---------|---------|
| send_message | 发消息 | 否 | 补充上下文、约束、中间发现 |
| followup_task | 发任务 | 是 | 让 Agent 继续处理明确任务 |

## interrupt_agent

```ts
collaboration.interrupt_agent(input: { target: string }): { previous_status: AgentStatus }
```

中断当前 turn，不销毁 Agent。之后仍可接收 `send_message` 和 `followup_task`。

## list_agents

```ts
collaboration.list_agents(input: { path_prefix?: string }): ListAgentsOutput
```

```ts
interface ListAgentsOutput {
  agents: Array<{
    agent_name: string;
    agent_status: AgentStatus;
    last_task_message: string | null;
  }>;
}
```

`path_prefix` 不带末尾斜杠。

## wait_agent

```ts
collaboration.wait_agent(input: { timeout_ms?: number }): WaitAgentOutput
```

```ts
interface WaitAgentOutput {
  message: string;   // mailbox 更新摘要，不含 Agent 最终正文
  timed_out: boolean;
}
```

约束: `timeout_ms` 默认 30000，最小 10000，最大 3600000。

## 公共状态类型

```ts
type AgentStatus =
  | "pending_init"
  | "running"
  | "interrupted"
  | "shutdown"
  | "not_found"
  | { completed: string | null }
  | { errored: string };
```

## 消息接收协议

Agent 在 analysis channel 收到的消息格式：

```
Message Type: MESSAGE | FINAL_ANSWER
Sender: <author>
Payload:
<payload text>
```

## 调用模板

Copy-paste-ready 模板。所有 `.codex/` 文件中的 `spawn_agent()` 调用必须遵循以下字段契约。

### Executor Dispatch（带专属 agent 定义）

```ts
spawn_agent({
  task_name: "ralph_exec_step_1",
  message: "Session: ralph-20260714-120000\n\n<task content>",
  fork_turns: "none",
  agent_type: "ralph_executor"   // → 加载 .codex/agents/ralph-executor.toml
})
wait_agent({ timeout_ms: 3600000 })
```

### Generic Dispatch（评估/临时 agent，无专属定义）

```ts
spawn_agent({
  task_name: "evaluate_quality_gate",
  message: "EVALUATE: ...\nCONSTRAINTS: Read-only analysis",
  fork_turns: "none"
  // 不传 agent_type — default agent，通过 message 中的 CONSTRAINTS 约束行为
})
wait_agent({ timeout_ms: 3600000 })
```

### Team Worker Dispatch

```ts
spawn_agent({
  task_name: "<role>",
  message: "## Role Assignment\nrole: <role>\nrole_spec: ...\nsession: ...",
  fork_turns: "none",
  agent_type: "team_worker"   // → 加载 .codex/agents/team-worker.toml
})
```

### 字段契约

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `task_name` | **Yes** | string | 小写字母 + 数字 + 下划线 |
| `message` | **Yes** | string | 完整任务 prompt |
| `fork_turns` | No | `"none"` \| `"all"` | 上下文传递，默认 `"all"` |
| `agent_type` | No | string | 加载 `.codex/agents/<name>.toml` 的 `developer_instructions` |

### 禁止字段（Claude 时代，V2 不存在）

| 禁止字段 | 替代 |
|----------|------|
| ~~`subagent_type`~~ | `agent_type` |
| ~~`prompt`~~ | `message` |
| ~~`description`~~ | 编入 `message` 或 `task_name` |
| ~~`run_in_background`~~ | V2 agent 默认异步，用 `wait_agent()` 阻塞 |
| ~~`name`~~ | `task_name` |

### Claude → V2 快速对照

```
Agent({ subagent_type: "X", description: "D", prompt: "P" })
  ↓
spawn_agent({ task_name: "X", message: "P", fork_turns: "none", agent_type: "X" })
wait_agent({ timeout_ms: 3600000 })

Agent({ description: "D", prompt: "P" })  // generic, 无 subagent_type
  ↓
spawn_agent({ task_name: "desc_slug", message: "P", fork_turns: "none" })  // 不传 agent_type
wait_agent({ timeout_ms: 3600000 })
```

## 源码参考

- 输入 Schema: [`multi_agents_spec.rs#L96-L350`](https://github.com/openai/codex/blob/d7ba5ff/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L96-L350)
- 输出 Schema: [`multi_agents_spec.rs#L352-L539`](https://github.com/openai/codex/blob/d7ba5ff/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L352-L539)
- AgentStatus: [`protocol.rs#L1703-L1723`](https://github.com/openai/codex/blob/d7ba5ff/codex-rs/protocol/src/protocol.rs#L1703-L1723)
