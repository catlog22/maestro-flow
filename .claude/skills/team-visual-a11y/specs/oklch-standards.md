

# OKLCH Color Accessibility Standards

Reference guide for OKLCH-based perceptual color analysis. Used by color-auditor and fix-implementer roles.

## OKLCH Basics

```
oklch(Lightness% Chroma Hue)
```

- **Lightness (L)**: 0% (black) to 100% (white) -- perceptually uniform
- **Chroma (C)**: 0 (achromatic/gray) to ~0.37 (maximum saturation) -- perceptual colorfulness
- **Hue (H)**: 0-360 degrees -- color wheel angle

OKLCH is perceptually uniform: equal numeric changes produce equal perceived changes, unlike HSL/RGB.

## Lightness Guidelines

| Element | L Range | Rationale |
|---------|---------|-----------|
| Dark text on light background | L <= 40% | Ensures sufficient contrast against light surfaces |
| Light background for text | L >= 90% | Provides clean reading surface |
| Accent colors (interactive) | L 50-65% | Vibrant but readable |
| Disabled/muted elements | L 55-70% | Intentionally reduced contrast (with care) |
| Dark mode text | L >= 85% | Light text on dark background |
| Dark mode background | L <= 20% | Dark surface for light text |

## Chroma Guidelines

| Use Case | C Range | Notes |
|----------|---------|-------|
| Neutral/text colors | C = 0 | Pure achromatic for maximum readability |
| Subtle warm/cool tint | C = 0.005-0.02 | Adds warmth without color distraction |
| Standard accent | C = 0.1-0.15 | Good balance of color and readability |
| Vibrant accent | C = 0.2-0.25 | Use sparingly, max 1-2 per palette |
| Maximum saturation | C > 0.25 | Avoid for text; OK for decorative only |

## Impeccable Palette Reference

```css
/* Neutrals */
--color-ink:       oklch(10% 0 0);      /* Primary text */
--color-paper:     oklch(98% 0 0);      /* Primary background */
--color-cream:     oklch(96% 0.005 350); /* Warm background variant */
--color-charcoal:  oklch(25% 0 0);      /* Secondary text */
--color-ash:       oklch(55% 0 0);      /* Muted/disabled text */
--color-mist:      oklch(92% 0 0);      /* Border/divider */

/* Accent */
--color-accent:       oklch(60% 0.25 350); /* Primary action */
--color-accent-hover: oklch(52% 0.25 350); /* Hover state (darker) */
```

### Palette Analysis

| Name | L | C | H | Role | Contrast vs paper (98%) |
|------|---|---|---|------|------------------------|
| ink | 10% | 0 | 0 | Body text | ~15.4:1 (AAA) |
| charcoal | 25% | 0 | 0 | Secondary text | ~9.5:1 (AAA) |
| ash | 55% | 0 | 0 | Muted text | ~3.8:1 (AA large only) |
| accent | 60% | 0.25 | 350 | Interactive | ~3.4:1 (large text / non-text only) |
| accent-hover | 52% | 0.25 | 350 | Hover state | ~4.6:1 (AA) |

## Contrast Verification Methods

### WCAG 2.1 Contrast Ratio

Formula: `(L1 + 0.05) / (L2 + 0.05)` where L1, L2 are relative luminances (L1 > L2).

Convert OKLCH -> sRGB -> linear RGB -> relative luminance:
`L_rel = 0.2126 * R_linear + 0.7152 * G_linear + 0.0722 * B_linear`

| Text Type | AA | AAA |
|-----------|-----|-----|
| Normal text (< 18pt / < 14pt bold) | >= 4.5:1 | >= 7:1 |
| Large text (>= 18pt / >= 14pt bold) | >= 3:1 | >= 4.5:1 |
| Non-text (UI components, icons) | >= 3:1 | >= 3:1 |

### APCA Contrast (Advanced)

APCA (Accessible Perceptual Contrast Algorithm) uses OKLCH lightness for perceptual accuracy.

Lc (Lightness contrast) values:

| Use Case | Minimum Lc | Description |
|----------|-----------|-------------|
| Body text (14-16px) | >= 75 | Primary reading content |
| Content text (18px) | >= 60 | Secondary content |
| Large text (24px+) | >= 45 | Headings, display |
| Non-text elements | >= 30 | Icons, borders, focus indicators |
| Placeholder/disabled | >= 15 | Intentionally muted |

### Focus Indicator Contrast

Focus indicators must have >= 3:1 contrast against adjacent colors:
- Outline color vs element background
- Outline color vs surrounding page background
- Both must pass

## Color Blindness Reference

### Confusion Lines

| Type | Prevalence | Confuses | Safe Alternatives |
|------|-----------|----------|-------------------|
| Protanopia (red-blind) | ~1% male | Red/green, red/brown | Use blue/orange, add patterns |
| Deuteranopia (green-blind) | ~5% male | Green/red, green/brown | Use blue/orange, add patterns |
| Tritanopia (blue-blind) | ~0.01% | Blue/yellow | Use red/green pairs (opposite) |
| Achromatopsia (no color) | ~0.003% | All chromatic | Rely on lightness difference only |

### Safe Color Pairs

Always ensure information is not conveyed by color alone. Safe strategies:
- Use lightness difference (>= 40% L difference)
- Add text labels, icons, or patterns alongside color
- Use blue + orange (safe for most color blindness types)
- Avoid red-only or green-only indicators

## Dark Mode Color Mapping

When converting light mode to dark mode:

| Light Mode | Dark Mode | Rule |
|-----------|----------|------|
| Text L <= 40% | Text L >= 85% | Invert lightness range |
| Background L >= 90% | Background L <= 20% | Invert lightness range |
| Accent L 50-65% | Accent L 60-75% | Slight lightness increase |
| Border L ~92% | Border L ~25% | Invert proportionally |

Maintain same hue and similar chroma; adjust lightness to preserve contrast ratios.
