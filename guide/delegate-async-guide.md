---
title: "Delegate 异步执行指南"
---

通过独立 worker 进程进行异步任务委托，支持 broker 管理的生命周期、消息注入和 MCP 通知。

---

## 快速开始

### 通过 Claude Code MCP 启动

```bash
claude --dangerously-load-development-channels server:maestro --dangerously-skip-permissions
```

MCP server 注册 9 个内置工具（`edit_file`、`write_file`、`read_file`、`read_many_files`、`team_msg`、`team_mailbox`、`store_knowhow`、`team_tasks_mcp`、`team_agents`），**不含 delegate 系列工具**。Delegate 子命令（`message`、`status`、`output`、`tail`、`cancel`）仅通过 CLI 使用，不注册为 MCP 工具。

异步 delegate 完成时，通知通过 MCP channel 推送到 Claude Code（`<channel source="maestro" ...>`），无需手动查询。要查看详细结果，在 shell 中执行 `maestro delegate status <exec_id>` 或 `maestro delegate output <exec_id>`。

### 通过 CLI 启动

```bash
# 异步（后台）—— 立即返回 execId
maestro delegate "分析 auth 模块安全漏洞" --to gemini --async

# 同步（前台）—— 阻塞直到完成
maestro delegate "say hello" --to claude
```

---

## 命令参考

### 主命令

```bash
maestro delegate "<PROMPT>" [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--to <tool>` | Agent：gemini, agy, codex, claude, opencode | 配置中第一个启用的 |
| `--role <role>` | 能力角色（analyze, explore, review, implement, plan, brainstorm, research） | — |
| `--mode <mode>` | `analysis`（只读）或 `write`（创建/修改/删除） | `analysis` |
| `--effort <level>` | 推理强度（low, medium, high, max） | 工具的 `reasoningEffort` 配置 |
| `--model <model>` | 模型覆盖 | 工具的 `primaryModel` |
| `--cd <dir>` | 工作目录 | 当前目录 |
| `--rule <template>` | 加载协议 + prompt 模板 | — |
| `--id <id>` | 执行 ID | 自动：`{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | 恢复前次会话 | — |
| `--includeDirs <dirs>` | 额外目录（逗号分隔） | — |
| `--session <id>` | MCP 会话 ID，用于通知 | 自动检测 |
| `--backend <type>` | `direct` 或 `terminal` | `direct` |
| `--timeout <ms>` | 静默超时（ms）——CLI 无输出超过此时间则强制终止 | 600000（10 分钟） |
| `--async` | 后台运行，立即返回 | 前台 |

### 子命令

```bash
maestro delegate show                              # 最近 20 条执行
maestro delegate show --all                        # 最多 100 条
maestro delegate status <id>                       # Broker + 历史状态
maestro delegate status <id> --events 10           # 带更多 broker 事件
maestro delegate output <id>                       # Assistant 输出（仅最后一条回复）
maestro delegate output <id> --full                # 完整输出（含工具调用等所有条目）
maestro delegate output <id> --verbose             # 带元数据和时间戳
maestro delegate output <id> --all                 # 包含 thinking/reasoning 条目
maestro delegate output <id> --offset <n>          # 字符偏移
maestro delegate output <id> --limit <n>           # 最大字符数
maestro delegate tail <id>                         # 最近事件 + 历史
maestro delegate tail <id> --events 20 --history 20
maestro delegate cancel <id>                       # 请求取消
maestro delegate message <id> "text"               # 注入后续消息
maestro delegate message <id> "text" --delivery after_complete
maestro delegate messages <id>                     # 列出排队消息
```

### 内置 MCP 工具

MCP server 注册以下 9 个内置工具（通过 `registerBuiltinTools()`），**不含 delegate 系列**：

| MCP 工具 | 说明 |
|---------|------|
| `edit_file` | 编辑文件（文本替换 / 行操作） |
| `write_file` | 写入文件 |
| `read_file` | 读取单个文件 |
| `read_many_files` | 批量读取 / 目录遍历 / 内容搜索 |
| `team_msg` | Agent 团队消息总线（JSONL） |
| `team_mailbox` | 团队邮箱读取 |
| `store_knowhow` | 知识条目存储与搜索 |
| `team_tasks_mcp` | 团队任务管理 |
| `team_agents` | 团队 agent 管理 |

> **注意**：Delegate 子命令（`message`、`status`、`output`、`tail`、`cancel`、`messages`）仅通过 CLI shell 调用，不注册为 MCP 工具。异步完成通知通过 MCP channel 推送。

---

## 任务生命周期

```
queued → running → completed
                 → failed
                 → cancelled
              ↗
         input_required
```

**执行 ID**：`{prefix}-{HHmmss}-{rand4}`（如 `gem-143022-a7f2`）
前缀：gemini→`gem`，agy→`agy`，codex→`cdx`，claude→`cld`，opencode→`opc`

<details>
<summary>Delegate vs CLI 功能对比</summary>

| 功能 | `maestro cli` | `maestro delegate` |
|------|:---:|:---:|
| 同步执行 | ✓ | ✓ |
| 异步执行 | — | ✓ `--async` |
| Prompt 输入 | `-p "..."` | 位置参数 `"..."` |
| 工具选择 | `--tool` | `--to` |
| Mode（analysis/write） | ✓ | ✓ |
| 模型覆盖 | ✓ | ✓ |
| 工作目录 | `--cd` | `--cd` |
| Rule 模板 | `--rule` | `--rule` |
| 自定义执行 ID | `--id` | `--id` |
| 会话恢复 | `--resume` | `--resume` |
| Backend 选择 | — | `--backend` |
| MCP 会话绑定 | — | `--session` |
| show（列出执行） | ✓ | ✓ |
| output（获取结果） | ✓ | ✓ |
| output --verbose | ✓ | ✓ |
| watch（实时流） | ✓ | — |
| status（broker + 历史） | — | ✓ |
| tail（最近事件） | — | ✓ |
| cancel | — | ✓ |
| message 注入 | — | ✓ |
| message after_complete | — | ✓ |
| MCP channel 通知 | — | ✓ |
| Snapshot（最新输出预览） | — | ✓ |

**Delegate 可完全替代 CLI。** CLI 独有功能（`watch`、`output --tail`）仅为便捷快捷方式。

</details>

---

## 消息投递

| 模式 | 行为 | 用途 |
|------|------|------|
| `inject` | 通过 stdin 路由到运行中的 worker | 补充上下文、纠偏 |
| `after_complete` | 排队消息；完成后重新启动 | 链式任务、后处理 |

```bash
# 向运行中的 delegate 注入上下文
maestro delegate message gem-143022-a7f2 "Also check src/utils/sanitize.ts"

# 链式：分析 → 自动修复
maestro delegate "分析 auth 安全漏洞" --to gemini --async
maestro delegate message gem-143022-a7f2 "修复所有严重漏洞" --delivery after_complete
```

---

## Prompt 构建

组装顺序：**Mode 协议** → **用户 prompt** → **Rule 模板**（如指定）

### Prompt 模板（6 字段）

```
PURPOSE: [目标] + [原因] + [成功标准]
TASK: [步骤 1] | [步骤 2] | [步骤 3]
MODE: analysis|write
CONTEXT: @[文件模式] | Memory: [前序工作上下文]
EXPECTED: [输出格式] + [质量标准]
CONSTRAINTS: [范围限制] | [特殊要求]
```

### Rule 模板

**分析**：`analysis-trace-code-execution`、`analysis-diagnose-bug-root-cause`、`analysis-analyze-code-patterns`、`analysis-review-architecture`、`analysis-review-code-quality`、`analysis-analyze-performance`、`analysis-assess-security-risks`

**规划**：`planning-plan-architecture-design`、`planning-breakdown-task-steps`、`planning-design-component-spec`、`planning-plan-migration-strategy`

**开发**：`development-implement-feature`、`development-refactor-codebase`、`development-generate-tests`、`development-implement-component-ui`、`development-debug-runtime-issues`

---

## 通知系统

双通道：**MCP channel**（主要，推送）+ **Hook 回退**（JSONL 文件）

节流：`status_update` 每 10s，`snapshot` 每 15s。

---

## Stale-Stream 超时

当 CLI 进程在指定时间内无任何输出（stdout/stderr），delegate broker 会强制终止该进程并标记为 `failed`。

- **默认超时**：600000ms（10 分钟）
- **CLI 覆盖**：`delegate --timeout <ms>`
- **配置覆盖**：`cli-tools.json` 中 per-tool 的 `streamTimeoutMs` 字段

优先级：`--timeout` CLI 选项 > `streamTimeoutMs` 配置 > 默认 600000ms。

---

## Proxy 配置

`cli-tools.json` 支持全局 proxy 配置，delegate 在启动 CLI 子进程前将 proxy 环境变量注入子进程环境。

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  },
  "tools": {
    "gemini": {
      "enabled": true,
      "primaryModel": "gemini-3.1-pro-preview"
    },
    "agy": {
      "enabled": true,
      "primaryModel": ""
    },
    "claude": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-6"
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `proxy.enabled` | 启用全局 proxy |
| `proxy.httpProxy` | HTTP proxy URL |
| `proxy.noProxy` | 逗号分隔的绕过列表 |
| `tools.<name>.enabled` | 启用/禁用工具 |
| `tools.<name>.primaryModel` | 默认模型 |

Delegate 启动时会 TCP 探测 proxy 可达性，不可达则跳过并警告。

---

## 工作流

### 启动 → 监控 → 获取

```bash
maestro delegate "分析 auth 模块" --to gemini --async
# → execId: gem-143022-a7f2

maestro delegate status gem-143022-a7f2
# → status: running

maestro delegate output gem-143022-a7f2
# → 完整分析结果
```

### 链式：分析 → 自动修复

```bash
maestro delegate "查找所有 SQL 注入漏洞" --to gemini --async
maestro delegate message gem-143022-a7f2 "修复所有严重漏洞" --delivery after_complete
```

### 取消 → 重定向

```bash
maestro delegate cancel gem-143022-a7f2
maestro delegate "只分析支付模块" --to gemini --async
```

---

## 相关文档

- [Role Routing 指南](role-routing-guide.md) — `--role` 角色映射机制与自定义配置
