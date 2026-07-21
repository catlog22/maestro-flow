<!-- session-mode: none -->
# Maestro

<!-- session-mode: none -->
# Coding Philosophy

## Core Beliefs

- **Pursue good taste** - Eliminate edge cases to make code logic natural and elegant
- **Embrace extreme simplicity** - Complexity is the root of all evil
- **Be pragmatic** - Code must solve real-world problems, not hypothetical ones
- **Data structures first** - Bad programmers worry about code; good programmers worry about data structures
- **Never break backward compatibility** - Existing functionality is sacred and inviolable
- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Clear intent over clever code** - Be boring and obvious
- **Follow existing code style** - Match import patterns, naming conventions, and formatting of existing codebase
- **Minimize changes** - Only modify what's directly required; avoid refactoring, adding features, or "improving" code beyond the request
- **No unsolicited documentation** - NEVER generate reports, documentation files, or summaries without explicit user request. When the active command requires a report, write it only to the current Run's `report.md` or declared typed output.

## Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Fix, Don't Hide

**Solve problems, don't silence symptoms** - Skipped tests, `@ts-ignore`, empty catch, `as any`, excessive timeouts = hiding bugs, not fixing them

**NEVER**:
- Make assumptions - verify with existing code
- Generate reports, summaries, or documentation files without explicit user request
- Use suppression mechanisms (`skip`, `ignore`, `disable`) without fixing root cause

**ALWAYS**:
- Plan complex tasks thoroughly before implementation
- Generate task decomposition for multi-module work (>3 modules or >5 subtasks)
- Track progress using TODO checklists for complex tasks
- Validate planning documents before starting development
- Commit working code incrementally
- Update plan documentation and progress tracking as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- **Edit fallback**: When Edit tool fails 2+ times on same file, try Bash sed/awk first, then Write to recreate if still failing

## Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use same libraries/utilities when possible
- Follow existing test patterns

## Tooling

- Use project's existing build system
- Use project's test framework
- Use project's formatter/linter settings
- Don't introduce new tools without strong justification

## Content Uniqueness Rules

- **Each layer owns its abstraction level** - no content sharing between layers
- **Reference, don't duplicate** - point to other layers, never copy content
- **Maintain perspective** - each layer sees the system at its appropriate scale
- **Avoid implementation creep** - higher layers stay architectural

# Context Requirements

Before implementation, always:
- Identify 3+ existing similar patterns
- Map dependencies and integration points
- Understand testing framework and coding conventions


## Delegate & CLI

- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

`maestro delegate "<PROMPT>" --to <tool> --mode analysis|write` — dispatch tasks to external CLI tools (gemini, codex, claude, opencode).
Always `run_in_background: true`. Full guide: `cat ~/.maestro/workflows/delegate-usage.md`

**Strictly follow the cli-tools.json configuration**

## Explore

Route code search by the Query Rules table (Knowledge System below) — it is the single source for tool selection. `maestro explore` is the default for usage sweeps and pattern scans: prefer it over Glob and broad Grep/Read, call it and stop to wait for results.

```bash
maestro explore "FIND: <target + condition>\nSCOPE: <paths>" [more prompts...] [options]
```

Lightweight read-only codebase search. 1 prompt = 1 agent. Not for write-mode/long sessions — use `delegate`.

| Option | Description |
|--------|-------------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated |
| `--all` | Fan out each prompt to all endpoints |
| `--json` | Output results as JSON |

Long-tail options (`--max-turns`, `-f`, `--cd`) — see `maestro explore --help`.

### Context Injection

Explore agents have no project awareness — inject context before calling:

| Injection | Field | Content |
|-----------|-------|---------|
| Structure | SCOPE | Concrete paths of relevant directories (no wildcard sweeps) |
| Domain | SCOPE | Key file paths already returned by `maestro search` |
| Constraints | ATTENTION | Framework, language, naming conventions |

```
FIND: authentication middleware that validates JWT tokens
SCOPE: src/middleware/, src/auth/, src/api/routes/
ATTENTION: Express.js, middleware files named *.middleware.ts
```

### Prompt Structure

**FIND + SCOPE is the minimum bar.** One declarative sentence per field; no nested conditions.

| Field | Required | Rule |
|-------|----------|------|
| `FIND` | **Yes** | Decidable concrete target (what + acceptance condition) |
| `SCOPE` | **Yes** | Explicit paths or globs; `**/*` sweeps forbidden |
| `EXCLUDE` | No | File types or directories to skip |
| `ATTENTION` | No | Framework, naming conventions, known pitfalls |
| `EXPECTED` | Recommended | Output format: `file:line` list / summary / JSON |

```
FIND: Functions that call db.query() with string concatenation instead of $1/$2
SCOPE: src/db/**/*.ts, src/api/**/*.ts
EXCLUDE: **/*.test.ts
EXPECTED: file:line list with the SQL string
```

### Cross-Search

For important searches, run 2-3 prompts from different angles concurrently; the main agent cross-validates results.

**Split by angle, not by keyword:**

| Angle | Prompt A | Prompt B |
|-------|----------|----------|
| Definition vs call sites | Find function definitions | Find call sites |
| Positive vs negative | Find correct usage | Find missed usage |
| Entry vs implementation | Find exports/routes | Find internal logic |
| By file type | Usage in .ts | Usage in .vue |

**Result confidence:**
- Both hit → high confidence, use directly
- Single hit → verify with Grep/Read
- Zero hits → retry from a different angle or target doesn't exist

### Execution

Multi-prompt — background; single lookup — foreground:

```
Bash({ command: "maestro explore \"p1\" \"p2\" --json", run_in_background: true })
Bash({ command: "maestro explore \"FIND: ...\nSCOPE: ...\"" })
```

Session: `maestro explore show` / `maestro explore output <id>`

## Agent Invocation & Timeouts

V2 agents are **asynchronous by default**: after `spawn_agent` / `followup_task`, you must block with `wait_agent` to retrieve results — otherwise the sub-agent becomes orphaned and its final answer is lost. Standard call sequence:

```ts
spawn_agent({ task_name: "<slug>", message: "<full task prompt>", fork_turns: "none" })
wait_agent({ timeout_ms: 3600000 })   // timed_out and not finished → wait_agent again
```

- **Default: always block-wait with the maximum timeout unless the task is explicitly short.** Whenever duration is unpredictable (analysis, review, implementation, exploration, multi-turn sub-agents — i.e. most scenarios), immediately call `wait_agent({ timeout_ms: 3600000 })` (1-hour cap) after `spawn_agent`. Never guess short durations or rely on the 30000 default — this avoids `timed_out` returning early while the agent is still running.
- **Keep waiting, never abandon**: `timed_out: true` and agent status is not `completed`/`errored` → call `wait_agent({ timeout_ms: 3600000 })` again; use `list_agents` to confirm status if needed.
- **Exception: explicitly short tasks only** (duration is certain and brief, e.g. single status query/echo) may use a shorter `timeout_ms` (minimum `10000`). This is not the default path.
- The `message` returned by `wait_agent` is only a mailbox update summary — the final answer is delivered as a `FINAL_ANSWER` message; do not treat the summary as the result body.
- `spawn_agents_on_csv`: `max_runtime_seconds` (max runtime per worker, in seconds) **must be explicitly set to the cap `3600`**.

## Plan Tracking

- Track task/step progress with `update_plan({ explanation?, plan: [{ step, status }] })`: submit the full step array each time; status: `pending` | `in_progress` | `completed`. The authoritative state lives in session artifacts.

## Goal Tools (unrelated to task tracking)

- Signatures: `create_goal({ objective, token_budget? })`, `update_goal({ status: "complete" | "blocked" })`, `get_goal({})`.
- **Only use when the user explicitly requests creating a Goal**: single active goal; never infer creation from ordinary tasks; report final token usage to the user upon completion.

## Knowledge System

**Gate rule**: Before editing code or making design decisions, run `maestro search` to retrieve historical knowledge (spec rules, knowhow lessons, design decisions) — avoid repeating known pitfalls or violating established conventions. This is knowledge reuse, not code search — code navigation (Grep/Read/explore) can proceed in parallel without waiting for knowledge results. Empty results ≠ exempt: if a hint is returned, execute it and retry; once confirmed no prior knowledge exists, proceed normally and record findings at task end per Record.

**Re-search triggers** (re-query mid-task with new keywords, never repeat old queries): entering a new module/subsystem boundary; same fix failed twice; before architecture/approach decisions.

```bash
maestro search "<query>" [--type <type>] [--category <cat>] [--tag <tag>] [--keyword <word>] [--code] [--kg]
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--tag <tag>] [--id <id>]
```

**--type**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`
**--category** (spec only): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`
**--tag**: Filter by exact tag match (e.g. `diagnosis`, `review-findings`, `lessons`), wiki only
**--keyword**: Filter by keyword in title/body (substring match), wiki only

### Query Rules

1-3 core keywords per query — multiple short queries beat one long one.
Separate concepts from symbols. Add `--kg` for full-source.

| Target | Tool |
|--------|------|
| Known symbol → definition/signature | `maestro search "<Symbol>" --code` (file:line, no agent cost) |
| Concept / knowledge / conventions | `maestro search "<keywords>"` |
| Debug symptoms / review lessons (sealed artifacts) | `maestro search "<keywords>" --tag diagnosis` / `--tag lessons` |
| Usage sweep / pattern scan | `maestro explore` |
| Exact regex / line content | Grep |

**Association follow-through** — after a hit, walk one hop along relations instead of re-issuing broad queries:

- Hit a chunked entry (id with `-NNN` suffix) → `maestro load --type knowhow --id <parent-entry-id>` for full text
- Trace references (who cites it / what it cites) → `maestro wiki backlinks <id>` / `maestro wiki forward <id>`
- Rule evolution history → `maestro spec history <sid>`

Zero code hits with a hint (e.g. `code index not initialized`) → run the hinted command, then retry — don't abandon code search.

```bash
# ❌ keyword dump
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ targeted
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro load --type spec --category coding
```

### Record

| What | Command |
|------|---------|
| Spec | `/maestro-spec add <category> "title" "content" --keywords kw1,kw2 --description "summary"` |
| Knowhow | `/maestro-manage knowledge capture` (`--spec-category <cat>` for agent injection) |

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.
Entry routing: skill commands run guided workflows; `maestro spec add` CLI writes directly (use `--json` in the supersede flow to obtain the sid).
`session-mode: run` commands receive a finish checklist (handoff, knowledge capture, conflict annotation, verdict) when `maestro run check` is all green — execute every item, no skipping.

### Supersession & Conflict (dual-track)

| Relation | Scenario | Command | Effect |
|----------|----------|---------|--------|
| **supersede** | New rule replaces old rule | `maestro spec supersede <old-sid> --by <new-sid>` | Old entry `deprecated`, evolution chain preserved |
| **conflict** | Both rules are valid | `maestro spec conflict mark <file> <line> --note "<reason>"` | Old entry `contested` (search ×0.5), human adjudicates |

Confidence levels: `high` → `medium` (default) → `low` (`[LOW CONFIDENCE]`) → `contested` (`[CONTESTED]`).
Resolution: `/maestro-manage knowledge audit`

### Health & Maintenance

`maestro spec health` — lifecycle stats + evolution chain integrity. Low-frequency maintenance (`backfill-sid` for sid backfill, `history <sid>` for evolution chains) — see `maestro spec --help`.
