

# Reduced Motion Accessibility

Implementation guidelines for `prefers-reduced-motion` compliance.

## Strategy

Wrap all motion in `@media` query, provide instant fallback. Users who prefer reduced motion should still perceive state changes but without disorienting movement.

## CSS Implementation

### Global Override

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Per-Component Override (Preferred)

```css
.card-enter {
  animation: fade-up var(--duration-slow) var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .card-enter {
    animation: fade-in 0.01ms linear both; /* opacity only, instant */
  }
}
```

### Parallax Disable

```css
.parallax-element {
  transform: translateY(calc(var(--scroll-y) * 0.5));
}

@media (prefers-reduced-motion: reduce) {
  .parallax-element {
    transform: none !important;
  }
}
```

## JavaScript Detection

```javascript
// Check preference
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Use in animation logic
if (prefersReducedMotion.matches) {
  // Skip parallax
  // Disable spring/bounce animations
  // Use instant transitions
  // Skip scroll-linked transforms
}

// Listen for changes (user toggles setting)
prefersReducedMotion.addEventListener('change', (event) => {
  if (event.matches) {
    disableMotion();
  } else {
    enableMotion();
  }
});
```

## Allowed in Reduced Motion

These subtle effects are acceptable and help maintain usability:

| Effect | Duration | Notes |
|--------|----------|-------|
| Opacity fades | < 0.15s | Short, non-directional |
| Color transitions | < 0.15s | Subtle state indicator |
| Essential state indicators | Instant | Focus rings, selection highlights |
| Progress indicators | N/A | Spinner -> static progress bar |

## Disallowed in Reduced Motion

These effects must be completely disabled:

| Effect | Reason | Fallback |
|--------|--------|----------|
| Parallax scrolling | Vestibular triggers | Static positioning |
| Scroll-linked transforms | Continuous motion | No transform |
| Bouncing/spring animations | Overshoot causes discomfort | Instant state change |
| Auto-playing content | Unexpected motion | Pause by default |
| Infinite loop animations | Continuous distraction | Single iteration or static |
| Large-scale movements | Disorienting | Opacity fade only |
| Zoom/scale animations | Vestibular triggers | Opacity fade |
| Rotating animations | Vestibular triggers | Static or opacity |

## Testing Checklist

| Check | Method | Expected |
|-------|--------|----------|
| `@media` query present | Grep CSS for `prefers-reduced-motion` | At least one global override |
| Duration override | Check `animation-duration` and `transition-duration` | Set to `0.01ms` |
| Scroll behavior | Check `scroll-behavior` | Set to `auto` |
| JS detection | Grep JS for `matchMedia.*reduced-motion` | Present with listener |
| Parallax disabled | Check parallax elements in reduced motion | `transform: none` |
| No infinite loops | Check `animation-iteration-count` | Set to `1` |
| No auto-play | Check auto-playing animations | Paused or removed |

## Implementation Order

1. Add global CSS override first (catches everything)
2. Add per-component overrides for nuanced fallbacks
3. Add JS detection for runtime animation control
4. Test with browser setting toggled ON
5. Verify no motion remains except allowed effects

## Browser Support

- `prefers-reduced-motion: reduce` -- supported in all modern browsers
- Safari 10.1+, Chrome 74+, Firefox 63+, Edge 79+
- iOS Safari 10.3+ (respects system Accessibility settings)
- Android Chrome 74+ (respects system Accessibility settings)
