# Analyze Task

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Parse frontend task -> detect capabilities -> assess pipeline complexity -> design roles.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Role |
|----------|------------|------|
| analyze, requirements, design intelligence | analyst | analyst |
| design tokens, component architecture, design system | architect | architect |
| implement, build, code, develop, page, component | developer | developer |
| review, audit, quality, test, accessibility | qa | qa |

## Pipeline Selection

| Scope Signal | Pipeline |
|--------------|----------|
| single page, landing, simple | page (4-beat) |
| feature, multi-component, complex | feature (5-beat with arch review gate) |
| full system, design system, multiple pages | system (7-beat dual-track) |

Default to `feature` if ambiguous.

## Complexity Scoring

| Factor | Points |
|--------|--------|
| ui-ux-pro-max integration needed | +1 |
| Existing design system detected | +1 |
| Accessibility strict mode (healthcare/finance) | +2 |
| Multiple tech stacks | +2 |
| Dark mode required | +1 |

Results: 1-2 page, 3-4 feature, 5+ system

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_type": "<page|feature|system>",
  "capabilities": [{ "name": "<cap>", "role": "<role>", "keywords": ["..."] }],
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "industry": "<industry>",
  "constraints": [],
  "needs_ui_ux_pro_max": true
}
```
