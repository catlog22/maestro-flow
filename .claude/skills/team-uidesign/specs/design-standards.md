

# Impeccable Design Standards

Reference spec for all roles. Every design decision must trace back to these standards.

---

## Color (OKLCH)

OKLCH for perceptually uniform palettes. All color tokens MUST use OKLCH notation.

### Token Hierarchy

primitive -> semantic -> component

```
/* Primitives */
--color-primary          oklch(0.55 0.2 250)
--color-primary-light    oklch(0.70 0.15 250)
--color-primary-dark     oklch(0.40 0.22 250)

/* Tinted neutrals (chroma 0.005-0.01, brand hue) */
--color-neutral-50       oklch(0.98 0.005 250)  /* brand tinted */
--color-neutral-100      oklch(0.95 0.006 250)
--color-neutral-200      oklch(0.90 0.007 250)
--color-neutral-300      oklch(0.82 0.007 250)
--color-neutral-400      oklch(0.70 0.008 250)
--color-neutral-500      oklch(0.55 0.008 250)
--color-neutral-600      oklch(0.45 0.009 250)
--color-neutral-700      oklch(0.35 0.009 250)
--color-neutral-800      oklch(0.25 0.010 250)
--color-neutral-900      oklch(0.15 0.010 250)
--color-neutral-950      oklch(0.08 0.010 250)

/* Semantic */
--color-success          oklch(0.65 0.18 145)
--color-warning          oklch(0.75 0.15 85)
--color-error            oklch(0.55 0.22 25)
--color-info             oklch(0.60 0.18 250)
```

### Rules

- **60-30-10 rule**: 60% neutral, 30% secondary, 10% accent
- **Never pure black** (`#000`) or **pure white** (`#fff`) -- use tinted neutrals
- **Tinted neutrals**: chroma 0.005-0.01, hue matching brand primary
- **Text on colored backgrounds**: use `color-mix(in oklch, ...)` not gray

### Dark Mode Rules
- Dark mode is NOT inverted light mode. It requires deliberate design:
  - Use **lighter surfaces** for elevation/depth (not darker)
  - **Reduce font weight** by 1 step (600→500, 500→400) — light text on dark looks heavier
  - **Desaturate accent colors** — saturated colors vibrate on dark backgrounds
  - Surface hierarchy: `oklch(0.15 ...)` base → `oklch(0.20 ...)` raised → `oklch(0.25 ...)` overlay
- Never: pure black `#000` background (too harsh). Use `oklch(0.10 0.01 <hue>)` minimum
- Test: all contrast ratios must meet WCAG AA in BOTH themes

### Dangerous Color Combinations
| Combination | Problem | Fix |
|-------------|---------|-----|
| Gray text on colored background | Looks washed out, low contrast | Use shade of bg color or white/dark with transparency |
| Red + Green (adjacent) | 8% male color blindness | Add icons/patterns, not just color |
| Yellow text on white | Near-invisible | Use dark amber instead |
| Thin light text on images | Unpredictable contrast | Add text shadow or semi-transparent overlay |
| Saturated colors on dark bg | Visual vibration | Desaturate: reduce OKLCH chroma by 0.05-0.10 |

- **WCAG AA contrast**:
  - Normal text: 4.5:1
  - Large text (>= 18px bold or >= 24px): 3:1
  - UI components and graphical objects: 3:1
  - Focus indicators: 3:1

---

## Typography

### Font Selection

**Avoid** (overused defaults): Inter, Roboto, Open Sans, Lato, Montserrat, Arial

**Recommended**: Instrument Sans, Plus Jakarta Sans, DM Sans, Space Grotesk, Fraunces

### Modular Scale

Choose one ratio for the project:

| Name | Ratio | Use Case |
|------|-------|----------|
| Major Second | 1.125 | Dense UI, dashboards |
| Minor Third | 1.200 | General purpose |
| Major Third | 1.250 | Marketing, editorial |
| Perfect Fourth | 1.333 | Bold, expressive |

### Fluid Sizing

Use `clamp()` for display and heading sizes:

```css
--text-sm:      clamp(0.8rem, 0.77rem + 0.15vw, 0.875rem);
--text-base:    clamp(0.9rem, 0.85rem + 0.25vw, 1rem);
--text-lg:      clamp(1.05rem, 0.95rem + 0.35vw, 1.125rem);
--text-xl:      clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem);
--text-2xl:     clamp(1.5rem, 1.25rem + 0.75vw, 1.875rem);
--text-3xl:     clamp(1.875rem, 1.5rem + 1.1vw, 2.25rem);
--text-display: clamp(2.25rem, 1.75rem + 1.5vw, 3rem);
```

### Line Height

- Body text: 1.5
- Headings: 1.2
- Small / caption text: 1.6

### Reading Width

`max-width: 65ch` (acceptable range: 45-75ch)

### Font Loading

`font-display: swap` with fallback metrics:

```css
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-display: swap;
  size-adjust: 102%;
  ascent-override: 95%;
}
```

---

## Spacing (4pt Base)

### Scale

```
0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 px
```

Map to tokens:

```
--space-0:   0px;
--space-1:   4px;    /* 0.25rem */
--space-2:   8px;    /* 0.5rem */
--space-3:   12px;   /* 0.75rem */
--space-4:   16px;   /* 1rem */
--space-5:   20px;   /* 1.25rem */
--space-6:   24px;   /* 1.5rem */
--space-8:   32px;   /* 2rem */
--space-10:  40px;   /* 2.5rem */
--space-12:  48px;   /* 3rem */
--space-16:  64px;   /* 4rem */
--space-24:  96px;   /* 6rem */
```

### Rhythm

| Context | Spacing | Tokens |
|---------|---------|--------|
| Tight (within groups) | 4-8px | space-1, space-2 |
| Comfortable (between items) | 16-24px | space-4 to space-6 |
| Generous (between sections) | 48-96px | space-12 to space-24 |

### Layout Rules

- Use `gap` not `margin` for sibling spacing
- Cards only for distinct actionable content -- flatten nested cards
- Container queries for component-level responsive behavior
- Touch targets: **44x44px minimum**, 8px gap between adjacent targets

---

## Motion

### Animatable Properties (ONLY these)

transform, opacity, clip-path, background-color, color, border-color, box-shadow, filter

### NEVER Animate (layout triggers)

width, height, top, left, margin, padding

### Easing

Default: ease-out-quart `cubic-bezier(0.25, 1, 0.5, 1)`

NEVER use: `ease`, `linear`, `bounce`, `elastic`

### Duration Scale

| Token | Duration | Use |
|-------|----------|-----|
| --duration-instant | 100ms | Toggles, checkboxes |
| --duration-fast | 150ms | Feedback, micro-interactions |
| --duration-normal | 250ms | Standard transitions |
| --duration-slow | 400ms | Panels, drawers |
| --duration-entrance | 500ms | Page/section entrance |
| --duration-complex | 800ms | Multi-step orchestration |

- Exit duration = 75% of entrance
- Feedback animations: 100-150ms max

### Stagger

- Max 10 items in stagger group
- Max 500ms total stagger duration
- Formula: `calc(var(--index) * 50ms)`

### Reduced Motion (REQUIRED)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### will-change

Add via JS on `pointerenter`, remove on `animationend`/`transitionend`. Never set permanently in CSS.

---

## Interaction States (8 Required)

Every interactive component MUST define all 8 states:

| State | CSS | Visual Treatment |
|-------|-----|------------------|
| Default | -- | Base appearance |
| Hover | `:hover` (wrap in `@media(hover:hover)`) | Subtle bg shift or opacity change |
| Focus | `:focus-visible` | 2px solid accent, offset 2px |
| Active | `:active` | `scale(0.97)` or darker background |
| Disabled | `[disabled], [aria-disabled="true"]` | opacity 0.5, `cursor: not-allowed` |
| Loading | `[aria-busy="true"]` | Spinner or skeleton placeholder |
| Error | `[aria-invalid="true"]` | Red border + error message |
| Success | custom attribute | Green check + success message |

### Focus Ring Spec

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: inherit;
}
```

---

## Visual Hierarchy

### Squint Test

Blur the page -- you should immediately identify the top 2 elements and groupings.

### Tools

Size (3:1 ratio between primary and body), weight (max 2 weights per page), color, space, position, contrast.

### CTA Hierarchy

- **1 primary CTA per viewport** -- filled button
- Secondary -- outline button
- Tertiary -- text link

### Progressive Disclosure

Reveal complexity gradually. Default to the simplest view.

---

## Responsive

### Breakpoints (mobile-first)

```
640px, 768px, 1024px, 1280px, 1536px
```

### Fluid Design

Prefer `%`, `vw`, `fr`, `min()`, `max()`, `clamp()` over fixed `px`.

### Mobile Requirements

- Minimum 14px text
- 44px touch targets
- No horizontal scroll at 320px viewport
- Adapt layout, don't hide content

---

## Elevation & Z-Index

### Semantic Z-Index Scale
```css
--z-dropdown:       100;
--z-sticky:         200;
--z-fixed:          300;
--z-modal-backdrop: 400;
--z-modal:          500;
--z-popover:        600;
--z-toast:          700;
--z-tooltip:        800;
```

- Never use arbitrary z-index values (z-index: 9999)
- Each level has clear semantic meaning
- Modal backdrop + modal are separate layers (backdrop catches clicks)
- Toast above modal (error during modal interaction must be visible)

---

## UX Writing

Reference: [specs/ux-writing.md](ux-writing.md) for full guidelines.

Key rules for design token and component spec work:
- Button labels: verb + object ("Save changes" not "Submit")
- Error messages: what + why + fix
- Empty states: acknowledge + explain value + action
- Destructive actions: name the destruction + show count
- Never "OK/Cancel" — use specific action names
