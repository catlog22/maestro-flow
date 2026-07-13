

# Anti-Pattern Catalog

Complete catalog of UI design anti-patterns from Impeccable's design audit knowledge. Used by scanner for detection and optimizer for remediation.

## The AI Slop Test

> "If you showed this to someone and said 'AI made this,' would they believe you immediately? If yes, that is the problem."

AI-generated UIs share recognizable fingerprints. These are not inherently bad techniques -- they become problems when used as defaults without intentional design decisions. The issue is not the technique itself but the lack of thought behind it.

## AI Slop Tells (20 Items)

### 1. AI Color Palette
**Pattern**: Cyan-on-dark (#00d4ff, #06b6d4), purple-to-blue gradients (#8b5cf6 to #3b82f6), neon accents on dark backgrounds.
**Why it is a tell**: Every AI model defaults to the same "futuristic" palette. It signals zero design intent.
**Detection**: Search for cyan/purple/neon values on dark backgrounds. Check if palette could be from any Tailwind dark template.
**Severity**: P1

### 2. Gradient Text for Impact
**Pattern**: `background-clip: text` + gradient applied to metrics, headings, or hero text.
**Why it is a tell**: AI uses gradient text as a crutch to make numbers and titles feel "premium." Real typography achieves emphasis through weight, size, and space.
**Detection**: Search for `background-clip: text` or `-webkit-background-clip: text`.
**Severity**: P1

### 3. Default Dark Mode with Glowing Accents
**Pattern**: Dark background (gray-900/950) as default with glowing/neon accent colors. No light mode offered or light mode is an afterthought.
**Why it is a tell**: Dark mode with glow effects requires no real color decisions. It hides contrast problems and creates false sophistication.
**Detection**: Check default theme. If dark with glow `box-shadow` or neon colors, flag it.
**Severity**: P2

### 4. Glassmorphism Everywhere
**Pattern**: `backdrop-filter: blur()`, glass cards, glow borders (`box-shadow: 0 0 Xpx <color>`), used decoratively on multiple components.
**Why it is a tell**: Glassmorphism is a valid technique for specific use cases (overlays, elevated surfaces). AI applies it everywhere as the default "modern" aesthetic.
**Detection**: Count instances of `backdrop-filter: blur`. If > 2 components use it without functional reason, flag.
**Severity**: P1

### 5. Hero Metric Layout
**Pattern**: Big number (32-48px) + small label underneath + supporting stats in a row + gradient accent or colored bar.
**Why it is a tell**: This is the universal "AI dashboard" template. Every AI-generated analytics page uses this exact layout.
**Detection**: Pattern match for large-number + small-label structures repeated in a metrics row/grid.
**Severity**: P2

### 6. Identical Card Grids
**Pattern**: Same-sized cards with icon + heading + body text repeated 3-6 times in a grid. Equal width, equal height, equal spacing.
**Why it is a tell**: Real content varies in importance. AI treats all items as equally important because it has no content strategy.
**Detection**: Grid of 3+ cards with identical structure and sizing. No featured/hero card.
**Severity**: P2

### 7. Nested Cards
**Pattern**: Cards inside cards. `.card > .card-body > .inner-card`. Multiple layers of bordered containers.
**Why it is a tell**: AI nests containers to create visual "depth." It actually creates noise and makes hierarchy unclear.
**Detection**: Search for elements with border/shadow inside elements with border/shadow. Two levels of containment.
**Severity**: P2

### 8. Generic Fonts
**Pattern**: Inter, Roboto, Arial, Open Sans, Lato, Montserrat, system-ui used as primary font without intentional choice.
**Why it is a tell**: These are defaults. AI picks them because they are safe. Safe means forgettable.
**Detection**: Check `font-family` declarations. If primary font is in the generic list, flag.
**Severity**: P2

### 9. Rounded Rectangles with Generic Drop Shadows
**Pattern**: `border-radius: 8-16px` combined with `box-shadow: 0 1-4px 6-24px rgba(0,0,0,0.05-0.15)` on every container.
**Why it is a tell**: The "safe shape." Every AI output uses this exact combination because it is never wrong -- but never distinctive either.
**Detection**: Count elements with both border-radius (8-16px range) and generic box-shadow. If > 5, flag.
**Severity**: P3

### 10. Large Icons Above Every Heading
**Pattern**: 24-48px icons with rounded corners or colored backgrounds placed above every heading or card title.
**Why it is a tell**: AI uses icons as visual filler. Real design uses icons sparingly where they aid comprehension.
**Detection**: Pattern match for icon elements directly above heading elements. If repeated 3+ times, flag.
**Severity**: P2

### 11. One-Side Border Accent
**Pattern**: `border-left: 3-4px solid <accent-color>` or `border-top` used as the primary accent technique on cards/containers.
**Why it is a tell**: Lazy accent. It is a shortcut to add "personality" without making real design decisions.
**Detection**: Search for `border-left: [2-5]px solid` or `border-top: [2-5]px solid` with accent colors.
**Severity**: P3

### 12. Decorative Sparklines
**Pattern**: Tiny charts, mini-graphs, or trend indicators that look sophisticated but convey no actionable data. Often in card corners.
**Why it is a tell**: AI adds charts to appear data-driven. If the chart has no axis labels, no values, and no interaction, it is decoration.
**Detection**: Small SVG/canvas charts (<100px) without labels, tooltips, or legends.
**Severity**: P2

### 13. Bounce/Elastic Easing
**Pattern**: `cubic-bezier(0.68, -0.55, 0.265, 1.55)`, spring animations, or any easing that overshoots.
**Why it is a tell**: Bounce easing was trendy circa 2015. AI still defaults to it for "playfulness." It feels dated and tacky in modern UI.
**Detection**: Search for cubic-bezier with negative values or spring keyword.
**Severity**: P2

### 14. Redundant Copy
**Pattern**: Intro paragraphs that restate the heading. "Welcome to your Dashboard. This is your dashboard where you can see..."
**Why it is a tell**: AI generates text to fill space. Real UX uses headings as the message and body for additional context only.
**Detection**: Compare heading text with first paragraph. If >50% word overlap, flag.
**Severity**: P3

### 15. All Buttons Primary
**Pattern**: Every button is filled/primary color. No ghost buttons, text links, outline buttons, or secondary variants.
**Why it is a tell**: AI makes everything important. Real design creates hierarchy: 1 primary, 1-2 secondary, rest tertiary.
**Detection**: Check button variants. If all buttons have same fill/color treatment, flag.
**Severity**: P1

### 16. Everything Centered
**Pattern**: `text-align: center` or `justify-content: center` / `align-items: center` on most content blocks including body text.
**Why it is a tell**: Centering is the safe choice. Real design uses left-alignment for readability, centering only for specific elements (headings, hero).
**Detection**: Count centered text blocks. If body text is centered, flag. If > 60% of content sections are centered, flag.
**Severity**: P2

### 17. Same Spacing Everywhere
**Pattern**: Identical padding/margin on all cards, sections, and components. No variation in spacing rhythm.
**Why it is a tell**: AI applies uniform spacing because it has no sense of content grouping or visual rhythm.
**Detection**: Extract all padding/margin values. If > 70% are the same value, flag.
**Severity**: P2

### 18. Monospace as Tech Aesthetic
**Pattern**: Monospace font (Fira Code, JetBrains Mono, Source Code Pro) used for non-code content to appear "techy."
**Why it is a tell**: AI equates monospace with "developer tool" aesthetic. Real design uses monospace only for actual code.
**Detection**: Monospace `font-family` on non-`<code>`, non-`<pre>` elements.
**Severity**: P3

### 19. Modal Overuse
**Pattern**: Modals for confirmations, settings changes, form entries, when inline editing, drawers, or expandable sections would work.
**Why it is a tell**: Modals are AI's default "interaction" pattern because they are self-contained. Real UX considers context loss and flow interruption.
**Detection**: Count modal/dialog components. If > 3 modals for non-critical actions, flag.
**Severity**: P3

### 20. Pure Black or Pure White
**Pattern**: `#000000` or `#ffffff` used as primary background/text colors without any tint.
**Why it is a tell**: Pure black and white create harsh contrast and feel sterile. Real design tints toward a brand hue.
**Detection**: Search for `#000`, `#000000`, `rgb(0,0,0)`, `#fff`, `#ffffff`, `rgb(255,255,255)` in styles.
**Severity**: P1

## Scoring Guide

| Score | Tells Present | Label |
|-------|---------------|-------|
| 0 | 5+ tells | AI Slop Gallery |
| 1 | 3-4 tells | Heavy AI Influence |
| 2 | 1-2 tells | Some AI Tells |
| 3 | Subtle traces only | Mostly Clean |
| 4 | Zero tells, distinctive | Genuinely Intentional |
