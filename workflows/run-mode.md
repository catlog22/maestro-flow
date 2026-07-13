<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Canonical Run Mode

This file is the single Session/Run lifecycle contract for every command, workflow, and stateful skill that declares `session-mode: run`.

## Start or Resume

1. Read the caller frontmatter `name` as `<command-name>`.
2. Run `maestro run create <command-name> -- $ARGUMENTS` before domain work.
3. The runtime resolves the Session in this order: explicit `--session`, an existing running/paused Session with the same normalized intent, otherwise a newly allocated Session.
4. Retain the returned `session_id`, `run_id`, `run_dir`, `upstream`, and entry-gate result. Do not locate Sessions or artifacts with glob, mtime, directory ordering, or hidden command folders.

## Artifact Boundary

- Every formal artifact MUST be written under `{run_dir}/outputs/`.
- Evidence and worker traces MUST be written under `{run_dir}/evidence/`.
- Human-readable synthesis and handoff MUST be written to `{run_dir}/report.md`.
- Temporary computation may use `{run_dir}/work/`; it is never an artifact and is never indexed.
- `.workflow/sessions/{session_id}/` is the only Session authority. Do not create private command Session directories, milestone/phase artifact trees, or a second status/manifest truth source. Team message buses may exist only as transient coordination and never contain formal artifacts.
- Protocol files (`session.json`, `run.json`, `gates.json`, `artifacts.json`, `evidence.json`) are runtime-owned and MUST NOT be edited directly.
- Consume upstream only from the `upstream` map returned by `maestro run create`.

## Completion

1. Run `maestro run check {run_id}` and repair every blocking gate or invalid artifact.
2. Run `maestro run complete {run_id}`.
3. Report success only when the Run is sealed. Sealed artifacts are immutable; revisions create new Runs/artifacts.
