<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Issue Analysis

> **DEPRECATED**: Superseded by `issue-gaps-analyze.md` which adds batch support and context.md output.
> Use `maestro-analyze --gaps [ISS-ID]` instead.

## Migration

| Old usage | New usage |
|-----------|-----------|
| `manage-issue-analyze ISS-ID` | `/maestro-analyze --gaps ISS-ID` |
| `manage-issue-analyze` (batch) | `/maestro-analyze --gaps` |
| `manage-issue-plan ISS-ID` (follow-up) | `/maestro-plan --gaps ISS-ID` |

## See Also

- `issue-gaps-analyze.md` — current implementation (single + batch, classification, parallel exploration, context.md)
- `issue-gaps-analyze.codex.md` — codex variant using `spawn_agents_on_csv` waves
- `issue-execute.md` — downstream execution after planning

## Notes
