# MCP 工具参考

Maestro MCP 服务器暴露 9 个工具，供 Claude Code、Codex 等 AI 智能体在会话中直接调用。所有工具通过 stdio 传输协议注册，无需额外配置即可使用。

> **启用/过滤**: 通过 `MAESTRO_ENABLED_TOOLS` 环境变量或 `config.mcp.enabledTools` 控制可见工具列表。默认 `['all']` 全部启用。

---

## 目录

- [工具总览](#工具总览)
- [文件操作](#文件操作)
  - [edit_file](#edit_file)
  - [write_file](#write_file)
  - [read_file](#read_file)
  - [read_many_files](#read_many_files)
- [团队协作](#团队协作)
  - [team_msg](#team_msg)
  - [team_mailbox](#team_mailbox)
  - [team_task](#team_task)
  - [team_agent](#team_agent)
- [持久记忆](#持久记忆)
  - [core_memory](#core_memory)
- [CLI 终端命令](#cli-终端命令)

---

## 工具总览

| 工具 | 类别 | 用途 |
|------|------|------|
| `edit_file` | 文件操作 | 文本替换或行级编辑，支持 dryRun 预览 |
| `write_file` | 文件操作 | 创建/覆盖文件，自动创建目录 |
| `read_file` | 文件操作 | 单文件读取，支持行级分页 |
| `read_many_files` | 文件操作 | 批量读取/目录遍历/内容搜索 |
| `team_msg` | 团队协作 | 持久化 JSONL 消息总线 |
| `team_mailbox` | 团队协作 | 邮箱式消息投递与签收 |
| `team_task` | 团队协作 | 任务 CRUD 与状态机管理 |
| `team_agent` | 团队协作 | 智能体生命周期管理 (spawn/shutdown) |
| `core_memory` | 持久记忆 | 跨会话 JSON 记忆存储 |

---

## 文件操作

### edit_file

两种编辑模式：**update**（文本替换）和 **line**（行级操作）。支持 dryRun 预览、多编辑批量替换、模糊匹配和自动换行符适配（CRLF/LF）。

#### edit_file 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `path` | string | 是 | — | 目标文件路径 |
| `mode` | `"update"` \| `"line"` | 否 | `"update"` | 编辑模式 |
| `dryRun` | boolean | 否 | `false` | 仅预览 diff，不修改文件 |

**update 模式参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `oldText` | string | 是* | 要查找的文本 |
| `newText` | string | 是* | 替换文本 |
| `edits` | `{oldText, newText}[]` | 是* | 批量替换（与 oldText/newText 二选一） |
| `replaceAll` | boolean | 否 | 替换所有匹配（默认仅首个） |

**line 模式参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `operation` | `"insert_before"` \| `"insert_after"` \| `"replace"` \| `"delete"` | 是 | 行操作类型 |
| `line` | number | 是 | 行号（1-based） |
| `end_line` | number | 否 | 结束行号（范围操作时使用） |
| `text` | string | 否 | 插入/替换的内容 |

#### edit_file 示例

```jsonc
// 文本替换
{ "path": "src/app.ts", "oldText": "hello", "newText": "world" }

// 批量替换
{ "path": "src/app.ts", "edits": [{"oldText": "foo", "newText": "bar"}, {"oldText": "baz", "newText": "qux"}] }

// 行级插入
{ "path": "src/app.ts", "mode": "line", "operation": "insert_after", "line": 10, "text": "// added" }

// 预览变更
{ "path": "src/app.ts", "oldText": "old", "newText": "new", "dryRun": true }
```

---

### write_file

创建或覆盖文件，自动创建父目录。支持可选备份和多编码格式。

#### write_file 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `path` | string | 是 | — | 文件路径 |
| `content` | string | 是 | — | 写入内容 |
| `createDirectories` | boolean | 否 | `true` | 自动创建父目录 |
| `backup` | boolean | 否 | `false` | 覆盖前创建时间戳备份 |
| `encoding` | `"utf8"` \| `"utf-8"` \| `"ascii"` \| `"latin1"` \| `"binary"` \| `"hex"` \| `"base64"` | 否 | `"utf8"` | 文件编码 |

#### write_file 示例

```jsonc
// 创建文件
{ "path": "src/new-module.ts", "content": "export const hello = 'world';" }

// 覆盖并备份
{ "path": "config.json", "content": "{\"key\": \"value\"}", "backup": true }
```

---

### read_file

读取单个文件，支持行级分页。适用于大文件按需读取。

#### read_file 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `path` | string | 是 | — | 文件路径 |
| `offset` | number | 否 | — | 起始行偏移（0-based） |
| `limit` | number | 否 | — | 读取行数 |

#### read_file 示例

```jsonc
// 读取整个文件
{ "path": "README.md" }

// 分页读取（第 100-149 行）
{ "path": "src/large-file.ts", "offset": 99, "limit": 50 }
```

---

### read_many_files

批量文件读取、目录遍历和内容正则搜索。支持 glob 模式过滤和深度控制。

#### read_many_files 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `paths` | string \| string[] | 是 | — | 文件路径或目录 |
| `pattern` | string | 否 | — | Glob 过滤模式（如 `"*.ts"`） |
| `contentPattern` | string | 否 | — | 正则内容搜索 |
| `maxDepth` | number | 否 | `3` | 目录遍历最大深度 |
| `includeContent` | boolean | 否 | `true` | 返回结果是否包含文件内容 |
| `maxFiles` | number | 否 | `50` | 最大返回文件数 |

#### read_many_files 示例

```jsonc
// 读取多个文件
{ "paths": ["src/a.ts", "src/b.ts"] }

// 遍历目录（仅 .ts 文件）
{ "paths": "src/", "pattern": "*.ts" }

// 内容搜索
{ "paths": "src/", "contentPattern": "TODO|FIXME" }

// 仅列出不读内容
{ "paths": "src/", "includeContent": false }
```

---

## 团队协作

### team_msg

持久化 JSONL 消息总线，用于智能体团队间通信。提供 10 种操作，支持消息投递状态跟踪。

**存储位置**: `.workflow/.team/{session-id}/.msg/messages.jsonl`

#### team_msg 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | enum (见下) | 是 | — | 操作类型 |
| `session_id` | string | 是* | — | 会话 ID（如 `TLS-my-project-2026-02-27`） |
| `from` | string | 否* | — | 发送者角色名 |
| `to` | string | 否 | `"coordinator"` | 接收者角色 |
| `type` | string | 否 | `"message"` | 消息类型 |
| `summary` | string | 否 | 自动生成 | 一行摘要 |
| `data` | object | 否 | — | 结构化数据载荷 |
| `id` | string | 否* | — | 消息 ID（read/delete 时使用） |
| `last` | number | 否 | `20` | 列出最近 N 条消息（上限 100） |
| `role` | string | 否* | — | 角色名（get_state/read_mailbox 时使用） |
| `delivery_method` | string | 否 | — | 投递方式跟踪 |

**操作类型:**

| 操作 | 说明 |
|------|------|
| `log` | 追加消息到日志 |
| `broadcast` | 广播给所有团队成员 |
| `read` | 按 ID 读取单条消息 |
| `list` | 列出最近消息，支持 from/to/type 过滤 |
| `status` | 汇总各角色活跃状态 |
| `get_state` | 读取角色状态（`meta.json`） |
| `read_mailbox` | 读取角色未读消息并标记已投递 |
| `mailbox_status` | 各角色投递状态计数 |
| `delete` | 删除指定消息 |
| `clear` | 清空会话所有消息 |

#### team_msg 示例

```jsonc
// 发送消息
{ "operation": "log", "session_id": "TLS-proj-2026-04-21", "from": "planner", "to": "implementer", "summary": "plan ready", "data": {"phase": 1} }

// 读取收件箱
{ "operation": "read_mailbox", "session_id": "TLS-proj-2026-04-21", "role": "implementer" }

// 查看团队状态
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_mailbox

邮箱式智能体消息投递，支持 broker 注入和投递状态跟踪。相比 `team_msg` 更侧重点对点投递确认。

**存储位置**: `.workflow/.team/{session-id}/.msg/mailbox.jsonl`

#### team_mailbox 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | `"send"` \| `"read"` \| `"status"` | 是 | — | 操作类型 |
| `session_id` | string | 是 | — | 会话 ID |
| `from` | string | send | — | 发送者角色 |
| `to` | string | send | — | 接收者角色 |
| `message` | string | send | — | 消息内容 |
| `type` | string | 否 | `"message"` | 消息类型 |
| `delivery_method` | `"inject"` \| `"poll"` \| `"broadcast"` | 否 | `"inject"` | 投递方式 |
| `data` | object | 否 | — | 结构化数据 |
| `role` | string | read | — | 读取邮箱的角色 |
| `limit` | number | 否 | `50` | 最大返回数（1-100） |
| `mark_delivered` | boolean | 否 | `true` | 读取后标记为已投递 |

#### team_mailbox 示例

```jsonc
// 发送消息（自动注入到运行中的 agent）
{ "operation": "send", "session_id": "TLS-proj-2026-04-21", "from": "coordinator", "to": "worker-1", "message": "start task A" }

// 读取邮箱
{ "operation": "read", "session_id": "TLS-proj-2026-04-21", "role": "worker-1" }

// 查看投递状态
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_task

团队任务 CRUD 管理，基于 CollabTask 系统，带会话级命名空间隔离和状态机校验。

**存储位置**: `.workflow/.team/{session_id}/tasks/{id}.json`

#### team_task 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | `"create"` \| `"update"` \| `"list"` \| `"get"` | 是 | — | 操作类型 |
| `session_id` | string | 是 | — | 会话 ID |
| `title` | string | create | — | 任务标题 |
| `description` | string | 否 | — | 任务描述 |
| `owner` | string | 否 | `"agent"` | 责任人 |
| `priority` | `"low"` \| `"medium"` \| `"high"` \| `"critical"` | 否 | `"medium"` | 优先级 |
| `task_id` | string | update/get | — | 任务 ID（如 `ATASK-001`） |
| `status` | `"open"` \| `"assigned"` \| `"in_progress"` \| `"pending_review"` \| `"done"` \| `"closed"` | 否 | — | 任务状态 |

**状态流转:**

```
open → assigned → in_progress → pending_review → done → closed
                                                        ↘ open (reopen)
```

#### team_task 示例

```jsonc
// 创建任务
{ "operation": "create", "session_id": "TLS-proj-2026-04-21", "title": "Implement auth", "priority": "high" }

// 更新状态
{ "operation": "update", "session_id": "TLS-proj-2026-04-21", "task_id": "ATASK-001", "status": "in_progress" }

// 列出任务
{ "operation": "list", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_agent

智能体生命周期管理 —— 通过 Delegate Broker 进行 spawn、shutdown、remove 操作。

**存储位置**: `.workflow/.team/{session_id}/members.json`

#### team_agent 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | `"spawn_agent"` \| `"shutdown_agent"` \| `"remove_agent"` \| `"members"` | 是 | — | 操作类型 |
| `session_id` | string | 是 | — | 会话 ID |
| `role` | string | spawn/shutdown/remove | — | 角色名 |
| `prompt` | string | spawn | — | 智能体指令 |
| `tool` | string | 否 | `"gemini"` | CLI 工具 |

#### team_agent 示例

```jsonc
// 启动智能体
{ "operation": "spawn_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher", "prompt": "Analyze auth patterns", "tool": "gemini" }

// 关闭智能体
{ "operation": "shutdown_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher" }

// 查看成员列表
{ "operation": "members", "session_id": "TLS-proj-2026-04-21" }
```

---

## 持久记忆

### core_memory

跨会话 JSON 记忆管理，存储于 `~/.maestro/data/core-memory/`。提供 4 种操作：列出、导入、导出、搜索。

**存储位置**: `~/.maestro/data/core-memory/{project-path-md5-hash}.json`

**ID 格式**: `CMEM-YYYYMMDD-HHMMSS`

#### core_memory 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | `"list"` \| `"import"` \| `"export"` \| `"search"` | 是 | — | 操作类型 |
| `path` | string | 否 | 自动检测 | 项目路径覆盖 |
| `text` | string | import | — | 导入内容 |
| `id` | string | export | — | 记忆 ID |
| `query` | string | search | — | 搜索关键词 |
| `limit` | number | 否 | `100` | 最大结果数 |
| `tags` | string[] | 否 | — | 标签过滤（AND 逻辑） |

#### core_memory 示例

```jsonc
// 导入记忆
{ "operation": "import", "text": "Auth module uses bcrypt + JWT", "tags": ["auth", "security"] }

// 搜索
{ "operation": "search", "query": "auth token" }

// 导出
{ "operation": "export", "id": "CMEM-20260421-143000" }

// 列出（按标签过滤）
{ "operation": "list", "tags": ["auth"], "limit": 10 }
```

---

## 架构概览

```
MCP Server (stdio)
  └─ ToolRegistry
       ├─ edit_file       ─ 文件编辑 (update/line)
       ├─ write_file      ─ 文件写入
       ├─ read_file       ─ 单文件读取
       ├─ read_many_files ─ 批量文件读取/搜索
       ├─ team_msg        ─ 消息总线 (JSONL)
       ├─ team_mailbox    ─ 邮箱投递
       ├─ team_task       ─ 任务管理
       ├─ team_agent      ─ 智能体生命周期
       └─ core_memory     ─ 持久记忆
```

**适配机制**: 工具内部使用 Zod schema 校验，返回 `{success, result, error}` 格式，由 `ccwResultToMcp()` 适配为 MCP 标准格式 `{content, isError}`。
