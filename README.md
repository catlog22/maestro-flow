<div align="center">

# Maestro-Flow

### 意图驱动的多智能体工作流编排框架

**说出你要做什么，Maestro 自动规划、调度、执行、验证。**

<br/>

[![npm version](https://img.shields.io/npm/v/maestro-flow?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/maestro-flow)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[简体中文](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[English](README.en.md)

</div>

<br/>

> 大多数 AI 编程工具只能让一个 Agent 做一件事。
> Maestro-Flow 让**多个 Agent 协同完成从头脑风暴到部署上线的全流程** — 自适应决策引擎根据实际结果动态调整策略，知识图谱将每次执行的经验自动积累到下一次。

<br/>

## 核心能力

**自适应编排** — Ralph v2 引擎读取项目状态，将自然语言意图分类到 40+ 种命令链，在关键节点根据实际执行结果动态决策：继续、回退、还是插入修复循环。不写 YAML，不配置管线。

**跨后端调度** — 同一工作流中混用 Claude、Codex、Gemini、Qwen、OpenCode，四种编排模式按需组合：Delegate（异步委派）、Team（角色协作）、Wave（依赖并行）、Swarm（蚁群探索）。

**知识自增强** — Agent 执行中发现的模式、陷阱、决策，自动持久化为 Spec 和 Knowhow。Hook 系统将相关知识注入后续 Agent 的提示词 — 项目越用越聪明。

**长周期自校正** — Odyssey 系列命令运行数小时级的自主循环，每个检查点自适应调整策略，直到满足验收标准。

---

## 安装

```bash
npm install -g maestro-flow
maestro install          # 交互式选择安装组件
```

需要 Node.js ≥ 18 和 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)。多 Agent 工作流可选装 Codex CLI、agy CLI。

---

## 快速上手

### Ralph v2 — 自适应生命周期引擎

主入口。说出目标，Ralph 自动判断开发阶段、构建命令链、在 decision 节点动态调整：

```bash
/maestro-ralph-v2 "实现 OAuth2 认证，支持 refresh token"

# Ralph 自动构建链：analyze → plan → execute → verify → review → test
# 遇到失败 → 自动插入 debug → fix → retry 循环
# 遇到新项目 → 自动前置 brainstorm → blueprint
```

```bash
/maestro-ralph-v2 status      # 查看当前会话进度
/maestro-ralph-v2 continue    # 从 decision 暂停点恢复
/maestro-ralph-v2 -y "..."    # 全自动，无需确认
```

### 核心管线

```
意图输入 → Ralph 分类（40+ 链类型）
              │
              ▼
brainstorm → blueprint(opt) → analyze → plan → execute → verify
                                                           ◆ decision
                                    review ── ◆ ── test ── ◆ ── milestone
                                                           ◆ → 下一里程碑
```

三种质量模式控制管线深度：

| 模式 | 管线 | 适用场景 |
|------|------|---------|
| `full` | verify → business-test → review → test-gen → test | 生产环境、安全关键 |
| `standard` | verify → review → test | 默认平衡 |
| `quick` | verify → CLI-review | 原型、热修 |

### 其他入口

```bash
/maestro "添加用户资料页"           # 意图路由，自动选链
/maestro-quick "修复重定向 bug"     # 最短链路：plan → execute → verify
```

### Odyssey — 长周期自主循环

适合大型调试、深度重构、UI 优化等需要持续迭代的场景：

| 命令 | 循环模式 |
|------|---------|
| `/odyssey-debug` | 考古分析 → 诊断 → 修复 → 确认 → 泛化 → 知识沉淀 |
| `/odyssey-planex` | 需求解析 → 计划 → 执行 → 严格验证 → 修复循环 |
| `/odyssey-improve` | 多维审计 → 深度诊断 → 定向修复 → 验证 → 泛化 |
| `/odyssey-review-test-fix` | 多维审查 → 定向修复 → 测试 → 泛化 → 知识沉淀 |
| `/odyssey-ui` | 视觉巡检 → 多维审计 → 发散探索 → 修复 → 验证 |

每个 Odyssey 命令持续运行直到验收标准达成，中间自适应调整策略，发现的知识自动持久化。

---

## 文档

### 入门

| | 指南 | 说明 |
|---|------|------|
| **01** | [快速开始](guide/quick-start-guide.md) | 安装、第一个工作流、核心概念 |
| **02** | [安装指南](guide/install-guide.md) | 组件选择、工作空间配置 |
| **03** | [Ralph 引擎](guide/maestro-ralph-guide.md) | 自适应决策、quality 模式、session 管理 |
| **04** | [命令大全](guide/command-usage-guide.md) | 64 个命令的用法、流程图、管线衔接 |

### 日常使用

| 指南 | 说明 |
|------|------|
| [CLI 命令参考](guide/cli-commands-guide.md) | 35+ 终端命令速查 |
| [知识管理](guide/knowledge-management-guide.md) | 知识图谱、Spec、Knowhow、Wiki 全景 |
| [Spec 系统](guide/spec-system-guide.md) | 项目规则的编写、加载与自动注入 |
| [质量管线](guide/quality-pipeline-guide.md) | verify → review → test 三级管线 |
| [Hook 机制](guide/hooks-guide.md) | 17 个 Hook 的触发时机与上下文预算控制 |

<details>
<summary><b>进阶 &amp; 设计文档</b>（点击展开）</summary>
<br/>

| 指南 | 说明 |
|------|------|
| [工作流结构](guide/workflow-structure-guide.md) | 四层命令拓扑、六条规范路径 |
| [多 Agent 协调](guide/maestro-coordinator-guide.md) | Delegate / Team / Wave / Swarm 详解 |
| [Delegate 异步执行](guide/delegate-async-guide.md) | 跨 CLI 委派、消息注入、链式调用 |
| [Overlay 扩展](guide/overlay-guide.md) | 不改源码给命令加行为 |
| [Worktree 并行开发](guide/worktree-guide.md) | 里程碑级分支隔离 |
| [跨项目共享](guide/workspace-guide.md) | 多项目 link/unlink 知识库 |
| [MCP 工具](guide/mcp-tools-guide.md) | 9 个 MCP 端点工具参考 |
| [团队协作](guide/team-lite-guide.md) | 2–8 人 Collab 模式 |
| [搜索系统](guide/search-system-guide.md) | BM25F 全文搜索与 KG 集成 |
| [学习工具](guide/learn-tools-guide.md) | 复盘、跟读、拆解、探究四件套 |
| [MaestroGraph 设计](guide/plan-maestrograph.md) | 统一知识图谱引擎架构 |
| [领域知识设计](guide/plan-domain-knowledge.md) | 语义词汇表与概念关系网络 |

</details>

---

## 项目规模

333 个 TypeScript 源文件 / ~80k 行代码 / 64 斜杠命令 / 45 技能包 / 23 Agent 定义 / 35+ CLI 命令 / 92 模板

**技术栈**&nbsp;&nbsp;Commander.js · MCP SDK · better-sqlite3 · web-tree-sitter · React 19 · Zustand · Tailwind CSS 4 · Hono · Vite 6

<details>
<summary><b>目录结构</b></summary>

```
maestro/
├── src/                     # 核心 CLI（Commander.js + MCP SDK）
│   ├── commands/            # 35+ CLI 命令
│   ├── mcp/                 # MCP 服务器（stdio）
│   ├── graph/               # 知识图谱（SQLite + tree-sitter）
│   └── core/                # 工具注册、扩展加载
├── dashboard/               # Web 仪表盘（React 19）
├── .claude/
│   ├── commands/            # 64 斜杠命令
│   ├── agents/              # 23 Agent 定义
│   └── skills/              # 45 技能包
├── workflows/               # 115 工作流定义
└── templates/               # 92 JSON 模板
```

</details>

---

<details>
<summary><b>与同类工具对比</b></summary>
<br/>

| | [Superpowers](https://github.com/obra/superpowers) | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | [Trellis](https://github.com/mindfold-ai/trellis) | **Maestro-Flow** |
|---|---|---|---|---|
| **定位** | Agent 技能框架 | 规格驱动开发 | 多平台 Agent 治具 | 意图驱动编排 |
| **架构** | 纯 `.md`，无运行时 | CLI + Git | CLI + `.trellis/` | CLI + MCP + SQLite |
| **路由** | 手动选技能 | 手动命令序列 | 固定阶段 | AI 分类 40+ 链 |
| **多 Agent** | 子 Agent 调度 | 单 Agent | Channel 模式 | 4 模式 × 5 后端 |
| **知识** | 仅 Git | Git 归档 | 文件日志 | SQLite KG + 自动注入 |
| **长时工作** | 上下文窗口 | 手动 continue | 日志恢复 | 有状态 Odyssey 循环 |
| **自校正** | review-fix 循环 | 手动重验 | 手动 | Decision 节点自动重试 |

**各有所长**：Superpowers 的 prompt 工程方法论最成熟；OpenSpec 的需求规格化最严谨；Trellis 的多平台统一做得最好；Maestro-Flow 聚焦全生命周期编排、跨后端调度和知识自增强。

</details>

---

## 致谢

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** — Spec 驱动开发与上下文工程理念
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — 前身项目，开创多 CLI 编排
- **[Impeccable](https://github.com/pbakaus/impeccable)** — UI 设计技能（[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)）

---

<div align="center">

**[@catlog22](https://github.com/catlog22)** — 创建者 & 维护者

加入微信群交流：

<img src="assets/wechat-group-qr.png" width="180" alt="微信群" />

<br/><br/>

[Linux DO：学AI，上L站！](https://linux.do/)

<br/>

MIT License

</div>
