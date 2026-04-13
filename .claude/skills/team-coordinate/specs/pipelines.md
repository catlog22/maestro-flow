# Pipeline Definitions — Team Coordinate

## Dynamic Pipeline Model

team-coordinate does NOT have a static pipeline. All pipelines are generated at runtime from task-analysis.json based on the user's task description.

## Pipeline Generation Process

```
Phase 1: analyze-task.md
  -> Signal detection -> capability mapping -> dependency graph
  -> Output: task-analysis.json

Phase 2: dispatch.md
  -> Read task-analysis.json dependency graph
  -> Create TaskCreate entries per dependency node
  -> Set blockedBy chains from graph edges
  -> Output: TaskList with correct DAG

Phase 3-N: monitor.md
  -> handleSpawnNext: spawn ready tasks as team-worker agents
  -> handleCallback: mark completed, advance pipeline
  -> Repeat until all tasks done
```

## Dynamic Task Naming

| Capability | Prefix | Example |
|------------|--------|---------|
| researcher | RESEARCH | RESEARCH-001 |
| developer | IMPL | IMPL-001 |
| analyst | ANALYSIS | ANALYSIS-001 |
| designer | DESIGN | DESIGN-001 |
| tester | TEST | TEST-001 |
| writer | DRAFT | DRAFT-001 |
| planner | PLAN | PLAN-001 |
| (default) | TASK | TASK-001 |

## Dependency Graph Structure

task-analysis.json encodes the pipeline:

```json
{
  "dependency_graph": {
    "RESEARCH-001": { "role": "researcher", "blockedBy": [], "priority": "P0" },
    "IMPL-001":     { "role": "developer",  "blockedBy": ["RESEARCH-001"], "priority": "P1" },
    "TEST-001":     { "role": "tester",     "blockedBy": ["IMPL-001"], "priority": "P2" }
  }
}
```

## Role-Worker Map

Dynamic — loaded from session role-specs at runtime:

```
<session>/role-specs/<role-name>.md -> team-worker agent
```

Role-spec files contain YAML frontmatter:
```yaml
---
role: <role-name>
prefix: <PREFIX>
inner_loop: <true|false>
message_types:
  success: <type>
  error: error
---
```

## Checkpoint

| Trigger | Behavior |
|---------|----------|
| capability_gap reported | handleAdapt: generate new role-spec, spawn new worker |
| consensus_blocked HIGH | Create REVISION task or pause for user |
| All tasks complete | handleComplete: interactive completion action |

## Specs Reference

- [role-spec-template.md](role-spec-template.md) — Template for generating dynamic role-specs
- [quality-gates.md](quality-gates.md) — Quality thresholds and scoring dimensions
- [knowledge-transfer.md](knowledge-transfer.md) — Context transfer protocols between roles

## Quality Gate Integration

Dynamic pipelines reference quality thresholds from [specs/quality-gates.md](quality-gates.md).

| Gate Point | Trigger | Criteria Source |
|------------|---------|----------------|
| After artifact production | Producer role Phase 4 | Behavioral Traits in role-spec |
| After validation tasks | Tester/analyst completion | quality-gates.md thresholds |
| Pipeline completion | All tasks done | Aggregate scoring |

Issue classification: Error (blocks) > Warning (proceed with justification) > Info (log for future).
