<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: maestro-chain-execute [DEPRECATED]

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
