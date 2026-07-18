---
title: "⚙️ Hook 系统配置指南"
icon: "⚙️"
---

Maestro Hook 系统配置参考，包含 Hooks、Codex Hooks、Skill 参数和 Overlay 配置。

---

## Hook 系统概览

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
| `kg-context-injector` | PreToolUse | Agent | standard | 必需 | Agent 启动时注入代码结构上下文 |
| `preflight-guard` | PreToolUse | Bash\|Write\|Edit\|Agent | standard | — | 命令执行前预检守卫 |
| `spec-validator` | PreToolUse | Write\|Edit | standard | — | 规范写入验证 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | — | 关键词匹配注入规范 |
| `workflow-guard` | PreToolUse | Bash\|Write\|Edit | full | 必需 | 保护关键文件和操作 |

### Codex Hooks

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `session-context` | SessionStart | startup\|resume | minimal | 必需 | 会话启动注入工作流状态 |
| `spec-injector` | SessionStart | startup | standard | 必需 | 会话启动注入规范 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用注入上下文 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | 必需 | 关键词匹配注入规范 |
| `kg-sync` | UserPromptSubmit | — | standard | 必需 | 静默同步知识图谱 |
| `kg-context-injector` | PreToolUse | Agent | standard | 必需 | Agent 注入代码结构上下文 |
| `delegate-monitor` | PostToolUse | Bash | standard | — | 监控异步委托 |

---

## 安装级别

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

### CLI 使用

```bash
maestro config list                        # 列出所有可配置 skill
maestro config set <skill> <param> <value> [-g]  # 设置（-g 全局）
maestro config get <skill>                 # 查看 skill 配置
maestro config reset <skill>               # 重置为默认
```

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

### CLI 命令

```bash
# 列出 overlay
maestro overlay list

# 应用 overlay
maestro overlay apply <name>

# 移除 overlay
maestro overlay remove <name>

# 验证 overlay
maestro overlay validate <name>
```

---

## 性能优化

> **Stop 事件 Hook 每轮仅触发 1 次**；`delegate-monitor` 通过 Bash|Agent matcher 过滤。相比无 matcher 的 PostToolUse，每轮子进程 spawn 减少约 72%。

---

## CLI 参考

```bash
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
