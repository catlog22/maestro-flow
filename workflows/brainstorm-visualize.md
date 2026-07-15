<!-- session-mode: none -->
# Brainstorm Visualizer Compatibility Workflow

This compatibility entry routes visualizer operations directly to the `maestro brainstorm-visualize` CLI. It does not participate in the Session/Run lifecycle.

## Command Routing

| Request | CLI command |
|---|---|
| Start a visualizer | `maestro brainstorm-visualize start [--dir <path>] [--session <id>] [--host <host>] [--port <port>]` |
| Inspect a visualizer | `maestro brainstorm-visualize status <execId>` |
| Stop a visualizer | `maestro brainstorm-visualize stop <execId>` |

Return the CLI output unchanged so callers can retain the `execId`, URL, and served directory needed by later `status` or `stop` calls.
