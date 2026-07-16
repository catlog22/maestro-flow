# Analyze Task

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| explore, analyze, context, impact, understand | explorer | EXPLORE |
| plan, solve, design, solution, approach | planner | SOLVE |
| review, audit, validate, feasibility | reviewer | AUDIT |
| marshal, integrate, queue, conflict, order | integrator | MARSHAL |
| build, implement, execute, code, develop | implementer | BUILD |

## Dependency Graph

Natural ordering tiers:
- Tier 0: explorer (context analysis — no dependencies)
- Tier 1: planner (requires explorer output)
- Tier 2: reviewer (requires planner output, full/batch modes only)
- Tier 3: integrator (requires reviewer or planner output)
- Tier 4: implementer (requires integrator output)

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Issue count > 2 | +3 |
| Issue count > 4 | +2 more |
| Any high-priority issue (priority >= 4) | +2 |
| Multiple issue types / cross-cutting | +2 |
| Simple / single issue | -2 |

Results:
- 0-2: Low -> quick (4 tasks: EXPLORE → SOLVE → MARSHAL → BUILD)
- 3-4: Medium -> full (5 tasks: EXPLORE → SOLVE → AUDIT → MARSHAL → BUILD)
- 5+: High -> batch (N+N+1+1+M tasks, parallel exploration and implementation)

## Pipeline Selection

| Complexity | Pipeline | Tasks |
|------------|----------|-------|
| Low | quick | EXPLORE → SOLVE → MARSHAL → BUILD |
| Medium | full | EXPLORE → SOLVE → AUDIT → MARSHAL → BUILD |
| High | batch | EXPLORE-001..N (parallel) → SOLVE-001..N → AUDIT → MARSHAL → BUILD-001..M (parallel) |

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_type": "<quick|full|batch>",
  "issue_ids": ["<id1>", "<id2>"],
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>", "keywords": ["..."] }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "blockedBy": ["..."], "priority": "P0|P1|P2" } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "parallel_explorers": 1,
  "parallel_builders": 1
}
```
