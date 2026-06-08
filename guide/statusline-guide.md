---
title: "Maestro Statusline 指南"
---

Maestro Statusline 是 Claude Code 的自定义状态栏，提供多行实时信息显示：模型、Token 用量、Git 状态、上下文消耗，以及工作流里程碑和 Session 依赖链。

## 目录

- [快速开始](#快速开始)
- [多行布局](#多行布局)
- [Line 1 — 状态栏](#line-1--状态栏)
- [Line 2+ — 工作流时间线](#line-2--工作流时间线)
- [图标系统](#图标系统)
- [配色主题](#配色主题)
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

或通过 `maestro install` 一键安装（含主题选择）。

### 工作原理

```
Claude Code → stdin JSON → maestro-statusline → stdout ANSI → 状态栏渲染
```

Claude Code 在每次交互后将会话数据（JSON）通过 stdin 传给 `maestro-statusline`，脚本解析后输出 ANSI 格式文本，Claude Code 将其渲染为状态栏。

---

## 多行布局

Statusline 支持两种布局模式，通过 `layout` 配置项切换：

### compact（默认）

所有状态段合并为一行，工作流时间线在第二行：

**无工作流（单行）：**
```
✎ Opus 4.6 | ■ maestro2  ⎇ master | ↑12k ↓3k Σ15k +342 -87 | ◔ ███░░░ 28%
```

**有工作流（双行）：**
```
✎ Opus 4.6 | ■ maestro2  ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | ◔ ███░░░ 28%
⚑ MVP 1/2 ◆ P2 | auth ✓ · user-mgmt ⚙ execute (2/4)
```

### expanded（三行模式）

将状态信息拆成两行，工作流时间线在第三行，信息更不拥挤：

**无工作流（双行）：**
```
✎ Opus 4.6 | ⚙ full-lifecycle verify [3/6] | ▸ Fixing auth | 👥 alice
■ maestro2  ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | ◔ ███░░░ 28%
```

**有工作流（三行）：**
```
✎ Opus 4.6 | ⚙ full-lifecycle verify [3/6] | ▸ Fixing auth | 👥 alice
■ maestro2  ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | ◔ ███░░░ 28%
⚑ MVP 1/2 ◆ P2 | auth ✓ · user-mgmt ⚙ execute (2/4)
```

| 行 | compact | expanded |
|----|---------|----------|
| 1 | Model + Coord + Task + Team + Dir + Tokens + Context | Model + Coord + Task + Team |
| 2 | 工作流时间线（有工作流时） | Dir + Git + Tokens + Context |
| 3 | — | 工作流时间线（有工作流时） |

启用三行模式：

```json
{
  "statusline": {
    "layout": "expanded"
  }
}
```

或通过环境变量：`MAESTRO_STATUSLINE_LAYOUT=expanded`

---

## Line 1 — 状态栏（compact）/ Line 1+2（expanded）

从左到右依次显示以下 segment（条件显示，空值自动隐藏）：

**Line 1（两种模式均显示）：**

| Segment | 说明 | 示例 |
|---------|------|------|
| Model | 当前模型名称 | `✎ Opus 4.6` |
| Coordinator | 链式协调器进度 | `⚙ full-lifecycle verify [3/6]` |
| Task | 当前进行中的任务 | `▸ Fixing auth module` |
| Team | 活跃团队成员 | `👥 alice (P3/001) \| bob +2` |

**compact 模式 Line 1 追加 / expanded 模式 Line 2：**

| Segment | 说明 | 示例 |
|---------|------|------|
| Dir + Git | 目录名 + Git 分支状态 | `■ maestro2 ⎇ master △↑1` |
| Tokens + Lines | Token 用量 + 代码变更 | `↑12k ↓3k Σ15k +342 -87` |
| Context | 上下文消耗进度条 | `◔ ██████░░░░ 62%` |

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

### 代码变更

| 标记 | 含义 | 颜色 |
|------|------|------|
| `+N` | 新增行数 | 绿色 |
| `-N` | 删除行数 | 红色 |

数据来源于 `cost.total_lines_added` / `total_lines_removed`，仅在有变更时显示。

### 上下文颜色

| 范围 | 颜色 |
|------|------|
| 0–49% | 绿色（安全） |
| 50–64% | 黄色（注意） |
| 65–79% | 橙色（警告） |
| 80%+ | 红色（紧急） |

> Maestro 的上下文百分比会扣除 Claude Code 的 ~16.5% autocompact buffer，显示的是**可用上下文**的消耗比例。

---

## Line 2+ — 工作流时间线

仅在项目有 `.workflow/state.json` 且包含里程碑时显示。

**结构：** `🏁 MVP 1/2 ◆P2 | auth A→P→E→R→D→T→V ✓ · user-mgmt A→P ●`

| 部分 | 说明 |
|------|------|
| `🏁 MVP 1/2` | 里程碑名称 + 已完成/总 phase 数 |
| `◆P2` | 当前活跃 phase |
| Session 链 | 按 `depends_on` 构建的 artifact 依赖链 |

### Session 链格式

Session 链使用 **可读 slug + 类型流** 格式：`auth A→P→E→R→D→T→V ✓`

- **slug**（`auth`）：从 artifact 路径自动提取的可读名称
- **类型字母**（`A→P→E→V`）：每个 artifact 的类型缩写，按依赖顺序排列
- **箭头**（`→`）：执行依赖顺序
- **状态后缀**：链末尾显示整条链的状态

<details>
<summary>Slug 提取规则</summary>

从 artifact 的 `path` 字段提取可读名称：

| 原始路径 | 提取结果 |
|---------|----------|
| `scratch/analyze-auth-2026-04-20` | `auth` |
| `phases/01-auth-multi-tenant` | `auth-multi-tenant` |
| `scratch/20260421-review-P1-auth` | `auth` |

依次去除：数字前缀、`YYYYMMDD-` 日期前缀、类型名前缀（analyze/plan/execute 等）、尾部日期、`-P1` phase 编号。

</details>

### 9 种 Artifact 类型

| 类型 | 缩写 | 颜色 | 含义 |
|------|------|------|------|
| analyze | A | 青色 | 分析探索 |
| plan | P | 金色 | 规划设计 |
| execute | E | 绿色 | 实现执行 |
| verify | V | 蓝色 | 验证确认 |
| brainstorm | B | 紫色 | 头脑风暴 |
| spec | S | 黄色 | 规格定义 |
| review | R | 橙色 | 代码审查 |
| debug | D | 红色 | 调试诊断 |
| test | T | 绿色 | 测试验证 |

### 链尾状态标记

| 标记 | 含义 | 颜色 |
|------|------|------|
| `✓` | 所有 artifact 已完成 | 绿色 |
| `●` | 最后一个进行中 | 黄色 |
| `✗` | 最后一个失败 | 红色 |
| `○` | 最后一个待执行 | 灰色 |

### Chain 构建算法

1. 从 `state.json.artifacts[]` 筛选当前里程碑的 artifacts
2. 找到根 artifact（无 `depends_on` 或 `depends_on` 不在当前集合中）
3. 从根开始，沿 `depends_on` 正向链接构建链
4. 每条链的状态取决于所有 artifact 是否完成
5. 未被任何链访问到的 artifact 归类为 orphan

---

## 图标系统

Statusline 支持两套图标，通过配置切换：

| Segment | Nerd Font | Unicode（回退） |
|---------|-----------|-----------------|
| Model | `` (bolt) | `✎` (pencil) |
| Milestone | `` (flag_checkered) | `⚑` (flag) |
| Phase | `◆` (BLACK DIAMOND) | `◆` (diamond) |
| Coordinator | `󰑌` (check_circle) | `⚙` (gear) |
| Task | `` (terminal_cmd) | `▸` (triangle) |
| Team | `󰡉` (account_group) | `👥` (people) |
| Dir | `` (folder) | `■` (square) |
| Git | `` (git_branch) | `⎇` (branch) |
| Context | `` (line_chart) | `◔` (circle) |

Nerd Font 图标需要终端安装并配置 Nerd Font 字体（如 JetBrainsMono Nerd Font）。

- **Windows Terminal**：Settings → Profile → Appearance → Font face → `JetBrainsMono Nerd Font`
- **VS Code**：Settings → `terminal.integrated.fontFamily` → `'JetBrainsMono Nerd Font'`

> Claude Code 桌面版/Web 版不支持自定义字体，自动使用 Unicode 回退图标。默认 `nerdFont: false`。

---

## 配色主题

内置 5 套配色主题：

| 主题 | 风格 | 特点 |
|------|------|------|
| `notion` | 默认 | 柔和暖色，Catppuccin 风格 |
| `cyberpunk` | 科技 | 霓虹高对比，赛博朋克风格 |
| `pastel` | 小清新 | 柔和粉蓝绿，低饱和度 |
| `nord` | 北欧冷调 | 冰蓝灰绿，沉稳内敛 |
| `monokai` | 经典编辑器 | 粉绿蓝紫，高辨识度 |

<details>
<summary>各主题色彩对比</summary>

```
Notion:    Model(青)  Milestone(金)  Phase(绿)  Dir(黄)  Context(绿→黄→橙→红)
Cyberpunk: Model(霓虹青) Milestone(霓虹红) Phase(霓虹黄) Dir(电蓝) Context(荧光绿→黄→橙→红)
Pastel:    Model(天蓝)  Milestone(桃粉)  Phase(薄荷绿)  Dir(沙色) Context(鼠尾草→奶黄→粉橙→玫瑰)
Nord:      Model(冰蓝)  Milestone(极光橙) Phase(极光绿)  Dir(极光黄) Context(绿→黄→橙→红)
Monokai:   Model(蓝)   Milestone(粉红)   Phase(荧光绿)  Dir(黄)   Context(绿→黄→橙→粉红)
```

</details>

### 运行时切换

修改 `~/.maestro/config.json`：

```json
{
  "statusline": {
    "theme": "cyberpunk"
  }
}
```

---

## 配置

### Maestro 配置（`~/.maestro/config.json`）

```json
{
  "statusline": {
    "theme": "notion",
    "nerdFont": true,
    "layout": "expanded"
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `theme` | string | `"notion"` | 配色主题 |
| `nerdFont` | boolean | `false` | 启用 Nerd Font 图标 |
| `layout` | `"compact"` \| `"expanded"` | `"compact"` | `compact`=默认两行；`expanded`=三行（Model/Team 单行 + Dir/Context 单行 + 工作流行） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `MAESTRO_STATUSLINE_THEME=nord` | 强制指定主题 |
| `MAESTRO_NERD_FONT=1` | 强制启用 Nerd Font |
| `MAESTRO_NERD_FONT=0` | 强制禁用 Nerd Font |
| `MAESTRO_STATUSLINE_LAYOUT=expanded` | 强制启用三行展开模式 |
| `MAESTRO_STATUSLINE_LAYOUT=compact` | 强制使用紧凑单行模式 |

优先级：环境变量 > config.json > 默认值。

---

## 数据来源

### Claude Code stdin JSON

| 字段 | 说明 |
|------|------|
| `model.display_name` | 当前模型名称 |
| `workspace.current_dir` | 当前工作目录 |
| `session_id` | 会话 ID |
| `context_window.remaining_percentage` | 上下文剩余百分比 |
| `context_window.total_input_tokens` | 累计输入 tokens |
| `context_window.total_output_tokens` | 累计输出 tokens |
| `cost.total_lines_added` | 累计新增行数 |
| `cost.total_lines_removed` | 累计删除行数 |

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

终端字体不支持 Nerd Font。解决：安装 Nerd Font（`winget install DEVCOM.JetBrainsMonoNerdFont`），配置终端字体，设置 `statusline.nerdFont: true`。Claude Code 桌面版请保持 `nerdFont: false`。

### 第二行不显示

需满足：项目有 `.workflow/state.json`、有 `current_milestone` 字段、有已注册 artifacts。

### 上下文百分比与 Claude Code 内置不一致

Maestro 扣除 ~16.5% autocompact buffer，显示**可用上下文**消耗比例，比 Claude Code 内置显示偏高。

### Token 用量不显示

首次 API 调用前 `total_input_tokens` / `total_output_tokens` 可能为 null。

### Session 链显示为空

确保 artifacts 包含 `id`、`type`、`status`、`path` 字段，且 `milestone` 与 `current_milestone` 匹配。
