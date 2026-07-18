---
name: maestro-help
description: Maestro Flow 命令帮助系统。搜索命令、浏览技能、工作流推荐、新手引导。Triggers on "maestro-help", "帮助", "命令", "怎么用", "skill", "workflow", "maestro 怎么用".
allowed-tools: Read, Grep, Glob, AskUserQuestion
session-mode: none
---

# Maestro Help

Maestro Flow 命令帮助系统，提供命令搜索、技能浏览、工作流推荐、新手引导功能。

## Trigger Conditions

- 关键词: "maestro-help", "帮助", "命令", "怎么用", "maestro 怎么用", "工作流", "skill", "workflow", "有哪些命令", "用什么命令"
- 场景: 询问命令用法、搜索命令、请求下一步建议、选择工作流、浏览 Skill/Agent 目录
- 斜杠: `/maestro-help`, `/maestro-help search <keyword>`, `/maestro-help skills`, `/maestro-help guide`

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Maestro Help (SKILL.md) — Orchestrator                          │
│  → Parse intent → Route to mode → Execute phase → Present        │
└────────────────────────┬─────────────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────────┐
    ↓                    ↓                        ↓
┌──────────┐      ┌──────────────┐         ┌──────────┐
│ Phase 1  │      │  Phase 2     │         │ Phase 3  │
│ Parse    │─────→│  Search &    │────────→│ Workflow │
│ Intent   │      │  Present     │         │ Guide    │
└──────────┘      └──────────────┘         └──────────┘
                       ↑       ↗                │
                       └──────┘                  ↓
                    (refine search)          present guide
```

## Key Design Principles

1. **Catalog 驱动**: 所有查询基于 `index/catalog.json`，不做硬编码
2. **Guide 深度链接**: 命令详情链接到 `guide/` 目录中的参考文档
3. **上下文感知**: 根据项目状态（.workflow/ 是否存在、当前 Phase）调整推荐
4. **中英双语**: 命令名英文，说明和示例中文

## Data Source

Single source of truth: **[index/catalog.json](index/catalog.json)**

| Field | Purpose |
|-------|---------|
| `commands[]` | 64 个 slash 命令，含分类和描述 |
| `skills[]` | 44 个 Skill，含分类和描述 |
| `agents[]` | 24 个 Agent，含分类和描述 |
| `cli_commands[]` | 21 个终端命令 |
| `guide_files[]` | 17 个 Guide 文档索引（planned，尚未创建） |
| `essential_commands[]` | 10 个核心命令（新手用） |
| `workflows` | 主干管线、快速渠道、Issue 闭环、初始化路径 |

## Operation Modes

### Mode 1: Command Search

**Triggers**: "搜索命令", "find command", "search", 命令名关键词

**Process**:
1. Read `Ref: phases/01-parse-intent.md` — 解析搜索意图
2. Query `catalog.json` commands[] + cli_commands[]
3. Filter by name, description, category
4. Present top 5 相关结果，含命令名、描述、分类

### Mode 2: Command Documentation

**Triggers**: "怎么用", "how to use", "详情", 具体命令名

**Process**:
1. Locate command in `catalog.json`
2. Read source file via `source` path（从 catalog 相对路径）
3. 若有对应 guide 文档，读取并提取相关段落
4. 提供上下文相关的用法示例

### Mode 3: Smart Recommendations

**Triggers**: "下一步", "what's next", "推荐", "继续"

**Process**:
1. 检测当前项目状态（.workflow/state.json）
2. 根据 workflows 配置推荐后续命令
3. Explain WHY 每个推荐适合当前状态

### Mode 4: Workflow Guide

**Triggers**: "工作流", "workflow", "怎么开始", "用什么流程"

**Process**:
1. Read `Ref: phases/03-workflow-guide.md`
2. 分析用户任务类型和复杂度
3. 推荐匹配的工作流（主干管线/快速渠道/Issue 闭环）
4. 给出具体命令序列

### Mode 5: Beginner Onboarding

**Triggers**: "新手", "getting started", "常用命令", "入门"

**Process**:
1. Query `catalog.json` essential_commands[]
2. 逐个展示核心命令的简要说明
3. 引导用户完成首次项目初始化

### Mode 6: Skill & Agent Browsing

**Triggers**: "skill", "agent", "技能", "有哪些 skill", "团队"

**Process**:
1. Read `Ref: phases/02-search-present.md`
2. Query `catalog.json` skills[] 或 agents[]
3. Filter by category
4. 呈现分类列表，含描述

### Mode 7: CLI Command Reference

**Triggers**: "终端命令", "CLI", "maestro 命令", "terminal"

**Process**:
1. Query `catalog.json` cli_commands[]
2. 按分类分组呈现
3. 含别名和常用选项

## Execution Flow

```
Input: $ARGUMENTS (free text)

Phase 1: Parse Intent
   └─ Ref: phases/01-parse-intent.md
      ├─ 分析关键词确定 operation mode
      ├─ 提取搜索词 / 命令名 / 分类过滤
      └─ Output: { mode, query, category?, context? }

Phase 2: Search & Present  (Mode 1/2/3/6/7)
   └─ Ref: phases/02-search-present.md
      ├─ 查询 catalog.json
      ├─ 按模式过滤和排序
      ├─ 读取 source 文件（Mode 2）
      └─ Output: 格式化结果

Phase 3: Workflow Guide  (Mode 4/5)
   └─ Ref: phases/03-workflow-guide.md
      ├─ 检测项目状态
      ├─ 匹配工作流模板
      ├─ 生成推荐命令序列
      └─ Output: 引导信息
```

**Phase Reference Documents** (read on-demand):

| Phase | Document | Purpose |
|-------|----------|---------|
| 1 | [phases/01-parse-intent.md](phases/01-parse-intent.md) | 意图解析和模式路由 |
| 2 | [phases/02-search-present.md](phases/02-search-present.md) | 搜索和呈现 |
| 3 | [phases/03-workflow-guide.md](phases/03-workflow-guide.md) | 工作流推荐和引导 |

## Input Processing

```
$ARGUMENTS → Parse:
  ├─ "search <keyword>"  → Mode 1: Command Search
  ├─ 命令名 (如 "analyze") → Mode 2: Documentation
  ├─ "下一步" / "next"     → Mode 3: Smart Recommendations
  ├─ "工作流" / "workflow" → Mode 4: Workflow Guide
  ├─ "新手" / "入门"       → Mode 5: Beginner Onboarding
  ├─ "skill" / "agent"    → Mode 6: Skill & Agent Browsing
  ├─ "CLI" / "终端"        → Mode 7: CLI Reference
  ├─ 空参数               → Mode 5: Beginner Onboarding
  └─ 其他自由文本          → Mode 1: Command Search (fuzzy)
```

## Command Catalog Quick Reference

### 上游起源 + 核心 (core)

> 裸名称为 first-tier step：经 `/maestro "<意图>"` 自动路由，或 `maestro run prepare <step>` + `maestro run create <step> ...` 直接执行；`/` 前缀为独立命令。

| 命令 | 用途 |
|------|------|
| `/maestro` | 智能协调器，自动路由 |
| `/maestro-init` | 项目初始化 |
| `brainstorm` | 头脑风暴 — 发散探索，多角色创意 |
| `blueprint` | 正式规格文档化 — 7-phase 收敛规格链 |
| `roadmap` | 路线图编排 — 消费上游 context，纯 Milestone > Phase 分解 |
| `quick` | 快速任务 |
| `/maestro-overlay` | Overlay 管理 — 自然语言创建，或 `--amend` 从信号自动生成修正补丁 |
| `grill` | 压力测试 — 对计划或需求进行代码库现实性压力测试 |
| `/maestro-next` | 智能导航 — 检测状态并推荐下一步最优命令 |
| `/maestro-ralph --engine swarm` | Swarm 并行加速器 — 多 agent 并发执行 |
| `/maestro-ralph --engine universal` | 动态对抗工作流生成器 |

### 理解层 + 执行管线 (pipeline)

| 命令 | 用途 |
|------|------|
| `analyze` | 双层分析 — 宏观(文本参数)探索影响面 / 微观(数字参数)Phase 级深入 |
| `plan` | 任务规划 — 支持 `--from analyze:ANL-xxx` 直达 |
| `execute` | 任务执行 |

### 质量管线 (quality)

| 命令 | 用途 |
|------|------|
| `review` | 代码审查 |
| `auto-test` | 自动测试 |
| `test` | 业务测试 |
| `debug` | 质量调试 |
| `/quality-refactor` | 重构 |
| `retrospective` | 复盘 |

### 管理命令 (manage)

| 命令 | 用途 |
|------|------|
| `/maestro-manage issue` | Issue 管理 |
| `/maestro-manage issue discover` | Issue 发现 |
| `/maestro-manage knowledge knowhow` | 知识管理 |
| `/maestro-manage knowledge capture` | 知识捕获 |
| `/maestro-manage status` | 状态查看 |
| `/maestro-manage knowledge wiki` | Wiki 管理 |
| `/maestro-manage knowledge harvest` | 收获 |
| `/maestro-manage sync rebuild` | 代码库重建 |
| `/maestro-manage knowledge extractors` | 知识图谱提取器管理 |
| `/maestro-manage knowledge audit` | 知识审计 |

### Odyssey 长周期循环 (odyssey)

单入口 `/maestro-odyssey <intent> --mode <name>`（`--mode` 可省略，从 intent 关键词自动识别）：

| 模式 | 用途 |
|------|------|
| `--mode debug` | 长周期调试 — 考古、诊断、修复、泛化 |
| `--mode improve` | 长周期代码改进 — 多维审计、深度诊断、定向修复 |
| `--mode review` | 深度审查修复循环 |
| `--mode planex` | 需求驱动迭代 — 计划/执行/验证/修复循环 |
| `--mode ui` | 长周期 UI 优化 — 视觉调研、多维审计、修复 |

## Workflow Mapping

### 层级模型

```
Roadmap > Milestone > Phase > Task
```

- **Roadmap** = 项目级常驻规划文档
- **Milestone** = 可独立交付的版本节点（v0.1.0-rc1, v0.2.0）
- **Phase** = Milestone 内的同步屏障执行阶段
- **Task** = Phase 内的具体代码修改单元（wave DAG 管理并行）

### 命令拓扑

```
上游起源层（并列，可选）
  brainstorm（发散/轻量）  |  blueprint（收敛/重型）  |  grill（压力测试）

理解层
  analyze 双层: 宏观(文本参数) → scope_verdict | 微观(数字参数) → Phase 级决策

编排层（可选）
  roadmap — 消费上游 context，纯 Milestone > Phase 分解

执行层
  plan → execute

Odyssey 长周期循环（独立路径）
  maestro-odyssey --mode debug|improve|review|planex|ui

自适应引擎（高级）
  ralph → 自运行决策循环
  swarm-workflow / universal-workflow → 多 agent 并行执行
```

### 合法路径

| 路径 | 场景 | 命令序列 |
|------|------|---------|
| Path A | 完整新项目 | `brainstorm` → `blueprint`(可选) → `analyze "topic"` → `roadmap` → `analyze 1` → `plan 1` → `execute` |
| Path B | 旧项目大功能 | `analyze "feature X"` → `roadmap` → `analyze 1` → `plan 1` → `execute` |
| Path C | 中等功能 | `analyze "feature X"` → `plan --from analyze:ANL-xxx` → `execute` |
| Path D | 小改动 | `plan "fix auth bug"` → `execute` |
| Path E | 纯规格文档 | `blueprint "project idea"` → (供人阅读) |
| Path F | 纯探索 | `brainstorm "idea"` → (供人决策) |
| 快速修复 | 已知简单问题 | `quick "修复描述"` |
| Bug 追踪 | Issue 闭环 | `/maestro-manage issue discover` → `/maestro-manage issue create` → analyze/plan/execute → close |
| 全自动 | /maestro 入口 | `/maestro -y "任务描述"` |
| 代码审查 | 质量管线 | `review` → `auto-test` → `test` |
| 多 CLI 交叉验证 | Collab step | `collab "需求描述"` |
| 长周期调试 | Odyssey 深度循环 | `/maestro-odyssey "问题描述" --mode debug` |
| 长周期改进 | Odyssey 深度循环 | `/maestro-odyssey "改进目标" --mode improve` |
| 需求迭代 | Odyssey 深度循环 | `/maestro-odyssey "需求描述" --mode planex` |

> 注：Path A/B 中 `analyze 1` / `plan 1` 的数字 `1` 指 **milestone 编号**（第 1 个里程碑），下游以 milestone 为入口。

## Core Rules

1. **Catalog First**: 先查 catalog.json，再按需读 source 文件
2. **Guide 链接**: 对深层问题引用 guide/ 文档，告知用户具体文件名
3. **上下文感知**: 检查 .workflow/ 存在性和 state.json 当前状态
4. **精确匹配**: 搜索时支持命令名（不含前缀）、分类名、关键词
5. **不执行命令**: 本 skill 只提供信息和推荐，不执行任何 maestro 命令

## Error Handling

| 场景 | 处理 |
|------|------|
| 命令未找到 | 模糊搜索最近匹配，提示正确命令名 |
| 项目未初始化 | 推荐先运行 `/maestro-init` |
| Guide 文件不存在 | 跳过，仅提供 catalog 中的描述 |
| 参数为空 | 默认进入 Beginner Onboarding 模式 |

## Related Resources

- **Guide 目录**: `guide/` — 17 个专题指南文档
- **Delegate 参考**: `~/.maestro/workflows/delegate-usage.md`
- **Coding 哲学**: `~/.maestro/workflows/coding-philosophy.md`
- **CLI 工具配置**: `~/.maestro/cli-tools.json`

## Statistics

- **Slash 命令**: 64 个（13 个分类：core/pipeline/milestone/manage/quality/spec/learn/worktree/team/ralph/ui/tools/odyssey）
- **CLI 命令**: 21 个
- **Skills**: 44 个（5 个分类：meta/team/knowledge/quality/scholar）
- **Agents**: 24 个（4 个分类：workflow/team/cli/ui）
- **Guide 文档**: 17 个（planned，尚未创建）
- **工作流路径**: 7 个合法路径 (Path A-G) + 4 个辅助流程
