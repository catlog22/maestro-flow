# Workflow: maestro-link-coordinate

Chain-graph coordinator via `maestro coordinate` CLI endpoint. Loads a chain graph, walks node by node via step-mode subcommands. Each command node executed through `maestro delegate` internally.

---

### Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const listMode = /\b--list\b/.test(args);
const autoYes = /\b(-y|--yes)\b/.test(args);
const resumeMode = /\b(-c|--continue)\b/.test(args);
const resumeId = args.match(/(?:-c|--continue)\s+(\S+)/)?.[1] || null;
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'claude';
const intent = args
  .replace(/\b(-y|--yes|--list|-c|--continue)\b/g, '')
  .replace(/(?:-c|--continue)\s+\S+/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

---

### Step 2: Handle --list

```bash
maestro coordinate list
```

Exit after display.

---

### Step 3: Start or Resume Session

#### 3a: New session (step mode)

Build command dynamically — only include flags when values are present:

```bash
maestro coordinate start "{intent}" --tool {cliTool} [--chain {forcedChain}] [-y]
```

- Append `--chain {forcedChain}` only if `forcedChain` is not null
- Append `-y` only if `autoYes` is true

Outputs JSON to stdout:

```json
{
  "session_id": "coord-1711612800-a1b2",
  "status": "step_paused",
  "graph_id": "full-lifecycle",
  "current_node": "plan",
  "steps_completed": 1,
  "last_step": { "node_id": "plan", "outcome": "success", "summary": "..." },
  "history": [...]
}
```

Capture `session_id` from output.

#### 3b: Resume existing session

Use `coordinate next` for step_paused sessions:

```bash
maestro coordinate next {resumeId}
```

If `resumeId` is null (bare `-c`), omit the session ID — `next` resumes the latest step_paused session.

Same JSON output format.

---

### Step 4: Step Loop

Parse JSON output from start/next. While `status === "step_paused"`:

```bash
maestro coordinate next {session_id}
```

After each call:
- Parse JSON output
- Log step result: `[Step N] /{cmd} — {outcome} — {summary}`
- If `status === "step_paused"` → continue loop
- If `status === "completed"` → **Step 5**
- If `status === "failed"` → **Step 5**

The walker handles internally:
- Prompt assembly from `coordinate-step` template (command nodes) and inline `buildDecisionPrompt` (decision nodes) — **the walker owns all prompt construction**
- CLI execution via `maestro delegate --to {tool} --mode {write|analysis}`
- Decision/gate/eval node auto-resolution:
  - `strategy: 'expr'` — static expression, instant
  - `strategy: 'llm'` — spawns the configured CLI tool via a thin `DefaultLLMDecider`, expects a `DECISION: <target>\nREASONING: <text>` response
  - **Expr fallback**: when an `expr` decision has no matching edge and no `default` edge, the walker automatically asks the LLM decider before failing
- max_visits loop prevention
- State persistence to `.workflow/.maestro-coordinate/{session_id}/`
- **Channel telemetry**: every walker event is published to a file/SQLite broker under `~/.maestro/data/async/`, keyed by `session_id`. External observers tail it via `maestro coordinate watch {sessionId} [--follow]` without affecting the stdout JSON protocol.

> **Step-mode latency note**: in step mode, an LLM-driven decision fires a real CLI spawn inside the `next` process. This is synchronous and can take several seconds. The outer step loop should not impose tight per-step deadlines. Static `expr` decisions remain instant.

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
| `maestro coordinate report --session <sid> --node <id> --status SUCCESS\|FAILURE [...]` | Agent-invoked result writer — the authoritative command-node result channel | Writes `.workflow/.maestro-coordinate/{sid}/reports/{node}.json`, exits 0 |

---

## Core Rules

1. **All execution via CLI endpoint** — `maestro coordinate start/next/run`, never direct walker calls
2. **Step mode by default** — `start` pauses after each command node, `next` advances one step
3. **JSON protocol** — all subcommands output structured JSON to stdout, logs to stderr
4. **Session persistence** — state at `.workflow/.maestro-coordinate/{session_id}/walker-state.json`
5. **Decision auto-resolve** — walker evaluates `ctx.result.status` internally between steps; falls back to the injected LLM decider when `expr` has no matching edge and no default
6. **Resume** — `next {sessionId}` continues any step_paused session
7. **Autonomous fallback** — `run` walks entire graph without pausing (backward compat)
8. **Observation is separate from driving** — `watch` is a read-only tail on the broker; it does not advance the walker. Use it alongside `next` or `run` for live progress without disturbing the driver loop.
9. **Result channel** — command-node results are written by the agent via `maestro coordinate report` to a JSON file the walker reads preferentially over stdout parsing.
