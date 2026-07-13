---
role: optimizer
prefix: OPT
inner_loop: true
message_types: [opt_complete, opt_progress, error]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# UI Optimizer -- Targeted Fix Application

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Scan report | <session>/scan/scan-report.md | Yes |
| Diagnosis report | <session>/diagnosis/diagnosis-report.md | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Fix strategies | specs/fix-strategies.md | Yes |
| Design standards | specs/design-standards.md | Yes |
| Verification feedback | <session>/verification/verify-report.md | Only for GC fix tasks |

1. Extract session path from task description
2. Read diagnosis report: parse root cause groups, fix dependency graph, recommended fix order
3. Read scan report: parse positive findings (things to preserve)
4. Read specs/fix-strategies.md and specs/design-standards.md for fix reference
5. Detect task type from subject: "OPT-001" -> initial optimization, "OPT-fix-*" -> GC fix round
6. If GC fix task: read verification feedback for specific regressions to fix

## Phase 3: Apply Fixes

Follow the fix dependency graph from diagnosis report. Apply fixes in order, one category at a time. After each category, self-validate before proceeding.

**CRITICAL**: Preserve positive findings from scan report. Do not break what already works.

---

### Fix Category 1: Anti-AI-Slop Fixes

Target: Root cause groups tagged with anti-patterns dimension.

| Issue | Fix |
|-------|-----|
| Generic fonts (Inter, Roboto, Open Sans) | Replace with distinctive alternatives: Instrument Sans, Plus Jakarta Sans, Fraunces, DM Sans, Manrope, Space Grotesk, Geist |
| Gradient text | Convert to solid accent color. Remove `background-clip: text` + gradient |
| Identical card grids | Vary card sizes, add featured/hero card, break symmetry. Not everything needs to be a card |
| Glassmorphism decoration | Remove `backdrop-filter: blur()` unless serving real purpose (e.g., overlays). Replace glow borders with subtle shadows |
| Hero metric template | Redesign with intentional layout. Vary metric sizes by importance. Remove gradient accents |
| Nested cards | Flatten: remove inner card borders, use spacing + subtle dividers instead |
| Everything centered | Add left-alignment for body text. Use asymmetric layouts. Vary alignment per section |
| All buttons primary | Create button hierarchy: 1 primary, ghost/outline for secondary, text links for tertiary |
| Same spacing everywhere | Introduce spacing rhythm: tighter within groups, generous between sections |
| Bounce/elastic easing | Replace with exponential curves: `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart) |

---

### Fix Category 2: Color Fixes

Target: Root cause groups tagged with color dimension.

| Issue | Fix |
|-------|-----|
| Pure black (#000) | Replace with tinted near-black: `oklch(0.15 0.01 <brand-hue>)` or `#0a0a0a`-range tinted |
| Pure white (#fff) | Replace with tinted near-white: `oklch(0.98 0.005 <brand-hue>)` or `#fafaf8`-range tinted |
| Untinted grays | Add brand hue tint: `oklch(L 0.005-0.01 <brand-hue>)` for each gray step |
| Gray on colored bg | Replace with shade of background color or use `color-mix()` / transparency |
| Contrast failures | Increase lightness difference until WCAG AA met (4.5:1 text, 3:1 large text, 3:1 UI) |
| No OKLCH | Convert key palette colors to `oklch()`. Especially for generating tints/shades |
| Accent overuse | Reduce accent to ~10% of page. Convert excess accent to neutral or secondary |
| No semantic roles | Create token structure: `--color-primary`, `--color-neutral-*`, `--color-success/warning/error`, `--color-surface-*` |
| Hard-coded colors | Extract to CSS custom properties. Create design token file if none exists |

---

### Fix Category 3: Typography Fixes

Target: Root cause groups tagged with typography dimension.

| Issue | Fix |
|-------|-----|
| Overused fonts | Replace with distinctive alternatives. Body: Plus Jakarta Sans, Instrument Sans, DM Sans. Display: Fraunces, Space Grotesk, Manrope |
| Muddy hierarchy | Establish clear modular scale. Remove intermediate sizes. Target: 5-7 distinct sizes |
| No modular scale | Define scale with ratio (1.25 major third, 1.333 perfect fourth, 1.5 perfect fifth). Base: 16px |
| Small body text | Set minimum `font-size: 1rem` (16px) for body. 14px only for captions/metadata |
| Bad line length | Add `max-width: 65ch` to prose containers. Min 45ch, max 75ch |
| Inconsistent line-height | Establish system: 1.5 for body, 1.2-1.3 for headings, 1.6-1.7 for small text |
| No fluid sizing | Add `clamp()` for h1-h3: e.g., `font-size: clamp(1.75rem, 1.2rem + 2vw, 3rem)` |
| Missing font-display | Add `font-display: swap` to all @font-face declarations |

---

### Fix Category 4: Spacing & Layout Fixes

Target: Root cause groups tagged with spacing dimension.

| Issue | Fix |
|-------|-----|
| Arbitrary spacing | Replace with nearest value on 4pt scale: 4, 8, 12, 16, 24, 32, 48, 64, 96px |
| No spacing scale | Create CSS custom properties: `--space-1: 0.25rem` through `--space-12: 6rem` |
| Monotonous spacing | Vary spacing: tighter within component groups (8-12px), generous between sections (48-96px) |
| Card overuse | Remove card wrapper from items that do not need distinct containment. Use spacing + dividers |
| Nested cards | Flatten inner cards. Remove inner borders. Use spacing or subtle background tint |
| Fixed widths | Replace `width: Npx` with `max-width` + `width: 100%` or grid/flex |
| Small touch targets | Set `min-height: 44px; min-width: 44px` on all interactive elements |
| Margin for siblings | Replace `margin-top/bottom` between siblings with `gap` on flex/grid parent |

---

### Fix Category 5: Motion Fixes

Target: Root cause groups tagged with motion dimension.

| Issue | Fix |
|-------|-----|
| Layout property animation | Replace `width/height/top/left/margin/padding` transitions with `transform` + `opacity` |
| Bad easing | Replace `ease`, `linear`, `ease-in-out` with `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart) |
| Bounce/elastic | Replace with exponential: `cubic-bezier(0.25, 1, 0.5, 1)` for enter, `cubic-bezier(0.5, 0, 0.75, 0)` for exit |
| No reduced-motion | Add: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` |
| No motion tokens | Create: `--duration-instant: 100ms`, `--duration-fast: 150ms`, `--duration-normal: 250ms`, `--duration-slow: 400ms`, `--duration-entrance: 500ms` |
| Uncapped stagger | Cap at 10 items visible, total stagger <= 500ms. Use `animation-delay: min(calc(var(--i) * 50ms), 500ms)` |
| Premature will-change | Remove from CSS. Add via JS on `pointerenter`/`focusin`, remove on `animationend`/`transitionend` |

---

### Fix Category 6: Interaction State Fixes

Target: Root cause groups tagged with interaction dimension.

| Issue | Fix |
|-------|-----|
| Missing hover | Add `:hover` with subtle background change or opacity shift. Use `@media (hover: hover)` to scope |
| Missing focus | Add `:focus-visible` with focus ring: `outline: 2px solid var(--color-primary); outline-offset: 2px` |
| outline: none | Replace with `:focus-visible` pattern. Only `:focus:not(:focus-visible) { outline: none }` |
| No focus-visible | Replace `:focus` styles with `:focus-visible`. Add polyfill if browser support needed |
| Missing active | Add `:active` with `transform: scale(0.97)` or darker background |
| Missing disabled | Add `[disabled], [aria-disabled="true"]` with `opacity: 0.5; cursor: not-allowed; pointer-events: none` |
| Missing loading | Add loading state: spinner/skeleton + `aria-busy="true"` + disable submit button |
| Missing error/success | Add form validation styles: red border + error message for error, green check for success |
| Placeholder as label | Add visible `<label>` element. Keep placeholder as hint only. Use `aria-labelledby` if needed |
| Focus ring quality | Ensure: 2px solid accent, offset 2px, 3:1 contrast ratio against background |

---

### Fix Category 7: Visual Hierarchy Fixes

Target: Root cause groups tagged with hierarchy dimension.

| Issue | Fix |
|-------|-----|
| Fails squint test | Increase size/weight/color contrast of primary element. Reduce visual weight of secondary elements |
| Primary action unclear | Make primary CTA largest, highest contrast, most saturated. Only 1 primary per viewport |
| Size-only hierarchy | Add weight (bold vs regular) + color (saturated vs muted) + space (more surrounding space = more important) |
| No information grouping | Use proximity principle: tighter spacing within groups, larger gaps between groups |
| Visual competition | Reduce visual weight of competing elements. Mute colors, reduce size, decrease contrast |
| No 3:1 ratio | Ensure h1 is at least 3x body size. Each heading level should be 1.25-1.5x the next |
| Decoration over content | Reduce or remove decorative elements. Mute icon colors. Remove background decorations |

---

### Fix Category 8: Responsive Fixes

Target: Root cause groups tagged with responsive dimension.

| Issue | Fix |
|-------|-----|
| Fixed widths | Replace with `max-width` + `width: 100%`, or `min()`, or grid `fr` units |
| Horizontal scroll | Find overflow source. Add `overflow-x: hidden` on body only as last resort. Fix root cause |
| Hidden content | Restructure for mobile instead of hiding. Use accordion, tabs, or progressive disclosure |
| No container queries | Add `container-type: inline-size` on component wrappers. Use `@container` for component-level responsive |
| Small mobile text | Set minimum 14px (0.875rem) for all text on mobile. Prefer 16px for body |
| Tiny mobile targets | Set `min-height: 44px` on all interactive elements. Add padding if needed |
| No breakpoints | Add: `@media (min-width: 640px)`, `(min-width: 768px)`, `(min-width: 1024px)`, `(min-width: 1280px)` |
| Broken images | Add `img { max-width: 100%; height: auto }`. Use `object-fit` for fixed aspect ratios |

---

## Phase 4: Self-Validation & Output

1. After all fixes applied, validate:

| Check | Pass Criteria |
|-------|---------------|
| Code compiles | No syntax errors in modified files |
| Lint passes | No new lint errors introduced |
| No positive findings broken | Items from scan report "Positive Findings" section still intact |
| Fix log complete | Every applied fix documented |

2. Write fix log: `<session>/optimization/fix-log.md`

```markdown
# Optimization Fix Log

## Summary
- Fixes applied: N
- Files modified: N
- Categories addressed: <list>
- GC round: <1 | fix-N>

## Fixes Applied

### Category: <category name>
| # | File | Line | Before | After | Issue Ref |
|---|------|------|--------|-------|-----------|
| 1 | path/to/file.css | 42 | `color: #000` | `color: oklch(0.15 0.01 250)` | P1-Color-3 |

### Category: <next category>
...

## Files Modified
- `path/to/file.css`: <summary of changes>
- `path/to/file.tsx`: <summary of changes>

## Preserved (not modified)
- <positive findings that were intentionally kept>

## Metadata
- Source diagnosis: <session>/diagnosis/diagnosis-report.md
- Timestamp: <ISO timestamp>
```

3. Send completion message:
```
mcp__maestro__team_msg(session_id, role="optimizer", type="opt_complete", content="Optimization complete. Fixes applied: N. Files modified: N. Categories: <list>.")
SendMessage(participant="coordinator", message="[optimizer] OPT-001 complete. Applied N fixes across N files. Categories: <list>. Log: <session>/optimization/fix-log.md")
```
