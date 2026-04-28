# Workflow: maestro-link-coordinate

Chain-graph coordinator via `maestro coordinate` CLI endpoint. Loads a chain graph, walks node by node via step-mode subcommands. Each command node executed through `maestro delegate` internally.

---

### Step 1: Parse Arguments

Extract from `$ARGUMENTS`:
- Flags: `--list`, `-y`/`--yes`, `-c`/`--continue [id]`, `--chain <name>`, `--tool <name>` (default: claude)
- `intent` = remaining text after flag removal

---

### Step 2: Handle --list

```bash
maestro coordinate list
```

Exit after display.

---

### Step 3: Start or Resume Session

#### 3a: New session (step mode)

```bash
maestro coordinate start "{intent}" --tool {cliTool} [--chain {forcedChain}] [-y]
```

Include `--chain` and `-y` only when set. Returns JSON with `session_id`, `status`, `graph_id`, `current_node`, `last_step`, `history`.

#### 3b: Resume existing session

```bash
maestro coordinate next {resumeId}
```

If bare `-c` (no ID), omit session ID to resume latest step_paused session. Same JSON output format.

---

### Step 4: Step Loop

Loop `maestro coordinate next {session_id}` while `status === "step_paused"`. Log each step: `[Step N] /{cmd} — {outcome} — {summary}`. Exit loop on `completed` or `failed` → **Step 5**.

The walker handles internally:
- Prompt assembly (command nodes via `coordinate-step` template, decision nodes inline)
- CLI execution via `maestro delegate --to {tool} --mode {write|analysis}`
- Decision auto-resolution: `expr` (static, instant) or `llm` (CLI spawn, expects `DECISION: <target>\nREASONING: <text>`). Expr fallback to LLM when no matching/default edge.
- max_visits loop prevention, state persistence to `.workflow/.maestro/coordinate-{session_id}/`
- Channel telemetry published to `~/.maestro/data/async/` broker, observable via `maestro coordinate watch`

> **Step-mode latency note**: LLM-driven decisions fire synchronous CLI spawns (several seconds). Do not impose tight per-step deadlines. Static `expr` decisions remain instant.

---

### Step 5: Completion

```bash
maestro coordinate status {session_id}
```

Display final summary:

```
============================================================
  COORDINATE COMPLETE
============================================================
  Session: {session_id}
  Graph:   {graph_id}
  Status:  {completed|failed}

  Steps:
    [✓] plan — success — Plan generated
    [✓] execute — success — Implementation done
    [✗] verify — failure — 2 issues found
    [→] check_result → retry_plan (decision)
    [✓] retry_plan — success — Gaps fixed
    [✓] retry_execute — success — All passing

  Completed: {N} | Failed: {N}
============================================================
```

---

## CLI Endpoint Reference

| Command | Description | Output |
|---------|-------------|--------|
| `maestro coordinate list` | List all chain graphs | Table to stdout |
| `maestro coordinate start "intent" --chain X --tool Y` | Start step-mode session | JSON (session_id, status, last_step) |
| `maestro coordinate next [sessionId]` | Execute next step | JSON (updated state) |
| `maestro coordinate status [sessionId]` | Query session state | JSON (full state) |
| `maestro coordinate run "intent" --chain X --tool Y` | Autonomous full run | JSON (final state) |
| `maestro coordinate watch <sessionId> [--follow] [--since N] [--format json\|text]` | Stream walker events from broker (observer, read-only) | JSONL/text to stdout |
| `maestro coordinate report --session <sid> --node <id> --status SUCCESS\|FAILURE [...]` | Agent-invoked result writer — the authoritative command-node result channel | Writes `.workflow/.maestro/coordinate-{sid}/reports/{node}.json`, exits 0 |

---

## Core Rules

1. **All execution via CLI endpoint** — `maestro coordinate start/next/run`, never direct walker calls
2. **Step mode by default** — `start` pauses after each command node, `next` advances one step
3. **JSON protocol** — all subcommands output structured JSON to stdout, logs to stderr
4. **Session persistence** — state at `.workflow/.maestro/coordinate-{session_id}/walker-state.json`
5. **Decision auto-resolve** — walker evaluates `ctx.result.status` internally between steps; falls back to the injected LLM decider when `expr` has no matching edge and no default
6. **Resume** — `next {sessionId}` continues any step_paused session
7. **Autonomous fallback** — `run` walks entire graph without pausing (backward compat)
8. **Observation is separate from driving** — `watch` is a read-only tail on the broker; it does not advance the walker. Use it alongside `next` or `run` for live progress without disturbing the driver loop.
9. **Result channel** — command-node results are written by the agent via `maestro coordinate report` to a JSON file the walker reads preferentially over stdout parsing.
