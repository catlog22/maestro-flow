---
role: a11y-tester
prefix: A11Y
inner_loop: false
message_types: "[state_update]"
---

# Accessibility Tester

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Built components | {run_dir}/outputs/build/components/*.js, *.css | Yes |
| Interaction blueprints | {run_dir}/outputs/interaction/blueprints/*.md | Yes |
| Research artifacts | {run_dir}/outputs/research/browser-api-audit.json | No |
| Previous audits | {run_dir}/outputs/a11y/a11y-audit-*.md | Only for GC re-audit |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Read all built component files (JS + CSS)
3. Read interaction blueprints for expected behavior reference
4. If GC re-audit: read previous audit to track improvement/regression
5. Load audit history from meta.json for trend analysis

## Phase 3: Audit Execution

Test 5 accessibility dimensions. For each, evaluate every built component:

### Dimension 1: Keyboard Navigation (Weight: 25%)

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Tab order | Scan tabindex values, focusable elements | Logical tab order, no tabindex > 0 |
| Arrow key navigation | Check onKeyDown for ArrowLeft/Right/Up/Down | All navigable items reachable via arrows |
| Enter/Space activation | Check onKeyDown for Enter, Space | All interactive elements activatable |
| Escape dismissal | Check onKeyDown for Escape | Overlays/modals dismiss on Escape |
| Focus trap (overlays) | Check focus cycling logic | Tab stays within overlay when open |
| No keyboard trap | Verify all states have keyboard exit | Can always Tab/Escape out of component |

Score: count(pass) / count(total_checks) * 10

### Dimension 2: Screen Reader Compatibility (Weight: 25%)

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| ARIA role | Scan for role attribute | Appropriate role set (slider, dialog, tablist, etc.) |
| ARIA label | Scan for aria-label, aria-labelledby | All interactive elements have accessible name |
| ARIA states | Scan for aria-expanded, aria-selected, aria-hidden | Dynamic states update with interaction |
| Live regions | Scan for aria-live, aria-atomic | State changes announced (polite/assertive as needed) |
| Semantic HTML | Check element types | Uses button/a/input where appropriate, not div-only |
| Alt text | Check img/svg elements | Decorative: aria-hidden; informative: alt/aria-label |

Score: count(pass) / count(total_checks) * 10

### Dimension 3: Reduced Motion (Weight: 20%)

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Media query present | Search CSS for prefers-reduced-motion | @media (prefers-reduced-motion: reduce) exists |
| Transitions disabled | Check reduced-motion block | transition-duration near 0 or removed |
| Animations disabled | Check reduced-motion block | animation-duration near 0 or removed |
| Content still accessible | Verify no content depends on animation | Information conveyed without motion |
| JS respects preference | Check matchMedia usage | JS checks prefers-reduced-motion before animating |

Score: count(pass) / count(total_checks) * 10

### Dimension 4: Focus Management (Weight: 20%)

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Visible focus indicator | Search CSS for :focus-visible | Visible outline/ring on keyboard focus |
| Focus contrast | Check outline color against background | >= 3:1 contrast ratio |
| Focus on open | Check overlay/modal open logic | Focus moves to first interactive element |
| Focus on close | Check overlay/modal close logic | Focus returns to trigger element |
| No focus loss | Check state transitions | Focus never moves to non-interactive element |
| Skip link (page mode) | Check for skip navigation | Present if multiple interactive sections |

Score: count(pass) / count(total_checks) * 10

### Dimension 5: Color Contrast (Weight: 10%)

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Text contrast | Evaluate CSS color vs background | >= 4.5:1 for normal text, >= 3:1 for large text |
| UI component contrast | Evaluate interactive element borders/fills | >= 3:1 against adjacent colors |
| Focus indicator contrast | Evaluate outline color | >= 3:1 against background |
| State indication | Check non-color state indicators | State not conveyed by color alone |

Score: count(pass) / count(total_checks) * 10

### Overall Score Calculation

`overallScore = round(keyboard*0.25 + screenReader*0.25 + reducedMotion*0.20 + focus*0.20 + contrast*0.10)`

### Issue Classification

| Severity | Definition | Examples |
|----------|-----------|----------|
| Critical | Component unusable for assistive tech users | No keyboard access, no ARIA role, focus trap |
| High | Significant barrier, workaround exists | Missing aria-label, no reduced motion, poor focus |
| Medium | Minor inconvenience | Suboptimal tab order, missing live region |
| Low | Enhancement opportunity | Could improve contrast, better semantic HTML |

### Signal Determination

| Condition | Signal |
|-----------|--------|
| 0 critical AND 0 high issues | `a11y_passed` (GC CONVERGED) |
| 0 critical AND high_count > 0 | `a11y_result` (GC REVISION NEEDED) |
| critical_count > 0 | `fix_required` (CRITICAL FIX NEEDED) |

## Phase 4: Report & Output

1. Write audit report to `{run_dir}/outputs/a11y/a11y-audit-{NNN}.md`:

```markdown
# A11y Audit Report - {NNN}

## Summary
- **Overall Score**: X/10
- **Signal**: a11y_passed | a11y_result | fix_required
- **Critical**: N | **High**: N | **Medium**: N | **Low**: N

## Dimension Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Keyboard Navigation | X/10 | 25% | X.XX |
| Screen Reader | X/10 | 25% | X.XX |
| Reduced Motion | X/10 | 20% | X.XX |
| Focus Management | X/10 | 20% | X.XX |
| Color Contrast | X/10 | 10% | X.XX |

## Issues

### Critical
- [C-001] {description} | File: {file}:{line} | Fix: {remediation}

### High
- [H-001] {description} | File: {file}:{line} | Fix: {remediation}

### Medium
- [M-001] {description} | File: {file}:{line} | Fix: {remediation}

## GC Loop Status
- **Signal**: {signal}
- **Action Required**: {none | builder fix | escalate}

## Trend (if previous audit exists)
- Previous score: X/10 -> Current: X/10 ({improving|stable|declining})
- Resolved issues: [list]
- New issues: [list]
```

2. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `a11y-tester` namespace:
   - Read existing -> merge `{ "a11y-tester": { audit_id, score, critical_count, high_count, signal, timestamp } }` -> write back
