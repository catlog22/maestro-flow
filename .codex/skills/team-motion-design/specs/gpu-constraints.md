

# GPU Constraints

Compositor-only animation rules for 60fps performance.

## Property Classification

### SAFE Properties (Compositor Thread, No Repaint)

These properties are handled by the GPU compositor thread and do not trigger layout or paint:

| Property | Examples | Notes |
|----------|---------|-------|
| `transform` | `translate()`, `scale()`, `rotate()`, `skew()` | Primary animation property |
| `opacity` | `0` to `1` | Cheap compositor operation |
| `filter` | `blur()`, `brightness()`, `contrast()`, `saturate()` | GPU-accelerated in modern browsers |
| `backdrop-filter` | `blur()`, `brightness()` | Composited separately |

### UNSAFE Properties (Trigger Layout/Paint)

**NEVER animate these properties** -- they force layout recalculation and/or paint:

| Property | Impact | Alternative |
|----------|--------|-------------|
| `width` | Layout | `transform: scaleX()` |
| `height` | Layout | `transform: scaleY()` |
| `top` | Layout | `transform: translateY()` |
| `left` | Layout | `transform: translateX()` |
| `right` | Layout | `transform: translateX()` (negative) |
| `bottom` | Layout | `transform: translateY()` (negative) |
| `margin` | Layout | `transform: translate()` |
| `padding` | Layout | Use inner element with transform |
| `border` | Layout + Paint | `outline` (no layout) or `box-shadow` |
| `font-size` | Layout | `transform: scale()` |
| `color` | Paint | Overlay with `opacity` |
| `background-color` | Paint | Overlay element with `opacity` |
| `box-shadow` | Paint | Use `filter: drop-shadow()` or pre-rendered layers |

## will-change Budget

### Rules

1. **Max 3-4 elements** with `will-change` simultaneously
2. **Remove after animation completes** -- do not leave permanent will-change
3. **Never use `will-change: auto`** on collections or many elements
4. **Explicit properties only**: `will-change: transform` or `will-change: opacity`, not `will-change: all`

### Implementation Pattern

```css
/* Static: no will-change */
.element {
  transition: transform var(--duration-base) var(--ease-out);
}

/* Add will-change just before animation via JS */
.element.will-animate {
  will-change: transform;
}

/* Or via CSS for hover-triggered animations */
.element:hover {
  will-change: transform;
}
```

```javascript
// JS: add before, remove after
element.style.willChange = 'transform';
element.addEventListener('transitionend', () => {
  element.style.willChange = 'auto';
}, { once: true });
```

### Layer Promotion

- `transform: translateZ(0)` or `will-change: transform` promotes to own compositor layer
- Each layer costs GPU memory (~width * height * 4 bytes)
- Avoid promoting too many layers -- profile with Chrome DevTools Layers panel
- Use sparingly: hero elements, frequently animated elements, scroll-linked elements

## Performance Targets

| Metric | Target | Budget |
|--------|--------|--------|
| Frame rate | 60fps | 16.67ms per frame |
| Style + Layout | < 5ms | ~30% of frame budget |
| Paint + Composite | < 5ms | ~30% of frame budget |
| JavaScript | < 5ms | ~30% of frame budget |
| Idle buffer | ~1.67ms | Headroom for GC, etc. |

## Measurement

### Chrome DevTools Performance Panel
1. Record performance trace during animation
2. Check "Frames" section for frame drops (red/yellow bars)
3. Check "Main" thread for long tasks during animation
4. Check "Compositor" thread for smooth operation
5. Look for "Layout" and "Paint" events during animation (should be minimal)

### Key Indicators of Problems
- Purple "Layout" bars during animation = layout-triggering property
- Green "Paint" bars during animation = paint-triggering property
- Red frame markers = dropped frames (>16.67ms)
- "Forced reflow" warnings = layout thrashing in JS

## Quick Reference Card

```
ANIMATE:  transform, opacity, filter
AVOID:    width, height, top, left, margin, padding, color, background-color
BUDGET:   will-change on max 3-4 elements, remove after use
TARGET:   60fps = 16.67ms per frame
MEASURE:  Chrome DevTools Performance panel
```
