# Agent 编排工具参考

Claude Code 内置的 agent 编排工具体系，涵盖子 agent 管理、任务跟踪、流式监控。Workflow 相关内容见 `workflow-tool-guide.md`。

## 工具总览

```
┌─────────────────────────────────────────────────────────────┐
│                       主会话 (Main)                          │
│                                                             │
│  ┌─── Agent 管理 ────┐  ┌─── 任务跟踪 ────┐  ┌── 监控 ──┐  │
│  │ Agent              │  │ TaskCreate      │  │ Monitor  │  │
│  │ SendMessage        │  │ TaskGet         │  └──────────┘  │
│  └────────────────────┘  │ TaskList        │                │
│                          │ TaskUpdate      │                │
│                          │ TaskStop        │                │
│                          │ TaskOutput      │                │
│                          └─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

---

## Subagent 能力矩阵

通过实际测试验证的 subagent 能力（以 `claude` / `(Tools: All tools)` 类型为基准）：

| 能力 | 支持 | 备注 |
|------|------|------|
| 调用 Agent（嵌套） | ✅ | 可启动子 agent，支持多层嵌套 |
| 调用 Skill | ✅ | 能加载并执行主会话的 skill 文件（`.claude/skills/` 下） |
| 调用 SendMessage | ✅ | 向主会话（`"main"`）或其他 agent 发消息 |
| 调用 Task 系列 | ✅ | TaskCreate/Get/List/Update 均可用 |
| 调用 Workflow | ✅ | `(Tools: All tools)` 类型支持 |
| 调用 Monitor | ✅ | `(Tools: All tools)` 类型支持 |
| 调用 ToolSearch | ✅ | 按需加载 deferred 工具的 schema |
| 调用 MCP 工具 | ✅ | 通过 ToolSearch 加载后可调用 |
| 访问文件系统 | ✅ | Read/Write/Edit/Glob/Grep/Bash |

### 受限 Agent 类型

| 类型 | 不可用的关键工具 |
|------|----------------|
| `Explore` | Agent, Edit, Write, NotebookEdit — 纯只读 |
| `Plan` | Agent, Edit, Write, NotebookEdit — 纯只读 |
| `code-developer` | 仅 Read, Write, Edit, Bash, Glob, Grep — 无 Agent/Skill/Workflow |
| `workflow-research-agent` | 仅 Read, WebSearch, WebFetch, Bash — 无 Agent/Skill/Workflow |

### Fork 的特殊约束

Fork（`subagent_type: "fork"`）技术上继承所有工具，但有行为约束：
- **不应再嵌套 Agent** — 指令明确要求 "If you ARE the fork — execute directly; do not re-delegate"
- **模型锁定** — 始终继承父级模型，`model` 参数被忽略

---

## Agent

启动子 agent 执行任务。支持 fork（继承上下文）和全新 agent（零上下文）。

### 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | `string` | 是 | 子 agent 的任务指令 |
| `description` | `string` | 是 | 3-5 词简短描述 |
| `name` | `string` | 否 | 可寻址名称，用于 `SendMessage({to: name})`。格式：`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` |
| `subagent_type` | `string` | 否 | agent 类型。`"fork"` = 继承上下文的分身；其他值 = 全新 agent |
| `model` | `enum` | 否 | 模型覆盖：`sonnet` / `opus` / `haiku` / `fable`。fork 时忽略 |
| `mode` | `enum` | 否 | 权限模式：`acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan` |
| `isolation` | `enum` | 否 | `"worktree"` = git worktree 隔离；`"remote"` = 远程云环境 |

### Fork vs 全新 Agent

| 维度 | Fork (`subagent_type: "fork"`) | 全新 Agent |
|------|-------------------------------|------------|
| 上下文 | 继承完整对话历史 | 零上下文，需在 prompt 中提供所有信息 |
| 模型 | 继承父级，`model` 参数被忽略 | 可指定 model |
| Prompt 写法 | 指令式（做什么，不用解释背景） | 完整 briefing（像给刚进来的同事交代任务） |
| 缓存 | 共享父级 prompt cache，开销低 | 无缓存共享 |
| 适用场景 | 调研、探索、不需要保留中间输出在主上下文中 | 需要独立视角、特定工具集、专业 agent 类型 |

### 使用原则

- **不要偷看**：fork 返回的 `output_file` 不要 Read，会把 fork 的工具噪音拉入主上下文
- **不要抢答**：fork 未返回前不要猜测或编造结果
- **并行启动**：多个独立 agent 放在同一条消息的多个 tool call 中

### 示例

```js
// Fork — 继承上下文的后台调研
Agent({
  subagent_type: "fork",
  name: "ship-audit",
  description: "Branch ship-readiness audit",
  prompt: "审计当前分支的发布就绪状态。检查未提交变更、测试覆盖、CI 配置。"
})

// 全新 agent — 独立代码审查
Agent({
  name: "migration-review",
  description: "Independent migration review",
  subagent_type: "code-reviewer",
  prompt: "审查 migration 0042_user_schema.sql 的安全性。上下文：向 50M 行表添加 NOT NULL 列..."
})

// Worktree 隔离 — 并行修改文件
Agent({
  name: "fix-auth",
  description: "Fix auth module",
  isolation: "worktree",
  prompt: "修复 src/auth/validate.ts 中的 JWT 过期检查逻辑"
})
```

### 可用的 subagent_type

agent 类型决定了子 agent 可使用的工具集：

| 工具集 | 代表类型 |
|--------|---------|
| `(Tools: *)` / `All tools` | `claude`, `general-purpose`, `cli-explore-agent`, `debug-explore-agent` |
| 排除 Agent/Edit/Write | `Explore`, `Plan` — 只读分析 |
| 仅基础工具 | `code-developer` (Read, Write, Edit, Bash, Glob, Grep) |
| 仅搜索工具 | `workflow-research-agent` (Read, WebSearch, WebFetch, Bash) |

---

## SendMessage

向已启动的 agent 发送消息，恢复其执行。

### 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `to` | `string` | 是 | 接收方：agent 名称 或 `"main"`（子 agent 向主会话发消息） |
| `message` | `string` 或 `object` | 是 | 纯文本消息，或协议响应 JSON |
| `summary` | `string` | 否 | 5-10 词预览（message 为 string 时必需），最长 200 字符 |

### 协议消息

| 类型 | 用途 |
|------|------|
| `shutdown_response` | 回应关闭请求：`{type, request_id, approve}` |
| `plan_approval_response` | 回应方案审批：`{type, request_id, approve, feedback?}` |

### 示例

```js
// 向 agent 发送追加指令
SendMessage({
  to: "test-nesting",
  summary: "发送测试指令",
  message: "请尝试调用 Agent 工具创建一个嵌套子 agent"
})

// 子 agent 向主会话报告
SendMessage({
  to: "main",
  summary: "报告完成",
  message: "分析完成，发现 3 个关键问题"
})
```

---

## Task 系列

会话内的任务跟踪系统，用于分解复杂工作、追踪进度、协调多 agent 协作。

### TaskCreate

创建任务，初始状态为 `pending`。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `subject` | `string` | 是 | 简短标题，祈使句形式（如 "Fix authentication bug"） |
| `description` | `string` | 是 | 任务描述 |
| `activeForm` | `string` | 否 | 进行中时 spinner 显示的文字（如 "Fixing authentication bug"） |
| `metadata` | `object` | 否 | 任意键值对元数据 |

**何时使用：** 3+ 步骤的复杂任务、需要跟踪进度、多 agent 协作。
**何时不用：** 单步简单任务、纯对话问答。

### TaskGet

按 ID 获取任务详情。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `taskId` | `string` | 是 | 任务 ID |

返回：subject, description, status, blocks, blockedBy。

### TaskList

列出所有任务摘要，无参数。

返回每条：id, subject, status, owner, blockedBy。

### TaskUpdate

更新任务状态/内容/依赖。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `taskId` | `string` | 是 | 任务 ID |
| `status` | `enum` | 否 | `pending` → `in_progress` → `completed`，或 `deleted` 永久删除 |
| `subject` | `string` | 否 | 新标题 |
| `description` | `string` | 否 | 新描述 |
| `activeForm` | `string` | 否 | 新 spinner 文字 |
| `owner` | `string` | 否 | 分配给某 agent |
| `metadata` | `object` | 否 | 合并元数据（值为 null 删除该 key） |
| `addBlocks` | `string[]` | 否 | 标记此任务阻塞的任务 ID 列表 |
| `addBlockedBy` | `string[]` | 否 | 标记阻塞此任务的任务 ID 列表 |

### TaskStop

终止后台运行的任务。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `task_id` | `string` | 是 | 要终止的任务 ID |

### TaskOutput（已废弃）

获取后台任务输出。推荐直接 Read 输出文件。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `task_id` | `string` | 是 | 任务 ID |
| `block` | `boolean` | 是 | 是否等待完成（默认 true） |
| `timeout` | `number` | 是 | 最大等待时间 ms（默认 30000，最大 600000） |

### 典型工作流

```
TaskCreate("实现用户认证")
    ↓
TaskUpdate(taskId, status: "in_progress")
    ↓
  ... 执行工作 ...
    ↓
TaskUpdate(taskId, status: "completed")
    ↓
TaskList()  → 找下一个可用任务
```

### 依赖管理

```js
// 创建有依赖关系的任务
TaskCreate({ subject: "设计数据库 schema", description: "..." })  // → id: "1"
TaskCreate({ subject: "实现 API 端点", description: "..." })      // → id: "2"
TaskUpdate({ taskId: "2", addBlockedBy: ["1"] })
// 任务 2 在任务 1 完成前不可开始
```

### 多 Agent 协作

```js
// 主 agent 创建任务并分配
TaskCreate({ subject: "审查 auth 模块", description: "..." })  // → id: "1"
TaskUpdate({ taskId: "1", owner: "reviewer-agent" })

// reviewer-agent 领取并执行
TaskList()  // 找到 owner 为自己的任务
TaskGet({ taskId: "1" })  // 获取完整描述
TaskUpdate({ taskId: "1", status: "in_progress" })
// ... 执行 ...
TaskUpdate({ taskId: "1", status: "completed" })
TaskList()  // 找下一个
```

---

## Monitor

启动后台监控，流式推送事件通知。**非阻塞**——调用后立即返回 task ID。

### 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `description` | `string` | 是 | 通知中显示的描述 |
| `timeout_ms` | `number` | 是 | 超时 ms（默认 300000，最大 3600000）。`persistent: true` 时忽略 |
| `persistent` | `boolean` | 是 | `false` = 超时后自动终止；`true` = 会话级长期监控，需手动 TaskStop |
| `command` | `string` | 否¹ | Shell 命令，每行 stdout 是一个事件 |
| `ws` | `object` | 否¹ | WebSocket 源：`{url: string, protocols?: string[]}` |

¹ `command` 和 `ws` 二选一。

### Monitor vs Bash run_in_background

| 场景 | 选择 |
|------|------|
| 只需通知一次（"等构建完成"） | `Bash` + `run_in_background` + `until` 循环 |
| 每次出现都通知（"每个 ERROR 行"） | `Monitor` + `tail -f \| grep` |
| 有限次通知后结束（"CI 每步结果"） | `Monitor` + 会退出的命令 |
| WebSocket 推送 | `Monitor` + `ws` 参数 |

### 脚本编写要点

**刷新缓冲：**
```bash
# grep 需要 --line-buffered
tail -f app.log | grep --line-buffered "ERROR"

# awk 需要 fflush()
tail -f app.log | awk '/ERROR/ { print; fflush() }'
```

**覆盖所有终态：**
```bash
# 错误 — 崩溃/挂起时沉默
tail -f run.log | grep --line-buffered "elapsed_steps="

# 正确 — 覆盖成功和失败信号
tail -f run.log | grep -E --line-buffered "elapsed_steps=|Traceback|Error|FAILED|OOM"
```

**轮询间隔：**
- 远程 API → 30s+（避免限流）
- 本地检查 → 0.5-1s

**容错：**
```bash
# 轮询循环中处理临时失败
while true; do
  curl -s https://api.example.com/status || true
  sleep 30
done
```

### 示例

```js
// Shell 命令监控 — 日志错误
Monitor({
  command: 'tail -f /var/log/app.log | grep -E --line-buffered "ERROR|FATAL|OOM"',
  description: "应用错误日志",
  timeout_ms: 600000,
  persistent: false
})

// Shell 命令监控 — CI 状态
Monitor({
  command: `
prev=""
while true; do
  s=$(gh pr checks 123 --json name,bucket)
  cur=$(echo "$s" | jq -r '.[] | select(.bucket!="pending") | "\\(.name): \\(.bucket)"' | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  echo "$s" | jq -e 'all(.bucket!="pending")' >/dev/null && break
  sleep 30
done`,
  description: "PR CI 检查状态",
  timeout_ms: 1800000,
  persistent: false
})

// WebSocket 监控
Monitor({
  ws: { url: 'wss://events.example.com/stream', protocols: ['v1'] },
  description: "部署事件流",
  timeout_ms: 300000,
  persistent: false
})

// 会话级长期监控
Monitor({
  command: 'tail -f deploy.log | grep --line-buffered "DEPLOY"',
  description: "部署状态",
  timeout_ms: 300000,  // persistent=true 时忽略
  persistent: true     // 需手动 TaskStop 终止
})
```

---

## Skill

在当前会话中执行已注册的技能。技能提供专业化能力和领域知识，通过 `.claude/skills/` 或 `.claude/commands/` 目录注册。

### 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `skill` | `string` | 是 | 技能名称，必须是可用技能列表中的精确名称。插件命名空间技能使用 `plugin:skill` 格式 |
| `args` | `string` | 否 | 传给技能的可选参数 |

### 技能来源

| 目录 | 说明 |
|------|------|
| `.claude/skills/` | 技能文件，包含 `SKILL.md` 入口 |
| `.claude/commands/` | 命令文件，`.md` 格式 |
| `~/.claude/skills/` | 用户级全局技能 |
| `~/.claude/commands/` | 用户级全局命令 |

### 使用规则

- **仅调用已列出的技能** — 可用技能通过 `<system-reminder>` 注入上下文，不要猜测或发明技能名
- **用户输入 `/skill-name` 时** — 立即通过 Skill 工具调用，在生成其他回复之前
- **不要重复调用** — 如果技能已在运行中，不要再次调用
- **目录作用域** — 部分技能限定在特定目录下（名称带目录前缀如 `apps/web:deploy`），选择最匹配当前工作文件的变体

### Subagent 中的 Skill 调用

**经实际测试验证：** `(Tools: All tools)` 类型的 subagent 可以正常调用 Skill 工具。

- Subagent 能加载主会话注册的 skill 文件
- Skill 文件路径基于项目目录解析，subagent 的工作目录与主会话一致
- 受限类型（如 `Explore`、`code-developer`）的工具列表中不包含 Skill

### 示例

```js
// 基础调用
Skill({ skill: "maestro-help" })

// 带参数调用
Skill({ skill: "review-code", args: "src/auth/" })

// 用户输入 /brainstorm 时
Skill({ skill: "brainstorm", args: "实时协作方案" })

// 插件命名空间
Skill({ skill: "apps/web:deploy", args: "--staging" })
```

### 与 Agent 的协作

Subagent 可在执行过程中调用 Skill 获取专业能力：

```
主会话
  └─ Agent(name: "analyst", type: "claude")
       ├─ Skill("review-code", args: "src/auth/")  → 获取代码审查结果
       ├─ 基于审查结果分析问题
       └─ SendMessage(to: "main", "分析完成")
```

---

## ReportFindings

代码审查结果的结构化上报工具，供宿主 UI 渲染为可交互的 review 列表。

### 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `findings` | `array` | 是 | 验证过的发现列表，按严重程度排序（最严重在前）。无发现时传 `[]` |
| `level` | `enum` | 否 | 审查力度：`low` / `medium` / `high` / `xhigh` / `max` |

### Finding 对象结构

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file` | `string` | 是 | 相对路径 |
| `summary` | `string` | 是 | 一句话缺陷描述 |
| `failure_scenario` | `string` | 是 | 具体输入/状态 → 错误输出/崩溃 |
| `line` | `number` | 否 | 1-indexed 行号 |
| `verdict` | `enum` | 否 | `CONFIRMED` / `PLAUSIBLE`（验证后设置） |
| `outcome` | `enum` | 否 | 仅修复后再次上报：`fixed` / `skipped` / `no_change_needed` |

### 使用规则

- **仅在 code review 指令要求时调用** — 普通对话中不使用
- **一次性上报** — 调用一次，传入所有发现，不要同时以文本形式输出
- 最多 32 条 findings

### 示例

```js
// 上报审查结果
ReportFindings({
  level: "high",
  findings: [
    {
      file: "src/auth/validate.ts",
      line: 42,
      summary: "JWT 过期检查使用了错误的时间比较运算符",
      failure_scenario: "过期 token 传入 → 比较方向反转 → 返回 valid",
      verdict: "CONFIRMED"
    },
    {
      file: "src/api/users.ts",
      line: 118,
      summary: "SQL 查询使用字符串拼接而非参数化",
      failure_scenario: "用户名含单引号 → SQL 注入 → 数据泄露",
      verdict: "CONFIRMED"
    }
  ]
})

// 无发现
ReportFindings({ findings: [] })

// 修复后再次上报
ReportFindings({
  findings: [
    {
      file: "src/auth/validate.ts",
      line: 42,
      summary: "JWT 过期检查使用了错误的时间比较运算符",
      failure_scenario: "过期 token 传入 → 比较方向反转 → 返回 valid",
      outcome: "fixed"
    }
  ]
})
```

---

## 工具协作模式

### Agent + Task：多 agent 任务分发

```
主会话
  ├─ TaskCreate("任务 A")
  ├─ TaskCreate("任务 B")
  ├─ Agent(name: "worker-1") ─→ TaskList → 领取任务 A
  └─ Agent(name: "worker-2") ─→ TaskList → 领取任务 B
      │
      ├─ TaskUpdate(status: "in_progress")
      ├─ ... 执行 ...
      ├─ TaskUpdate(status: "completed")
      └─ SendMessage(to: "main", "任务完成")
```

### Agent + Monitor：agent 执行 + 进度监控

```
主会话
  ├─ Agent(name: "builder") ─→ 执行构建任务，输出到日志
  └─ Monitor(command: "tail -f build.log | grep ...") ─→ 实时推送进度
```

### Fork + 主会话并行

```
主会话
  ├─ Agent(fork, "调研方案 A")  ─→ 后台调研
  ├─ Agent(fork, "调研方案 B")  ─→ 后台调研
  └─ 继续与用户对话
      │
      ← fork 结果陆续返回 → 综合分析
```
