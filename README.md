<div align="center">

# Maestro-Flow

### Intent-Driven Workflow Orchestration for the Multi-Agent Era

**Describe what you want. Maestro figures out how to get there.**

<br/>

[![npm version](https://img.shields.io/npm/v/maestro-flow?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/maestro-flow)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[简体中文](README.zh-CN.md)

</div>

<br/>

> Most AI coding tools let you run one agent on one task.
> Maestro-Flow orchestrates **multiple agents across an entire development lifecycle** — from brainstorming to deployment — with an adaptive decision engine, a self-reinforcing knowledge graph, and a real-time visual dashboard.

<br/>

## Two Pillars

Maestro-Flow is built on two interconnected systems that reinforce each other:

```
                         ┌─────────────────────────────────────┐
                         │         Maestro-Flow                │
                         │                                     │
          ┌──────────────┴──────────────┐  ┌──────────────────┴───────────────┐
          │   Workflow Orchestration     │  │      Knowledge System            │
          │                             │  │                                  │
          │  Intent Router              │  │  MaestroGraph (SQLite)            │
          │    └─ 40+ chain types       │  │    └─ Code + Knowledge unified   │
          │  Ralph Decision Engine      │  │  Spec Injection (Hooks)          │
          │    └─ 11-state FSM          │  │    └─ Auto-inject into prompts   │
          │  Quality Pipeline           │  │  Wiki + BM25 Search              │
          │    └─ verify → review → test│  │    └─ Backlinks + health score   │
          │  Multi-Agent Dispatch       │  │  Learning Loop                   │
          │    └─ Claude, Gemini, Codex │  │    └─ retro → persist → inject   │
          │                             │  │                                  │
          └─────────────┬───────────────┘  └──────────────────┬───────────────┘
                        │          ▲              │            ▲
                        │          │  knowledge   │            │
                        │          │  injection   │            │
                        │          └──────────────┘            │
                        │     execution results                │
                        └──────────────────────────────────────┘
```

**Workflows generate knowledge. Knowledge improves future workflows.** Agents learn from each session, persist discoveries as specs and knowhow, and future agents automatically receive that context through hook injection — creating a self-reinforcing cycle.

---

## Install

```bash
npm install -g maestro-flow
maestro install
```

**Prerequisites**: Node.js ≥ 18, Claude Code CLI. Optional: Codex CLI, agy (Antigravity) CLI for multi-agent workflows.

`maestro install` provides an interactive component selector — choose which assets (commands, hooks, MCP, agents) to install. Use `maestro workspace link` to share knowledge (specs, knowhow, domain) across multiple projects.

---

## Quick Start

### The Ralph Engine

**`/maestro-ralph`** is the primary entry point — a closed-loop lifecycle engine that reads project state, infers your position in the development lifecycle, and builds an adaptive command chain:

```bash
/maestro-ralph "implement OAuth2 authentication with refresh tokens"
```

Ralph automatically determines where you are (brainstorm → plan → execute → verify → review → test → milestone) and builds the appropriate chain. Decision nodes at key checkpoints evaluate results and dynamically insert debug → fix → retry loops when needed.

```bash
/maestro-ralph status              # View session progress
/maestro-ralph continue            # Resume after decision pause
/maestro-ralph -y "build a REST API"  # Full auto — no pauses
```

### Other Entry Points

| Command | When to Use |
|---------|-------------|
| `/maestro "..."` | Describe intent, let AI route to the optimal command chain |
| `/maestro-quick` | Quick fixes, small features (analyze → plan → execute) |
| `/maestro-*` | Step-by-step: brainstorm, blueprint, analyze, plan, execute, verify |

### Knowledge Management

```bash
# Search across wiki + code (BM25F ranking)
maestro search "user authentication"

# Load specific knowledge types
maestro load --type spec --category coding
maestro load --type knowhow --list

# Explore codebase via API endpoints
maestro explore "Find all database query patterns"

# Manage domain terminology
maestro domain add "API Gateway" "Unified entry point for all API requests"
```

### Odyssey — Long-Running Iterative Cycles

Odyssey commands run extended, self-correcting loops that combine archaeology, diagnosis, fix, verification, and knowledge persistence until acceptance criteria are met:

| Command | Focus |
|---------|-------|
| `odyssey-debug` | Debug cycle — archaeology, diagnosis, fix, confirmation, generalization |
| `odyssey-planex` | Requirement-driven cycle — plan, execute, strict verify, fix loop |
| `odyssey-improve` | Codebase improvement — multi-dimensional audit, targeted fix, verify |
| `odyssey-review-test-fix` | Deep review + fix — multi-dimensional review, targeted fix, generalization |
| `odyssey-ui` | UI optimization — visual survey, audit, divergent exploration, fix |

---

## Workflow Orchestration

### Adaptive Lifecycle Engine

Ralph is an 11-state finite state machine that **decides** but never executes. It reads project state, infers lifecycle position, builds a command chain with quality gates, and hands off execution to `maestro-ralph-execute`. At each decision node (`◆`), Ralph evaluates actual results and decides: proceed, or insert a debug → fix → retry loop.

```
brainstorm → blueprint(opt) → init → analyze(macro) → roadmap(opt) → analyze(micro) → plan → execute → verify
                                                                                                 ◆ decision
                                              review ─── ◆ ─── test ─── ◆ ─── milestone-audit → milestone-complete
                                                                                                 ◆ → next milestone
```

**Three quality modes** control thoroughness:

| Mode | Pipeline | Use Case |
|------|----------|----------|
| `full` | verify → business-test → review → test-gen → test | Production, security-critical |
| `standard` | verify → review → test | Default, balanced |
| `quick` | verify → CLI-review | Prototyping, quick fixes |

### Intent-Driven Routing

You don't write pipeline YAML. You describe intent in natural language, and Maestro classifies it into one of **40+ chain types**, each a pre-composed sequence of commands. The same intent produces different chains depending on project state:

```bash
/maestro "add user profile page"
# → New project:     brainstorm → blueprint → analyze → plan → execute → verify
# → Existing project: analyze → plan → execute → verify
# → Quick fix:       plan → execute → verify
```

### Layered Command Topology

Commands are organized in four layers:

| Layer | Purpose | Commands |
|-------|---------|----------|
| **Origin** | Diverge ideas, converge direction | brainstorm, blueprint |
| **Understanding** | Explore scope (macro) + deep-dive (micro) | analyze (dual-mode) |
| **Orchestration** | Structure into milestones and phases | roadmap |
| **Execution** | Plan, implement, verify | plan, execute, verify, review, test |

Six canonical paths (A–F) cover everything from full greenfield projects to single-line fixes.

### Multi-Agent Dispatch

Maestro coordinates **Claude Code, Codex, Gemini, Qwen, and OpenCode** through four composable orchestration patterns:

| Pattern | How It Works |
|---------|-------------|
| **Delegate** | Dispatch to any CLI tool via `maestro delegate` with SQLite-backed job broker, async execution, and message injection for follow-up chaining |
| **Team** | Coordinator-worker architecture — coordinators generate role-specs, spawn `team-worker` agents in parallel, supervised by a resident quality observer |
| **Wave** | Topological sort of tasks into dependency waves; independent tasks run concurrently within each wave |
| **Swarm** | ACO-driven multi-agent exploration for complex problem spaces with pheromone-guided convergence |

These patterns compose: a team coordinator can delegate subtasks to different LLM backends, wave execution parallelizes independent work, and the dashboard provides a real-time supervisory control loop — all sharing the broker and message bus as coordination primitives.

---

## Knowledge System

### Knowledge Graph (MaestroGraph)

**MaestroGraph** is the unified code index engine that replaces the former CodeGraph dependency. Built on `web-tree-sitter` for AST-level extraction, it stores both **code structure** (functions, classes, call chains) and **project knowledge** (specs, knowhow, domain terms, issues) in a single SQLite-backed graph with dual FTS5 indexes.

```bash
maestro kg search <symbol>        # Find nodes
maestro kg context <node>         # Get surrounding context
maestro kg callers <function>     # Trace call chains
maestro kg callees <function>     # Trace dependencies
```

### Spec Injection

Project rules (coding standards, architecture constraints, quality criteria) are stored as `<spec-entry>` blocks with keyword tags. **Hooks automatically inject relevant specs into every agent prompt** based on keyword matching — agents receive project-specific rules without explicit loading.

### Self-Reinforcing Learning Loop

```
Agent executes task
    → Discovers pattern/pitfall/decision
    → Persists as spec entry or knowhow doc
    → Hook system indexes new knowledge
    → Future agents auto-receive via prompt injection
    → Better execution → more discoveries → ...
```

Four learning tools feed this cycle: `learn-retro` (retrospective), `learn-follow` (pattern study), `learn-decompose` (architecture breakdown), `learn-investigate` (deep dive).

### Domain Knowledge

A semantic glossary layer that defines **what things mean** in your project. Domain terms (`maestro domain`) standardize terminology, map concept relationships, and serve as a MaestroGraph knowledge source — bridging the gap between code-level symbols and business-level concepts.

### Wiki & Search

WikiIndexer walks the `.workflow/` directory, parses frontmatter, builds backlink graphs, and creates a **BM25 inverted index** for full-text search across all project knowledge — specs, knowhow, issues, and KG nodes as virtual entries.

---

## Issue Closed-Loop

Issues aren't just tickets. They're a self-healing pipeline:

```
discover → analyze → plan → execute → close
    ▲                                    │
    └────── quality commands auto-create ─┘
```

Quality commands (review, test, verify) automatically create issues for problems they find. Issue fixes flow back into the phase pipeline.

---

## Visual Dashboard

Real-time dashboard at `http://127.0.0.1:3001` — Kanban board, Gantt timeline, sortable table, and command center. Pick an agent on any issue card and dispatch.

```bash
maestro serve                  # Launch web dashboard
maestro view                   # Terminal TUI alternative
maestro command-help           # Interactive command reference (alias: ch)
```

Built with React 19, Zustand, Tailwind CSS 4, Framer Motion, Hono, WebSocket.

---

## At a Glance

| Metric | Count |
|--------|-------|
| Source files (TypeScript) | 333 |
| Lines of code | ~80,700 |
| Slash commands | 64 |
| Workflow definitions | 115 |
| Skill packages | 45 |
| Agent definitions | 23 |
| CLI commands | 35+ |
| Templates | 92 |
| Guides (bilingual) | 76 |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| CLI | Commander.js, TypeScript, ESM |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Knowledge Graph | better-sqlite3, Drizzle ORM, web-tree-sitter |
| Frontend | React 19, Zustand, Tailwind CSS 4, Framer Motion, Radix UI |
| Backend | Hono, WebSocket, SSE |
| Agents | Claude Agent SDK, Codex CLI, agy (Antigravity) CLI, OpenCode |
| Build | Vite 6, TypeScript 5.7, Vitest |

### Architecture

```
maestro/
├── bin/                     # CLI entry points
├── src/                     # Core CLI (Commander.js + MCP SDK)
│   ├── commands/            # 35+ CLI commands
│   ├── mcp/                 # MCP server (stdio transport)
│   ├── graph/               # Knowledge Graph (SQLite + tree-sitter)
│   └── core/                # Tool registry, extension loader
├── dashboard/               # Real-time web dashboard
│   └── src/
│       ├── client/          # React 19 + Zustand + Tailwind CSS 4
│       ├── server/          # Hono API + WebSocket + SSE
│       └── shared/          # Shared types
├── .claude/
│   ├── commands/            # 64 slash commands (.md)
│   ├── agents/              # 23 agent definitions (.md)
│   └── skills/              # 45 skill packages
├── workflows/               # 115 workflow definitions (.md)
├── templates/               # 92 JSON templates
└── extensions/              # Plugin system
```

---

## Documentation

**Getting Started**
- **[Quick Start Guide](guide/quick-start-guide.en.md)** — Install, first workflow, key concepts
- **[Install Guide](guide/install-guide.md)** — Step-by-step installation, component selection, workspace setup
- **[Maestro Ralph Guide](guide/maestro-ralph-guide.en.md)** — Adaptive lifecycle engine, decision nodes, quality modes

**Workflow**
- **[Command Usage Guide](guide/command-usage-guide.en.md)** — All 64 commands with workflow diagrams and pipeline chaining
- **[CLI Commands Reference](guide/cli-commands-guide.en.md)** — All 35+ terminal commands
- **[Workflow Structure Guide](guide/workflow-structure-guide.en.md)** — Command topology, chain composition
- **[Quality Pipeline Guide](guide/quality-pipeline-guide.en.md)** — Verify, review, test pipeline
- **[Maestro Coordinator Guide](guide/maestro-coordinator-guide.en.md)** — Multi-agent coordination patterns

**Knowledge**
- **[Knowledge Management Guide](guide/knowledge-management-guide.en.md)** — KG, specs, knowhow, wiki
- **[Search System Guide](guide/search-system-guide.md)** — Unified BM25F search, MaestroGraph integration, type filtering
- **[MaestroGraph Plan](guide/plan-maestrograph.md)** — Unified KG engine design, CodeGraph replacement, tree-sitter integration
- **[Domain Knowledge Plan](guide/plan-domain-knowledge.md)** — Semantic glossary, term relationships, concept layer
- **[Spec System Guide](guide/spec-system-guide.en.md)** — Spec entries, keyword loading, validation hooks
- **[Hooks Guide](guide/hooks-guide.en.md)** — 17 hooks, spec injection, context budget
- **[Learning Tools Guide](guide/learn-tools-guide.en.md)** — Retro, follow, decompose, investigate

**Advanced**
- **[Delegate Async Guide](guide/delegate-async-guide.en.md)** — Multi-CLI delegation, message injection, chaining
- **[Overlay Guide](guide/overlay-guide.en.md)** — Non-invasive command extensions
- **[Worktree Guide](guide/worktree-guide.en.md)** — Milestone-level parallel development
- **[Workspace Guide](guide/workspace-guide.md)** — Cross-workspace knowledge sharing, link/unlink
- **[MCP Tools Reference](guide/mcp-tools-guide.en.md)** — All 9 MCP endpoint tools
- **[Collab Guide](guide/team-lite-guide.en.md)** — 2-8 person team collaboration

---

## Comparison with Other Tools

The AI coding workflow space is growing fast. Here's how Maestro-Flow relates to three prominent open-source tools — each takes a different approach to a shared goal.

### Overview

| | [Superpowers](https://github.com/obra/superpowers) | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | [Trellis](https://github.com/mindfold-ai/trellis) | **Maestro-Flow** |
|---|---|---|---|---|
| **Tagline** | Agentic skills framework & methodology | Spec-driven development (SDD) | Multi-platform agent harness | Intent-driven workflow orchestration |
| **Architecture** | Pure `.md` skill files, no runtime | CLI + spec scaffolding, git-based | CLI + runtime, file-based `.trellis/` | CLI + MCP + runtime, SQLite-backed |
| **License** | MIT | MIT | AGPL-3.0 | MIT |

### Workflow Model

Each tool answers a different question about the development lifecycle:

- **Superpowers** answers *"how should agents think?"* — 14 composable `.md` skills shape agent behavior through a 7-phase methodology (brainstorm → worktree → plan → subagent dispatch → task review → code review → branch finish). The user follows the methodology; the agent follows the skills. No runtime routes or decides for you.
- **OpenSpec** answers *"what should we build?"* — 11 slash commands manage a spec-centric planning layer (`/opsx:explore` → `/opsx:propose` → `/opsx:apply` → `/opsx:verify` → `/opsx:archive`). Each change gets a folder with proposal, specs, design, and task artifacts. The workflow is fluid and iterative, but manually driven.
- **Trellis** answers *"how do we work across platforms?"* — specs, tasks, and workspace journals live in `.trellis/`, with platform-specific configurators for 16 AI tools. A channel-based message bus enables supervisor-worker multi-agent patterns. Hooks inject specs into prompts automatically.
- **Maestro-Flow** answers *"how do we orchestrate the entire lifecycle?"* — the Ralph engine reads project state, classifies intent into 40+ chain types, and builds adaptive command chains with decision nodes. Odyssey commands run self-correcting loops. A SQLite knowledge graph persists discoveries and auto-injects them into future sessions.

### Multi-Agent Orchestration

| Capability | Superpowers | OpenSpec | Trellis | Maestro-Flow |
|---|---|---|---|---|
| Dispatch model | Fresh subagent per task, coordinator never executes | Single agent | Channel-based supervisor-worker | 4 patterns: Delegate, Team, Wave, Swarm |
| Concurrent agents | Yes (parallel dispatch) | No | Yes (channel spawn) | Yes (wave parallelism, team fan-out) |
| Cross-backend | No (single host) | No (single host) | No (same backend per session) | Yes (Claude, Codex, Gemini, Qwen, OpenCode in one workflow) |
| Agent communication | None (fresh context each) | N/A | Message channels with locks | SQLite broker + message bus + injection |

Superpowers pioneered the subagent-driven development pattern — a coordinator dispatches fresh implementer agents per task, keeping context clean. Trellis built a genuine message-passing layer with channels, supervisors, and idle detection. Maestro-Flow dispatches across different LLM backends in the same workflow, coordinating through a shared broker.

### Decision & Routing

| Capability | Superpowers | OpenSpec | Trellis | Maestro-Flow |
|---|---|---|---|---|
| Intent routing | Manual skill selection | Manual command sequence | Fixed phases (plan → implement → verify) | AI-classified into 40+ chain types based on project state |
| Adaptive decisions | No | No | No | Decision nodes (◆) evaluate results, insert debug/fix/retry |
| Quality modes | Per-task + per-branch review | 3-dimension verify | Spec compliance + lint/type/test | 3 modes: full / standard / quick pipeline |
| Self-correction | Review → fix subagent loop | Manual re-verify | Manual continue | Automatic retry loops at decision nodes |

### Long-Running Work

| Capability | Superpowers | OpenSpec | Trellis | Maestro-Flow |
|---|---|---|---|---|
| Session boundary | Context window | Context window | Journal-based resume | Stateful engine with checkpoints |
| Multi-step continuity | Coordinator dispatches until plan complete | Manual `/opsx:continue` sequencing | `trellis-continue` skill | Odyssey self-correcting cycles |
| Adaptive strategy | No | No | No | Ralph adjusts chain based on intermediate results |
| Time scale | "A couple hours" per session | Per-conversation | Journal extends sessions | Hours-long Odyssey loops with knowledge persistence |

Superpowers can sustain multi-hour sessions through coordinator-subagent dispatch. OpenSpec and Trellis rely on manual continuation. Maestro-Flow's Odyssey commands run autonomous loops — archaeology, diagnosis, fix, verification, and knowledge capture — until acceptance criteria are met, with the engine adapting strategy at each checkpoint.

### Knowledge & Persistence

| Capability | Superpowers | OpenSpec | Trellis | Maestro-Flow |
|---|---|---|---|---|
| Storage | None (git only) | Git-based spec archives | File-based `.trellis/` | SQLite knowledge graph + file-based workflows |
| Cross-session learning | No | Archives as reference | Workspace journals | Self-reinforcing: discover → persist → index → auto-inject |
| Search | No | No | No | BM25F full-text across specs, knowhow, wiki, KG nodes |
| Spec injection | Via skill prompts | Manual loading | Python hooks at session start | Keyword-matched hook injection per agent prompt |
| Domain knowledge | No | No | No | Semantic glossary with concept relationships |

### Each Tool's Strength

**Superpowers** has set the standard for AI development methodology. Its 14 skills encode battle-tested patterns — subagent-driven development, systematic debugging, TDD, verification-before-completion — that make agents dramatically more effective. With 247k stars, it has the largest community and the most proven prompt engineering patterns. If you want better agent behavior without new tooling, Superpowers is the reference.

**OpenSpec** brings formal rigor to the planning layer. By enforcing a spec lifecycle (explore → propose → apply → verify → archive), it ensures AI and developer agree on *what* to build before any code is written. Its 3-dimension verification (completeness, correctness, coherence) catches misalignment early. If your bottleneck is requirements clarity, OpenSpec addresses it directly.

**Trellis** solves the multi-platform problem. With configurators for 16 AI tools, you can start a feature in Claude Code and continue in Cursor with shared specs, tasks, and journals. Its channel-based multi-agent system provides real supervisor-worker orchestration. If your team uses multiple AI tools, Trellis unifies the experience.

### Where Maestro-Flow Focuses

- **Long-running work** — Odyssey commands run extended, self-correcting cycles that combine archaeology, diagnosis, fix, verification, and knowledge persistence until acceptance criteria are met. Sessions can span hours with the engine maintaining state, adapting strategy at decision nodes, and persisting discoveries for future sessions.
- **Flexible command chaining** — Rather than a fixed pipeline or manual sequencing, the Ralph engine reads project state and dynamically builds command chains with quality gates. The same intent produces different chains depending on context — a new project gets brainstorm → blueprint → analyze → plan → execute → verify; a quick fix gets plan → execute → verify. Decision nodes evaluate actual results and insert debug → fix → retry loops when needed.
- **Completeness as a platform** — A unified system covering the full lifecycle (brainstorm through milestone), with a knowledge graph that feeds learnings back automatically, a visual dashboard for project oversight, issue closed-loop for self-healing quality, and multi-backend dispatch for leveraging different LLMs' strengths in the same workflow.

---

## Acknowledgments

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** by TACHES — The spec-driven development model and context engineering philosophy.
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — The predecessor that pioneered multi-CLI orchestration and skill-based workflow routing.
- **[Impeccable](https://github.com/pbakaus/impeccable)** by [@pbakaus](https://github.com/pbakaus) — UI design skill integrated as `maestro-impeccable`. Licensed under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Contributors

<a href="https://github.com/catlog22">
  <img src="https://github.com/catlog22.png" width="60px" alt="catlog22" style="border-radius:50%"/>
</a>

**[@catlog22](https://github.com/catlog22)** — Creator & Maintainer

## Community

Join the WeChat group for discussion and feedback:

<img src="assets/wechat-group-qr.png" width="200" alt="WeChat Group: Claude Code Workflow交流群 2" />

## Links

- [Linux DO：学AI，上L站！](https://linux.do/)

## License

MIT
