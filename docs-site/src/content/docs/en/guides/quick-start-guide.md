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

After installation, `/maestro-*` slash commands and `maestro` terminal commands are available in Claude Code.

### Optional Skill Packs (opt-in)

In the `maestro install` interactive UI, the following 3 skill packs are unchecked by default — opt in as needed. Each skill has an individual detail page (under the Team / Scholar / Meta categories); see the [Installation Guide](/guides/install) for full details.

**skills-extra-team (16 team collaboration skills)**: team-arch-opt, team-brainstorm, team-designer, team-frontend, team-frontend-debug, team-interactive-craft, team-issue, team-motion-design, team-perf-opt, team-planex, team-roadmap-dev, team-ui-polish, team-uidesign, team-ultra-analyze, team-ux-improve, team-visual-a11y

**skills-scholar (10 academic skills)**: scholar-ideation, scholar-writing, scholar-experiment, scholar-citation-verify, scholar-anti-ai-writing, scholar-latex-organizer, scholar-review, scholar-rebuttal-pro, scholar-thesis-docx, scholar-publish

**skills-meta (5 meta skills)**: skill-generator, skill-simplify, skill-tuning, prompt-generator, delegation-check

```bash
# After installing a pack, enable/disable individual skills
maestro install toggle --type skill --list
maestro install toggle --type skill --enable scholar-writing
```

> 9 built-in team skills (team-coordinate, team-executor, team-lifecycle-v4, team-quality-assurance, team-review, team-swarm, team-tech-debt, team-testing, team-adversarial-swarm) are installed automatically with the core components — no separate selection needed.

---

## 2. Project Initialization

### Minimal Path

```bash
/maestro-init                          # Initialize .workflow/ directory
/maestro-ralph --roadmap "Project name and goals" -y  # Generate roadmap
```

### Start from Brainstorming

```bash
/maestro-ralph --engine swarm --script wf-brainstorm "Online education platform"  # Multi-role brainstorming
/maestro-init --from brainstorm:ANL-xxx                                          # Initialize from brainstorm
/maestro-ralph --roadmap "Create roadmap" -y
```

### Full Specification Blueprint (Large Projects)

```bash
/maestro-init
/maestro "Generate spec blueprint"        # 6-stage spec blueprint (Product Brief + PRD + Architecture + Epics)
```

---

## 3. Phase Pipeline

The core project progression — each Phase goes through `Analyze → Plan → Execute → Verify`:

```bash
# Full mode — covers all phases in current milestone
/maestro-ralph --engine swarm --script wf-analyze  # Analyze
/maestro-next                                      # Plan
/maestro-ralph continue                            # Execute
# Note: maestro-verify retired in v0.5.51 — verification integrated into maestro-ralph decision gate

# Per-phase mode (micro layer: Phase-level deep analysis)
/maestro-ralph --engine swarm --script wf-analyze 1  # Analyze Phase 1 only (6-dimension scoring)
/maestro-next 1                                      # Plan Phase 1 only
/maestro-ralph continue 1                            # Execute Phase 1 only

# Macro exploration (macro layer: use before roadmap)
/maestro "Implement multi-tenancy"                   # Requirement impact exploration → scope_verdict routing
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
# Auto-executes the full lifecycle
```

### No-Init Mode (Ad-hoc Tasks)

```bash
/maestro "Implement JWT auth"  # scope=standalone, auto-creates state.json
/maestro-next --dir scratch/20260420-analyze-jwt-...
/maestro-ralph continue --dir scratch/20260420-plan-jwt-...
```

---

## 4. Quality Pipeline

Run quality verification after execution — three complementary test tracks:

```bash
# Unified auto-test (smart routing: spec/gap/code)
/maestro-ralph --engine swarm 1

# Security audit / testing
/security-audit 1

# Code review
/maestro-ralph --engine swarm --script wf-review 1
```

### Test Failure Fix Loop

```bash
/odyssey --mode debug --from-uat 1      # Diagnose failure
/maestro-next 1 --gaps                 # Generate fix plan
/maestro-ralph continue 1              # Execute fix
/maestro-ralph --engine swarm 1 --re-run  # Re-run failed scenarios
```

---

## 5. Issue Closed-Loop

Problem tracking system parallel to Phase pipeline, supports full automation:

```bash
# Discover problems
/manage issue discover by-prompt "Check API error handling"

# Create issue
/manage issue create --title "Memory leak" --severity high

# Closed-loop processing
/maestro-ralph --engine swarm --script wf-analyze --gaps ISS-001  # Root cause analysis
/maestro-next --gaps                    # Solution planning
/maestro-ralph continue                 # Execute fix
/manage issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** can auto-advance unanalyzed issues without manual intervention.

---

## 6. Quick Tasks

Bypass the Phase pipeline and complete tasks directly:

```bash
# Shortest path
/maestro-next "Fix login page bug"

# With plan validation
/maestro-next "Refactor API layer" --full

# With decision extraction
/maestro-next --note "Database migration strategy"
```

---

## 7. Delegate Async Tasks

Delegate tasks to external AI engines (Gemini/Qwen/Codex/Claude/OpenCode):

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
# Initialize (scan codebase to generate spec files)
/spec setup                                     # Existing projects: scan codebase to populate specs
# New projects can skip -- specs are progressively populated by analyze/plan/execute

# Add specs
/spec add coding "All APIs use Hono framework"
/spec add arch "Notification module uses event-driven architecture"
/spec add learning "Pagination offset=0 causes off-by-one"

# Load specs
/spec load --role implement
/spec load --keyword auth
/spec load --role implement --keyword auth
```

**Auto-injection**: Hooks auto-inject specs by Agent type at startup (coder→coding, tester→test, debugger→debug).

---

## 9. Overlay Command Extension

Inject custom steps without modifying original command files:

```bash
# Create via natural language
/maestro-overlay "Add CLI verification after maestro-ralph continue"

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
| `standard` | + Delegate monitoring + Session context + Skill awareness + Coordinator tracking + KG sync + KG context injection |
| `full` | + Workflow guard (protect critical files) |

---

## 11. Worktree Parallel Development

Milestone-level parallelism — start the next milestone without waiting for bug fixes:

```bash
/maestro-fork -m 2                              # Fork M2 worktree
cd .worktrees/m2-production/
/maestro-ralph --engine swarm --script wf-analyze 3 && /maestro-next 3 && /maestro-ralph continue 3

cd /project
/maestro-merge -m 2                             # Merge back to main

# Sync main fixes to worktree
/maestro-fork -m 2 --sync
```

---

## 12. Milestone Management

```bash
# Audit (cross-Phase integration verification)
/maestro-session-seal

# Complete (archive and advance to next milestone)
/maestro-session-seal
```

---

## 13. Dashboard

```bash
maestro view              # Browser kanban board
maestro view --tui        # Terminal UI
maestro stop              # Stop server
```

Displays Phase progress, Issue status (Backlog → In Progress → Review → Done), supports batch execution and Agent selection.

---

## 14. Knowledge Search & Code Graph

### Unified Search

```bash
maestro search "auth token"                        # BM25 full-text search
maestro search "auth" --type spec                   # Spec only
maestro search "auth" --category coding             # Filter by category
```

**Deprecated**: `spec search`, `knowhow search`, `wiki search` — unified into `maestro search`.

### CodeGraph (Optional)

Function-level Knowledge Graph with call relationships and symbol queries:

```bash
# Install (optional, enables function-level KG)
npm install -g @colbymchenry/codegraph

# Initialize index
maestro kg index --sqlite

# Query
maestro kg search "validateToken"                   # Symbol search
maestro kg context "validateToken"                  # Callers/callees
```

Once installed, hooks keep the graph fresh automatically (`kg-sync` incremental sync + `kg-context-injector` agent injection).

---

## 15. Common Terminal Commands

| Command | Purpose |
|---------|---------|
| `maestro install` | Install |
| `maestro search "query"` | Unified knowledge search |
| `maestro delegate "..." --to gemini` | Delegate task |
| `maestro coordinate run "..." --chain default -y` | Graph coordinator |
| `maestro overlay list` | Overlay management |
| `maestro hooks status` | Hook status |
| `maestro spec load --category coding` | Load specs |
| `maestro kg search "symbol"` | Code graph search |
| `maestro view` | Dashboard |
| `maestro launcher -w my-project` | Claude Code launcher |

---

## 16. Typical Workflows

### New Project

```bash
/maestro-init → /maestro-ralph --roadmap → /maestro-next 1 → /maestro-ralph continue 1 → /maestro-session-seal
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
```

### Bug Fix

```bash
/maestro-next "Fix mobile login page layout issues"
```

### Issue Discovery & Fix

```bash
/manage issue discover → /maestro-ralph --engine swarm --script wf-analyze --gaps ISS-xxx → /maestro-next --gaps → /maestro-ralph continue → /manage issue close
```

### Parallel Development

```bash
/maestro-fork -m 2 → (develop in worktree) → /maestro-merge -m 2
```
