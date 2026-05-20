# Dispatch Tasks

Create task chains from pipeline mode with proper blockedBy relationships.

## Workflow

1. Read task-analysis.json -> extract pipeline_mode and parameters
2. Read specs/pipelines.md -> get task registry for selected pipeline
3. Topological sort tasks (respect blockedBy)
4. Validate all owners exist in role registry (SKILL.md)
5. For each task (in order):
   - TaskCreate with structured description (see template below)
   - TaskUpdate with blockedBy + owner assignment
6. Update session meta.json with pipeline.tasks_total
7. Validate chain (no orphans, no cycles, all refs valid)

## Task Description Template

```
PURPOSE: <goal> | Success: <criteria>
TASK:
  - <step 1>
  - <step 2>
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - Dimensions: <dimensions>
  - Upstream artifacts: <list>
EXPECTED: <artifact path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: <true|false>
RoleSpec: ~  or <project>/.claude/skills/team-review/roles/<role>/role.md
```

## Pipeline Task Registry

### default Mode
```
SCAN-001 (scanner): Multi-dimension code scan
  blockedBy: [], meta: target=<target>, dimensions=<dims>
REV-001 (reviewer): Deep finding analysis and review
  blockedBy: [SCAN-001]
```

### full Mode
```
SCAN-001 (scanner): Multi-dimension code scan
  blockedBy: [], meta: target=<target>, dimensions=<dims>
REV-001 (reviewer): Deep finding analysis and review
  blockedBy: [SCAN-001]
FIX-001 (fixer): Plan and execute fixes
  blockedBy: [REV-001]
```

### fix-only Mode
```
FIX-001 (fixer): Execute fixes from manifest
  blockedBy: [], meta: input=<fix-manifest>
```

### quick Mode
```
SCAN-001 (scanner): Quick scan (fast mode)
  blockedBy: [], meta: target=<target>, quick=true
```

## InnerLoop Flag Rules

- true: fixer role (iterative fix cycles)
- false: scanner, reviewer roles

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
  type: "dispatch_ready",
  data: { pipeline: "<mode>", task_count: <N>, target: "<target>" }
})
```
