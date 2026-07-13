---
role: builder
prefix: BUILD
inner_loop: true
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Interactive Component Builder

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Interaction blueprints | <session>/interaction/blueprints/*.md | Yes |
| Research artifacts | <session>/research/*.json | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| A11y audit feedback | <session>/a11y/a11y-audit-*.md | Only for GC fix tasks |

1. Extract session path from task description
2. Read interaction blueprint for target component
3. Read research artifacts: browser-api-audit.json (API availability), pattern-reference.json (reference patterns)
4. Detect task type from subject: numbered -> New component, "fix" -> GC fix
5. If GC fix task: read latest a11y audit feedback

## Phase 3: Implementation Execution

**Component Implementation (BUILD-001, BUILD-002, etc.)**:

### JavaScript (ES Module)
Implement component class in `<session>/build/components/{name}.js`:

```javascript
// Structure template (adapt to component type)
export class ComponentName {
  // --- Configuration ---
  static defaults = { /* configurable params from blueprint */ };

  // --- Lifecycle ---
  constructor(element, options = {}) { /* merge options, query DOM, bind events */ }
  init() { /* setup observers, initial state */ }
  destroy() { /* cleanup: remove listeners, disconnect observers */ }

  // --- State Machine ---
  #state = 'idle';
  #setState(next) { /* validate transition, update, trigger side effects */ }

  // --- Event Handlers (from blueprint event flow map) ---
  #onPointerDown(e) { /* setPointerCapture, transition state */ }
  #onPointerMove(e) { /* lerp interpolation, update transform */ }
  #onPointerUp(e) { /* releasePointerCapture, settle animation */ }
  #onKeyDown(e) { /* keyboard mapping from blueprint */ }

  // --- Animation ---
  #lerp(current, target, speed) { return current + (target - current) * speed; }
  #animate() { /* requestAnimationFrame loop, GPU-only transforms */ }

  // --- Observers ---
  #resizeObserver = null;  // responsive behavior
  #intersectionObserver = null;  // scroll triggers

  // --- Accessibility ---
  #announceToScreenReader(message) { /* aria-live region update */ }
}

// Auto-init: progressive enhancement
document.querySelectorAll('[data-component-name]').forEach(el => {
  new ComponentName(el);
});
```

Requirements:
- Pure ES module with `export` (no CommonJS, no bundler)
- Class-based with private fields (#)
- Constructor accepts DOM element + options object
- State machine from blueprint with validated transitions
- Event handlers from blueprint event flow map
- Lerp interpolation for smooth drag/follow (speed from blueprint)
- requestAnimationFrame for frame-synced updates
- setPointerCapture for reliable drag tracking
- ResizeObserver for responsive layout adjustments
- IntersectionObserver for scroll-triggered behavior (when applicable)
- Proper cleanup in destroy() method
- Auto-init via data attribute for progressive enhancement

### CSS (Custom Properties)
Implement styles in `<session>/build/components/{name}.css`:

```css
/* Structure template */
/* --- Custom Properties (configurable) --- */
.component-name {
  --component-duration: 400ms;
  --component-easing: cubic-bezier(0.16, 1, 0.3, 1);
  --component-color-primary: #1a1a2e;
  /* ... from blueprint animation choreography */
}

/* --- Base Layout (works without JS) --- */
.component-name { /* progressive enhancement base */ }

/* --- States (from blueprint state machine) --- */
.component-name[data-state="idle"] { }
.component-name[data-state="hover"] { }
.component-name[data-state="active"] { }
.component-name[data-state="dragging"] { }

/* --- Animations (GPU-only: transform + opacity) --- */
.component-name__element {
  transform: translateX(0);
  opacity: 1;
  transition: transform var(--component-duration) var(--component-easing),
              opacity var(--component-duration) var(--component-easing);
  will-change: transform, opacity;
}

/* --- Focus Styles --- */
.component-name:focus-visible {
  outline: 2px solid var(--component-focus-color, #4a9eff);
  outline-offset: 2px;
}

/* --- Reduced Motion --- */
@media (prefers-reduced-motion: reduce) {
  .component-name,
  .component-name * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}

/* --- Responsive --- */
@media (max-width: 768px) { /* touch-optimized sizes */ }
```

Requirements:
- CSS custom properties for all configurable values (no preprocessor)
- Base layout works without JavaScript (progressive enhancement)
- State-driven via data attributes (`data-state`, `data-active`)
- GPU-only animations: transform + opacity ONLY (no width/height/top/left)
- `will-change` on animated elements
- `prefers-reduced-motion` media query with instant transitions
- `focus-visible` for keyboard-only focus ring
- Responsive breakpoints for touch targets (min 44x44px)
- No inline styles from JS -- use CSS classes and custom properties

### Native Platform APIs (prefer over custom implementations)

**Dialog API** (`<dialog>`):
- Use `<dialog>` for modals — provides built-in focus trap and backdrop
- `dialog.showModal()` for modal (with backdrop, escape-to-close, focus trap)
- `dialog.show()` for non-modal
- `dialog.close()` to dismiss
- Style `::backdrop` pseudo-element for overlay
- Returns focus to trigger element on close
- Add `inert` attribute to siblings when modal is open (prevents background interaction)

**Popover API** (native tooltips/dropdowns):
- `<div popover>` for light-dismiss popovers (click-outside-to-close)
- `<button popovertarget="id">` for trigger
- Auto-stacking (no z-index management needed)
- Built-in accessibility (focus management, escape-to-close)
- Use for: tooltips, dropdown menus, date pickers, color pickers

**CSS Anchor Positioning** (Chrome 125+, progressive enhancement):
- `anchor-name: --trigger` on trigger element
- `position-anchor: --trigger` on positioned element
- `@position-try` for fallback positioning
- Fallback: `position: fixed` with JS-calculated coordinates

**GC Fix Mode (BUILD-fix-N)**:
- Parse a11y audit feedback for specific issues
- Re-read affected component files
- Apply targeted fixes: missing ARIA attributes, keyboard handlers, focus management, contrast adjustments
- Re-write affected files
- Signal `build_revision` instead of `build_ready`

## Phase 4: Self-Validation & Output

1. Zero-dependency check:

| Check | Pass Criteria |
|-------|---------------|
| No imports from npm | No `import` from node_modules paths |
| No require() | No CommonJS require statements |
| ES module exports | Uses `export class` or `export function` |
| No build tools needed | Runs directly in browser with `<script type="module">` |

2. State machine completeness:

| Check | Pass Criteria |
|-------|---------------|
| All states from blueprint | Every blueprint state has corresponding code path |
| All transitions | Every transition has handler code |
| Error recovery | All states can reach idle via reset |

3. Accessibility baseline:

| Check | Pass Criteria |
|-------|---------------|
| Keyboard handlers | onKeyDown handles Enter, Space, Escape, Arrows |
| ARIA attributes | role, aria-label, aria-expanded (as needed) set |
| Focus management | tabindex, focus-visible styles present |
| Reduced motion | prefers-reduced-motion media query in CSS |

4. Performance baseline:

| Check | Pass Criteria |
|-------|---------------|
| GPU-only transforms | No width/height/top/left in transitions |
| No forced reflow | No offsetWidth/getBoundingClientRect in animation loop |
| Cleanup | destroy() disconnects all observers and listeners |

5. Update `<session>/wisdom/.msg/meta.json` under `builder` namespace:
   - Read existing -> merge `{ "builder": { task_type, component_name, file_count, output_dir, states_implemented, events_bound } }` -> write back
