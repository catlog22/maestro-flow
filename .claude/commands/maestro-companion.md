---
name: maestro-companion
disable-model-invocation: false
description: "Quick execution for small tasks — minimal run lifecycle (create + complete) with evidence recording. Full LLM capability, scoped to mechanically clear tasks."
argument-hint: "<intent> [--note <text>] [--log <run_id>] [--promote] [-y]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Minimal-run execution channel. Full LLM capability with minimal protocol: one `run create` + one `run complete`, evidence appended to `{run_dir}/evidence/companion-log.md`.

Use when:
- Intent is mechanically clear (no design decisions needed; file count irrelevant)
- No typed artifact consumed by downstream steps
- No gate/verdict needed for lifecycle tracking
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

| Flag | Effect |
|------|--------|
| `-y` | Skip confirmation, execute directly |
| `--note <text>` | Append note to active run's evidence log |
| `--log <run_id>` | View evidence log for a specific run |
| `--promote` | Promote run insights to spec/knowhow |

Mode detection: `--note` → note | `--log` → log | `--promote` → promote | intent → execute | empty → ask
</context>

<invariants>
1. Only `run create` + `run complete` — no prepare/brief/check/gates
2. Evidence is append-only, non-formal (never enters gates or artifact registry)
3. `--promote` delegates to `maestro-spec add` / knowhow capture, never writes directly
4. No auto-orchestration — executes directly, never creates chains
</invariants>

<flow>

## Execute (default)

Linear: create → explore → confirm → do → seal.

### 1. Create

```bash
maestro run create companion --session YYYYMMDD-companion-<topic> --intent "<intent>" --arg "<intent>" --workflow-root .
```

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
- Agent (subagent) — multi-file analysis, cross-reference, pattern discovery
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

If insufficient → continue exploring or ask user. If `-y` → skip confirmation, proceed directly.

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

```bash
maestro run complete <run_id> --verdict done --workflow-root .
```

Display: `Companion done. Run: {run_id} | Evidence: {path}`

If reusable insights emerged, suggest (never auto-execute):
`/maestro-spec add ...` or `/manage-knowhow-capture`

</flow>

<utilities>

## --note

1. `maestro run recall companion --json` → get active run_dir (if none, create with intent="note recording")
2. Append `### {HH:MM} — Note\n{text}` to evidence log
3. Confirm path

## --log <run_id>

Required: run_id. Read `{run_dir}/evidence/companion-log.md` for that run and display.
If run_id not found, error: "Run not found. Use `maestro run list --command companion` to find ids."

## --promote

1. `maestro run recall companion --json` → read latest evidence log
2. Identify promotable insights (patterns, decisions, pitfalls)
3. For each, ask user: promote to spec / knowhow / skip
4. Delegate to appropriate command, never write directly

</utilities>
