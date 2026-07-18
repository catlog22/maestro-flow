---
title: "Maestro 智能协调器指南"
icon: "🤖"
---

静态 chain 选择器 — 分析用户意图，读取项目状态，选择最优命令链，交由统一执行器顺序执行。

---

## 定位

Maestro 是 Maestro Flow 的**主入口**。它不自己执行任何 skill：

1. 解析用户意图（action + object + scope）
2. 读取项目状态（`.workflow/state.json`）
3. 从 40+ 命令链中选择最优链
4. 创建 session，交由 `/maestro-ralph continue` 统一执行器

**静态 chain**：链确定后不再变化。没有 decision 节点，没有闭环循环。一次性顺序执行。

与 [Maestro Ralph](./maestro-ralph-guide.md) 的区别：

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **定位** | 静态 chain 选择器 | 自适应生命周期引擎 |
| **链类型** | 固定链，创建后不变 | 活链，decision 节点动态扩展/收缩 |
| **循环** | 无 | 闭环循环（失败 → debug → fix → 重试） |
| **适用场景** | 单次任务、明确意图 | 完整 milestone 推进 |
| **执行器** | `/maestro-ralph continue`（统一） | `/maestro-ralph continue`（统一） |

---

## 使用方式

```bash
/maestro "实现用户认证功能"     # 意图驱动
/maestro continue               # 基于状态自动推进
/maestro status                 # 查看项目仪表盘
```

### 标志

| Flag | 说明 |
|------|------|
| `-y` | 自动模式：跳过确认，自动传播到下游命令 |
| `-c` | 恢复模式：从上次中断的 session 继续 |
| `--dry-run` | 只展示计划链，不执行 |
| `--exec auto\|cli\|internal` | 强制执行引擎 |
| `--super` | 超级模式：全自动交付 |

---

## 意图路由

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
| `"Add API endpoint"` | quick | `/maestro-next` |
| `"plan phase 2"` | plan | `/maestro-next "<plan intent>"` |
| `"debug auth crash"` | debug | `/odyssey --mode debug` |
| `"fix issue ISS-abc-001"` | issue-full | analyze → plan → execute → review → close |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm → plan → execute（verify 已并入 `/maestro-ralph` decision gate） |
| `"continue"` | state_continue | 基于项目状态自动推断 |

---

## 命令链

### 单步链

| 链名 | 命令 |
|------|------|
| `analyze` | `/maestro-ralph --engine swarm --script wf-analyze "{phase}"` |
| `plan` | `/maestro-next "<plan intent> {phase}"` |
| `execute` | `/maestro-ralph continue` |
| `verify` | （已退役；集成进 `/maestro-ralph` decision gate） |
| `review` | `/maestro-ralph --engine swarm --script wf-review "{phase}"` |
| `test` | `/maestro "<test intent> {phase}"` 或 `/security-audit` |
| `debug` | `/odyssey --mode debug "{description}"` |
| `quick` | `/maestro-next "{description}"` |

### 多步链

| 链名 | 步骤 | 场景 |
|------|------|------|
| `full-lifecycle` | plan → execute → review → test → audit（verify 已并入 `/maestro-ralph` decision gate） | 完整 milestone |
| `roadmap-driven` | init → roadmap → plan → execute（verify 已并入） | 从需求开始 |
| `brainstorm-driven` | brainstorm → plan → execute（verify 已并入） | 从探索开始 |
| `execute-verify` | execute（verify 已并入） | 规划完成后恢复 |
| `review-fix` | plan --gaps → execute → review | 修复 review 问题 |
| `issue-full` | analyze → plan → execute → review → close | Issue 闭环 |
| `milestone-close` | `/maestro-session-seal` | 关闭 milestone |

---

## Session 文件

存储位置：`.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`

<details>
<summary>JSON Schema 示例</summary>

```json
{
  "session_id": "maestro-20260503-143022",
  "source": "maestro",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "full-lifecycle",
  "task_type": "execute",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "exec_mode": "auto",
  "steps": [
    {
      "index": 0,
      "type": "skill",
      "skill": "maestro-next",
      "args": "<plan intent>",
      "status": "pending"
    }
  ],
  "current_step": 0
}
```

**Step type**：`"skill"` 当前会话内调用（轻量） / `"cli"` CLI delegate 后台执行（重量）

Maestro session **没有** `"decision"` 类型的 step — 与 Ralph 的核心区别。

</details>

---

## 执行流程

```
用户输入 → 意图解析 → chain 选择 → session 创建 → /maestro-ralph continue → 顺序执行
```

1. **意图解析**：提取 action、object、scope、phase_ref
2. **状态读取**：读取 `.workflow/state.json`
3. **链选择**：从 chainMap 选择命令链
4. **类型选择**：预计算 step type（auto：重量 → cli，轻量 → skill）
5. **Session 创建**：写入 status.json
6. **执行派发**：调用统一执行器

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

---

## `-y` 自动模式传播

启用 `-y` 后，Maestro 将 auto flag 传播到支持它的下游命令：

| 命令 | Flag | 效果 |
|------|------|------|
| maestro-init | `-y` | 跳过交互提问 |
| `/maestro-ralph --engine swarm --script wf-analyze` | `-y` | 跳过交互 scoping |
| `/maestro-next` | `-y` | 跳过确认和澄清 |
| `/maestro-ralph continue` | `-y` | 跳过确认，blocked 自动继续 |
| `/maestro "<test intent>"` 或 `/security-audit` | `-y --auto-fix` | 自动触发 gap-fix loop |
| `/maestro-session-seal` | `-y` | 跳过 knowledge promotion |

---

## 恢复执行

```bash
/maestro -c    # 从最近的 session 恢复
```

恢复模式跳过意图解析和链选择，直接从 status.json 中的下一个 pending step 继续执行。
