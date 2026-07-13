

# Focus Management Patterns

Reference guide for focus indicator styles, skip links, focus traps, and ARIA patterns. Used by focus-auditor and fix-implementer roles.

## Focus Indicator Style

### Recommended Pattern

```css
/* Keyboard focus: visible outline */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Mouse click: no outline */
:focus:not(:focus-visible) {
  outline: none;
}
```

### Requirements

| Property | Minimum | Rationale |
|----------|---------|-----------|
| outline-width | 2px | Visibility at distance |
| outline-style | solid | Consistent rendering |
| outline-offset | 2px | Separation from element edge |
| Contrast vs adjacent | >= 3:1 | WCAG 2.4.11 |

### Anti-Patterns (Do NOT)

```css
/* BAD: Removes all focus indicators */
*:focus { outline: none; }

/* BAD: Removes focus without alternative */
button:focus { outline: 0; }

/* BAD: Only uses box-shadow (invisible in high contrast mode) */
:focus-visible { outline: none; box-shadow: 0 0 0 2px blue; }
```

### Correct Alternative Indicator

```css
/* If not using outline, MUST provide visible alternative */
:focus-visible {
  outline: 2px solid transparent; /* For Windows high contrast mode */
  box-shadow: 0 0 0 2px var(--color-accent);
}
```

## Skip Link

### HTML

```html
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
  <!-- navigation, header, etc. -->
  <main id="main" tabindex="-1">
    <!-- main content -->
  </main>
</body>
```

### CSS

```css
.skip-link {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
  z-index: -1;
}

.skip-link:focus {
  position: fixed;
  left: 16px;
  top: 16px;
  width: auto;
  height: auto;
  overflow: visible;
  z-index: 9999;
  background: var(--color-paper, #fff);
  color: var(--color-ink, #000);
  padding: 8px 16px;
  border: 2px solid var(--color-ink, #000);
  border-radius: 4px;
  font-size: 1rem;
  text-decoration: underline;
}
```

### Requirements

| Check | Requirement |
|-------|-------------|
| Position | First focusable element in DOM |
| Default state | Visually hidden (not display:none or visibility:hidden) |
| Focus state | Visible, fixed position, high z-index |
| Target | Points to main content area with valid ID |
| Contrast | Link text meets 4.5:1 contrast against background |

## Focus Trap (Modals/Dialogs)

### Implementation Pattern

```javascript
function trapFocus(dialog) {
  const focusableSelector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  const focusableElements = dialog.querySelectorAll(focusableSelector);
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  // Store trigger for focus restore
  const trigger = document.activeElement;

  // Move focus to first element
  firstFocusable.focus();

  dialog.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeDialog(dialog);
      trigger.focus(); // Restore focus
      return;
    }

    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift+Tab at first element -> wrap to last
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      // Tab at last element -> wrap to first
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  });
}
```

### Dialog HTML Pattern

```html
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Dialog Title</h2>
  <div class="dialog-content">
    <!-- content -->
  </div>
  <div class="dialog-actions">
    <button type="button">Cancel</button>
    <button type="button">Confirm</button>
  </div>
</div>
```

### Requirements

| Step | Action | Detail |
|------|--------|--------|
| Open | Store trigger | `const trigger = document.activeElement` |
| Open | Move focus | Focus first focusable element in dialog |
| Open | Lock background | `document.body.style.overflow = 'hidden'` or `inert` attribute |
| Open | Set ARIA | `aria-modal="true"` on dialog |
| Tab | Cycle within | Tab/Shift+Tab wrap within dialog focusable elements |
| Escape | Close + restore | Close dialog, restore focus to trigger |
| Close | Unlock background | Remove scroll lock / inert |

## ARIA Patterns

### Button Patterns

```html
<!-- Standard button -->
<button type="button">Save</button>

<!-- Icon-only button (needs aria-label) -->
<button type="button" aria-label="Close dialog">
  <svg><!-- X icon --></svg>
</button>

<!-- Toggle button -->
<button type="button" aria-pressed="false">Bold</button>

<!-- Disclosure button -->
<button type="button" aria-expanded="false" aria-controls="panel-1">
  Show details
</button>
<div id="panel-1" hidden>Details content</div>
```

### Dialog Pattern

```html
<div role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc">
  <h2 id="dlg-title">Confirm Action</h2>
  <p id="dlg-desc">Are you sure you want to proceed?</p>
  <button type="button">Cancel</button>
  <button type="button">Confirm</button>
</div>
```

### Live Region Patterns

```html
<!-- Status updates (polite) -->
<div role="status" aria-live="polite">
  3 items in cart
</div>

<!-- Error messages (assertive) -->
<div role="alert" aria-live="assertive">
  Email address is invalid
</div>

<!-- Log/chat (polite, additions only) -->
<div role="log" aria-live="polite" aria-relevant="additions">
  <!-- new messages appended here -->
</div>
```

### Navigation Pattern

```html
<!-- Primary navigation -->
<nav aria-label="Primary">
  <ul role="menubar">
    <li role="none"><a role="menuitem" href="/">Home</a></li>
    <li role="none"><a role="menuitem" href="/about">About</a></li>
  </ul>
</nav>

<!-- Breadcrumb -->
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li><a href="/products">Products</a></li>
    <li aria-current="page">Widget</li>
  </ol>
</nav>
```

### Tab Pattern

```html
<div role="tablist" aria-label="Settings">
  <button role="tab" aria-selected="true" aria-controls="panel-general" id="tab-general">
    General
  </button>
  <button role="tab" aria-selected="false" aria-controls="panel-security" id="tab-security" tabindex="-1">
    Security
  </button>
</div>
<div role="tabpanel" id="panel-general" aria-labelledby="tab-general">
  General settings content
</div>
<div role="tabpanel" id="panel-security" aria-labelledby="tab-security" hidden>
  Security settings content
</div>
```

**Keyboard**: Arrow Left/Right to switch tabs, Tab to move into panel content.

### Form Error Pattern

```html
<label for="email">Email</label>
<input
  type="email"
  id="email"
  aria-required="true"
  aria-invalid="true"
  aria-describedby="email-error"
>
<div id="email-error" role="alert">
  Please enter a valid email address
</div>
```

## Keyboard Navigation Reference

| Component | Key | Action |
|-----------|-----|--------|
| Link | Enter | Activate |
| Button | Enter, Space | Activate |
| Checkbox | Space | Toggle |
| Radio group | Arrow Up/Down | Select previous/next |
| Tab list | Arrow Left/Right | Switch tab |
| Menu | Arrow Up/Down | Navigate items |
| Menu | Enter | Select item |
| Menu | Escape | Close menu |
| Dialog | Escape | Close dialog |
| Slider | Arrow Left/Right | Decrease/increase |
| Combobox | Arrow Down | Open dropdown |
| Combobox | Enter | Select highlighted |
| Combobox | Escape | Close dropdown |
| Tree | Arrow Up/Down | Navigate siblings |
| Tree | Arrow Right | Expand / enter child |
| Tree | Arrow Left | Collapse / go to parent |

## Target Size Reference

| Standard | Minimum Size | Notes |
|----------|-------------|-------|
| WCAG 2.5.8 (AA) | 24x24px CSS pixels | Or adequate spacing between targets |
| WCAG 2.5.5 (AAA) | 44x44px CSS pixels | Recommended for touch interfaces |
| Apple HIG | 44x44pt | iOS touch targets |
| Material Design | 48x48dp | Android touch targets |

**Exceptions**: Inline links within text, browser default controls, essential fixed-size elements.
