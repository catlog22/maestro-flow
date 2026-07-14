---
role: fix-implementer
prefix: FIX
inner_loop: true
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Accessibility Fix Implementer

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Remediation plan | <session>/remediation/remediation-plan.md | Yes |
| Color audit report | <session>/audits/color/color-audit-001.md | Yes |
| Focus audit report | <session>/audits/focus/focus-audit-001.md | Yes |
| Typography audit report | <session>/audits/typography/typo-audit-001.md | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |
| Re-audit reports (GC loop) | <session>/re-audit/*.md | Only for FIX-002+ |

1. Extract session path from task description
2. Read remediation plan -- this is the primary work instruction
3. Parse priority matrix for ordered fix list
4. Read audit reports for detailed context on each issue
5. For FIX-002+ (GC loop): read re-audit reports for remaining issues

## Phase 3: Fix Implementation

Apply fixes in priority order: Critical -> High -> Medium -> Low.

### Category 1: OKLCH Color Corrections

**Goal**: Adjust OKLCH lightness/chroma to meet contrast requirements.

**Process**:
1. Read remediation plan for specific color changes needed
2. Locate CSS custom properties or color definitions in source files
3. Apply lightness adjustments:
   - Text too light -> decrease L% (e.g., L 55% -> L 35%)
   - Background too dark -> increase L% (e.g., L 80% -> L 92%)
   - Maintain hue (H) and adjust chroma (C) minimally
4. Verify new contrast ratios meet WCAG target
5. If dark mode exists, apply corresponding adjustments

**Example**:
```css
/* Before: contrast 3.2:1 */
--color-text: oklch(55% 0 0);
--color-bg: oklch(98% 0 0);

/* After: contrast 7.2:1 (AAA) */
--color-text: oklch(25% 0 0);
--color-bg: oklch(98% 0 0);
```

### Category 2: Focus Styles

**Goal**: Add visible, high-contrast focus indicators for keyboard users.

**Process**:
1. Add `:focus-visible` rules per specs/focus-patterns.md:
   ```css
   :focus-visible {
     outline: 2px solid var(--color-accent);
     outline-offset: 2px;
   }
   :focus:not(:focus-visible) {
     outline: none;
   }
   ```
2. Remove bare `outline: none` or `outline: 0` that suppress focus without alternative
3. Verify focus indicator contrast >= 3:1 against adjacent colors
4. Add consistent focus style across all interactive elements

### Category 3: ARIA Attributes

**Goal**: Add missing ARIA roles, states, and properties.

**Process**:
1. Add `role` attributes where semantic HTML is not used:
   - `<div onclick>` -> add `role="button"` and `tabindex="0"`
   - Custom widgets -> appropriate ARIA role
2. Add state attributes:
   - Toggle buttons: `aria-pressed="true|false"`
   - Expandable: `aria-expanded="true|false"`, `aria-controls="panel-id"`
   - Dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="title-id"`
3. Add labels:
   - `aria-label` for icon-only buttons
   - `aria-labelledby` for dialogs and sections
   - `aria-describedby` for form error messages
4. Add live regions:
   - Status messages: `aria-live="polite"`
   - Error messages: `aria-live="assertive"`

### Category 4: Reduced-Motion Queries

**Goal**: Respect user's motion preferences.

**Process**:
1. Wrap animations and transitions in media query:
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
2. Or per-element: disable specific animations while keeping layout
3. Ensure no content is lost when motion is reduced

### Category 5: Typography Adjustments

**Goal**: Fix font sizes, line heights, and reading widths.

**Process**:
1. Replace fixed font sizes with responsive clamp():
   ```css
   body { font-size: clamp(1rem, 1vw + 0.875rem, 1.25rem); }
   ```
2. Fix line-height to acceptable ranges:
   ```css
   body { line-height: 1.625; }
   h1, h2, h3 { line-height: 1.2; }
   ```
3. Add max-width for reading containers:
   ```css
   .content { max-width: 70ch; }
   ```

### Category 6: Skip Link

**Goal**: Add skip-to-main-content link if missing.

**Process** (per specs/focus-patterns.md):
1. Add as first child of `<body>`:
   ```html
   <a href="#main" class="skip-link">Skip to main content</a>
   ```
2. Add CSS:
   ```css
   .skip-link {
     position: absolute;
     left: -9999px;
     top: auto;
   }
   .skip-link:focus {
     position: fixed;
     left: 16px;
     top: 16px;
     z-index: 9999;
     background: var(--color-paper, #fff);
     color: var(--color-ink, #000);
     padding: 8px 16px;
     border-radius: 4px;
     text-decoration: underline;
   }
   ```
3. Ensure main content has `id="main"` (or equivalent target)

### Category 7: Focus Trap for Modals

**Goal**: Implement proper focus management in dialogs.

**Process** (per specs/focus-patterns.md):
1. On dialog open:
   - Store `document.activeElement` as return target
   - Move focus to first focusable element within dialog
2. Trap Tab/Shift+Tab within dialog:
   - Collect all focusable elements within dialog
   - On Tab at last element -> focus first element
   - On Shift+Tab at first element -> focus last element
3. On Escape -> close dialog, restore focus to stored element
4. Set `aria-modal="true"` on dialog container
5. Optional: set `inert` on background content

## Phase 4: Self-Validation & Output

1. Validate each fix category:

| Category | Validation Method |
|----------|------------------|
| Color | Recalculate contrast ratios for changed colors, verify >= target |
| Focus | Search for :focus-visible rules, verify no bare outline:none |
| ARIA | Check all dialogs have role+aria-modal, all buttons have labels |
| Motion | Verify prefers-reduced-motion media query exists |
| Typography | Check clamp() minimum >= 1rem, line-height in range |
| Skip link | Verify skip link element exists, CSS hides then shows on focus |
| Focus trap | Verify dialog has focus management code |

2. Write fix summary to `<session>/fixes/fix-summary-{NNN}.md`:

```markdown
# Fix Summary - {NNN}
[fix-implementer]

## Overview
- **Total fixes applied**: {count}
- **Critical fixed**: {count}
- **High fixed**: {count}
- **Medium fixed**: {count}
- **Files modified**: {count}

## Fixes Applied

### Fix 1: Color contrast (Critical, WCAG 1.4.3)
- **File**: `src/styles/globals.css:12`
- **Before**: `--color-text: oklch(55% 0 0)` (contrast 3.2:1)
- **After**: `--color-text: oklch(25% 0 0)` (contrast 7.2:1)
- **Validated**: PASS

### Fix 2: Focus indicators (High, WCAG 2.4.7)
- **File**: `src/styles/globals.css:45`
- **Before**: No :focus-visible rules
- **After**: Added :focus-visible with 2px outline
- **Validated**: PASS

...

## Files Modified
| File | Changes |
|------|---------|
| src/styles/globals.css | Color adjustments, focus styles, reduced-motion |
| src/components/Modal.tsx | Focus trap, ARIA attributes |
| src/app/layout.tsx | Skip link |

## Remaining Issues
- {Any medium/low issues not addressed in this round}

## Verification Status
- [ ] Color contrast: {n}/{total} passing
- [ ] Focus indicators: {n}/{total} visible
- [ ] ARIA coverage: {n}/{total} complete
- [ ] Typography: {n}/{total} compliant
```

3. Update `<session>/.msg/meta.json` under `fix-implementer` namespace:
   - Read existing -> merge `{ "fix-implementer": { fix_id, total_fixes, critical_fixed, high_fixed, medium_fixed, files_modified, timestamp } }` -> write back
