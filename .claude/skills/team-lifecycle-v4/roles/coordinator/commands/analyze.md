# Analyze Task

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Parse user task -> detect capabilities -> build dependency graph -> design roles.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| investigate, explore, research | analyst | RESEARCH |
| write, draft, document | writer | DRAFT |
| implement, build, code, fix | executor | IMPL |
| design, architect, plan | planner | PLAN |
| test, verify, validate | tester | TEST |
| analyze, review, audit | reviewer | REVIEW |

## Dependency Graph

Natural ordering tiers:
- Tier 0: analyst, planner (knowledge gathering)
- Tier 1: writer (creation requires context)
- Tier 2: executor (implementation requires plan/design)
- Tier 3: tester, reviewer (validation requires artifacts)

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per capability | +1 |
| Cross-domain | +2 |
| Parallel tracks | +1 per track |
| Serial depth > 3 | +1 |

Results: 1-3 Low, 4-6 Medium, 7+ High

## Role Minimization

- Cap at 5 roles
- Merge overlapping capabilities
- Absorb trivial single-step roles

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_type": "<spec-only|impl-only|full-lifecycle|...>",
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>", "keywords": ["..."] }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "blockedBy": ["..."], "priority": "P0|P1|P2" } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "needs_research": true
}
```
