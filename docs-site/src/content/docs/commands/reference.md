---
title: "Maestro Commands Quick Reference"
---

> Auto-generated from `inventory-v2.json` + `.claude/commands/*.md` frontmatter.
> v2 (v0.5.51+): 17 commands across 10 categories.
> Do not edit by hand — run `npm run sync:docs-reference` to regenerate.

---

## Maestro

*Intelligent coordinator and core workflow commands — init, route, execute, verify, and lifecycle management*

### `maestro`

**Usage:** `<intent> [-y] [-c] [--dry-run] [--super]`

Auto-route intent to optimal command chain — default multi-step closed-loop orchestration; stepwise interactive execution via /maestro-next

### `maestro-init`

**Usage:** `[-y] [--from <source>] [--from-brainstorm SESSION-ID]`

Initialize project with auto state detection — creates .workflow/ directory structure

### `maestro-ralph`

**Usage:** `<intent>|status|continue [-y] [--amend] [--roadmap]`

Adaptive lifecycle orchestrator — compose, dispatch ralph-executor agent, evaluate decision, loop

### `maestro-next`

**Usage:** `<intent>|--list|--suggest [-y] [--dry-run]`

Default interactive entry for development intents — recommend and execute one atomic step; multi-step work builds a user-confirmed manual-engine chain, walks stepwise, or hands off to /maestro

### `maestro-impeccable`

**Usage:** `build|redesign|improve|enhance|launch|harden|foundation|live [target] [--codify <path>]`

Frontend UI design, audit, polish, and codification — build, redesign, improve, enhance, launch, harden

### `maestro-overlay`

**Usage:** `<intent> | --amend [--scan] [--dry-run] [-y]`

Create or edit command overlays from natural language, or auto-generate from workflow deficiency signals

### `maestro-fork`

**Usage:** `--session <session_id> [--base <branch>] [--sync]`

Create or sync session worktree for parallel development

### `maestro-merge`

**Usage:** `--session <session_id> [--force] [--dry-run] [--no-cleanup] [--continue]`

Merge session worktree branch back to main

### `maestro-guard`

**Usage:** `on|off|status|allow|deny [path]`

Manage editing boundary restrictions — directory-level write boundaries

### `maestro-session-seal`

**Usage:** `[--session <session_id>] [-y] [--skip-knowledge]`

Seal current session with knowledge extraction and DAG progression

### `maestro-update`

**Usage:** `[--dry-run] [--force] [--setup-only]`

Detect version, preview changes, apply workflow upgrades

---

## Specification

*Project specs and conventions — add, load, remove entries via unified /spec command*

### `spec`

**Usage:** `add|load|remove|setup [args...]`

Manage project specs — add, load, remove entries, or initialize the spec system. Unified command with subcommands.

**Subcommands:** `add`, `load`, `remove`, `setup`

---

## Quality

*Tech debt reduction and security auditing*

### `quality-refactor`

**Usage:** `[<scope>]`

Tech debt reduction with reflection-driven iteration and systematic identification

### `security-audit`

**Usage:** `[quick|standard|deep] [--scope <path>]`

OWASP Top 10 and STRIDE security auditing with supply chain analysis — three tiers: quick, standard, deep

---

## Management

*Project status, issues, knowledge stores, drift/rebuild sync — unified /manage command*

### `manage`

**Usage:** `status|issue|knowledge|sync [args...]`

Project management hub — status, issues, knowledge stores, and drift/rebuild sync. Unified command with subcommands.

**Subcommands:** `status`, `issue`, `knowledge`, `sync`

---

## Odyssey

*Long-running iterative cycles — one entry, five modes (debug|improve|planex|review|ui)*

### `odyssey`

**Usage:** `<intent> --mode debug|improve|planex|review|ui [--auto] [-y] [-c]`

Long-running iterative cycle — one entry, five modes. Shared archaeology/audit → fix → verify → generalize → discover → persist.

**Subcommands:** `debug`, `improve`, `planex`, `review`, `ui`

---

## Learning

*Guided reading, investigation, pattern extraction, and second opinions — unified /learn command*

### `learn`

**Usage:** `follow|investigate|decompose|consult [args...]`

User-invoked learning toolkit — guided reading, investigation, pattern extraction, or second opinions. Manual /learn only; auto code analysis routes via /maestro-next.

**Subcommands:** `follow`, `investigate`, `decompose`, `consult`

---

## Team Skills

*Multi-agent team collaboration skills in `.claude/skills/team-*`.*

- **`team-adversarial-swarm`** — ACO swarm intelligence with modular Workflow composition and adversarial decision gates. Coordinator drives iteration loop; 4 composable Workflow scripts handle exploration, scoring, convergence, and synthesis — each with built-in adversarial patterns.
- **`team-arch-opt`** — Unified team skill for architecture optimization. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team arch-opt".
- **`team-brainstorm`** — Unified team skill for brainstorming team. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team brainstorm".
- **`team-coordinate`** — Universal team coordination skill with dynamic role generation. Uses team-worker agent architecture with role-spec files. Only coordinator is built-in -- all worker roles are generated at runtime as role-specs and spawned via team-worker agent. Beat/cadence model for orchestration. Triggers on "Team Coordinate ".
- **`team-designer`** — Meta-skill for generating team skills following the v4 architecture pattern. Produces complete skill packages with SKILL.md router, coordinator, worker roles, specs, and templates. Triggers on "team-designer", "design team".
- **`team-executor`** — Lightweight session execution skill. Resumes existing team-coordinate sessions for pure execution via team-worker agents. No analysis, no role generation -- only loads and executes. Session path required. Triggers on "Team Executor".
- **`team-frontend`** — Unified team skill for frontend development. Pure router — all roles read this file. Beat model is coordinator-only in monitor.md. Built-in ui-ux-pro-max design intelligence. Triggers on "team frontend".
- **`team-frontend-debug`** — Frontend debugging team using Chrome DevTools MCP. Dual-mode — feature-list testing or bug-report debugging. Triggers on "team-frontend-debug", "frontend debug".
- **`team-interactive-craft`** — Unified team skill for interactive component crafting. Vanilla JS + CSS interactive components with zero dependencies. Research -> interaction design -> build -> a11y test. Uses team-worker agent architecture. Triggers on "team interactive craft", "interactive component".
- **`team-issue`** — Unified team skill for issue resolution. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team issue".
- **`team-lifecycle-v4`** — Full lifecycle team skill — plan, develop, test, review in one coordinated session. Role-based architecture with coordinator-driven beat model. Triggers on "team lifecycle v4".
- **`team-motion-design`** — Unified team skill for motion design. Animation token systems, scroll choreography, GPU-accelerated transforms, reduced-motion fallback. Uses team-worker agent architecture. Triggers on "team motion design", "animation system".
- **`team-perf-opt`** — Unified team skill for performance optimization. Coordinator orchestrates pipeline, workers are team-worker agents. Supports single/fan-out/independent parallel modes. Triggers on "team perf-opt".
- **`team-planex`** — Unified team skill for plan-and-execute pipeline. Pure router — coordinator always. Beat model is coordinator-only in monitor.md. Triggers on "team planex".
- **`team-quality-assurance`** — Unified team skill for quality assurance. Full closed-loop QA combining issue discovery and software testing. Triggers on "team quality-assurance", "team qa".
- **`team-review`** — Unified team skill for code review. 3-role pipeline: scanner, reviewer, fixer. Triggers on team-review.
- **`team-roadmap-dev`** — Unified team skill for roadmap-driven development workflow. Coordinator discusses roadmap with user, then dispatches phased execution pipeline (plan -> execute -> verify). All roles invoke this skill with --role arg. Triggers on "team roadmap-dev".
- **`team-swarm`** — Swarm intelligence team skill — ACO-driven multi-agent exploration with hybrid LLM coordinator + Python optimization controller. Coordinator generates swarm-config from user task, then runs K iterations of N parallel ants guided by pheromone state. Universal task space via config (nodes + scoring rule). Triggers on "team swarm", "swarm intelligence", "蚁群".
- **`team-tech-debt`** — Unified team skill for tech debt identification and remediation. Scans codebase for tech debt, assesses severity, plans and executes fixes with validation. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team tech debt".
- **`team-testing`** — Unified team skill for testing team. Progressive test coverage through Generator-Critic loops, shared memory, and dynamic layer selection. Triggers on "team testing".
- **`team-ui-polish`** — Unified team skill for UI polish. Auto-discover and fix UI design issues using Impeccable design standards. Anti-AI-slop detection, color/typography/spacing quality, motion, interaction states, visual hierarchy. Uses team-worker agent architecture. Triggers on "team ui polish", "ui polish", "design polish".
- **`team-uidesign`** — Unified team skill for UI design team. Research -> design tokens -> audit -> implementation. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates dual-track pipeline with GC loops and sync points. Triggers on "team ui design", "ui design team".
- **`team-ultra-analyze`** — Deep collaborative analysis team skill. Multi-role investigation with coordinator-driven synthesis. Triggers on "team ultra-analyze", "team analyze".
- **`team-ux-improve`** — Unified team skill for UX improvement. Systematically discovers and fixes UI/UX interaction issues including unresponsive buttons, missing feedback, and state refresh problems. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team ux improve".
- **`team-visual-a11y`** — Unified team skill for visual accessibility QA. OKLCH color contrast, typography readability, focus management, WCAG AA/AAA audit at rendered level. Uses team-worker agent architecture. Triggers on "team visual a11y", "accessibility audit", "visual a11y".

---

## Scholar Skills

*Academic writing & research skills in `.claude/skills/scholar-*`.*

- **`scholar-anti-ai-writing`** — Remove AI writing patterns from academic prose. Detects and fixes inflated symbolism, promotional language, superficial analyses, vague attributions, AI vocabulary, and formulaic structures. Supports English and Chinese. Triggers on "remove AI patterns", "humanize text", "anti-AI polish", "去除AI写作痕迹", "人性化处理".
- **`scholar-citation-verify`** — Four-layer citation verification for academic papers. Scans LaTeX/BibTeX files, verifies every citation via WebSearch and Google Scholar, generates verification report with fix suggestions. Triggers on "verify citations", "check references", "citation verification", "prevent fake citations", "引用验证".
- **`scholar-experiment`** — Systematic experimental results analysis workflow for ML/AI research papers. Connects experimental data to publication-ready Results sections with statistical validation, visualizations, and quality checks. Triggers on "analyze experimental results", "generate results section", "statistical analysis of experiments", "compare model performance", "create results visualization".
- **`scholar-ideation`** — Research ideation workflow from literature search to research planning. Triggers on "brainstorm research ideas", "identify research gaps", "conduct gap analysis", "start research project", "conduct literature review", "define research question", "select research method", "plan research", "research ideation".
- **`scholar-latex-organizer`** — Organize messy conference LaTeX template .zip files into clean Overleaf-ready structure. Extracts, analyzes, cleans up, and generates README with submission requirements. Triggers on "organize LaTeX template", "clean up template", "prepare Overleaf template", "整理LaTeX模板".
- **`scholar-publish`** — Post-acceptance conference preparation workflow covering presentation slides, academic posters, and promotion content. Triggers on "scholar publish", "conference preparation", "prepare presentation", "create poster", "write promotion", "post-acceptance".
- **`scholar-rebuttal-pro`** — Enhanced academic paper review response workflow with Agy/CLI collaborative analysis and multi-perspective discussion. Produces structured rebuttal documents with evidence-based strategies. Triggers on "rebuttal", "respond to reviewers", "review response", "审稿回复".
- **`scholar-review`** — Systematic academic paper review workflow covering self-review before submission and rebuttal writing after receiving reviewer feedback. Triggers on "review paper", "self-review", "write rebuttal", "respond to reviewers", "analyze review comments", "paper review".
- **`scholar-thesis-docx`** — Create, revise, and format thesis or dissertation Word documents with strict academic formatting control. Use when an AI agent needs to generate or revise thesis content, normalize Word styles, follow a school template, fix captions or page numbers or section levels, or produce evidence-based Mermaid figures and LaTeX-formatted code listings for a thesis document.
- **`scholar-writing`** — End-to-end academic paper writing workflow. Takes a research repository and produces a publication-ready LaTeX manuscript for top ML/AI conferences (NeurIPS, ICML, ICLR, ACL, AAAI, COLM). Covers repo understanding, structure planning, section drafting, citation management, anti-AI polishing, and conference formatting. Triggers on "write paper", "draft paper", "scholar writing", "paper writing workflow".

---

## Meta Skills

*Skill tooling and prompt engineering in `.claude/skills/`.*

- **`codify-to-knowhow`** — Manifest-driven knowledge asset generator — converts any structured package into maestro knowhow + spec entries with ref linking. Triggers on "codify-to-knowhow", "style to knowhow", "知识固化".
- **`delegation-check`** — Check workflow delegation prompts against agent role definitions for content separation violations. Detects conflicts, duplication, boundary leaks, and missing contracts. Triggers on "check delegation", "delegation conflict", "prompt vs role check".
- **`insight-challenge`** — Adversarial review of code quality findings. Challenges insights with counter-evidence, verifies claims against source code, and produces structured verdicts. Triggers on 'insight-challenge', 'challenge finding', '审查发现'.
- **`maestro-help`** — Maestro Flow 命令帮助系统。搜索命令、浏览技能、工作流推荐、新手引导。Triggers on "maestro-help", "帮助", "命令", "怎么用", "skill", "workflow", "maestro 怎么用".
- **`prompt-generator`** — Generate or convert Claude Code prompt files — command orchestrators, skill files, agent role definitions, or style conversion of existing files. Follows GSD-style content separation with built-in quality gates. Triggers on "create command", "new command", "create skill", "new skill", "create agent", "new agent", "convert command", "convert skill", "convert agent", "prompt generator", "优化".
- **`skill-generator`** — Meta-skill for creating new Claude Code skills with configurable execution modes. Supports sequential (fixed order) and autonomous (stateless) phase patterns. Use for skill scaffolding, skill creation, or building new workflows. Triggers on "create skill", "new skill", "skill generator".
- **`skill-iter-tune`** — Iterative skill tuning via execute-evaluate-improve feedback loop. Uses maestro delegate Claude to execute skill, Agy to evaluate quality, and Agent to apply improvements. Iterates until quality threshold or max iterations. Triggers on "skill iter tune", "iterative skill tuning", "tune skill".
- **`skill-simplify`** — SKILL.md simplification with functional integrity verification. Analyze redundancy, optimize content, check no functionality lost. Triggers on "simplify skill", "optimize skill", "skill-simplify".
- **`skill-tuning`** — Universal skill diagnosis and optimization tool. Detect and fix skill execution issues including context explosion, long-tail forgetting, data flow disruption, and agent coordination failures. Supports Agy CLI for deep analysis. Triggers on "skill tuning", "tune skill", "skill diagnosis", "optimize skill", "skill debug".
- **`workflow-skill-designer`** — Meta-skill for designing orchestrator+phases structured workflow skills. Creates SKILL.md coordinator with progressive phase loading, TodoWrite patterns, and data flow. Triggers on "design workflow skill", "create workflow skill", "workflow skill designer".

---

## v1 → v2 Migration

> v0.5.51 consolidated 66 v1 commands into 17 v2 unified commands. For legacy v1 references, see `inventory.json` (v1 inventory). Key replacements:
>
> - `/maestro-plan`, `/maestro-execute`, `/maestro-quick` → `/maestro`, `/maestro-next`, or `/maestro-ralph`
> - `/spec-add`, `/spec-load`, `/spec-remove`, `/spec-setup` → `/spec` subcommands
> - `/manage-status`, `/manage-knowhow`, `/manage-issue`, `/manage-harvest` → `/manage` subcommands
> - `/quality-review`, `/quality-test`, `/quality-debug` → `/maestro-ralph --engine swarm` or `/odyssey`
> - `/learn-decompose`, `/learn-follow`, `/learn-investigate` → `/learn` subcommands
> - `/odyssey-debug`, `/odyssey-improve`, `/odyssey-planex` → `/odyssey --mode <name>`
> - `/wiki-connect`, `/wiki-digest` → `/manage knowledge wiki` subcommands

