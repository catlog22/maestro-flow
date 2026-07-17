<!-- session-mode: inherited -->
# Run Mode Lite

Lightweight Session/Run lifecycle for team skills. Only two verbs: **create** and **complete**. No `prepare`, no `brief`, no workflow content loading.

## Create

> **Dispatched by an orchestrator?** If the dispatch context already carries `run_id` / `run_dir` (a birth packet from `maestro run next` / `ralph next`), store them in `team-session.json` under `"run"` and do **NOT** call `maestro run create` — a second create mints an empty duplicate Run. The steps below apply only to a skill starting its own Run.

1. Compose a session slug: `YYYYMMDD-<skill>-<topic>` — ASCII-only, ≤64 characters. NEVER let the runtime auto-generate from a Chinese or long intent string.
2. Run `maestro run create <skill-name> --session <slug> --intent "<short phrase>"` before domain work.
3. Retain the returned `run_id`, `run_dir`. Store in `team-session.json` under `"run": { "run_id": "<id>", "run_dir": "<path>" }`.

## Artifact Boundary

- Formal deliverables: write to `{run_dir}/outputs/` (filename stem = artifact kind).
- Team coordination files (session bus, role-specs, process logs): stay in `.workflow/.team/`, not formal artifacts.

## Complete

1. Optionally write `{run_dir}/report.md` with frontmatter (`verdict`, `summary`, `concerns`). Complete auto-derives handoff; omitting report.md is legal.
2. Run `maestro run complete <run_id>`. The `check` step is optional — complete includes the same evaluation.
3. Completion is fail-closed: if `run complete` fails, fix the blocking gate (missing or malformed `outputs/` artifacts) and retry. While it keeps failing, do not archive/clean the team or claim success — keep the team active (status=paused) and surface the blocking gate to the user.
