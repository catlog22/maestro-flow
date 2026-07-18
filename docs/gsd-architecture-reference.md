# GSD (Get Shit Done) Architecture Reference

Multi-agent workflow orchestration系统架构参考，用于 maestro 设计。

---

## 系统概览

GSD 是一个面向 Claude Code 的元提示+上下文工程系统，通过结构化工作流和多 Agent 编排，将项目开发从混乱迭代转变为系统执行。

**核心解决的问题：**
- Context rot（上下文窗口质量随使用劣化）
- 每个执行 Agent 获得全新 200k context
- 原子提交（每任务一次 commit，支持 git bisect）
- Wave 并行执行（无依赖任务同时运行）

---

## 目录结构

```
get-shit-done/
├── commands/gsd/     # 31 个 slash 命令 — 用户入口
├── agents/           # 12 个专用 Agent 定义 — 执行单元
├── workflows/        # 34 个编排工作流 — 调度逻辑
├── templates/        # 模板文件 — 产物骨架
├── references/       # 参考文档 — 约束规范
└── bin/              # CLI 工具 — gsd-tools.cjs
```

---

## 命令系统（31 个 Slash Commands）

### 命令格式

```markdown
---
name: gsd:command-name
description: 人类可读描述
argument-hint: "<arguments>"
allowed-tools: [Read, Write, Bash, Agent, ...]
---

<context>标志和使用场景</context>
<objective>命令目标</objective>
<execution_context>
@~/.claude/get-shit-done/workflows/xxx.md
@~/.claude/get-shit-done/references/xxx.md
</execution_context>
<process>执行步骤</process>
```

### 命令分类

#### 项目初始化
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:new-project` | (无，交互式) | 创建项目：提问→研究→需求→路线图 | new-project.md |
| `/gsd:map-codebase` | (无) | 分析已有代码库的架构和模式 | map-codebase.md |
| `/gsd:new-milestone` | (无) | 在已有项目上启动新里程碑 | new-milestone.md |

#### 阶段规划
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:discuss-phase` | `<N>` | 在规划前提取实现决策 | discuss-phase.md |
| `/gsd:list-phase-assumptions` | `<N>` | 暴露 Claude 对阶段的假设 | list-phase-assumptions.md |
| `/gsd:research-phase` | `<N>` | 独立研究阶段实现方案 | research-phase.md |
| `/gsd:plan-phase` | `<N> [--prd] [--gaps]` | 创建阶段执行计划 | plan-phase.md |
| `/gsd:add-phase` | `<description>` | 在路线图末尾添加阶段 | add-phase.md |
| `/gsd:insert-phase` | `<after> <description>` | 在已有阶段间插入紧急阶段 | insert-phase.md |
| `/gsd:remove-phase` | `<N>` | 移除未开始的阶段 | remove-phase.md |

#### 执行
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:execute-phase` | `<N>` | 按 Wave 并行执行阶段所有计划 | execute-phase.md |
| `/gsd:quick` | `[desc] [--discuss] [--full]` | 快速执行小型任务 | quick.md |
| `/gsd:verify-work` | `[N]` | UAT 用户验收测试 | verify-work.md |
| `/gsd:add-tests` | `<N> [instructions]` | 为完成阶段生成测试 | add-tests.md |

#### 进度管理
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:progress` | (无) | 显示项目状态，路由下一步 | progress.md |
| `/gsd:check-todos` | `[area]` | 检查待办事项 | check-todos.md |
| `/gsd:add-todo` | `[description]` | 添加待办 | add-todo.md |
| `/gsd:pause-work` | (无) | 创建交接文件用于跨会话恢复 | pause-work.md |
| `/gsd:resume-work` | (无) | 恢复完整项目上下文 | resume-project.md |

#### 里程碑
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:audit-milestone` | (无) | 验证里程碑达成定义 | audit-milestone.md |
| `/gsd:plan-milestone-gaps` | (无) | 为审计缺口创建修复阶段 | plan-milestone-gaps.md |
| `/gsd:complete-milestone` | `[version]` | 标记版本完成并归档 | complete-milestone.md |

#### 质量与管理
| 命令 | 参数 | 目标 | 路由到工作流 |
|------|------|------|-------------|
| `/gsd:validate-phase` | `<N>` | Nyquist 自动化测试覆盖验证 | validate-phase.md |
| `/gsd:health` | `[--repair]` | 验证 .planning/ 目录完整性 | health.md |
| `/gsd:cleanup` | (无) | 归档已完成阶段 | cleanup.md |
| `/gsd:settings` | (无) | 交互式配置工作流行为 | settings.md |
| `/gsd:set-profile` | `<quality\|balanced\|budget>` | 切换模型配置档 | set-profile.md |
| `/gsd:update` | (无) | 检查并应用 GSD 更新 | update.md |
| `/gsd:help` | (无) | 显示命令参考 | help.md |

---

## Agent 系统（12 个专用 Agent）

### Agent 定义格式

```markdown
---
name: agent-name
description: Agent 职责描述
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, ...]
---

# 角色定义
## 输入（读取哪些文件）
## 执行流程
## 输出（写入哪些文件）
## 约束和规则
```

### Agent 详细定义

#### 1. gsd-project-researcher
- **职责：** 项目域生态研究
- **触发者：** new-project, new-milestone（4 个并行实例）
- **维度分工：** Stack / Features / Architecture / Pitfalls
- **工具：** Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7
- **输出：** `.planning/research/{STACK,FEATURES,ARCHITECTURE,PITFALLS}.md`
- **下游消费：** gsd-research-synthesizer

#### 2. gsd-research-synthesizer
- **职责：** 合并 4 个研究 Agent 输出为统一摘要
- **触发者：** new-project（研究完成后）
- **工具：** Read, Write, Bash
- **输入：** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
- **输出：** `.planning/research/SUMMARY.md` + 提交所有研究文件
- **下游消费：** gsd-roadmapper

#### 3. gsd-roadmapper
- **职责：** 创建项目路线图（阶段分解 + 需求映射）
- **触发者：** new-project（合成完成后）
- **工具：** Read, Write, Bash, Glob, Grep
- **输入：** SUMMARY.md, REQUIREMENTS.md, PROJECT.md
- **输出：** `ROADMAP.md`（阶段结构、依赖、成功标准）
- **关键约束：** 100% 需求映射（无孤立、无重复）
- **下游消费：** plan-phase, execute-phase

#### 4. gsd-phase-researcher
- **职责：** 研究特定阶段的实现方案
- **触发者：** plan-phase（集成研究步骤）
- **工具：** Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7
- **工具优先级：** Context7 → 官方文档 → WebSearch
- **输出：** `RESEARCH.md`（技术栈、模式、陷阱、示例）
- **关键约束：** 遵守 CONTEXT.md 用户决策
- **下游消费：** gsd-planner

#### 5. gsd-codebase-mapper
- **职责：** 分析已有代码库并写入分析文档
- **触发者：** map-codebase（4 个并行实例：tech/arch/quality/concerns）
- **工具：** Read, Bash, Grep, Glob, Write
- **输出：** `.planning/codebase/{STACK,INTEGRATIONS,ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,CONCERNS}.md`
- **关键特点：** Agent 自主写入文件，编排器仅跟踪完成状态

#### 6. gsd-planner
- **职责：** 创建可执行阶段计划（任务分解 + 依赖分析）
- **触发者：** plan-phase
- **工具：** Read, Write, Bash, Glob, Grep, WebFetch, Context7
- **输入：** CONTEXT.md（用户决策-LOCKED）、RESEARCH.md、ROADMAP.md 目标、REQUIREMENTS.md
- **输出：** 多个 `PLAN.md` 文件（01-01-PLAN.md, 01-02-PLAN.md, ...）
- **模式：** 标准规划 / 缺口修复（--gaps）/ 修订（基于 checker 反馈）
- **关键约束：** CONTEXT.md 锁定决策不可违背
- **Wave 分配：** 按依赖分组，分配执行波次
- **下游消费：** gsd-plan-checker, gsd-executor

#### 7. gsd-plan-checker
- **职责：** 验证计划是否能达成阶段目标（Goal-Backward）
- **触发者：** plan-phase（planner 之后，最多 3 轮修订循环）
- **工具：** Read, Bash, Glob, Grep
- **验证维度：**
  - 需求覆盖（所有阶段需求有任务对应）
  - 任务完整性（Files + Action + Verify + Done）
  - 产物验证（输出存在且有实质内容）
  - 上下文合规（遵守 CONTEXT.md 决策）
  - 范围适配（计划适合上下文预算）
- **输出：** 批准 + 建议 / 问题列表（路由回 planner 修订）

#### 8. gsd-executor
- **职责：** 原子执行 PLAN.md（每任务一次 commit）
- **触发者：** execute-phase（每个 plan/wave 一个实例）
- **工具：** Read, Write, Edit, Bash, Grep, Glob
- **执行模式：** A（全自主）→ B（检查点）→ C（主上下文决策）
- **偏差规则：** 3 条自动修复规则（bug、缺失关键功能、不完整产物）
- **输出：** `SUMMARY.md` + 原子 commit
- **关键特点：** 全新上下文执行，checkpoint 协议支持中断恢复

#### 9. gsd-verifier
- **职责：** Goal-Backward 验证阶段目标达成
- **触发者：** execute-phase（所有计划完成后）
- **工具：** Read, Write, Bash, Grep, Glob
- **验证层级：** 1（存在）→ 2（实质性）→ 3（连接正确）
- **模式：** 初始验证 / 再验证（优化：失败项全量检查，通过项快速回归）
- **输出：** `VERIFICATION.md`（must_haves, truths, artifacts, gaps）

#### 10. gsd-integration-checker
- **职责：** 验证跨阶段集成和端到端流程
- **触发者：** audit-milestone
- **工具：** Read, Bash, Grep, Glob
- **核心原则：** 存在 ≠ 集成（导出被使用、API 被调用、数据流连通）
- **验证过程：** 构建导出/导入映射 → 验证下游消费 → 验证 API 有消费者 → 映射到需求 ID

#### 11. gsd-debugger
- **职责：** 科学方法系统调试
- **触发者：** diagnose-issues（每个缺口一个实例，并行）
- **工具：** Read, Write, Edit, Bash, Grep, Glob, WebSearch
- **流程：** 证据收集 → 假设 → 预测 → 测试 → 结果
- **输出：** `DEBUG-{slug}.md`（根因分析 + 修复方向）
- **关键特点：** 持久化调试状态，支持跨 context reset 恢复

#### 12. gsd-nyquist-auditor
- **职责：** 生成测试填补 Nyquist 验证缺口
- **触发者：** validate-phase
- **工具：** Read, Write, Edit, Bash, Glob, Grep
- **流程：** 每个缺口 → 生成测试 → 运行 → 调试（最多 3 轮）
- **关键约束：** 只读实现文件，仅创建/修改测试文件
- **升级机制：** 实现 bug → ESCALATE（不在此修复）

---

## Agent 调度矩阵

| 编排工作流 | 生成 Agent | 数量 | 并行策略 |
|-----------|-----------|------|---------|
| new-project | gsd-project-researcher | 4 | 并行（4 维度） |
| new-project | gsd-research-synthesizer | 1 | 顺序 |
| new-project | gsd-roadmapper | 1 | 顺序 |
| new-milestone | gsd-project-researcher | 4 | 并行（仅新能力） |
| map-codebase | gsd-codebase-mapper | 4 | 并行（tech/arch/quality/concerns） |
| plan-phase | gsd-phase-researcher | 1 | 顺序 |
| plan-phase | gsd-planner | 1 | 顺序 |
| plan-phase | gsd-plan-checker | 1 | 顺序（最多 3 轮） |
| execute-phase | gsd-executor | 1-N | 并行（wave 内） |
| execute-phase | gsd-verifier | 1 | 顺序 |
| audit-milestone | gsd-integration-checker | 1 | 顺序 |
| diagnose-issues | gsd-debugger | 1/gap | 并行 |
| validate-phase | gsd-nyquist-auditor | 1 | 顺序 |

---

## 核心工作流管道

### 主流程

```
/gsd:new-project
    ↓ 提问 → 研究(4并行) → 合成 → 需求 → 路线图
/gsd:discuss-phase N
    ↓ 提取决策 → CONTEXT.md（锁定/自由裁量/延迟）
/gsd:plan-phase N
    ↓ 研究 → 规划 → 检查（最多3轮修订）→ PLAN.md
/gsd:execute-phase N
    ↓ Wave分析 → 并行执行 → 原子commit → SUMMARY.md
/gsd:verify-work N
    ↓ UAT测试 → 缺口诊断 → 修复规划
/gsd:validate-phase N
    ↓ Nyquist审计 → 生成测试 → 覆盖验证
/gsd:complete-milestone
    ↓ 归档 → 标记版本 → 启动下一里程碑
```

### 辅助流程

```
/gsd:quick — 快速任务（跳过讨论，直接 plan→execute）
/gsd:pause-work → /gsd:resume-work — 跨会话恢复
/gsd:health [--repair] — 项目健康检查
/gsd:audit-milestone → /gsd:plan-milestone-gaps — 缺口闭环
```

---

## 产物系统

### YAML Frontmatter 元数据

所有产物使用 YAML frontmatter 跟踪状态：

**PLAN.md:**
```yaml
phase: 1
plan: 01
type: auto|checkpoint:N
autonomous: true|false
wave: 1
depends_on: []
requirements: [REQ-001, REQ-002]
must_haves:
  truths: ["功能X存在", "通过测试Y"]
  artifacts: ["src/module.ts"]
  key_links: ["config → module → route"]
```

**SUMMARY.md:**
```yaml
phase: 1
plan: 01
date: 2025-01-15
tasks: 5
files_created: [src/auth.ts, src/auth.test.ts]
files_modified: [src/index.ts]
requirements_completed: [REQ-001]
deviations: [{type: bug_fix, description: "..."}]
```

**VERIFICATION.md:**
```yaml
phase: 1
status: passed|gaps_found
verified_date: 2025-01-15
must_haves:
  truths: [{claim: "...", status: "verified|gap"}]
  artifacts: [{path: "...", status: "exists|missing"}]
gaps: [{type: "missing_feature", severity: "high", fix: "..."}]
```

### 任务格式（PLAN.md 内）

```xml
<task type="auto|checkpoint">
  <name>任务描述</name>
  <files>src/file.ts</files>
  <action>具体操作</action>
  <verify>验证方法</verify>
  <done>完成标准</done>
</task>
```

---

## 项目状态文件

| 文件 | 位置 | 用途 | 生命周期 |
|------|------|------|---------|
| PROJECT.md | .planning/ | 项目愿景、目标、约束 | 项目全程 |
| STATE.md | .planning/ | 当前位置、会话记忆、累积上下文 | 项目全程（持续更新） |
| ROADMAP.md | .planning/ | 阶段结构、依赖、进度 | 每里程碑重建 |
| REQUIREMENTS.md | .planning/ | 需求列表、可追溯性表 | 每里程碑重建 |
| config.json | .planning/ | 工作流配置 | 项目全程 |
| MILESTONES.md | .planning/ | 已交付版本历史 | 项目全程（追加） |
| CONTEXT.md | .planning/phases/NN-slug/ | 用户决策（锁定/自由/延迟） | 每阶段 |
| RESEARCH.md | .planning/phases/NN-slug/ | 阶段实现研究 | 每阶段 |
| PLAN.md | .planning/phases/NN-slug/ | 可执行计划 | 每阶段（多个） |
| SUMMARY.md | .planning/phases/NN-slug/ | 执行结果 | 每计划 |
| VERIFICATION.md | .planning/phases/NN-slug/ | 目标达成验证 | 每阶段 |
| UAT.md | .planning/phases/NN-slug/ | 用户验收测试 | 每阶段 |
| VALIDATION.md | .planning/phases/NN-slug/ | Nyquist 测试验证 | 每阶段 |
| .continue-here.md | .planning/phases/NN-slug/ | 跨会话交接 | 临时 |

---

## 执行上下文引用路径

### 工作流中的 @引用

```
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/workflows/node-repair.md
@~/.claude/get-shit-done/templates/summary.md
@~/.claude/get-shit-done/templates/PLAN.md
@~/.claude/get-shit-done/templates/CONTEXT.md
@~/.claude/get-shit-done/templates/discovery.md
@~/.claude/get-shit-done/templates/UAT.md
@~/.claude/get-shit-done/templates/VALIDATION.md
@~/.claude/get-shit-done/templates/research-project/{STACK,FEATURES,ARCHITECTURE,PITFALLS,SUMMARY}.md
@~/.claude/get-shit-done/references/git-integration.md
@~/.claude/get-shit-done/references/verification-patterns.md
@~/.claude/get-shit-done/references/checkpoints.md
@~/.claude/get-shit-done/references/phase-argument-parsing.md
@~/.claude/get-shit-done/references/model-profile-resolution.md
@~/.claude/get-shit-done/references/tdd.md
@~/.claude/get-shit-done/references/ui-brand.md
```

---

## 配置系统

### config.json 完整结构

```json
{
  "mode": "interactive|yolo",
  "granularity": "coarse|standard|fine",
  "model_profile": "quality|balanced|budget",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": false,
    "nyquist_validation": true,
    "node_repair": true,
    "node_repair_budget": 2
  },
  "git": {
    "branching_strategy": "none|phase|milestone",
    "commit_docs": true,
    "search_gitignored": false
  },
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "max_concurrent_agents": 3
  },
  "gates": {
    "confirm_project": true,
    "confirm_phases": true,
    "confirm_roadmap": true
  }
}
```

---

## 架构设计原则

1. **全新上下文隔离** — 每个子 Agent 获得全新 200k context，编排器保持 30-40% 利用率
2. **持久化状态文件** — UAT.md、DEBUG 文件、.continue-here 跨 context reset 存活
3. **Goal-Backward 思维** — 从期望结果出发验证，而非检查任务完成
4. **原子提交纪律** — 每任务一次 commit，格式 `feat(phase-plan): task description`
5. **三源交叉验证** — REQUIREMENTS.md × SUMMARY frontmatter × VERIFICATION.md
6. **Wave 并行化** — 计划按依赖分组为 wave，wave 内并行/wave 间顺序
7. **Checkpoint 协议** — 在决策点停止，返回结构化消息，全新 Agent 恢复
8. **用户决策忠实度** — CONTEXT.md 锁定决策不可违背，是约束而非建议
9. **100% 需求映射** — 无孤立需求，每阶段有可观测成功标准
10. **可配置工作流** — 研究、计划检查、验证等步骤均可通过 config.json 开关
