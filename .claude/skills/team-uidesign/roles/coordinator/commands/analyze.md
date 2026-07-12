# Analyze Task

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Parse user task -> detect UI design scope -> build dependency graph -> design pipeline mode.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Pipeline Hint |
|----------|------------|---------------|
| component, button, card, input, modal | component | component |
| design system, token, theme | system | system |
| complete, full, all components, redesign | full | full-system |
| accessibility, a11y, wcag | accessibility | component or system |
| implement, build, code | implementation | component |

## Scope Determination

| Signal | Pipeline Mode |
|--------|---------------|
| Single component mentioned | component |
| Multiple components or "design system" | system |
| "Full design system" or "complete redesign" | full-system |
| Unclear | ask user |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single component | +1 |
| Component system | +2 |
| Full design system | +3 |
| Accessibility required | +1 |
| Multiple industries/constraints | +1 |

Results: 1-2 Low (component), 3-4 Medium (system), 5+ High (full-system)

## Industry Detection

| Keywords | Industry |
|----------|----------|
| saas, dashboard, analytics | SaaS/Tech |
| shop, cart, checkout, e-commerce | E-commerce |
| medical, patient, healthcare | Healthcare |
| bank, finance, payment | Finance |
| edu, course, learning | Education/Content |
| Default | SaaS/Tech |

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<component|system|full-system>",
  "scope": "<description>",
  "industry": "<detected-industry>",
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
