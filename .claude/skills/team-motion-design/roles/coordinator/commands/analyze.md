
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

## Signal Detection

| Keywords | Capability | Pipeline Hint |
|----------|------------|---------------|
| easing, cubic-bezier, duration, timing | token system | tokens |
| scroll, parallax, reveal, stagger, intersection | scroll choreography | page |
| transition, hover, focus, state change | component animation | component |
| @keyframes, will-change, transform, opacity | animation implementation | component |
| page transition, route animation, full page | page-level motion | page |
| motion tokens, animation system, design system | token system | tokens |
| spring, bounce, overshoot | easing design | tokens |
| reduced-motion, prefers-reduced-motion, a11y | accessibility | component or tokens |

## Scope Determination

| Signal | Pipeline Mode |
|--------|---------------|
| Token/easing/duration system mentioned | tokens |
| Animate specific component(s) | component |
| Full page scroll choreography or page transitions | page |
| Unclear | ask user |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single easing/token system | +1 |
| Component animation | +2 |
| Full page choreography | +3 |
| Multiple scroll sections | +1 |
| Parallax effects | +1 |
| Reduced-motion required | +1 |
| Performance constraints mentioned | +1 |

Results: 1-2 Low (tokens), 3-4 Medium (component), 5+ High (page)

## Framework Detection

| Keywords | Framework |
|----------|-----------|
| react, jsx, tsx | React |
| vue, v-bind | Vue |
| svelte | Svelte |
| vanilla, plain js | Vanilla JS |
| css-only, pure css | CSS-only |
| Default | CSS + Vanilla JS |

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<tokens|component|page>",
  "scope": "<description>",
  "framework": "<detected-framework>",
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
