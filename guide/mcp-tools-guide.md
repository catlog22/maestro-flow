---
title: "MCP 工具参考"
---

Maestro MCP 服务器暴露 9 个工具，供 Claude Code、Codex 等 AI 智能体在会话中直接调用。所有工具通过 stdio 传输协议注册，无需额外配置即可使用。

> **启用/过滤**: 通过 `MAESTRO_ENABLED_TOOLS` 环境变量或 `config.mcp.enabledTools` 控制可见工具列表。默认 `['all']` 全部启用。

---

## 目录

- [工具总览](#工具总览)
- [文件操作](#文件操作)
- [团队协作](#团队协作)
- [知识复用](#知识复用)

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
| `store_knowhow` | 知识复用 | 知识复用条目存储 (9 种类型) |

---

## 文件操作

### edit_file

两种编辑模式：**update**（文本替换）和 **line**（行级操作）。支持 dryRun 预览、批量替换、模糊匹配和 CRLF/LF 适配。

**公共参数**: `path` (string, 必填), `mode` (update|line, 默认 update), `dryRun` (boolean, 默认 false)

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `oldText` | string | update* | 要查找的文本 |
| `newText` | string | update* | 替换文本 |
| `edits` | `{oldText, newText}[]` | update* | 批量替换（与 oldText/newText 二选一） |
| `replaceAll` | boolean | 否 | 替换所有匹配（默认仅首个） |
| `operation` | insert_before/insert_after/replace/delete | line | 行操作类型 |
| `line` | number | line | 行号（1-based） |
| `end_line` | number | 否 | 结束行号（范围操作） |
| `text` | string | 否 | 插入/替换的内容 |

<details>
<summary>示例</summary>

```jsonc
{ "path": "src/app.ts", "oldText": "hello", "newText": "world" }
{ "path": "src/app.ts", "edits": [{"oldText": "foo", "newText": "bar"}] }
{ "path": "src/app.ts", "mode": "line", "operation": "insert_after", "line": 10, "text": "// added" }
{ "path": "src/app.ts", "oldText": "old", "newText": "new", "dryRun": true }
```

</details>

---

### write_file

创建或覆盖文件，自动创建父目录。支持可选备份和多编码。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `path` | string | 是 | -- | 文件路径 |
| `content` | string | 是 | -- | 写入内容 |
| `createDirectories` | boolean | 否 | `true` | 自动创建父目录 |
| `backup` | boolean | 否 | `false` | 覆盖前创建时间戳备份 |
| `encoding` | utf8/ascii/latin1/binary/hex/base64 | 否 | `utf8` | 文件编码 |

<details>
<summary>示例</summary>

```jsonc
{ "path": "src/new-module.ts", "content": "export const hello = 'world';" }
{ "path": "config.json", "content": "{\"key\": \"value\"}", "backup": true }
```

</details>

---

### read_file / read_many_files

| 参数 | read_file | read_many_files | 说明 |
|------|-----------|-----------------|------|
| `paths` | string (必填) | string/string[] (必填) | 文件路径或目录 |
| `offset` | number (0-based) | -- | 起始行偏移 |
| `limit` | number | -- | 读取行数 |
| `pattern` | -- | string | Glob 过滤模式 |
| `contentPattern` | -- | string | 正则内容搜索 |
| `maxDepth` | -- | number (默认 3) | 目录遍历深度 |
| `includeContent` | -- | boolean (默认 true) | 是否包含文件内容 |
| `maxFiles` | -- | number (默认 50) | 最大返回文件数 |

<details>
<summary>示例</summary>

```jsonc
// read_file
{ "path": "README.md" }
{ "path": "src/large-file.ts", "offset": 99, "limit": 50 }

// read_many_files
{ "paths": ["src/a.ts", "src/b.ts"] }
{ "paths": "src/", "pattern": "*.ts" }
{ "paths": "src/", "contentPattern": "TODO|FIXME" }
{ "paths": "src/", "includeContent": false }
```

</details>

---

## 团队协作

### team_msg

持久化 JSONL 消息总线。**存储**: `.workflow/.team/{session-id}/.msg/messages.jsonl`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | 见下表 | 是 | -- | 操作类型 |
| `session_id` | string | 是 | -- | 会话 ID |
| `from` | string | log/broadcast | -- | 发送者角色 |
| `to` | string | 否 | `"coordinator"` | 接收者角色 |
| `summary` | string | 否 | 自动生成 | 一行摘要 |
| `data` | object | 否 | -- | 结构化数据 |
| `id` | string | read/delete | -- | 消息 ID |
| `last` | number | 否 | `20` | 列出最近 N 条（上限 100） |
| `role` | string | get_state/read_mailbox | -- | 角色名 |

| 操作 | 说明 | 操作 | 说明 |
|------|------|------|------|
| `log` | 追加消息 | `broadcast` | 广播给全部成员 |
| `read` | 按 ID 读取 | `list` | 列出最近消息 |
| `status` | 汇总角色状态 | `get_state` | 读取角色 meta.json |
| `read_mailbox` | 读取未读并标记 | `mailbox_status` | 投递状态计数 |
| `delete` | 删除消息 | `clear` | 清空所有消息 |

<details>
<summary>示例</summary>

```jsonc
{ "operation": "log", "session_id": "TLS-proj-2026-04-21", "from": "planner", "to": "implementer", "summary": "plan ready" }
{ "operation": "read_mailbox", "session_id": "TLS-proj-2026-04-21", "role": "implementer" }
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_mailbox

邮箱式点对点消息投递，支持 broker 注入。**存储**: `.workflow/.team/{session-id}/.msg/mailbox.jsonl`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | send/read/status | 是 | -- | 操作类型 |
| `session_id` | string | 是 | -- | 会话 ID |
| `from` / `to` | string | send | -- | 发送者/接收者角色 |
| `message` | string | send | -- | 消息内容 |
| `delivery_method` | inject/poll/broadcast | 否 | `inject` | 投递方式 |
| `role` | string | read | -- | 读取邮箱的角色 |
| `limit` | number | 否 | `50` | 最大返回数（1-100） |
| `mark_delivered` | boolean | 否 | `true` | 读取后标记已投递 |

<details>
<summary>示例</summary>

```jsonc
{ "operation": "send", "session_id": "TLS-proj-2026-04-21", "from": "coordinator", "to": "worker-1", "message": "start task A" }
{ "operation": "read", "session_id": "TLS-proj-2026-04-21", "role": "worker-1" }
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_task

团队任务 CRUD，带状态机校验。**存储**: `.workflow/.team/{session_id}/tasks/{id}.json`

**状态流转**: `open -> assigned -> in_progress -> pending_review -> done -> closed` (closed 可 reopen)

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | create/update/list/get | 是 | -- | 操作类型 |
| `session_id` | string | 是 | -- | 会话 ID |
| `title` | string | create | -- | 任务标题 |
| `description` / `owner` | string | 否 | `"agent"` | 描述 / 责任人 |
| `priority` | low/medium/high/critical | 否 | `medium` | 优先级 |
| `task_id` | string | update/get | -- | 任务 ID |
| `status` | open/assigned/in_progress/pending_review/done/closed | 否 | -- | 任务状态 |

<details>
<summary>示例</summary>

```jsonc
{ "operation": "create", "session_id": "TLS-proj-2026-04-21", "title": "Implement auth", "priority": "high" }
{ "operation": "update", "session_id": "TLS-proj-2026-04-21", "task_id": "ATASK-001", "status": "in_progress" }
{ "operation": "list", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_agent

智能体生命周期管理。**存储**: `.workflow/.team/{session_id}/members.json`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `operation` | spawn_agent/shutdown_agent/remove_agent/members | 是 | -- | 操作类型 |
| `session_id` | string | 是 | -- | 会话 ID |
| `role` | string | spawn/shutdown/remove | -- | 角色名 |
| `prompt` | string | spawn | -- | 智能体指令 |
| `tool` | string | 否 | `"gemini"` | CLI 工具 |

<details>
<summary>示例</summary>

```jsonc
{ "operation": "spawn_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher", "prompt": "Analyze auth patterns", "tool": "gemini" }
{ "operation": "shutdown_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher" }
{ "operation": "members", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

## 知识复用

### store_knowhow

项目级知识复用，存储于 `.workflow/knowhow/`。9 种类型: session(KNW-)、tip(TIP-)、template(TPL-)、recipe(RCP-)、reference(REF-)、decision(DCS-)、asset(AST-)、blueprint(BLP-)、document(DOC-)。WikiIndexer 自动索引为 `type=knowhow`。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `operation` | add/search | 是 | 操作类型 |
| `type` | string | add | session/tip/template/recipe/reference/decision/asset/blueprint/document |
| `title` / `body` | string | add | 标题 / 正文 (markdown) |
| `description` | string | 否 | 一行摘要 (搜索结果展示) |
| `tags` | string[] | 否 | 分类标签 |
| `lang` | string | 否 | [template] 编程语言 |
| `source` | string | 否 | [reference] 原始 URL |
| `status` | string | 否 | [decision] proposed/accepted/superseded |
| `assetType` | string | 否 | [asset] 资产子类型 (如 api-contract, prompt) |
| `codePaths` | string[] | 否 | [asset/blueprint] 关联代码路径 |
| `category` | string | 否 | Spec 分类 (coding, arch, test, debug, review, learning) |
| `specCategory` | string | 否 | 跨系统对齐分类 (coding, arch, debug, test, review, learning, ui) |
| `query` | string | search | 搜索关键词 |
| `limit` | number | 否 | 最大结果数 (默认 20) |

<details>
<summary>示例</summary>

```jsonc
{ "operation": "add", "type": "template", "title": "React Hook Form",
  "description": "Reusable React Hook Form pattern with validation",
  "body": "import { useForm } from 'react-hook-form'; ...",
  "lang": "typescript", "tags": ["react", "form"] }
{ "operation": "add", "type": "decision", "title": "Use PostgreSQL",
  "description": "ADR: PostgreSQL selected as primary database over MongoDB",
  "body": "ADR: PostgreSQL as primary database...",
  "status": "accepted", "tags": ["database", "architecture"] }
{ "operation": "search", "query": "authentication middleware" }
```

</details>

---

## 架构概览

```
MCP Server (stdio) -> ToolRegistry
  +-- edit_file / write_file / read_file / read_many_files  (文件操作)
  +-- team_msg / team_mailbox / team_task / team_agent      (团队协作)
  +-- store_knowhow                                         (知识复用)
```

**适配**: Zod schema 校验 -> `{success, result, error}` -> `ccwResultToMcp()` -> MCP `{content, isError}`
