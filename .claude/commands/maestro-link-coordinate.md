---
name: maestro-link-coordinate
description: Interactive step-by-step workflow coordinator — preview, modify, skip, add/remove steps before execution
argument-hint: "\"intent text\" [--list] [-c [sessionId]] [--chain <name>] [--tool <tool>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Interactive step-by-step coordinator that extends Graph Walker with pause-preview-act semantics.
At each command node: shows preview (command, args, description, prompt, upcoming chain with
descriptions), then asks user to Execute / Skip / Modify args / Add step / Delete step / Quit.
Enables dynamic chain editing during walk — user controls the pace and shape of the workflow.

Each command node carries a `description` field that explains what the step does, enabling
meaningful previews and informed user decisions at each step.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro-link-coordinate.md
</required_reading>

<context>
$ARGUMENTS — user intent text, flags, or `--list`.

**Flags:**
- `--list` — List all available command chains with ID, name, cmd count, description
- `-c` / `--continue [sessionId]` — Resume previous link session (latest if no ID)
- `--chain <name>` — Force a specific graph (use `--list` to see available names)
- `--tool <tool>` — CLI tool override (default: claude)

**Discovery:** Run `--list` first to see available chains and their descriptions, then
pick one with `--chain <name>` or let IntentRouter auto-resolve from intent text.

**Session persistence:** Each session saves to `.workflow/.maestro-coordinate/{session_id}/`
with link-state.json, graph-snapshot.json (with edits), modifications.json, and outputs/.
</context>

<execution>
Follow '~/.maestro/workflows/maestro-link-coordinate.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no --list/--chain | Ask user for intent or suggest --list |
| E002 | error | Graph not found or empty | Show `--list` output for available chains |
| E003 | error | Step execution failed | Show failure summary, offer Skip/Quit |
| E004 | error | Resume session not found | List available sessions in .maestro-coordinate/ |
| E005 | warning | Decision node has no matching edge | Falls to default edge or fails gracefully |
</error_codes>

<success_criteria>
- [ ] `--list` shows all chains with descriptions, tags, and command counts
- [ ] Graph loaded and first step preview displays command, args, description, upcoming chain
- [ ] Each step pauses for user action before execution
- [ ] User can add/remove/modify/skip steps dynamically
- [ ] Upcoming chain shows command descriptions (not just raw args)
- [ ] Decision/gate/eval nodes auto-resolve without pausing
- [ ] Session state persisted at .workflow/.maestro-coordinate/{session_id}/
- [ ] Resume (-c) restores exact position including graph modifications
- [ ] Completion summary shows executed/skipped/added/removed counts
</success_criteria>
