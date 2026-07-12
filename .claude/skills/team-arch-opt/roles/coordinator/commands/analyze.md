# Analyze Task

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Parse user task -> detect architecture capabilities -> build dependency graph -> design roles.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| analyze, scan, audit, map, identify | analyzer | ANALYZE |
| design, plan, strategy, refactoring-plan | designer | DESIGN |
| refactor, implement, fix, apply | refactorer | REFACTOR |
| validate, build, test, verify, compile | validator | VALIDATE |
| review, audit-code, quality, check-code | reviewer | REVIEW |

## Dependency Graph

Natural ordering tiers:
- Tier 0: analyzer (knowledge gathering -- no dependencies)
- Tier 1: designer (requires analyzer output)
- Tier 2: refactorer (requires designer output)
- Tier 3: validator, reviewer (validation requires refactored artifacts, can run in parallel)

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per capability | +1 |
| Cross-domain refactoring | +2 |
| Parallel branches requested | +1 per branch |
| Serial depth > 3 | +1 |
| Multiple targets (independent mode) | +2 |

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
  "pipeline_type": "<single|fan-out|independent|auto>",
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>", "keywords": ["..."] }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "blockedBy": ["..."], "priority": "P0|P1|P2" } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "parallel_mode": "<auto|single|fan-out|independent>",
  "max_branches": 5
}
```
