

# Fix Strategies

Maps issue categories to Impeccable fix strategies. Used by diagnostician for fix planning and optimizer for implementation guidance.

## Strategy Index

| Issue Category | Fix Strategy | Impeccable Concept | Scope |
|----------------|-------------|-------------------|-------|
| AI slop aesthetic | De-template | normalize + critique | Systemic |
| Color problems | Colorize | colorize | Systemic / Per-file |
| Typography issues | Typeset | typeset | Systemic |
| Spacing/layout | Arrange | arrange | Systemic / Per-file |
| Animation issues | Animate | animate | Per-file |
| Missing states | Harden | harden + polish | Per-component |
| Visual noise | Simplify | quieter + distill | Per-component |
| Too bland/weak | Strengthen | bolder + delight | Per-component |
| Inconsistency | Normalize | normalize | Systemic |
| Final pass | Polish | polish | Per-component |
| Hierarchy issues | Clarify | distill + bolder | Per-page |
| Responsive issues | Adapt | adapt | Per-component |

---

## De-template (Anti-AI-Slop)

**When**: Anti-patterns dimension score 0-2 (AI slop or heavy AI influence)

**Strategy**:
1. Replace generic fonts with distinctive alternatives (see design-standards.md Typography)
2. Convert gradient text to solid accent colors with weight/size emphasis instead
3. Break identical card grids: vary sizes, add featured card, introduce asymmetry
4. Remove decorative glassmorphism (keep functional like overlays)
5. Redesign hero metrics with intentional hierarchy, not template layout
6. Flatten nested cards into single-level with spacing
7. Add left-alignment for body text, centering only for specific hero elements
8. Create button hierarchy: 1 primary, ghost secondary, text tertiary
9. Introduce spacing rhythm (tight within groups, generous between sections)
10. Replace bounce easing with exponential curves

**Dependency**: Requires Colorize and Typeset to be planned (often executed together).

---

## Colorize

**When**: Color dimension score 0-2 or any P0/P1 color issues

**Strategy**:
1. **Token foundation** (if no tokens exist):
   - Create CSS custom property file with full neutral scale (50-950)
   - Define primary, semantic (success/warning/error/info), and surface tokens
   - All neutrals tinted toward brand hue (OKLCH chroma 0.005-0.01)

2. **Pure black/white removal**:
   - `#000` -> `oklch(0.08-0.15 0.01 <hue>)` (near-black, brand tinted)
   - `#fff` -> `oklch(0.97-0.99 0.005 <hue>)` (near-white, brand tinted)

3. **Gray tinting**:
   - Convert all pure grays to brand-tinted variants
   - Add chroma 0.005-0.01 at brand hue

4. **Contrast fixes**:
   - Measure each text/background pair
   - Adjust lightness until WCAG AA met (4.5:1 normal, 3:1 large)

5. **OKLCH conversion**:
   - Convert key palette colors from hex/hsl to oklch
   - Generate tint/shade scales in OKLCH for perceptual uniformity

6. **60-30-10 enforcement**:
   - Audit accent color usage, reduce to ~10%
   - Ensure neutral dominates at ~60%

**Dependency**: Should run before De-template (anti-slop fixes may need new colors).

---

## Typeset

**When**: Typography dimension score 0-2 or muddy hierarchy

**Strategy**:
1. **Font replacement**: Swap generic fonts for distinctive alternatives
   - Body: Plus Jakarta Sans, Instrument Sans, DM Sans, Geist
   - Display: Space Grotesk, Manrope, Fraunces
2. **Scale establishment**: Choose modular ratio (1.25 or 1.333 recommended), generate size scale
3. **Fluid sizing**: Add `clamp()` for h1-h3 display sizes
4. **Line length**: Add `max-width: 65ch` to prose containers
5. **Vertical rhythm**: Set line-height system (1.5 body, 1.2 headings)
6. **Font loading**: Add `font-display: swap` to all @font-face

**Dependency**: Run before Clarify (hierarchy depends on type scale).

---

## Arrange

**When**: Spacing dimension score 0-2 or arbitrary spacing values

**Strategy**:
1. **Scale creation**: Define 4pt base scale as CSS custom properties
2. **Value replacement**: Map arbitrary values to nearest scale value
3. **Rhythm introduction**: Tight (4-8px) within groups, comfortable (16-24px) between items, generous (48-96px) between sections
4. **Card flattening**: Remove nested cards, replace with spacing + subtle dividers
5. **Gap conversion**: Replace margin between siblings with gap on flex/grid parent
6. **Touch targets**: Ensure all interactive elements are 44x44px minimum

**Dependency**: Independent, but benefits from Colorize tokens being in place.

---

## Animate

**When**: Motion dimension score 0-2 or layout property animations

**Strategy**:
1. **Property fix**: Replace layout animations (width/height/margin/padding) with transform+opacity
2. **Easing fix**: Replace ease/linear/bounce with exponential curves
3. **Reduced-motion**: Add `@media (prefers-reduced-motion: reduce)` global rule
4. **Token system**: Create duration + easing custom properties
5. **Stagger cap**: Cap stagger at 10 items, 500ms total
6. **will-change**: Remove from CSS, document JS activation pattern

**Dependency**: Independent.

---

## Harden

**When**: Interaction states dimension score 0-2 or missing critical states

**Strategy**:
1. **Hover**: Add `:hover` with subtle visual change, wrap in `@media(hover:hover)`
2. **Focus**: Add `:focus-visible` with 2px solid accent ring, offset 2px
3. **Active**: Add `:active` with scale(0.97) or darker background
4. **Disabled**: Add `[disabled]` with opacity 0.5, cursor not-allowed
5. **Loading**: Add aria-busy pattern with spinner/skeleton
6. **Error/Success**: Add form validation visual states
7. **Focus ring**: Ensure 3:1 contrast against all adjacent colors
8. **Labels**: Replace placeholder-as-label with visible `<label>` elements
9. **Touch targets**: Pad interactive elements to 44px minimum

**Dependency**: Requires Colorize tokens for consistent state colors.

---

## Simplify (quieter + distill)

**When**: Visual noise, too many decorations, competing elements

**Strategy**:
1. Remove decorative elements that do not aid comprehension
2. Mute icon colors (reduce saturation/opacity)
3. Remove background decorations and unnecessary borders
4. Reduce shadow intensity
5. Simplify card borders (remove or lighten)
6. Remove sparkline decorations without data value

**Dependency**: Independent.

---

## Strengthen (bolder + delight)

**When**: Too bland, everything same weight, no emphasis

**Strategy**:
1. Increase primary element size by 1.5-2x
2. Add color saturation to primary CTA
3. Increase weight contrast (bold primary, regular secondary)
4. Add subtle micro-interactions (hover lift, active press)
5. Introduce one distinctive element (asymmetric layout, unexpected color, custom illustration)

**Dependency**: Requires Typeset and Colorize to be in place.

---

## Clarify (hierarchy)

**When**: Visual hierarchy dimension score 0-2 or fails squint test

**Strategy**:
1. Identify primary element, increase to 3:1 ratio over body
2. Use 2-3 hierarchy tools together (size + weight + color)
3. Group related content with proximity (smaller gaps within, larger between)
4. Reduce visual weight of competing secondary elements
5. Ensure only 1 primary CTA per viewport
6. Add progressive disclosure where appropriate

**Dependency**: Requires Typeset (size hierarchy) and Colorize (color hierarchy).

---

## Adapt (responsive)

**When**: Responsive dimension score 0-2 or broken mobile experience

**Strategy**:
1. Replace fixed widths with fluid (%, vw, fr, min/max/clamp)
2. Add missing breakpoints (640, 768, 1024, 1280px)
3. Fix overflow (horizontal scroll causes)
4. Fix mobile text sizes (minimum 14px)
5. Fix touch targets (minimum 44px)
6. Add container queries for component-level responsive
7. Restructure hidden content (adapt, don't hide)
8. Add viewport meta tag if missing

**Dependency**: Run last -- tests all other fixes at different viewports.

---

## Fix Order (Default)

When applying all strategies in a full polish cycle:

```
Phase 1: Foundation
  1. Colorize (token system + color fixes)
  2. Typeset (font + scale + fluid sizing)
  3. Arrange (spacing scale + layout)

Phase 2: Aesthetic
  4. De-template (anti-AI-slop cleanup)
  5. Simplify or Strengthen (as needed)

Phase 3: Interaction
  6. Animate (motion system)
  7. Harden (interaction states)

Phase 4: Structure
  8. Clarify (visual hierarchy)

Phase 5: Validation
  9. Adapt (responsive -- tests everything)
```
