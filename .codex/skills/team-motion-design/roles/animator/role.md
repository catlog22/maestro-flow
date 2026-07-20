---
role: animator
prefix: ANIM
inner_loop: true
message_types: "[state_update]"
---

# Animation Implementer

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Motion tokens | {run_dir}/outputs/choreography/motion-tokens.json | Yes |
| Choreography sequences | {run_dir}/outputs/choreography/sequences/*.md | Yes (component/page) |
| Research artifacts | {run_dir}/outputs/research/*.json | Yes |
| GPU constraints | specs/gpu-constraints.md | Yes |
| Reduced motion spec | specs/reduced-motion.md | Yes |
| Performance report | {run_dir}/outputs/testing/reports/perf-report-*.md | Only for GC fix tasks |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Read motion tokens from choreography/motion-tokens.json
3. Read choreography sequences (if applicable) from choreography/sequences/*.md
4. Read research artifacts for existing animation context
5. Read GPU constraints and reduced motion specs
6. Detect task type from subject: "token" -> Token CSS, "section" -> Section animation, "fix" -> GC fix
7. If GC fix task: read latest performance report from {run_dir}/outputs/testing/reports/

## Phase 3: Implementation Execution

### Token CSS Implementation (ANIM-001 in tokens mode)

Generate CSS custom properties and utility classes:

**File: `{run_dir}/outputs/animations/keyframes/motion-tokens.css`**:
```css
:root {
  /* Easing functions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Duration scale */
  --duration-fast: 0.15s;
  --duration-base: 0.3s;
  --duration-slow: 0.6s;
  --duration-slower: 0.8s;
  --duration-slowest: 1.2s;

  /* Stagger */
  --stagger-increment: 0.05s;
}

/* Reduced motion overrides */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**File: `{run_dir}/outputs/animations/keyframes/utility-animations.css`**:
- `@keyframes fade-in` (opacity 0->1)
- `@keyframes fade-up` (opacity 0->1, translateY 20px->0)
- `@keyframes fade-down` (opacity 0->1, translateY -20px->0)
- `@keyframes slide-in-left` (translateX -100%->0)
- `@keyframes slide-in-right` (translateX 100%->0)
- `@keyframes scale-in` (scale 0.95->1, opacity 0->1)
- Utility classes: `.animate-fade-in`, `.animate-fade-up`, etc.
- All animations consume motion token custom properties
- All use compositor-only properties (transform, opacity)

### Component/Section Animation (ANIM-001..N in component/page mode)

For each section or component defined in choreography sequences:

**CSS @keyframes** (`{run_dir}/outputs/animations/keyframes/<name>.css`):
- Define @keyframes consuming motion tokens via `var(--ease-out)`, `var(--duration-slow)`
- Use `will-change: transform, opacity` on animated elements (remove after animation via JS)
- Only animate compositor-safe properties: transform (translate, scale, rotate), opacity, filter
- NEVER animate: width, height, top, left, margin, padding, border, color, background-color

**JS Orchestrator** (`{run_dir}/outputs/animations/orchestrators/<name>.js`):
```javascript
// IntersectionObserver-based scroll trigger
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target); // one-shot
    }
  });
}, { threshold: 0.2, rootMargin: '0px 0px -100px 0px' });

// Staggered animation orchestrator
function staggerReveal(container, itemSelector) {
  const items = container.querySelectorAll(itemSelector);
  const increment = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--stagger-increment')) || 0.05;

  items.forEach((item, index) => {
    item.style.transitionDelay = `${index * increment}s`;
  });
  // Trigger via IntersectionObserver on container
  observer.observe(container);
}

// Reduced motion detection
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (prefersReducedMotion.matches) {
  // Skip parallax, disable springs, use instant transitions
}

// requestAnimationFrame for scroll-linked effects (parallax)
function parallaxScroll(element, rate) {
  if (prefersReducedMotion.matches) return; // skip for reduced motion
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrolled = window.pageYOffset;
        element.style.transform = `translateY(${scrolled * rate}px)`;
        ticking = false;
      });
      ticking = true;
    }
  });
}
```

### Height Animation Workaround
Since `height` triggers layout (NEVER animate), use the grid trick:
```css
.expandable {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-normal) var(--ease-out-quart);
}
.expandable.open {
  grid-template-rows: 1fr;
}
.expandable > .content {
  overflow: hidden;
}
```
This achieves smooth height animation using only grid layout changes (compositor-friendly).

### Perceived Performance
- **80ms threshold**: Any response under 80ms feels instant to the human brain
- **Preemptive starts**: Begin animation on `pointerdown` not `click` (saves ~80-120ms perceived)
- **Early completion**: Visual feedback can "finish" before actual operation completes (optimistic UI)
- **Ease-in compresses perceived time**: Use ease-in for waiting states (progress bars) — makes them feel faster
- **Ease-out satisfies entrances**: Use ease-out for content appearing — natural deceleration feels "settled"

### GC Fix Mode (ANIM-fix-N)

- Parse performance report for specific issues
- Replace layout-triggering properties with compositor-only alternatives:
  - `width/height` -> `transform: scale()`
  - `top/left` -> `transform: translate()`
  - `background-color` -> `opacity` on overlay
- Reduce will-change elements to max 3-4 simultaneous
- Add missing prefers-reduced-motion overrides
- Signal `animation_revision` instead of `animation_ready`

## Phase 4: Self-Validation & Output

1. Animation integrity checks:

| Check | Pass Criteria |
|-------|---------------|
| no_layout_triggers | No width, height, top, left, margin, padding in @keyframes |
| will_change_budget | Max 3-4 elements with will-change simultaneously |
| reduced_motion | @media (prefers-reduced-motion: reduce) query present |
| token_consumption | Animations use var(--token) references, no hardcoded values |
| compositor_only | Only transform, opacity, filter in animation properties |

2. JS orchestrator checks:

| Check | Pass Criteria |
|-------|---------------|
| intersection_observer | IntersectionObserver used for scroll triggers (not scroll events) |
| raf_throttled | requestAnimationFrame used with ticking guard for scroll |
| reduced_motion_js | `matchMedia('(prefers-reduced-motion: reduce)')` check present |
| cleanup | will-change removed after animation completes (if applicable) |

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `animator` namespace:
   - Read existing -> merge `{ "animator": { task_type, keyframe_count, orchestrator_count, uses_intersection_observer, has_parallax, has_stagger } }` -> write back
