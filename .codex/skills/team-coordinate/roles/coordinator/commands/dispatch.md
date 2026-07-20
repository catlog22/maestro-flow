
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

# Command: dispatch

## Purpose

Create task chains from dynamic dependency graphs. Builds pipelines from the task-analysis.json produced by Phase 1. Workers are spawned as team-worker agents with role-spec paths.

## When to Use

| Trigger | Condition |
|---------|-----------|
| After analysis | Phase 1 complete, task-analysis.json exists |
| After adapt | handleAdapt created new roles, needs new tasks |
| Re-dispatch | Pipeline restructuring (rare) |

## Strategy

- **Delegation**: Inline execution (coordinator processes directly)
- **Inputs**: task-analysis.json + team-session.json
- **Output**: update_plan calls with dependency chains

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task analysis | `{run_dir}/work/team/task-analysis.json` | Yes |
| Session file | `{run_dir}/work/team/team-session.json` | Yes |
| Role registry | `team-session.json#roles` | Yes |
| Scope | User requirements description | Yes |

## Phase 3: Task Chain Creation

### Workflow

1. **Read dependency graph** from `task-analysis.json#dependency_graph`
2. **Topological sort** tasks to determine creation order
3. **Validate** all task owners exist in role registry
4. **For each task** (in topological order):

```
update_plan({
  subject: "<PREFIX>-<NNN>",
  description: "PURPOSE: <goal> | Success: <success_criteria>
TASK:
  - <step 1>
  - <step 2>
  - <step 3>
CONTEXT:
  - Session: {run_dir}/work/team
  - Upstream artifacts: <artifact-1.md>, <artifact-2.md>
  - Key files: <file1>, <file2>
  - Shared state: team_msg(operation="get_state", session_id=<run-id>)
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: <true|false>
RoleSpec: {run_dir}/work/team/role-specs/<role-name>.md"
})
update_plan({ taskId: "<PREFIX>-<NNN>", addBlockedBy: [<dependency-list from graph>], owner: "<role-name>" })
```

5. **Update team-session.json** with pipeline and tasks_total
6. **Validate** created chain

### Task Description Template

Every task description includes structured fields for clarity:

```
PURPOSE: <goal from task-analysis.json#tasks[].goal> | Success: <success_criteria from task-analysis.json#tasks[].success_criteria>
TASK:
  - <step 1 from task-analysis.json#tasks[].steps[]>
  - <step 2 from task-analysis.json#tasks[].steps[]>
  - <step 3 from task-analysis.json#tasks[].steps[]>
CONTEXT:
  - Session: {run_dir}/work/team
  - Upstream artifacts: <comma-separated list from task-analysis.json#tasks[].upstream_artifacts[]>
  - Key files: <comma-separated list from task-analysis.json#tasks[].key_files[]>
  - Shared state: team_msg(operation="get_state", session_id=<run-id>)
EXPECTED: <artifact path from task-analysis.json#capabilities[].artifacts[]> + <quality criteria based on capability type>
CONSTRAINTS: <constraints from task-analysis.json#tasks[].constraints>
---
InnerLoop: <true|false>
RoleSpec: {run_dir}/work/team/role-specs/<role-name>.md
```

**Field Mapping**:
- `PURPOSE`: From `task-analysis.json#capabilities[].tasks[].goal` + `success_criteria`
- `TASK`: From `task-analysis.json#capabilities[].tasks[].steps[]`
- `CONTEXT.Upstream artifacts`: From `task-analysis.json#capabilities[].tasks[].upstream_artifacts[]`
- `CONTEXT.Key files`: From `task-analysis.json#capabilities[].tasks[].key_files[]`
- `EXPECTED`: From `task-analysis.json#capabilities[].artifacts[]` + quality criteria
- `CONSTRAINTS`: From `task-analysis.json#capabilities[].tasks[].constraints`

### InnerLoop Flag Rules

| Condition | InnerLoop |
|-----------|-----------|
| Role has 2+ serial same-prefix tasks | true |
| Role has 1 task | false |
| Tasks are parallel (no dependency between them) | false |

### Dependency Validation

| Check | Criteria |
|-------|----------|
| No orphan tasks | Every task is reachable from at least one root |
| No circular deps | Topological sort succeeds without cycle |
| All owners valid | Every task owner exists in team-session.json#roles |
| All blockedBy valid | Every blockedBy references an existing task subject |
| Session reference | Every task description contains `Session: {run_dir}/work/team` |
| RoleSpec reference | Every task description contains `RoleSpec: <path>` |

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| Task count | Matches dependency_graph node count |
| Dependencies | Every blockedBy references an existing task subject |
| Owner assignment | Each task owner is in role registry |
| Session reference | Every task description contains `Session:` |
| Pipeline integrity | No disconnected subgraphs (warn if found) |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Circular dependency detected | Report cycle, halt task creation |
| Owner not in role registry | Error, coordinator must fix roles first |
| update_plan fails | Log error, report to coordinator |
| Duplicate task subject | Skip creation, log warning |
| Empty dependency graph | Error, task analysis may have failed |
