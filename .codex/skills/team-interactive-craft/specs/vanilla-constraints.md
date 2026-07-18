

# Vanilla Constraints

Zero-dependency rules for all interactive components built by this team. These constraints are non-negotiable and apply to every BUILD task output.

## Dependency Rules

| Rule | Requirement |
|------|-------------|
| No npm packages | Zero `import` from node_modules or CDN URLs |
| No build tools required | Components run directly via `<script type="module">` |
| No framework dependency | No React, Vue, Svelte, Angular, jQuery, etc. |
| No CSS preprocessor | No Sass, Less, PostCSS, Tailwind -- pure CSS only |
| No bundler required | No webpack, Vite, Rollup, esbuild in critical path |

## JavaScript Rules

| Rule | Requirement |
|------|-------------|
| ES modules only | `export class`, `export function`, `import` syntax |
| Class-based components | Private fields (#), constructor(element, options) |
| No inline styles from JS | Set CSS custom properties or toggle CSS classes |
| No document.write | Use DOM APIs (createElement, append, etc.) |
| No eval or innerHTML | Use textContent or DOM construction |
| requestAnimationFrame | All animation loops use rAF, not setInterval |
| Pointer Events primary | Use pointer events; touch events as fallback only |
| Cleanup required | destroy() method disconnects all observers/listeners |
| Auto-init pattern | `document.querySelectorAll('[data-component]')` on load |

## CSS Rules

| Rule | Requirement |
|------|-------------|
| Custom properties | All configurable values as CSS custom properties |
| No inline styles | JS sets `--custom-prop` values, not style.left/top |
| State via data attributes | `[data-state="active"]`, not inline style changes |
| GPU-only animations | `transform` and `opacity` ONLY in transitions/animations |
| No layout animations | Never animate `width`, `height`, `top`, `left`, `margin`, `padding` |
| will-change on animated | Hint browser for animated elements |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` with instant fallback |
| focus-visible | `:focus-visible` for keyboard-only focus indicators |
| Responsive | Min touch target 44x44px on mobile, use @media breakpoints |

## Progressive Enhancement

| Rule | Requirement |
|------|-------------|
| Content without JS | Base content visible and readable without JavaScript |
| CSS-only fallback | Essential layout works with CSS alone |
| No-JS class | Optional `[data-js-enabled]` class for JS-enhanced styles |
| Semantic HTML base | Use appropriate elements (button, a, nav, dialog) |

## Performance Budget

| Metric | Budget |
|--------|--------|
| Frame time | < 5ms per frame (leaves room for browser work in 16ms budget) |
| Interaction response | < 50ms from input to visual feedback |
| Animation jank | 0 frames dropped at 60fps for GPU-composited animations |
| Observer callbacks | < 1ms per IntersectionObserver/ResizeObserver callback |
| Component init | < 100ms from constructor to interactive |
| Memory | No detached DOM nodes after destroy() |
| Listeners | All removed in destroy(), no orphaned listeners |

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| `element.style.left = ...` | Forces layout recalc, not GPU composited |
| `element.offsetWidth` in animation loop | Forces synchronous layout (reflow) |
| `setInterval` for animation | Not synced to display refresh rate |
| `setTimeout` for animation | Not synced to display refresh rate |
| `innerHTML = userContent` | XSS vector |
| Passive: false on scroll/touch without need | Blocks scrolling performance |
| `!important` in component CSS | Breaks cascade, unmaintainable |
| Global CSS selectors (tag-only) | Leaks styles outside component scope |

## File Output Convention

| File | Purpose | Location |
|------|---------|----------|
| `{name}.js` | ES module component class | `{run_dir}/outputs/build/components/` |
| `{name}.css` | Component styles with custom properties | `{run_dir}/outputs/build/components/` |
| `demo.html` | Optional: standalone demo page | `{run_dir}/outputs/build/components/` |
