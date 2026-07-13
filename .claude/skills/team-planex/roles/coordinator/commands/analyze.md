
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

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
