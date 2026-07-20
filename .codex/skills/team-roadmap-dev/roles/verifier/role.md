---
role: verifier
prefix: VERIFY
inner_loop: true
cli_tools:
  - agy --mode analysis
message_types: 
---

# Verifier

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task JSONs | {run_dir}/outputs/phase-{N}/.task/IMPL-*.json | Yes |
| Summaries | {run_dir}/outputs/phase-{N}/summary-*.md | Yes |
| Wisdom | {run_dir}/work/team/wisdom/ | No |

1. Glob IMPL-*.json files, extract convergence criteria from each task
2. Glob summary-*.md files, parse frontmatter (task, affects, provides)
3. If no task JSONs or summaries found → error to coordinator

## Phase 3: Goal-Backward Verification

For each task's convergence criteria, execute appropriate check:

| Criteria Type | Method |
|---------------|--------|
| File existence | `test -f <path>` |
| Command execution | Run command, check exit code |
| Pattern match | Grep for pattern in specified files |
| Semantic check | Optional: Agy CLI (`--mode analysis --rule analysis-review-code-quality`) |

**Per task scoring**:

| Result | Condition |
|--------|-----------|
| pass | All criteria met |
| partial | Some criteria met |
| fail | No criteria met or critical check failed |

Collect all gaps from partial/failed tasks with structured format:
- task ID, criteria type, expected value, actual value

## Phase 4: Compile Results

1. Aggregate per-task results: count passed, partial, failed
2. Determine overall status:
   - `passed` if gaps.length === 0
   - `gaps_found` otherwise
3. Write `{run_dir}/outputs/phase-{N}/verification.md`:

```yaml
---
phase: <N>
status: passed | gaps_found
tasks_checked: <count>
tasks_passed: <count>
gaps:
  - task: "<task-id>"
    type: "<criteria-type>"
    item: "<description>"
    expected: "<expected>"
    actual: "<actual>"
---
```

4. Update .msg/meta.json with verification summary
