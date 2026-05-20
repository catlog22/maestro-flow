# Analyze Task

Parse user task -> detect QA capabilities -> build dependency graph -> design roles.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| scan, discover, find issues, audit | scout | SCOUT |
| strategy, plan, test layers, coverage | strategist | QASTRAT |
| generate tests, write tests, create tests | generator | QAGEN |
| run tests, execute, fix tests | executor | QARUN |
| analyze, report, quality score | analyst | QAANA |

## QA Mode Detection

| Condition | Mode |
|-----------|------|
| Keywords: discovery, scan, issues, bug-finding | discovery |
| Keywords: test, coverage, TDD, unit, integration | testing |
| Both keyword types OR no clear match | full |

## Dependency Graph

Natural ordering tiers for QA pipeline:
- Tier 0: scout (issue discovery)
- Tier 1: strategist (strategy requires scout discoveries)
- Tier 2: generator (generation requires strategy)
- Tier 3: executor (execution requires generated tests)
- Tier 4: analyst (analysis requires execution results)

## Pipeline Definitions

```
Discovery Mode: SCOUT -> QASTRAT -> QAGEN(L1) -> QARUN(L1) -> QAANA
Testing Mode: QASTRAT -> QAGEN(L1) -> QARUN(L1) -> QAGEN(L2) -> QARUN(L2) -> QAANA
Full Mode: SCOUT -> QASTRAT -> [QAGEN(L1) || QAGEN(L2)] -> [QARUN(L1) || QARUN(L2)] -> QAANA -> SCOUT(regression)
```

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per capability | +1 |
| Cross-domain (test + discovery) | +2 |
| Parallel tracks | +1 per track |
| Serial depth > 3 | +1 |

Results: 1-3 Low, 4-6 Medium, 7+ High

## Role Minimization

- Cap at 6 roles (coordinator + 5 workers)
- Merge overlapping capabilities
- Absorb trivial single-step roles

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_mode": "<discovery|testing|full>",
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>", "keywords": ["..."] }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "addBlockedBy": ["..."], "priority": "P0|P1|P2" } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "gc_loop_enabled": true
}
```
