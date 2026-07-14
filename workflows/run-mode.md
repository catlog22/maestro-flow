<!-- session-mode: inherited -->
# Canonical Run Mode

This file is the single Session/Run lifecycle contract for every command, workflow, and stateful skill that declares `session-mode: run`.

Lifecycle verbs: **prepare → create → brief → complete**.

## Prepare (optional, read-only)

- `maestro prepare <step>` resolves what a step would consume and produce without side effects.
- Read-only and idempotent — it never allocates a Session or creates directories.
- Use it to preview upstream availability and the derived artifact contract before committing to a Run.

## Start or Resume

1. Read the caller frontmatter `name` as `<command-name>`.
2. Run `maestro run create <command-name> -- $ARGUMENTS` before domain work.
3. The runtime resolves the Session in this order: explicit `--session`, an existing running/paused Session with the same normalized intent, otherwise a newly allocated Session.
4. Retain the returned `session_id`, `run_id`, `run_dir`, and `upstream`. Do not locate Sessions or artifacts with glob, mtime, directory ordering, or hidden command folders.
5. `maestro run brief <run_id>` returns the Resume Packet — prior artifacts, upstream map, and open decisions — for continuing an existing Run.

## Artifact Boundary

- Every formal artifact MUST be written under `{run_dir}/outputs/`.
- Evidence and worker traces MUST be written under `{run_dir}/evidence/`.
- Human-readable synthesis and handoff MUST be written to `{run_dir}/report.md`.
- Temporary computation may use `{run_dir}/work/`; it is never an artifact and is never indexed.
- `.workflow/sessions/{session_id}/` is the only Session authority. Do not create private command Session directories or a second status/manifest truth source. Team message buses may exist only as transient coordination and never contain formal artifacts.
- Protocol files (`session.json`, `run.json`, `artifacts.json`) are runtime-owned and MUST NOT be edited directly.
- Consume upstream only from the `upstream` map returned by `maestro run create`.

## Completion

1. Run `maestro run complete {run_id}`. The artifact gate is derived from the Run contract and evaluated automatically — repair any blocking artifact it reports.
2. Report success only when the Run is completed. Completed artifacts are immutable; revisions create new Runs/artifacts.
