<!-- session-mode: inherited -->
# Workflow: maestro-chain-execute [DEPRECATED]

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

## Migration

- Caller dispatching from `maestro.md` → use `Skill({ skill: "maestro-ralph-execute" })`
- Resume from session → `Skill({ skill: "maestro-ralph-execute" })` (auto-discovers latest running session via `.workflow/.maestro/*/status.json`)

## References

- `~/.maestro/workflows/maestro.md` — coordinator that creates sessions and dispatches to the unified executor
- `~/.maestro/workflows/maestro-ralph-execute.md` — current canonical executor (handles both maestro static chains and ralph adaptive chains)

The unified executor preserves all behaviour previously documented here:
status.json persistence, TodoWrite dual-tracking, per-step engine selection (`Skill` vs `CLI`),
context propagation across steps, post-step Gemini analysis for CLI steps,
and retry/skip/abort on failure.
