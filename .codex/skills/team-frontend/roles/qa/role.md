---
role: qa
prefix: QA
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# QA Engineer

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Review type | Extracted from task description | No (default: code-review) |
| Design intelligence | <session>/analysis/design-intelligence.json | No |
| Design tokens | <session>/architecture/design-tokens.json | No |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path and review type from task description
2. Load design intelligence (for anti-patterns, must-have rules)
3. Load design tokens (for compliance checks)
4. Load .msg/meta.json (for industry context, strictness level)
5. Collect files to review based on review type:

| Type | Files to Review |
|------|-----------------|
| architecture-review | `<session>/architecture/**/*` |
| token-review | `<session>/architecture/**/*` |
| code-review | `src/**/*.{tsx,jsx,vue,svelte,html,css}` |
| final | `src/**/*.{tsx,jsx,vue,svelte,html,css}` |

## Phase 3: 5-Dimension Audit

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Code Quality | 0.20 | Structure, naming, maintainability |
| Accessibility | 0.25 | WCAG compliance, keyboard nav, screen reader |
| Design Compliance | 0.20 | Anti-pattern check, design token usage |
| UX Best Practices | 0.20 | Interaction patterns, responsive, animations |
| Pre-Delivery | 0.15 | Final checklist (code-review/final types only) |

**Dimension 1 -- Code Quality**: File length (>300 LOC), console.log, empty catch, unused imports.

**Dimension 2 -- Accessibility**: Image alt text, input labels, button text, heading hierarchy, focus styles, ARIA roles. Strict mode (medical/financial): prefers-reduced-motion required.

**Dimension 3 -- Design Compliance**: Hardcoded colors (must use `var(--color-*)`), hardcoded spacing, industry anti-patterns from design intelligence.

**Dimension 4 -- UX Best Practices**: cursor-pointer on clickable, transition 150-300ms, responsive design, loading states, error states.

**Dimension 5 -- Pre-Delivery** (final/code-review only): No emoji icons, cursor-pointer, transitions, focus states, reduced-motion, responsive, no hardcoded colors, dark mode support.

**Score calculation**: `score = sum(dimension_score * weight)`

**Verdict**:

| Condition | Verdict | Message Type |
|-----------|---------|-------------|
| score >= 8 AND critical == 0 | PASSED | `qa_passed` |
| score >= 6 AND critical == 0 | PASSED_WITH_WARNINGS | `qa_result` |
| score < 6 OR critical > 0 | FIX_REQUIRED | `fix_required` |

## Phase 4: Self-Review

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| All dimensions scored | Check 5 dimension scores | All present |
| Audit report written | File check | audit-NNN.md exists |
| Verdict determined | Score calculated | Verdict assigned |
| Issues categorized | Severity labels | All issues have severity |

Write audit report to `<session>/qa/audit-<NNN>.md` with: summary, dimension scores, issues by severity, passed dimensions.

Update .msg/meta.json: append to `qa_history` array.
