# Analyze Task

## Signal Detection

| Keywords | Dimension | Priority |
|----------|-----------|----------|
| AI slop, generic, templated, looks like AI | Anti-Patterns | P0 |
| color, palette, contrast, OKLCH, dark mode, theme | Color Quality | P1 |
| font, typography, heading, text size, type scale | Typography | P1 |
| spacing, padding, margin, rhythm, gap, grid | Spacing/Layout | P1 |
| animation, transition, motion, easing, animate | Motion | P2 |
| hover, focus, active, disabled, states, interaction | Interaction States | P2 |
| hierarchy, visual weight, composition, squint | Visual Hierarchy | P2 |
| responsive, mobile, breakpoint, viewport | Responsive | P2 |

## Scope Determination

| Signal | Pipeline Mode |
|--------|---------------|
| "scan", "audit", "check", "report", "analyze", "review" | scan-only |
| "fix color", "fix typography", specific dimension keyword | targeted |
| "polish", "fix all", "full", "improve", "clean up", "redesign" | full |
| Unclear | ask user |

## Dimension Filter (targeted mode only)

When targeted mode detected, extract which dimensions to focus on:

| Keywords | Dimension Filter |
|----------|-----------------|
| AI slop, generic | anti_patterns |
| color, palette, contrast | color |
| font, typography, type | typography |
| spacing, layout, grid | spacing |
| animation, motion | motion |
| hover, focus, states | interaction |
| hierarchy, visual weight | hierarchy |
| responsive, mobile | responsive |

## Target Detection

| Signal | Target Type |
|--------|-------------|
| URL provided (http/https) | url |
| File path provided (.tsx, .css, .html) | component |
| "all", "full site", "entire", "everything" | full_site |
| Directory path | directory |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single component / single URL | +1 |
| Multiple components | +2 |
| Full site | +3 |
| Multiple dimensions targeted | +1 |
| Chrome DevTools required | +1 |
| Responsive checks needed | +1 |

Results: 1-2 Low (scan-only), 3-4 Medium (targeted), 5+ High (full)

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<scan-only|targeted|full>",
  "target": "<url|component-path|full_site>",
  "target_type": "<url|component|directory|full_site>",
  "dimension_filters": ["<dimension-names or empty for all>"],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
