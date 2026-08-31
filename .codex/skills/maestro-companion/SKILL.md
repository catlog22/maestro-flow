---
name: maestro-companion
disable-model-invocation: false
description: Quick execution for small tasks — minimal run lifecycle (start +
  done) with evidence recording. Full LLM capability, scoped to mechanically
  clear tasks.
argument-hint: <intent> [-y]
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
version: 0.5.83
---

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

If any required file above was not expanded into context by the host, or its content is no longer in context, Read it explicitly before executing any step.

<purpose>
Minimal-run execution channel. Full LLM capability with one bounded Run and evidence appended to `{run_dir}/evidence/companion-log.md`.

Use when:
- Intent is mechanically clear (no design decisions needed; file count irrelevant)
- No typed artifact consumed by downstream steps
- No gate/verdict needed for lifecycle tracking

Lightweight self-check (all must hold):
- Intent specifies a concrete, bounded action with named target (file, function, error message)
- No typed artifact consumed by downstream steps
- No gate/verdict for lifecycle tracking
- Single concern, no multi-phase span
If self-check fails mid-execution, stop and suggest `/maestro-next` for re-routing.
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

| Flag | Effect |
|------|--------|
| `-y` | Skip confirmation, execute directly |

Mode detection: intent → execute | empty → request_user_input: request intent text; if still empty → display usage hint and exit

Knowledge utilities (note/log/promote) are available via `/maestro-knowledge`.
</context>

<invariants>
1. Execute mode follows the exact Session identity -> bounded Run lifecycle in `run-mode.md`.
2. Evidence is append-only, non-formal (never enters gates or artifact registry)
3. No automatic multi-step orchestration — the command owns exactly one explicit single-step Session chain
</invariants>

<flow>

## Execute (default)

Linear: resolve Session identity -> dispatch Run -> explore -> confirm -> do -> check -> complete Run -> complete Session when the chain is terminal.

### 1. Create

Follow the self-start flow in `run-mode.md`. Negotiate capabilities, then execute the three receipt-chained mutations below. `{open_request_id}`, `{insert_request_id}`, and `{next_request_id}` are distinct stable IDs; use the exact `session_id` and `orchestration_revision` returned by each preceding receipt. Participant and actor are the same authorized identity.

```bash
maestro session open "<intent>" --id <slug> --participant {actor_id} --actor {actor_id} --request-id {open_request_id} --reason "open self-started Companion Session" --json
maestro session chain insert --session {session_id} --step-id {step_id} --command companion --arg "<intent>" --participant {actor_id} --actor {actor_id} --request-id {insert_request_id} --reason "add Companion task" --expected-orchestration-revision {open_orchestration_revision} --json
maestro run next --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {next_request_id} --reason "dispatch Companion task" --expected-orchestration-revision {insert_orchestration_revision} --json
```

The Session objective is metadata; `session chain insert --arg "<intent>"` supplies Companion's positional domain text. Never pass task prose through `--input`; that option accepts only sealed same-Session Artifact IDs. Consume the `run next` birth packet's `task` and structured `continuation`, and retain its exact Run locator and revisions.

Init `{run_dir}/evidence/companion-log.md`:
```markdown
# Companion Log: {intent}
> run_id: {run_id} | session: {session_id}

## Evidence
```

### 2. Explore

Locate targets and gather evidence before touching anything. Methods (pick what fits):

- `maestro explore "FIND: ...\nSCOPE: ..."` — codebase search
- `maestro search "<keywords>" --type spec --type knowhow` — knowledge recall
- spawn_agent(subagent) — multi-file analysis, cross-reference, pattern discovery
- Direct Read/Grep/Glob — known targets, quick lookups

Record findings under `## Evidence`:
```markdown
## Evidence
- {file:line — what was found}
- {spec/knowhow entries loaded, or "none"}
- {subagent conclusions if used}
```

### 3. Confirm

Before executing, verify evidence is sufficient:
- Target files/locations identified?
- Change scope clear (what to modify, what to leave alone)?
- No ambiguity requiring design decisions?

If insufficient → continue exploring or ask user. If `-y` → skip user confirmation interaction, but still perform evidence sufficiency self-check. If critical targets are unlocated, continue exploring (without asking user); only the 'ask user' branch is skipped.

### 4. Do

Execute the task. After each meaningful action, append under `## Work Log`:

```markdown
### {HH:MM} — {summary}
{outcome, files touched if any}
```

Rules: batch trivial reads; 1-5 lines per entry; focus on outcome not process.

### 5. Seal

Append outcome:
```markdown
## Outcome
**Status:** done | partial
**Summary:** {1-2 sentences}
**Files:** {modified/created, or "none"}
```

Before completion, put accepted decisions/locked constraints in `report.md`. If a reusable recipe or pitfall emerged, stage it now:

```bash
maestro knowledge stage knowhow "<title>" --content-file <path|-> --run <run_id>
# Then use the complete fenced `maestro run complete ... --advance` and, when the
# chain is terminal, `maestro session complete` from run-mode.md with the current
# locator, orchestration_revision, and identity.
```

Display: `Companion done. Run: {run_id} | Evidence: {path}`

If the completion receipt contains candidate IDs, display its `review_command`. Do not persist the same insight again through `/maestro-spec` or `/maestro-knowhow`.

If execution revealed the task requires multi-phase audit/diagnosis (e.g., root cause unknown, >3 files need coordinated changes), suggest: `/maestro-odyssey "<scope>" --mode debug|improve` for re-planning.

</flow>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `session open` failed (CLI unavailable, invalid args) | Check maestro CLI installation |
| E003 | error | Evidence log creation failed | Check run_dir permissions |
| W001 | warning | Explore tools unavailable (maestro explore/search) | Degrade to direct Read/Grep |
</error_codes>
