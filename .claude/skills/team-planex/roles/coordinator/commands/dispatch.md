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
TaskCreate({
  subject: "PLAN-001: Requirement decomposition and solution design",
  description: `Decompose requirements into issues and generate solutions.

Input type: <issues|text|plan>
Input: <raw-input>
Session: <session-folder>
Execution method: <agent|codex|agy>

## Instructions
1. Parse input to get issue list
2. For each issue: call issue-plan-agent → write solution artifact
3. After each solution: create EXEC-* task with solution_file path, then TaskUpdate to set owner: executor
4. After all issues: send all_planned signal

InnerLoop: true`,
  activeForm: "Planning requirements"
})
```

### EXEC-* Task Template (for planner reference)

Planner creates EXEC-* tasks at runtime using this template:

```
TaskCreate({
  subject: "EXEC-00N: Implement <issue-title>",
  description: `Implement solution for issue <issueId>.

Issue ID: <issueId>
Solution file: <session-folder>/artifacts/solutions/<issueId>.json
Session: <session-folder>
Execution method: <agent|codex|agy>

InnerLoop: true`,
  activeForm: "Implementing <issue-title>"
})
```

### Add Command Task Template

When coordinator handles `add` command, create additional PLAN tasks:

```
TaskCreate({
  subject: "PLAN-00N: Additional requirement decomposition",
  description: `Additional requirements to decompose.

Input type: <issues|text|plan>
Input: <new-input>
Session: <session-folder>
Execution method: <execution-method>

InnerLoop: true`,
  activeForm: "Planning additional requirements"
})
```

## Phase 4: Validation

| Check | Criteria |
|-------|----------|
| PLAN-001 created | TaskList shows PLAN-001 |
| Description complete | Contains Input, Session, Execution method |
| No orphans | All tasks have valid owner |
