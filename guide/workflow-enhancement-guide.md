# 工作流增强指南

> 本文档介绍 Maestro 的高级工作流增强功能，包括动态对抗工作流生成和并行工作流加速。

## 概述

Maestro 提供了两个强大的工作流增强命令：

| 命令 | 用途 | 特点 |
|------|------|------|
| `maestro-universal-workflow` | 动态生成任务特定的工作流脚本 | 对抗决策模式、可复用库积累 |
| `maestro-swarm-workflow` | 并行执行预构建的工作流脚本 | 多代理并发、8 个固定脚本 |

## maestro-universal-workflow

### 用途

动态工作流生成器，根据任务需求自动生成包含对抗决策模式的 Workflow 脚本。

### 核心特性

- **动态生成**：根据任务描述自动设计工作流结构
- **对抗决策**：每个决策点注入对抗性 agent 模式
- **库积累**：生成的脚本保存到 `~/.maestro/workflows/dynamic/` 供复用
- **三级深度**：shallow（单 skeptic）、standard（3-vote）、deep（交叉验证+meta-skeptic）

### 使用场景

- 非标准任务，没有现成脚本匹配
- 需要定制化的多步骤分析流程
- 方案对比和评估（如技术选型、架构决策）
- 复杂问题的深度调查

### 使用示例

```bash
# 自动匹配或生成
/maestro-universal-workflow "评估数据库迁移方案的可行性和风险"

# 指定深度
/maestro-universal-workflow "审查 auth 模块的安全性" --depth deep

# 只生成不执行
/maestro-universal-workflow "对比 3 种缓存策略" --dry-run --name cache-eval

# 基于已有脚本修改
/maestro-universal-workflow "类似 analyze 但加入成本维度" --from wf-analyze
```

### 对抗深度级别

| 级别 | 决策模式 | Agent 成本 |
|------|---------|-----------|
| `shallow` | 每个决策点 1 个 skeptic | +1 per decision |
| `standard` | 每个决策点 3-vote 多数决（默认） | +4 per decision |
| `deep` | 交叉验证 + 3-way advocacy + meta-skeptic | +8 per decision |

### 生成的脚本结构示例

用户 intent: "评估 3 种 API 认证方案（JWT/OAuth2/API Key），选出最优"

```
Phase 1: Explore — 探索代码库现有认证实现
Phase 2: Evaluate — 3 个 agent 分别深入评估每种方案
Phase 3: CrossVerify — skeptic 挑战每个评估结果
Phase 4: Compete — 3 个 advocate 各持一种方案立场辩论
Phase 5: Arbitrate — referee 根据辩论结果选出最优方案
```

预估 agent 数: 1(explore) + 3(evaluate) + 3(cross-verify) + 3(advocates) + 1(referee) = 11

---

## maestro-swarm-workflow

### 用途

并行工作流加速层，将意图路由到预构建的 Workflow 脚本，利用 `parallel()` / `pipeline()` 实现多代理并发执行。

### 核心特性

- **8 个固定脚本**：覆盖 analyze/brainstorm/review/verify/grill/plan/execute/milestone-audit
- **并行执行**：利用 Workflow 工具的 parallel/pipeline 能力
- **对抗模式**：每个脚本内嵌对抗决策模式
- **与 ralph 集成**：可作为 ralph chain 中的加速执行器

### 使用场景

- 标准 maestro 命令的并行加速版本
- 需要多代理并发分析的场景
- Ralph chain 中需要并行计算的步骤

### 使用示例

```bash
# 直接调用
/maestro-swarm-workflow "analyze auth module"

# 指定脚本
/maestro-swarm-workflow "审查代码质量" --script wf-review

# 限定分析维度
/maestro-swarm-workflow "分析性能瓶颈" --dims architecture,performance

# 限定角色
/maestro-swarm-workflow "设计新功能" --roles system-architect,product-manager
```

### 可用脚本

| 脚本 | 加速命令 | 对抗模式 |
|------|---------|---------|
| `wf-analyze` | maestro-analyze | explore → 6-dim scoring → skeptic cross-verify → 3-way advocacy + referee |
| `wf-brainstorm` | maestro-brainstorm | multi-role analysis → 3-specialist cross-review → 3-proposal competition → arbitrator |
| `wf-review` | quality-review | 6-dim scan → 3-vote adversarial verify → 3-perspective report + arbitrated verdict |
| `wf-verify` | maestro-execute (E2.7) | 3-layer + antipattern + convergence → prosecutor vs defender debate → judge verdict |
| `wf-grill` | maestro-grill | explore → parallel branch stress → meta-skeptic challenge → 3-vote verdict |
| `wf-plan` | maestro-plan | parallel context → 3-strategy competing proposals → judge panel scoring → 3-critic adversarial check |
| `wf-execute` | maestro-execute | wave-based parallel execution → adversarial convergence spot-check → 3-vote status determination |
| `wf-milestone-audit` | maestro-milestone-audit | parallel 3-dim audit → adversarial dimension challenge → 3-vote verdict |

---

## 与现有命令的关系

| 维度 | swarm-workflow | universal-workflow | composer/player |
|------|---------------|-------------------|-----------------|
| 脚本来源 | 固定 8 个预写脚本 | 动态生成 + 积累库 | 用户定义 JSON 模板 |
| 适用范围 | 对应 8 个 maestro 命令 | 任意任务 | 任意 DAG 工作流 |
| 决策模式 | 脚本内硬编码 | 按 depth 动态选择 | 用户自定义 |
| 持久化 | 不生成新脚本 | 保存到 dynamic/ 复用 | 保存模板到 templates/ |
| 推荐场景 | 已有匹配的标准命令 | 非标准任务、新领域 | 需要精确控制的流程 |

### 选择建议

1. **标准任务** → 使用 `maestro-swarm-workflow`（已有匹配脚本）
2. **非标准任务** → 使用 `maestro-universal-workflow`（动态生成）
3. **精确控制** → 使用 `maestro-composer` + `maestro-player`（JSON 模板）
4. **顺序执行** → 使用 `maestro-ralph`（自适应链）

---

## 集成 Ralph

`maestro-swarm-workflow` 可以作为 ralph chain 中的加速执行器：

```json
{
  "steps": [
    {
      "index": 0,
      "skill": "maestro-swarm-workflow",
      "args": "\"analyze auth module\" --script wf-analyze",
      "stage": "analyze"
    }
  ]
}
```

Ralph 会自动识别 swarm-workflow 并使用并行执行模式。

---

## 最佳实践

1. **从标准开始**：先尝试 `maestro-swarm-workflow`，没有匹配再用 `universal-workflow`
2. **控制深度**：`shallow` 用于快速检查，`standard` 用于常规任务，`deep` 用于关键决策
3. **复用脚本**：生成的脚本保存在 `~/.maestro/workflows/dynamic/`，可通过 `--from` 复用
4. **结合 ralph**：将 swarm-workflow 作为 ralph chain 的并行加速层

---

## 相关文档

- [命令参考](../COMMANDS-CARD-REFERENCE.md) — 所有命令的快速参考
- [Ralph 指南](./maestro-ralph-guide.md) — Ralph 闭环引擎详细指南
- [团队协作指南](./team-lite-guide.md) — 多代理协作指南
