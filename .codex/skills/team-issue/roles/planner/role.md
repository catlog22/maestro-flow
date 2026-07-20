---
role: planner
prefix: SOLVE
inner_loop: false
additional_prefixes: "[SOLVE-fix]"
message_types: "[solution_ready, multi_solution, error]"
---

# Issue Planner

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Issue ID | Task description (GH-\d+ or ISS-\d{8}-\d{3}) | Yes |
| Explorer context | `{run_dir}/work/team/explorations/context-<issueId>.json` | No |
| Review feedback | Task description (for SOLVE-fix tasks) | No |
| wisdom meta | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract issue ID from task description via regex: `(?:GH-\d+|ISS-\d{8}-\d{3})`
2. If no issue ID found -> report error, STOP
3. Load explorer context report (if available):

```
Read("{run_dir}/work/team/explorations/context-<issueId>.json")
```

4. Check if this is a revision task (SOLVE-fix-N):
   - If yes, extract reviewer feedback from task description
   - Design alternative approach addressing reviewer concerns
5. Load wisdom files for accumulated codebase knowledge

## Phase 3: Solution Generation via CLI

**CLI invocation**:

```
Bash("maestro delegate \\\"
PURPOSE: Design solution for issue <issueId> and decompose into implementation tasks; success = canonical Run solution artifact with task breakdown

TASK: • Load issue details via Maestro maestro-manage issue status • Analyze explorer context • Design solution approach • Break down into implementation tasks • Generate solution JSON • Record the Run artifact path on the issue

MODE: analysis

CONTEXT: @**/* | Memory: Issue <issueId> - <issue.title> (Priority: <issue.priority>)
Explorer findings: <explorerContext.key_findings>
Relevant files: <explorerContext.relevant_files>
Complexity: <explorerContext.complexity_assessment>

EXPECTED: Solution JSON with: issue_id, solution_id, approach, tasks (ordered list with descriptions), estimated_files, dependencies
Write to: {run_dir}/outputs/solutions/solution-<issueId>.json
Then record: `Bash("maestro issue update <issueId> --fix-direction \"Solution: {run_dir}/outputs/solutions/solution-<issueId>.json\" --note \"Solution artifact created\" --json")`

CONSTRAINTS: Follow existing patterns | Minimal changes | Address reviewer feedback if SOLVE-fix task
\" --tool agy --mode analysis", { run_in_background: false })
```

**Expected CLI output**: Solution file path and binding confirmation

**Parse result**:

```
Read("{run_dir}/outputs/solutions/solution-<issueId>.json")
```

## Phase 4: Solution Selection & Reporting

**Outcome routing**:

| Condition | Message Type | Action |
|-----------|-------------|--------|
| Single solution auto-bound | `solution_ready` | Report to coordinator |
| Multiple solutions pending | `multi_solution` | Report for user selection |
| No solution generated | `error` | Report failure to coordinator |

Write solution summary to `{run_dir}/outputs/solutions/solution-<issueId>.json`.

Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `planner` namespace:
- Read existing -> merge `{ "planner": { issue_id, solution_id, task_count, is_revision } }` -> write back
