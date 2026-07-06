<div align="center">

# Maestro-Flow

### Intent-Driven Multi-Agent Workflow Orchestration

**Tell it what to do. Maestro plans, dispatches, executes, and verifies — automatically.**

<br/>

[![npm version](https://img.shields.io/npm/v/maestro-flow?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/maestro-flow)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[简体中文](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[English](README.en.md)

</div>

<br/>

> Most AI coding tools let you run one agent on one task.
> Maestro-Flow coordinates **multiple agents across an entire development lifecycle** — from brainstorming to deployment. An adaptive decision engine adjusts strategy based on real results, and a knowledge graph feeds each session's discoveries into the next.

<br/>

## Core Capabilities

**Adaptive Orchestration** — The Ralph v2 engine reads project state, classifies natural-language intent into 40+ command chain types, and makes dynamic decisions at checkpoints: proceed, fall back, or insert a fix loop. No YAML. No pipeline config.

**Cross-Backend Dispatch** — Mix Claude, Codex, Gemini, Qwen, and OpenCode in a single workflow through four composable patterns: Delegate (async dispatch), Team (role-based coordination), Wave (dependency parallelism), and Swarm (ACO exploration).

**Self-Reinforcing Knowledge** — Patterns, pitfalls, and decisions discovered during execution are automatically persisted as Specs and Knowhow. Hooks inject relevant knowledge into future agent prompts — the project gets smarter over time.

**Long-Running Self-Correction** — Odyssey commands run multi-hour autonomous loops, adapting strategy at each checkpoint until acceptance criteria are met.

---

## Install

```bash
npm install -g maestro-flow
maestro install          # interactive component selector
```

Requires Node.js ≥ 18 and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Optionally install Codex CLI or agy CLI for multi-agent workflows.

---

## Quick Start

### Ralph v2 — Adaptive Lifecycle Engine

The primary entry point. State your goal; Ralph determines the lifecycle stage, builds a command chain, and dynamically adjusts at decision nodes:

```bash
/maestro-ralph-v2 "implement OAuth2 auth with refresh tokens"

# Ralph auto-builds: analyze → plan → execute → verify → review → test
# On failure → auto-inserts debug → fix → retry loop
# New project → auto-prepends brainstorm → blueprint
```

```bash
/maestro-ralph-v2 status      # view session progress
/maestro-ralph-v2 continue    # resume from decision pause
/maestro-ralph-v2 -y "..."    # full auto, no confirmations
```

### Core Pipeline

```
Intent input → Ralph classifies (40+ chain types)
                   │
                   ▼
brainstorm → blueprint(opt) → analyze → plan → execute → verify
                                                           ◆ decision
                                    review ── ◆ ── test ── ◆ ── milestone
                                                           ◆ → next milestone
```

Three quality modes control pipeline depth:

| Mode | Pipeline | Use case |
|------|----------|----------|
| `full` | verify → business-test → review → test-gen → test | Production, security-critical |
| `standard` | verify → review → test | Default, balanced |
| `quick` | verify → CLI-review | Prototyping, hotfixes |

### Other Entry Points

```bash
/maestro "add user profile page"        # intent routing, auto chain selection
/maestro-quick "fix redirect bug"       # shortest path: plan → execute → verify
```

### Odyssey — Long-Running Autonomous Loops

For large-scale debugging, deep refactoring, and UI optimization that require sustained iteration:

| Command | Loop pattern |
|---------|-------------|
| `/odyssey-debug` | archaeology → diagnosis → fix → confirm → generalize → persist |
| `/odyssey-planex` | parse requirements → plan → execute → strict verify → fix loop |
| `/odyssey-improve` | multi-dimension audit → deep diagnosis → targeted fix → verify → generalize |
| `/odyssey-review-test-fix` | multi-dimension review → targeted fix → test → generalize → persist |
| `/odyssey-ui` | visual survey → audit → divergent exploration → fix → verify |

Each Odyssey command runs until acceptance criteria are met, adapting strategy mid-loop and auto-persisting discoveries as knowledge.

---

## Documentation

### Getting Started

| | Guide | Description |
|---|-------|-------------|
| **01** | [Quick Start](guide/quick-start-guide.en.md) | Install, first workflow, key concepts |
| **02** | [Install Guide](guide/install-guide.md) | Component selection, workspace setup |
| **03** | [Ralph Engine](guide/maestro-ralph-guide.en.md) | Adaptive decisions, quality modes, session management |
| **04** | [Command Reference](guide/command-usage-guide.en.md) | All 64 commands with flow diagrams and chaining |

### Daily Use

| Guide | Description |
|-------|-------------|
| [CLI Commands](guide/cli-commands-guide.en.md) | 35+ terminal commands quick reference |
| [Knowledge Management](guide/knowledge-management-guide.en.md) | Knowledge graph, specs, knowhow, wiki overview |
| [Spec System](guide/spec-system-guide.en.md) | Writing, loading, and auto-injecting project rules |
| [Quality Pipeline](guide/quality-pipeline-guide.en.md) | verify → review → test three-tier pipeline |
| [Hooks](guide/hooks-guide.en.md) | 17 hook triggers, spec injection, context budget |

<details>
<summary><b>Advanced &amp; Design Docs</b> (click to expand)</summary>
<br/>

| Guide | Description |
|-------|-------------|
| [Workflow Structure](guide/workflow-structure-guide.en.md) | Four-layer command topology, six canonical paths |
| [Multi-Agent Coordination](guide/maestro-coordinator-guide.en.md) | Delegate / Team / Wave / Swarm in depth |
| [Delegate Async](guide/delegate-async-guide.en.md) | Cross-CLI dispatch, message injection, chaining |
| [Overlay Extensions](guide/overlay-guide.en.md) | Add behavior to commands without touching source |
| [Worktree Parallel Dev](guide/worktree-guide.en.md) | Milestone-level branch isolation |
| [Cross-Project Sharing](guide/workspace-guide.md) | Multi-project link/unlink knowledge |
| [MCP Tools](guide/mcp-tools-guide.en.md) | 9 MCP endpoint tools reference |
| [Team Collab](guide/team-lite-guide.en.md) | 2–8 person collaboration mode |
| [Search System](guide/search-system-guide.md) | BM25F full-text search and KG integration |
| [Learning Tools](guide/learn-tools-guide.en.md) | Retro, follow, decompose, investigate toolkit |
| [MaestroGraph Design](guide/plan-maestrograph.md) | Unified knowledge graph engine architecture |
| [Domain Knowledge Design](guide/plan-domain-knowledge.md) | Semantic glossary and concept relationships |

</details>

---

## Project Scale

333 TypeScript source files / ~80k LoC / 64 slash commands / 45 skill packages / 23 agent definitions / 35+ CLI commands / 92 templates

**Tech Stack**&nbsp;&nbsp;Commander.js · MCP SDK · better-sqlite3 · web-tree-sitter · React 19 · Zustand · Tailwind CSS 4 · Hono · Vite 6

<details>
<summary><b>Directory Structure</b></summary>

```
maestro/
├── src/                     # Core CLI (Commander.js + MCP SDK)
│   ├── commands/            # 35+ CLI commands
│   ├── mcp/                 # MCP server (stdio)
│   ├── graph/               # Knowledge graph (SQLite + tree-sitter)
│   └── core/                # Tool registry, extension loader
├── dashboard/               # Web dashboard (React 19)
├── .claude/
│   ├── commands/            # 64 slash commands
│   ├── agents/              # 23 agent definitions
│   └── skills/              # 45 skill packages
├── workflows/               # 115 workflow definitions
└── templates/               # 92 JSON templates
```

</details>

---

<details>
<summary><b>Comparison with Other Tools</b></summary>
<br/>

| | [Superpowers](https://github.com/obra/superpowers) | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | [Trellis](https://github.com/mindfold-ai/trellis) | **Maestro-Flow** |
|---|---|---|---|---|
| **Focus** | Agent skills framework | Spec-driven development | Multi-platform harness | Intent-driven orchestration |
| **Architecture** | Pure `.md`, no runtime | CLI + Git | CLI + `.trellis/` | CLI + MCP + SQLite |
| **Routing** | Manual skill selection | Manual command sequence | Fixed phases | AI-classified 40+ chains |
| **Multi-agent** | Subagent dispatch | Single agent | Channel-based | 4 patterns × 5 backends |
| **Knowledge** | Git only | Git archives | File journals | SQLite KG + auto-inject |
| **Long-running** | Context window | Manual continue | Journal resume | Stateful Odyssey loops |
| **Self-correction** | Review-fix loop | Manual re-verify | Manual | Auto retry at decision nodes |

**Each excels differently**: Superpowers has the most mature prompt engineering methodology; OpenSpec brings the most formal spec rigor; Trellis best unifies multi-platform workflows; Maestro-Flow focuses on full-lifecycle orchestration, cross-backend dispatch, and self-reinforcing knowledge.

</details>

---

## Acknowledgments

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** — Spec-driven development and context engineering philosophy
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — Predecessor that pioneered multi-CLI orchestration
- **[Impeccable](https://github.com/pbakaus/impeccable)** — UI design skill ([Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0))

---

<div align="center">

**[@catlog22](https://github.com/catlog22)** — Creator & Maintainer

Join the WeChat group:

<img src="assets/wechat-group-qr.png" width="180" alt="WeChat Group" />

<br/><br/>

[Linux DO：学AI，上L站！](https://linux.do/)

<br/>

MIT License

</div>
