---
name: maestro-link-coordinate
description: Execute command chain nodes step by step
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
Step-mode workflow coordinator using `maestro coordinate` CLI subcommands (start/next/status).
Walks chain graphs node by node — each command node executed via `maestro delegate` internally.
Decision/gate/eval nodes auto-resolve between steps. Session persisted for resume.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro-link-coordinate.md
</required_reading>

<context>
$ARGUMENTS — user intent text, or flags.

**Flags:**
- `--list` — List all available chain graphs
- `-c` / `--continue [sessionId]` — Resume step_paused session via `coordinate next`
- `--chain <name>` — Force a specific chain graph
- `--tool <tool>` — CLI tool override (default: claude)
- `-y` / `--yes` — Auto mode

**CLI endpoints used:**
- `maestro coordinate list` — enumerate chains
- `maestro coordinate start "intent" --chain X` — begin step-mode session
- `maestro coordinate next [sessionId]` — advance one step
- `maestro coordinate status [sessionId]` — query state
- `maestro coordinate run "intent"` — autonomous full run
- `maestro coordinate watch <sessionId> [--follow]` — read-only event tail (separate from driver loop)
- `maestro coordinate report` — agent-invoked command-node result writer (authoritative result channel)

**Internal walker capabilities (invisible to driver loop):**
- Prompt assembly owned by the walker (main flow) for both command and decision nodes
- Decision nodes auto-resolve via `strategy: 'expr'` (fast path) with LLM decider fallback when expr has no match and no default edge, or explicit `strategy: 'llm'`
- Walker events published to a file/SQLite broker for `watch` observers
- LLM decision in step mode is synchronous — avoid tight per-step deadlines
</context>

<execution>
Follow '~/.maestro/workflows/maestro-link-coordinate.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no --list/--chain | Suggest --list |
| E002 | error | Chain graph not found | Show list output |
| E003 | error | Step execution failed | Check status, retry next |
| E004 | error | Resume session not found | List sessions |
| E005 | error | CLI endpoint unavailable | Check maestro installation |
</error_codes>

<success_criteria>
- [ ] Chain graph loaded via `maestro coordinate start`
- [ ] Each step executed via `maestro coordinate next` loop
- [ ] JSON output parsed for session tracking
- [ ] Decision nodes auto-resolved between steps
- [ ] Session persisted and resumable via `-c`
- [ ] Completion summary displayed
</success_criteria>
