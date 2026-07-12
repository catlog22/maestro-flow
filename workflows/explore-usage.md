<!-- session-mode: none -->
# Explore Usage

```bash
maestro explore "FIND: <target + condition>\nSCOPE: <paths>" [more prompts...] [options]
```

Lightweight read-only codebase search. 1 prompt = 1 agent.
**Not for**: write-mode, long sessions, follow-ups — use `delegate`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated | First available |
| `--all` | Fan out each prompt to all endpoints | — |
| `--max-turns <n>` | Max agent turns per job | Config or `6` |
| `-f, --file <path>` | Load prompts from JSON or text file | — |
| `--cd <dir>` | Working directory | Current |
| `--json` | Output results as JSON | — |

Endpoint resolution: `--endpoint` > `--all` > first available.

## Prompt Rules

**FIND + SCOPE is minimum standard.** Bare FIND produces unfocused results.

| Field | Required | Purpose |
|-------|----------|---------|
| `FIND` | **Yes** | Precise target — what exactly + condition |
| `SCOPE` | **Yes** | File patterns or directories to search |
| `EXCLUDE` | No | What to skip |
| `ATTENTION` | No | Edge cases to watch |
| `EXPECTED` | Recommended | Output format (`file:line` list, summary, JSON) |

### Bad vs Good

```
# ❌ Vague — no actionable target
FIND: database patterns
FIND: error handling

# ✅ Specific target + condition + scope
FIND: Functions that execute SQL queries without parameterized inputs
SCOPE: src/db/**/*.ts, src/api/**/*.ts

FIND: catch blocks that swallow errors silently (empty catch or catch-and-log-only)
SCOPE: src/services/
EXPECTED: file:line list with severity
```

### Multi-Prompt

**Decompose by angle, not by keyword.** Each prompt gets one focused question + scope.

```
# ❌ Keyword dump in one prompt
"database error handling auth patterns"

# ✅ One angle per prompt
maestro explore \
  "FIND: N+1 query patterns\nSCOPE: src/db/" \
  "FIND: Unparameterized SQL\nSCOPE: src/db/, src/api/" \
  "FIND: Missing error propagation\nSCOPE: src/services/"
```

Input formats: inline strings, JSON file (`-f`), text file (`-f`), or mixed.
JSON supports per-prompt endpoint override:

```json
[{ "prompt": "FIND: auth bypass\nSCOPE: src/api/", "endpoint": "deepseek" }]
```

## Session

```bash
maestro explore show                  # list sessions
maestro explore output <id>           # view results
maestro explore output <id> --json    # JSON output
```

## Execution Rules

Multi-prompt — **background**:

```
Bash({ command: "maestro explore \"p1\" \"p2\" --json", run_in_background: true })
```

Single quick lookup — foreground:

```
Bash({ command: "maestro explore \"Where is X defined?\"" })
```
