---
title: "Maestro Flow Introduction"
---

## Overview

Maestro Flow is a workflow orchestration framework for multi-agent development with Claude Code, Codex, Gemini, and other AI agents. Describe your intent, and Maestro Flow routes to the optimal command chain, drives parallel execution, and closes the loop through adaptive decision-making, a real-time dashboard, and an evolving knowledge graph.

## Core Philosophy

- **Intent-driven** — Describe your goal, AI selects the optimal path
- **Adaptive lifecycle** — Dynamically adjust workflow based on project state
- **Quality gates** — Adversarial verification at every stage
- **Knowledge accumulation** — Learning outcomes automatically feed into the knowledge base

## Command System

**64 commands, 7 categories, covering the entire project lifecycle:**

| Category | Count | Prefix | Purpose |
|----------|-------|--------|---------|
| **Core Workflow** | 32 | `maestro-*` | Full lifecycle — ralph, init, brainstorm, blueprint, analyze, roadmap, plan, execute, verify, milestones, overlays, swarm, companion |
| **Management** | 10 | `manage-*` | Issue lifecycle, codebase docs, knowledge capture, memory, status |
| **Quality** | 7 | `quality-*` | Review, test, debug, test-gen, business-test, refactor, sync |
| **Specification** | 4 | `spec-*` | Setup, add, load, analytics |
| **Learning** | 4 | `learn-*` | Retro, follow-along, pattern decompose, investigate |
| **Odyssey** | 5 | `odyssey-*` | Academic research workflows — lit-review, experiment, paper-draft, data-pipeline, thesis-structure |
| **Security** | 1 | `security-*` | Security audit |

## Command Landscape

```
Entry: /maestro-ralph (Adaptive Lifecycle Engine)
       │
       ├─→ Project Init: brainstorm → init → roadmap / blueprint
       │
       ├─→ Milestone Pipeline:
       │     analyze → plan → execute → verify → review → test → milestone-audit
       │       ↑                                        │
       │       └──── gaps/failure → plan --gaps ────────┘
       │
       ├─→ Issue Closed-Loop (parallel with Phase):
       │     discover → create → analyze --gaps → plan --gaps → execute → close
       │     (Commander Agent can drive fully automatically)
       │
       ├─→ Quality Pipeline: business-test → review → test-gen → test
       │
       └─→ Lightweight Channel: /maestro-next (assess) → /maestro-companion (execute)
```

## Entry Commands

| Command | Purpose |
|---------|---------|
| `/maestro-ralph` | Primary entry — adaptive lifecycle engine, auto-infers position, builds command chain |
| `/maestro "..."` | Describe intent, AI auto-routes optimal command chain |
| `/maestro-next` | Classify intent and recommend Companion, a standard single Run, or `/maestro`; it does not execute a fixed chain |

## Quality Modes

| Mode | Stages | When to Use |
|------|--------|-------------|
| `full` | verify → business-test → review → test-gen → test | Production features, security-critical code |
| `standard` | verify → review → test | Default, balanced quality |
| `quick` | verify → CLI-review | Quick fixes, prototyping |

## Tech Stack

| Layer | Technology |
|-------|------------|
| CLI | Commander.js, TypeScript, ESM |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Frontend | React 19, Zustand, Tailwind CSS 4, Framer Motion, Radix UI |
| Backend | Hono, WebSocket, SSE |
| Agents | Claude Agent SDK, Codex CLI, Gemini CLI, OpenCode |
| Build | Vite 6, TypeScript 5.7, Vitest |

## Related Guides

- [Quick Start Guide](./quick-start-guide.md)
- [Maestro Ralph Guide](./maestro-ralph-guide.md)
- [Command Usage Guide](./command-usage-guide.md)
- [Quality Pipeline Guide](./quality-pipeline-guide.md)
