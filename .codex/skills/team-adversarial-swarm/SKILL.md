---
name: team-adversarial-swarm
description: ACO swarm intelligence with modular Workflow composition and
  adversarial decision gates. Coordinator drives iteration loop; 4 composable
  Workflow scripts handle exploration, scoring, convergence, and synthesis —
  each with built-in adversarial patterns.
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Workflow
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: run
version: 0.5.51
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

# Team Adversarial Swarm

ACO 蚁群优化 + 模块化 Workflow 编排 + 对抗决策。

继承 `team-swarm` 的蚁群算法核心（Python ACO 脚本），用 4 个可组合的 Workflow 脚本
替代 team-worker 架构，在每个决策节点注入对抗性 agent 模式。

## Architecture

```
SKILL.md (Coordinator — this file)
  │
  │  Phase 1: Config Generation (inline)
  │  Phase 2: ACO Init (Bash: aco.py init)
  │
  │  Phase 3: Iteration Loop ×K
  │  ┌──────────────────────────────────────────────────┐
  │  │ 3a. Bash: aco.py select → assignments            │
  │  │ 3b. Workflow(wf-swarm-explore)   ← 模块1         │
  │  │     N ants parallel → ant_results                │
  │  │ 3c. Workflow(wf-swarm-score)     ← 模块2         │
  │  │     3-vote adversarial scoring → verified_scores │
  │  │ 3d. Write scores → Bash: aco.py update           │
  │  │ 3e. Workflow(wf-swarm-converge)  ← 模块3         │
  │  │     prosecutor/defender/judge → converged?       │
  │  │ 3f. if converged: break                          │
  │  └──────────────────────────────────────────────────┘
  │
  │  Phase 4: Bash: aco.py report
  │  Workflow(wf-swarm-synthesize)      ← 模块4
  │  3-perspective analysis + arbitration → best-solution.md
```

## Workflow Module Registry

| Module | Script | Args Interface | Adversarial Pattern | Returns |
|--------|--------|---------------|--------------------|---------| 
| **Explore** | `workflows/wf-swarm-explore.js` | `{ iteration, assignments[], objective, session, config }` | N ants parallel | `{ ant_results[] }` |
| **Score** | `workflows/wf-swarm-score.js` | `{ iteration, ant_results[], objective, rubric? }` | 3-vote per ant (prosecutor/defender/judge) | `{ scores{}, calibration }` |
| **Converge** | `workflows/wf-swarm-converge.js` | `{ iteration, best, history[], config }` | prosecutor(continue)/defender(stop)/judge | `{ converged, reason, confidence }` |
| **Synthesize** | `workflows/wf-swarm-synthesize.js` | `{ best, top_k[], convergence_story, objective }` | 3-perspective + arbitrator | `{ report, caveats }` |

每个模块独立可用，也可由 Coordinator 组合编排。

## Shared Dependencies

**所有依赖均在本 skill 内部，无外部引用。**

- **Python ACO 脚本**: `<this-skill>/scripts/aco.py`
  - 运行时解析: `Glob(".claude/skills/team-adversarial-swarm/scripts/aco.py")`
  - 依赖模块: `pheromone.py`, `scoring.py`（同目录）
  - 命令: `init` / `select` / `update` / `converged` / `report`
  - 协议: [specs/swarm-protocol.md](specs/swarm-protocol.md)
- **Workflow 脚本**: `<this-skill>/workflows/wf-swarm-*.js`
  - 运行时解析: `Glob(".claude/skills/team-adversarial-swarm/workflows/wf-swarm-*.js")`

## Specs Reference

| Spec | Purpose |
|------|---------|
| [specs/swarm-protocol.md](specs/swarm-protocol.md) | Coordinator ↔ Script ↔ Workflow 三方协议 |
| [specs/pheromone-schema.md](specs/pheromone-schema.md) | 信息素矩阵结构、更新公式、蒸发规则 |
| [specs/ant-output-schema.md](specs/ant-output-schema.md) | 蚁输出 JSON 合约（三层评分） |
| [specs/convergence-criteria.md](specs/convergence-criteria.md) | 双层收敛：Python 信号 + 对抗辩论 |
| [specs/swarm-config-template.json](specs/swarm-config-template.json) | 用户配置模板 |

## Session Directory

```
.workflow/.team/TAS-<slug>-<date>/
├── swarm-config.json       # Phase 1 output
├── pheromone/              # ACO state (managed by aco.py)
│   ├── current.json
│   └── history/
├── trails/                 # Per-iteration trails (managed by aco.py)
├── scores/                 # Adversarial scoring results
│   └── iter-<k>-scores.json
├── artifacts/
│   ├── ant-<k>-<id>.json   # Ant outputs
│   └── best-solution.md    # Final synthesis
├── workflows/              # Workflow run artifacts
│   ├── explore-<k>.json    # Per-iteration explore results
│   ├── score-<k>.json      # Per-iteration score results
│   └── converge-<k>.json   # Per-iteration convergence decision
└── best.json               # Canonical best (managed by aco.py)
```

---

## Coordinator Execution Flow

### Phase 0: Resume Check

1. `Glob(".workflow/.team/TAS-*/swarm-config.json")` → 查找活跃 session
2. 若存在且有 `workflows/converge-*.json` 未标记 converged → 恢复到对应迭代
3. 若无活跃 session → Phase 1

### Phase 1: Config Generation

解析用户 intent，生成 `swarm-config.json`。

若 intent 不够明确，用 request_user_input 澄清：
- 搜索空间是什么？（文件 glob / 节点列表 / 抽象决策集）
- 目标是什么？（最优方案 / 发现问题 / 优化路径）
- 如何评分？（测试通过率 / lint / 自定义规则 / LLM 对抗评分）
- 预算？（最大迭代 / 每轮蚁数 / token 预算）

生成 config 字段：
```json
{
  "task": { "objective": "...", "evidence_requirements": "..." },
  "swarm": { "n_ants": 5, "max_iterations": 5 },
  "aco": { "alpha": 1.0, "beta": 2.0, "rho": 0.1, "q": 1.0 },
  "task_space": { "nodes": [...], "auto_discover_from": "..." },
  "scoring": { "mode": "adversarial", "rubric": "..." },
  "convergence": { "patience": 2, "min_improvement": 0.01, "max_iterations": 5 }
}
```

Write 到 `<session>/swarm-config.json`。

### Phase 2: ACO Init

1. 创建 session 目录: `TAS-<slug>-<date>`
2. 解析 aco.py 路径（从 team-swarm skill 继承）
3. `Bash: python <aco.py> --session <session> init`
4. 解析输出: `{ n_nodes, n_edges, pheromone_path }`

### Phase 3: Iteration Loop

```python
for k in range(1, max_iterations + 1):
    # 3a. ACO selection
    assignments = Bash("python aco.py --session <session> select --iter k")
    
    # 3b. Parallel exploration (Workflow Module 1)
    explore_result = Workflow({
        scriptPath: "<skill>/workflows/wf-swarm-explore.js",
        args: { iteration: k, assignments, objective, session, config }
    })
    
    # 3c. Adversarial scoring (Workflow Module 2)
    score_result = Workflow({
        scriptPath: "<skill>/workflows/wf-swarm-score.js",
        args: { iteration: k, ant_results: explore_result.ant_results, objective, rubric }
    })
    
    # 3d. Write scores + pheromone update
    Write("<session>/scores/iter-k-scores.json", score_result)
    Bash("python aco.py --session <session> update --iter k")
    
    # 3e. Adversarial convergence check (Workflow Module 3)
    converge_result = Workflow({
        scriptPath: "<skill>/workflows/wf-swarm-converge.js",
        args: { iteration: k, best: aco_best, history: iter_history, config }
    })
    
    # 3f. Save + check
    Write("<session>/workflows/converge-k.json", converge_result)
    if converge_result.converged: break
```

**注意**：每次 Workflow 调用是独立的，数据通过 args 传入、返回值传出。
Coordinator 负责 Workflow 间的数据桥接和 Python 脚本调用。

### Phase 4: Synthesis

1. `Bash: python aco.py --session <session> report` → 获取 best + top_k + curve
2. 调用 Workflow Module 4:
   ```
   Workflow({
     scriptPath: "<skill>/workflows/wf-swarm-synthesize.js",
     args: { best, top_k, convergence_story, objective }
   })
   ```
3. 将 synthesis 结果写入 `<session>/artifacts/best-solution.md`
4. 展示完成摘要 + request_user_input（归档 / 保留 / 导出 / 再跑一轮）

---

## Module Composition Patterns

### 完整流水线（默认）
```
explore → score → update → converge → [loop] → synthesize
```

### 仅探索（跳过评分，用 self_score）
```
explore → update(self_score) → converge → synthesize
```

### 单次迭代调试
```
explore(k=1) → score(k=1)  // 不循环，只看一轮
```

### 独立评分（已有 ant artifacts）
```
score(ant_results from files) → 输出 verified_scores
```

### 独立综合（已有 best + trails）
```
synthesize(best, top_k) → best-solution.md
```

---

## Error Handling

| Scenario | Resolution |
|----------|------------|
| aco.py 未找到 | Glob team-swarm skill 路径；提示安装 |
| Python < 3.10 | 尝试 python3；报告依赖 |
| Workflow 执行失败 | 记录错误，提供 --resume 恢复点 |
| 所有蚁全部失败 | 暂停，request_user_input（重试/终止/调整config） |
| 收敛从不触发 | max_iterations 安全网总会触发 |
| 幻觉集群 (>50% 蚁被降分) | 暂停，request_user_input（继续/调整评分规则） |

## Completion

展示最终结果 + 交互选择:
- **归档**: 保存 session，展示 best-solution.md
- **继续**: 保持 session，可追加迭代
- **导出**: 复制 best-solution.md 到目标位置
- **再跑**: 重置收敛，继续 K 轮
