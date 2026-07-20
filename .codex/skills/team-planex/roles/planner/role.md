---
role: planner
prefix: PLAN
inner_loop: true
message_types: 
---

> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

# Planner

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Input type + raw input | Task description | Yes |
| Session folder | Task description `Session:` field | Yes |
| Execution method | Task description `Execution method:` field | Yes |
| Wisdom | `{run_dir}/work/team/wisdom/` | No |

1. Extract session path, input type, raw input, execution method from task description
2. Load wisdom files if available
3. Parse input to determine issue list:

| Detection | Condition | Action |
|-----------|-----------|--------|
| Issue IDs | `ISS-\d{8}-\d{3}` pattern | Use directly |
| `--text '...'` | Flag in input | Create issue(s) via `Bash("maestro issue create ... --json")` |
| `--plan <path>` | Flag in input | Read file, parse phases, batch create issues |

## Phase 3: Issue Processing Loop

For each issue, execute in sequence:

### 3a. Generate Solution

Use CLI tool for issue planning:

```bash
maestro delegate "PURPOSE: Generate implementation solution for issue <issueId>; success = actionable task breakdown with file paths
TASK: • Load issue details • Analyze requirements • Design solution approach • Break down into implementation tasks • Identify files to modify/create
MODE: analysis
CONTEXT: @**/* | Memory: Session context from {run_dir}/work/team/wisdom/
EXPECTED: JSON solution with: title, description, tasks array (each with description, files_touched), estimated_complexity
CONSTRAINTS: Follow project patterns | Reference existing implementations
" --tool agy --mode analysis --rule planning-breakdown-task-steps
```

Parse CLI output to extract solution JSON. If CLI fails, stop and report the missing Run solution artifact; do not consult a second solution store.

### 3b. Write Solution Artifact

Write solution JSON to: `{run_dir}/outputs/solutions/<issueId>.json`

```json
{
  "session_id": "<run-id>",
  "issue_id": "<issueId>",
  "solution": "<solution-from-agent>",
  "planned_at": "<ISO timestamp>"
}
```

### 3c. Check Conflicts

Extract `files_touched` from solution. Compare against prior solutions in session.
Overlapping files -> log warning to `wisdom/issues.md`, continue.

### 3d. Create EXEC-* Task

```
update_plan({
  subject: "EXEC-00N: Implement <issue-title>",
  description: `Implement solution for issue <issueId>.

Issue ID: <issueId>
Solution file: {run_dir}/outputs/solutions/<issueId>.json
Session: {run_dir}/work/team
Execution method: <method>

InnerLoop: true`,
  activeForm: "Implementing <issue-title>"
})
```

### 3e. Signal issue_ready

Send message via team_msg + send_message to coordinator:
- type: `issue_ready`

### 3f. Continue Loop

Process next issue. Do NOT wait for executor.

### Tech Profile Scan

After issue processing, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check issue scope and code patterns → signals (`sql_detected`, `auth_detected`, `perf_sensitive`)
2. Check plan complexity → signals (`breaking_change`, `scaling_concern`, `data_migration`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Completion Signal

After all issues processed:
1. Send `all_planned` message to coordinator via team_msg + send_message
2. Summary: total issues planned, EXEC-* tasks created

## Boundaries

| Allowed | Prohibited |
|---------|-----------|
| Parse input, create issues | Write/modify business code |
| Generate solutions (CLI) | Run tests |
| Write solution artifacts | git commit |
| Create EXEC-* tasks | Call code-developer |
| Conflict checking | Direct user interaction |
