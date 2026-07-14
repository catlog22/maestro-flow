

# WCAG 2.1 Criteria Matrix

Reference matrix for visual accessibility audit. Maps WCAG success criteria to audit methods and responsible roles.

## Criteria Covered by This Team

| Criterion | Level | Automated | Manual | Check Method | Primary Role |
|-----------|-------|-----------|--------|-------------|-------------|
| 1.4.3 Contrast (Minimum) | AA | Yes | - | Color ratio calculation (4.5:1 normal, 3:1 large) | color-auditor |
| 1.4.6 Contrast (Enhanced) | AAA | Yes | - | Color ratio calculation (7:1 normal, 4.5:1 large) | color-auditor |
| 1.4.11 Non-text Contrast | AA | Partial | Yes | UI component border/fill contrast >= 3:1 | color-auditor |
| 1.4.4 Resize Text | AA | Yes | - | 200% zoom, no content loss | typo-auditor |
| 1.4.12 Text Spacing | AA | Partial | Yes | Override line-height 1.5x, letter-spacing 0.12em, word-spacing 0.16em | typo-auditor |
| 2.1.1 Keyboard | A | Partial | Yes | Tab through all interactive elements | focus-auditor |
| 2.1.2 No Keyboard Trap | A | - | Yes | Tab can escape all contexts (except intentional traps with Escape) | focus-auditor |
| 2.4.1 Bypass Blocks | A | Yes | - | Skip link present and functional | focus-auditor |
| 2.4.3 Focus Order | A | - | Yes | Logical tab sequence | focus-auditor |
| 2.4.7 Focus Visible | AA | Partial | Yes | Visible focus indicator on all interactive elements | focus-auditor |
| 2.4.11 Focus Not Obscured (Min) | AA | - | Yes | Focus indicator not hidden by overlays, sticky headers | focus-auditor |
| 2.5.8 Target Size (Minimum) | AA | Yes | - | Minimum 24x24px CSS pixel touch targets | focus-auditor |
| 4.1.2 Name, Role, Value | A | Yes | - | ARIA roles, labels, and states on interactive elements | focus-auditor |
| 4.1.3 Status Messages | AA | Partial | Yes | aria-live regions for dynamic status updates | focus-auditor |

## Audit Method Legend

| Method | Description |
|--------|-------------|
| Automated | Can be verified programmatically (CSS parsing, contrast calculation) |
| Manual | Requires human judgment or runtime interaction |
| Partial | Automated detection of presence, manual verification of correctness |

## Criterion Details

### 1.4.3 Contrast (Minimum) - AA

**Requirement**: Text and images of text have a contrast ratio of at least 4.5:1 (3:1 for large text).

**Large text definition**: >= 18pt (24px) or >= 14pt bold (18.66px bold).

**Exceptions**: Decorative text, logos, inactive UI components.

**Check**: Extract foreground/background colors -> calculate contrast ratio -> compare against threshold.

### 1.4.6 Contrast (Enhanced) - AAA

**Requirement**: Text has contrast ratio of at least 7:1 (4.5:1 for large text).

**Check**: Same as 1.4.3 but with higher thresholds.

### 1.4.11 Non-text Contrast - AA

**Requirement**: UI components and graphical objects have at least 3:1 contrast against adjacent colors.

**Applies to**: Buttons, inputs, icons, focus indicators, charts, custom controls.

**Check**: Extract border/fill colors of UI components -> calculate contrast against background.

### 1.4.4 Resize Text - AA

**Requirement**: Text can be resized up to 200% without loss of content or functionality.

**Check**: Zoom to 200% -> verify no horizontal scrolling, no content clipping, no overlap.

### 1.4.12 Text Spacing - AA

**Requirement**: Content must remain readable when user overrides:
- Line height to 1.5x font size
- Paragraph spacing to 2x font size
- Letter spacing to 0.12x font size
- Word spacing to 0.16x font size

**Check**: Apply overrides via JavaScript/CSS -> verify no content loss or overlap.

### 2.1.1 Keyboard - A

**Requirement**: All functionality available via keyboard (Enter, Space, Tab, Arrow keys, Escape).

**Check**: Tab to every interactive element -> activate with Enter/Space -> navigate composites with Arrows.

### 2.1.2 No Keyboard Trap - A

**Requirement**: Keyboard focus can be moved away from any component using standard keys.

**Exception**: Modal dialogs that trap focus intentionally (must have Escape to exit).

**Check**: Tab forward and backward through all elements -> verify escape from all containers.

### 2.4.1 Bypass Blocks - A

**Requirement**: Mechanism to bypass repeated content blocks (skip links, landmarks, headings).

**Check**: Verify skip link as first focusable element, target exists, focus moves correctly.

### 2.4.3 Focus Order - A

**Requirement**: Focus order preserves meaning and operability (logical sequence).

**Check**: Tab through page -> verify order matches visual/reading order.

### 2.4.7 Focus Visible - AA

**Requirement**: Keyboard focus indicator is visible on all interactive elements.

**Check**: Tab to each element -> verify visible outline/border/shadow change.

### 2.4.11 Focus Not Obscured (Minimum) - AA

**Requirement**: Focused element is not entirely hidden by other content (sticky headers, overlays, banners).

**Check**: Tab through elements near sticky/fixed positioned elements -> verify focus indicator partially visible.

### 2.5.8 Target Size (Minimum) - AA

**Requirement**: Interactive targets are at least 24x24 CSS pixels, or have adequate spacing.

**Exceptions**: Inline links within text, user agent default controls, essential presentation.

**Check**: Measure interactive element dimensions -> verify >= 24x24px or adequate spacing.

### 4.1.2 Name, Role, Value - A

**Requirement**: All UI components have accessible name, role, and state programmatically determined.

**Check**: Verify interactive elements have:
- Accessible name (text content, aria-label, aria-labelledby)
- Appropriate role (native HTML or ARIA role)
- Current state (aria-expanded, aria-pressed, aria-selected, aria-checked)

### 4.1.3 Status Messages - AA

**Requirement**: Status messages can be programmatically determined through role or properties without receiving focus.

**Check**: Verify dynamic content updates use `aria-live` or appropriate roles (`status`, `alert`, `log`).
