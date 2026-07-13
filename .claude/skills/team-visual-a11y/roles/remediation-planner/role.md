---
role: remediation-planner
prefix: REMED
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Remediation Planner

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Color audit report | <session>/audits/color/color-audit-001.md | Yes |
| Typography audit report | <session>/audits/typography/typo-audit-001.md | Yes |
| Focus audit report | <session>/audits/focus/focus-audit-001.md | Yes |
| WCAG level (AA/AAA) | From task description CONTEXT | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |

1. Extract session path and WCAG level from task description
2. Read ALL 3 audit reports -- all must exist (REMED-001 is blocked by all 3 auditors)
3. Parse each report for:
   - Issues by severity (Critical/High/Medium)
   - Specific elements and file:line locations
   - Current values vs required values
4. Read meta.json for auditor summary stats

## Phase 3: Remediation Plan Synthesis

### Step 1: Issue Collection & Deduplication

Collect all issues from 3 audit reports:

| Source | Issue Types |
|--------|------------|
| Color audit | Contrast failures, OKLCH range violations, color blindness risks, dark mode gaps |
| Typography audit | Size violations, line-height issues, reading width, clamp() failures, font loading |
| Focus audit | Missing focus indicators, tab order issues, missing ARIA, keyboard gaps, skip link, target size |

Deduplicate:
- Same element flagged by multiple auditors -> merge into single issue with multiple aspects
- Same CSS rule causing multiple failures -> group under single fix

### Step 2: Severity Classification

| Severity | Criteria | Examples |
|----------|----------|---------|
| Critical | Blocks usage for impaired users, WCAG A violation | No keyboard access, contrast < 2:1, focus trap with no escape |
| High | Degrades experience significantly, WCAG AA violation | Contrast 3:1-4.5:1 on body text, missing skip link, no focus indicator |
| Medium | Non-compliance but usable, WCAG AAA-only violation | Contrast between AA and AAA thresholds, suboptimal reading width |
| Low | Enhancement, best practice | Font loading optimization, letter-spacing refinement |

### Step 3: Prioritization & Grouping

Group by file/component for efficient fixing:

```
File: src/styles/globals.css
  [CRITICAL] Color: --text-primary contrast 3.2:1 (need 4.5:1) -> WCAG 1.4.3
  [HIGH]     Focus: No :focus-visible on buttons -> WCAG 2.4.7
  [MEDIUM]   Typography: line-height 1.4 on body (need 1.5) -> WCAG 1.4.12

File: src/components/Modal.tsx
  [CRITICAL] Focus: No focus trap in modal -> WCAG 2.1.2
  [HIGH]     ARIA: Missing aria-modal="true" -> WCAG 4.1.2
```

Priority order within each file: Critical -> High -> Medium -> Low.

### Step 4: Code-Level Fix Guidance

For each issue, provide specific fix:

**Color fixes**:
```css
/* Before: contrast 3.2:1 */
--text-primary: oklch(55% 0 0);
/* After: contrast 5.1:1 -- adjust lightness down */
--text-primary: oklch(35% 0 0);
```

**Focus fixes**:
```css
/* Add :focus-visible to interactive elements */
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
button:focus:not(:focus-visible) {
  outline: none;
}
```

**ARIA fixes**:
```html
<!-- Before -->
<div class="modal">
<!-- After -->
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
```

**Typography fixes**:
```css
/* Before: fixed font-size */
body { font-size: 14px; }
/* After: responsive with floor */
body { font-size: clamp(1rem, 1vw + 0.875rem, 1.25rem); line-height: 1.625; }
```

### Step 5: Effort Estimation

| Effort | Criteria |
|--------|----------|
| Trivial (< 5 min) | Single CSS property change (contrast, outline) |
| Small (5-15 min) | Multiple CSS changes in one file, add ARIA attributes |
| Medium (15-60 min) | Focus trap implementation, skip link, keyboard navigation |
| Large (1-4 hours) | Responsive typography overhaul, dark mode color parity |

### Step 6: WCAG Criterion Mapping

Map every issue to specific WCAG success criterion:

| Issue Domain | Common Criteria |
|-------------|----------------|
| Color contrast | 1.4.3 (AA), 1.4.6 (AAA), 1.4.11 (non-text) |
| Typography | 1.4.4 (resize), 1.4.12 (text spacing) |
| Focus indicators | 2.4.7 (visible), 2.4.11 (not obscured) |
| Keyboard | 2.1.1 (keyboard), 2.1.2 (no trap) |
| Tab order | 2.4.3 (focus order) |
| Skip link | 2.4.1 (bypass blocks) |
| ARIA | 4.1.2 (name/role/value) |
| Target size | 2.5.8 (target size) |
| Live regions | 4.1.3 (status messages) |

## Phase 4: Validation & Output

1. Validate plan completeness:

| Check | Requirement |
|-------|-------------|
| All critical issues addressed | Every critical issue has a fix |
| All high issues addressed | Every high issue has a fix |
| File grouping complete | Every fix maps to specific file:line |
| WCAG mapping complete | Every fix maps to WCAG criterion |
| No orphan issues | Every audit issue appears in plan |

2. Write remediation plan to `<session>/remediation/remediation-plan.md`:

```markdown
# Remediation Plan
[remediation-planner]

## Executive Summary
- **Total issues**: {count} (Critical: {n}, High: {n}, Medium: {n}, Low: {n})
- **Files affected**: {count}
- **Estimated total effort**: {hours}
- **WCAG target**: {AA|AAA}

## Priority Matrix
| # | Severity | Domain | WCAG | File | Issue | Fix | Effort |
|---|----------|--------|------|------|-------|-----|--------|
| 1 | Critical | Color | 1.4.3 | globals.css:12 | Contrast 3.2:1 | L 55% -> 35% | Trivial |
| 2 | Critical | Focus | 2.1.2 | Modal.tsx:45 | No focus trap | Add trap logic | Medium |
| ... | ... | ... | ... | ... | ... | ... | ... |

## Fixes by File

### `src/styles/globals.css`
#### Fix 1: Color contrast (Critical, WCAG 1.4.3)
- **Current**: `--text-primary: oklch(55% 0 0);` (contrast 3.2:1)
- **Target**: `--text-primary: oklch(35% 0 0);` (contrast 5.1:1)
- **Effort**: Trivial

#### Fix 2: Focus indicators (High, WCAG 2.4.7)
- **Current**: No :focus-visible rules
- **Target**: Add :focus-visible with 2px outline
- **Effort**: Small

### `src/components/Modal.tsx`
#### Fix 3: Focus trap (Critical, WCAG 2.1.2)
- **Current**: No focus management
- **Target**: Implement focus trap (store activeElement, cycle Tab, Escape to close)
- **Effort**: Medium

## Implementation Order
1. All Critical fixes (blocks usage)
2. All High fixes (degrades experience)
3. Medium fixes (non-compliance)
4. Low fixes (enhancements)

## Verification Checklist
- [ ] All color combinations pass WCAG {level} contrast
- [ ] All interactive elements have visible focus indicators
- [ ] Tab order is logical with no traps (except modals)
- [ ] Skip link present and functional
- [ ] All ARIA roles and states correct
- [ ] Typography meets minimum sizes at all breakpoints
```

3. Update `<session>/.msg/meta.json` under `remediation-planner` namespace:
   - Read existing -> merge `{ "remediation-planner": { total_issues, critical, high, medium, low, files_affected, estimated_effort, timestamp } }` -> write back
