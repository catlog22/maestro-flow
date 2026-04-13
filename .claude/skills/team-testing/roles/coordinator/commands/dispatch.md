# Dispatch Tasks

Create testing task chains with correct dependencies. Supports targeted, standard, and comprehensive pipelines.

## Workflow

1. Read task-analysis.json -> extract pipeline_mode and dependency_graph
2. Read specs/pipelines.md -> get task registry for selected pipeline
3. Topological sort tasks (respect blockedBy)
4. Validate all owners exist in role registry (SKILL.md)
5. For each task (in order):
   - TaskCreate with structured description (see template below)
   - TaskUpdate with blockedBy + owner assignment
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
  - Scope: <scope>
  - Layer: <L1-unit|L2-integration|L3-e2e>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>
---
InnerLoop: <true|false>
RoleSpec: ~  or <project>/.claude/skills/team-testing/roles/<role>/role.md
```

## Pipeline Task Registry

### Targeted Pipeline
```
STRATEGY-001 (strategist): Analyze change scope, define test strategy
  blockedBy: []
TESTGEN-001 (generator): Generate L1 unit tests
  blockedBy: [STRATEGY-001], meta: layer=L1-unit
TESTRUN-001 (executor): Execute L1 tests, collect coverage
  blockedBy: [TESTGEN-001], inner_loop: true, meta: layer=L1-unit, coverage_target=80%
```

### Standard Pipeline
```
STRATEGY-001 (strategist): Analyze change scope, define test strategy
  blockedBy: []
TESTGEN-001 (generator): Generate L1 unit tests
  blockedBy: [STRATEGY-001], meta: layer=L1-unit
TESTRUN-001 (executor): Execute L1 tests, collect coverage
  blockedBy: [TESTGEN-001], inner_loop: true, meta: layer=L1-unit, coverage_target=80%
TESTGEN-002 (generator): Generate L2 integration tests
  blockedBy: [TESTRUN-001], meta: layer=L2-integration
TESTRUN-002 (executor): Execute L2 tests, collect coverage
  blockedBy: [TESTGEN-002], inner_loop: true, meta: layer=L2-integration, coverage_target=60%
TESTANA-001 (analyst): Defect pattern analysis, quality report
  blockedBy: [TESTRUN-002]
```

### Comprehensive Pipeline
```
STRATEGY-001 (strategist): Analyze change scope, define test strategy
  blockedBy: []
TESTGEN-001 (generator-1): Generate L1 unit tests
  blockedBy: [STRATEGY-001], meta: layer=L1-unit
TESTGEN-002 (generator-2): Generate L2 integration tests
  blockedBy: [STRATEGY-001], meta: layer=L2-integration
TESTRUN-001 (executor-1): Execute L1 tests, collect coverage
  blockedBy: [TESTGEN-001], inner_loop: true, meta: layer=L1-unit, coverage_target=80%
TESTRUN-002 (executor-2): Execute L2 tests, collect coverage
  blockedBy: [TESTGEN-002], inner_loop: true, meta: layer=L2-integration, coverage_target=60%
TESTGEN-003 (generator): Generate L3 E2E tests
  blockedBy: [TESTRUN-001, TESTRUN-002], meta: layer=L3-e2e
TESTRUN-003 (executor): Execute L3 tests, collect coverage
  blockedBy: [TESTGEN-003], inner_loop: true, meta: layer=L3-e2e, coverage_target=40%
TESTANA-001 (analyst): Defect pattern analysis, quality report
  blockedBy: [TESTRUN-003]
```

## InnerLoop Flag Rules

- true: generator, executor roles (GC loop iterations)
- false: strategist, analyst roles

## Dependency Validation

- No orphan tasks (all tasks have valid owner)
- No circular dependencies
- All blockedBy references exist
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
