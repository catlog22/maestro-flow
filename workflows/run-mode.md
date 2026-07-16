<!-- session-mode: inherited -->
# Canonical Run Mode

This file is the single Session/Run lifecycle contract for every command, workflow, and stateful skill that declares `session-mode: run`.

Lifecycle verbs: **prepare → create → brief → complete**.

## Prepare (optional, read-only)

- `maestro run prepare <step>` resolves what a step would consume and produce without side effects.
- Read-only and idempotent — it never allocates a Session or creates directories.
- Use it to preview upstream availability and the derived artifact contract before committing to a Run.

## Start or Resume

> **Dispatched by an orchestrator?** When `ralph next` or `maestro run next` invokes you, the Run is already created and its `run_id` / `run_dir` / `upstream` are injected in the birth packet — use them directly and do **NOT** call `maestro run create` (a second create mints an empty duplicate Run). The steps below apply only to a command starting a Run on its own.

1. Read the caller frontmatter `name` as `<command-name>`.
2. **Compose a session slug** — `YYYYMMDD-{command}-{topic}` where `{topic}` is a 1–3 word ASCII-only slug derived from the intent (e.g. `20260715-odyssey-jwt-auth`). NEVER let the runtime auto-generate from a Chinese or long intent string.
3. Run `maestro run create <command-name> --session <slug> --intent "<short intent phrase>" -- $ARGUMENTS` before domain work.
   - `--session`: the slug from step 2 (explicit, ASCII-only, ≤64 chars).
   - `--intent`: a short human-readable phrase (1 sentence) describing the goal. May contain Chinese but is NOT used as the session ID.
   - `$ARGUMENTS`: command-specific flags (e.g. `--template <name>`).
4. The runtime resolves the Session in this order: explicit `--session`, an existing running/paused Session with the same normalized intent, otherwise a newly allocated Session. With step 2–3 followed correctly, the explicit path always wins.
5. Retain the returned `session_id`, `run_id`, `run_dir`, and `upstream`. Do not locate Sessions or artifacts with glob, mtime, directory ordering, or hidden command folders.
6. `maestro run brief <run_id>` returns the Resume Packet — prior artifacts, upstream map, and open decisions — for continuing an existing Run.

**Session slug examples:**
```
# ✅ correct — mode-qualified command name resolves the mode's own contract
maestro run create odyssey-planex --session 20260715-odyssey-planex-todo-integration --intent "完成 session-run-todo-goal 集成计划"
maestro run create learn --session 20260715-learn-auth-flow --intent "理解认证流程" -- follow src/auth/

# ❌ wrong — no --session, Chinese intent generates unreadable ID
maestro run create odyssey-planex --intent "完成 docs/session-run-todo-goal-integration-plan.md 的 P0-P6"
# ❌ wrong — mode-less command name (empty contract, ambiguous workflow resolution)
maestro run create odyssey --session 20260715-odyssey-planex-todo -- --mode planex
```

## Artifact Boundary

- Every formal artifact (including evidence-role artifacts declared in the prepare contract) MUST be written under `{run_dir}/outputs/`.
- Human-readable synthesis and handoff MUST be written to `{run_dir}/report.md`.
- Informal worker traces and intermediate logs may use `{run_dir}/evidence/` (lazily created, not gate-checked).
- Temporary computation may use `{run_dir}/work/`; it is never an artifact and is never indexed.
- `.workflow/sessions/{session_id}/` is the only Session authority. Do not create private command Session directories or a second status/manifest truth source. Team message buses may exist only as transient coordination and never contain formal artifacts.
- Protocol files (`session.json`, `run.json`, `artifacts.json`) are runtime-owned and MUST NOT be edited directly.
- Consume upstream only from the `upstream` map returned by `maestro run create`.

## Completion

1. Run `maestro run check {run_id}` and repair any blocking artifact or exit gate it reports.
2. Run `maestro run complete {run_id}`. The artifact gate is derived from the Run contract and evaluated automatically.
3. Report success only when the Run is completed. Completed artifacts are immutable; revisions create new Runs/artifacts.
