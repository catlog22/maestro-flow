---
title: "Skill 参数配置指南"
---

为 51 个命令/skill 设置默认参数，通过 Hook 自动注入，无需每次手动输入。

---

## 概览

Maestro Skill Config 解决常见痛点：每次调用 `/maestro-execute` 都要手动输入 `--auto-commit --method auto -y`。

```
用户调用 /maestro-execute 3
       ↓
skill-context hook (UserPromptSubmit)
       ↓ 匹配 skill → 加载配置 → 对比已有参数
       ↓
additionalContext 注入默认参数
       ↓
等同于 /maestro-execute 3 --auto-commit --method auto -y
```

---

## 前置条件

确保已安装 `standard` 级别以上的 hooks：

```bash
maestro hooks status              # 检查状态
maestro hooks install --level standard  # 安装
```

---

## 配置文件

### 路径与优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/skill-config.json` | 项目级覆盖 |
| 2 | `~/.maestro/skill-config.json` | 全局配置 |

<details>
<summary>文件结构示例</summary>

```json
{
  "version": "1.0.0",
  "skills": {
    "maestro-execute": {
      "params": {
        "--auto-commit": true,
        "--method": "auto",
        "-y": true
      },
      "updated": "2026-05-01T12:00:00Z"
    },
    "maestro-plan": {
      "params": {
        "--auto": true
      }
    }
  }
}
```

合并策略：项目级覆盖全局，按 skill 粒度深度合并（项目优先）。

</details>

---

## CLI 使用

```bash
maestro config list                        # 列出所有可配置 skill
maestro config set <skill> <param> <value> [-g]  # 设置（-g 全局）
maestro config show [skill]                # 查看配置
maestro config show --json                 # JSON 格式
maestro config unset <skill> <param> [-g]  # 移除单个参数
maestro config reset [skill] [-g]          # 重置配置
```

> 参数名无需 `--` 前缀，CLI 自动补全。

---

## TUI 交互界面

```bash
maestro config                    # 启动仪表盘
maestro config edit <skill>       # 编辑特定 skill
```

### 仪表盘

```
╭─────────────────────────────────────╮
│ MAESTRO SKILL CONFIG                │
│ Commands discovered:    51          │
│ Skills with defaults:   3           │
│ Hook (skill-context):   installed   │
│                                     │
│ [1] Skills  [2] Config Sources      │
│   [q] Quit                          │
╰─────────────────────────────────────╯
```

### 参数编辑器

```
▸ --auto-commit    [x] true       (boolean)
  --method         auto           (agent|codex|gemini|cli|auto)
  --executor       <not set>      (string)
  -y               [ ] false      (boolean)

[↑↓] 导航  [Space] 切换/循环  [Enter] 编辑  [d] 删除  [Esc] 返回
```

操作：Boolean → `Space` 切换 / Enum → `Space` 循环 / String → `Enter` 编辑 / 保存选 `[g]` 全局 或 `[p]` 项目

---

## Hook 注入机制

`skill-context` hook 在 `UserPromptSubmit` 时触发：

1. 匹配 skill 名称（硬编码模式 + 通用正则兜底）
2. 加载全局 + 项目级配置，深度合并
3. 冲突检测：用户已显式指定的参数跳过
4. 通过 `additionalContext` 注入（不修改原始输入）

---

## 常用配置示例

```bash
# 开发模式（自动提交 + 跳过确认）
maestro config set maestro-execute auto-commit true -g
maestro config set maestro-execute y true -g
maestro config set maestro-execute method auto -g

# 审查模式（深度审查）
maestro config set quality-review level deep -g

# 规划模式（自动 + 协作）
maestro config set maestro-plan auto true -g
maestro config set maestro-plan collab true

# 分析模式（静默）
maestro config set maestro-analyze y true -g
maestro config set maestro-analyze c true -g
```

---

## 注意事项

1. **Hook 必须安装** — 注入依赖 `skill-context` hook
2. **参数名匹配** — 需与 `argument-hint` 一致
3. **位置参数不可配置** — `[phase]`、`<path>` 等需每次手动传入
4. **项目级配置不追踪** — `.maestro/skill-config.json` 通常在 `.gitignore` 中

---

## 命令参考

| 命令 | 说明 |
|------|------|
| `maestro config` | TUI 仪表盘 |
| `maestro config list` | 列出所有可配置 skill |
| `maestro config show [skill]` | 查看配置 |
| `maestro config set <skill> <param> <value> [-g]` | 设置参数默认值 |
| `maestro config unset <skill> <param> [-g]` | 移除参数默认值 |
| `maestro config reset [skill] [-g]` | 重置配置 |
| `maestro config edit <skill>` | TUI 编辑特定 skill |
| `maestro cfg ...` | `config` 的别名 |
