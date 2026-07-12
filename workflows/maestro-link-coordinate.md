<!-- session-mode: inherited -->
# Workflow: maestro-link-coordinate

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

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
