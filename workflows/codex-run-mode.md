<!-- session-mode: inherited -->

# Codex Run Adapter

This adapter extends `@~/.maestro/workflows/run-mode.md` for Codex skills. The canonical Run contract remains authoritative.

## Codex Execution Surfaces

- Preserve Codex-native tools and orchestration: `spawn_agents_on_csv`, collaboration agents, `request_user_input`, goal APIs, and structured tool schemas.
- CSV master state, wave inputs, and intermediate results are temporary computation. Store them under `{run_dir}/work/csv-wave/`.
- All formal artifacts (including evidence-role outputs) MUST be stored at their declared `{run_dir}/outputs/...` paths.
- Informal worker traces and cross-worker discoveries may use `{run_dir}/evidence/` (lazily created, not gate-checked).
- Human-readable synthesis and handoff belong in `{run_dir}/report.md`.

## Authority and Completion

- The skill frontmatter `contract` is the output schema and alias authority. Domain examples in the body MUST NOT create a second artifact registry or output root.
- Never edit `.workflow/state.json` artifact arrays or Session protocol JSON. Resolve inputs from the `upstream` map returned by `maestro run create`.
- Every CSV worker MUST call `report_agent_job_result` exactly once. Workers do not mutate protocol files or orchestrator-owned CSV files.
- Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`. When every gate is clean, `run check` emits a `finish` checklist (handoff, knowledge record, conflict marking, verdict, workflow-declared norms) — work through it before completing. Sealed artifacts are immutable.
