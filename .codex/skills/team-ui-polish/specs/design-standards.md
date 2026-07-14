

# Design Standards

Impeccable's positive design standards. These are the target state -- what good looks like. Used by scanner for scoring (how close to ideal) and optimizer as fix targets.

---

## Color

### Principles
- Use **OKLCH** for perceptually uniform palettes. Colors at the same lightness actually look the same lightness
- Tint neutrals toward brand hue (chroma 0.005-0.01). Never pure gray
- **60-30-10 rule**: 60% neutral, 30% secondary/supporting, 10% accent
- Semantic token hierarchy: primitive -> semantic -> component tokens
- Never pure black (`#000`) or pure white (`#fff`). Always tint

### Color Token Structure
```
--color-primary          oklch(0.55 0.2 250)
--color-primary-hover    oklch(0.50 0.22 250)
--color-primary-active   oklch(0.45 0.22 250)

--color-neutral-50       oklch(0.98 0.005 250)    /* near-white, brand tinted */
--color-neutral-100      oklch(0.95 0.005 250)
--color-neutral-200      oklch(0.90 0.007 250)
--color-neutral-300      oklch(0.80 0.007 250)
--color-neutral-400      oklch(0.65 0.008 250)
--color-neutral-500      oklch(0.50 0.008 250)
--color-neutral-600      oklch(0.40 0.008 250)
--color-neutral-700      oklch(0.30 0.008 250)
--color-neutral-800      oklch(0.20 0.010 250)
--color-neutral-900      oklch(0.13 0.010 250)
--color-neutral-950      oklch(0.08 0.010 250)    /* near-black, brand tinted */

--color-success          oklch(0.65 0.18 145)
--color-warning          oklch(0.75 0.15 85)
--color-error            oklch(0.55 0.22 25)
--color-info             oklch(0.60 0.15 250)

--color-surface          var(--color-neutral-50)
--color-surface-raised   var(--color-neutral-100)
--color-surface-overlay  var(--color-neutral-900 / 0.5)

--color-text-primary     var(--color-neutral-900)
--color-text-secondary   var(--color-neutral-600)
--color-text-muted       var(--color-neutral-400)
```

### Contrast Requirements (WCAG AA)
- Normal text (<18px / <24px bold): 4.5:1 minimum
- Large text (>=18px / >=24px bold): 3:1 minimum
- UI components and graphical objects: 3:1 minimum
- Focus indicators: 3:1 against adjacent colors

### Text on Colored Backgrounds
- Never gray text on colored backgrounds (looks washed out)
- Use shade of the background color, or white/dark with transparency
- `color-mix(in oklch, var(--bg-color) 30%, black)` for text on colored surfaces

---

## Typography

### Font Selection
Avoid: Inter, Roboto, Open Sans, Lato, Montserrat, Arial (overused defaults).

Recommended alternatives by category:
- **Sans-serif body**: Instrument Sans, Plus Jakarta Sans, DM Sans, Geist, General Sans
- **Sans-serif display**: Space Grotesk, Manrope, Outfit, Satoshi, Clash Display
- **Serif display**: Fraunces, Playfair Display 2, Source Serif 4
- **Monospace (code only)**: Geist Mono, JetBrains Mono, Fira Code

### Modular Type Scale
Choose one ratio and apply consistently:

| Ratio | Name | Scale (base 16px) |
|-------|------|--------------------|
| 1.125 | Major Second | 16, 18, 20.25, 22.78, 25.63 |
| 1.200 | Minor Third | 16, 19.2, 23.04, 27.65, 33.18 |
| 1.250 | Major Third | 16, 20, 25, 31.25, 39.06 |
| 1.333 | Perfect Fourth | 16, 21.33, 28.43, 37.9, 50.52 |
| 1.500 | Perfect Fifth | 16, 24, 36, 54, 81 |

### Fluid Sizing
Use `clamp()` for display text:
```css
--text-xs:   0.75rem;                                    /* 12px, fixed */
--text-sm:   0.875rem;                                   /* 14px, fixed */
--text-base: 1rem;                                       /* 16px, body */
--text-lg:   1.125rem;                                   /* 18px */
--text-xl:   clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem);   /* 20-24px */
--text-2xl:  clamp(1.5rem, 1.2rem + 1vw, 2rem);         /* 24-32px */
--text-3xl:  clamp(1.875rem, 1.4rem + 1.5vw, 2.5rem);   /* 30-40px */
--text-4xl:  clamp(2.25rem, 1.5rem + 2.5vw, 3.5rem);    /* 36-56px */
```

### Line Height & Spacing
- Body text: `line-height: 1.5` (24px at 16px base)
- Headings: `line-height: 1.2` (tighter)
- Small text / captions: `line-height: 1.6`
- Reading width: `max-width: 65ch` (range: 45-75ch)

### Loading
- `font-display: swap` on all custom fonts
- Provide `size-adjust`, `ascent-override`, `descent-override` on fallback for minimal CLS

---

## Spacing

### 4pt Base Scale
```css
--space-0:  0;
--space-1:  0.25rem;   /* 4px */
--space-2:  0.5rem;    /* 8px */
--space-3:  0.75rem;   /* 12px */
--space-4:  1rem;      /* 16px */
--space-5:  1.25rem;   /* 20px */
--space-6:  1.5rem;    /* 24px */
--space-8:  2rem;      /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
--space-16: 4rem;      /* 64px */
--space-24: 6rem;      /* 96px */
```

### Rhythm
- **Tight**: 4-8px within component groups (e.g., label + input, icon + text)
- **Comfortable**: 16-24px between related items (e.g., list items, form fields)
- **Generous**: 48-96px between major sections (e.g., page sections, content blocks)

Monotonous spacing (same value everywhere) = no rhythm = boring. Vary spacing intentionally.

### Layout Principles
- Use `gap` instead of `margin` for sibling spacing
- Cards only when content is truly distinct and actionable. Not everything needs a card
- Flatten nested cards -- use spacing + subtle dividers instead
- Container queries (`@container`) for component-level responsive
- Touch targets: minimum 44x44px for all interactive elements
- Optical adjustments: visually center, not mathematically center (e.g., play button in circle needs right offset)

---

## Motion

### Property Rules
- **Animate ONLY**: `transform`, `opacity`, `clip-path`, `background-color`, `color`, `border-color`, `box-shadow`, `filter`
- **NEVER animate**: `width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding` (triggers layout)

### Easing
- **Default (ease-out-quart)**: `cubic-bezier(0.25, 1, 0.5, 1)` -- decelerates naturally
- **Enter (ease-out)**: `cubic-bezier(0, 0, 0.25, 1)` -- elements arrive and settle
- **Exit (ease-in)**: `cubic-bezier(0.5, 0, 0.75, 0)` -- elements accelerate away
- **NEVER**: `ease` (default), `linear` (mechanical), bounce/elastic (dated)

### Duration Scale
```css
--duration-instant:   100ms;   /* tooltip show, ripple */
--duration-fast:      150ms;   /* button hover, focus ring */
--duration-normal:    250ms;   /* dropdown open, tab switch */
--duration-slow:      400ms;   /* modal open, sidebar slide */
--duration-entrance:  500ms;   /* page entrance, hero animation */
--duration-complex:   800ms;   /* complex sequence, page transition */
```

- Exit = 75% of entrance duration
- Feedback (hover, active, focus): 100-150ms maximum
- State change: 200-300ms
- Layout change: 300-500ms

### Stagger
- Max visible items to stagger: 10
- Total stagger duration: max 500ms
- Formula: `animation-delay: calc(var(--index) * 50ms)`
- Cap: `animation-delay: min(calc(var(--index) * 50ms), 500ms)`

### Reduced Motion
**Required** -- affects ~35% of adults over 40:
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

### will-change
- Do NOT set in CSS (wastes GPU memory permanently)
- Add via JS on `pointerenter` / `focusin`
- Remove on `animationend` / `transitionend`

---

## Interaction States

### The 8 Required States

Every interactive element must define:

| State | CSS | Visual Change |
|-------|-----|---------------|
| Default | -- | Base appearance |
| Hover | `:hover` (wrap in `@media(hover:hover)`) | Subtle background/opacity change |
| Focus | `:focus-visible` | Focus ring: 2px solid accent, offset 2px |
| Active | `:active` | Scale down (0.97) or darker background |
| Disabled | `[disabled], [aria-disabled="true"]` | Opacity 0.5, cursor not-allowed |
| Loading | `[aria-busy="true"]` | Spinner/skeleton, disable interaction |
| Error | `[aria-invalid="true"]` | Red border, error message below |
| Success | custom class/attribute | Green check, success message |

### Focus Ring Specification
```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: inherit;
}

/* Only remove outline for mouse clicks */
:focus:not(:focus-visible) {
  outline: none;
}
```

Focus ring contrast: 3:1 minimum against all adjacent colors.

### Form Labels
- Always provide visible `<label>` elements
- Placeholders are hints, NOT labels (they disappear)
- Use `aria-labelledby` or `aria-label` for icon-only buttons
- Error messages: `aria-describedby` linking input to error text

### Touch Targets
- Minimum: 44x44px (WCAG 2.5.5 AAA) / 24x24px (WCAG 2.5.8 AA minimum)
- Use padding to increase hit area without changing visual size
- Minimum 8px gap between adjacent targets

---

## Visual Hierarchy

### Squint Test
Blur the page (or squint). You should immediately identify:
1. The most important element (usually primary heading or CTA)
2. The second most important element
3. Clear groupings of related content

If everything looks the same when blurred, hierarchy has failed.

### Hierarchy Tools (use 2-3 together)
| Tool | Effect |
|------|--------|
| Size | Larger = more important. 3:1 ratio between major levels |
| Weight | Bold vs regular vs light. Maximum 2 weights per page |
| Color | Saturated vs muted. Primary color for emphasis |
| Space | More surrounding space = more important |
| Position | Top-left reads first (in LTR). Above fold > below fold |
| Contrast | High contrast = more important. Low contrast recedes |

### Primary Action Rule
- Only 1 primary CTA per viewport
- Primary: filled button, highest contrast, most saturated
- Secondary: outline/ghost button
- Tertiary: text link, no background

### Progressive Disclosure
- Show summary first, detail on demand
- Expandable sections, "show more," detail panels
- Do not dump all information at once

---

## Responsive Design

### Breakpoints
```css
/* Mobile first */
--bp-sm:  640px;    /* Small tablets */
--bp-md:  768px;    /* Tablets */
--bp-lg:  1024px;   /* Laptops */
--bp-xl:  1280px;   /* Desktops */
--bp-2xl: 1536px;   /* Large screens */
```

### Fluid Design Principles
- Use `%`, `vw`, `fr`, `min()`, `max()`, `clamp()` instead of fixed `px` widths
- `max-width` instead of `width` for containers
- Grid with `fr` units for responsive layouts
- Container queries (`@container`) for component-level responsiveness

### Mobile Requirements
- Minimum text: 14px (0.875rem), prefer 16px for body
- Touch targets: 44x44px minimum
- No horizontal scroll at >= 320px viewport
- Must have `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Images: `max-width: 100%; height: auto`

### Adapt, Don't Hide
- Content should be restructured for smaller screens, not hidden
- Stack horizontal layouts vertically
- Use accordion/tabs for complex content
- Simplify navigation (hamburger, bottom nav)

---

## UX Writing

### Button Labels
- NEVER: "OK", "Submit", "Yes", "No" (generic)
- ALWAYS: verb + object — "Save changes", "Create account", "Delete message"
- Destructive: name the destruction + count — "Delete 5 items"

### Error Messages
Formula: what happened + why + how to fix
- "Password must be 8+ characters with a number" not "Invalid password"
- Never blame user, never use codes alone
- Preserve user input on error

### Empty States
Acknowledge + explain value + provide action
- "No projects yet. Create your first project to start collaborating. [Create project]"

### Loading Text
- Specific: "Saving your draft..." not "Loading..."
- Multi-step: "Uploading (2 of 5 files)..."

### Consistency
- One term per concept (delete/remove → pick one)
- Same icon for same action everywhere

---

## Dark Mode (when present)

### Rules
- NOT inverted light mode — requires deliberate design
- **Surface hierarchy**: lighter surfaces = higher elevation
  - Base: `oklch(0.10-0.15 0.01 <hue>)`
  - Raised: `oklch(0.18-0.22 0.01 <hue>)`
  - Overlay: `oklch(0.24-0.28 0.01 <hue>)`
- **Font weight**: reduce by 1 step (600→500, 500→400) — light text on dark looks heavier
- **Accent colors**: desaturate — reduce OKLCH chroma by 0.05-0.10 from light theme values
- Never: pure black `#000` background

### Dangerous Combinations
| Combination | Problem | Fix |
|-------------|---------|-----|
| Gray on colored bg | Washed out | Use shade of bg color or white with opacity |
| Red + Green adjacent | Color blindness | Add icons/patterns |
| Yellow on white | Invisible | Use dark amber |
| Thin light text on images | Unpredictable contrast | Text shadow or overlay |
| Saturated on dark | Visual vibration | Desaturate chroma |
