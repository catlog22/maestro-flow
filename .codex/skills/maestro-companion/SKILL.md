---
name: maestro-companion
disable-model-invocation: false
description: Quick execution for small tasks (≤1-2 files, no artifact handoff) —
  minimal run lifecycle (create + complete only) with evidence recording. Can
  read/write/run any tool, but scoped to tasks completable in a few actions. Not
  for multi-step workflows or tasks needing downstream gates
argument-hint: <intent> [--note <text>] [--promote] [-y]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.53
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Minimal-run execution channel. Full LLM capability (read/write files, run commands, search code, edit code) with minimal protocol overhead: one `run create` + one `run complete`, continuous recording to `{run_dir}/evidence/companion-log.md`.

Use when:
- Intent is mechanically clear — user knows exactly what to change, no design decisions or multi-angle analysis needed (file count is irrelevant; a 20-file rename is still lightweight)
- No typed artifact needs to be consumed by a downstream step
- No gate/verdict needs to be recorded for lifecycle tracking
- Task does not require pre-task thinking (prepare) or structured brief to execute correctly

Also provides companion utilities: structured note recording (--note) and insight promotion (--promote).

This command can be invoked directly by the user or routed to from `/maestro-next` when complexity is assessed as lightweight.
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

**Flags:**

| Flag | Effect |
|------|--------|
| `-y` / `--yes` | Skip confirmation, execute directly |
| `--note <text>` | Append a structured note to the active run's evidence log |
| `--promote` | Interactively promote run insights to spec/knowhow |

**Mode detection (priority order):**
1. `--note` → S_NOTE (append note to active companion log)
2. `--promote` → S_PROMOTE (review + promote insights)
3. Intent text present → S_CTX → S_EXEC → S_SEAL
4. No arguments → ask for intent via request_user_input
</context>

<invariants>
1. **Minimal-run lifecycle** — single Run in a chainless Session. Only `run create` + `run complete` lifecycle verbs apply. No prepare/brief/check or artifact gates (consumes/produces/gates all empty); required command arguments are still validated by runtime
2. **--note is append-only** — never overwrite or reorder existing entries
3. **--promote delegates** — spec/knowhow promotion routes through `maestro-spec add` / `maestro-manage knowledge capture`, never writes directly
4. **Evidence is non-formal** — `{run_dir}/evidence/companion-log.md` never enters gates or artifact registry
5. **Full execution capability** — companion can do anything the LLM can do. It is NOT limited to knowledge loading or read-only operations
6. **No auto-orchestration** — companion never creates chains or dispatches sub-orchestrators. It executes directly
</invariants>

<state_machine>

<states>
S_PARSE   — Parse arguments, extract flags, detect mode
S_NOTE    — Append structured note to active companion doc
S_PROMOTE — Review companion/run outputs, promote insights to spec/knowhow
S_CTX     — Create minimal run, load context, open evidence log
S_EXEC    — Execute the task directly; record each meaningful step
S_SEAL    — `run complete`, summarize outcome, offer optional promote
</states>

<transitions>

S_PARSE:
  → S_NOTE     WHEN: --note flag
  → S_PROMOTE  WHEN: --promote flag
  → S_CTX      WHEN: intent present OR -y
  → S_PARSE    WHEN: no intent (1 clarify round via request_user_input)

S_NOTE:
  → END        DO: A_NOTE

S_PROMOTE:
  → END        DO: A_PROMOTE

S_CTX:
  → S_EXEC     DO: A_CTX

S_EXEC:
  → S_EXEC     WHEN: task has more actions remaining    DO: execute next action + A_RECORD
  → S_SEAL     WHEN: task complete                      DO: A_RECORD (final entry)

S_SEAL:
  → END        DO: A_SEAL

</transitions>

<actions>

### A_CTX

Entry point. Minimal-run: create + complete only, skip prepare/brief/check.

1. **Create minimal run** (chainless single-step session):
   ```bash
   maestro run create companion --session YYYYMMDD-companion-<topic> --intent "<intent>" --arg "<intent>" --workflow-root .
   ```
   `--intent` preserves the goal as Session metadata; `--arg "<intent>"` supplies Companion's required `<intent>` command argument. Returns: `run_id`, `run_dir`. No chain or artifact gates; required command arguments remain runtime-validated.

2. **Load context** (best-effort, non-blocking):
   ```bash
   maestro search "<intent keywords>" --type spec --type knowhow
   ```
   Load top 2-3 relevant entries. If nothing found, proceed without context.

3. **Initialize evidence log** at `{run_dir}/evidence/companion-log.md`:
   ```markdown
   # Companion Log: {intent summary}
   > run_id: {run_id} | session: {session_id}

   ## Context
   - {spec/knowhow entries loaded, or "none"}

   ## Work Log
   ```

4. Proceed to S_EXEC.

### A_RECORD

Append a timestamped entry to `{run_dir}/evidence/companion-log.md` under `## Work Log`. Called after each meaningful action during S_EXEC.

**Entry format:**
```markdown
### {HH:MM} — {action summary}
{what was done, what was found, what changed}
{files touched: path1, path2 (if any)}
```

**Recording rules:**
- One entry per meaningful action (file edit, command run, discovery, decision)
- Trivial reads (single file lookup) can be batched into one entry
- Never overwrite or reorder existing entries (invariant 2)
- Keep entries concise: 1-5 lines each, focus on outcome not process
- Evidence dir is non-formal: never enters gates or artifact registry

### A_SEAL

Wrap up the companion run:

1. **Append outcome** to `{run_dir}/evidence/companion-log.md`:
   ```markdown
   ## Outcome
   **Status:** done | partial
   **Summary:** {1-2 sentence result}
   **Artifacts:** {files created/modified, or "none"}
   **Follow-up:** {suggested next step if any, or "none"}
   ```

2. **Complete the run**:
   ```bash
   maestro run complete <run_id> --verdict done --workflow-root .
   ```

3. **Optional promote offer** — if the work produced reusable insights (patterns, decisions, pitfalls):
   - Suggest: `/maestro-spec add <category> "title" "content"` or `/manage-knowhow-capture`
   - Only suggest, never auto-execute (invariant 3)

4. Display completion summary to user:
   ```
   Companion done. Run: {run_id} | Evidence: {run_dir}/evidence/companion-log.md
   Outcome: {summary}
   {promote suggestion if applicable}
   ```

### A_NOTE

Append a structured note to the active run's evidence log.

1. Locate active companion run:
   ```bash
   maestro run recall companion --json
   ```
   If no active run, create one via A_CTX (intent = "note recording").

2. Append to `{run_dir}/evidence/companion-log.md`:
   ```markdown
   ### {HH:MM} — Note
   {note text from --note argument}
   ```

3. Confirm: `Note recorded → {run_dir}/evidence/companion-log.md`

### A_PROMOTE

Review companion/run outputs and promote insights to spec/knowhow.

1. Read the latest companion log(s) from recent runs:
   ```bash
   maestro run recall companion --json
   ```
   Read `{run_dir}/evidence/companion-log.md` for the most recent completed run.

2. Identify promotable insights:
   - Patterns discovered during execution
   - Architectural decisions made
   - Pitfalls encountered and workarounds found
   - Reusable solutions

3. For each insight, present to user via request_user_input:
   - **Promote to spec** → suggest `/maestro-spec add <category> "title" "content" --keywords ...`
   - **Promote to knowhow** → suggest `/manage-knowhow-capture`
   - **Skip** → no action

4. Never write directly — always delegate to the appropriate command (invariant 3).

</actions>

</state_machine>

<routing_guidance>

### When /maestro-next routes here

`/maestro-next` assesses complexity at its S_RANK state. When all lightweight signals hold, it routes to this command:

**Lightweight signals (all must hold):**
- Intent is mechanically clear — user knows exactly what to change, no design decisions needed (file count irrelevant)
- No typed artifact needs to be consumed by a downstream step
- No gate/verdict needs to be recorded for lifecycle tracking
- Task does not require pre-task thinking (prepare) or structured brief to execute correctly

**Routing preference:** prefer the lightest channel that satisfies the task. When in doubt, ask the user rather than auto-upgrading to Standard.

### Invocation forms

```bash
# Direct invocation
/maestro-companion "fix the typo in README line 42"
/maestro-companion "what does the parseConfig function do?"

# Routed from maestro-next (lightweight verdict)
/maestro-next "quick lookup: where is the auth middleware?"
  → maestro-next displays: "Channel: companion → /maestro-companion \"where is the auth middleware?\""

# Note recording
/maestro-companion --note "discovered that config.yaml overrides env vars"

# Promote insights
/maestro-companion --promote
```

</routing_guidance>

<error_codes>

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent empty after clarification | Provide intent |
| E002 | error | `run create companion` fails | Check maestro CLI installation |
| E003 | error | No active run found for --note | Auto-creates a new companion run |
| W001 | warning | Task exceeds lightweight scope mid-execution | Complete current task, suggest /maestro-next for follow-up |

</error_codes>
