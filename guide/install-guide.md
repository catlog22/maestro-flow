---
title: "安装指南"
---

Maestro-Flow 安装分为全局 CLI 安装和项目初始化两步。

---

## 快速安装

```bash
# 1. 安装全局 CLI
npm install -g maestro-flow

# 2. 初始化项目（在项目根目录执行）
maestro install
```

**前置要求**：
- Node.js ≥ 18
- Claude Code CLI（必需）
- Codex CLI / Gemini CLI（可选，用于多 agent 工作流）

---

## 安装流程

`maestro install` 执行以下步骤：

1. **检测项目状态** — 空项目 / 已有代码 / 已有 .workflow/
2. **选择组件** — 交互式组件选择界面
3. **选择安装模式** — 全局 (~/.maestro/) 或项目级 (.workflow/)
4. **复制文件** — 按组件定义复制到目标位置
5. **生成 manifest** — 记录已安装组件，支持增量更新

---

## 组件分组

从 v0.5.32 起，安装组件从 53 个独立条目整合为 25 个分组，提供更简洁的选择体验。

### 核心组件（默认选中）

| 分组 | 说明 | 文件数 |
|------|------|--------|
| **commands** | 核心 slash 命令 | ~30 |
| **hooks** | 自动化钩子 | ~5 |
| **workflows** | 工作流脚本 | ~10 |
| **specs** | 规范模板 | 7 |

### 可选技能包

| 分组 | 包含技能 | 说明 |
|------|----------|------|
| **skills-extra-team** | team-arch-opt, team-brainstorm, team-designer, team-frontend, team-issue, team-planex 等 | 团队协作相关技能 |
| **skills-scholar** | scholar-anti-ai-writing, scholar-citation-verify, scholar-experiment, scholar-ideation 等 | 学术研究技能 |
| **skills-meta** | meta-workflow, meta-analysis 等 | 元技能和工作流编排 |

### 内置团队技能（始终安装）

以下 9 个团队技能随核心组件自动安装，无需单独选择：

- team-adversarial-swarm
- team-coordinate
- team-executor
- team-lifecycle-v4
- team-quality-assurance
- team-review
- team-swarm
- team-tech-debt
- team-testing

---

## 安装模式

### 全局模式（推荐）

安装到 `~/.maestro/`，所有项目共享：

```bash
maestro install --mode global
```

适合：个人开发机，多项目共享配置

### 项目模式

安装到项目目录 `.workflow/`，仅当前项目生效：

```bash
maestro install --mode project
```

适合：团队协作，项目特定配置

---

## 子命令

`maestro install` 提供以下子命令，可直接访问特定安装步骤：

| 子命令 | 说明 |
|--------|------|
| `maestro install components` | 安装文件组件（交互式组件选择） |
| `maestro install hooks` | 安装钩子（交互式级别选择） |
| `maestro install mcp` | 注册 MCP 服务器（交互式工具选择） |
| `maestro install toggle` | 启用/禁用已安装的命令、技能、代理 |
| `maestro install fonts` | 安装字体资源 |
| `maestro install wizard` | 启动完整交互式 TUI 向导（旧版） |

每个子命令支持 `--global` 或 `--path <dir>` 指定安装范围。

---

## Toggle — 启用/禁用管理

`maestro install toggle` 提供交互式 TUI 和非交互式命令行两种方式，管理已安装的命令、技能和代理的启用状态。

### 三状态模型

每个条目有三种状态：

| 状态 | 图标 | 含义 |
|------|------|------|
| **on** | ✓ | 已安装且已启用 |
| **off** | ✗ | 已安装但已禁用（文件重命名为 `.md.disabled`） |
| **available** | · | 源目录中存在，但尚未安装到目标位置 |

禁用机制：将 `.md` 文件重命名为 `.md.disabled`，启用时反向重命名恢复。对技能类型，禁用 `SKILL.md` → `SKILL.md.disabled`。

### 交互式 TUI

```bash
# 全局安装的 toggle
maestro install toggle

# 项目安装的 toggle
maestro install toggle --path ./my-project
```

ToggleView 界面提供三个标签页：

| 标签页 | 内容 |
|--------|------|
| **Commands** | 所有 `.claude/commands/*.md` 命令文件 |
| **Skills** | 所有 `.claude/skills/*/SKILL.md` 技能目录 |
| **Agents** | 所有 `.claude/agents/*.md` 代理文件 |

操作方式：
- **Tab** — 切换标签页（Shift+Tab 反向）
- **空格** — 切换当前条目状态（available→on, on→off, off→on）
- **上/下箭头** — 移动光标
- **Enter** — 保存并退出（更新 manifest 中的 disabledItems 列表）
- **Escape** — 退出（如有未保存变更则自动保存）

视口窗口：当条目超过 20 项时，显示滚动提示（↑ N more / ↓ N more）。

可通过 `--type` 标志限定标签页：

```bash
# 只显示命令标签页
maestro install toggle --type command
```

### 非交互式操作

```bash
# 列出所有条目及状态
maestro install toggle --list

# 按类型过滤
maestro install toggle --list --type skill

# 批量启用
maestro install toggle --enable "maestro-ralph,maestro-search"

# 批量禁用
maestro install toggle --disable "team-swarm,team-review"
```

---

## Config Profile — 配置导出/导入

安装配置可导出为 JSON profile 文件，用于团队共享或 CI 环境复现安装。

### 导出 Profile

```bash
# 从全局安装配置导出
maestro install --export

# 导出到指定路径
maestro install --export ./team-profile.json

# 从项目配置导出
maestro install --path ./my-project --export
```

导出的 profile 包含：组件选择、钩子级别、MCP 配置、statusline 主题等完整安装配置。

### 导入 Profile

```bash
# 从 profile 非交互安装
maestro install --import ./team-profile.json
```

导入时自动执行完整安装流程，无需人工干预。适合：
- 团队统一开发环境
- CI/CD 环境快速初始化
- 多机器配置同步

### Profile 存储位置

导出的 profile 默认保存到 `~/.maestro/install-profiles/` 目录。

---

## Extra MCP 目标

除 Claude Code 外，`maestro install` 支持将 MCP 服务器注册到以下 IDE/工具：

| 目标 ID | 配置文件路径 | 说明 |
|---------|-------------|------|
| `cursor` | `.cursor/mcp.json` | Cursor IDE |
| `qoder` | 项目根 `mcp.json` | Qoder |
| `trae` | `.mcp.json` | Trae IDE |
| `kiro` | `.kiro/settings/mcp.json` | Kiro IDE |
| `roo` | `.roo/mcp.json` | Roo Code（仅项目级） |
| `vscode-copilot` | `.vscode/mcp.json` | VS Code Copilot |
| `gemini-cli` | `.gemini/settings.json` | Gemini CLI |

在交互式安装向导中，Extra MCP 步骤可选择注册到上述目标。每个目标支持全局和项目两种范围。

MCP 工具列表（6 个）：`write_file`, `edit_file`, `read_file`, `read_many_files`, `team_msg`, `store_knowhow`

---

## 从旧版本迁移

### v0.5.32+ 自动迁移

旧版本的个别 skill ID 会自动映射到新分组 ID：

| 旧 ID | 新 ID |
|--------|-------|
| team-arch-opt | skills-extra-team |
| team-brainstorm | skills-extra-team |
| scholar-ideation | skills-scholar |
| ... | ... |

迁移在安装时自动执行，无需手动操作。

### 手动迁移

如需手动更新：

```bash
# 强制重新安装
maestro install --force
```

---

## 更新

```bash
# 检查更新（仅检查，不安装）
maestro update --check

# 更新到最新版本
maestro update

# 预览更新通知（配合 --notices 使用）
maestro update --notices --dry-run

# 非交互式更新（CI/自动化场景）
maestro update --non-interactive
```

### 更新流程

执行 `maestro update` 时会自动执行三步流程：

1. **重装工作流** — 使用 profile-based 机制（`manifestToProfile + spawn --import --upgrade`）
2. **应用版本通知** — 显示新版本的功能/工具/技能变更
3. **运行迁移** — 执行必要的数据迁移

### Profile-Based 重装机制

v0.5.37 引入了基于 Profile 的重装机制，解决了 Windows 命令行长度限制（~8192 字符）和 shell 转义问题：

- `manifestToProfile()` 将当前安装状态导出为临时 Profile JSON
- `spawn --import --upgrade` 使用新版本重新导入
- `mergeNewDefaults()` 自动将新默认组件合并到已有选择中

### --upgrade 标志

```bash
# 导入 Profile 并合并新默认组件
maestro install --import profile.json --upgrade
```

`--upgrade` 标志告诉安装命令在导入时调用 `mergeNewDefaults()`，自动添加新版本中 `defaultSelected !== false` 的组件。

### 更新选项

| 选项 | 说明 |
|------|------|
| `--check` | 仅检查更新，不安装 |
| `--notices` | 显示版本通知 |
| `--dry-run` | 预览变更（需配合 `--notices`） |
| `--from <ver>` | 指定起始版本（通知过滤） |
| `--to <ver>` | 指定目标版本（通知过滤） |
| `--non-interactive` | 非交互式模式（CI/自动化） |
| `--migrate <path>` | 运行指定迁移脚本（内部使用） |

---

## 卸载

```bash
# 交互式卸载
maestro uninstall

# 批量卸载（跳过确认）
maestro uninstall --yes
```

卸载时会：
1. 移除已安装的组件文件
2. 清理 manifest 记录
3. 保留 `.workflow/` 中的项目数据（specs、knowhow 等）

---

## 网络代理

如需通过代理安装，在 `~/.maestro/cli-tools.json` 中配置：

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

---

## 常见问题

### 安装卡住

1. 检查网络连接
2. 尝试配置代理（见上）
3. 使用 `--verbose` 查看详细日志

### 组件缺失

```bash
# 强制重新安装
maestro install --force
```

### 权限错误

全局安装可能需要管理员权限：
```bash
# macOS/Linux
sudo npm install -g maestro-flow

# Windows（以管理员身份运行）
npm install -g maestro-flow
```

---

## 相关命令

```bash
# 安装管理
maestro install [--global] [--path <dir>] [--force]
maestro install [--export [path]] [--import <path>] [--upgrade]
maestro install [--load <path>]  # 加载 Profile 到交互式 TUI
maestro uninstall [--yes]
maestro update [--check] [--notices] [--dry-run] [--from <ver>] [--to <ver>] [--non-interactive]

# 子命令
maestro install components [--global | --path <dir>]
maestro install hooks [--global | --project]
maestro install mcp [--global | --path <dir>]
maestro install toggle [--global | --path <dir>] [--type <type>] [--enable <names>] [--disable <names>] [--list]
maestro install fonts
maestro install wizard

# 版本信息
maestro --version
```
