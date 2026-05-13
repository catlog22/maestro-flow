<div align="center">

# Maestro-Flow

### The Orchestration Layer for the Multi-Agent Era

**Don't just run agents. Orchestrate them.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-8B5CF6)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

Maestro-Flow is a workflow orchestration framework for multi-agent development with Claude Code, Codex, Gemini, and other AI agents. Describe your intent, and Maestro-Flow routes to the optimal command chain, drives parallel agent execution, and closes the loop through adaptive decision-making, a real-time dashboard, and an evolving knowledge graph.

---

## Install

```bash
npm install -g maestro-flow
maestro install
```

**Prerequisites**: Node.js >= 18, Claude Code CLI. Optional: Codex CLI, Gemini CLI for multi-agent workflows.

---

## Quick Start

**`/maestro-ralph`** is the primary entry point — a closed-loop lifecycle engine that reads project state, infers your position, builds an adaptive command chain, and drives it to completion:

```bash
/maestro-ralph "implement OAuth2 authentication with refresh tokens"
```

Ralph automatically determines where you are in the lifecycle (brainstorm → roadmap → analyze → plan → execute → verify → review → test → milestone-complete) and builds the appropriate chain. Decision nodes at key checkpoints evaluate results and dynamically insert debug+fix loops when needed.

```bash
/maestro-ralph status              # View session progress
/maestro-ralph continue            # Resume after decision pause
/maestro-ralph -y "build a REST API"  # Full auto mode — no pauses
```

### Other Entry Points

| Command | When to Use |
|---------|-------------|
| `/maestro "..."` | Describe intent, let AI route to the optimal command chain |
| `/maestro-quick` | Quick fixes, small features (analyze → plan → execute) |
| `/maestro-*` | Step-by-step: init, roadmap, analyze, plan, execute, verify |

---

## Key Features

### 1. Adaptive Lifecycle Engine (`maestro-ralph`)

Reads project state → infers lifecycle position → builds command chain with decision nodes. At each checkpoint, Ralph reads actual execution results and decides: continue, or insert a debug → fix → retry loop. The chain grows and shrinks dynamically based on outcomes.

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
                                              ◆ post-milestone → next milestone
```

**Three quality modes** — control how thorough each phase is:

| Mode | Stages | When |
|------|--------|------|
| `full` | verify → business-test → review → test-gen → test | Production features, security-critical code |
| `standard` | verify → review → test | Default, balanced quality |
| `quick` | verify → CLI-review | Quick fixes, prototyping |

**Full pipeline explained** — each stage serves a distinct quality gate:

1. **verify** — goal-backward verification: checks that all plan requirements are implemented, validates architectural constraints, anti-pattern scan, Nyquist test coverage
2. **business-test** — PRD-forward business testing: requirement traceability, fixture generation, multi-layer execution against acceptance criteria
3. **review** — multi-dimensional code review: correctness, readability, performance, security, testing, architecture
4. **test-gen** — coverage gap analysis and automatic test generation (TDD/E2E classification, L0-L3 progressive layers)
5. **test** — conversational UAT: interactive exploratory testing with session persistence and gap-plan closure

At each `◆` decision node, Ralph evaluates outcomes and decides: pass through, or insert a debug → fix → retry loop. Max retries configurable per decision point.

### 2. Structured Pipeline

49 slash commands across 6 categories power every stage — from project initialization to quality retrospective. All artifacts live in `.workflow/scratch/`, tracked by `state.json`.

### 3. Issue Closed-Loop

Issues aren't just tickets — they're a self-healing pipeline: discover → analyze → plan → execute → close. Quality commands automatically create issues for problems they find. Issue fixes flow back into the phase pipeline.

### 4. Visual Dashboard

Real-time dashboard at `http://127.0.0.1:3001` with Kanban board, Gantt timeline, sortable table, and command center. Pick an agent on any issue card and dispatch. Built with React 19, Tailwind CSS 4, WebSocket live updates.

```bash
maestro serve                  # → http://127.0.0.1:3001
maestro view                   # Terminal TUI alternative
maestro command-help           # Open interactive command reference in browser (alias: ch)
```

### 5. Multi-Agent Engine

Coordinates Claude Code, Codex, Gemini, Qwen, and OpenCode in parallel via wave-based execution. Independent tasks run concurrently; dependent tasks wait for predecessors.

### 6. Smart Knowledge Base

Wiki knowledge graph with BM25 search, backlink traversal, and health scoring. Learning toolkit (retro, follow, decompose, investigate, second-opinion) feeds into a unified `lessons.jsonl` store.

### 7. Hook & Overlay System

11 context-aware hooks inject project specs into agent prompts, monitor context usage, and track delegate execution. The overlay system enables non-invasive patches for `.claude/commands/*.md` that survive upgrades.

---

## Commands & Agents

| Category | Count | Prefix | Purpose |
|----------|-------|--------|---------|
| **Core Workflow** | 18 | `maestro-*` | Full lifecycle — ralph, init, roadmap, analyze, plan, execute, verify, milestones, overlays |
| **Management** | 12 | `manage-*` | Issue lifecycle, codebase docs, knowledge capture, memory, status |
| **Quality** | 9 | `quality-*` | Review, test, debug, test-gen, integration-test, business-test, refactor, sync |
| **Learning** | 5 | `learn-*` | Retro, follow-along, pattern decompose, investigate, second opinion |
| **Specification** | 3 | `spec-*` | Setup, add, load |
| **Wiki** | 2 | `wiki-*` | Connection discovery, knowledge digest |

21 specialized agent definitions in `.claude/agents/` — each a focused Markdown file that Claude Code loads on demand.

---

## Architecture

```
maestro/
├── bin/                     # CLI entry points
├── src/                     # Core CLI (Commander.js + MCP SDK)
│   ├── commands/            # 11 CLI commands (serve, run, cli, ext, tool, ...)
│   ├── mcp/                 # MCP server (stdio transport)
│   └── core/                # Tool registry, extension loader
├── dashboard/               # Real-time web dashboard
│   └── src/
│       ├── client/          # React 19 + Zustand + Tailwind CSS 4
│       ├── server/          # Hono API + WebSocket + SSE
│       └── shared/          # Shared types
├── .claude/
│   ├── commands/            # 49 slash commands (.md)
│   └── agents/              # 21 agent definitions (.md)
├── workflows/               # 45 workflow implementations (.md)
├── templates/               # JSON templates (task, plan, issue, ...)
└── extensions/              # Plugin system
```

| Layer | Technology |
|-------|-----------|
| CLI | Commander.js, TypeScript, ESM |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Frontend | React 19, Zustand, Tailwind CSS 4, Framer Motion, Radix UI |
| Backend | Hono, WebSocket, SSE |
| Agents | Claude Agent SDK, Codex CLI, Gemini CLI, OpenCode |
| Build | Vite 6, TypeScript 5.7, Vitest |

---

## Documentation

- **[Maestro Ralph Guide](guide/maestro-ralph-guide.md)** — Adaptive lifecycle engine: position inference, decision nodes, quality modes, retry escalation
- **[Command Usage Guide](guide/command-usage-guide.md)** — All 53 commands with workflow diagrams, pipeline chaining, Issue closed-loop
- **[Command Reference (HTML)](guide/command-usage-guide.html)** — Interactive HTML version with search, card grid, and workflow examples (`maestro command-help` to open)
- **[CLI Commands Reference](guide/cli-commands-guide.en.md)** — All 21 terminal commands: install, delegate, coordinate, wiki, hooks, overlay, collab
- **[Spec System Guide](guide/spec-system-guide.md)** — Project specs with `<spec-entry>` format, keyword-based loading, validation hooks
- **[Delegate Async Guide](guide/delegate-async-guide.md)** — Async task delegation: CLI & MCP usage, message injection, chaining
- **[Overlay Guide](guide/overlay-guide.md)** — Non-invasive command extensions: format, section injection, bundle/import
- **[Hooks Guide](guide/hooks-guide.md)** — Hook system architecture, 11 hooks, spec injection, context budget
- **[Worktree Guide](guide/worktree-guide.md)** — Milestone-level parallel development: fork, sync, merge, dashboard integration
- **[Collab — User Guide](guide/team-lite-guide.md)** — Multi-person collaboration for 2-8 person teams
- **[Collab — Design](guide/team-lite-design.md)** — Architecture, data model, namespace boundaries
- **[MCP Tools Reference](guide/mcp-tools-guide.en.md)** — All 9 MCP endpoint tools

---

## Acknowledgments

- **[GET SHIT DONE](https://github.com/gsd-build/get-shit-done)** by TACHES — The spec-driven development model and context engineering philosophy.
- **[Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)** — The predecessor that pioneered multi-CLI orchestration and skill-based workflow routing.
- **[Impeccable](https://github.com/pbakaus/impeccable)** by [@pbakaus](https://github.com/pbakaus) — The UI design skill integrated as `maestro-impeccable`. Live variant mode, critique storage, design parser, and CSP detection modules are derived from this project. Licensed under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Contributors

<a href="https://github.com/catlog22">
  <img src="https://github.com/catlog22.png" width="60px" alt="catlog22" style="border-radius:50%"/>
</a>

**[@catlog22](https://github.com/catlog22)** — Creator & Maintainer

## Community

Join the WeChat group for discussion and feedback:

<img src="assets/wechat-group-qr.png" width="200" alt="WeChat Group: Claude Code Workflow交流群 2" />

## Buy Me a Coffee

If this project helps you, consider buying me a coffee:

<img src="assets/wechat-reward-qr.png" width="200" alt="WeChat Reward QR" />

## Links

- [Linux DO：学AI，上L站！](https://linux.do/)

## License

MIT
