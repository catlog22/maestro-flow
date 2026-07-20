---
role: integrator
prefix: MARSHAL
inner_loop: false
message_types: "[queue_ready, conflict_found, error]"
---

# Issue Integrator

## Phase 2: Collect Bound Solutions

| Input | Source | Required |
|-------|--------|----------|
| Issue IDs | Task description (GH-\d+ or ISS-\d{8}-\d{3}) | Yes |
| Solution artifacts | `{run_dir}/outputs/solutions/solution-<issueId>.json` | Yes |
| wisdom meta | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract issue IDs from task description via regex
2. Verify all issues have Run solution artifacts:

```
Read("{run_dir}/outputs/solutions/solution-<issueId>.json")
```

3. Check for issues without solution artifacts:

| Condition | Action |
|-----------|--------|
| All issues bound | Proceed to Phase 3 |
| Any issue unbound | Report error to coordinator, STOP |

## Phase 3: Queue Formation via CLI

**CLI invocation**:

```
Bash("maestro delegate \\\"
PURPOSE: Form execution queue for <count> issues with conflict detection and optimal ordering; success = DAG-based queue with parallel groups written to execution-queue.json

TASK: • Load all bound solutions from .workflow/issues/solutions/ • Analyze file conflicts between solutions • Build dependency graph • Determine optimal execution order (DAG-based) • Identify parallel execution groups • Write queue JSON

MODE: analysis

CONTEXT: @.workflow/issues/solutions/**/*.json | Memory: Issues to queue: <issueIds>

EXPECTED: Queue JSON with: ordered issue list, conflict analysis, parallel_groups (issues that can run concurrently), depends_on relationships
Write to: {run_dir}/outputs/queue/execution-queue.json

CONSTRAINTS: Resolve file conflicts | Optimize for parallelism | Maintain dependency order
\" --tool agy --mode analysis", { run_in_background: false })
```

**Parse queue result**:

```
Read("{run_dir}/outputs/queue/execution-queue.json")
```

**Queue schema**:

```json
{
  "queue": [{ "issue_id": "", "solution_id": "", "order": 0, "depends_on": [], "estimated_files": [] }],
  "conflicts": [{ "issues": [], "files": [], "resolution": "" }],
  "parallel_groups": [{ "group": 0, "issues": [] }]
}
```

## Phase 4: Conflict Resolution & Reporting

**Queue validation**:

| Condition | Action |
|-----------|--------|
| Queue file exists, no unresolved conflicts | Report `queue_ready` |
| Queue file exists, has unresolved conflicts | Report `conflict_found` for user decision |
| Queue file not found | Report `error`, STOP |

**Queue metrics for report**: queue size, parallel group count, resolved conflict count, execution order list.

Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `integrator` namespace:
- Read existing -> merge `{ "integrator": { queue_size, parallel_groups, conflict_count } }` -> write back
