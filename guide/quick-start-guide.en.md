# Quick Start Guide

Get to know Maestro Flow's core features in 10 minutes.

---

## 1. Installation

```bash
# Interactive install (recommended for first-time)
maestro install

# Non-interactive batch install
maestro install --force

# Register MCP Server only
maestro install mcp

# Install hooks automation (standard level recommended)
maestro hooks install --level standard
```

After installation, slash commands / skills and the `maestro` terminal command are available in Claude Code or Grok Build. Grok host: project instructions live in `.grok/rules/maestro.md`; project-level MCP / hooks need the folder trusted. See the Grok Build section in the [Installation Guide](install-guide.en.md).

---

## 2. Project Initialization

### Minimal Path

```bash
/maestro-init                          # Initialize .workflow/ directory
/maestro "Build the whole project from requirements" -y  # spec-driven chain: init → roadmap --mode full → plan → execute → harvest
```

### Start from Brainstorming

```bash
/maestro "brainstorm Online education platform"  # Multi-role brainstorming (brainstorm-driven chain)
/maestro-init --from-brainstorm SESSION-ID       # Initialize from brainstorm
/maestro "Create roadmap" -y                     # roadmap-driven chain
```

### Full Specification Blueprint (Large Projects)

```bash
/maestro-init
/maestro "Generate spec blueprint"     # blueprint-driven chain: 7-stage spec blueprint (Product Brief + PRD + Architecture + Epics)
```

---

## 3. Phase Pipeline

The core project progression — each Phase goes through the `analyze → plan → execute → review → test` lifecycle (verification is already cohesive within the `post-execute` decision gate):

```bash
# Closed-loop mode — /maestro-ralph builds the full lifecycle chain + decision gate
/maestro-ralph "Implement user authentication system"     # analyze → plan → execute → ◆ → review → ◆ → test → seal

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
/maestro "Implement multi-tenancy"    # analyze-macro → scope_verdict routing
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
# Auto-executes the full lifecycle
```

### No-Init Mode (Ad-hoc Tasks)

```bash
/maestro "Implement JWT auth"          # analyze-plan-execute chain, scope=standalone
maestro session start "Implement JWT auth" --chain analyze plan execute   # Build the chain directly via CLI
```

---

## 4. Quality Pipeline

Run quality verification after execution — three complementary test tracks. `auto-test` / `test` / `review` are first-tier steps dispatched by the orchestrator; trigger them by intent via `/maestro-next` or `/maestro "<intent>"` — you cannot type `/quality-*` directly:

```bash
auto-test 1                     # Unified auto-test (smart routing: spec/gap/code)
test 1                          # Conversational UAT
review 1 --level standard       # Code review
```

### Test Failure Fix Loop

`debug` / `auto-test` are also orchestrator-dispatched steps; their flags are passed through when the chain is built:

```bash
debug --from-uat 1              # Diagnose failure
plan 1 --gaps                   # Generate fix plan
execute 1                       # Execute fix
auto-test 1 --re-run            # Re-run failed scenarios
```

---

## 5. Issue Closed-Loop

Problem tracking system parallel to Phase pipeline, supports full automation:

```bash
# Discover problems
/maestro-issue discover by-prompt "Check API error handling"

# Create issue
/maestro-issue create --title "Memory leak" --severity high

# Closed-loop processing (issue-full chain)
/maestro "fix issue ISS-001"     # analyze --gaps → plan --gaps → execute → review → close → harvest
/maestro-issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** can auto-advance unanalyzed issues without manual intervention.

---

## 6. Quick Tasks

Bypass the Phase pipeline and complete tasks directly:

```bash
# Fastest path (pure router: classify intent → route to companion / single Run / /maestro)
/maestro-next "Fix login page bug"

# Lightweight execution (minimal Run lifecycle)
/maestro-companion "Fix login page bug"
```

---

## 7. Delegate Async Tasks

Delegate tasks to external AI engines (Gemini / Qwen / Codex / Claude / OpenCode / Grok):

```bash
# Async analysis (returns immediately)
maestro delegate "Analyze performance bottlenecks" --to gemini --async

# Check status and results
maestro delegate status gem-143022-a7f2
maestro delegate output gem-143022-a7f2

# Inject supplementary context mid-execution
maestro delegate message gem-143022-a7f2 "Also check utils directory"

# Task chain — auto-fix after analysis completes
maestro delegate message gem-143022-a7f2 "Fix all critical issues" --delivery after_complete
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

Project-level knowledge auto-injection — no manual context pasting when Agents start:

```bash
# Initialize
maestro spec init                              # Seed skeleton files (skeleton only, no codebase scan)
maestro run skill specs-setup                  # Existing projects: scan the codebase to populate specs
# New projects can skip -- specs are progressively populated by analyze/plan/execute

# Add specs (/maestro-spec only records; category is inferred, or state it explicitly)
/maestro-spec coding "All APIs use Hono framework"
/maestro-spec arch "Notification module uses event-driven architecture"
/maestro-spec learning "Pagination offset=0 causes off-by-one"

# Load specs (CLI)
maestro spec load --category coding
maestro spec load --keyword auth
maestro spec load --category coding --keyword auth
```

**Auto-injection**: Hooks auto-inject specs by Agent type at startup (coder→coding, tester→test, debugger→debug).

---

## 9. Overlay Command Extension

Inject custom steps without modifying original command files:

```bash
# Create via natural language
/maestro-overlay "Add CLI verification after execute"

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
| `minimal` | Context monitoring + Spec auto-injection |
| `standard` | + Delegate monitoring + Session context + Skill awareness + Coordinator tracking |
| `full` | + Workflow guard (protect critical files) |

---

## 11. Worktree Parallel Development

Milestone-level parallelism — start the next milestone without waiting for bug fixes:

```bash
/maestro-fork -m 2                              # Fork M2 worktree
cd .worktrees/m2-production/
/maestro "analyze phase 3" && /maestro "plan phase 3" && /maestro "execute phase 3"

cd /project
/maestro-merge -m 2                             # Merge back to main

# Sync main fixes to worktree
/maestro-fork -m 2 --sync
```

---

## 12. Milestone Management

```bash
# Audit (cross-Phase integration verification)
/maestro-session-manage-manage --complete

# Complete (archive and advance to next milestone)
/maestro-session-manage-manage --complete
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

## 14. Common Terminal Commands

| Command | Purpose |
|---------|---------|
| `maestro install` | Install |
| `maestro delegate "..." --to gemini` | Delegate task |
| `maestro coordinate run "..." --chain default -y` | Graph coordinator |
| `maestro overlay list` | Overlay management |
| `maestro hooks status` | Hook status |
| `maestro spec load --category coding` | Load specs |
| `maestro session status` | Canonical Session/Run status |
| `maestro launcher -w my-project` | Claude Code launcher |
| `maestro knowhow search "auth"` | Search persistent memory |

---

## 15. Typical Workflows

### New Project

```bash
/maestro-init → /maestro "Build the whole project from requirements" → /maestro-session-manage-manage --complete
# Or closed-loop: /maestro-ralph "Implement X" -y
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
```

### Bug Fix

```bash
/maestro-next "Fix mobile login page layout issues"    # routes to companion / single Run / /maestro
```

### Issue Discovery & Fix

```bash
/maestro-issue discover → /maestro "fix issue ISS-xxx" → /maestro-issue close
```

### Parallel Development

```bash
/maestro-fork -m 2 → (develop in worktree) → /maestro-merge -m 2
```
