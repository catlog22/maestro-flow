# Overlay 系统指南

Maestro 的 Overlay 系统提供非侵入式的命令扩展机制 —— 在不修改原始 `.claude/commands/*.md` 文件的前提下，注入自定义步骤、阅读要求、质量门禁等内容。Overlay 在每次 `maestro install` 时自动重新应用，确保扩展内容在安装升级后持久存在。

## 目录

- [核心概念](#核心概念)
- [Overlay 文件格式](#overlay-文件格式)
- [注入机制](#注入机制)
- [命令参考](#命令参考)
- [Bundle 打包与导入](#bundle-打包与导入)
- [交互式管理 TUI](#交互式管理-tui)
- [创建 Overlay 的工作流](#创建-overlay-的工作流)
- [最佳实践](#最佳实践)

---

## 核心概念

### 问题

`.claude/commands/*.md` 文件由 `maestro install` 管理。直接编辑这些文件会在下次安装时被覆盖。但用户经常需要：

- 在 `/maestro-execute` 后增加 CLI 验证步骤
- 为 `/maestro-plan` 增加必读文档
- 在 `/quality-review` 末尾添加质量门禁

### 解决方案

Overlay = 一个 JSON 文件，声明"在哪个命令的哪个 section 注入什么内容"。Patcher 使用 HTML 注释标记包裹注入内容，实现：

- **幂等性** —— 重复 apply 不会产生重复内容
- **可追溯** —— 标记清楚标注每段内容来自哪个 overlay
- **可逆性** —— `remove` 精确剥离标记内容，不影响其他部分

### 文件布局

```
~/.maestro/overlays/
├── cli-verify.json              # 用户 overlay
├── quality-gate.json            # 用户 overlay
├── docs/                        # overlay 引用的文档
│   └── verify-protocol.md
└── _shipped/                    # 随 maestro 发布的只读 overlay（不要编辑）
```

---

## Overlay 文件格式

```json
{
  "name": "cli-verify",
  "description": "Add CLI verification after execution",
  "targets": ["maestro-execute", "maestro-plan"],
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
| `name` | string | 是 | 唯一标识符，kebab-case（`/^[a-z0-9][a-z0-9-_]*$/`） |
| `description` | string | 否 | 人类可读的描述 |
| `targets` | string[] | 是 | 目标命令名（不含 `.md`），如 `["maestro-execute"]` |
| `priority` | number | 否 | 应用优先级，数值小的先应用（默认 50） |
| `enabled` | boolean | 否 | 设为 `false` 暂时禁用（默认 true） |
| `scope` | string | 否 | `"global"` / `"project"` / `"any"`（默认 any） |
| `docs` | string[] | 否 | 引用的文档路径列表 |
| `patches` | Patch[] | 是 | 补丁列表 |

### Patch 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `section` | string | 目标 XML section 名称 |
| `mode` | string | `"append"` / `"prepend"` / `"replace"` / `"new-section"` |
| `content` | string | 注入的 Markdown 内容 |
| `afterSection` | string | 仅 `new-section` 模式：新 section 插入在此 section 之后 |

### 可用 Section

命令文件的 XML section 标签：

| Section | 用途 |
|---------|------|
| `purpose` | 命令目的 |
| `required_reading` | 执行前必读 |
| `deferred_reading` | 延迟加载的参考资料 |
| `context` | 上下文和背景信息 |
| `execution` | 执行步骤 |
| `error_codes` | 错误代码处理 |
| `success_criteria` | 成功标准 |

### Mode 行为

| Mode | 行为 |
|------|------|
| `append` | 在 section 闭合标签前追加内容 |
| `prepend` | 在 section 开始标签后插入内容 |
| `replace` | 替换整个 section 的内容 |
| `new-section` | 创建新的 XML section（通过 `afterSection` 控制位置） |

---

## 注入机制

### 标记格式

Patcher 用 HTML 注释标记包裹每个 patch 的注入内容：

```markdown
<execution>
... 原有内容 ...

<!-- maestro-overlay:cli-verify#1 hash=a3f8b2c1 -->
## CLI Verification (overlay)

After execution, run:
...
<!-- /maestro-overlay:cli-verify#1 -->
</execution>
```

- `cli-verify` —— overlay 名称
- `#1` —— patch 在该 overlay 中的索引
- `hash=a3f8b2c1` —— patch 内容的 SHA-256 短哈希，用于变更检测

### 幂等性保证

每次 apply 时，patcher 先检查是否已存在相同标记。如果存在且哈希一致，跳过（unchanged）；如果哈希不同，先剥离旧标记再重新注入（changed）。

### 优先级排序

多个 overlay 作用于同一 section 时，按 `priority` 升序排列（数值小的先应用，后追加的在前面追加的下方）。

---

## 命令参考

### 基本操作

```bash
# 查看所有 overlay 及 section map（交互式 TUI）
maestro overlay list

# 非交互模式（适用于管道/CI）
maestro overlay list --no-interactive

# 应用所有 overlay（幂等）
maestro overlay apply

# 添加单个 overlay 并立即应用
maestro overlay add <file.json>

# import 是 add 的别名
maestro overlay import <file.json>

# 导出单个 overlay 到文件
maestro overlay export <name>
maestro overlay export <name> -o /path/to/output.json

# 移除 overlay（剥离标记 + 删除文件）
maestro overlay remove <name>
```

### Bundle 操作

```bash
# 打包所有 overlay 为单个 bundle 文件
maestro overlay bundle
maestro overlay bundle -o my-overlays.json

# 只打包指定的 overlay
maestro overlay bundle -n cli-verify quality-gate

# 从 bundle 导入所有 overlay 并应用
maestro overlay import-bundle overlays-bundle.json
```

---

## Bundle 打包与导入

### 用途

Bundle 解决 overlay 的分享和迁移问题：

- **团队分享** —— 把项目团队的 overlay 配置打包给新成员
- **机器迁移** —— 在新机器上一键恢复所有 overlay
- **备份** —— overlay 和引用的 docs 一起打包，不遗漏

### Bundle 格式

```json
{
  "version": "1.0",
  "overlays": [
    { "name": "cli-verify", "targets": [...], "patches": [...] },
    { "name": "quality-gate", "targets": [...], "patches": [...] }
  ],
  "docs": {
    "verify-protocol.md": "# Verify Protocol\n\n...",
    "quality-gate-spec.md": "# Quality Gate\n\n..."
  }
}
```

- `overlays` —— 完整的 OverlayMeta 对象数组
- `docs` —— overlay 的 patch content 中通过 `@~/.maestro/overlays/docs/<name>` 引用的文档，自动收集打包

### 自动收集文档

打包时，系统扫描所有选中 overlay 的 patch content，提取 `@~/.maestro/overlays/docs/<filename>` 引用，自动将对应文件内容包含在 bundle 的 `docs` 字段中。导入时，这些文档恢复到 `~/.maestro/overlays/docs/` 目录。

### 工作流示例

```bash
# 机器 A：导出
maestro overlay bundle -o team-overlays.json
# → 生成包含 2 个 overlay + 1 个 doc 的 bundle

# 机器 B：导入
maestro overlay import-bundle team-overlays.json
# → 解包 overlay + docs → 自动 apply
```

---

## 交互式管理 TUI

运行 `maestro overlay list` 进入基于 [ink](https://github.com/vadimdemedes/ink) 的终端 UI：

```
Overlays

cli-verify  [enabled]  priority=50  applied[global]
    targets: maestro-execute, maestro-plan
    Add CLI verification after execution

quality-gate  [enabled]  priority=60  applied[global]
    targets: maestro-execute
    Quality gate for execution output

=== maestro-execute.md (2 overlays) ===
  [L5-L12]    <required_reading>
                 ├─ cli-verify (#0)  "verify-protocol.md ref"
  [L20-L85]   <execution>
                 ├─ cli-verify (#1)  "CLI Verification step"
                 ├─ quality-gate (#0)  "Quality gate check"
  [L86-L95]   <success_criteria>
                 ├─ quality-gate (#1)  "Pass rate criterion"

[d] Delete  [q] Quit
```

### 功能

| 快捷键 | 操作 |
|--------|------|
| `d` | 进入删除模式 —— 用方向键选择 overlay，Enter 确认删除 |
| `q` / `Esc` | 退出 |
| `↑` / `↓` | 在删除模式中切换选择 |
| `Enter` | 确认删除选中的 overlay |

### Section Map 说明

Section map 按**目标命令文件**分组，每个 section 显示行范围和其中包含的 overlay patch。Patch 按 **overlay 名称**分组（而非单独的 patch 编号），这样一个 overlay 的多个 patch 聚合显示，与删除操作（按 overlay 名称整体删除）对应。

---

## 创建 Overlay 的工作流

使用 `/maestro-overlay` 命令通过自然语言创建 overlay：

```bash
# 自然语言描述意图
/maestro-overlay "在 maestro-execute 执行后增加 CLI 代码质量验证"

# 交互流程：
# 1. 解析意图 → 确认目标命令和注入位置
# 2. 预览注入点（显示现有 overlay 和 >>> NEW 标记）
# 3. 可选配置 Skill Chain（执行后自动跳转到其他命令）
# 4. 生成 overlay JSON 并通过 maestro overlay add 安装
# 5. 输出安装报告
```

### 手动创建

1. 编写 overlay JSON 文件
2. `maestro overlay add <file.json>` 安装并应用
3. `maestro overlay list` 验证

---

## 最佳实践

### 命名

- 使用描述性的 kebab-case 名称：`cli-verify-after-execute`，而非 `patch1`
- 名称应体现"做什么"而非"改哪里"

### 内容

- 注入内容的标题带 `(overlay)` 后缀，方便人类读者识别机器注入的内容
- 保持注入内容精简 —— overlay 应该"增加一个步骤"，而不是"重写整个命令"
- 引用外部文档用 `@~/.maestro/overlays/docs/` 路径，打包时会自动收集

### 优先级

- `10-30`：基础设施类（必读文档、前置条件）
- `40-60`：标准步骤（默认 50）
- `70-90`：后置检查、质量门禁

### 团队协作

- 使用 `bundle` / `import-bundle` 分享团队配置
- 项目级 overlay 放在版本控制中，通过 CI 中的 `maestro overlay import-bundle` 分发
- `_shipped/` 目录保留给 maestro 官方 overlay，不要手动编辑
