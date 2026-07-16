# Analyze Task

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
