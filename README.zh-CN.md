<div align="center">

# Maestro-Flow

### 多智能体时代的编排层

**不仅是执行，更是编排。**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

Maestro-Flow 是一个面向 Claude Code、Codex、Gemini 等多智能体的工作流编排框架。你只需描述意图，Maestro-Flow 自动路由到最优命令链，驱动多个 AI 智能体并行执行，通过自适应决策节点、实时仪表盘和知识图谱形成完整的项目交付闭环。

---

## 安装

```bash
npm install -g maestro-flow
maestro install
```

**前置条件**：Node.js >= 18，Claude Code CLI。可选：Codex CLI、Gemini CLI 用于多智能体工作流。

---

## 快速开始

**`/maestro-ralph`** 是主推入口 — 闭环生命周期引擎，自动读取项目状态、推断当前位置、构建自适应命令链并驱动执行：

```bash
/maestro-ralph "实现基于 OAuth2 的用户认证，带 refresh token"
```

Ralph 自动判断你在生命周期中的位置（brainstorm → roadmap → analyze → plan → execute → verify → review → test → milestone-complete）并构建相应命令链。关键检查点的 decision 节点根据实际执行结果，动态插入 debug → fix → retry 循环。

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
| `/maestro-*` | 逐步执行：init、roadmap、analyze、plan、execute、verify |

---

## 核心特性

### 1. 自适应生命周期引擎（`maestro-ralph`）

读取项目状态 → 推断生命周期位置 → 构建含 decision 节点的命令链。每个检查点读取实际执行结果，决定继续还是插入 debug → fix → retry 循环。链在运行中动态增长/收缩。

```
brainstorm → init → roadmap → analyze → plan → execute → verify
                                              ◆ post-verify
                                              business-test
                                              ◆ post-business-test
                                              review
                                              ◆ post-review
                                              test
                                              ◆ post-test
                                              milestone-audit → milestone-complete
                                              ◆ post-milestone → 下一里程碑
```

三种质量模式：`full`（verify + business-test + review + test）、`standard`（verify + review + test）、`quick`（verify + CLI-review）。

### 2. 完整质量管线

每个 `◆` decision 节点是一个质量门禁，根据实际结果动态调整链路：

1. **verify** — 目标回溯验证：检查所有 plan 需求是否实现、架构约束校验、反模式扫描、Nyquist 测试覆盖率
2. **business-test** — PRD 前向业务测试：需求追溯、fixture 生成、验收标准多层执行
3. **review** — 多维度代码审查：正确性、可读性、性能、安全、测试、架构
4. **test-gen** — 覆盖率缺口分析 + 自动测试生成（TDD/E2E 分类，L0-L3 渐进层）
5. **test** — 交互式 UAT：探索性测试，会话持久化，缺口闭环

### 3. 结构化管线

49 个斜杠命令覆盖 6 大类别，驱动从项目初始化到质量复盘的每个阶段。所有产物存放于 `.workflow/scratch/`，由 `state.json` 追踪。

### 4. Issue 闭环

Issue 是自修复管线：discover → analyze → plan → execute → close。质量命令自动为发现的问题创建 Issue，修复代码回流到阶段管线。

### 5. 可视化仪表盘

实时看板 `http://127.0.0.1:3001`，React 19 + Tailwind CSS 4 + WebSocket 实时更新。Kanban 看板、甘特时间线、可排序表格、指挥中心。在 Issue 卡片上选择智能体，一键派发。

```bash
maestro serve                  # → http://127.0.0.1:3001
maestro view                   # 终端 TUI 替代方案
maestro command-help           # 在浏览器中打开交互式命令参考（别名: ch）
```

### 6. 多智能体引擎

并行协调 Claude Code、Codex、Gemini、Qwen、OpenCode。波次执行 — 独立任务并行，依赖任务等待前置完成。

### 7. 智能知识库

Wiki 知识图谱支持 BM25 搜索、反向链接遍历、健康评分。学习工具箱（retro、follow、decompose、investigate、second-opinion）汇入统一的 `lessons.jsonl` 知识库。

---

## 命令与 Agent

| 类别 | 数量 | 前缀 | 用途 |
|------|------|------|------|
| **核心工作流** | 18 | `maestro-*` | 全生命周期 — ralph、init、roadmap、analyze、plan、execute、verify、milestones、overlays |
| **管理** | 12 | `manage-*` | Issue 生命周期、代码库文档、知识捕获、记忆管理、状态 |
| **质量** | 9 | `quality-*` | review、test、debug、test-gen、integration-test、business-test、refactor、sync |
| **学习** | 5 | `learn-*` | 复盘、跟读、模式拆解、探究、多视角 |
| **规范** | 3 | `spec-*` | setup、add、load |
| **知识图谱** | 2 | `wiki-*` | 连接发现、知识摘要 |

`.claude/agents/` 下 21 个专业化 Agent 定义，Claude Code 按需加载。

---

## 架构

```
maestro/
├── bin/                     # CLI 入口
├── src/                     # 核心 CLI (Commander.js + MCP SDK)
│   ├── commands/            # 11 个 CLI 命令 (serve, run, cli, ext, tool, ...)
│   ├── mcp/                 # MCP 服务器 (stdio 传输)
│   └── core/                # 工具注册、扩展加载器
├── dashboard/               # 实时 Web 仪表盘
│   └── src/
│       ├── client/          # React 19 + Zustand + Tailwind CSS 4
│       ├── server/          # Hono API + WebSocket + SSE
│       └── shared/          # 共享类型
├── .claude/
│   ├── commands/            # 49 个斜杠命令 (.md)
│   └── agents/              # 21 个 Agent 定义 (.md)
├── workflows/               # 45 个工作流实现 (.md)
├── templates/               # JSON 模板 (task, plan, issue, ...)
└── extensions/              # 插件系统
```

| 层级 | 技术 |
|------|------|
| CLI | Commander.js, TypeScript, ESM |
| MCP | @modelcontextprotocol/sdk (stdio) |
| 前端 | React 19, Zustand, Tailwind CSS 4, Framer Motion, Radix UI |
| 后端 | Hono, WebSocket, SSE |
| 智能体 | Claude Agent SDK, Codex CLI, Gemini CLI, OpenCode |
| 构建 | Vite 6, TypeScript 5.7, Vitest |

---

## 文档

- **[Maestro Ralph 指南](guide/maestro-ralph-guide.md)** — 自适应生命周期引擎：位置推断、decision 节点、质量模式、重试升级
- **[命令使用指南](guide/command-usage-guide.md)** — 全部 53 个命令，含工作流图表、管线衔接、Issue 闭环
- **[命令参考 (HTML)](guide/command-usage-guide.html)** — 交互式 HTML 版本，支持搜索、卡片网格、工作流示例（`maestro command-help` 打开）
- **[CLI 命令参考](guide/cli-commands-guide.en.md)** — 全部 21 个终端命令：install、delegate、coordinate、wiki、hooks、overlay、collab
- **[Spec 系统指南](guide/spec-system-guide.md)** — `<spec-entry>` 格式、keyword 加载、验证 Hook、session dedup 注入
- **[Delegate 异步执行指南](guide/delegate-async-guide.md)** — 异步任务委派：CLI & MCP 用法、消息注入、链式调用
- **[Overlay 系统指南](guide/overlay-guide.md)** — 非侵入式命令扩展：格式、section 注入、bundle 打包/导入
- **[Hook 系统指南](guide/hooks-guide.md)** — Hook 系统架构、11 个 Hook、Spec 注入、上下文预算
- **[Worktree 并行开发指南](guide/worktree-guide.md)** — 里程碑级 worktree 并行：fork、sync、merge、dashboard 集成
- **[Collab 协作 — 使用指南](guide/team-lite-guide.md)** — 2-8 人小团队协作
- **[Collab 协作 — 设计文档](guide/team-lite-design.md)** — 架构、数据模型、命名空间边界
- **[MCP 工具参考](guide/mcp-tools-guide.en.md)** — 全部 9 个 MCP 端点工具

---

## 致谢

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** by TACHES — 规格驱动开发模型和上下文工程理念。
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — 前身项目，开创了多 CLI 编排和 skill 路由工作流。

## 贡献者

<a href="https://github.com/catlog22">
  <img src="https://github.com/catlog22.png" width="60px" alt="catlog22" style="border-radius:50%"/>
</a>

**[@catlog22](https://github.com/catlog22)** — 创建者 & 维护者

## 交流群

欢迎加入微信群交流反馈：

<img src="assets/wechat-group-qr.png" width="200" alt="微信群: Claude Code Workflow交流群 2" />

## 打赏

如果这个项目对你有帮助，欢迎请作者喝杯咖啡：

<img src="assets/wechat-reward-qr.png" width="200" alt="微信赞赏码" />

## 友情链接

- [Linux DO：学AI，上L站！](https://linux.do/)

## 许可证

MIT
