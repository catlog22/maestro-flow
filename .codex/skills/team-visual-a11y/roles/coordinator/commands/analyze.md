
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

## Signal Detection

| Keywords | Capability | Pipeline Hint |
|----------|------------|---------------|
| color, contrast, oklch, palette, hue | color audit | audit-only or full |
| typography, font, line-height, clamp, readability | typography audit | audit-only or full |
| focus, tab, keyboard, aria, skip-link, focus-visible | focus audit | audit-only or full |
| wcag, a11y, accessibility, compliance | full audit | audit-only or full |
| fix, remediate, implement, correct | fix cycle | full |
| audit only, assessment, review, check | audit only | audit-only |

## Target Detection

| Signal | Target Type |
|--------|-------------|
| URL (http/https) | rendered-page |
| File path (.tsx, .vue, .html, .css) | component-source |
| "full site", "all pages", "entire app" | full-site |
| Component name without path | component-source (search needed) |
| Unclear | ask user |

## Mode Determination

| Signal | Pipeline Mode |
|--------|---------------|
| "audit only", "no fixes", "assessment", "review" | audit-only |
| "full", "fix", "remediate", "complete cycle" | full |
| Single audit domain (color OR typography OR focus only) | audit-only |
| Unclear | ask user |

## WCAG Level Detection

| Signal | Level |
|--------|-------|
| "AA" or default | AA |
| "AAA", "enhanced", "strict" | AAA |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single component | +1 |
| Multiple components | +2 |
| Full site | +3 |
| Rendered page (Chrome DevTools) | +1 |
| AAA level requested | +1 |
| Fix cycle included | +1 |

Results: 1-2 Low, 3-4 Medium, 5+ High

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<audit-only|full>",
  "target": {
    "type": "<rendered-page|component-source|full-site>",
    "value": "<URL or file path or 'all'>"
  },
  "wcag_level": "<AA|AAA>",
  "scope": "<description>",
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "chrome_devtools": true
}
```
