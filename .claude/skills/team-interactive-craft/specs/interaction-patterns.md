

# Interaction Pattern Catalog

Reference patterns for common interactive components. Each pattern defines the core interaction model, browser APIs, state machine, animation approach, and accessibility requirements.

---

## Glass Terminal Pattern

Split-view layout with frosted glass effect, tab navigation, and command input simulation.

**Core Interaction**:
- Tab-based view switching (2-4 panels)
- Command input field with syntax-highlighted output
- Frosted glass background via `backdrop-filter: blur()`
- Resize-aware layout via ResizeObserver

**State Machine**:
```
[idle] --(tab-click)--> [switching]
[switching] --(transition-end)--> [idle]
[idle] --(input-focus)--> [input-active]
[input-active] --(Enter)--> [processing]
[processing] --(output-ready)--> [idle]
[input-active] --(Escape)--> [idle]
```

**Browser APIs**: ResizeObserver, CSS backdrop-filter, CSS custom properties

**Animation**:
- Tab switch: opacity crossfade (200ms, ease-out), GPU-only
- Output appear: translateY(10px)->0 + opacity (300ms, ease-out)
- Cursor blink: CSS animation (1s steps(2))

**CSS Key Properties**:
```css
.glass-terminal {
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```

**Accessibility**:
- role="tablist" + role="tab" + role="tabpanel"
- aria-selected on active tab
- Arrow keys navigate tabs, Enter/Space activates
- Input field: role="textbox", aria-label
- Output: aria-live="polite" for new content

---

## Split Compare Pattern

Before/after overlay with draggable divider for visual comparison.

**Core Interaction**:
- Draggable vertical divider splits two overlapping images/views
- Pointer events for drag with Lerp interpolation (speed: 0.15)
- clip-path animation reveals before/after content
- Touch-friendly with full pointer event support

**State Machine**:
```
[idle] --(pointerenter)--> [hover]
[hover] --(pointerdown on divider)--> [dragging]
[hover] --(pointerleave)--> [idle]
[dragging] --(pointermove)--> [dragging] (update position)
[dragging] --(pointerup)--> [settling]
[settling] --(lerp-complete)--> [idle]
[any] --(focus + ArrowLeft/Right)--> [keyboard-adjusting]
[keyboard-adjusting] --(keyup)--> [idle]
```

**Browser APIs**: Pointer Events, CSS clip-path, ResizeObserver, requestAnimationFrame

**Animation**:
- Divider follow: Lerp `current += (target - current) * 0.15` per frame
- Clip-path update: `clip-path: inset(0 0 0 ${position}%)` on after layer
- Settle: natural Lerp deceleration to final position
- Hover hint: divider scale(1.1) + glow (200ms, ease-out)

**CSS Key Properties**:
```css
.split-compare__after {
  clip-path: inset(0 0 0 var(--split-position, 50%));
  transition: none; /* JS-driven via lerp */
}
.split-compare__divider {
  cursor: col-resize;
  touch-action: none; /* prevent scroll during drag */
}
```

**Keyboard**:
- Tab to divider element (tabindex="0")
- ArrowLeft/ArrowRight: move divider 2% per keypress
- Home/End: move to 0%/100%

**Accessibility**:
- role="slider", aria-valuenow, aria-valuemin="0", aria-valuemax="100"
- aria-label="Image comparison slider"
- Keyboard step: 2%, large step (PageUp/PageDown): 10%

---

## Scroll-Snap Gallery Pattern

Horizontal scroll with CSS scroll-snap, navigation controls, and active item detection.

**Core Interaction**:
- CSS scroll-snap-type: x mandatory on container
- scroll-snap-align: start on children
- Touch-friendly: native momentum scrolling
- Navigation dots/arrows update with IntersectionObserver
- Keyboard: ArrowLeft/ArrowRight navigate between items

**State Machine**:
```
[idle] --(scroll-start)--> [scrolling]
[scrolling] --(scroll-end)--> [snapped]
[snapped] --(intersection-change)--> [idle] (update active)
[idle] --(arrow-click)--> [navigating]
[navigating] --(scrollTo-complete)--> [idle]
[idle] --(keyboard-arrow)--> [navigating]
```

**Browser APIs**: CSS scroll-snap, IntersectionObserver, Element.scrollTo(), Pointer Events

**Animation**:
- Scroll: native CSS scroll-snap (browser-handled, smooth)
- Active dot: scale(1) -> scale(1.3) + opacity change (200ms, ease-out)
- Item entry: opacity 0->1 as intersection threshold crossed (CSS transition)
- Arrow hover: translateX(+-2px) (150ms, ease-out)

**CSS Key Properties**:
```css
.gallery__track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none; /* Firefox */
}
.gallery__track::-webkit-scrollbar { display: none; }
.gallery__item {
  scroll-snap-align: start;
  flex: 0 0 100%; /* or 80% for peek */
}
```

**IntersectionObserver Config**:
```javascript
new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) updateActiveItem(entry.target);
  });
}, { root: trackElement, threshold: 0.5 });
```

**Accessibility**:
- role="region", aria-label="Image gallery"
- role="group" on each item, aria-roledescription="slide"
- aria-label="Slide N of M" on each item
- Navigation: role="tablist" on dots, role="tab" on each dot
- ArrowLeft/ArrowRight between items, Home/End to first/last

---

## Scroll Reveal Pattern

Elements animate into view as user scrolls, using IntersectionObserver with staggered delays.

**Core Interaction**:
- IntersectionObserver with threshold: 0.1 triggers entry animation
- data-reveal attribute marks revealable elements
- Staggered delay: index * 80ms for grouped items
- GPU-only: translateY(20px)->0 + opacity 0->1
- One-shot: element stays visible after reveal

**State Machine**:
```
[hidden] --(intersection: entering)--> [revealing]
[revealing] --(animation-end)--> [visible]
[visible] -- (terminal state, no transition out)
```

**Browser APIs**: IntersectionObserver, CSS transitions, requestAnimationFrame

**Animation**:
- Entry: translateY(20px) -> translateY(0) + opacity 0->1
- Duration: 400ms
- Easing: cubic-bezier(0.16, 1, 0.3, 1)
- Stagger: CSS custom property `--reveal-delay: calc(var(--reveal-index) * 80ms)`
- Reduced motion: opacity-only crossfade (200ms)

**CSS Key Properties**:
```css
[data-reveal] {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 400ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: var(--reveal-delay, 0ms);
}
[data-reveal="visible"] {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  [data-reveal] {
    transform: none;
    transition: opacity 200ms ease;
  }
}
```

**IntersectionObserver Config**:
```javascript
new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.dataset.reveal = 'visible';
      observer.unobserve(entry.target); // one-shot
    }
  });
}, { threshold: 0.1 });
```

**Accessibility**:
- Content must be accessible in DOM before reveal (no display:none)
- Use opacity + transform only (content readable by screen readers at all times)
- aria-hidden NOT used (content is always in accessibility tree)
- Stagger delay < 500ms total to avoid perception of broken page

---

## Lens/Overlay Pattern

Magnification overlay that follows pointer position over an image or content area.

**Core Interaction**:
- Circular/rectangular lens follows pointer over source content
- Magnified view rendered via CSS transform: scale() on background
- Lens positioned via transform: translate() (GPU-only)
- Toggle on click/tap, follow on pointermove

**State Machine**:
```
[inactive] --(click/tap on source)--> [active]
[active] --(pointermove)--> [active] (update lens position)
[active] --(click/tap)--> [inactive]
[active] --(pointerleave)--> [inactive]
[active] --(Escape)--> [inactive]
[inactive] --(Enter/Space on source)--> [active-keyboard]
[active-keyboard] --(Arrow keys)--> [active-keyboard] (move lens)
[active-keyboard] --(Escape)--> [inactive]
```

**Browser APIs**: Pointer Events, CSS transform, CSS clip-path/border-radius, requestAnimationFrame

**Animation**:
- Lens appear: opacity 0->1 + scale(0.8)->scale(1) (200ms, ease-out)
- Lens follow: Lerp position tracking (speed: 0.2)
- Lens dismiss: opacity 1->0 + scale(1)->scale(0.9) (150ms, ease-in)

**CSS Key Properties**:
```css
.lens__overlay {
  position: absolute;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  overflow: hidden;
  pointer-events: none;
  transform: translate(var(--lens-x), var(--lens-y));
  will-change: transform;
}
.lens__magnified {
  transform: scale(var(--lens-zoom, 2));
  transform-origin: var(--lens-origin-x) var(--lens-origin-y);
}
```

**Accessibility**:
- Source: role="img" with descriptive aria-label
- Lens toggle: aria-expanded on source element
- Keyboard: Enter/Space to activate, Arrow keys to pan, Escape to dismiss
- Screen reader: aria-live="polite" announces zoom state changes
- Not essential content: decorative enhancement, base content always visible

---

## Lightbox Pattern

Full-viewport overlay for content viewing with background dim and entry animation.

**Core Interaction**:
- Click/tap thumbnail opens full-viewport overlay
- Background dim via backdrop-filter + background overlay
- Scale-up entry animation from thumbnail position
- Dismiss: click outside, Escape key, close button
- Focus trap: Tab cycles within lightbox
- Scroll lock on body while open

**State Machine**:
```
[closed] --(click thumbnail)--> [opening]
[opening] --(animation-end)--> [open]
[open] --(click-outside / Escape / close-btn)--> [closing]
[closing] --(animation-end)--> [closed]
[open] --(ArrowLeft)--> [navigating-prev]
[open] --(ArrowRight)--> [navigating-next]
[navigating-*] --(content-loaded)--> [open]
```

**Browser APIs**: CSS backdrop-filter, Focus trap (manual), CSS transitions, Pointer Events

**Animation**:
- Open: scale(0.85)->scale(1) + opacity 0->1 (300ms, cubic-bezier(0.16,1,0.3,1))
- Close: scale(1)->scale(0.95) + opacity 1->0 (200ms, ease-in)
- Backdrop: opacity 0->1 (250ms, ease-out)
- Navigation: translateX crossfade between items (250ms)

**CSS Key Properties**:
```css
.lightbox__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
  z-index: 1000;
}
.lightbox__content {
  transform: scale(var(--lb-scale, 0.85));
  opacity: var(--lb-opacity, 0);
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.lightbox--open .lightbox__content {
  --lb-scale: 1;
  --lb-opacity: 1;
}
```

**Focus Trap Implementation**:
```javascript
// On open: store trigger, move focus to first focusable in lightbox
// On Tab: cycle within lightbox (first <-> last focusable)
// On close: restore focus to original trigger element
// Prevent body scroll: document.body.style.overflow = 'hidden'
```

**Accessibility**:
- role="dialog", aria-modal="true", aria-label="Image viewer"
- Close button: aria-label="Close lightbox"
- Focus trap: Tab cycles within dialog
- Escape dismisses
- ArrowLeft/ArrowRight for gallery navigation
- aria-live="polite" announces current item "Image N of M"
- Scroll lock: prevent background scroll while open
