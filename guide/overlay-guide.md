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

---

## Workflow Composer & Player

Maestro 提供 Composer + Player 组合，将自然语言描述转化为可复用的工作流模板，反复执行。

### 概念

| 概念 | 说明 |
|------|------|
| **模板 (Template)** | 保存在 `~/.maestro/templates/workflows/<slug>.json` 的 DAG 定义 |
| **节点 (Node)** | 模板中的一个执行单元：skill / cli / agent / checkpoint |
| **检查点 (Checkpoint)** | 自动插入的状态保存节点，支持暂停/恢复 |
| **变量 (Variable)** | 每次执行时不同的输入参数，如 `{goal}`、`{scope}` |
| **会话 (Session)** | Player 的一次执行实例，状态持久化以支持中断恢复 |

### Composer：设计模板

`/maestro-composer` 通过 5 个阶段将自然语言转化为模板，每个阶段都有交互确认。

#### 基本用法

```bash
# 用自然语言描述工作流
/maestro-composer "先分析代码架构，然后制定计划，实现功能，最后测试和审查"

# 恢复中断的设计
/maestro-composer --resume

# 编辑已有模板
/maestro-composer --edit ~/.maestro/templates/workflows/feature-plan-test.json
```

#### 5 阶段交互流程

```
Phase 1: Parse ─── 提取步骤 + 变量 + 任务类型
  ↓ [用户确认: 步骤是否正确?]
Phase 2: Resolve ─ 映射每个步骤到具体执行器
  ↓ [用户确认: 执行器选择是否合适?]
Phase 3: Enrich ── 自动注入检查点 + 构建 DAG
  ↓
Phase 4: Confirm ─ 展示完整管线图，支持编辑
  ↓ [用户确认: 最终管线是否满意?]
Phase 5: Persist ─ 保存模板到全局目录
```

#### 步骤到执行器的映射

用户的自然语言描述会被解析为步骤，每个步骤自动映射到已有的 maestro 命令：

| 用户表达 | 映射执行器 |
|----------|-----------|
| "分析"、"审查"、"探索" | `maestro delegate` (CLI 分析) |
| "计划"、"设计"、"规格" | `maestro-plan` |
| "实现"、"开发"、"构建" | `maestro-execute` |
| "测试"、"验证" | `quality-test` |
| "审查代码" | `quality-review` |
| "头脑风暴" | `maestro-brainstorm` |
| "重构" | `quality-refactor` |
| "调试" | `quality-debug` |

完整映射参见 `~/.maestro/templates/workflows/specs/node-catalog.md`。

#### 管线可视化

Phase 4 显示完整的 ASCII 管线图供确认：

```
Pipeline: feature-plan-test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 N-001  [skill]       maestro-plan              "{goal}"
   |
 CP-01  [checkpoint]  After Plan                auto-continue
   |
 N-002  [skill]       maestro-execute           {phase}
   |
 CP-02  [checkpoint]  Before Tests              pause-for-user
   |
 N-003  [skill]       quality-test              {phase}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Variables (required):  goal
Checkpoints:           2  (1 auto, 1 pause)
```

在此界面可以：编辑节点、添加/删除步骤、重命名模板、重新注入检查点。

#### 检查点自动注入规则

Composer 在以下边界自动插入检查点节点：

- 产出制品后（plan、spec、analysis 等）
- 执行类节点前
- Agent 类节点前
- 长时间运行的节点前（maestro-plan、maestro-spec-generate）
- 测试完成后
- 用户显式指定的暂停点

#### 渐进式加载

Composer 使用延迟加载（deferred reading）减少上下文占用：

| 规格文件 | 加载时机 |
|----------|---------|
| `~/.maestro/templates/workflows/specs/node-catalog.md` | Phase 2 解析执行器时 |
| `~/.maestro/templates/workflows/specs/template-schema.md` | Phase 5 生成模板时 |

如规格文件不存在，使用命令内置的默认映射表。

---

### Player：执行模板

`/maestro-player` 加载模板 → 绑定变量 → 按拓扑顺序执行节点 → 在检查点保存状态。

#### 基本用法

```bash
# 列出可用模板
/maestro-player --list

# 执行模板（交互式收集缺失变量）
/maestro-player feature-plan-test --context goal="实现用户认证"

# 预览执行计划（不执行）
/maestro-player feature-plan-test --context goal="..." --dry-run

# 恢复中断的执行
/maestro-player -c

# 恢复指定会话
/maestro-player -c player-20260426-143022
```

#### 执行机制

Player 根据节点类型选择执行方式：

| 节点类型 | Claude Code 版本 | Codex 版本 |
|---------|-----------------|-----------|
| skill | `Skill(skill=..., args=...)` | `spawn_agents_on_csv` |
| cli | `maestro delegate` (后台) | `spawn_agents_on_csv` |
| agent | `Agent(subagent_type=...)` | `spawn_agents_on_csv` |
| checkpoint | 内联状态保存 + 可选暂停 | 内联状态保存 + 可选暂停 |

#### 变量绑定

模板中的 `{variable}` 占位符在执行时被替换：

```bash
# 通过 --context 绑定
/maestro-player my-template --context goal="实现 OAuth" --context scope="src/auth"

# 未提供的必需变量会交互式询问
```

#### 运行时引用

节点之间通过引用传递上下文，Player 在执行前自动解析：

| 引用 | 含义 |
|------|------|
| `{goal}` | 用户绑定的上下文变量 |
| `{N-001.session_id}` | N-001 节点产生的 session ID |
| `{N-001.output_path}` | N-001 节点的输出文件路径 |
| `{prev_session_id}` | 上一个非检查点节点的 session ID |

#### 会话跟踪

**Claude Code 版本**：
```
.workflow/.maestro/player-<YYYYMMDD>-<HHmmss>/
├── status.json        # 主状态文件（与 maestro.md 兼容）
├── checkpoints/       # 检查点快照
│   ├── CP-01.json
│   └── CP-02.json
└── artifacts/
```

**Codex 版本**：
```
.workflow/.maestro/MCP-<YYYYMMDD>-<HHmmss>/
├── state.json         # 主状态文件（与 maestro codex 兼容）
├── wave-1.csv         # 每波 CSV 输入
├── wave-1-results.csv # 每波结果
├── checkpoints/
└── artifacts/
```

#### Codex 波次执行

Codex 版本使用 `spawn_agents_on_csv` 的波次模型：

- **屏障节点** (barrier)：单独执行，协调器执行后读取产物更新上下文
- **非屏障节点**：合并到同一波次并行执行

```
Wave Plan:
  [W1] N-001 maestro-plan    "{goal}"      [BARRIER]
  [W2] N-002 maestro-execute {phase}       [BARRIER]
  [W3] N-003 quality-test    {phase}
       N-004 quality-review  {phase}       ← 并行执行
```

#### 检查点与暂停

- `auto_continue: true` → 自动保存状态并继续
- `auto_continue: false` → 暂停并询问用户：继续 / 暂停（可恢复） / 中止

暂停后使用 `/maestro-player -c` 从最后的检查点恢复。

#### 错误处理

节点失败时按 `on_fail` 策略处理：

| on_fail | 行为 |
|---------|------|
| `abort` | 询问用户：重试 / 跳过 / 中止 |
| `skip` | 标记跳过，继续下一节点 |
| `retry` | 重试一次，仍失败则中止 |

---

### Composer + Player 工作流示例

#### 1. 创建一个"功能开发全流程"模板

```bash
/maestro-composer "分析代码架构，制定实现计划，执行开发，运行测试，代码审查"
```

交互流程产出模板 `feature-full-lifecycle.json`，包含 5 个工作节点 + 自动注入的检查点。

#### 2. 在不同项目中反复使用

```bash
# 项目 A
/maestro-player feature-full-lifecycle --context goal="实现支付模块"

# 项目 B
/maestro-player feature-full-lifecycle --context goal="添加通知系统"
```

#### 3. 迭代优化模板

```bash
# 编辑现有模板（增加安全审计步骤）
/maestro-composer --edit ~/.maestro/templates/workflows/feature-full-lifecycle.json
```

#### 4. 查看所有模板

```bash
/maestro-player --list
```

输出：
```
Available workflow templates:
  feature-full-lifecycle  [feature, complex]   5 work nodes, 4 checkpoints
  quick-bugfix            [bugfix, simple]     2 work nodes, 1 checkpoint
  tdd-cycle               [tdd, medium]        4 work nodes, 3 checkpoints
```
