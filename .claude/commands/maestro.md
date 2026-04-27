---
name: maestro
description: Intelligent coordinator - analyze intent + read project state → select optimal command chain → execute via Skill() or CLI delegate
argument-hint: "\"intent text\" [-y] [-c] [--dry-run] [--chain <name>] [--exec auto|cli|skill] [--tool <name>]"
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
Orchestrate all maestro commands automatically based on user intent and current project state.
Two routing modes:
1. **Intent-based**: User describes a goal → classify task type → select/compose command chain → confirm → execute
2. **State-based**: Read .workflow/state.json → determine next logical step → suggest/execute (triggered by `continue`/`next`)

Per-step execution engine (default: auto):
- **Skill()**: Observable steps — output visible in conversation, synchronous, user can intervene
- **CLI delegate**: Heavy execution steps — context isolation, template-driven prompts, gemini quality analysis

Produces session directory at `.workflow/.maestro/{session_id}/` with status.json tracking chain progress.
Executes commands sequentially via Skill() with artifact propagation between steps.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro.md
</required_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Special keywords:**
- `continue` / `next` / `go` — State-based routing: read state.json, determine next step, execute
- `status` — Shortcut to Skill({ skill: "manage-status" })

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors. Propagates to downstream commands that support it.
- `-c` / `--continue` — Resume previous coordinator session from `.workflow/.maestro/*/status.json`
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force a specific chain (bypass intent detection). Valid: full-lifecycle, spec-driven, brainstorm-driven, execute-verify, quality-loop, milestone-close, quick, review
- `--exec <mode>` — Execution engine: `auto` (default), `cli`, `skill`. Auto selects per step based on command complexity.
- `--tool <name>` — CLI tool for delegate execution (default: claude). Only used when engine=cli.

**State files read:**
- `.workflow/state.json` — project state machine + artifact registry
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/scratch/*/plan.json` — plan metadata (via artifact registry paths)
</context>

<execution>
Follow '~/.maestro/workflows/maestro.md' completely.

**Auto mode (`-y`) propagation:**

When `-y` is active, maestro propagates auto flags to downstream commands. Only commands that explicitly support auto mode receive the flag — others execute normally (no forced flags).

| Command | Auto Flag | Effect |
|---------|-----------|--------|
| maestro-analyze | `-y` | Skip interactive scoping, auto-deepen |
| maestro-brainstorm | `-y` | Skip interactive questions, use defaults |
| maestro-roadmap | `-y` | Skip interactive questions, use defaults (create/revise/review) |
| maestro-ui-design | `-y` | Skip interactive selection, pick top variant |
| maestro-plan | `--auto` | Skip interactive clarification |
| maestro-spec-generate | `-y` | Skip interactive questions, use defaults |
| maestro-execute | *(none)* | No auto flag — executes all tasks normally |
| maestro-verify | *(none)* | No auto flag — runs full verification |
| quality-review | *(none)* | No auto flag — auto-detects level, runs fully |
| quality-test | `--auto-fix` | Auto-trigger gap-fix loop on failures |
| quality-test-gen | *(none)* | No auto flag — generates tests normally |
| quality-debug | *(none)* | No auto flag — runs diagnosis normally |
| quality-retrospective | `--auto-yes` | Accept all routing recommendations (spec/note/issue) without prompting |
| maestro-milestone-audit | *(none)* | No auto flag — validates milestone readiness |
| manage-learn | *(none)* | No auto flag — pure file operation, no prompts |

Commands not listed (manage-*, spec-*, milestone-*) have no auto flags and execute as-is.

In auto mode, maestro also:
- Skips its own clarification (Step 4)
- Skips chain confirmation (Step 5d)
- Auto-skips on step errors (retry once, then skip and continue)

Context cleanup hints, context window reminders, and completion report format are defined in workflow maestro.md (Steps 7a-1, 7f).
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
| E005 | error | Invalid chain name provided with --chain | Show valid chain names and exit |
| W003 | warning | State suggests different chain than intent | Show discrepancy, let user decide |
</error_codes>

<success_criteria>
- [ ] Intent classified with task_type, complexity, clarity_score
- [ ] Project state read and incorporated into routing
- [ ] Command chain selected and confirmed (or auto-confirmed with -y)
- [ ] Per-step engine selected (auto routes heavy steps to CLI, observable steps to Skill)
- [ ] Auto flags correctly propagated to supporting commands only
- [ ] Session directory created at .workflow/.maestro/{session_id}/
- [ ] status.json tracks per-step progress and execution engine
- [ ] All chain steps executed via Skill() or CLI delegate with proper argument propagation
- [ ] Phase numbers auto-detected and passed to downstream commands
- [ ] Error handling: retry/skip/abort per step (auto-skip in -y mode)
- [ ] Session summary displayed on completion
</success_criteria>
