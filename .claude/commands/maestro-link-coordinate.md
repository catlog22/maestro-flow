---
name: maestro-link-coordinate
description: Chain-graph coordinator — load chain JSON, walk graph nodes, execute each step via maestro cli
argument-hint: "\"intent text\" [--list] [-c [sessionId]] [--chain <name>] [--tool <tool>] [-y]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---
<purpose>
Graph-driven workflow coordinator using chain JSON definitions from `chains/`.
Loads a chain graph, walks nodes (command/decision/gate/terminal), executes each
command step via `maestro cli --tool <tool> --mode write`. Decision nodes auto-resolve
based on previous step output. Walker state persisted for resume support.

Replaces hardcoded chainMap with declarative chain JSON graphs — same execution
model as maestro-coordinate but data-driven.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro-link-coordinate.md
</required_reading>

<deferred_reading>
- [coordinate template](~/.maestro/templates/cli/prompts/coordinate-step.txt) — read when filling step prompts
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or flags.

**Flags:**
- `--list` — List all available chain graphs with ID, name, cmd count
- `-c` / `--continue [sessionId]` — Resume previous session
- `--chain <name>` — Force a specific chain graph (e.g. `full-lifecycle`, `issue-lifecycle`)
- `--tool <tool>` — CLI tool override (default: claude)
- `-y` / `--yes` — Auto mode: skip confirmations, inject auto-flags

**Chain discovery:** `--list` scans `chains/` directory. Use `--chain <id>` to force a specific graph.
Without `--chain`, intent is matched via `chains/_intent-map.json` patterns.
</context>

<execution>
Follow '~/.maestro/workflows/maestro-link-coordinate.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no --list/--chain | Suggest --list to see available chains |
| E002 | error | Chain graph not found | Show --list output |
| E003 | error | Step execution failed | Auto-retry once, then skip or abort |
| E004 | error | Resume session not found | List sessions in .maestro-coordinate/ |
| E005 | warning | Decision node has no matching edge | Fall to default edge or fail |
| E006 | error | CLI tool unavailable | Try fallback tool |
</error_codes>

<success_criteria>
- [ ] Chain graph loaded from `chains/` JSON file
- [ ] Entry node resolved, graph walk initiated
- [ ] Each command node executed via `maestro cli` with coordinate-step template
- [ ] Decision nodes auto-resolved from `ctx.result.status`
- [ ] Gate/eval nodes processed without CLI call
- [ ] Terminal node reached → session complete
- [ ] Walker state persisted to `.workflow/.maestro-coordinate/{session_id}/`
- [ ] Resume (`-c`) restores position and continues walk
- [ ] `--list` displays all chains from `chains/` directory
- [ ] Completion report with per-step status
</success_criteria>
