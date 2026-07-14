# maestro-ralph Codex V2 Optimization Strategy

## 已完成修复

### F1. agent_type 注入（已修复）

所有 `spawn_agent` 调用已补充 `agent_type: "ralph_executor"`，对应 `.codex/agents/ralph-executor.toml`（`name = "ralph_executor"`）。修复前 executor 以默认 agent 身份运行，不会加载 executor 的 developer_instructions。

---

## 现状诊断

### 当前 SKILL.md 架构

```
Claude maestro-ralph.md (1313 行，完整状态机 + 全部 actions)
        │
        ▼ "与 Claude 版本完全一致"
Codex SKILL.md (187 行，仅 dispatch 层替换)
```

**问题清单：**

| # | 问题 | 影响 |
|---|------|------|
| P1 | 不自包含——依赖交叉引用 Claude 版本 | agent 执行时无法获取完整指令，需人工查阅两份文件 |
| P2 | V2 独有能力未利用（send_message / followup_task / interrupt / list_agents） | 丧失 V2 的编排优势，沦为 API 翻译 |
| P3 | 并发模型闲置（max_concurrent = 4） | 独立步骤仍串行等待，wall-clock 时间浪费 |
| P4 | 缺少完整状态机定义 | 依赖外部文件推断行为，易出执行偏差 |
| P5 | 缺少 session schema / fix-loop templates / stage mapping | executor 无法独立完成步骤编排 |
| P6 | evaluate_via 三模式（agent/cli/dual）未适配 | 评估环节无法灵活选择评估通道 |
| P7 | engine 模式（swarm/universal）仅提及未展开 | 并行加速引擎无法在 Codex 平台使用 |

---

## 优化策略

### Strategy 1: 自包含重写（必做）

**目标**：SKILL.md 成为 Codex agent 的唯一执行指令，不再需要交叉引用 Claude 版本。

**做法**：
1. 将 Claude 版本的完整状态机（states + transitions）迁入，仅替换 dispatch 动词
2. 将全部 actions 迁入，适配 V2 原语
3. 将 session schema、fix-loop templates、stage mapping 迁入
4. 删除所有 "参考 Claude 版本" 的引用

**行数估算**：~800-1000 行（Claude 版 1313 行去掉 engine 部分约 900 行 + V2 适配增量）

**风险**：内容重复 → 两份文件可能分叉。缓解：将共享逻辑提取为 CLI 层（`maestro ralph` 子命令），两端仅调 CLI。

### Strategy 2: V2 原语深度集成（推荐）

**目标**：利用 V2 独有能力提升编排质量。

#### 2a. send_message → 增量上下文补充

当前 A_STEP_DISPATCH 将所有上下文一次性注入 `spawn_agent.message`。V2 允许在 executor 运行中追加上下文：

```
场景：executor 执行 execute step，主流程发现前一 review 刚完成并产出新 findings
动作：send_message({ target: task_name, message: "Review findings update: ..." })
```

**适用节点**：
- A_STEP_DISPATCH 后发现前序 step 有延迟产出（deferred artifacts）
- dual 评估模式中 CLI delegate 先于 agent 返回时，将 CLI 结果 send 给 agent

#### 2b. followup_task → 评估后续任务链

当前评估 agent 完成后由主流程解析 verdict 并插入 fix-loop。V2 允许向同一 agent 追加任务：

```
场景：post-execute 评估发现 FAIL → 需要 debug
动作：followup_task({ target: eval_agent, message: "现在分析失败原因..." })
```

**收益**：评估 agent 已加载所有 evidence 上下文，追加 debug 分析比 spawn 新 agent 更高效。

**限制**：仅适用于评估→分析的轻量链；执行类任务仍需 spawn 独立 executor。

#### 2c. interrupt_agent → 超时熔断

当前已在 SKILL.md 中定义但未融入状态机。需要：

1. 在 S_STEP_DISPATCH → S_STEP_ANALYZE 转换中增加 timeout 分支
2. interrupt 后将 step 标记为 BLOCKED + reason="executor_timeout"
3. 增加可配置的 per-stage timeout（analyze/plan 可能比 execute 短）

**Per-stage timeout 建议**：

| Stage | Timeout | 理由 |
|-------|---------|------|
| grill / brainstorm | 600,000 ms (10 min) | 纯分析，不应超长 |
| analyze / plan | 1,200,000 ms (20 min) | 需读取大量代码 |
| execute | 3,600,000 ms (1 hr) | 可能涉及多文件修改 + 测试 |
| review / test | 1,800,000 ms (30 min) | 中等复杂度 |
| decision eval | 300,000 ms (5 min) | 纯评估 |

#### 2d. list_agents → 活跃监控

在 A_SHOW_STATUS 中增加实时 agent 状态查询：

```ts
const live = list_agents({ path_prefix: "/root" });
// 展示每个活跃 executor 的状态 + 最新任务描述
```

### Strategy 3: 并发步骤执行（可选，高收益）

**目标**：利用 V2 的 max_concurrent = 4 并行化独立步骤。

**适用场景**：
- goal-audit 中多个 unmet sub-goal 的 fix-loop 相互独立 → 可并行 spawn
- dual 评估模式的 agent + CLI 本身已并行（当前设计已支持）
- engine=swarm 模式下多维分析的 agent 可并发

**实现方式**：

```ts
// 并行 spawn 独立 sub-goal fix-loops
for (const unmet of unmetGoals) {
  spawn_agent({
    task_name: `ralph_fix_${unmet.id}`,
    message: `Fix sub-goal ${unmet.id}: ${unmet.gap}`,
    fork_turns: "none"
  });
}

// 批量 wait
for (const unmet of unmetGoals) {
  wait_agent({ timeout_ms: 3600000 });
}
```

**约束**：
- 并行 step 之间不能有 artifact 依赖（需在 build 阶段做依赖分析）
- 并发上限 = 4（含 root agent），实际可并行 executor = 3
- 并行结果仍需逐步 `ralph complete`（CLI 有并发锁）

### Strategy 4: evaluate_via 三模式适配（推荐）

**目标**：将 Claude 版的 agent/cli/dual 评估模式完整移植到 V2。

| 模式 | V2 实现 |
|------|---------|
| `agent` | `spawn_agent` → `wait_agent` |
| `cli` | `maestro delegate` via Bash (run_in_background) → poll 或 wait 完成 |
| `dual` | agent spawn + cli delegate 并行；agent 通过 `wait_agent`，cli 通过 delegate output |

**Dual 模式 V2 特有优化**：CLI delegate 先完成时，通过 `send_message` 将 CLI verdict 注入正在运行的 agent，让 agent 在 evaluation 时参考 CLI 视角。

### Strategy 5: Engine 模式适配（延后）

Codex 没有 Claude 的 `Workflow` 工具。engine=swarm/universal 需要替代方案：

| 方案 | 可行性 | 说明 |
|------|--------|------|
| A. 多 spawn_agent 模拟 | 中 | 用 3 个并发 agent 替代 Workflow fan-out，手动实现 barrier |
| B. 外部 CLI 调用 | 高 | `maestro delegate` 本身可并行多个，但非 V2 原生 |
| C. 暂不支持 | — | SKILL.md 标注 engine 模式暂不可用，用户回退到 sequential |

**建议**：Phase 1 选方案 C（标注不可用），Phase 2 视 Codex Workflow 支持进展决定。

---

## 优先级与实施路线

| Phase | 策略 | 预期收益 | 工作量 |
|-------|------|----------|--------|
| **Phase 1** | S1 自包含重写 + S2c interrupt 融入 + S4 evaluate_via | 可独立运行，超时保护，评估灵活 | 大 |
| **Phase 2** | S2a send_message + S2b followup_task + S2d list_agents | 增量上下文补充，监控能力 | 中 |
| **Phase 3** | S3 并发步骤 | wall-clock 缩短（独立 fix-loops 并行） | 中 |
| **Phase 4** | S5 engine 适配 | 多维并行分析 | 大（依赖 Codex 平台能力） |

---

## 核心设计原则

1. **自包含优先**——SKILL.md 是 agent 的唯一输入，不依赖外部文件推断
2. **V2 原语优先**——能用 V2 原语（spawn/send/followup/interrupt/list/wait）实现的不绕道 CLI
3. **串行为默认，并行为优化**——并发仅在依赖分析确认独立性后启用
4. **CLI 是真源**——session state 读写仍通过 `maestro ralph` CLI 子命令，agent 层不直接操作 JSON
5. **渐进式迁移**——每个 phase 完成后 SKILL.md 都是可用状态，不依赖后续 phase
