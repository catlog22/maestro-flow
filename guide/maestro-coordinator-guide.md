# Maestro 智能协调器指南

静态 chain 选择器 — 分析用户意图，读取项目状态，选择最优命令链，交由统一执行器顺序执行。

---

## 定位

Maestro 是 Maestro Flow 的**主入口**。它不自己执行任何 skill，而是：

1. 解析用户意图（action + object + scope）
2. 读取项目状态（`.workflow/state.json`）
3. 从 40+ 命令链中选择最优链
4. 创建 session，交由 `maestro-ralph-execute` 统一执行器

**静态 chain**：链确定后不再变化。没有 decision 节点，没有闭环循环。多步或单步，一次性顺序执行完毕。

与 [Maestro Ralph](./maestro-ralph-guide.md) 的区别：

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **定位** | 静态 chain 选择器 | 自适应生命周期引擎 |
| **链类型** | 固定链，创建后不变 | 活链，decision 节点可动态扩展/收缩 |
| **循环** | 无循环 | 闭环循环（失败 → debug → fix → 重试） |
| **适用场景** | 单次任务、快速执行、明确意图 | 完整 milestone 推进、质量管线、自动化闭环 |
| **执行器** | `maestro-ralph-execute`（统一） | `maestro-ralph-execute`（统一） |

---

## 使用方式

### 基本用法

```bash
# 在 Claude Code 中
/maestro "实现用户认证功能"
/maestro "fix login bug"
/maestro "run tests for phase 2"
/maestro continue              # 基于状态自动推进
/maestro status                # 查看项目仪表盘
```

### 标志

| Flag | 说明 |
|------|------|
| `-y` | 自动模式：跳过确认，自动传播到下游命令 |
| `-c` | 恢复模式：从上次中断的 session 继续 |
| `--dry-run` | 只展示计划链，不执行 |
| `--exec auto\|cli\|internal` | 强制执行引擎（默认 auto 按步自动选择） |
| `--super` | 超级模式：全自动交付完整软件系统 |

---

## 意图路由

Maestro 使用 `action x object` 矩阵进行语义路由：

### Action 枚举

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
| `"Add API endpoint"` | quick | `maestro-quick` |
| `"plan phase 2"` | plan | `maestro-plan 2` |
| `"debug auth crash"` | debug | `quality-debug` |
| `"fix issue ISS-abc-001"` | issue-full | analyze → plan → execute → review → close |
| `"brainstorm notifications"` | brainstorm-driven | brainstorm → plan → execute → verify |
| `"continue"` | state_continue | 基于项目状态自动推断 |

---

## 命令链

### 单步链

| 链名 | 命令 |
|------|------|
| `analyze` | `maestro-analyze {phase}` |
| `plan` | `maestro-plan {phase}` |
| `execute` | `maestro-execute {phase}` |
| `verify` | `maestro-verify {phase}` |
| `review` | `quality-review {phase}` |
| `test` | `quality-test {phase}` |
| `debug` | `quality-debug "{description}"` |
| `quick` | `maestro-quick "{description}"` |

### 多步链

| 链名 | 步骤 | 场景 |
|------|------|------|
| `full-lifecycle` | plan → execute → verify → review → test → audit | 完整 milestone |
| `roadmap-driven` | init → roadmap → plan → execute → verify | 从需求开始 |
| `brainstorm-driven` | brainstorm → plan → execute → verify | 从探索开始 |
| `execute-verify` | execute → verify | 规划完成后恢复 |
| `review-fix` | plan --gaps → execute → review | 修复 review 问题 |
| `issue-full` | analyze → plan → execute → review → close | Issue 闭环 |
| `milestone-close` | audit → complete | 关闭 milestone |

---

## Session 文件

### 存储位置

```
.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json
```

### 统一 JSON Schema

```json
{
  "session_id": "maestro-20260503-143022",
  "source": "maestro",
  "created_at": "ISO",
  "updated_at": "ISO",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "full-lifecycle",
  "task_type": "execute",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "exec_mode": "auto",
  "cli_tool": "claude",
  "lifecycle_position": null,
  "target": null,
  "quality_mode": null,
  "passed_gates": [],
  "context": {
    "issue_id": null,
    "milestone_num": null,
    "spec_session_id": null,
    "scratch_dir": null,
    "plan_dir": null,
    "analysis_dir": null,
    "brainstorm_dir": null
  },
  "steps": [
    {
      "index": 0,
      "type": "skill",
      "skill": "maestro-plan",
      "args": "1",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "error": null
    }
  ],
  "waves": [],
  "current_step": 0
}
```

**Step type**：
- `"skill"` — 当前会话内 Skill() 调用（轻量步骤：verify、review、test、manage-* 等）
- `"cli"` — CLI delegate 后台执行（重量步骤：plan、execute、analyze、brainstorm 等）

Maestro session **没有** `"decision"` 类型的 step — 这是与 Ralph 的核心区别。

---

## 执行流程

```
用户输入 → 意图解析 → chain 选择 → session 创建
                                        ↓
                              maestro-ralph-execute
                                        ↓
                          step 0 → step 1 → ... → 完成
```

1. **意图解析**：提取 action、object、scope、phase_ref
2. **状态读取**：读取 `.workflow/state.json`，感知项目进度
3. **链选择**：从 chainMap 选择命令链，交叉验证状态一致性
4. **类型选择**：每个 step 预计算 `type`（auto 模式下重量步骤 → cli，轻量 → skill）
5. **Session 创建**：写入 `.workflow/.maestro/` 下的 status.json
6. **执行派发**：调用 `maestro-ralph-execute`，统一执行器顺序处理每个 step

### 状态推断（continue 模式）

当输入 `continue`/`next` 时，Maestro 读取 state.json 推断下一步：

| 当前状态 | 推断链 |
|----------|--------|
| 未初始化 | `init` |
| 有 roadmap，目标 phase 无 artifact | `analyze` |
| 最新 artifact 是 analyze | `plan` |
| 最新是 plan | `execute-verify` |
| verify 通过，无 review | `review` |
| UAT 通过 | `milestone-close` |
| 所有 phase 完成 | `milestone-close` |

---

## `-y` 自动模式传播

启用 `-y` 后，Maestro 将 auto flag 传播到支持它的下游命令：

| 命令 | Flag | 效果 |
|------|------|------|
| maestro-init | `-y` | 跳过交互提问 |
| maestro-analyze | `-y` | 跳过交互 scoping |
| maestro-plan | `-y` | 跳过确认和澄清 |
| maestro-execute | `-y` | 跳过确认，blocked 自动继续 |
| quality-test | `-y --auto-fix` | 自动触发 gap-fix loop |
| maestro-milestone-complete | `-y` | 跳过 knowledge promotion |

未列出的命令不受影响，原样执行。

---

## 恢复执行

```bash
/maestro -c    # 从最近的 session 恢复
```

恢复模式跳过意图解析和链选择，直接从 status.json 中的下一个 pending step 继续执行。
