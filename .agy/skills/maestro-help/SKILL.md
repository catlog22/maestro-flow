---
name: maestro-help
description: Maestro Flow 命令帮助系统。搜索命令、浏览技能、工作流推荐、新手引导。Triggers on "maestro-help", "帮助", "命令", "怎么用", "skill", "workflow", "maestro 怎么用".
allowed-tools:
  - ask_question
  - grep_search
  - view_file
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
| `commands[]` | 55 个 slash 命令，含分类和描述 |
| `skills[]` | 10 个 Skill，含分类和描述 |
| `agents[]` | 22 个 Agent，含分类和描述 |
| `cli_commands[]` | 21 个终端命令 |
| `guide_files[]` | 17 个 Guide 文档索引 |
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

### 核心工作流 (core)

| 命令 | 用途 |
|------|------|
| `/maestro` | 智能协调器，自动路由 |
| `/maestro-init` | 项目初始化 |
| `/maestro-roadmap` | 路线图生成 |
| `/maestro-quick` | 快速任务 |
| `/maestro-brainstorm` | 头脑风暴 |
| `/maestro-overlay` | Overlay 管理 |
| `/maestro-amend` | 修正补丁 |

### Phase 管线 (pipeline)

| 命令 | 用途 |
|------|------|
| `/maestro-analyze` | 多维分析 |
| `/maestro-plan` | 任务规划 |
| `/maestro-execute` | 任务执行 |
| `/maestro-verify` | 验证确认 |

### 质量管线 (quality)

| 命令 | 用途 |
|------|------|
| `/quality-review` | 代码审查 |
| `/quality-auto-test` | 自动测试 |
| `/quality-test` | 业务测试 |
| `/quality-debug` | 质量调试 |
| `/quality-refactor` | 重构 |
| `/quality-retrospective` | 复盘 |

### 管理命令 (manage)

| 命令 | 用途 |
|------|------|
| `/manage-issue` | Issue 管理 |
| `/manage-issue-discover` | Issue 发现 |
| `/manage-knowhow` | 知识管理 |
| `/manage-status` | 状态查看 |
| `/manage-wiki` | Wiki 管理 |
| `/manage-harvest` | 收获 |

## Workflow Mapping

| 任务类型 | 推荐工作流 | 命令序列 |
|---------|-----------|---------|
| 新项目 | 初始化路径 | `/maestro-init` → `/maestro-roadmap` |
| 正常开发 | 主干管线 | `/maestro-analyze` → `/maestro-plan` → `/maestro-execute` → `/maestro-verify` |
| 快速修复 | 快速渠道 | `/maestro-quick "修复描述"` |
| Bug 追踪 | Issue 闭环 | `/manage-issue-discover` → `/manage-issue create` → analyze/plan/execute → close |
| 全自动 | /maestro 入口 | `/maestro -y "任务描述"` |
| 代码审查 | 质量管线 | `/quality-review` → `/quality-auto-test` → `/quality-test` |
| 团队开发 | Team Lite | `/maestro-collab` |

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

- **Slash 命令**: 55 个（7 个分类）
- **CLI 命令**: 21 个
- **Skills**: 10 个（3 个分类）
- **Agents**: 22 个（5 个分类）
- **Guide 文档**: 17 个
- **工作流**: 4 个主要模板
