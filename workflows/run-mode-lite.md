<!-- session-mode: inherited -->
# Run Mode Lite

Lightweight Session/Run lifecycle for team skills. Only two verbs: **create** and **complete**. No `prepare`, no `brief`, no workflow content loading.

## Create

> **Dispatched by an orchestrator?** If the dispatch context already carries `run_id` / `run_dir` (a birth packet from `maestro run next` / `ralph next`), store them in `team-session.json` under `"run"` and do **NOT** call `maestro run create` — a second create mints an empty duplicate Run. The steps below apply only to a skill starting its own Run.

1. Compose a session slug: `YYYYMMDD-<skill>-<topic>` — ASCII-only, ≤64 characters. NEVER let the runtime auto-generate from a Chinese or long intent string.
2. Run `maestro run create <skill-name> --session <slug> --intent "<short phrase>"` before domain work.
3. Retain the returned `run_id`, `run_dir`. Merge them into `{run_dir}/work/team/team-session.json` under `"run": { "run_id": "<id>", "run_dir": "<path>" }`.

### Team State Authority

- `{run_dir}/work/team/team-session.json` is the single coordinator-owned state file. It contains both coordination state and the `run` block used by the team-worker fallback.
- Every state update is a merge-write: coordination updates MUST preserve `run`; Run updates MUST preserve coordination fields. Do not create a sibling `team-state.json`.
- Workers may read `team-session.json` to resolve `run.run_dir`, but only the coordinator writes it.

## Artifact Boundary

- Formal deliverables: write to `{run_dir}/outputs/` (filename stem = artifact kind).
- Every new formal JSON deliverable MUST contain a complete top-level `_meta` object. `kind` and `schema` are required together; `role` and `alias` are optional. Use `{"_meta":{"kind":"<kind>","schema":"<kind>/1.0"},...}` and keep `kind` stable across filename changes.
- A legacy JSON deliverable with no `_meta` remains readable through filename inference. Never write a partial, null, or non-object `_meta`; strict validation rejects the artifact and blocks Run completion.
- Team coordination files (session bus, role-specs, process logs): stay in `{run_dir}/work/team/`, not formal artifacts, and do not carry artifact `_meta`.
- `{run_dir}` MUST be resolved to the actual Run path before it is joined onto an `outputs/` path — never write a path that still contains the literal `{run_dir}` placeholder (such artifacts land outside the real Run and never reach the `run complete` gate).

## Complete

> **Who completes?** When the Run was dispatched via a birth packet (an orchestrator already created it, see Create), `run complete` belongs to the dispatching orchestrator — the skill only writes `outputs/` + `report.md` and does NOT self-complete. Only a self-started Run (the skill called `run create` itself) is completed by the skill via the steps below.

1. Optionally write `{run_dir}/report.md` with frontmatter (`verdict`, `summary`, `concerns`). Complete auto-derives handoff; omitting report.md is legal.
2. Run `maestro run complete <run_id>`. The `check` step is optional — complete includes the same evaluation.
3. Completion is fail-closed: if `run complete` fails, fix the blocking gate (missing or malformed `outputs/` artifacts) and retry. While it keeps failing, do not archive/clean the team or claim success — keep the team active (status=paused) and surface the blocking gate to the user.
