---
title: "质量管线指南"
icon: "✅"
---

Maestro 质量管线完整参考：七个阶段围绕 **"审查 → 测试 → 调试 → 重构 → 复盘"** 闭环组织。

---

## 命令总览

| 命令 | 定位 | 核心问题 | 产物 ID |
|------|------|---------|---------|
| `maestro-ralph --engine swarm --script wf-review` | 分层代码审查 | 代码质量是否达标？ | `REV-{NNN}` |
| `maestro "<test intent>"` | 会话式 UAT | 用户视角是否正常？ | `TST-{NNN}` |
| `maestro-ralph --engine swarm` | 统一自动测试 | 覆盖率和回归是否通过？ | `TST-{NNN}` |
| `maestro-odyssey --mode debug` | 假设驱动调试 | 根因是什么？ | `DBG-{NNN}` |
| `quality-refactor` | 反思驱动重构 | 技术债是否收敛？ | `WBR-{NNN}` |
| `maestro-manage sync codebase` | 文档同步 | 文档与代码是否一致？ | — |
| `maestro-next --promote` | 阶段复盘 | 可复用的洞察是什么？ | `INS-{8hex}` |

---

## maestro-ralph --engine swarm --script wf-review — 分层代码审查

```bash
/maestro-ralph --engine swarm --script wf-review "<phase>" [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]
```

| 参数 | 说明 |
|------|------|
| `<phase>` | 必填，Phase 编号或 slug |
| `--level` | 审查级别：`quick`（快速）/ `standard`（标准）/ `deep`（深度），默认自动检测 |
| `--dimensions` | 逗号分隔的审查维度，覆盖级别默认值 |

**三级审查**：Quick（小改动内联审查）→ Standard（并行 Agent 按维度审查，自动 deep-dive）→ Deep（多轮聚合）

产物路径：`scratch/{YYYYMMDD}-review-P{N}-{slug}/review.json`

| Verdict | 含义 | 下一步 |
|---------|------|--------|
| `PASS` | 所有维度通过 | `/maestro "<test intent: {phase}>"` |
| `WARN` | 非关键问题，可继续 | `/maestro "<test intent: {phase}>"` |
| `BLOCK` | 关键问题，必须修复 | `/maestro-next "{phase} --gaps"` |

---

## maestro "<test intent>" — 会话式 UAT

```bash
/maestro "<test intent> [phase]" [--smoke] [--auto-fix]
```

| 参数 | 说明 |
|------|------|
| `--smoke` | UAT 前注入冒烟测试 |
| `--auto-fix` | 自动 gap-fix 循环（verify→plan--gaps→execute→re-verify，最多 2 轮） |

**流程**：从 `verification.json` 提取场景 → 逐场景交互 → 自动推断严重性（blocker/major/minor/cosmetic）→ 问题按 gap cluster 并行 debug

产物路径：`scratch/{YYYYMMDD}-test-P{N}-{slug}/`（uat.md, test-plan.json, test-results.json）

| 条件 | 下一步 |
|------|--------|
| 全部通过 | `/maestro-session-seal` |
| `--auto-fix` 成功 | 已通过 `/maestro-ralph` 决策门控验证 |
| 仍有问题 | `/maestro-odyssey --mode debug "<from-uat {phase}>"` |
| 覆盖率不足 | `/maestro-ralph --engine swarm "{phase}"` |

---

## maestro-ralph --engine swarm — 统一自动测试

```bash
/maestro-ralph --engine swarm "<phase>" [--max-iter N] [--layer L0-L3] [--strategy name] [--dry-run] [--re-run] [-y]
```

| 参数 | 说明 |
|------|------|
| `--max-iter N` | 最大迭代次数（默认 5） |
| `--layer L` | 指定层级（L0/L1/L2/L3） |
| `--dry-run` | 只生成计划，不执行 |
| `--re-run` | 只重跑失败场景 |

**智能路由**：

| 优先级 | 条件 | 路由 |
|--------|------|------|
| 1 | 存在活跃会话 | 恢复会话 |
| 2 | `--re-run` + 之前有失败 | 重跑失败 |
| 3 | 存在 REQ-*.md | spec 路由 |
| 4 | 存在覆盖缺口 | gap 路由 |
| 5 | 默认 | code 路由 |

**层级波浪**：L0→L1→L2→L3 顺序执行，CSV 并行写入 + CSV 并行诊断

产物路径：`scratch/{YYYYMMDD}-auto-test-P{N}-{slug}/`（test-plan.json, scenarios.csv, report.json）

| 条件 | 下一步 |
|------|--------|
| 收敛（≥95%） | 已通过 `/maestro-ralph` 决策门控 |
| 发现 Bug | `/maestro-odyssey --mode debug "<from-uat {phase}>"` |
| 最大迭代，>80% | `/maestro "<test intent: {phase}>"` |
| 最大迭代，<80% | `/maestro-odyssey --mode debug "{phase}"` |

---

## maestro-odyssey --mode debug — 假设驱动调试

```bash
/maestro-odyssey --mode debug "<issue description>" [--from-uat <phase>] [--parallel]
```

| 模式 | 触发方式 | 症状来源 |
|------|---------|---------|
| 独立 | 直接提供问题描述 | 交互收集 |
| UAT 衔接 | `--from-uat` | 从 `uat.md` 加载 |
| 并行 | `--parallel` | 每 gap cluster 独立 Agent |

**调试循环**：症状收集 → 假设生成 → 隔离验证 → 根因确认 → 就绪门控 → 压力测试

产物路径：`scratch/{YYYYMMDD}-debug-P{N}-{slug}/`（understanding.md, evidence.ndjson）

| 条件 | 下一步 |
|------|--------|
| 根因已找到 | `/maestro-next "{phase} --gaps"` |
| UAT 衔接 + 自动修复 | `/maestro "<test intent: {phase}>" --auto-fix` |
| 结论不明确 | 恢复调试会话 |

---

## quality-refactor — 反思驱动重构

```bash
/quality-refactor [<scope>]    # scope: 模块路径 | 功能区域 | all
```

每轮：**分析**（识别影响）→ **规划**（确认后执行）→ **反思**（测试验证 + 策略调整）

产物路径：`scratch/{YYYYMMDD}-refactor-{scope}/reflection-log.md`

---

## maestro-manage sync codebase — 文档同步

```bash
/maestro-manage sync codebase [--full] [--since <commit|HEAD~N>] [--dry-run]
```

通过 `git diff` 检测变更 → `doc-index.json` 追踪影响链 → 更新 `.workflow/codebase/` 文档。

---

## maestro-next --promote — 阶段复盘

```bash
/maestro-next --promote [phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [-y]
```

4 个并行 Lens（Technical / Process / Quality / Decision），洞察自动路由：

| 路由目标 | 条件 |
|---------|------|
| Spec stub | 可复用模式/约束 |
| Issue | 反复出现的 gap |
| Knowhow tip | 流程笔记/提醒 |
| Learnings | 所有洞察（始终） |

---

## 质量闭环流转

```
                    ┌──────────────────────────────────────────────────┐
                    │           Phase 执行完成                          │
                    └──────────────┬───────────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────────────┐
              ┌─────┤   maestro-ralph wf-review (审查)                   │
              │     └──────────────┬───────────────────────────────────┘
              │ BLOCK              │ PASS/WARN
              ▼                    ▼
    ┌──────────────────┐  ┌──────────────────────────────────────────┐
    │ maestro-next      │  │  maestro test / maestro-ralph swarm      │
    │ --gaps (修复)     │  │            (测试)                        │
    └────────┬─────────┘  └──────────────┬───────────────────────────┘
             │                          │
             │ 执行修复                  │ 发现问题
             ▼                          ▼
    ┌──────────────────┐      ┌──────────────────────────┐
    │ maestro-ralph    │◄─────┤   maestro-odyssey --mode debug    │
    │ continue         │ 调试  │   (调试)                  │
    └────────┬─────────┘      └──────────┬───────────────┘
             │                           │
             │ 根因找到                   │
             ▼                            │
    ┌──────────────────┐                  │
    │ 重跑测试循环     │◄─────────────────┘
    └────────┬─────────┘
             │ 全部通过
             ▼
    ┌──────────────────────────────────────────────────┐
    │  quality-refactor (可选，处理技术债)              │
    │  maestro-manage sync codebase (同步文档)                  │
    │  maestro-next --promote (复盘，知识回流)           │
    └──────────────────────────────────────────────────┘
```

<details>
<summary>决策树：何时用哪个命令</summary>

```
代码刚执行完
  ├─ 需要代码质量评估？──> /maestro-ralph --engine swarm --script wf-review "<phase>"
  │    ├─ PASS/WARN ──> 继续测试
  │    └─ BLOCK ──> /maestro-next "<phase> --gaps"
  │
  ├─ 需要用户验收？──> /maestro "<test intent: <phase>>"
  │    ├─ 全通过 ──> /maestro-session-seal
  │    └─ 有问题 ──> /maestro-odyssey --mode debug "<from-uat <phase>>"
  │
  ├─ 需要自动化测试？──> /maestro-ralph --engine swarm "<phase>"
  │    ├─ 收敛 ──> 已通过 maestro-ralph 决策门控
  │    └─ 发现 Bug ──> /maestro-odyssey --mode debug "<from-uat <phase>>"
  │
  ├─ 有已知 Bug？──> /maestro-odyssey --mode debug "<issue>"
  │    ├─ 根因明确 ──> /maestro-next "<phase> --gaps"
  │    └─ 不确定 ──> 继续调试
  │
  ├─ 需要减少技术债？──> /quality-refactor <scope>
  │    ├─ 测试通过 ──> /maestro-manage sync codebase
  │    └─ 测试失败 ──> /maestro-odyssey --mode debug "<scope>"
  │
  ├─ 代码改了文档没更新？──> /maestro-manage sync codebase
  │
  └─ Phase 完成需要复盘？──> /maestro-next --promote
       ├─ 有洞察 ──> 自动路由到 spec/issue/knowhow
       └─ 完成后 ──> /maestro-manage status
```

</details>

---

## 与 Phase 管线集成

`maestro-ralph` 决策门控后是质量命令的标准入口：

```bash
/maestro-ralph continue 1 → /maestro-ralph --engine swarm --script wf-review "1" → /maestro-ralph --engine swarm "1" → /maestro "<test intent: 1>" → /maestro-next --promote
```

`--gaps` 是质量管线与 Phase 管线的核心桥梁：

| 触发场景 | 命令 |
|---------|------|
| `maestro-ralph wf-review` 裁定 BLOCK | `/maestro-next "{phase} --gaps"` |
| `maestro-odyssey --mode debug` 确认根因 | `/maestro-next "{phase} --gaps"` |
| `maestro "<test intent>" --auto-fix` | 自动调用 `maestro-next --gaps → maestro-ralph continue → 决策门控` |

**里程碑审计前检查点**：所有 Phase 已通过 maestro-ralph 决策门控 → 关键 Phase 已 review → 核心功能已 test → 问题已闭环 → 复盘已完成
