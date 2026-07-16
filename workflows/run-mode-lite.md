<!-- session-mode: inherited -->
# Run Mode Lite

Lightweight Session/Run lifecycle for team skills. Only two verbs: **create** and **complete**. No `prepare`, no `brief`, no workflow content loading.

## Create

1. Compose a session slug: `YYYYMMDD-<skill>-<topic>` — ASCII-only, ≤64 characters. NEVER let the runtime auto-generate from a Chinese or long intent string.
2. Run `maestro run create <skill-name> --session <slug> --intent "<short phrase>"` before domain work.
3. Retain the returned `run_id`, `run_dir`. Store in `team-session.json` under `"run": { "run_id": "<id>", "run_dir": "<path>" }`.

## Artifact Boundary

- Formal deliverables: write to `{run_dir}/outputs/` (filename stem = artifact kind).
- Team coordination files (session bus, role-specs, process logs): stay in `.workflow/.team/`, not formal artifacts.

## Complete

1. Optionally write `{run_dir}/report.md` with frontmatter (`verdict`, `summary`, `concerns`). Complete auto-derives handoff; omitting report.md is legal.
2. Run `maestro run complete <run_id>`. The `check` step is optional — complete includes the same evaluation.
3. Complete failure does not block the team skill's own completion action; log a warning.
