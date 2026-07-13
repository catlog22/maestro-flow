

# Typography Accessibility Standards

Reference guide for typography readability analysis. Used by typo-auditor and fix-implementer roles.

## Font Stack Hierarchy

| Purpose | Category | Example | Usage |
|---------|----------|---------|-------|
| Display | Serif | Cormorant Garamond, Georgia, serif | Headings, hero text |
| Body | Sans-serif | Instrument Sans, Inter, system-ui, sans-serif | Paragraphs, UI text |
| Mono | Monospace | Space Grotesk, Fira Code, monospace | Code blocks, labels |

### System Font Stack (Fallback)

```css
--font-body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
--font-mono: ui-monospace, "Cascadia Code", "Fira Code", Menlo, monospace;
```

## Responsive Size Scale

### clamp() Formula Pattern

```css
/* clamp(minimum, preferred, maximum) */
/* preferred = slope * 100vw + intercept */
/* slope = (max - min) / (max-viewport - min-viewport) */
```

### Recommended Scale

| Element | clamp() Value | Min (320px) | Max (1400px) | WCAG |
|---------|--------------|-------------|-------------|------|
| Hero | `clamp(2.5rem, 7vw, 4.5rem)` | 40px | 72px | -- |
| Section title | `clamp(1.75rem, 4vw, 2.5rem)` | 28px | 40px | -- |
| H1 | `clamp(2rem, 5vw, 3rem)` | 32px | 48px | -- |
| H2 | `clamp(1.5rem, 3vw, 2.25rem)` | 24px | 36px | -- |
| H3 | `clamp(1.25rem, 2vw, 1.75rem)` | 20px | 28px | -- |
| Body | `clamp(1rem, 1vw + 0.875rem, 1.25rem)` | 16px | 20px | 1.4.4 |
| Small/caption | 14px (fixed floor) | 14px | 14px | 1.4.4 |

### Absolute Minimums

| Element | Minimum | Rationale |
|---------|---------|-----------|
| Body text | 16px | WCAG 1.4.4 baseline readability |
| Small text / caption | 14px | Absolute floor for legibility |
| Interactive labels | 14px | Touch/click target readability |

**Never**: Set body text below 14px at any viewport width.

## Line Height Scale

| Element Type | Range | Optimal | Rationale |
|-------------|-------|---------|-----------|
| Body text | 1.5 - 1.75 | 1.625 | WCAG 1.4.12, optimal readability |
| Headings | 1.1 - 1.3 | 1.2 | Tight for visual impact, still readable |
| Code blocks | 1.5 - 1.7 | 1.6 | Generous for scanning |
| Buttons/labels | 1.2 - 1.5 | 1.3 | Compact UI element |
| Lists | 1.4 - 1.6 | 1.5 | Slightly tighter than body |

### Line Height Rules

- Use unitless values (not px or em) for proper inheritance
- `line-height: 1.5` (unitless) is preferred over `line-height: 24px` (fixed)
- WCAG 1.4.12 requires text to remain readable at 1.5x font-size line-height

## Letter Spacing Scale

| Element Type | Range | Optimal | Notes |
|-------------|-------|---------|-------|
| Display headings | -0.02em to 0 | -0.015em | Tight for visual weight |
| Body text | 0 (default) | 0 | Browser default is optimal |
| Uppercase labels | 0.05em - 0.1em | 0.08em | Open for legibility |
| Monospace code | 0.08em - 0.15em | 0.1em | Wide for character distinction |
| Small caps | 0.05em - 0.08em | 0.06em | Slight opening |

### WCAG 1.4.12 Override Requirements

Content must remain readable when user applies:
- Letter spacing: 0.12em
- Word spacing: 0.16em
- These overrides should not cause content overflow or overlap

## Reading Width

| Metric | Optimal | Acceptable | Flag |
|--------|---------|-----------|------|
| Characters per line | 66ch | 45-75ch | < 45 (too narrow) or > 75 (too wide) |
| Container max-width | 65ch | 60ch-75ch | > 80ch |
| Content column width | Up to 900px | Up to 1000px | > 1000px without columns |

### Implementation

```css
/* Preferred: ch-based */
.content { max-width: 70ch; }

/* Alternative: px-based */
.content { max-width: 700px; }

/* With centering */
.content {
  max-width: 70ch;
  margin-inline: auto;
  padding-inline: 1rem;
}
```

## Font Loading Strategy

### font-display Values

| Value | Behavior | Recommended For |
|-------|----------|----------------|
| `swap` | Show fallback immediately, swap when loaded | Body text |
| `optional` | Show fallback, swap only if already cached | Display/decorative fonts |
| `fallback` | Brief invisible period (~100ms), then fallback | Important fonts |
| `block` | Invisible text up to 3s | Avoid for body text |
| `auto` | Browser decides | Avoid (unpredictable) |

### Best Practices

```css
/* Body font: swap for immediate readability */
@font-face {
  font-family: "Body Font";
  src: url("body.woff2") format("woff2");
  font-display: swap;
}

/* Display font: optional to prevent layout shift */
@font-face {
  font-family: "Display Font";
  src: url("display.woff2") format("woff2");
  font-display: optional;
}
```

### Preloading Critical Fonts

```html
<link rel="preload" href="/fonts/body.woff2" as="font" type="font/woff2" crossorigin>
```

### Fallback Stack Requirements

- Every custom font must have a system fallback
- Fallback should have similar metrics (x-height, width) to minimize layout shift
- Use `size-adjust`, `ascent-override`, `descent-override` for metric matching

## Responsive Typography Checklist

| # | Check | Standard | Method |
|---|-------|----------|--------|
| 1 | Body text >= 16px at 320px | WCAG 1.4.4 | Computed style at mobile viewport |
| 2 | No text below 14px at any viewport | Best practice | Search for font-size values |
| 3 | clamp() min >= 14px | Best practice | Parse clamp() functions |
| 4 | Line-height unitless | Best practice | Search for px/em line-height |
| 5 | Body line-height 1.5-1.75 | WCAG 1.4.12 | Computed style check |
| 6 | Reading width 45-75ch | Best practice | Measure container + font size |
| 7 | font-display: swap on body | Best practice | Parse @font-face rules |
| 8 | System fallback defined | Best practice | Parse font-family stacks |
| 9 | 200% zoom no overflow | WCAG 1.4.4 | Zoom test |
| 10 | Text spacing override safe | WCAG 1.4.12 | Apply overrides, check layout |
