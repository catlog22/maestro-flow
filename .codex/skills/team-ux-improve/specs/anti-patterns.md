

# AI Slop Detection Catalog

20 visual anti-patterns commonly produced by AI code generation. Use during scanning to flag design quality issues.

### 1. AI Color Palette
- **Pattern**: Cyan (#00d4ff, #06b6d4), purple-blue gradients on dark backgrounds as default aesthetic
- **Detection**: Search for cyan/teal hex values, linear-gradient with blue-purple stops on dark bg
- **Severity**: P1

### 2. Gradient Text
- **Pattern**: `background-clip: text` + `-webkit-text-fill-color: transparent` on headings or metric values
- **Detection**: Grep for `background-clip:\s*text` or `-webkit-background-clip:\s*text`
- **Severity**: P1

### 3. Default Dark Mode + Glow
- **Pattern**: Dark background (#0a0a0a, #111) with neon accent colors and box-shadow glow effects
- **Detection**: Dark bg colors + box-shadow with colored spread on interactive elements
- **Severity**: P2

### 4. Glassmorphism Everywhere
- **Pattern**: `backdrop-filter: blur()` applied to more than 2 components
- **Detection**: Count occurrences of `backdrop-filter:\s*blur` across components
- **Severity**: P1

### 5. Hero Metric Layout
- **Pattern**: Large number + small label arranged in card grid, dashboard-style metrics as default layout
- **Detection**: Pattern of large font-size number + small text label repeated 3+ times in grid
- **Severity**: P2

### 6. Identical Card Grids
- **Pattern**: 3+ cards with identical size, structure, and visual weight
- **Detection**: Repeated card components with same dimensions and no visual differentiation
- **Severity**: P2

### 7. Nested Cards
- **Pattern**: Border/shadow container inside another border/shadow container
- **Detection**: Card component rendered inside another card component, nested border-radius + box-shadow
- **Severity**: P2

### 8. Generic Fonts
- **Pattern**: Inter, Roboto, Open Sans, Lato, Montserrat, Arial as primary font-family
- **Detection**: Grep font-family declarations for generic font names
- **Severity**: P2

### 9. Rounded Rect + Generic Shadow
- **Pattern**: `border-radius: 8-16px` + `box-shadow: 0 1-4px ...` on more than 5 elements
- **Detection**: Count elements with both border-radius and box-shadow, flag if >5
- **Severity**: P3

### 10. Large Icons Above Every Heading
- **Pattern**: Decorative icon/emoji placed above section headings, repeated 3+ times
- **Detection**: Icon component or SVG immediately preceding heading elements, 3+ occurrences
- **Severity**: P2

### 11. One-Side Border Accent
- **Pattern**: `border-left: 3-4px solid <accent>` as visual accent on cards/sections
- **Detection**: Grep for `border-left:\s*\d+px\s+solid` repeated across components
- **Severity**: P3

### 12. Decorative Sparklines
- **Pattern**: Tiny inline charts without axis labels, data values, or interactive tooltips
- **Detection**: Small chart components (<100px height) without label/tooltip props
- **Severity**: P2

### 13. Bounce/Elastic Easing
- **Pattern**: `cubic-bezier` with negative control point values, spring/bounce animation keywords
- **Detection**: Grep for `cubic-bezier\([^)]*-` or animation names containing bounce/spring/elastic
- **Severity**: P2

### 14. Redundant Copy
- **Pattern**: Heading text restated in immediately following body paragraph with >50% word overlap
- **Detection**: Compare heading text with first paragraph text for word overlap
- **Severity**: P3

### 15. All Buttons Primary
- **Pattern**: Every button uses same filled/accent treatment, no visual hierarchy
- **Detection**: All button variants resolve to same background-color, no secondary/tertiary variants
- **Severity**: P1

### 16. Everything Centered
- **Pattern**: Body text centered (`text-align: center`), more than 60% of sections centered
- **Detection**: Count `text-align: center` on non-heading, non-hero elements
- **Severity**: P2

### 17. Same Spacing Everywhere
- **Pattern**: >70% of padding/margin values are identical (e.g., all `p-4` or `p-6`)
- **Detection**: Extract padding/margin values, check distribution uniformity
- **Severity**: P2

### 18. Monospace as Tech Aesthetic
- **Pattern**: Monospace font applied to non-code elements (headings, labels, navigation)
- **Detection**: `font-family: monospace` or code font on non-`<code>`/`<pre>` elements
- **Severity**: P3

### 19. Modal Overuse
- **Pattern**: More than 3 modal dialogs for non-critical interactions (settings, confirmations, info)
- **Detection**: Count modal/dialog component usages, check trigger context
- **Severity**: P3

### 20. Pure Black/White
- **Pattern**: #000, #fff, rgb(0,0,0), rgb(255,255,255) as primary background or text colors
- **Detection**: Grep for exact #000, #fff, rgb(0,0,0), rgb(255,255,255) in color/background properties
- **Severity**: P1
