---
name: maestro
description: Intelligent coordinator - analyze intent + read project state → select optimal command chain → dispatch to unified executor
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--exec auto|cli|internal] [--tool <name>] [--super]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - TodoWrite
---
<purpose>
Orchestrate all maestro commands automatically based on user intent and current project state.
Two routing modes:
1. **Intent-based**: User describes a goal → classify task type → select/compose command chain → confirm → execute
2. **State-based**: Read .workflow/state.json → determine next logical step → suggest/execute (triggered by `continue`/`next`)

Per-step type selection (default: auto):
- **skill**: Execute via Skill() in current session — output visible in conversation, synchronous, user can intervene
- **cli**: Heavy execution steps via CLI delegate — context isolation, template-driven prompts

Produces session directory at `.workflow/.maestro/{session_id}/` with status.json tracking chain progress.
Dispatches to unified executor (`maestro-ralph-execute`) for sequential step execution with artifact propagation.
</purpose>

<deferred_reading>
- [maestro.md](~/.maestro/workflows/maestro.md) — read at execution start (Steps 1-3: intent analysis, chain selection, session setup; Step 4 dispatches to unified executor)
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag is active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Special keywords:**
- `continue` / `next` / `go` — State-based routing: read state.json, determine next step, execute
- `status` — Shortcut to Skill({ skill: "manage-status" })

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors. Propagates to downstream commands that support it.
- `-c` / `--continue` — Resume previous coordinator session from `.workflow/.maestro/*/status.json`
- `--dry-run` — Show planned chain without executing
- `--exec <mode>` — Execution engine: `auto` (default), `cli`, `internal`. `internal` = Skill() in current session; `cli` = delegate to external CLI. Auto selects per step based on command complexity.
- `--tool <name>` — CLI tool for delegate execution (default: claude). Only used when engine=cli.
- `--super` — Super mode: deliver production-ready complete software system. See Super Mode section below.

**State files read:**
- `.workflow/state.json` — project state machine + artifact registry
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/scratch/*/plan.json` — plan metadata (via artifact registry paths)
</context>

<execution>
**Resume mode (`-c`):** Skip selection workflow entirely — scan `.workflow/.maestro/` for latest session, then `Skill({ skill: "maestro-ralph-execute" })`. The unified executor discovers the running session and resumes from the next pending step. **End.**

**Normal mode:** Read `~/.maestro/workflows/maestro.md` from deferred_reading, then follow it completely.

**Auto mode (`-y`) propagation:**

When `-y` is active, maestro propagates auto flags to downstream commands. Only commands that explicitly support auto mode receive the flag — others execute normally (no forced flags).

| Command | Auto Flag | Effect |
|---------|-----------|--------|
| maestro-init | `-y` | Skip interactive questioning |
| maestro-analyze | `-y` | Skip interactive scoping, auto-deepen |
| maestro-brainstorm | `-y` | Skip interactive questions, use defaults |
| maestro-roadmap | `-y` | Skip interactive questions, use defaults (create/revise/review) |
| maestro-ui-design | `-y` | Skip interactive selection, pick top variant |
| maestro-plan | `-y` | Skip confirmations and clarification |
| maestro-execute | `-y` | Skip confirmations, blocked auto-continue |
| maestro-verify | *(none)* | No interactive prompts |
| quality-auto-test | `-y` | Skip plan confirmation |
| quality-review | *(none)* | No interactive prompts, auto-detects level |
| quality-test | `-y --auto-fix` | Auto-trigger gap-fix loop on failures |
| quality-debug | *(none)* | No interactive prompts |
| quality-retrospective | `-y` | Accept all routing recommendations without prompting |
| maestro-milestone-audit | *(none)* | No interactive prompts |
| maestro-milestone-complete | `-y` | Skip knowledge promotion inquiry |
| manage-learn | *(none)* | No interactive prompts |

Commands not listed (manage-*, spec-*, milestone-*) have no auto flags and execute as-is.

In auto mode, maestro also:
- Skips intent clarification (workflow Step 2d)
- Skips chain confirmation (workflow Step 3d)
- Auto-skips on step errors (retry once, then skip and continue)

**Super mode (`--super`):** Read `maestro-super.md` from deferred_reading, then follow it completely.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Prompt for intent or suggest maestro-init |
| E002 | error | Clarity too low after 2 clarification rounds | Show parsed intent, ask user to rephrase |
| E003 | error | Chain step failed + user chose abort | Record partial progress, suggest resume with -c |
| E004 | error | Resume session not found | Show available sessions |
| W001 | warning | Intent ambiguous, multiple chains possible | Present options, let user choose |
| W002 | warning | Chain step completed with warnings | Log and continue |
| W003 | warning | State suggests different chain than intent | Show discrepancy, let user decide |
</error_codes>

<success_criteria>
- [ ] Intent classified with task_type, complexity, clarity_score
- [ ] Project state read and incorporated into routing
- [ ] Command chain selected and confirmed (or auto-confirmed with -y)
- [ ] Per-step type selected (auto routes heavy steps to "cli", observable steps to "skill")
- [ ] Auto flags correctly propagated to supporting commands only
- [ ] Session directory created at .workflow/.maestro/{session_id}/
- [ ] status.json created with unified schema (source: "maestro", steps[] with type field)
- [ ] Low-complexity intents routed to maestro-quick
- [ ] All chains dispatched via unified executor (maestro-ralph-execute) with status.json tracking
- [ ] Phase numbers auto-detected and passed to downstream commands
- [ ] (super mode) Requirements expanded and validated via Gemini before roadmap creation
- [ ] (super mode) Each milestone scored ≥ 80% before advancing
- [ ] (super mode) All milestones completed with no user intervention
- [ ] (super mode) Final system builds, starts, and passes all tests
</success_criteria>
