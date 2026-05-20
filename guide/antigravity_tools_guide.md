---
title: "Antigravity 工具指南"
---

Antigravity AI 助手可用工具，包含参数和 Schema。

## 工具参考

| # | 工具 | 用途 |
|---|------|------|
| 1 | `ask_permission` | 权限不足后请求用户授权 |
| 2 | `ask_question` | 向用户提问多选题 |
| 3 | `define_subagent` | 定义新的子 Agent 类型 |
| 4 | `generate_image` | 从文本生成或编辑图片 |
| 5 | `grep_search` | 通过 ripgrep 精确匹配搜索 |
| 6 | `invoke_subagent` | 按名称调用一个或多个子 Agent |
| 7 | `list_dir` | 列出目录内容 |
| 8 | `list_permissions` | 列出所有当前权限授予 |
| 9 | `manage_subagents` | 列出、终止或全部终止子 Agent |
| 10 | `manage_task` | 列出、终止、查看状态或发送输入给后台任务 |
| 11 | `multi_replace_file_content` | 同一文件的多处非连续编辑 |
| 12 | `read_url_content` | 获取 URL 内容（HTML → Markdown） |
| 13 | `replace_file_content` | 文件单处连续块编辑 |
| 14 | `run_command` | 在用户 shell 中执行命令 |
| 15 | `schedule` | 一次性定时或周期性 cron 任务 |
| 16 | `search_web` | 网页搜索 |
| 17 | `send_message` | 向其他 Agent 发送消息 |
| 18 | `view_file` | 查看文件内容（文本、图片、PDF） |
| 19 | `write_to_file` | 创建或覆写文件 |

<details>
<summary>参数详情</summary>

### 1. ask_permission
- `Action`（enum）：`command`、`unsandboxed`、`mcp`、`custom`、`read_file`、`write_file`、`read_url`、`execute_url`
- `Target`（string）：操作目标
- `Reason`（string）：需要权限的原因
- `toolAction`、`toolSummary`（string）

### 2. ask_question
- `questions`（array）：`{question, options, is_multi_select}` 列表
- `toolAction`、`toolSummary`（string）

### 3. define_subagent
- `name`、`description`、`system_prompt`（string）
- `enable_write_tools`、`enable_mcp_tools`、`enable_subagent_tools`（boolean）
- `toolAction`、`toolSummary`（string）

### 4. generate_image
- `Prompt`、`ImageName`（string）；`ImagePaths`（array，可选）
- `toolAction`、`toolSummary`（string）

### 5. grep_search
- `SearchPath`、`Query`（string）
- `IsRegex`、`CaseInsensitive`、`MatchPerLine`（boolean）
- `Includes`（array，glob 模式）
- `toolAction`、`toolSummary`（string）

### 6. invoke_subagent
- `Subagents`（array）：`{TypeName, Role, Prompt, Workspace}` 列表
  - `Workspace`：`inherit`、`branch` 或 `share`
- `toolAction`、`toolSummary`（string）

### 7. list_dir
- `DirectoryPath`（string）；`toolAction`、`toolSummary`

### 8. list_permissions
- `toolAction`、`toolSummary`

### 9. manage_subagents
- `Action`（enum）：`list`、`kill`、`kill_all`
- `ConversationIds`（array，用于 kill）；`toolAction`、`toolSummary`

### 10. manage_task
- `Action`（enum）：`list`、`kill`、`status`、`send_input`
- `TaskId`（string，用于 kill/status/send_input）
- `Input`（string，用于 send_input）；`toolAction`、`toolSummary`

### 11. multi_replace_file_content
- `TargetFile`、`Instruction`、`Description`（string）
- `ReplacementChunks`（array）：`{StartLine, EndLine, TargetContent, ReplacementContent, AllowMultiple}`
- `TargetLintErrorIds`、`ArtifactMetadata`（可选）；`toolAction`、`toolSummary`

### 12. read_url_content
- `Url`（string）；`toolAction`、`toolSummary`

### 13. replace_file_content
- `TargetFile`、`Instruction`、`Description`、`TargetContent`、`ReplacementContent`（string）
- `StartLine`、`EndLine`（integer）；`AllowMultiple`（boolean）
- `TargetLintErrorIds`（array，可选）；`toolAction`、`toolSummary`

### 14. run_command
- `CommandLine`、`Cwd`（string）；`WaitMsBeforeAsync`（integer）
- `toolAction`、`toolSummary`

### 15. schedule
- `Prompt`（string）；`DurationSeconds`（一次性）或 `CronExpression`（周期性）
- `MaxIterations`（可选）；`toolAction`、`toolSummary`

### 16. search_web
- `query`、`domain`（string）；`toolAction`、`toolSummary`

### 17. send_message
- `Recipient`（会话 ID）、`Message`（string）；`toolAction`、`toolSummary`

### 18. view_file
- `AbsolutePath`（string）；`StartLine`、`EndLine`（integer，用于文本）
- `IsSkillFile`（boolean）；`toolAction`、`toolSummary`

### 19. write_to_file
- `TargetFile`、`CodeContent`、`Description`（string）
- `Overwrite`、`IsArtifact`（boolean）；`ArtifactMetadata`（object）
- `toolAction`、`toolSummary`

</details>

## Agent 通信与协调

### 通信流程

1. **发起**：父 Agent 使用 `invoke_subagent` → 获得 `conversationID`
2. **消息传递**：Agent 使用 `send_message` 指定目标 `conversationID`
3. **被动唤醒**：子 Agent 响应时系统自动恢复空闲的父 Agent

### 工作空间模式

| 模式 | 说明 |
|------|------|
| `inherit` | 与父 Agent 共享同一目录和状态 |
| `branch` | 获得工作空间的独立副本/克隆 |
| `share` | 共享底层仓库（类似 git worktree），独立分支 + 共享存储 |
