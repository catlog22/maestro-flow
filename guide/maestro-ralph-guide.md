---
title: "Maestro Ralph 自适应生命周期引擎指南"
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
maestro ralph skills               # 列出可用 skill
maestro ralph skills --platform codex  # 按平台过滤
maestro ralph next                 # 加载下一步（注入 skill defaults）
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
  "maestro-execute": { "auto_commit": true },
  "quality-review": { "dims": "bugs,security" }
}
```

### Emit 格式（v0.4.16+）

`A_EXEC_STEP` 输出精简为纯指令格式，不再包含冗余解释性说明。ralph-execute 输出 step 结果时使用统一的 emit 格式，便于下游消费和 session 恢复。

---

## 三种节点类型

| 类型 | 执行方式 | 说明 |
|------|----------|------|
| **skill** | `Skill()` 同步调用 | 实际命令执行（plan、execute、verify 等） |
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
                                        milestone-audit
                                                ↓
                                      milestone-complete
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
  "target": "milestone-complete",
  "steps": [
    { "index": 0, "type": "skill", "skill": "maestro-plan", "args": "1", "status": "completed" },
    { "index": 1, "type": "skill", "skill": "maestro-execute", "args": "1", "status": "completed" },
    { "index": 2, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}", "status": "running" },
    { "index": 3, "type": "skill", "skill": "quality-review", "args": "1", "status": "pending" }
  ],
  "current_step": 3
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

Maestro 和 Ralph 共用 `maestro-ralph-execute`：

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
