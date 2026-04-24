# Maestro Statusline 指南

Maestro Statusline 是 Claude Code 的自定义状态栏，提供双行实时信息显示：模型、Token 用量、Git 状态、上下文消耗，以及工作流里程碑和 Session 依赖链。

## 目录

- [快速开始](#快速开始)
- [双行布局](#双行布局)
- [Line 1 — 状态栏](#line-1--状态栏)
- [Line 2 — 工作流时间线](#line-2--工作流时间线)
- [图标系统](#图标系统)
- [配置](#配置)
- [数据来源](#数据来源)
- [常见问题](#常见问题)

---

## 快速开始

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

或通过 `maestro install` 一键安装。

### 工作原理

```
Claude Code → stdin JSON → maestro-statusline → stdout ANSI → 状态栏渲染
```

Claude Code 在每次交互后将会话数据（JSON）通过 stdin 传给 `maestro-statusline`，脚本解析后输出 ANSI 格式文本，Claude Code 将其渲染为状态栏。

---

## 双行布局

Statusline 支持双行显示，第二行仅在存在工作流里程碑时出现：

```
Line 1: ⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k | 📈 ███░░░ 28%
Line 2: 🏁 MVP 1/2 ◆P2 | ANL-001→PLN-001→EXC-001→VRF-001 ✓ · ANL-005 ●
```

无工作流时仅显示单行。

---

## Line 1 — 状态栏

从左到右依次显示以下 segment（条件显示，空值自动隐藏）：

| Segment | 说明 | 示例 |
|---------|------|------|
| Model | 当前模型名称 | `⚡ Opus 4.6` |
| Coordinator | 链式协调器进度 | `⚙ full-lifecycle verify [3/6]` |
| Task | 当前进行中的任务 | `▸ Fixing auth module` |
| Team | 活跃团队成员 | `👥 alice (P3/001) \| bob +2` |
| Dir + Git | 目录名 + Git 分支状态 | `📁 maestro2 ⎇ master △↑1` |
| Tokens | 累计 Token 用量 | `↑12k ↓3k Σ15k` |
| Context | 上下文消耗进度条 | `📈 ██████░░░░ 62%` |

### Git 状态标记

| 标记 | 含义 |
|------|------|
| （无标记） | 工作区干净 |
| `△` | 有未提交的修改（dirty） |
| `⚠` | 存在合并冲突 |
| `↑n` | 领先远程 n 个提交（需 push） |
| `↓n` | 落后远程 n 个提交（需 pull） |

### Token 用量

| 标记 | 含义 |
|------|------|
| `↑` | 累计输入 tokens |
| `↓` | 累计输出 tokens |
| `Σ` | 总计（input + output） |

数值自动格式化：`1234` → `1.2k`，`123456` → `123k`。

### 上下文颜色

进度条颜色随消耗比例变化：

| 范围 | 颜色 |
|------|------|
| 0–49% | 绿色（安全） |
| 50–64% | 黄色（注意） |
| 65–79% | 橙色（警告） |
| 80%+ | 红色（紧急） |

---

## Line 2 — 工作流时间线

仅在项目有 `.workflow/state.json` 且包含里程碑时显示。

### 结构

```
🏁 MVP 1/2 ◆P2 | ANL-001→PLN-001→EXC-001→VRF-001 ✓ · ANL-005 ●
```

| 部分 | 说明 |
|------|------|
| `🏁 MVP 1/2` | 里程碑名称 + 已完成/总 phase 数 |
| `◆P2` | 当前 phase |
| Session 链 | 通过 `depends_on` 构建的 artifact 依赖链 |

### Session 链

从 `state.json.artifacts[]` 读取，按 `depends_on` 链接构建依赖关系：

```
ANL-001 → PLN-001 → EXC-001 → VRF-001 ✓
```

- 箭头 `→` 表示执行依赖顺序
- 每个 artifact ID 按类型着色
- 多条链用 ` · ` 分隔
- 独立 artifact（无依赖链）单独显示

### Artifact 类型颜色

| 类型 | 前缀 | 颜色 | 含义 |
|------|------|------|------|
| analyze | ANL | 青色 | 分析探索 |
| plan | PLN | 金色 | 规划设计 |
| execute | EXC | 绿色 | 实现执行 |
| verify | VRF | 蓝色 | 验证确认 |

### 链尾状态标记

| 标记 | 含义 |
|------|------|
| `✓` | 链中所有 artifact 已完成 |
| `●` | 最后一个 artifact 进行中 |
| `✗` | 最后一个 artifact 失败 |
| `○` | 最后一个 artifact 待执行 |

---

## 图标系统

### 双图标集

Statusline 支持两套图标，通过配置切换：

| Segment | Nerd Font | Unicode（回退） |
|---------|-----------|-----------------|
| Model | `` (bolt) | `✎` (pencil) |
| Milestone | `` (flag) | `⚑` (flag) |
| Phase | `◆` (diamond) | `◆` (diamond) |
| Coordinator | `󰑌` (check) | `⚙` (gear) |
| Task | `` (terminal) | `▸` (triangle) |
| Team | `󰡉` (group) | `👥` (people) |
| Dir | `` (folder) | `■` (square) |
| Git | `` (branch) | `⎇` (branch) |
| Context | `` (chart) | `◔` (circle) |

### Nerd Font 要求

Nerd Font 图标需要终端安装并配置 Nerd Font 字体（如 JetBrainsMono Nerd Font）。

**Windows Terminal**：Settings → Profile → Appearance → Font face → `JetBrainsMono Nerd Font`

**VS Code**：Settings → `terminal.integrated.fontFamily` → `'JetBrainsMono Nerd Font'`

> Claude Code 桌面版/Web 版不支持自定义字体，自动使用 Unicode 回退图标。

---

## 配置

### Maestro 配置（`~/.maestro/config.json`）

```json
{
  "statusline": {
    "nerdFont": true
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `nerdFont` | boolean | `false` | 启用 Nerd Font 图标 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `MAESTRO_NERD_FONT=1` | 强制启用 Nerd Font |
| `MAESTRO_NERD_FONT=0` | 强制禁用 Nerd Font |

优先级：环境变量 > config.json > 默认值。

---

## 数据来源

### Claude Code stdin JSON

Claude Code 在每次更新时通过 stdin 传入以下字段：

| 字段 | 说明 |
|------|------|
| `model.display_name` | 当前模型名称 |
| `workspace.current_dir` | 当前工作目录 |
| `session_id` | 会话 ID |
| `context_window.remaining_percentage` | 上下文剩余百分比 |
| `context_window.total_input_tokens` | 累计输入 tokens |
| `context_window.total_output_tokens` | 累计输出 tokens |

### Maestro 内部数据

| 数据源 | 路径 | 用途 |
|--------|------|------|
| state.json | `.workflow/state.json` | 里程碑、artifact 注册表 |
| Coordinator bridge | `$TMPDIR/maestro-coord-{session}.json` | 协调器进度 |
| Context bridge | `$TMPDIR/maestro-ctx-{session}.json` | 上下文监控桥接 |
| Team activity | `.workflow/.maestro/activity.ndjson` | 团队成员活动 |
| Claude todos | `~/.claude/todos/{session}-agent-*.json` | 当前任务 |

---

## 常见问题

### 图标显示为方块

终端字体不支持 Nerd Font。解决方案：

1. 安装 Nerd Font：`winget install DEVCOM.JetBrainsMonoNerdFont`
2. 配置终端使用该字体
3. 设置 `~/.maestro/config.json` 中 `statusline.nerdFont: true`

如果使用 Claude Code 桌面版，无法自定义字体，请保持 `nerdFont: false`（默认）。

### 第二行不显示

第二行仅在以下条件满足时显示：
- 项目目录下存在 `.workflow/state.json`
- state.json 中有 `current_milestone` 字段
- 存在已注册的 artifacts

### 上下文百分比与 Claude Code 内置不一致

Maestro 的上下文百分比会扣除 Claude Code 的 ~16.5% autocompact buffer，显示的是**可用上下文**的消耗比例，比 Claude Code 内置显示偏高。

### Token 用量不显示

Token 数据需要 Claude Code 提供 `context_window.total_input_tokens` 和 `total_output_tokens` 字段。首次 API 调用前这些字段可能为 null。
