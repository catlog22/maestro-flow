---
role: focus-auditor
prefix: FOCUS
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Focus & Keyboard Accessibility Auditor

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Target (URL or file paths) | From task description CONTEXT | Yes |
| WCAG level (AA/AAA) | From task description CONTEXT | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |
| Previous audit (re-audit) | <session>/audits/focus/focus-audit-*.md | Only for FOCUS-002+ |

1. Extract session path, target, and WCAG level from task description
2. Determine audit type from subject: FOCUS-001 -> initial audit, FOCUS-002+ -> re-audit (verification)
3. Identify target:
   - URL -> use Chrome DevTools for interactive focus testing
   - File paths -> read HTML/JSX/Vue/Svelte files for interactive elements
   - Full site -> enumerate pages from navigation/routes
4. For re-audit: read previous audit report and fix summary for comparison baseline
5. Read focus patterns from specs/focus-patterns.md for reference

## Phase 3: Focus Audit Execution

### Step 1: Interactive Element Inventory

**Static analysis** (always):
- Glob for HTML/JSX/TSX/Vue/Svelte files
- Extract all interactive elements:
  - Native focusable: `<a href>`, `<button>`, `<input>`, `<select>`, `<textarea>`, `<details>`
  - Custom focusable: elements with `tabindex`, `role="button"`, `role="link"`, `role="tab"`, etc.
  - Modals/dialogs: `role="dialog"`, `role="alertdialog"`, `<dialog>`
  - Dynamic content areas: `aria-live`, `role="status"`, `role="alert"`
- Record source location (file:line) and context for each element

**Runtime analysis** (if Chrome DevTools available):
- `mcp__chrome-devtools__navigate_page({ url: "<target-url>" })`
- `mcp__chrome-devtools__evaluate_script({ expression: "..." })` to:
  - Enumerate all focusable elements in DOM order
  - Check `tabindex` values (0, -1, positive)
  - Detect focus traps (elements that prevent Tab from escaping)

### Step 2: Tab Order Audit

| Check | Criterion | Standard |
|-------|-----------|----------|
| Logical sequence | Tab order follows visual/reading order | WCAG 2.4.3 |
| No positive tabindex | `tabindex > 0` is an anti-pattern | Best practice |
| No tab traps | Tab can escape all containers (except modals) | WCAG 2.1.2 |
| Skip link first | First focusable element is skip-to-content link | WCAG 2.4.1 |
| All interactive reachable | Every interactive element reachable via Tab | WCAG 2.1.1 |

Flag:
- `tabindex > 0` (disrupts natural tab order)
- `tabindex="-1"` on elements that should be focusable
- Missing `tabindex="0"` on custom interactive elements
- `outline: none` or `outline: 0` without alternative focus indicator

### Step 3: Focus Indicator Visibility

Per specs/focus-patterns.md:

| Check | Requirement | Standard |
|-------|-------------|----------|
| Outline present | At least 2px outline on :focus-visible | WCAG 2.4.7 |
| Outline contrast | >= 3:1 against adjacent colors | WCAG 2.4.11 |
| :focus-visible used | Keyboard focus distinct from mouse click | Best practice |
| Not obscured | Focus indicator not hidden by overlays, sticky headers | WCAG 2.4.11 |
| Consistent style | Same focus style across similar elements | Best practice |

**CSS analysis**:
- Search for `:focus`, `:focus-visible`, `:focus-within` rules
- Check for `outline: none` / `outline: 0` without alternative (box-shadow, border)
- Verify `:focus:not(:focus-visible) { outline: none; }` pattern (mouse click suppression)
- Calculate focus indicator contrast against adjacent background

### Step 4: Skip Link Audit

| Check | Requirement |
|-------|-------------|
| Exists | `<a href="#main">` or similar as first focusable element |
| Visually hidden until focus | `position: absolute; left: -9999px` pattern |
| Visible on focus | Repositions on `:focus` to visible area |
| Target exists | `#main` or target ID exists in DOM |
| Functional | Focus moves to main content on activation |

### Step 5: Focus Trap Audit (Modals/Dialogs)

Per specs/focus-patterns.md:

| Check | Requirement | Standard |
|-------|-------------|----------|
| Focus moves to dialog | On open, focus moves to first focusable or dialog itself | ARIA Practices |
| Tab cycles within | Tab/Shift+Tab stay within dialog focusable elements | ARIA Practices |
| Escape closes | Escape key closes dialog | ARIA Practices |
| Focus restores | On close, focus returns to trigger element | ARIA Practices |
| Background inert | Background content not focusable while dialog open | Best practice |
| Scroll lock | Background scroll locked while dialog open | Best practice |

### Step 6: ARIA Audit

| Element Type | Required ARIA | Standard |
|-------------|--------------|----------|
| Buttons | `role="button"` (if not `<button>`), `aria-pressed` (toggle), `aria-expanded` (disclosure) | WCAG 4.1.2 |
| Dialogs | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` | ARIA Practices |
| Navigation | `role="navigation"` (if not `<nav>`), `aria-label` for multiple nav regions | WCAG 4.1.2 |
| Live regions | `aria-live="polite"` (status), `aria-live="assertive"` (errors) | WCAG 4.1.3 |
| Forms | `aria-required`, `aria-invalid`, `aria-describedby` for errors | WCAG 4.1.2 |
| Tabs | `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected` | ARIA Practices |
| Accordions | `aria-expanded`, `aria-controls` | ARIA Practices |

### Step 7: Keyboard Operability

| Element | Expected Keys | Standard |
|---------|--------------|----------|
| Links/buttons | Enter activates | WCAG 2.1.1 |
| Buttons | Space activates | WCAG 2.1.1 |
| Checkboxes | Space toggles | WCAG 2.1.1 |
| Radio groups | Arrow keys navigate within group | ARIA Practices |
| Tabs | Arrow keys switch tabs, Tab moves to panel | ARIA Practices |
| Menus | Arrow keys navigate, Enter selects, Escape closes | ARIA Practices |
| Sliders | Arrow keys adjust value | ARIA Practices |

### Input Method Awareness

| Check | Requirement |
|-------|-------------|
| Hover guard | `:hover` styles wrapped in `@media(hover:hover)` — touch devices don't hover |
| Pointer detection | `@media(pointer:coarse)` used for larger touch targets (48px+) |
| Focus-visible distinction | `:focus-visible` for keyboard only, not mouse clicks |
| Touch target sizing | All interactive elements >= 44x44px on `pointer:coarse` devices |

### Step 8: Target Size (WCAG 2.5.8)

| Check | Requirement | Standard |
|-------|-------------|----------|
| Interactive elements | Minimum 24x24px CSS pixels | WCAG 2.5.8 AA |
| Inline links | Exempt if within text paragraph | Exception |
| Spacing | At least 24px between targets OR targets themselves >= 24px | WCAG 2.5.8 |

## Phase 4: Report Generation & Output

1. Write audit report to `<session>/audits/focus/focus-audit-{NNN}.md` (or `<session>/re-audit/focus-audit-{NNN}.md` for re-audits):

```markdown
# Focus & Keyboard Accessibility Audit - {NNN}
[focus-auditor]

## Summary
- **Total interactive elements**: {count}
- **Pass**: {pass_count} | **Fail**: {fail_count}
- **WCAG Level**: {AA|AAA}
- **Critical issues**: {count}
- **High issues**: {count}

## Tab Order
| # | Element | Type | tabindex | Logical | Status |
|---|---------|------|----------|---------|--------|
| 1 | Skip link | <a> | 0 | Yes | PASS |
| 2 | Logo link | <a> | 0 | Yes | PASS |
| ... | ... | ... | ... | ... | ... |

## Focus Indicators
| Element | :focus-visible | Outline | Contrast | Obscured | Status |
|---------|---------------|---------|----------|----------|--------|
| ... | yes/no | Xpx solid | X:1 | no | PASS/FAIL |

## Skip Link
| Check | Status | Details |
|-------|--------|---------|
| Exists | PASS/FAIL | ... |
| Hidden until focus | PASS/FAIL | ... |
| Target exists | PASS/FAIL | ... |

## Focus Traps (Modals/Dialogs)
| Dialog | Focus on open | Tab cycles | Escape closes | Focus restores | Status |
|--------|-------------|-----------|--------------|---------------|--------|
| ... | yes/no | yes/no | yes/no | yes/no | PASS/FAIL |

## ARIA Coverage
| Element | Role | Label | States | Status |
|---------|------|-------|--------|--------|
| ... | ... | ... | ... | PASS/FAIL |

## Keyboard Operability
| Element | Enter | Space | Arrows | Escape | Status |
|---------|-------|-------|--------|--------|--------|
| ... | yes/no | yes/no | n/a | n/a | PASS/FAIL |

## Target Size
| Element | Size | Min 24x24 | Status |
|---------|------|----------|--------|
| ... | WxH | yes/no | PASS/FAIL |

## Issues (by severity)
### Critical
- ...
### High
- ...
### Medium
- ...
```

2. For re-audit (FOCUS-002+), add before/after comparison section:
```markdown
## Before/After Comparison
| Element | Before | After | Status |
|---------|--------|-------|--------|
| ... | FAIL (no outline) | PASS (2px solid) | FIXED |
```

3. Update `<session>/.msg/meta.json` under `focus-auditor` namespace:
   - Read existing -> merge `{ "focus-auditor": { audit_id, total_elements, pass_count, fail_count, critical_count, high_count, skip_link_present, focus_traps_valid, timestamp } }` -> write back
