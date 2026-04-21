---
name: maestro-coordinate
description: CLI-based coordinator - analyze intent → select command chain → execute sequentially via maestro delegate with auto-confirm
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--chain <name>]"
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
Orchestrate maestro commands via external CLI (`maestro delegate`) with async state machine.
Classifies intent, reads project state, selects command chain, then executes each step
through `maestro delegate --to <tool> --mode write` with a universal prompt template.
Auto-confirm injection ensures non-blocking background execution. Structured return
format enables context propagation between steps.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro-coordinate.md
</required_reading>

<deferred_reading>
- [coordinate template](~/.maestro/templates/cli/prompts/coordinate-step.txt) — read when filling step prompts
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords (`continue`/`next`/`status`).

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification and confirmation
- `-c` / `--continue` — Resume previous session
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force a specific chain
</context>

<execution>
Follow '~/.maestro/workflows/maestro-coordinate.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Suggest maestro-init |
| E002 | error | Clarity too low after 2 rounds | Ask to rephrase |
| E003 | error | Step failed + abort | Suggest resume with -c |
| E004 | error | Resume session not found | Show available sessions |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain selected via detectTaskType + chainMap
- [ ] Each step executed via `maestro delegate` with coordinate-step template
- [ ] Auto-confirm injected, structured return parsed
- [ ] Each completed step analyzed via `maestro delegate --to gemini --mode analysis`
- [ ] Analysis hints injected into next step prompt via `{{ANALYSIS_HINTS}}`
- [ ] Gemini sessions chained via `--resume` for accumulated context
- [ ] Session state at .workflow/.maestro-coordinate/{session_id}/
- [ ] Completion report with per-step status and quality scores
</success_criteria>
