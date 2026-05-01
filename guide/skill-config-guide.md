# Skill 参数配置指南

为 51 个命令/skill 设置默认参数，通过 Hook 自动注入，无需每次手动输入。

---

## 概览

Maestro Skill Config 解决一个常见痛点：每次调用 `/maestro-execute` 都要手动输入 `--auto-commit --method auto -y`。

通过 `maestro config`，你可以：
- **一次配置，持久生效** — 设置 skill 默认参数，后续调用自动注入
- **智能识别** — 自动解析 51 个命令的 `argument-hint`，识别 boolean/enum/string/number 参数类型
- **Hook 注入** — 通过 `skill-context` hook 在 `UserPromptSubmit` 时注入已配置的默认值
- **冲突检测** — 用户显式传入的参数自动跳过注入
- **双层级作用域** — 全局默认 + 项目级覆盖

```
用户调用 /maestro-execute 3
       ↓
skill-context hook (UserPromptSubmit)
       ↓ 匹配 skill 名称
       ↓ 加载 skill-config.json
       ↓ 对比用户已传参数
       ↓
additionalContext 注入默认参数
       ↓
Claude 看到: apply --auto-commit: true, --method: auto, -y: true
       ↓
等同于用户手动输入 /maestro-execute 3 --auto-commit --method auto -y
```

---

## 前置条件

Skill Config 依赖 `skill-context` hook 进行参数注入。确保已安装 `standard` 级别以上的 hooks：

```bash
# 检查 hook 状态
maestro hooks status

# 安装（如果未安装）
maestro hooks install --level standard
```

> `maestro config` 的 CLI 和 TUI 会自动检测 hook 状态，未安装时给出提示。

---

## 配置文件

### 路径与优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/skill-config.json` | 项目级覆盖 |
| 2 | `~/.maestro/skill-config.json` | 全局配置 |

### 文件结构

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

### 合并策略

项目级配置覆盖全局配置，按 skill 粒度合并：
- 同名 skill 的 `params` 深度合并（项目优先）
- 不同 skill 各自独立

---

## CLI 使用

### 查看所有可配置 skill

```bash
maestro config list
```

输出示例：
```
Skill                          Params   Configured   Hint
──────────────────────────────────────────────────────────────────────────────────────────
maestro-execute                5        3 set        [phase] [--auto-commit] [--method age...
maestro-plan                   7        1 set        [phase] [--collab] [--spec SPEC-xxx] ...
maestro-roadmap                7        —            <requirement> [--mode light|full] [-y...

Total: 51 skills
```

### 设置参数默认值

```bash
# 全局设置
maestro config set maestro-execute auto-commit true -g
maestro config set maestro-execute method auto -g
maestro config set maestro-execute y true -g

# 项目级设置（覆盖全局）
maestro config set maestro-plan auto true
```

> 参数名无需 `--` 前缀，CLI 自动补全（单字符加 `-`，其余加 `--`）。

### 查看当前配置

```bash
# 查看所有已配置的 skill
maestro config show

# 查看特定 skill
maestro config show maestro-execute

# JSON 格式输出
maestro config show --json
```

### 移除参数默认值

```bash
# 移除单个参数
maestro config unset maestro-execute method -g

# 清除某个 skill 的全部配置
maestro config reset maestro-execute -g

# 清除所有 skill 配置
maestro config reset -g
```

---

## TUI 交互界面

```bash
# 启动仪表盘
maestro config

# 直接编辑某个 skill
maestro config edit maestro-execute
```

### 仪表盘

```
╭─────────────────────────────────────╮
│ MAESTRO SKILL CONFIG                │
│                                     │
│ Commands discovered:    51          │
│ Skills with defaults:   3           │
│ Hook (skill-context):   installed   │
│                                     │
│ Configured:                         │
│   ✓ maestro-execute      3 params   │
│   ✓ maestro-plan         1 param    │
│                                     │
│ [1] Skills  [2] Config Sources      │
│   [q] Quit                          │
╰─────────────────────────────────────╯
```

### 参数编辑器

```
参数配置: maestro-execute
hint: [phase] [--auto-commit] [--method agent|codex|gemini|cli|auto] [--executor <tool>] [-y]

▸ --auto-commit    [x] true       (boolean)
  --method         auto           (agent|codex|gemini|cli|auto)
  --executor       <not set>      (string)
  -y               [ ] false      (boolean)

[↑↓] 导航  [Space] 切换/循环  [Enter] 编辑  [d] 删除  [Esc] 返回
```

操作方式：
- **Boolean 参数**：`Space` 切换 true/false
- **Enum 参数**：`Space` 循环选项
- **String/Number 参数**：`Enter` 进入文本输入模式
- **保存时选择作用域**：`[g]` 全局 / `[p]` 项目

---

## Hook 注入机制

### 工作原理

`skill-context` hook 在 `UserPromptSubmit` 事件触发时：

1. **匹配 skill 名称** — 先尝试硬编码模式（带 phase 号提取），再用通用正则 `/command-name` 兜底
2. **加载配置** — 读取全局 + 项目级 `skill-config.json`，深度合并
3. **冲突检测** — 检查用户 prompt 中是否已包含某参数，已显式指定的跳过
4. **生成注入** — 通过 `additionalContext` 输出默认值（不修改用户输入）

### 注入示例

用户输入 `/maestro-execute 3`，已配置 `--auto-commit: true, --method: auto, -y: true`：

```
## Skill Config Defaults (maestro-execute)
The following parameter defaults are configured. Apply these unless the user explicitly specified otherwise:
--auto-commit: true
--method: auto
-y: true
```

用户输入 `/maestro-execute 3 --method cli`，`--method` 自动跳过：

```
## Skill Config Defaults (maestro-execute)
The following parameter defaults are configured. Apply these unless the user explicitly specified otherwise:
--auto-commit: true
-y: true
```

### 注入方式

使用 `additionalContext`（通知性），**不使用** `updatedInput`（破坏性）。这意味着：
- 不会修改用户的原始输入
- LLM 以 context 形式接收默认值
- 用户显式参数自然优先

---

## 常用配置示例

### 开发模式（自动提交 + 跳过确认）

```bash
maestro config set maestro-execute auto-commit true -g
maestro config set maestro-execute y true -g
maestro config set maestro-execute method auto -g
```

### 审查模式（深度审查）

```bash
maestro config set quality-review level deep -g
```

### 规划模式（自动 + 协作）

```bash
maestro config set maestro-plan auto true -g
maestro config set maestro-plan collab true
```

### 分析模式（静默）

```bash
maestro config set maestro-analyze y true -g
maestro config set maestro-analyze c true -g
```

---

## 注意事项

1. **Hook 必须安装** — 配置只是写入 JSON 文件，注入依赖 `skill-context` hook。使用 `maestro hooks status` 确认
2. **参数名匹配** — 注入基于字符串包含检测，参数名需与 `argument-hint` 一致
3. **位置参数不可配置** — `[phase]`、`<path>` 等位置参数不会出现在 TUI 编辑器中，需每次手动传入
4. **项目级配置不追踪** — `.maestro/skill-config.json` 通常在 `.gitignore` 中，不同开发者可有不同配置

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
