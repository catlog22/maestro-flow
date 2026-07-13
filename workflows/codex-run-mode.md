<!-- session-mode: inherited -->

# Codex Run Adapter

This adapter extends `@~/.maestro/workflows/run-mode.md` for Codex skills. The canonical Run contract remains authoritative.

## Codex Execution Surfaces

- Preserve Codex-native tools and orchestration: `spawn_agents_on_csv`, collaboration agents, `request_user_input`, goal APIs, and structured tool schemas.
- CSV master state, wave inputs, and intermediate results are temporary computation. Store them under `{run_dir}/work/csv-wave/`.
- Worker traces and cross-worker discoveries are evidence. Store them under `{run_dir}/evidence/`.
- Only frontmatter-declared typed artifacts are formal outputs. Store them at their declared `{run_dir}/outputs/...` paths.
- Human-readable synthesis and handoff belong in `{run_dir}/report.md`.

## Authority and Completion

- The skill frontmatter `contract` is the output schema and alias authority. Domain examples in the body MUST NOT create a second artifact registry or output root.
- Never edit `.workflow/state.json` artifact arrays or Session protocol JSON. Resolve inputs from the `upstream` map returned by `maestro run create`.
- Every CSV worker MUST call `report_agent_job_result` exactly once. Workers do not mutate protocol files or orchestrator-owned CSV files.
- Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`. Sealed artifacts are immutable.
