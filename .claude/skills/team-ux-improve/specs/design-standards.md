

# Visual Design Standards

Reference for visual design quality detection. Scanner and diagnoser use these standards to identify design issues.

## Color Standards

- **OKLCH** for perceptually uniform palettes
- **Tinted neutrals**: chroma 0.005-0.01, never pure gray (#808080) or pure black/white (#000, #fff)
- **60-30-10 rule**: 60% neutral, 30% secondary, 10% accent
- **WCAG AA contrast**: normal text 4.5:1, large text 3:1, UI components 3:1
- **Text on colored backgrounds**: use `color-mix(in oklch, ...)` not gray text

## Typography Standards

- **Avoid generic fonts**: Inter, Roboto, Open Sans, Lato, Montserrat, Arial
- **Modular scale** (choose one ratio consistently): 1.125, 1.200, 1.250, 1.333
- **Fluid sizing**: `clamp()` for display text (xl and above)
- **Line height**: body 1.5, headings 1.2, small text 1.6
- **Reading width**: `max-width: 65ch`
- **Font loading**: `font-display: swap`

## Spacing Standards

- **4pt base scale**: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 px
- **Rhythm variation**: tight (4-8px), comfortable (16-24px), generous (48-96px)
- **Sibling spacing**: `gap` over `margin`
- **No nested cards**. Touch targets: 44x44px min

## Motion Standards

- **Animate ONLY**: transform, opacity, clip-path, background-color, color, box-shadow, filter
- **NEVER animate**: width, height, top, left, margin, padding
- **Easing**: ease-out-quart `cubic-bezier(0.25, 1, 0.5, 1)` default. No bounce/elastic/linear
- **Duration**: instant 100ms, fast 150ms, normal 250ms, slow 400ms
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` REQUIRED

## 8 Interaction States

| State | CSS | Requirement |
|-------|-----|-------------|
| Default | -- | Base appearance |
| Hover | `:hover` in `@media(hover:hover)` | Subtle change |
| Focus | `:focus-visible` | 2px solid accent, offset 2px, 3:1 contrast |
| Active | `:active` | Scale(0.97) or darker |
| Disabled | `[disabled]` | Opacity 0.5 |
| Loading | `[aria-busy]` | Spinner/skeleton |
| Error | `[aria-invalid]` | Red border + message |
| Success | custom | Green check |

## Visual Hierarchy

- **Squint test**: blur page, identify top 2 elements + groupings
- **1 primary CTA** per viewport
- **Progressive disclosure**: reveal complexity on demand
