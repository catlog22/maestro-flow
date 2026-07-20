
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Dispatch Tasks

## Workflow

1. Read task-analysis.json -> extract dependency_graph
2. Read specs/pipelines.md -> get task registry for selected pipeline
3. Topological sort tasks (respect blockedBy)
4. Validate all owners exist in role registry (SKILL.md)
5. For each task (in order):
   - update_plan with structured description (see template below)
   - update_plan with blockedBy + owner assignment
6. Update team-session.json with pipeline.tasks_total
7. Validate chain (no orphans, no cycles, all refs valid)

## Task Description Template

```
PURPOSE: <goal> | Success: <criteria>
TASK:
  - <step 1>
  - <step 2>
CONTEXT:
  - Session: {run_dir}/work/team
  - Upstream artifacts: <list>
  - Key files: <list>
EXPECTED: <artifact path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: <true|false>
RoleSpec: ~  or <project>/.claude/skills/team-lifecycle-v4/roles/<role>/role.md
```

## InnerLoop Flag Rules

- true: Role has 2+ serial same-prefix tasks (writer: DRAFT-001->004)
- false: Role has 1 task, or tasks are parallel

## CHECKPOINT Task Rules

CHECKPOINT tasks are dispatched like regular tasks but handled differently at spawn time:

- Created via update_plan with proper blockedBy (upstream tasks that must complete first)
- Owner: supervisor
- **NOT spawned as team-worker** — coordinator wakes the resident supervisor via send_message
- If `supervision: false` in team-session.json, skip creating CHECKPOINT tasks entirely
- RoleSpec in description: `~  or <project>/.claude/skills/team-lifecycle-v4/roles/supervisor/role.md`

## Dependency Validation

- No orphan tasks (all tasks have valid owner)
- No circular dependencies
- All blockedBy references exist
- Session reference in every task description
- RoleSpec reference in every task description
