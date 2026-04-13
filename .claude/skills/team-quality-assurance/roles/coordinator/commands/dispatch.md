# Dispatch Tasks

Create task chains from dependency graph with proper addBlockedBy relationships.

## Workflow

1. Read task-analysis.json -> extract pipeline_mode and dependency_graph
2. Read specs/pipelines.md -> get task registry for selected pipeline
3. Topological sort tasks (respect addBlockedBy)
4. Validate all owners exist in role registry (SKILL.md)
5. For each task (in order):
   - TaskCreate with structured description (see template below)
   - TaskUpdate with addBlockedBy + owner assignment
6. Update session.json with pipeline.tasks_total
7. Validate chain (no orphans, no cycles, all refs valid)

## Task Description Template

```
PURPOSE: <goal> | Success: <criteria>
TASK:
  - <step 1>
  - <step 2>
CONTEXT:
  - Session: <session-folder>
  - Layer: <L1-unit|L2-integration|L3-e2e> (if applicable)
  - Upstream artifacts: <list>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <artifact path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: <true|false>
RoleSpec: ~  or <project>/.claude/skills/team-quality-assurance/roles/<role>/role.md
```

## Pipeline Task Registry

### Discovery Mode
```
SCOUT-001 (scout): Multi-perspective issue scanning
  addBlockedBy: []
QASTRAT-001 (strategist): Test strategy formulation
  addBlockedBy: [SCOUT-001]
QAGEN-001 (generator): L1 unit test generation
  addBlockedBy: [QASTRAT-001], meta: layer=L1
QARUN-001 (executor): L1 test execution + fix cycles
  addBlockedBy: [QAGEN-001], inner_loop: true, meta: layer=L1
QAANA-001 (analyst): Quality analysis report
  addBlockedBy: [QARUN-001]
```

### Testing Mode
```
QASTRAT-001 (strategist): Test strategy formulation
  addBlockedBy: []
QAGEN-L1-001 (generator): L1 unit test generation
  addBlockedBy: [QASTRAT-001], meta: layer=L1
QARUN-L1-001 (executor): L1 test execution + fix cycles
  addBlockedBy: [QAGEN-L1-001], inner_loop: true, meta: layer=L1
QAGEN-L2-001 (generator): L2 integration test generation
  addBlockedBy: [QARUN-L1-001], meta: layer=L2
QARUN-L2-001 (executor): L2 test execution + fix cycles
  addBlockedBy: [QAGEN-L2-001], inner_loop: true, meta: layer=L2
QAANA-001 (analyst): Quality analysis report
  addBlockedBy: [QARUN-L2-001]
```

### Full Mode
```
SCOUT-001 (scout): Multi-perspective issue scanning
  addBlockedBy: []
QASTRAT-001 (strategist): Test strategy formulation
  addBlockedBy: [SCOUT-001]
QAGEN-L1-001 (generator-1): L1 unit test generation
  addBlockedBy: [QASTRAT-001], meta: layer=L1
QAGEN-L2-001 (generator-2): L2 integration test generation
  addBlockedBy: [QASTRAT-001], meta: layer=L2
QARUN-L1-001 (executor-1): L1 test execution + fix cycles
  addBlockedBy: [QAGEN-L1-001], inner_loop: true, meta: layer=L1
QARUN-L2-001 (executor-2): L2 test execution + fix cycles
  addBlockedBy: [QAGEN-L2-001], inner_loop: true, meta: layer=L2
QAANA-001 (analyst): Quality analysis report
  addBlockedBy: [QARUN-L1-001, QARUN-L2-001]
SCOUT-002 (scout): Regression scan after fixes
  addBlockedBy: [QAANA-001]
```

## InnerLoop Flag Rules

- true: executor roles (run-fix cycles)
- false: scout, strategist, generator, analyst roles

## Dependency Validation

- No orphan tasks (all tasks have valid owner)
- No circular dependencies
- All addBlockedBy references exist
- Session reference in every task description
- RoleSpec reference in every task description

## Log After Creation

```
mcp__ccw-tools__team_msg({
  operation: "log",
  session_id: <session-id>,
  from: "coordinator",
  type: "pipeline_selected",
  data: { pipeline: "<mode>", task_count: <N> }
})
```
