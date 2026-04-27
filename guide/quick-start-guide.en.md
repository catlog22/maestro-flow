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

---

## 2. Project Initialization

### Minimal Path

```bash
/maestro-init                          # Initialize .workflow/ directory
/maestro-roadmap "Project name and goals" -y  # Generate roadmap
```

### Start from Brainstorming

```bash
/maestro-brainstorm "Online education platform"  # Multi-role brainstorming
/maestro-init --from-brainstorm ANL-xxx          # Initialize from brainstorm
/maestro-roadmap "Create roadmap" -y
```

### Full Specification Chain (Large Projects)

```bash
/maestro-init
/maestro-spec-generate                 # 7-stage full spec generation (PRD + architecture + roadmap)
```

---

## 3. Phase Pipeline

The core project progression — each Phase goes through `Analyze → Plan → Execute → Verify`:

```bash
# Full mode — covers all phases in current milestone
/maestro-analyze                       # Analyze
/maestro-plan                          # Plan
/maestro-execute                       # Execute
/maestro-verify                        # Verify

# Per-phase mode
/maestro-analyze 1                     # Analyze Phase 1 only
/maestro-plan 1                        # Plan Phase 1 only
/maestro-execute 1                     # Execute Phase 1 only
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
# Auto-executes the full lifecycle
```

### No-Init Mode (Ad-hoc Tasks)

```bash
/maestro-analyze "Implement JWT auth"  # scope=standalone, auto-creates state.json
/maestro-plan --dir scratch/20260420-analyze-jwt-...
/maestro-execute --dir scratch/20260420-plan-jwt-...
```

---

## 4. Quality Pipeline

Run quality verification after execution — three complementary test tracks:

```bash
# PRD-Forward: Are business rules satisfied?
/quality-business-test 1

# Code-Backward: Does the code work?
/quality-test 1

# Coverage-Backward: Is coverage sufficient?
/quality-test-gen 1

# Code review
/quality-review 1 --level standard
```

### Test Failure Fix Loop

```bash
/quality-debug --from-business-test 1  # Diagnose failure
/maestro-plan 1 --gaps                 # Generate fix plan
/maestro-execute 1                     # Execute fix
/quality-business-test 1 --re-run      # Re-run failed scenarios
```

---

## 5. Issue Closed-Loop

Problem tracking system parallel to Phase pipeline, supports full automation:

```bash
# Discover problems
/manage-issue-discover by-prompt "Check API error handling"

# Create issue
/manage-issue create --title "Memory leak" --severity high

# Closed-loop processing
/maestro-analyze --gaps ISS-001         # Root cause analysis
/maestro-plan --gaps                    # Solution planning
/maestro-execute                        # Execute fix
/manage-issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** can auto-advance unanalyzed issues without manual intervention.

---

## 6. Quick Tasks

Bypass the Phase pipeline and complete tasks directly:

```bash
# Shortest path
/maestro-quick "Fix login page bug"

# With plan validation
/maestro-quick --full "Refactor API layer"

# With decision extraction
/maestro-quick --discuss "Database migration strategy"
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
/spec-setup

# Add specs
/spec-add coding "All APIs use Hono framework"
/spec-add arch "Notification module uses event-driven architecture"
/spec-add learning "Pagination offset=0 causes off-by-one"

# Load specs
/spec-load --category coding
/spec-load --keyword auth
/spec-load --category coding --keyword naming
```

**Auto-injection**: Hooks auto-inject specs by Agent type at startup (coder→coding, tester→test, debugger→debug).

---

## 9. Overlay Command Extension

Inject custom steps without modifying original command files:

```bash
# Create via natural language
/maestro-overlay "Add CLI verification after maestro-execute"

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
/maestro-analyze 3 && /maestro-plan 3 && /maestro-execute 3

cd /project
/maestro-merge -m 2                             # Merge back to main

# Sync main fixes to worktree
/maestro-fork -m 2 --sync
```

---

## 12. Milestone Management

```bash
# Audit (cross-Phase integration verification)
/maestro-milestone-audit

# Complete (archive and advance to next milestone)
/maestro-milestone-complete
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

## 14. Common Terminal Commands

| Command | Purpose |
|---------|---------|
| `maestro install` | Install |
| `maestro delegate "..." --to gemini` | Delegate task |
| `maestro coordinate run "..." --chain default -y` | Graph coordinator |
| `maestro overlay list` | Overlay management |
| `maestro hooks status` | Hook status |
| `maestro spec load --category coding` | Load specs |
| `maestro view` | Dashboard |
| `maestro launcher -w my-project` | Claude Code launcher |
| `maestro knowhow search "auth"` | Search persistent memory |

---

## 15. Typical Workflows

### New Project

```bash
/maestro-init → /maestro-roadmap → /maestro-plan 1 → /maestro-execute 1 → /maestro-verify 1 → /maestro-milestone-audit
```

### One-Click Full Auto

```bash
/maestro -y "Implement user authentication system"
```

### Bug Fix

```bash
/maestro-quick "Fix mobile login page layout issues"
```

### Issue Discovery & Fix

```bash
/manage-issue-discover → /maestro-analyze --gaps ISS-xxx → /maestro-plan --gaps → /maestro-execute → close
```

### Parallel Development

```bash
/maestro-fork -m 2 → (develop in worktree) → /maestro-merge -m 2
```
