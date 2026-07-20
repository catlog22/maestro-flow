# Analyze Task

## Signal Detection

| Keywords | Capability | Pipeline Hint |
|----------|------------|---------------|
| split, compare, before/after, slider, divider | split-compare | single |
| gallery, carousel, scroll-snap, horizontal scroll | scroll-snap-gallery | gallery |
| lightbox, modal, overlay, fullscreen view | lightbox | single |
| scroll reveal, appear on scroll, fade in, stagger | scroll-reveal | single or gallery |
| glass, terminal, frosted, blur, backdrop | glass-terminal | single |
| lens, magnify, zoom, loupe | lens-effect | single |
| drag, resize, pointer, touch | pointer-interaction | single |
| page, landing, sections, multi-section | interactive-page | page |
| multiple components, collection, set | multi-component | gallery or page |

## Scope Determination

| Signal | Pipeline Mode |
|--------|---------------|
| Single component mentioned | single |
| Gallery or scroll-based multi-component | gallery |
| Full interactive page or multi-section | page |
| Unclear | ask user |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single component | +1 |
| Gallery / scroll collection | +2 |
| Full interactive page | +3 |
| Pointer/drag interactions | +1 |
| Scroll-based triggers (IntersectionObserver) | +1 |
| Touch gestures (pinch, swipe) | +1 |
| Overlay/modal with focus trap | +1 |
| Animation choreography (stagger, sequence) | +1 |

Results: 1-2 Low (single), 3-4 Medium (gallery), 5+ High (page)

## Browser API Detection

| Keywords | Browser API |
|----------|-------------|
| scroll, appear, visibility, threshold | IntersectionObserver |
| resize, container, responsive, layout | ResizeObserver |
| drag, pointer, mouse, click | Pointer Events |
| touch, swipe, pinch, gesture | Touch Events |
| scroll snap, snap point, mandatory | CSS scroll-snap |
| clip, mask, reveal, wipe | CSS clip-path |
| blur, frosted, glass | CSS backdrop-filter |
| animate, transition, keyframe | Web Animations API |
| focus, trap, tab, keyboard | Focus Management |

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<single|gallery|page>",
  "scope": "<description>",
  "interaction_type": "<pointer|scroll|overlay|mixed>",
  "components": ["<detected-component-types>"],
  "browser_apis": ["<detected-apis>"],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
