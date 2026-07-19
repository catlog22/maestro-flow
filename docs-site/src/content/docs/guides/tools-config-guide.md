---
title: "📋 配置参考指南"
icon: "📋"
---

Maestro 统一配置参考，包含角色路由、Statusline、搜索系统、工作空间、Worktree、Hook、Skill 参数和 Overlay。

---

## 角色路由配置

### 概览

基于角色的 CLI 工具路由配置，将工作类型（分析、审查、实现等）与具体 CLI 工具解耦。

```
命令 --role analyze → cli-tools.json → fallbackChain: [codex, gemini, claude] → 第一个 enabled 工具
```

### 配置文件

#### 路径优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/cli-tools.json` | 项目级覆盖 |
| 2 | `~/.maestro/cli-tools.json` | 全局配置 |
| 3 | 内置默认值 | `DEFAULT_ROLE_MAPPINGS` |

#### 配置结构

```json
{
  "version": "1.1.0",
  "tools": {
    "gemini": {
      "enabled": true,
      "primaryModel": "gemini-2.5-pro",
      "tags": ["fullstack", "frontend"],
      "type": "builtin"
    },
    "claude": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-20250514",
      "tags": ["fullstack"],
      "type": "builtin",
      "settingsFile": "~/.maestro/profiles/claude-review.json"
    },
    "codex": {
      "enabled": true,
      "primaryModel": "o3",
      "tags": ["fullstack", "backend"],
      "type": "builtin"
    }
  },
  "roles": {
    "analyze": {
      "fallbackChain": ["codex", "gemini", "claude"],
      "description": "Code analysis and understanding"
    },
    "review": {
      "fallbackChain": ["claude", "gemini", "codex"],
      "description": "Code review and quality assurance"
    },
    "implement": {
      "fallbackChain": ["codex", "claude", "gemini"],
      "description": "Feature implementation"
    }
  },
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

### CLI 命令

```bash
# 查看当前配置
maestro config get cli-tools

# 设置工具
maestro config set tools.gemini.enabled true
maestro config set tools.gemini.primaryModel "gemini-2.5-pro"

# 设置角色路由
maestro config set roles.analyze.fallbackChain '["codex", "gemini", "claude"]'

# 测试路由
maestro delegate "test" --role analyze --dry-run
```

---

## Statusline 配置

### 概览

Maestro Statusline 是 Claude Code 的自定义状态栏，提供多行实时信息显示：模型、Token 用量、Git 状态、上下文消耗，以及工作流里程碑和 Session 依赖链。

### 安装

Statusline 通过 Claude Code 的 `settings.json` 配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "maestro-statusline"
  }
}
```

或通过 `maestro install` 一键安装（含主题选择）。

### 工作原理

```
Claude Code → stdin JSON → maestro-statusline → stdout ANSI → 状态栏渲染
```

Claude Code 在每次交互后将会话数据（JSON）通过 stdin 传给 `maestro-statusline`，脚本解析后输出 ANSI 格式文本，Claude Code 将其渲染为状态栏。

### 多行布局

Statusline 支持智能多行显示，根据工作流状态和 session 链数量自动决定行数：

**无工作流（单行）：**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
```

**有工作流，≤2 条链（双行）：**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2 | auth A→P→E→V ✓ · user-mgmt A→P ●
```

**有工作流，3+ 条链（多行展开）：**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2
  auth A→P→E→R→D→T→V ✓
  user-mgmt A→P→E ●
  settings A ○
```

### 图标系统

| 图标 | 含义 |
|------|------|
| ⚡ | 模型类型 |
| 📁 | 项目名称 |
| ⎇ | Git 分支 |
| △↑ | Worktree 层级 |
| ↑↓Σ | Token 用量（输入/输出/总计） |
| +-* | Git 变更（新增/修改/删除） |
| 📈 | 上下文使用率 |
| 🏁 | 里程碑进度 |
| ◆ | 当前阶段 |
| ✓●○ | 任务状态（完成/进行中/待定） |

### 配色主题

```bash
# 查看可用主题
maestro statusline themes

# 设置主题
maestro statusline set-theme <name>

# 自定义颜色
maestro statusline set-color <element> <color>
```

### CLI 命令

```bash
# 安装 statusline
maestro statusline install

# 测试输出
maestro statusline test

# 查看配置
maestro statusline config
```

---

## 搜索系统配置

### 概览

Maestro 搜索系统基于 BM25F 算法，提供统一的知识搜索能力，支持 spec、knowhow、issue、domain、session、run 等多种数据源。

v0.5.50+ 适配 Session/Run 架构：搜索结果归一化读取 session 和 run 级产物，支持拓扑关系透出。

### 基本用法

```bash
# 关键词搜索
maestro search "authentication"

# 带类型过滤
maestro search "jwt token" --type spec

# 按 category 过滤
maestro search --category coding

# 组合查询
maestro search "oauth pkce" --type spec --category arch --limit 10

# 代码搜索（需启用 MaestroGraph）
maestro search "UserService" --code

# KG 统一搜索（MaestroGraph full-source）
maestro search "UserService" --kg

# 搜索所有来源（wiki + code），统一归一化排名
maestro search "UserService" --all

# 搜索 session/run 级产物（v0.5.50+）
maestro search "auth" --type session
maestro search "login" --type run

# JSON 输出（适合脚本消费）
maestro search "jwt token" --json
```

### BM25F 算法配置

搜索系统使用 BM25F（Best Match 25 with Field weighting）算法，对不同字段赋予不同权重：

**Default（spec/knowhow/issue 等标准文档）**

| 字段 | boost | b | 说明 |
|------|-------|---|------|
| `title` | 3 | 0.3 | 标题匹配权重最高 |
| `tags` | 2 | 0 | 标签匹配，无长度归一化 |
| `summary` | 1.5 | 0.75 | 摘要匹配 |
| `body` | 1 | 0.75 | 正文匹配（基准） |

### 配置选项

```json
{
  "search": {
    "enabled": true,
    "maxResults": 20,
    "minScore": 0.1,
    "boostFactors": {
      "title": 3,
      "tags": 2,
      "summary": 1.5,
      "body": 1
    },
    "sources": ["spec", "knowhow", "issue", "domain", "session", "run"],
    "enableCodeSearch": true
  }
}
```

### CLI 命令

```bash
# 基础搜索
maestro search "<query>" [--type <type>] [--category <cat>] [--limit N]

# 代码搜索
maestro search "<symbol>" --code

# 全局搜索
maestro search "<query>" --all

# JSON 输出
maestro search "<query>" --json

# 搜索统计
maestro search stats
```

---

## 工作空间配置

### 概览

Maestro 支持将多个项目的知识（Spec、Knowhow、Domain、Codebase）关联到当前工作空间，实现跨项目的知识检索、Spec 注入和 Wiki 聚合。所有共享为**只读**——当前工作空间仅读取关联项目的内容，不会写入。

### 配置文件

工作空间配置存储在 `.workflow/workspace.json`：

```json
{
  "version": "1.0.0",
  "linkedProjects": [
    {
      "name": "shared-lib",
      "path": "../shared-lib",
      "enabled": true,
      "scopes": ["specs", "knowhow", "domain"]
    },
    {
      "name": "api-service",
      "path": "../api-service",
      "enabled": true,
      "scopes": ["specs"]
    }
  ],
  "globalWorkspace": "~/.maestro/workspace"
}
```

### 链接项目

```bash
# 链接项目
maestro workspace link <path> [--name <name>] [--scopes specs,knowhow,domain]

# 取消链接
maestro workspace unlink <name>

# 列出链接
maestro workspace list

# 同步链接项目知识
maestro workspace sync
```

### 作用域

| 作用域 | 说明 |
|--------|------|
| `specs` | 共享 Spec 文件 |
| `knowhow` | 共享 Knowhow 文档 |
| `domain` | 共享 Domain 知识 |
| `codebase` | 共享代码库文档 |

---

## Worktree 配置

### 概览

Maestro-Flow 支持基于 git worktree 的**里程碑级并行开发**。当一个里程碑完成（即使有遗留 bug），可以 fork 出下一个里程碑的 worktree，在独立分支上推进开发，完成后 merge 回主分支。

### 配置

```json
{
  "worktree": {
    "enabled": true,
    "baseDir": ".workflow/worktrees",
    "autoCleanup": true,
    "mergeStrategy": "squash"
  }
}
```

### CLI 命令

```bash
# 创建 worktree
maestro worktree create <name> [--base <branch>]

# 列出 worktree
maestro worktree list

# 切换 worktree
maestro worktree switch <name>

# 合并 worktree
maestro worktree merge <name> [--strategy squash|merge]

# 删除 worktree
maestro worktree delete <name>
```

### 工作流程

```
1. 完成里程碑 M1
   ↓
2. maestro worktree create M2 --base main
   ↓
3. 在 M2 worktree 中开发
   ↓
4. maestro worktree merge M2
   ↓
5. 继续下一个里程碑
```

---

## Hook 系统

### 架构

| 层 | 注册方式 | 运行方式 |
|----|---------|---------|
| Claude Code Hooks | `settings.json` | 子进程 `maestro hooks run <name>` |
| Codex Hooks | `hooks.json` | 子进程 `maestro hooks run <name>` |
| Agy (Antigravity) Hooks | `~/.gemini/antigravity-cli/` | Skills + Agents 自动发现 |
| Coordinator Hooks | `WorkflowHookRegistry` | 进程内插件 |

### 协议

| 退出码 | 含义 |
|--------|------|
| `0` | 允许操作继续 |
| `2` | 阻止操作 |

| 事件类型 | 可返回 |
|---------|--------|
| `PreToolUse` | `updatedInput`（重写工具参数）/ `additionalContext` |
| `PostToolUse` | `additionalContext` |
| `Stop` | `decision: "block"`（无 `additionalContext`） |

### 工作空间感知

标记 `requiresWorkspace` 的 Hook 仅在检测到有效 Maestro 工作空间时激活（向上遍历查找含 `version` + `phases_summary` 指纹的 `.workflow/state.json`），否则 `exit(0)` 静默退出，零开销。

---

## Hook 清单

### Claude Code Hooks

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `spec-injector` | PreToolUse | Agent | minimal | 必需 | 按 agent 类型自动注入项目规范 |
| `delegate-monitor` | PostToolUse | Bash\|Agent | standard | — | 监控异步委托任务完成状态 |
| `team-monitor` | Stop | — | standard | — | 团队协作心跳记录 |
| `telemetry` | Stop | — | standard | — | 执行遥测数据采集（每轮一次） |
| `session-context` | Notification | — | standard | — | 会话启动时注入工作流状态 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用时注入工作流状态和产物树 |
| `coordinator-tracker` | Stop | — | standard | 必需 | 协调器链执行进度追踪 |
| `kg-sync` | UserPromptSubmit | — | standard | 必需 | 用户输入时静默同步知识图谱 |
| `preflight-guard` | PreToolUse | Bash\|Write\|Edit\|Agent | standard | — | 命令执行前预检守卫 |
| `spec-validator` | PreToolUse | Write | standard | — | 完整规范写入验证 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | — | 单次注入 keyword/spec/wiki/domain/KG 上下文 |
| `workflow-guard` | PreToolUse | Bash\|Write\|Edit | full | 必需 | 保护关键文件和操作 |

### Codex Hooks

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `session-context` | SessionStart | startup\|resume | minimal | 必需 | 会话启动注入工作流状态 |
| `spec-injector` | SessionStart | startup | standard | 必需 | 会话启动注入规范 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用注入上下文 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | 必需 | 单次注入 keyword/spec/wiki/domain/KG 上下文 |
| `kg-sync` | UserPromptSubmit | — | standard | 必需 | 静默同步知识图谱 |
| `delegate-monitor` | PostToolUse | Bash | standard | — | 监控异步委托 |

---

## Hook 安装级别

```bash
# 检查状态
maestro hooks status

# 安装指定级别
maestro hooks install --level minimal    # 最小集
maestro hooks install --level standard   # 标准集（推荐）
maestro hooks install --level full       # 完整集

# 卸载
maestro hooks uninstall
```

| 级别 | 包含 Hook | 适用场景 |
|------|----------|----------|
| `minimal` | spec-injector, session-context | 轻量使用 |
| `standard` | 大部分 Hook | 日常开发（推荐） |
| `full` | 所有 Hook + workflow-guard | 生产环境 |

---

## Skill 参数配置

### 概览

为 51 个命令/skill 设置默认参数，通过 Hook 自动注入，无需每次手动输入。

```
用户调用 /maestro-ralph continue
       ↓
skill-context hook (UserPromptSubmit)
       ↓ 匹配 skill → 加载配置 → 对比已有参数
       ↓
additionalContext 注入默认参数
       ↓
等同于 /maestro-ralph continue --auto-commit -y
```

### 配置文件

#### 路径与优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/skill-config.json` | 项目级覆盖 |
| 2 | `~/.maestro/skill-config.json` | 全局配置 |

#### 文件结构

```json
{
  "version": "1.0.0",
  "skills": {
    "maestro-ralph": {
      "params": {
        "--auto-commit": true,
        "-y": true
      },
      "updated": "2026-05-01T12:00:00Z"
    },
    "maestro-next": {
      "params": {
        "--auto": true
      }
    }
  }
}
```

合并策略：项目级覆盖全局，按 skill 粒度深度合并（项目优先）。

---

## Overlay 系统配置

### 核心概念

Overlay = JSON 文件，声明"在哪个命令的哪个 section 注入什么内容"。Patcher 用 HTML 注释标记包裹注入内容，实现：
- **幂等性** —— 重复 apply 不产生重复内容
- **可追溯** —— 标记标注每段内容来自哪个 overlay
- **可逆性** —— `remove` 精确剥离标记内容

### 文件布局

```
~/.maestro/overlays/
├── cli-verify.json              # 用户 overlay
├── quality-gate.json            # 用户 overlay
├── docs/                        # overlay 引用的文档
│   └── verify-protocol.md
└── _shipped/                    # 随 maestro 发布的只读 overlay（不要编辑）
```

### Overlay 文件格式

```json
{
  "name": "cli-verify",
  "description": "Add CLI verification after execution",
  "targets": ["maestro-ralph", "maestro-next"],
  "priority": 50,
  "enabled": true,
  "patches": [
    {
      "section": "required_reading",
      "mode": "append",
      "content": "## CLI Verification Protocol (overlay)\n\n@~/.maestro/overlays/docs/verify-protocol.md"
    },
    {
      "section": "execution",
      "mode": "append",
      "content": "## CLI Verification (overlay)\n\nAfter execution, run:\n```bash\nmaestro delegate \"PURPOSE: Verify...\" --mode analysis\n```"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 唯一标识符，kebab-case |
| `targets` | string[] | 是 | 目标命令名（不含 `.md`） |
| `priority` | number | 否 | 应用优先级，数值小的先应用（默认 50） |
| `enabled` | boolean | 否 | 设为 `false` 暂时禁用 |
| `scope` | string | 否 | `"global"` / `"project"` / `"any"` |
| `patches` | Patch[] | 是 | 补丁列表 |

### Patch 字段

| 字段 | 说明 |
|------|------|
| `section` | 目标 XML section 名称 |
| `mode` | `"append"` / `"prepend"` / `"replace"` / `"new-section"` |
| `content` | 注入的 Markdown 内容 |
| `afterSection` | 仅 `new-section` 模式：新 section 插入在此 section 之后 |

### 可用 Section

`purpose` · `required_reading` · `deferred_reading` · `context` · `execution` · `error_codes` · `success_criteria`

### Mode 行为

| Mode | 行为 |
|------|------|
| `append` | 追加到 section 末尾 |
| `prepend` | 插入到 section 开头 |
| `replace` | 替换整个 section 内容 |
| `new-section` | 创建新 section（需指定 `afterSection`） |

---

## 性能优化

> **Stop 事件 Hook 每轮仅触发 1 次**；`delegate-monitor` 通过 Bash|Agent matcher 过滤。相比无 matcher 的 PostToolUse，每轮子进程 spawn 减少约 72%。

---

## CLI 参考

```bash
# 角色路由
maestro config get cli-tools
maestro config set tools.<tool>.enabled <true|false>
maestro config set roles.<role>.fallbackChain '[...]'

# Statusline
maestro statusline install
maestro statusline test
maestro statusline set-theme <name>

# 搜索
maestro search "<query>" [--type <type>] [--category <cat>] [--code] [--all] [--json]
maestro search stats

# 工作空间
maestro workspace link <path> [--name <name>] [--scopes <scopes>]
maestro workspace unlink <name>
maestro workspace list
maestro workspace sync

# Worktree
maestro worktree create <name> [--base <branch>]
maestro worktree list
maestro worktree switch <name>
maestro worktree merge <name> [--strategy <strategy>]
maestro worktree delete <name>

# Hook 管理
maestro hooks status
maestro hooks install --level <minimal|standard|full>
maestro hooks uninstall
maestro hooks run <name> [--input <json>]

# Skill 配置
maestro config list
maestro config set <skill> <param> <value> [-g]
maestro config get <skill>
maestro config reset <skill>

# Overlay 管理
maestro overlay list
maestro overlay apply <name>
maestro overlay remove <name>
maestro overlay validate <name>
```
