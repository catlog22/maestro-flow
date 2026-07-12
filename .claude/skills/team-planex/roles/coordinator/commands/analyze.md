# Analyze Task

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Parse plan-and-execute input -> detect input type -> determine execution method -> assess scope.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Input Pattern | Type | Action |
|--------------|------|--------|
| `ISS-\d{8}-\d{6}` pattern | Issue IDs | Use directly |
| `--text '...'` flag | Text requirement | Create issues via CLI |
| `--plan <path>` flag | Plan file | Read file, parse phases |

## Execution Method Selection

| Condition | Execution Method |
|-----------|-----------------|
| `--exec=codex` specified | Codex |
| `--exec=agy` specified | Agy |
| `-y` or `--yes` flag present | Auto (default Agy) |
| No flags (interactive) | AskUserQuestion -> user choice |
| Auto + task_count <= 3 | Agy |
| Auto + task_count > 3 | Codex |

## Scope Assessment

| Factor | Complexity |
|--------|------------|
| Issue count 1-3 | Low |
| Issue count 4-10 | Medium |
| Issue count > 10 | High |
| Cross-cutting concern | +1 level |

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "input_type": "<issues|text|plan>",
  "raw_input": "<original input>",
  "execution_method": "<codex|agy>",
  "issue_count_estimate": 0,
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "pipeline_type": "plan-execute",
  "roles": [
    { "name": "planner", "prefix": "PLAN", "inner_loop": true },
    { "name": "executor", "prefix": "EXEC", "inner_loop": true }
  ]
}
```
