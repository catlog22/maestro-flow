# Maestro Ralph 自适应生命周期引擎指南

闭环决策引擎 — 读取项目状态，推断生命周期位置，构建自适应命令链，decision 节点动态扩展/收缩链。

---

## 定位

Maestro Ralph 是 Maestro Flow 的**全自动推进引擎**。它的核心能力是：

1. 读取项目状态，自动推断当前生命周期位置
2. 构建从当前位置到目标（默认 milestone-complete）的完整命令链
3. 在关键检查点插入 **decision 节点**，根据实际执行结果动态调整链
4. 失败时自动插入 debug → fix → 重试循环，直到通过或达到最大重试次数

**活链**：链在执行过程中可以增长/收缩。Decision 节点重新评估执行结果，决定继续还是插入修复循环。

与 [Maestro](./maestro-coordinator-guide.md) 的区别：

| | Maestro | Maestro Ralph |
|---|---------|---------------|
| **链类型** | 静态链，确定后不变 | 活链，decision 节点动态扩展 |
| **循环** | 无 | 闭环（失败 → debug → fix → 重试） |
| **Decision 节点** | 无 | post-verify、post-review、post-test、post-milestone |
| **适用场景** | 单次任务、明确意图 | 完整 milestone 生命周期推进 |

---

## 使用方式

```bash
# 新会话 — 自动推断位置，构建链
/maestro-ralph "实现用户认证系统"

# 继续执行（decision 节点暂停后恢复）
/maestro-ralph continue

# 全自动模式（decision 节点自动评估，不暂停）
/maestro-ralph -y "implement auth"

# 查看当前会话进度
/maestro-ralph status
```

---

## 三种节点类型

| 类型 | 执行方式 | 说明 |
|------|----------|------|
| **skill** | `Skill()` 同步调用 / `spawn_agents_on_csv` | 实际命令执行（plan、execute、verify 等） |
| **cli** | `maestro delegate` 后台 | CLI 委派执行（轻量 review 等） |
| **decision** | Ralph 重新评估 | 读取执行结果文件，决定继续或插入修复循环 |

---

## 生命周期阶段

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
                                        milestone-audit
                                                ↓
                                      milestone-complete
                                                ↓
                                      ◆ post-milestone
                                          ↓        ↓
                                    下一个 M     全部完成
```

每个 `◆` 是一个 decision 节点。非 `-y` 模式下会暂停等待用户 `continue`。

---

## Decision 节点详解

### post-verify

读取 `verification.json`：
- **通过** → 继续
- **有 gaps** → 插入：`debug → plan --gaps → execute → verify → post-verify(retry+1)`
- **达到最大重试** → 升级到 `post-debug-escalate`（暂停，人工介入）

### post-review

读取 `review.json`：
- **PASS/WARN** → 继续
- **BLOCK** → 插入：`debug → plan --gaps → execute → review → post-review(retry+1)`

### post-test

读取 `uat.md` + `test-results.json`：
- **全部通过** → 继续
- **有失败** → 轻量重试：仅重跑 verify + 未通过的质量门

### post-milestone

读取 `state.json`：
- **有下一个 milestone** → 插入该 milestone 的完整生命周期链
- **全部完成** → session 自然结束

### post-debug-escalate（终端节点）

达到最大重试次数后触发：
- 暂停 session
- 显示：`◆ 已达最大重试次数，请人工介入`
- 用户处理后 `/maestro-ralph continue` 恢复

---

## 质量管线模式

| 模式 | 质量步骤 | 触发条件 |
|------|----------|----------|
| `full` | verify → business-test → review → test-gen → test | 有 REQ-*.md 且 phase scope |
| `standard` | verify → review → test（test-gen 按覆盖率条件） | 默认 |
| `quick` | verify → CLI-review（跳过 business-test、test-gen、test） | 用户指定 |

### passed_gates 机制

`session.passed_gates[]` 记录已通过的质量门。重试循环中：
- 已通过且代码未变的门 → 跳过
- 代码被修改后 → 清除受影响的门，重新执行

---

## Session 文件

### 存储位置

```
.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json
```

### 统一 JSON Schema

```json
{
  "session_id": "ralph-20260503-143022",
  "source": "ralph",
  "created_at": "ISO",
  "updated_at": "ISO",
  "intent": "implement user auth",
  "status": "running",
  "chain_name": "ralph-lifecycle",
  "task_type": "lifecycle",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "cli_tool": "gemini",
  "lifecycle_position": "plan",
  "target": "milestone-complete",
  "quality_mode": "standard",
  "passed_gates": ["verify"],
  "context": {
    "issue_id": null,
    "milestone_num": 1,
    "spec_session_id": null,
    "scratch_dir": null,
    "plan_dir": ".workflow/scratch/phases/01-auth/",
    "analysis_dir": ".workflow/scratch/phases/01-auth/",
    "brainstorm_dir": null
  },
  "steps": [
    { "index": 0, "type": "skill", "skill": "maestro-plan", "args": "1", "status": "completed" },
    { "index": 1, "type": "skill", "skill": "maestro-execute", "args": "1", "status": "completed" },
    { "index": 2, "type": "skill", "skill": "maestro-verify", "args": "1", "status": "completed" },
    { "index": 3, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}", "status": "running" },
    { "index": 4, "type": "skill", "skill": "quality-review", "args": "1", "status": "pending" }
  ],
  "waves": [],
  "current_step": 3
}
```

**Step types**：
- `"skill"` — 实际命令执行
- `"cli"` — CLI delegate 后台执行
- `"decision"` — Ralph 决策评估节点（Ralph 独有）

---

## 执行流程

### 新会话

```
/maestro-ralph "intent"
        ↓
  读取 state.json → 推断 lifecycle_position
        ↓
  构建 steps[]（含 decision 节点）
        ↓
  确认（-y 跳过）→ session 创建
        ↓
  maestro-ralph-execute（统一执行器）
        ↓
  step 0 → step 1 → ... → ◆ decision → 暂停
```

### 恢复/继续

```
/maestro-ralph continue
        ↓
  发现 running session → ◆ decision 节点
        ↓
  读取结果文件 → 评估 → 可能插入 fix 循环
        ↓
  maestro-ralph-execute → 继续下一个 step
```

### `-y` 全自动

```
/maestro-ralph -y "intent"
        ↓
  构建链 → 执行 → ◆ decision 自动评估 → 继续
        ↓                                 ↓
  step N → step N+1 → ... → ◆ 自动评估 → 继续
        ↓
  全部完成（或 post-debug-escalate 暂停）
```

---

## 生命周期位置推断

Ralph 从 state.json 的 artifact 链推断当前位置：

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

Maestro 和 Ralph 共用 `maestro-ralph-execute` 作为统一执行器：

- **session 发现**：扫描 `.workflow/.maestro/*/status.json`，找到最近的 running session
- **skill 节点**：`Skill()` 同步调用，完成后自动执行下一步
- **cli 节点**：`maestro delegate` 后台执行，等待回调后继续
- **decision 节点**：回调 `maestro-ralph` 进行评估（仅 Ralph session）

Maestro session 中不存在 decision 节点，执行器只处理 skill 和 cli 两种类型，纯顺序执行。

---

## 最大重试与升级

每个 decision 节点携带 `retry_count` 和 `max_retries`（默认 2）：

```
retry 0: 首次评估 → 失败 → 插入 fix 循环
retry 1: 第二次评估 → 仍失败 → 再次 fix
retry 2: 达到上限 → 升级到 post-debug-escalate → 暂停
```

升级后 session 状态变为 `paused`，用户手动处理后可 `continue` 恢复。
