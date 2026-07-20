---
title: "Maestro Ralph 自适应生命周期引擎指南"
icon: "🤖"
---

闭环决策引擎 — 读取项目状态，推断生命周期位置，构建自适应命令链，decision 节点动态扩展/收缩链。

---

## 定位

Maestro Ralph 是 Maestro Flow 的**全自动推进引擎**：

1. 读取项目状态，自动推断当前生命周期位置
2. 构建从当前位置到目标的完整命令链
3. 在关键检查点插入 **decision 节点**，动态调整链
4. 失败时自动插入 debug → fix → 重试循环

**活链**：链在执行过程中可以增长/收缩。与 [Maestro](./maestro-coordinator-guide.md) 的区别：

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **链类型** | 静态链，确定后不变 | 活链，decision 节点动态扩展 |
| **循环** | 无 | 闭环（失败 → debug → fix → 重试） |
| **Decision 节点** | 无 | post-verify、post-review、post-test、post-milestone |
| **适用场景** | 单次任务、明确意图 | 完整 milestone 生命周期推进 |

---

## 使用方式

```bash
/maestro-ralph "实现用户认证系统"     # 新会话
/maestro-ralph continue              # 恢复执行
/maestro-ralph -y "implement auth"   # 全自动模式
/maestro-ralph status                # 查看进度
```

### Ralph CLI 子命令（v0.4.16+）

除 slash 命令外，Ralph 还提供终端 CLI 子命令族：

```bash
maestro ralph session              # 列出活跃 ralph session
maestro ralph skills [--platform]  # 列出可用 skill（支持 --platform claude|codex 过滤）
maestro ralph next                 # 加载下一步并注入 skill config defaults
maestro ralph check                # 检查当前 step 状态
maestro ralph complete N --status DONE  # 标记 step 完成
```

| 子命令 | 功能 | 使用场景 |
|--------|------|----------|
| `session` | 列出活跃 session 及状态 | 查看当前运行的 ralph 会话 |
| `skills` | 扫描 `.claude/commands/` 和 `.codex/skills/` 中可用 skill | 调试 skill 发现问题 |
| `next` | 加载下一步的 SKILL.md 并注入 config defaults | ralph-execute 内部调用 |
| `check` | 查询当前 step 执行状态 | 监控进度 |
| `complete` | 标记 step 完成并写入 emit 结果 | ralph-execute 内部调用 |

### 双平台 Skill 支持（v0.4.17+）

Ralph 支持扫描两个平台的 skill 目录：

| 平台 | Skill 目录 | Session 标识 |
|------|-----------|-------------|
| Claude | `.claude/commands/` | `platform: "claude"` |
| Codex | `.codex/skills/` | `platform: "codex"` |

`maestro ralph skills --platform codex` 可过滤只显示 codex 平台 skill。Session JSON 新增 `platform` 和 `cli_tool` 字段标识来源平台。

### Skill Defaults 注入（v0.4.17+）

`maestro ralph next` 加载 step 的 SKILL.md 时，自动注入 `skill-config.json` 中的默认参数。用户无需每次手动指定常用 flag：

```json
// .workflow/skill-config.json
{
  "maestro-ralph": { "auto_commit": true },
  "maestro-next": { "suggest": true }
}
```

### Emit 格式（v0.4.16+）

`A_EXEC_STEP` 输出精简为纯指令格式，不再包含冗余解释性说明。ralph-execute 输出 step 结果时使用统一的 emit 格式，便于下游消费和 session 恢复。

---

## 三种节点类型

| 类型 | 执行方式 | 说明 |
|------|----------|------|
| **skill** | `Skill()` 同步调用 | 实际命令执行（plan、execute、review 等） |
| **cli** | `maestro delegate` 后台 | CLI 委派执行 |
| **decision** | Ralph 重新评估 | 读取执行结果，决定继续或插入修复循环 |

---

## 生命周期阶段

<details>
<summary>完整流程图</summary>

```
brainstorm → init → roadmap → analyze → plan → execute
    (0→1)                                        ↓
                                              verify
                                                ↓
                                        ◆ post-verify
                                                ↓
                                      business-test (full)
                                                ↓
                                      ◆ post-business-test
                                                ↓
                                            review
                                                ↓
                                        ◆ post-review
                                                ↓
                                          test-gen + test
                                                ↓
                                          ◆ post-test
                                                ↓
                                        session-seal
                                                ↓
                                      ◆ post-milestone
                                          ↓        ↓
                                    下一个 M     全部完成
```

每个 `◆` 是一个 decision 节点。非 `-y` 模式下暂停等待 `continue`。

</details>

---

## Decision 节点详解

| 节点 | 读取文件 | 通过 | 失败处理 |
|------|----------|------|----------|
| **post-verify** | `verification.json` | 继续 | 插入 debug → plan --gaps → execute → verify 循环 |
| **post-review** | `review.json` | PASS/WARN 继续 | BLOCK → 插入 fix 循环 |
| **post-test** | `uat.md` + `test-results.json` | 全部通过 | 轻量重跑未通过的质量门 |
| **post-milestone** | `state.json` | 有下一个 M → 插入完整链 | 全部完成 → session 结束 |
| **post-debug-escalate** | — | — | 达到最大重试，暂停等人工介入 |

---

## 质量管线模式

| 模式 | 质量步骤 | 触发条件 |
|------|----------|----------|
| `full` | verify → business-test → review → test-gen → test | 有 REQ-*.md 且 phase scope |
| `standard` | verify → review → test（test-gen 按覆盖率条件） | 默认 |
| `quick` | verify → CLI-review（跳过 business-test、test-gen、test） | 用户指定 |

`session.passed_gates[]` 记录已通过的质量门。重试时已通过且代码未变的门跳过，代码修改后清除受影响的门重新执行。

---

## Session 文件

存储位置：`.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`

<details>
<summary>JSON Schema 示例</summary>

```json
{
  "session_id": "ralph-20260503-143022",
  "source": "ralph",
  "platform": "claude",
  "cli_tool": "claude",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "ralph-lifecycle",
  "task_type": "lifecycle",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "quality_mode": "standard",
  "passed_gates": ["verify"],
  "lifecycle_position": "plan",
  "target": "session-seal",
  "steps": [
    { "index": 0, "type": "skill", "skill": "maestro-next", "args": "<plan intent>", "status": "completed" },
    { "index": 1, "type": "skill", "skill": "maestro-ralph", "args": "continue", "status": "completed" },
    { "index": 2, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}", "status": "running" },
    { "index": 3, "type": "skill", "skill": "maestro-ralph", "args": "--engine swarm --script wf-review", "status": "pending" }
  ],
  "current_step": 2
}
```

**Step types**：`"skill"` 实际命令 / `"cli"` CLI delegate / `"decision"` Ralph 决策评估（Ralph 独有）

</details>

---

## 执行流程

| 模式 | 流程 |
|------|------|
| **新会话** | 读取 state.json → 推断位置 → 构建 steps[] → 确认 → 执行 |
| **恢复** | 发现 running session → 读取结果 → 评估 → 可能插入 fix 循环 → 继续 |
| **`-y` 全自动** | 构建链 → 执行 → decision 自动评估 → 继续（或 escalate 暂停） |

---

## 生命周期位置推断

| 条件 | 推断位置 |
|------|----------|
| 无 `.workflow/` | `brainstorm`（空项目）或 `init`（有代码） |
| 有 state.json，无 milestones | `roadmap` |
| 有 milestones，无 artifacts | `analyze` |
| 最新 artifact type == analyze | `plan` |
| 最新 artifact type == plan | `execute` |
| 最新 artifact type == execute | `verify` |
| verify 通过 | `post-verify`（按 quality_mode 决定后续） |
| verify 失败 | `verify-failed`（插入 fix 循环） |

---

## 统一执行器

Maestro 和 Ralph 共用 `/maestro-ralph continue`：

- **skill 节点**：`Skill()` 同步调用，完成后自动执行下一步
- **cli 节点**：`maestro delegate` 后台执行，等待回调后继续
- **decision 节点**：回调 `maestro-ralph` 评估（仅 Ralph session）

Maestro session 无 decision 节点，纯顺序执行。

---

## 最大重试与升级

每个 decision 节点携带 `retry_count` 和 `max_retries`（默认 2）：

- **retry 0**：首次评估 → 失败 → 插入 fix 循环
- **retry 1**：第二次评估 → 仍失败 → 再次 fix
- **retry 2**：达到上限 → 升级到 `post-debug-escalate` → 暂停

升级后 session 状态变为 `paused`，用户处理后 `continue` 恢复。

---

## Ralph CLI — 委托执行模式

Ralph CLI 是 Ralph 的 **CLI 委托执行变体**。核心链路构建逻辑完全相同，但每步通过 `maestro delegate` 委托给外部 CLI 工具执行，而非在当前会话内联执行。

### 与标准 Ralph 的区别

| | Ralph | Ralph CLI |
|---|-------|-----------|
| **执行方式** | `maestro ralph next` + 内联执行 | `maestro delegate` 后台委托 |
| **上下文传递** | session_anchor 自动注入 | 10 段式提示词组装（A_COMPOSE_STEP_PROMPT） |
| **步间分析** | 直接读产物 | 每步完成后扫描 artifact + 提取信号 |
| **CLI 工具** | 固定当前平台 | 可选（`--to claude\|codex\|opencode\|agy`，默认 claude） |
| **Session 前缀** | `ralph-{ts}` | `ralph-cli-{ts}` |

### 使用方式

```bash
/maestro-ralph "重构认证模块"                # 默认 Claude 执行
/maestro-ralph --to codex "implement auth"   # 指定 Codex 执行
/maestro-ralph -y "implement auth"           # 全自动模式
/maestro-ralph continue                      # 恢复执行
/maestro-ralph status                        # 查看进度
```

### 提示词组装引擎

每步委托前，A_COMPOSE_STEP_PROMPT 组装包含 10 个段落的结构化提示词：

```
PURPOSE  — stage 目标 + 成功标准
SESSION  — intent / phase / lifecycle / milestone
BOUNDARY — in_scope / out_of_scope / constraints / definition_of_done
ACTIVE GOALS — pending sub-goals 及完成条件
EXECUTION HISTORY — 最近 5 步的 summary / decisions / caveats（滑动窗口）
ACCUMULATED SIGNALS — 所有步骤的 caveats + deferred（全量聚合）
ARTIFACTS — stage 专属前序产物注入
TASK     — 具体执行指令
EXPECTED — 期望产出格式
CONSTRAINTS — boundary + execution_criteria
```

### 执行流程

```
maestro-ralph 构建链 → maestro-ralph continue 组装提示词 → maestro delegate 后台执行
                                                         ↓
                                                    STOP 等待 callback
                                                         ↓
                                              callback → 分析产物 → maestro ralph complete
                                                         ↓
                                              自调用下一步 → 循环
```

### Session 扩展字段

```json
{
  "execution_mode": "cli-delegate",
  "cli_tool": "claude",
  "steps": [{
    "delegate_exec_id": "exe-143025-a1b2",
    "delegate_mode": "write",
    "delegate_role": "implement",
    "cli_output_summary": "实现 12 个文件变更，通过内置验证",
    "artifacts_produced": ["verification.json"]
  }]
}
```

---

## Maestro 静态协调器

Maestro 协调器是 Ralph 的简化模式——静态 chain 选择器，一次性顺序执行，无 decision 节点。

### 定位

`/maestro` 是 Maestro Flow 的**意图路由入口**。它不自己执行任何 skill：

1. 解析用户意图（action + object + scope）
2. 读取项目状态（`.workflow/state.json`）
3. 从 40+ 命令链中选择最优链
4. 创建 session，交由 `/maestro-ralph continue` 统一执行器

**静态 chain**：链确定后不再变化。没有 decision 节点，没有闭环循环。一次性顺序执行。

| | Maestro（静态协调器） | Ralph（自适应引擎） |
|---|---------|---------------|
| **链类型** | 固定链，创建后不变 | 活链，decision 节点动态扩展/收缩 |
| **循环** | 无 | 闭环循环（失败 → debug → fix → 重试） |
| **适用场景** | 单次任务、明确意图 | 完整 milestone 推进 |

### 使用方式

```bash
/maestro "实现用户认证功能"     # 意图驱动
/maestro continue               # 基于状态自动推进
/maestro status                 # 查看项目仪表盘
```

| Flag | 说明 |
|------|------|
| `-y` | 自动模式：跳过确认，自动传播到下游命令 |
| `-c` | 恢复模式：从上次中断的 session 继续 |
| `--dry-run` | 只展示计划链，不执行 |
| `--exec auto\|cli\|internal` | 强制执行引擎 |
| `--super` | 超级模式：全自动交付 |

### 意图路由

Maestro 使用 `action x object` 矩阵进行语义路由：

| action | 触发语义 |
|--------|----------|
| `create` | 构建新功能、组件、spec |
| `fix` | 修复 bug、解决错误 |
| `analyze` | 分析、评估、调查 |
| `plan` | 设计方案、规划、分解 |
| `execute` | 实现、开发、编码 |
| `verify` | 验证目标 |
| `review` | 代码审查 |
| `test` | 运行/创建测试 |
| `debug` | 诊断、排查 |
| `refactor` | 重构、清理技术债 |
| `explore` | 头脑风暴、发散 |
| `manage` | CRUD/生命周期管理 |
| `continue` | 恢复、继续 |

### 路由示例

| 输入 | 路由 | 命令链 |
|------|------|--------|
| `"修正 README 拼写"` | companion | `/maestro-companion "修正 README 拼写"` |
| `"plan phase 2"` | plan | `/maestro-next "<plan intent>"` |
| `"debug auth crash"` | debug | `/maestro-odyssey --mode debug` |
| `"fix issue ISS-abc-001"` | issue-full | analyze → plan → execute → review → close |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm → plan → execute（verify 已并入 `/maestro-ralph` decision gate） |
| `"continue"` | state_continue | 基于项目状态自动推断 |

### 命令链

**单步链**

| 链名 | 命令 |
|------|------|
| `analyze` | `/maestro-ralph --engine swarm --script wf-analyze "{phase}"` |
| `plan` | `/maestro-next "<plan intent> {phase}"` |
| `execute` | `/maestro-ralph continue` |
| `verify` | （已退役；集成进 `/maestro-ralph` decision gate） |
| `review` | `/maestro-ralph --engine swarm --script wf-review "{phase}"` |
| `test` | `/maestro "<test intent> {phase}"` 或 `/security-audit` |
| `debug` | `/maestro-odyssey --mode debug "{description}"` |
| `companion` | `/maestro-companion "{description}"` |

**多步链**

| 链名 | 步骤 | 场景 |
|------|------|------|
| `full-lifecycle` | plan → execute → review → test → audit（verify 已并入 `/maestro-ralph` decision gate） | 完整 milestone |
| `roadmap-driven` | init → roadmap → plan → execute（verify 已并入） | 从需求开始 |
| `brainstorm-driven` | brainstorm → plan → execute（verify 已并入） | 从探索开始 |
| `execute-verify` | execute（verify 已并入） | 规划完成后恢复 |
| `review-fix` | plan --gaps → execute → review | 修复 review 问题 |
| `issue-full` | analyze → plan → execute → review → close | Issue 闭环 |
| `milestone-close` | `/maestro-session-seal` | 关闭 milestone |

### 状态推断（continue 模式）

| 当前状态 | 推断链 |
|----------|--------|
| 未初始化 | `init` |
| 有 roadmap，目标 phase 无 artifact | `analyze` |
| 最新 artifact 是 analyze | `plan` |
| 最新是 plan | `execute`（verify 已并入） |
| verify 通过，无 review | `review` |
| UAT 通过 | `milestone-close` |
| 所有 phase 完成 | `milestone-close` |

### `-y` 自动模式传播

| 命令 | Flag | 效果 |
|------|------|------|
| maestro-init | `-y` | 跳过交互提问 |
| `/maestro-ralph --engine swarm --script wf-analyze` | `-y` | 跳过交互 scoping |
| `/maestro-next` | `-y` | 跳过确认和澄清 |
| `/maestro-ralph continue` | `-y` | 跳过确认，blocked 自动继续 |
| `/maestro "<test intent>"` 或 `/security-audit` | `-y --auto-fix` | 自动触发 gap-fix loop |
| `/maestro-session-seal` | `-y` | 跳过 knowledge promotion |
