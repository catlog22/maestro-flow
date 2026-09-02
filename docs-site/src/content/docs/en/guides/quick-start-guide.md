---
title: "Quick Start Guide"
icon: "🚀"
---

Get to know Maestro Flow's core features and usage in 10 minutes.

---

## 1. Installation

```bash
# Interactive install (recommended for first-time use)
maestro install

# One-click full install
maestro install --force

# Register MCP Server only
maestro install mcp

# Install Hook automation (standard level recommended)
maestro hooks install --level standard
```

After installation, slash commands / skills and the `maestro` terminal command are available in Claude Code or Grok Build. Grok host: project instructions live in `.grok/rules/maestro.md`; project-level MCP / hooks need the folder trusted. See the Grok Build section in the [Installation Guide](/guides/install).

### Optional Skill Packs (install as needed)

In the `maestro install` interactive UI, the **skills-scholar** pack is unchecked by default — opt in as needed; see the [Installation Guide](/guides/install) for full details.

> Since v0.5.61 the skill surface was sharply trimmed: 20 zero-usage team/helper skills were deleted, and former skills-extra-team / skills-meta members were either merged into core or removed; skills-extra-team and skills-meta remain only as legacy no-op bundles.

**skills-scholar (10 academic skills, opt-in)**: scholar-ideation, scholar-writing, scholar-experiment, scholar-citation-verify, scholar-anti-ai-writing, scholar-latex-organizer, scholar-review, scholar-rebuttal-pro, scholar-thesis-docx, scholar-publish

```bash
# After installing a pack, enable/disable individual skills one by one
maestro install toggle --type skill --list
maestro install toggle --type skill --enable scholar-writing
```

> 8 built-in team skills (team-arch-opt, team-coordinate, team-issue, team-lifecycle-v4, team-perf-opt, team-review, team-swarm, team-testing) are installed automatically with the core components — no separate selection needed.

---

## 2. Project Initialization

### Minimal Path

```bash
/maestro-init                          # Initialize the .workflow/ directory
/maestro "从需求开始做整个项目" -y      # spec-driven chain: init → roadmap --mode full → plan → execute → harvest
```

### Start from Brainstorming

```bash
/maestro "brainstorm 在线教育平台"      # Multi-role brainstorming (brainstorm-driven chain)
/maestro-init --from-brainstorm SESSION-ID                  # Initialize based on brainstorming
/maestro "创建路线图" -y                # roadmap-driven chain
```

### Full Specification Blueprint (Large Projects)

```bash
/maestro-init
/maestro "生成规范蓝图"                   # blueprint-driven chain: 7-stage spec blueprint (Product Brief + PRD + Architecture + Epics)
```

---

## 3. Phase Pipeline

The core project progression — each Phase goes through the `analyze → plan → execute → review → test` lifecycle (verification is already cohesive within the `post-execute` decision gate):

```bash
# Closed-loop mode — /maestro-ralph builds the full lifecycle chain + decision gate
/maestro-ralph "实现用户认证系统"     # analyze → plan → execute → ◆ → review → ◆ → test → seal

# Step-by-step mode (single-step chains routed via /maestro)
/maestro "analyze"                    # Analyze
/maestro "plan phase 1"               # Plan
/maestro "execute"                    # Execute
# Note: /maestro-verify was retired in v0.5.51 — verification is integrated into the maestro-ralph decision gate

# Per-Phase mode (micro layer: Phase-level deep analysis)
/maestro "analyze phase 1"            # Analyze Phase 1 only
/maestro "plan phase 1"               # Plan Phase 1 only
/maestro "execute phase 1"            # Execute Phase 1 only

# Macro exploration mode (macro layer: use before roadmap)
/maestro "实现多租户架构"              # analyze-macro → scope_verdict routing
```

### One-Click Full Auto

```bash
/maestro -y "实现用户认证系统"
# Auto-classifies intent → creates canonical Session → runs the full lifecycle
```

### No-Init Mode (Ad-hoc Tasks)

```bash
/maestro "实现 JWT 认证"                 # analyze-plan-execute chain, scope=standalone
maestro session start "实现 JWT 认证" --chain analyze plan execute   # Build the chain directly via CLI
```

---

## 4. Quality Pipeline

Run quality verification after execution — the quality gate is inserted into the chain as a decision node by the Ralph strategy:

```bash
# Closed-loop mode (quality gate inserted automatically)
/maestro-ralph "实现 X"     # execute → ◆post-execute → review → ◆post-review → test → ◆post-test

# Single-step quality commands (routed via /maestro)
/maestro "review phase 1"               # Code review
/maestro "test phase 1"                 # UAT testing
/maestro-odyssey --mode security 1                        # Security audit
```

### Test Failure Fix Loop

```bash
/maestro-odyssey --mode debug --from-uat 1      # Diagnose failure
/maestro "review 有问题需要修"            # review-fix chain: plan --gaps → execute → review
/maestro "全面质量检查"                   # quality-loop chain: review → auto-test → test → debug → plan --gaps → execute
```

---

## 5. Issue Closed-Loop

A problem tracking system independent of the Phase pipeline, supporting full closed-loop automation:

```bash
# Discover problems
/maestro-issue discover by-prompt "检查 API 错误处理"

# Create an Issue
/maestro-issue create --title "内存泄漏" --severity high

# Closed-loop processing (issue-full chain)
/maestro "fix issue ISS-001"     # analyze --gaps → plan --gaps → execute → review → close → harvest
/maestro-issue close ISS-001 --resolution "Fixed"
```

The **Commander Agent** can auto-advance unanalyzed Issues without manual intervention.

---

## 6. Quick Tasks

Skip the Phase pipeline and complete tasks directly:

```bash
# Fastest path (pure router: classify intent → route to companion / single Run / /maestro)
/maestro-next "修复登录页 Bug"

# Lightweight execution (minimal Run lifecycle)
/maestro-companion "修复登录页 Bug"
```

---

## 7. Delegate Async Delegation

Delegate tasks to external AI engines (Gemini / Qwen / Codex / Claude / OpenCode / Grok):

```bash
# Async analysis (returns immediately)
maestro delegate "分析性能瓶颈" --to gemini --async

# Check status and results
maestro delegate status gem-143022-a7f2
maestro delegate output gem-143022-a7f2

# Append context while running
maestro delegate message gem-143022-a7f2 "同时检查 utils 目录"

# Task chain — auto-fix after analysis completes
maestro delegate message gem-143022-a7f2 "修复所有高危问题" --delivery after_complete
```

### Supported --rule Templates

```bash
# Analysis
maestro delegate "..." --rule analysis-diagnose-bug-root-cause
maestro delegate "..." --rule analysis-analyze-code-patterns
maestro delegate "..." --rule analysis-assess-security-risks

# Planning
maestro delegate "..." --rule planning-plan-architecture-design
maestro delegate "..." --rule planning-breakdown-task-steps

# Development
maestro delegate "..." --rule development-implement-feature --mode write
```

---

## 8. Spec Management

Project-level knowledge auto-injection — no manual context pasting when the Agent starts:

```bash
# Initialize
maestro spec init                                       # Seed skeleton files (skeleton only, no codebase scan)
maestro run skill specs-setup                           # Existing projects: scan the codebase to populate specs
# New projects can skip -- specs are progressively populated by analyze/plan/execute

# Add specs (/maestro-spec only records; category is inferred, or state it explicitly)
/maestro-spec coding "所有 API 使用 Hono 框架"
/maestro-spec arch "通知模块使用事件驱动架构"
/maestro-spec learning "分页 offset=0 会越界"

# Load specs (CLI)
maestro spec load --category coding
maestro spec load --keyword auth
maestro spec load --category coding --keyword auth
```

**Auto-injection**: Hooks auto-inject the corresponding specs by type when the Agent starts (coder→coding, tester→test, debugger→debug).

---

## 9. Overlay Command Extension

Inject custom steps without modifying the original command files:

```bash
# Create via natural language
/maestro-overlay "在 execute 后增加 CLI 验证"

# Manage
maestro overlay list                    # Interactive TUI view
maestro overlay apply                   # Reapply (idempotent)
maestro overlay remove cli-verify       # Remove

# Team sharing
maestro overlay bundle -o team.json     # Bundle
maestro overlay import-bundle team.json # Import
```

---

## 10. Hooks Automation

```bash
# Install (standard recommended)
maestro hooks install --level standard

# Check status
maestro hooks status

# Toggle individual hooks
maestro hooks toggle spec-injector off
```

| Level | Includes |
|-------|----------|
| `minimal` | Context monitoring + spec auto-injection |
| `standard` | + Delegate monitoring + session context + Skill awareness + coordinator tracking + KG sync + KG context injection |
| `full` | + Workflow guard (protect critical files) |

---

## 11. Worktree Parallel Development

Milestone-level parallelism — start the next stage without waiting for bug fixes to finish:

```bash
/maestro-fork -m 2                              # Fork M2 worktree
cd .worktrees/m2-production/
/maestro "analyze phase 3" && /maestro "plan phase 3" && /maestro "execute phase 3"

cd /project
/maestro-merge -m 2                             # Merge back to main

# Sync main fixes to the worktree
/maestro-fork -m 2 --sync
```

---

## 12. Milestone Management

```bash
# Audit (cross-Phase integration verification)
/maestro-session-seal

# Complete (archive and advance to the next milestone)
/maestro-session-seal
```

---

## 13. Workflow Status

```bash
maestro run brief          # Current Run resume packet
maestro run check          # Current Run gates and completion guidance
maestro session status     # Canonical Session/Run status
```

The Dashboard UI is retired; inspect workflow state through the Session/Run commands.

---

## 14. Knowledge Search & Code Graph

### Unified Search

```bash
maestro search "auth token"                        # BM25 full-text search
maestro search "auth" --type spec                   # Search specs only
maestro search "auth" --category coding             # Filter by category
```

**Deprecated**: `spec search`, `knowhow search`, `wiki search` — unified into `maestro search`.

### CodeGraph (Optional)

A function-level knowledge graph providing call relationships and symbol queries:

```bash
# Install (optional, enables function-level KG)
npm install -g @colbymchenry/codegraph

# Initialize the index
maestro kg index --sqlite

# Query
maestro kg search "validateToken"                   # Symbol search
maestro kg context "validateToken"                  # Callers/callees
```

Once installed, hooks keep the graph fresh and provide context automatically (`kg-sync` incremental sync + `keyword-spec-injector` single-prompt context composition).

---

## 15. Common Terminal Commands Quick Reference

| Command | Purpose |
|---------|---------|
| `maestro install` | Install |
| `maestro search "query"` | Unified knowledge search |
| `maestro delegate "..." --to gemini` | Delegate a task |
| `maestro session start "..." --chain analyze plan execute` | Build a chain and dispatch (human entry point) |
| `maestro session status` | canonical Session/Run status |
| `maestro overlay list` | Overlay management |
| `maestro hooks status` | Hook status |
| `maestro spec load --category coding` | Load specs |
| `maestro kg search "symbol"` | Code graph search |
| `maestro launcher -w my-project` | Claude Code launcher |

---

## 16. Typical Workflows at a Glance

### New Project

```bash
/maestro-init → /maestro "从需求开始做整个项目" → /maestro-session-seal
# Or closed-loop: /maestro-ralph "实现 X" -y
```

### One-Click Full Auto

```bash
/maestro -y "实现用户认证系统"
```

### Bug Fix

```bash
/maestro-next "修复移动端登录页布局问题"    # Routes to companion / single Run / /maestro
```

### Issue Discovery & Fix

```bash
/maestro-issue discover → /maestro "fix issue ISS-xxx" → /maestro-issue close
```

### Parallel Development

```bash
/maestro-fork -m 2 → (develop in the worktree) → /maestro-merge -m 2
```
