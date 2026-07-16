---
title: "Maestro 配置参考"
icon: "⚙️"
---

Maestro 完整配置参考，涵盖所有配置文件、环境变量和 CLI 选项。面向人类用户和 AI Agent 共同使用。

---

## 配置文件一览

| 文件 | 路径 | 作用 |
|------|------|------|
| `cli-tools.json` | `~/.maestro/cli-tools.json` | CLI 工具注册、角色路由、网络代理 |
| `api.json` | `~/.maestro/api.json` | Explore/MOA 端点配置 |
| `moa.json` | `~/.maestro/moa.json` | MOA 多模型聚合预设 |
| `skill-config.json` | `~/.maestro/skill-config.json` | Skill 默认参数 |
| `config.json` | `.workflow/config.json` | 项目工作流配置 |
| `workspace.json` | `.workflow/workspace.json` | 跨项目工作空间链接 |
| `settings.json` | `.claude/settings.json` | Claude Code Hook/Statusline 配置 |
| `hooks.json` | `.codex/hooks.json` | Codex Hook 配置 |
| Overlay JSON | `~/.maestro/overlays/*.json` | 命令增强补丁 |

**优先级规则**：项目级 > 全局级。项目级配置文件（`{project}/.maestro/`）覆盖全局配置（`~/.maestro/`）。

---

## 1. CLI 工具配置 (`cli-tools.json`)

管理 CLI delegate 工具注册和角色路由。

### 路径优先级

| 优先级 | 路径 |
|--------|------|
| 1（最高） | `{project}/.maestro/cli-tools.json` |
| 2 | `~/.maestro/cli-tools.json` |
| 3 | 内置默认值 |

### 完整 Schema

```json
{
  "version": "1.1.0",
  "tools": {
    "<tool-name>": {
      "enabled": true,
      "primaryModel": "model-id",
      "tags": ["fullstack", "frontend"],
      "type": "builtin",
      "settingsFile": "path/to/settings.json",
      "reasoningEffort": "high"
    }
  },
  "roles": {
    "<role-name>": {
      "fallbackChain": ["tool1", "tool2"],
      "description": "Role description"
    }
  },
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

### 字段说明

#### tools.\<name\>

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 是否启用 |
| `primaryModel` | string | 是 | 默认模型 ID |
| `tags` | string[] | 否 | 能力标签：`fullstack`、`frontend`、`backend`、`devops`、`data`、`explore`、`readonly` |
| `type` | string | 否 | 工具类型：`builtin`（默认） |
| `settingsFile` | string | 否 | Claude Code 配置覆盖路径 |
| `reasoningEffort` | string | 否 | 推理强度：`low`、`medium`、`high`、`max` |
| `streamTimeoutMs` | number | 否 | 流式超时（ms，默认 600000） |
| `proxy` | boolean | 否 | 设为 `false` 跳过全局代理 |

#### roles.\<name\>

| 字段 | 类型 | 说明 |
|------|------|------|
| `fallbackChain` | string[] | 工具优先级链，第一个 enabled 的工具被选中 |
| `description` | string | 角色描述 |

内置角色：`analyze`、`review`、`implement`、`plan`、`brainstorm`、`research`、`explore`。

#### proxy

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用代理 |
| `httpProxy` | string | HTTP/HTTPS 代理地址 |
| `noProxy` | string | 不走代理的地址列表（逗号分隔） |

### CLI 操作

```bash
maestro config get cli-tools
maestro config set tools.gemini.enabled true
maestro config set tools.gemini.primaryModel "gemini-2.5-pro"
maestro config set roles.analyze.fallbackChain '["codex", "gemini"]'
```

---

## 2. Explore 端点配置 (`api.json`)

管理 `maestro explore` 和 `maestro moa` 的 API 端点。

### 路径

`~/.maestro/api.json`（遗留 `~/.maestro/api-explore.json` 作为 fallback）

### 完整 Schema

```json
{
  "endpoints": {
    "<name>": {
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "sk-xxx",
      "model": "model-name",
      "format": "openai",
      "maxTurns": 3,
      "concurrency": 2,
      "extraBody": { "temperature": 0.2 }
    }
  },
  "maxTurns": 6,
  "concurrency": 4,
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  },
  "circuitBreaker": {
    "threshold": 3,
    "fallbackOrder": ["endpoint-a", "endpoint-b"]
  }
}
```

### 字段说明

#### endpoints.\<name\>

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `baseUrl` | string | 是 | — | API 地址 |
| `apiKey` | string | 是 | — | API 密钥 |
| `model` | string | 是 | — | 模型名称 |
| `format` | string | 否 | `"openai"` | API 格式：`"openai"` 或 `"anthropic"` |
| `maxTurns` | number | 否 | 全局值 | 最大搜索轮数 |
| `concurrency` | number | 否 | 无限制 | 同一端点最大并发 job 数 |
| `extraBody` | object | 否 | — | 模型特定参数 |

#### 全局字段

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `maxTurns` | `6` | 全局最大搜索轮数 |
| `concurrency` | `4` | 全局最大并行队列数 |

#### circuitBreaker

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `threshold` | `3` | 连续失败几次后熔断 |
| `fallbackOrder` | 配置顺序 | 备选端点优先级列表 |

**代理传输层回退**（v0.5.50+）：代理连接失败（`ECONNREFUSED`、`ETIMEDOUT`）时自动直连回退。HTTP 状态码错误不触发回退。

### 遗留环境变量

| 变量 | 说明 |
|------|------|
| `API_EXPLORE_BASE_URL` | 端点地址 |
| `API_EXPLORE_API_KEY` | API 密钥 |
| `API_EXPLORE_MODEL` | 模型名称 |
| `OPENAI_API_KEY` | OpenAI 密钥（fallback） |

---

## 3. MOA 多模型聚合配置 (`moa.json`)

管理 Mixture of Agents 预设。

### 路径

`~/.maestro/moa.json`

### Schema

```json
{
  "presets": {
    "default": {
      "references": ["qwen", "deepseek"],
      "aggregator": "sonnet",
      "description": "Default MOA preset"
    },
    "thorough": {
      "references": ["qwen", "deepseek", "gpt-mini"],
      "aggregator": "sonnet",
      "description": "3-model thorough search"
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `references` | Reference 端点名称列表（引用 `api.json` 中的端点） |
| `aggregator` | Aggregator 端点名称 |
| `description` | 预设描述 |

---

## 4. Skill 参数配置 (`skill-config.json`)

为命令/skill 设置默认参数，通过 Hook 自动注入。

### 路径优先级

| 优先级 | 路径 |
|--------|------|
| 1（最高） | `{project}/.maestro/skill-config.json` |
| 2 | `~/.maestro/skill-config.json` |

### Schema

```json
{
  "version": "1.0.0",
  "skills": {
    "<skill-name>": {
      "params": {
        "--auto-commit": true,
        "--method": "auto",
        "-y": true
      },
      "updated": "2026-05-01T12:00:00Z"
    }
  }
}
```

合并策略：项目级覆盖全局，按 skill 粒度深度合并。

### CLI 操作

```bash
maestro config list                              # 列出可配置 skill
maestro config set maestro-execute --method auto  # 设置参数
maestro config set maestro-plan --auto true -g    # 设置全局参数
maestro config get maestro-execute                # 查看配置
maestro config reset maestro-execute              # 重置
```

---

## 5. 项目工作流配置 (`config.json`)

项目级工作流行为配置，由 `maestro-init` 创建。

### 路径

`.workflow/config.json`

### Schema

```json
{
  "granularity": "standard",
  "workflow": {
    "research": true,
    "reflection": true
  },
  "execution": {
    "method": "auto",
    "auto_commit": true,
    "default_executor": ""
  },
  "gates": {
    "confirm_roadmap": true,
    "confirm_plan": true
  },
  "guard": {
    "enabled": false,
    "mode": "allow",
    "paths": []
  },
  "codebase": {
    "auto_sync_after_execute": true
  },
  "dashboard": {
    "port": 3001
  },
  "specInjection": {
    "enabled": true,
    "globalKeywords": ["auth", "security"],
    "excludeKeywords": ["deprecated"],
    "agentCategoryMap": {
      "code-developer": ["coding", "learning", "ui"],
      "workflow-planner": ["arch"]
    },
    "extraDocs": {
      "coding": ["specs/coding-extra.md"]
    },
    "alwaysInject": ["specs/critical-rules.md"]
  },
  "specAnalytics": {
    "enabled": true,
    "trackKeywords": true,
    "trackHookExecution": true,
    "retentionDays": 30
  },
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
  },
  "worktree": {
    "enabled": true,
    "baseDir": ".workflow/worktrees",
    "autoCleanup": true,
    "mergeStrategy": "squash"
  }
}
```

### 关键配置块

#### specInjection — Spec 自动注入

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用自动注入 |
| `globalKeywords` | string[] | 全局关键词过滤 |
| `excludeKeywords` | string[] | 排除关键词 |
| `agentCategoryMap` | object | Agent 类型 → Spec Category 映射 |
| `extraDocs` | object | Category → 额外文档路径 |
| `alwaysInject` | string[] | 始终注入的文档路径 |

默认 Agent → Category 映射：

| Agent Type | Categories |
|------------|-----------|
| `code-developer` | coding, learning, ui |
| `tdd-developer` | coding, test |
| `workflow-executor` | coding |
| `workflow-planner` | arch |
| `workflow-reviewer` | review |
| `workflow-debugger` | debug |
| `general` | coding, learning |

#### specAnalytics — Spec 分析统计

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用分析 |
| `trackKeywords` | boolean | `true` | 跟踪关键词命中 |
| `trackHookExecution` | boolean | `true` | 跟踪 Hook 执行 |
| `retentionDays` | number | `30` | 数据保留天数 |

#### search — 搜索行为

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxResults` | number | `20` | 最大返回条数 |
| `minScore` | number | `0.1` | 最低匹配分数 |
| `boostFactors` | object | 见 schema | BM25F 字段权重 |
| `sources` | string[] | 6 种 | 搜索数据源（v0.5.50+ 含 session/run） |
| `enableCodeSearch` | boolean | `true` | 启用 MaestroGraph 代码搜索 |

#### worktree — Worktree 并行开发

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用 |
| `baseDir` | string | `.workflow/worktrees` | Worktree 基目录 |
| `autoCleanup` | boolean | `true` | 合并后自动清理 |
| `mergeStrategy` | string | `"squash"` | 合并策略：`squash` 或 `merge` |

---

## 6. 工作空间配置 (`workspace.json`)

跨项目知识共享（只读链接）。

### 路径

`.workflow/workspace.json`

### Schema

```json
{
  "version": "1.0.0",
  "linkedProjects": [
    {
      "name": "shared-lib",
      "path": "../shared-lib",
      "enabled": true,
      "scopes": ["specs", "knowhow", "domain"]
    }
  ],
  "globalWorkspace": "~/.maestro/workspace"
}
```

| Scope | 说明 |
|-------|------|
| `specs` | 共享 Spec 约束规则 |
| `knowhow` | 共享 Knowhow 知识文档 |
| `domain` | 共享 Domain 领域知识 |
| `codebase` | 共享代码库文档 |

### CLI 操作

```bash
maestro workspace link ../shared-lib --scopes specs,knowhow
maestro workspace unlink shared-lib
maestro workspace list
maestro workspace sync
```

---

## 7. Hook 系统配置

### 安装级别

| 级别 | 包含 | 适用场景 |
|------|------|----------|
| `minimal` | spec-injector, session-context | 轻量使用 |
| `standard` | 大部分 Hook（推荐） | 日常开发 |
| `full` | 所有 Hook + workflow-guard | 生产环境 |

```bash
maestro hooks install --level standard
maestro hooks status
maestro hooks uninstall
```

### Hook 清单

| Hook | 事件类型 | 用途 |
|------|---------|------|
| `spec-injector` | PreToolUse | 按 agent 类型自动注入项目规范 |
| `delegate-monitor` | PostToolUse | 监控异步委托任务完成状态 |
| `session-context` | Notification | 会话启动注入工作流状态 |
| `skill-context` | UserPromptSubmit | Skill 调用注入工作流状态 |
| `kg-sync` | UserPromptSubmit | 静默同步知识图谱 |
| `kg-context-injector` | PreToolUse | Agent 启动注入代码结构上下文 |
| `keyword-spec-injector` | UserPromptSubmit | 关键词匹配注入规范 |
| `workflow-guard` | PreToolUse | 保护关键文件和操作（仅 full） |

### Hook 环境变量

| 变量 | 说明 |
|------|------|
| `MAESTRO_HOOKS_DISABLE` | 禁用指定 Hook（逗号分隔） |
| `MAESTRO_HOOKS_ENABLE` | 仅启用指定 Hook |

---

## 8. Statusline 配置

### 安装

```bash
maestro statusline install        # 交互式安装（含主题选择）
```

或手动配置 `.claude/settings.json`：

```json
{
  "statusLine": {
    "type": "command",
    "command": "maestro-statusline"
  }
}
```

### 环境变量

| 变量 | 值 | 说明 |
|------|-----|------|
| `MAESTRO_NERD_FONT` | `0` / `1` | 是否使用 Nerd Font 图标 |
| `MAESTRO_STATUSLINE_THEME` | 主题名 | 覆盖配色主题 |
| `MAESTRO_STATUSLINE_LAYOUT` | `compact` / `expanded` | 布局模式 |

### 配置文件

`~/.maestro/config.json` 中的 `statusline` 块：

```json
{
  "statusline": {
    "nerdFont": false,
    "theme": "default",
    "layout": "compact"
  }
}
```

---

## 9. Overlay 系统配置

命令增强补丁——在不修改原始命令文件的情况下注入内容。

### 文件布局

```
~/.maestro/overlays/
├── cli-verify.json          # 用户 overlay
├── quality-gate.json
├── docs/                    # overlay 引用的文档
└── _shipped/                # 随 maestro 发布（只读）
```

### Schema

```json
{
  "name": "cli-verify",
  "description": "Add CLI verification after execution",
  "targets": ["maestro-execute", "maestro-plan"],
  "priority": 50,
  "enabled": true,
  "patches": [
    {
      "section": "execution",
      "mode": "append",
      "content": "## Verification\n\nRun verification after execution."
    }
  ]
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 唯一标识符（kebab-case） |
| `targets` | string[] | 是 | 目标命令名 |
| `priority` | number | 否 | 应用优先级（小值优先，默认 50） |
| `enabled` | boolean | 否 | 是否启用 |
| `patches[].section` | string | 是 | 目标 section：`purpose`、`required_reading`、`execution` 等 |
| `patches[].mode` | string | 是 | `append`、`prepend`、`replace`、`new-section` |
| `patches[].content` | string | 是 | 注入内容 |

### CLI 操作

```bash
maestro overlay list
maestro overlay apply <name>
maestro overlay remove <name>
maestro overlay validate <name>
```

---

## 10. 安装配置

### Install Profiles（安装配置导出/导入）

安装配置可序列化为 profile 文件，支持跨机器复现相同安装：

```bash
maestro install --export my-setup          # 导出当前安装配置
maestro install --import my-setup          # 从 profile 导入
maestro install --load my-setup            # 加载 profile 并安装
```

Profile 存储在 `~/.maestro/install-profiles/{name}.json`，格式版本 `maestro-install-config/v1`。

### Manifest（安装清单）

Manifest 是安装的真相源（`~/.maestro/manifests/{id}.json`，schema v2.0），记录：
- `knownComponentIds` — 所有曾安装过的组件 ID
- `installedComponents` — 当前启用的组件
- 并发安全：安装锁 + 原子写（write-tmp-then-rename）

### 平台支持

| 平台 | Hook 配置位置 | 说明 |
|------|--------------|------|
| Claude Code | `~/.claude/settings.json` | 主平台 |
| Codex | `~/.codex/hooks.json` | 需在 `~/.codex/config.toml` 设 `codex_hooks = true` |
| Agy (Gemini) | `~/.gemini/config/` | Antigravity CLI |
| Cursor / Trae / Kiro / Roo | 各自配置目录 | 仅 Hook，无完整集成 |

---

## 11. 沙箱模式

限制 Maestro 的文件访问范围，适用于受控环境：

| 变量 | 说明 |
|------|------|
| `MAESTRO_ENABLE_SANDBOX` | 设为 `1` 或 `true` 启用沙箱 |
| `MAESTRO_ALLOWED_DIRS` | 允许访问的目录列表（逗号分隔） |

---

## 12. 搜索排名调优

### 知识时间衰减

搜索结果按知识类型应用不同的半衰期，越旧的条目得分越低：

| 知识类型 | 半衰期（天） | 说明 |
|----------|-------------|------|
| `domain` | 180 | 领域知识衰减最慢 |
| `project` / `roadmap` / `note` | 90 | 项目级信息 |
| `spec` | 60 | 规范条目 |
| `knowhow` | 30 | 操作知识衰减较快 |
| `issue` | 14 | Issue 衰减最快 |

衰减参数（代码级可调）：`FLOOR` 0.3、`ceiling` 1.2、`warningThreshold` 0.5。

### 搜索上限

| 参数 | 值 | 说明 |
|------|-----|------|
| session 搜索上限 | 3 | 每次搜索最多返回 3 条 session 结果 |
| scratch 搜索上限 | 3 | 每次搜索最多返回 3 条 scratch 结果 |
| 候选缓冲 | `limit × 1.5` | 内部候选池为请求限制的 1.5 倍 |

---

## 13. Embedding 语义搜索

### 配置

```bash
maestro install embedding --download     # 下载 ONNX 模型（~465MB）
maestro install embedding --local <path> # 使用本地模型文件夹
maestro install embedding --rebuild      # 重建索引
```

| 配置方式 | 说明 |
|----------|------|
| 环境变量 `MAESTRO_EMBEDDING_MODEL_PATH` | 指定本地模型文件夹路径 |
| 配置文件 `~/.maestro/local-embedding.json` | 模型路径 + 参数 |
| API 配置 `~/.maestro/api-embedding.json` | 远程 embedding API 端点 |

---

## 14. 环境变量总览

### 核心

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAESTRO_HOME` | `~/.maestro` | Maestro 全局目录 |
| `MAESTRO_LOCALE` | 系统语言 | 界面语言（`zh-CN`、`en` 等） |
| `MAESTRO_PROJECT_ROOT` | `cwd()` | 项目根目录 |
| `MAESTRO_DEBUG` | — | 启用调试输出 |
| `MAESTRO_CLAUDE_HOME` | `~/.claude` | Claude Code 配置目录 |

### Explore / API

| 变量 | 说明 |
|------|------|
| `API_EXPLORE_BASE_URL` | 端点地址 |
| `API_EXPLORE_API_KEY` | API 密钥 |
| `API_EXPLORE_MODEL` | 模型名称 |
| `OPENAI_API_KEY` | OpenAI 密钥（fallback） |

### Hook

| 变量 | 说明 |
|------|------|
| `MAESTRO_HOOKS_DISABLE` | 禁用指定 Hook（逗号分隔） |
| `MAESTRO_HOOKS_ENABLE` | 仅启用指定 Hook |

### Statusline

| 变量 | 说明 |
|------|------|
| `MAESTRO_NERD_FONT` | `0` / `1`，Nerd Font 图标 |
| `MAESTRO_STATUSLINE_THEME` | 配色主题名（默认 `notion`） |
| `MAESTRO_STATUSLINE_LAYOUT` | `compact` / `expanded` |

### Dashboard / Server

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAESTRO_DASHBOARD_PORT` | `3001` | Dashboard 服务端口 |
| `MAESTRO_DASHBOARD_URL` | — | Dashboard URL |
| `MAESTRO_DISABLE_DASHBOARD_BRIDGE` | — | 设为 `1` 禁用 bridge |
| `BRAINSTORM_HOST` / `BRAINSTORM_PORT` | — | 头脑风暴可视化服务 |

### Terminal

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAESTRO_TMUX_ENTER_DELAY` | `500` | tmux 输入延迟（ms） |
| `MAESTRO_WEZTERM_ENTER_DELAY` | `500` | WezTerm 输入延迟（ms） |
| `WEZTERM_BIN` | — | WezTerm 二进制路径 |

### 沙箱 / 安全

| 变量 | 说明 |
|------|------|
| `MAESTRO_ENABLE_SANDBOX` | `1` / `true` 启用沙箱 |
| `MAESTRO_ALLOWED_DIRS` | 允许访问目录（逗号分隔） |

### KG / Embedding

| 变量 | 说明 |
|------|------|
| `MAESTRO_KG_UNIFIED_INJECTOR` | `true` / `false`，统一 KG 注入器 |
| `MAESTRO_EMBEDDING_MODEL_PATH` | 本地 ONNX 模型路径 |

### MCP

| 变量 | 说明 |
|------|------|
| `MAESTRO_ENABLED_TOOLS` | 启用的 MCP 工具列表（逗号分隔） |

---

## 15. Spec 系统配置

### 作用域

| 作用域 | 目录 | 优先级 |
|--------|------|--------|
| `global` | `~/.maestro/specs/` | 最低 |
| `project` | `.workflow/specs/` | 中 |
| `team` | `.workflow/collab/specs/` | 高 |
| `personal` | `.workflow/collab/specs/{uid}/` | 最高 |

### Category 映射

| Category | 文件 | 用途 |
|----------|------|------|
| `coding` | `coding-conventions.md` | 命名、导入、格式 |
| `arch` | `architecture-constraints.md` | 模块结构、层边界 |
| `review` | `review-standards.md` | 质量规则 |
| `debug` | `debug-notes.md` | 调试技巧 |
| `test` | `test-conventions.md` | 测试框架 |
| `learning` | `learnings.md` | 经验教训 |
| `ui` | `ui-conventions.md` | UI/UX 约定 |

### CLI 操作

```bash
maestro spec init                                    # 初始化
maestro spec load --category coding                  # 加载指定 category
maestro spec add coding "规则标题" "规则内容"          # 添加条目
maestro spec list                                    # 列出条目
maestro spec health                                  # 生命周期统计
maestro spec supersede <old-sid> --by <new-sid>      # 规则演化替代
maestro spec conflict mark <file> <line> --note "原因" # 标记争议
maestro spec analytics                               # 分析统计
```

---

## 快速配置检查清单

首次安装后，按以下顺序配置：

1. **CLI 工具** — 编辑 `~/.maestro/cli-tools.json`，启用可用的 CLI 工具（claude、codex、gemini 等），配置代理
2. **Explore 端点** — 编辑 `~/.maestro/api.json`，添加至少一个 API 端点
3. **安装 Hook** — `maestro hooks install --level standard`
4. **安装 Statusline** — `maestro statusline install`
5. **初始化项目** — `/maestro-init`，生成 `.workflow/` 目录和 `config.json`
6. **（可选）Skill 参数** — `maestro config set maestro-execute --method auto -y`
7. **（可选）Overlay** — `maestro overlay apply <name>` 增强命令行为
8. **（可选）工作空间** — `maestro workspace link ../shared-lib` 跨项目知识共享

### AI Agent 配置要点

AI Agent 使用 Maestro 时，关注以下配置：

| 配置 | 影响 | 建议 |
|------|------|------|
| `specInjection.agentCategoryMap` | Agent 启动时加载哪些 Spec | 按角色精准配置，避免注入无关规范 |
| `skill-config.json` | 默认参数减少交互 | 设置 `-y`（自动确认）和 `--method auto` |
| Hook 级别 | 自动化程度 | 推荐 `standard`，含 spec 注入和上下文注入 |
| `search.sources` | 搜索覆盖范围 | 确保包含 `session` 和 `run`（v0.5.50+） |
| `proxy` | 网络连通性 | 在 `cli-tools.json` 和 `api.json` 中统一配置 |
