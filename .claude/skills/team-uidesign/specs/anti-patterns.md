

# AI Slop Detection Catalog

20 anti-patterns that signal AI-generated or low-effort design. Reference this during research (visual quality baseline), design (avoidance), review (scoring), and implementation (validation).

## Severity Guide

| Severity | Meaning | Scoring Impact |
|----------|---------|----------------|
| P1 | Major -- immediately recognizable as AI slop | Dimension score capped at 1 |
| P2 | Minor -- common AI default, degrades quality | Dimension score capped at 2 |
| P3 | Polish -- subtle tell, acceptable in early iterations | Dimension score capped at 3 |

---

## 1. AI Color Palette -- P1

**Pattern**: Cyan-on-dark, purple-blue gradients, neon accent colors against dark backgrounds. The "AI dashboard" look.

**Detection**: Check for `oklch(... 250-280)` as primary + dark background, or gradient from purple to cyan/blue. Check for saturated neon accents (`chroma > 0.25`) on `lightness < 0.15` backgrounds.

**Fix**: Use brand-derived colors. Reduce chroma. Apply 60-30-10 rule. Tint neutrals toward brand hue.

---

## 2. Gradient Text for Impact -- P1

**Pattern**: `background-clip: text` with gradient fills on headings for visual flair.

**Detection**: Search for `background-clip: text` or `-webkit-background-clip: text` in stylesheets.

**Fix**: Use solid color with proper contrast. If emphasis needed, use weight or size, not gradient text.

---

## 3. Default Dark Mode with Glowing Accents -- P2

**Pattern**: Dark background as default with glowing/neon UI elements. No light mode alternative.

**Detection**: Check if dark theme is the only theme defined. Look for `box-shadow` with saturated colors (`0 0 Npx oklch(... 0.2+ ...)`).

**Fix**: Design light mode first. Dark mode as opt-in. Use subtle elevation shadows, not glows.

---

## 4. Glassmorphism Everywhere -- P1

**Pattern**: `backdrop-filter: blur()` on more than 2 components. Frosted glass effect as default surface treatment.

**Detection**: Count `backdrop-filter: blur` occurrences. Flag if > 2 distinct components use it.

**Fix**: Reserve glass effect for 1-2 overlay/modal surfaces max. Use solid or semi-transparent backgrounds elsewhere.

---

## 5. Hero Metric Layout -- P2

**Pattern**: Big number + small label arranged in rows/grids. The "SaaS dashboard hero" pattern with 3-4 metric cards.

**Detection**: Look for repeated pattern of large font-size number + small label in card grids at page top.

**Fix**: Show metrics in context of their meaning. Use sparklines with real data, comparisons, or trends instead of isolated numbers.

---

## 6. Identical Card Grids -- P2

**Pattern**: 3+ cards with identical dimensions, same padding, same shadow, same structure. No visual hierarchy.

**Detection**: Count card components with identical styling. Flag if 3+ share exact same dimensions and no hierarchy differentiation.

**Fix**: Vary card sizes by importance. Use a featured/primary card. Apply visual hierarchy through size or position.

---

## 7. Nested Cards -- P2

**Pattern**: Card inside card -- border/shadow inside border/shadow. Creates visual clutter.

**Detection**: Check for components with `border`/`box-shadow` containing child components that also have `border`/`box-shadow`.

**Fix**: Flatten hierarchy. Use spacing and subtle dividers instead of nested containers.

---

## 8. Generic Fonts -- P2

**Pattern**: Inter, Roboto, Open Sans, Lato, Montserrat, or Arial as the primary font. Zero typographic identity.

**Detection**: Check `font-family` declarations for the generic font list.

**Fix**: Choose from recommended fonts: Instrument Sans, Plus Jakarta Sans, DM Sans, Space Grotesk, Fraunces.

---

## 9. Rounded Rectangles + Generic Drop Shadows -- P3

**Pattern**: More than 5 elements with identical `border-radius` and generic `box-shadow` (e.g., `0 1px 3px rgba(0,0,0,0.1)`).

**Detection**: Count elements sharing identical `border-radius` + `box-shadow` values. Flag if > 5.

**Fix**: Vary border-radius by component type (buttons vs cards vs modals). Use layered shadows with tinted colors.

---

## 10. Large Icons Above Every Heading -- P2

**Pattern**: Decorative icon placed above every section heading. Adds visual noise without meaning.

**Detection**: Check for repeated icon + heading pattern across 3+ sections.

**Fix**: Use icons sparingly and only where they add meaning. Prefer inline icons at heading size, not oversized decorative ones.

---

## 11. One-Side Border Accent -- P3

**Pattern**: `border-left: 3px solid var(--accent)` on cards or sections as the sole visual treatment.

**Detection**: Search for one-sided border declarations on 3+ components.

**Fix**: Use spacing, background tinting, or typography to create differentiation instead.

---

## 12. Decorative Sparklines -- P2

**Pattern**: Tiny charts with no axis labels, no data context, no interactivity. Pure decoration.

**Detection**: Check for chart/sparkline components without accessible labels, axis values, or data source.

**Fix**: Either make charts meaningful (labels, context, interaction) or remove them. No decorative data visualization.

---

## 13. Bounce/Elastic Easing -- P2

**Pattern**: Bounce or elastic easing on UI transitions. Feels toylike and unprofessional.

**Detection**: Search for `bounce`, `elastic`, `cubic-bezier` with values > 1.0 in the second or fourth parameter.

**Fix**: Use ease-out-quart `cubic-bezier(0.25, 1, 0.5, 1)` as default. See design-standards.md Motion section.

---

## 14. Redundant Copy -- P3

**Pattern**: Heading restated in the body text immediately below. "Our Features" followed by "Here are our features."

**Detection**: Compare heading text to first sentence of body. Flag if > 60% word overlap.

**Fix**: Body text should expand on the heading, not repeat it. Each element earns its space.

---

## 15. All Buttons Primary -- P1

**Pattern**: Every button is the same filled/primary style. No visual hierarchy between actions.

**Detection**: Count button variants. Flag if > 80% of buttons share the same style (all filled, all same color).

**Fix**: 1 primary CTA per viewport. Secondary = outline. Tertiary = text link. See design-standards.md Visual Hierarchy.

---

## 16. Everything Centered -- P2

**Pattern**: Body text, lists, and form labels all center-aligned. Looks "designed" but kills readability.

**Detection**: Check for `text-align: center` on body text, lists, or form elements (not just headings).

**Fix**: Left-align body text. Center only headings, hero text, and short labels. Reading follows left edge.

---

## 17. Same Spacing Everywhere -- P2

**Pattern**: More than 70% of spacing values are identical. No rhythm variation.

**Detection**: Audit spacing tokens usage. Flag if > 70% of `gap`, `padding`, `margin` values use the same token.

**Fix**: Apply rhythm: tight (4-8px) within groups, comfortable (16-24px) between items, generous (48-96px) between sections.

---

## 18. Monospace as Tech Aesthetic -- P3

**Pattern**: Monospace font used on non-code content (headings, labels, body text) for "techy" feel.

**Detection**: Check for monospace `font-family` on elements that are not `code`, `pre`, `kbd`, or `samp`.

**Fix**: Reserve monospace for code. Use Space Grotesk or similar geometric sans if tech aesthetic is desired.

---

## 19. Modal Overuse -- P3

**Pattern**: More than 3 modals in a flow for non-critical actions. Interrupts flow unnecessarily.

**Detection**: Count modal/dialog components. Flag if > 3 modals exist for non-destructive actions.

**Fix**: Use inline expansion, drawers, or page navigation. Reserve modals for confirmations and critical decisions.

---

## 20. Pure Black or Pure White -- P1

**Pattern**: Using `#000000` or `#ffffff` (or `rgb(0,0,0)` / `rgb(255,255,255)`). Harsh contrast, unnatural.

**Detection**: Search for `#000`, `#fff`, `#000000`, `#ffffff`, `rgb(0,0,0)`, `rgb(255,255,255)` in stylesheets and tokens.

**Fix**: Use tinted neutrals. Darkest: `oklch(0.08 0.010 <hue>)`. Lightest: `oklch(0.98 0.005 <hue>)`.
