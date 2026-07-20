
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Command: dispatch

## Purpose

Create the initial task chain for team-planex pipeline. Creates PLAN-001 for planner. EXEC-* tasks are NOT pre-created — planner creates them at runtime per issue.

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Input type | Phase 1 requirements | Yes |
| Raw input | Phase 1 requirements | Yes |
| Session folder | Phase 2 session init | Yes |
| Execution method | Phase 1 requirements | Yes |

## Phase 3: Task Chain Creation

### Task Creation

Create a single PLAN-001 task for the planner:

```
update_plan({
  subject: "PLAN-001: Requirement decomposition and solution design",
  description: `Decompose requirements into issues and generate solutions.

Input type: <issues|text|plan>
Input: <raw-input>
Session: {run_dir}/work/team
Execution method: <agent|codex|agy>

## Instructions
1. Parse input to get issue list
2. For each issue: call issue-plan-agent → write solution artifact
3. After each solution: create EXEC-* task with solution_file path, then update_plan to set owner: executor
4. After all issues: send all_planned signal

InnerLoop: true`,
  activeForm: "Planning requirements"
})
```

### EXEC-* Task Template (for planner reference)

Planner creates EXEC-* tasks at runtime using this template:

```
update_plan({
  subject: "EXEC-00N: Implement <issue-title>",
  description: `Implement solution for issue <issueId>.

Issue ID: <issueId>
Solution file: {run_dir}/outputs/solutions/<issueId>.json
Session: {run_dir}/work/team
Execution method: <agent|codex|agy>

InnerLoop: true`,
  activeForm: "Implementing <issue-title>"
})
```

### Add Command Task Template

When coordinator handles `add` command, create additional PLAN tasks:

```
update_plan({
  subject: "PLAN-00N: Additional requirement decomposition",
  description: `Additional requirements to decompose.

Input type: <issues|text|plan>
Input: <new-input>
Session: {run_dir}/work/team
Execution method: <execution-method>

InnerLoop: true`,
  activeForm: "Planning additional requirements"
})
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| PLAN-001 created | list_agents shows PLAN-001 |
| Description complete | Contains Input, Session, Execution method |
| No orphans | All tasks have valid owner |
