---
title: "Overlay 系统指南"
---

Maestro 的 Overlay 系统提供非侵入式命令扩展 —— 不修改原始 `.claude/commands/*.md` 文件，注入自定义步骤、阅读要求、质量门禁等内容。Overlay 在每次 `maestro install` 时自动重新应用。

---

## 核心概念

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
| `append` | 在 section 闭合标签前追加 |
| `prepend` | 在 section 开始标签后插入 |
| `replace` | 替换整个 section 内容 |
| `new-section` | 创建新 XML section（通过 `afterSection` 控制位置） |

---

## 注入机制

Patcher 用 HTML 注释标记包裹注入内容：

```markdown
<!-- maestro-overlay:cli-verify#1 hash=a3f8b2c1 -->
## CLI Verification (overlay)
...
<!-- /maestro-overlay:cli-verify#1 -->
```

- `cli-verify` — overlay 名称，`#1` — patch 索引，`hash` — 内容 SHA-256 短哈希（用于变更检测）

**幂等性**：apply 时检查标记是否存在。哈希一致则跳过，哈希不同则先剥离再重新注入。

---

## 命令参考

```bash
# 查看 overlay（交互式 TUI）
maestro overlay list

# 应用所有 overlay（幂等）
maestro overlay apply

# 添加并应用
maestro overlay add <file.json>

# 导出/移除
maestro overlay export <name>
maestro overlay remove <name>

# Bundle 打包与导入
maestro overlay bundle -o team-overlays.json
maestro overlay import-bundle team-overlays.json
```

### Bundle 格式

```json
{
  "version": "1.0",
  "overlays": [
    { "name": "cli-verify", "targets": [...], "patches": [...] }
  ],
  "docs": {
    "verify-protocol.md": "# Verify Protocol\n\n..."
  }
}
```

打包时自动收集 patch content 中 `@~/.maestro/overlays/docs/<name>` 引用的文档。

---

## 交互式管理 TUI

运行 `maestro overlay list` 进入终端 UI，支持 `[d] Delete` 和 `[q] Quit` 操作。Section map 按目标命令文件分组，patch 按 overlay 名称聚合显示。

---

## 创建 Overlay

```bash
# 自然语言创建
/maestro-overlay "在 maestro-execute 执行后增加 CLI 代码质量验证"

# 手动创建
# 1. 编写 overlay JSON 文件
# 2. maestro overlay add <file.json>
# 3. maestro overlay list 验证
```

---

## 最佳实践

**命名**：描述性 kebab-case（`cli-verify-after-execute`），体现"做什么"而非"改哪里"

**内容**：注入标题带 `(overlay)` 后缀，保持精简，引用外部文档用 `@~/.maestro/overlays/docs/`

**优先级**：`10-30` 基础设施、`40-60` 标准步骤、`70-90` 后置检查

**团队协作**：`bundle` / `import-bundle` 分享，项目级 overlay 放版本控制

---

## Workflow Composer & Player

Composer + Player 将自然语言描述转化为可复用的工作流模板，反复执行。

### Composer：设计模板

```bash
/maestro-composer "先分析代码架构，然后制定计划，实现功能，最后测试和审查"
/maestro-composer --resume                              # 恢复中断的设计
/maestro-composer -- edit ~/.maestro/templates/workflows/feature-plan-test.json  # 编辑
```

5 阶段交互：Parse → Resolve → Enrich → Confirm → Persist

<details>
<summary>步骤到执行器的映射</summary>

| 用户表达 | 映射执行器 |
|----------|-----------|
| "分析"、"审查"、"探索" | `maestro delegate` |
| "计划"、"设计" | `maestro-plan` |
| "实现"、"开发" | `maestro-execute` |
| "测试"、"验证" | `quality-test` |
| "审查代码" | `quality-review` |

</details>

<details>
<summary>检查点自动注入规则</summary>

- 产出制品后（plan、spec、analysis 等）
- 执行类节点前
- Agent 类节点前
- 长时间运行的节点前
- 测试完成后
- 用户显式指定的暂停点

</details>

### Player：执行模板

```bash
/maestro-player --list                                  # 列出可用模板
/maestro-player feature-plan-test --context goal="实现用户认证"  # 执行
/maestro-player feature-plan-test --context goal="..." --dry-run  # 预览
/maestro-player -c                                      # 恢复中断的执行
```

| 节点类型 | 执行方式 |
|---------|---------|
| skill | `Skill(skill=..., args=...)` |
| cli | `maestro delegate`（后台） |
| agent | `Agent(subagent_type=...)` |
| checkpoint | 内联状态保存 + 可选暂停 |

**变量绑定**：`--context goal="..." scope="..."`，未提供的必需变量会交互式询问

**运行时引用**：`{goal}` 用户变量、`{N-001.session_id}` 上游节点输出、`{prev_session_id}` 上一个节点

<details>
<summary>会话跟踪与错误处理</summary>

**会话目录**：`.workflow/.maestro/player-<YYYYMMDD>-<HHmmss>/`（status.json, checkpoints/, artifacts/）

**Codex 版本**：使用 `spawn_agents_on_csv` 波次模型，屏障节点单独执行，非屏障节点并行

**错误处理**：
| on_fail | 行为 |
|---------|------|
| `abort` | 询问用户：重试/跳过/中止 |
| `skip` | 标记跳过，继续 |
| `retry` | 重试一次，仍失败则中止 |

</details>

### 示例

```bash
# 1. 创建模板
/maestro-composer "分析架构 → 制定计划 → 执行开发 → 测试 → 审查"

# 2. 在不同项目中复用
/maestro-player feature-full-lifecycle --context goal="实现支付模块"
/maestro-player feature-full-lifecycle --context goal="添加通知系统"

# 3. 迭代优化
/maestro-composer --edit ~/.maestro/templates/workflows/feature-full-lifecycle.json
```
