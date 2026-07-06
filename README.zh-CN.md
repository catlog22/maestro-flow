<div align="center">

# Maestro-Flow

### 多智能体时代的意图驱动工作流编排

**描述你想要什么，Maestro 负责搞定。**

<br/>

[![npm version](https://img.shields.io/npm/v/maestro-flow?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/maestro-flow)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[简体中文](README.zh-CN.md)

</div>

<br/>

> 大多数 AI 编程工具只能让一个 agent 做一件事。
> Maestro-Flow 编排**多个 agent 横跨整个开发生命周期** — 从头脑风暴到部署上线 — 通过自适应决策引擎、自增强知识图谱和实时可视化仪表盘。

<br/>

## 两大支柱

Maestro-Flow 建立在两个相互增强的系统之上：

```
                         ┌─────────────────────────────────────┐
                         │         Maestro-Flow                │
                         │                                     │
          ┌──────────────┴──────────────┐  ┌──────────────────┴───────────────┐
          │      工作流编排              │  │         知识系统                  │
          │                             │  │                                  │
          │  意图路由                    │  │  MaestroGraph (SQLite)            │
          │    └─ 40+ 链类型            │  │    └─ 代码 + 知识统一存储        │
          │  Ralph 决策引擎             │  │  Spec 注入 (Hooks)               │
          │    └─ 11 状态 FSM           │  │    └─ 自动注入 agent 提示词      │
          │  质量管线                    │  │  Wiki + BM25 搜索               │
          │    └─ verify → review → test│  │    └─ 反向链接 + 健康评分        │
          │  多智能体调度                │  │  学习循环                        │
          │    └─ Claude, Gemini, Codex │  │    └─ 复盘 → 持久化 → 注入      │
          │                             │  │                                  │
          └─────────────┬───────────────┘  └──────────────────┬───────────────┘
                        │          ▲              │            ▲
                        │          │  知识注入    │            │
                        │          └──────────────┘            │
                        │     执行结果                          │
                        └──────────────────────────────────────┘
```

**工作流产生知识，知识改善未来的工作流。** Agent 从每次会话中学习，将发现持久化为 spec 和 knowhow，未来的 agent 通过 hook 注入自动获取这些上下文 — 形成自增强循环。

---

## 安装

```bash
npm install -g maestro-flow
maestro install
```

**前置条件**：Node.js ≥ 18，Claude Code CLI。可选：Codex CLI、Gemini CLI 用于多智能体工作流。

`maestro install` 提供交互式组件选择器 — 可选择安装哪些资产（命令、Hook、MCP、Agent）。使用 `maestro workspace link` 跨多个项目共享知识（spec、knowhow、domain）。

---

## 快速开始

### Ralph 引擎

**`/maestro-ralph`** 是主推入口 — 闭环生命周期引擎，自动读取项目状态，推断你在开发生命周期中的位置，构建自适应命令链：

```bash
/maestro-ralph "实现基于 OAuth2 的用户认证，带 refresh token"
```

Ralph 自动判断你在哪个阶段（brainstorm → plan → execute → verify → review → test → milestone），构建相应命令链。关键检查点的 decision 节点根据实际结果，动态插入 debug → fix → retry 循环。

```bash
/maestro-ralph status              # 查看会话进度
/maestro-ralph continue            # decision 暂停后恢复
/maestro-ralph -y "搭建 REST API"   # 全自动模式，无人值守
```

### 其他入口

| 命令 | 适用场景 |
|------|---------|
| `/maestro "..."` | 描述意图，AI 自动路由最优命令链 |
| `/maestro-quick` | 快速修复、小功能（analyze → plan → execute） |
| `/maestro-*` | 逐步执行：brainstorm、blueprint、analyze、plan、execute、verify |

### Odyssey — 长周期迭代循环

Odyssey 命令运行扩展的自校正循环，组合考古式分析、诊断、修复、验证和知识持久化，直到满足验收标准：

| 命令 | 聚焦场景 |
|------|---------|
| `odyssey-debug` | 调试循环 — 考古分析、诊断、修复、确认、泛化 |
| `odyssey-planex` | 需求驱动循环 — 计划、执行、严格验证、修复迭代 |
| `odyssey-improve` | 代码库改进 — 多维审计、定向修复、验证 |
| `odyssey-review-test-fix` | 深度审查 + 修复 — 多维审查、定向修复、泛化 |
| `odyssey-ui` | UI 优化 — 视觉巡检、审计、发散探索、修复 |

---

## 工作流编排

### 自适应生命周期引擎

Ralph 是一个 11 状态有限状态机，**只做决策，不做执行**。它读取项目状态，推断生命周期位置，构建带质量门的命令链，将执行交给 `maestro-ralph-execute`。在每个 decision 节点（`◆`），Ralph 评估实际结果并决定：继续前进，还是插入 debug → fix → retry 循环。

```
brainstorm → blueprint(可选) → init → analyze(宏观) → roadmap(可选) → analyze(微观) → plan → execute → verify
                                                                                                 ◆ decision
                                              review ─── ◆ ─── test ─── ◆ ─── milestone-audit → milestone-complete
                                                                                                 ◆ → 下一里程碑
```

**三种质量模式**控制质量深度：

| 模式 | 管线 | 适用场景 |
|------|------|---------|
| `full` | verify → business-test → review → test-gen → test | 生产环境、安全关键代码 |
| `standard` | verify → review → test | 默认，平衡质量 |
| `quick` | verify → CLI-review | 原型开发、快速修复 |

### 意图驱动路由

你不需要编写 pipeline YAML。用自然语言描述意图，Maestro 将其分类到 **40+ 链类型**中，每种都是预组合的命令序列。同一意图在不同项目状态下产生不同的链：

```bash
/maestro "添加用户个人资料页"
# → 新项目:     brainstorm → blueprint → analyze → plan → execute → verify
# → 已有项目:    analyze → plan → execute → verify
# → 快速修复:    plan → execute → verify
```

### 分层命令拓扑

命令按四层组织：

| 层级 | 用途 | 命令 |
|------|------|------|
| **起源层** | 发散创意，收敛方向 | brainstorm、blueprint |
| **理解层** | 探索范围（宏观）+ 深入研究（微观） | analyze（双模式） |
| **编排层** | 组织为里程碑和阶段 | roadmap |
| **执行层** | 计划、实现、验证 | plan、execute、verify、review、test |

6 条规范路径（A–F）覆盖从全新项目到单行修复的所有场景。

### 多智能体调度

Maestro 通过四种可组合的编排模式协调 **Claude Code、Codex、Gemini、Qwen、OpenCode**：

| 模式 | 工作方式 |
|------|---------|
| **Delegate** | 通过 `maestro delegate` 派发到任意 CLI 工具，SQLite 任务中介管理异步执行，支持消息注入和链式调用 |
| **Team** | 协调器-工人架构 — 协调器生成角色规格，并行派生 `team-worker` agent，由常驻质量观察者监督 |
| **Wave** | 任务拓扑排序为依赖波次，波次内独立任务并行执行 |
| **Swarm** | ACO 蚁群驱动的多智能体探索，信息素引导收敛 |

这些模式可以**组合**：团队协调器可将子任务委托给不同的 LLM 后端，波次执行并行化独立工作，仪表盘提供实时监控 — 所有模式共享中介和消息总线作为协调原语。

---

## 知识系统

### 知识图谱（MaestroGraph）

**MaestroGraph** 是统一的代码索引引擎，替代了原有的 CodeGraph 外部依赖。基于 `web-tree-sitter` 实现 AST 级提取，将**代码结构**（函数、类、调用链）和**项目知识**（spec、knowhow、领域术语、issue）存储在同一个 SQLite 图数据库中，配备双 FTS5 索引。

```bash
maestro kg search <symbol>        # 查找节点
maestro kg context <node>         # 获取上下文
maestro kg callers <function>     # 追溯调用链
maestro kg callees <function>     # 追溯依赖
```

### Spec 注入

项目规则（编码规范、架构约束、质量标准）以带关键词标签的 `<spec-entry>` 格式存储。**Hook 自动将相关 spec 注入每个 agent 的提示词** — agent 无需手动加载即可获得项目专属规则。

### 自增强学习循环

```
Agent 执行任务
    → 发现模式/陷阱/决策
    → 持久化为 spec 条目或 knowhow 文档
    → Hook 系统索引新知识
    → 未来 agent 通过提示词注入自动获取
    → 更好的执行 → 更多发现 → ...
```

四个学习工具驱动这个循环：`learn-retro`（复盘）、`learn-follow`（模式学习）、`learn-decompose`（架构拆解）、`learn-investigate`（深度探究）。

### 领域知识

语义词汇表层，定义项目中**事物的含义**。Domain 术语（`maestro domain`）标准化命名、映射概念关系，并作为 MaestroGraph 的知识源之一 — 桥接代码级符号与业务级概念。

### Wiki 与搜索

WikiIndexer 遍历 `.workflow/` 目录，解析 frontmatter，构建反向链接图，并创建 **BM25 倒排索引**用于全文搜索 — 覆盖所有项目知识：spec、knowhow、issue 以及 KG 节点的虚拟条目。

---

## Issue 闭环

Issue 不仅是工单，更是自修复管线：

```
discover → analyze → plan → execute → close
    ▲                                    │
    └────── 质量命令自动创建 ──────────────┘
```

质量命令（review、test、verify）自动为发现的问题创建 Issue，修复代码回流到阶段管线。

---

## 可视化仪表盘

实时仪表盘 `http://127.0.0.1:3001` — Kanban 看板、甘特时间线、可排序表格、指挥中心。在 Issue 卡片上选择智能体，一键派发。

```bash
maestro serve                  # 启动 Web 仪表盘
maestro view                   # 终端 TUI 替代方案
maestro command-help           # 交互式命令参考（别名: ch）
```

基于 React 19、Zustand、Tailwind CSS 4、Framer Motion、Hono、WebSocket 构建。

---

## 项目概览

| 指标 | 数量 |
|------|------|
| 源文件 (TypeScript) | 333 |
| 代码行数 | ~80,700 |
| 斜杠命令 | 64 |
| 工作流定义 | 115 |
| 技能包 | 45 |
| Agent 定义 | 23 |
| CLI 命令 | 35+ |
| 模板 | 92 |
| 指南（双语） | 76 |

### 技术栈

| 层级 | 技术 |
|------|------|
| CLI | Commander.js, TypeScript, ESM |
| MCP | @modelcontextprotocol/sdk (stdio) |
| 知识图谱 | better-sqlite3, Drizzle ORM, web-tree-sitter |
| 前端 | React 19, Zustand, Tailwind CSS 4, Framer Motion, Radix UI |
| 后端 | Hono, WebSocket, SSE |
| 智能体 | Claude Agent SDK, Codex CLI, Gemini CLI, OpenCode |
| 构建 | Vite 6, TypeScript 5.7, Vitest |

### 架构

```
maestro/
├── bin/                     # CLI 入口
├── src/                     # 核心 CLI (Commander.js + MCP SDK)
│   ├── commands/            # 35+ 个 CLI 命令
│   ├── mcp/                 # MCP 服务器 (stdio 传输)
│   ├── graph/               # 知识图谱 (SQLite + tree-sitter)
│   └── core/                # 工具注册、扩展加载器
├── dashboard/               # 实时 Web 仪表盘
│   └── src/
│       ├── client/          # React 19 + Zustand + Tailwind CSS 4
│       ├── server/          # Hono API + WebSocket + SSE
│       └── shared/          # 共享类型
├── .claude/
│   ├── commands/            # 64 个斜杠命令 (.md)
│   ├── agents/              # 23 个 Agent 定义 (.md)
│   └── skills/              # 45 个技能包
├── workflows/               # 115 个工作流定义 (.md)
├── templates/               # 92 个 JSON 模板
└── extensions/              # 插件系统
```

---

## 文档

**快速入门**
- **[快速开始指南](guide/quick-start-guide.md)** — 安装、第一个工作流、核心概念
- **[安装指南](guide/install-guide.md)** — 分步安装、组件选择、工作空间配置
- **[Maestro Ralph 指南](guide/maestro-ralph-guide.md)** — 自适应生命周期引擎、decision 节点、质量模式

**工作流**
- **[命令使用指南](guide/command-usage-guide.md)** — 全部 64 个命令，含工作流图表和管线衔接
- **[CLI 命令参考](guide/cli-commands-guide.md)** — 全部 35+ 个终端命令
- **[工作流结构指南](guide/workflow-structure-guide.md)** — 命令拓扑、链组合
- **[质量管线指南](guide/quality-pipeline-guide.md)** — verify、review、test 管线
- **[Maestro 协调器指南](guide/maestro-coordinator-guide.md)** — 多智能体协调模式

**知识系统**
- **[知识管理指南](guide/knowledge-management-guide.md)** — KG、spec、knowhow、wiki
- **[搜索系统指南](guide/search-system-guide.md)** — 统一 BM25F 搜索、MaestroGraph 集成、类型过滤
- **[MaestroGraph 设计文档](guide/plan-maestrograph.md)** — 统一 KG 引擎设计、CodeGraph 替代、tree-sitter 集成
- **[领域知识设计文档](guide/plan-domain-knowledge.md)** — 语义词汇表、术语关系、概念层
- **[Spec 系统指南](guide/spec-system-guide.md)** — spec 条目、关键词加载、验证 Hook
- **[Hook 系统指南](guide/hooks-guide.md)** — 17 个 Hook、Spec 注入、上下文预算
- **[学习工具指南](guide/learn-tools-guide.md)** — 复盘、跟读、拆解、探究

**进阶**
- **[Delegate 异步执行指南](guide/delegate-async-guide.md)** — 多 CLI 委派、消息注入、链式调用
- **[Overlay 系统指南](guide/overlay-guide.md)** — 非侵入式命令扩展
- **[Worktree 并行开发指南](guide/worktree-guide.md)** — 里程碑级并行开发
- **[跨工作空间指南](guide/workspace-guide.md)** — 跨项目知识共享、link/unlink
- **[MCP 工具参考](guide/mcp-tools-guide.md)** — 全部 9 个 MCP 端点工具
- **[Collab 协作指南](guide/team-lite-guide.md)** — 2-8 人团队协作

---

## 与其他工具的对比

AI 编程工作流领域正在快速发展。以下是 Maestro-Flow 与其他开源工具的定位对比 — 每个工具对同一目标采取了不同的路径：

| | [Superpowers](https://github.com/obra/superpowers) | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | [Trellis](https://github.com/mindfold-ai/trellis) | **Maestro-Flow** |
|---|---|---|---|---|
| **聚焦方向** | Agent 方法论与可组合技能 | 规格驱动开发生命周期 | 跨平台项目层 | 全生命周期编排 + 知识系统 |
| **架构** | 纯 `.md` 技能文件，无运行时 | 轻量 CLI + 规格脚手架 | 项目层脚手架 (`.trellis/`) | 运行时引擎，SQLite 知识图谱 |
| **多智能体** | 单 Agent 技能选择 | 单 Agent 规格引导 | 跨平台上下文共享 | 多后端调度（Claude、Codex、Gemini、Qwen、OpenCode），4 种编排模式 |
| **决策引擎** | 手动技能组合 | 流动式规格阶段 | 带自动验证的工作流门 | Ralph — 11 状态 FSM，自适应 decision 节点，自动重试循环 |
| **长时会话** | 单次对话 | 单次对话 | 基于日志的连续性 | Odyssey 迭代循环 — 自校正循环直到验收标准达成 |
| **知识持久化** | — | 规格归档 | 工作空间日志 | 自增强知识图谱 — spec、knowhow、wiki、领域术语，BM25 搜索 + Hook 自动注入 |
| **命令衔接** | — | Explore → Propose → Apply | 限定范围的任务门 | 40+ 意图分类链类型，根据项目状态动态路由 |

**每个工具都有鲜明的优势。** Superpowers 擅长塑造 Agent *如何思考* — 其方法论优先的理念和庞大社区已为 prompt 工程树立了标杆。OpenSpec 为规格层带来了严谨性，确保 AI 与开发者在写代码前就 *做什么* 达成一致。Trellis 解决了多平台难题 — 在一个 AI 工具中开始功能开发，在另一个中无缝继续。

**Maestro-Flow 聚焦三个方向：**

- **长时工作** — Odyssey 命令运行扩展的自校正循环，组合考古式分析、诊断、修复、验证和知识持久化，直到验收标准达成。会话可以持续数小时，引擎持续维护状态、调整策略、持久化发现。
- **命令灵活衔接** — 不是固定管线，Ralph 引擎读取项目状态，动态构建带质量门的命令链。Decision 节点评估实际结果，在需要时插入 debug → fix → retry 循环。40+ 种链类型覆盖从全新项目到单行修复的所有场景。
- **完善度** — 统一平台覆盖 brainstorm → blueprint → analyze → plan → execute → verify → review → test → milestone，知识系统将学习成果自动反馈给未来的工作流。

---

## 致谢

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** by TACHES — 规格驱动开发模型和上下文工程理念。
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — 前身项目，开创了多 CLI 编排和 skill 路由工作流。
- **[Impeccable](https://github.com/pbakaus/impeccable)** by [@pbakaus](https://github.com/pbakaus) — UI 设计技能，集成为 `maestro-impeccable`。基于 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 许可。

## 贡献者

<a href="https://github.com/catlog22">
  <img src="https://github.com/catlog22.png" width="60px" alt="catlog22" style="border-radius:50%"/>
</a>

**[@catlog22](https://github.com/catlog22)** — 创建者 & 维护者

## 交流群

欢迎加入微信群交流反馈：

<img src="assets/wechat-group-qr.png" width="200" alt="微信群: Claude Code Workflow交流群 2" />

## 友情链接

- [Linux DO：学AI，上L站！](https://linux.do/)

## 许可证

MIT
