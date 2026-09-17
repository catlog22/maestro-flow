---
title: "Maestro Commands Quick Reference"
---

> Auto-generated from `inventory-v2.json` + `.claude/commands/*.md` frontmatter.
> v2 (v0.5.51+): 18 commands across 9 categories.
> Do not edit by hand — run `npm run sync:docs-reference` to regenerate.

---

## Maestro

*Intelligent coordinator and core workflow commands — init, route, execute, verify, and lifecycle management*

### `maestro`

**Usage:** `<intent> [-y] [-c] [--dry-run] [--super]`

Auto-route intent to optimal command chain — default multi-step closed-loop orchestration; stepwise interactive execution via /maestro-next

**Invocation:** Automatic entrypoint and explicit slash command

### `maestro-init`

**Usage:** `[-y] [--from <source>] [--from-brainstorm SESSION-ID]`

Initialize project with auto state detection — creates .workflow/ directory structure

**Invocation:** Explicit routing or user slash command

### `maestro-ralph`

**Usage:** `<intent> [-y] [-c] [--amend]`

Closed-loop policy over the canonical Session/Run chain — dispatch run-executor, evaluate decisions, retry, and stop

**Invocation:** Automatic entrypoint and explicit slash command

### `maestro-next`

**Usage:** `<intent>|--list|--suggest [-y] [--dry-run]`

Default interactive entry for development intents — recommend and execute one atomic step; multi-step work builds a user-confirmed manual-engine chain, walks stepwise, or hands off to /maestro

**Invocation:** Automatic entrypoint and explicit slash command

### `maestro-companion`

**Usage:** `<intent> [--note <text>] [--promote] [-y]`

Quick execution for small tasks — minimal Run lifecycle with direct execution and evidence recording

**Invocation:** Automatic entrypoint and explicit slash command

### `maestro-impeccable`

**Usage:** `build|redesign|improve|enhance|launch|harden|foundation|live [target] [--codify <path>]`

Frontend UI design, audit, polish, and codification — build, redesign, improve, enhance, launch, harden

**Invocation:** Explicit routing or user slash command

### `maestro-overlay`

**Usage:** `<intent> | --amend [--scan] [--dry-run] [-y]`

Create or edit command overlays from natural language, or auto-generate from workflow deficiency signals

**Invocation:** Explicit routing or user slash command

### `maestro-fork`

**Usage:** `--session <session_id> [--base <branch>] [--sync]`

Create or sync session worktree for parallel development

**Invocation:** Explicit routing or user slash command

### `maestro-merge`

**Usage:** `--session <session_id> [--force] [--dry-run] [--no-cleanup] [--continue]`

Merge session worktree branch back to main

**Invocation:** Explicit routing or user slash command

### `maestro-guard`

**Usage:** `on|off|status|allow|deny [path]`

Manage editing boundary restrictions — directory-level write boundaries

**Invocation:** Explicit routing or user slash command

### `maestro-session-seal`

**Usage:** `[--session <session_id>] [-y] [--skip-knowledge]`

Seal current session with knowledge extraction and DAG progression

**Invocation:** Explicit routing or user slash command

### `maestro-update`

**Usage:** `[--dry-run] [--force] [--setup-only]`

Detect version, preview changes, apply workflow upgrades

**Invocation:** Explicit routing or user slash command

---

## Specification

*Project specs and conventions — add, load, remove entries via unified /maestro-spec command*

### `maestro-spec`

**Usage:** `[intent — e.g. '加一条规范：禁止用 any' | 'arch 约束：服务间走 gRPC' | '--scope team coding: 统一用 pnpm']`

Intent-driven spec precipitation — state a constraint in natural language and the workflow infers the category and records a <spec-entry>. Records only: loading is \`maestro spec load\`, removal is the \`specs-remove\` step.

**Invocation:** Explicit routing or user slash command

---

## Management

*Project issues, knowhow precipitation, and knowledge-store management — /maestro-issue, /maestro-knowhow, /maestro-knowledge*

### `maestro-issue`

**Usage:** `<intent — e.g. 'report a login bug' | 'list open' | 'close ISS-xxx' | 'discover'>`

Intent-driven issue lifecycle — report, list, close, link, or discover issues in .workflow/issues/

**Invocation:** Explicit routing or user slash command

### `maestro-knowhow`

**Usage:** `<intent — e.g. 'record a JWT refresh decision' | 'template this retry code' | 'tip: redis pitfall'>`

Intent-driven knowhow precipitation — record decisions, templates, recipes, and tips into .workflow/knowhow/

**Invocation:** Explicit routing or user slash command

### `maestro-knowledge`

**Usage:** `<intent — e.g. 'audit knowledge base' | 'harvest this session' | 'wiki health' | 'register term MVP'>`

Intent-driven knowledge-store management — audit, harvest, wiki health, knowledge-graph linking, and domain terms

**Invocation:** Automatic entrypoint and explicit slash command

---

## Odyssey

*Long-running iterative cycles — one entry, seven modes (debug|improve|planex|review|security|defensive|ui)*

### `maestro-odyssey`

**Usage:** `<intent> --mode debug|improve|planex|review|security|defensive|ui [--auto] [-y] [-c]`

Long-running iterative cycle — one entry, seven modes. Shared archaeology/audit → fix → verify → generalize → discover → persist.

**Invocation:** Explicit routing or user slash command

**Subcommands:** `debug`, `improve`, `planex`, `review`, `security`, `defensive`, `ui`

---

## Learning

*Guided reading, investigation, pattern extraction, and second opinions — unified /maestro-learn command*

### `maestro-learn`

**Usage:** `follow|investigate|decompose|consult [args...]`

User-invoked learning toolkit — guided reading, investigation, pattern extraction, or second opinions. Manual /maestro-learn only; auto code analysis routes via /maestro-next.

**Invocation:** Explicit routing or user slash command

**Subcommands:** `follow`, `investigate`, `decompose`, `consult`

---

## Team Skills

*Parallel multi-agent campaign ecosystems. Start them explicitly with `/team-*`; Maestro routers do not select them.*

- **`team-arch-opt`** — Unified team skill for architecture optimization. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team arch-opt". _(manual or explicit orchestrator recommendation)_
- **`team-coordinate`** — Universal team coordination skill with dynamic role generation. Uses team-worker agent architecture with role-spec files. Only coordinator is built-in -- all worker roles are generated at runtime as role-specs and spawned via team-worker agent. Beat/cadence model for orchestration. Triggers on "Team Coordinate ". _(manual or explicit orchestrator recommendation)_
- **`team-issue`** — Unified team skill for issue resolution. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team issue". _(manual or explicit orchestrator recommendation)_
- **`team-lifecycle-v4`** — Full lifecycle team skill — plan, develop, test, review in one coordinated session. Role-based architecture with coordinator-driven beat model. Triggers on "team lifecycle v4". _(manual or explicit orchestrator recommendation)_
- **`team-perf-opt`** — Unified team skill for performance optimization. Coordinator orchestrates pipeline, workers are team-worker agents. Supports single/fan-out/independent parallel modes. Triggers on "team perf-opt". _(manual or explicit orchestrator recommendation)_
- **`team-review`** — Unified team skill for code review. 3-role pipeline: scanner, reviewer, fixer. Triggers on team-review. _(manual or explicit orchestrator recommendation)_
- **`team-swarm`** — Swarm intelligence team skill — ACO-driven multi-agent exploration with hybrid LLM coordinator + Python optimization controller. Coordinator generates swarm-config from user task, then runs K iterations of N parallel ants guided by pheromone state. Universal task space via config (nodes + scoring rule). Triggers on "team swarm", "swarm intelligence", "蚁群". _(manual or explicit orchestrator recommendation)_
- **`team-testing`** — Unified team skill for testing team. Progressive test coverage through Generator-Critic loops, shared memory, and dynamic layer selection. Triggers on "team testing". _(manual or explicit orchestrator recommendation)_

---

## Meta Skills

*Skill tooling and prompt engineering in `.claude/skills/`.*

- **`maestro-help`** — Maestro Flow 命令帮助系统。搜索命令、浏览技能、工作流推荐、新手引导。Triggers on "maestro-help", "帮助", "命令", "怎么用", "skill", "workflow", "maestro 怎么用". _(manual or explicit orchestrator recommendation)_
- **`skill-generator`** — Meta-skill for creating new Claude Code skills with configurable execution modes. Supports sequential (fixed order) and autonomous (stateless) phase patterns. Use for skill scaffolding, skill creation, or building new workflows. Triggers on "create skill", "new skill", "skill generator". _(manual or explicit orchestrator recommendation)_
- **`skill-iter-tune`** — Iterative skill tuning via execute-evaluate-improve feedback loop. Uses maestro delegate Claude to execute skill, Agy to evaluate quality, and Agent to apply improvements. Iterates until quality threshold or max iterations. Triggers on "skill iter tune", "iterative skill tuning", "tune skill". _(manual or explicit orchestrator recommendation)_
- **`skill-simplify`** — SKILL.md simplification with functional integrity verification. Analyze redundancy, optimize content, check no functionality lost. Triggers on "simplify skill", "optimize skill", "skill-simplify". _(manual or explicit orchestrator recommendation)_
- **`skill-tuning`** — Universal skill diagnosis and optimization tool. Detect and fix skill execution issues including context explosion, long-tail forgetting, data flow disruption, and agent coordination failures. Supports Agy CLI for deep analysis. Triggers on "skill tuning", "tune skill", "skill diagnosis", "optimize skill", "skill debug". _(manual or explicit orchestrator recommendation)_
- **`workflow-skill-designer`** — Meta-skill for designing orchestrator+phases structured workflow skills. Creates SKILL.md coordinator with progressive phase loading, TodoWrite patterns, and data flow. Triggers on "design workflow skill", "create workflow skill", "workflow skill designer". _(manual or explicit orchestrator recommendation)_

---

## v1 → v2 Migration

> v0.5.51 consolidated 71 v1 commands into 18 v2 unified commands. For legacy v1 references, see `inventory.json` (v1 inventory). Key replacements:
>
> - `/maestro-plan`, `/maestro-execute`, `/maestro-analyze` → first-tier steps `plan`/`execute`/`analyze`, reached through `/maestro "<intent>"`, `/maestro-next`, or `/maestro-companion`
> - `/quality-review`, `/quality-test`, `/quality-auto-test`, `/quality-debug`, `/quality-retrospective` → first-tier steps `review`/`test`/`auto-test`/`debug`/`retrospective`, dispatched by an orchestrator inside a Session chain (no slash form)
> - `/quality-refactor` → `/maestro-odyssey --mode improve`; `/security-audit` → `/maestro-odyssey --mode security` (`--tier quick|standard|deep`, `--scope`)
> - `/odyssey-debug`, `/odyssey-improve`, `/odyssey-planex`, `/odyssey-ui` → `/maestro-odyssey --mode <name>`; `/odyssey-review-test-fix` → `/maestro-odyssey --mode review`
> - `/spec-add` → `/maestro-spec "<constraint>"`; `/spec-load` → `maestro spec load`; `/spec-setup` → Read `~/.maestro/workflows/specs-setup.md` (skeleton only: `maestro spec init`); `/spec-remove` → step `specs-remove`
>   The slash command records only — it has no load/remove/setup subcommands. Spec management as a whole is not add-only: it lives on the CLI (`maestro spec load|list|search|init|status|add|injection|conflict|supersede|history|health|analytics`) and in the sibling steps `specs-load`/`specs-remove`/`specs-setup`
> - `/manage-issue` → `/maestro-issue`; `/manage-knowhow` → `/maestro-knowhow`; `/manage-harvest`, `/manage-wiki`, `/wiki-connect`, `/wiki-digest` → `/maestro-knowledge <op>`
> - `/manage-status` → `maestro session status`; `/manage-codebase-rebuild`, `/manage-codebase-refresh`, `/manage-drift-realign`, `/quality-sync` → `maestro kg index`
> - `/learn-follow`, `/learn-investigate`, `/learn-decompose` → `/maestro-learn <sub>`; `/learn-second-opinion` → `/maestro-learn consult`; `/learn-retro` → step `retrospective`
> - `/maestro-collab` → first-tier step `collab`; `/maestro-ui-codify` → `/maestro-impeccable --codify`
> - `/maestro-verify` → first-tier step `verify`; per-phase verification is also a built-in gate inside `execute`. `/maestro-quick`, `/workflow-lite-plan`, `/workflow-lite-execute` → `/maestro "<intent>"` (the coordinator picks the shortest chain)
> - `/maestro-milestone-complete` → `/maestro-session-seal`. `/maestro-milestone-audit` has no 1:1 successor: the completion gate is `/maestro-session-seal` (it verifies every run is done); a deep cross-run audit is `/maestro-odyssey --mode review`
> - `/maestro-amend` split in two: amending a Session goal → `/maestro-ralph`; generating a command overlay → `/maestro-overlay --amend`
> - **Removed with no successor** — `/maestro-swarm-workflow`, `/maestro-universal-workflow`, `/maestro-tools-register`, `/maestro-tools-execute`, `/maestro-composer`, `/maestro-player`, `/maestro-link-coordinate` (now internalised as a hook). Do not substitute another command for these.
>
> First-tier steps have no `/xxx` slash form — an orchestrator dispatches them inside a Session chain. User entry is `/maestro "<intent>"` or `/maestro-next`.

