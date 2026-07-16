# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From session meta.json `pipeline` | Yes |
| Target info | From session meta.json `target` | Yes |

1. Load user requirement and scope from meta.json
2. Load pipeline stage definitions from specs/pipelines.md
3. Read `pipeline` and `target` from meta.json

## Phase 3: Task Chain Creation (Mode-Branched)

### Task Description Template

Every task description uses structured format:

```
TaskCreate({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: <session-folder>
  - Target: <URL or file path>
  - WCAG Level: <AA|AAA>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
TaskUpdate({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `audit-only` | Create 4 tasks: [COLOR-001 + TYPO-001 + FOCUS-001] parallel -> REMED-001 |
| `full` | Create 7 tasks: [COLOR-001 + TYPO-001 + FOCUS-001] -> REMED-001 -> FIX-001 -> [COLOR-002 + FOCUS-002] |

---

### Audit-Only Pipeline Task Chain

**COLOR-001** (color-auditor):
```
TaskCreate({
  subject: "COLOR-001",
  description: "PURPOSE: OKLCH color contrast audit for all color combinations | Success: Complete color audit with WCAG 2.1 + APCA contrast ratios and color blindness assessment
TASK:
  - Extract all color values (OKLCH, HSL, RGB, hex) from stylesheets
  - Calculate WCAG 2.1 contrast ratios for all text/background combinations
  - Calculate APCA Lc values for body and large text
  - Assess OKLCH lightness ranges for text and backgrounds
  - Simulate color blindness (protanopia, deuteranopia, tritanopia)
  - Check dark mode color parity if applicable
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/audits/color/color-audit-001.md | Pass/fail per color combination
CONSTRAINTS: Read-only analysis | Use Chrome DevTools for computed styles when available"
})
TaskUpdate({ taskId: "COLOR-001", owner: "color-auditor" })
```

**TYPO-001** (typo-auditor):
```
TaskCreate({
  subject: "TYPO-001",
  description: "PURPOSE: Typography readability audit across all viewports | Success: Complete typography audit with size, line-height, reading width at each breakpoint
TASK:
  - Audit font sizes at each breakpoint (320px, 768px, 1024px, 1400px)
  - Validate minimum body text >= 16px on mobile
  - Check line-height ratios (body 1.5-1.75, headings 1.1-1.3)
  - Validate clamp() functions for responsive scaling
  - Measure reading width (45-75 characters per line)
  - Assess font loading strategy (font-display values)
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/audits/typography/typo-audit-001.md | Breakpoint-by-breakpoint report
CONSTRAINTS: Read-only analysis | Screenshot at multiple viewports if Chrome DevTools available"
})
TaskUpdate({ taskId: "TYPO-001", owner: "typo-auditor" })
```

**FOCUS-001** (focus-auditor):
```
TaskCreate({
  subject: "FOCUS-001",
  description: "PURPOSE: Focus management and keyboard accessibility audit | Success: Complete focus audit with tab order, indicator visibility, ARIA coverage
TASK:
  - Audit tab order for logical sequence and no tab traps
  - Check focus indicator visibility (outline >= 2px, contrast >= 3:1)
  - Verify :focus-visible usage for keyboard vs mouse distinction
  - Check skip link presence and functionality
  - Audit focus traps in modals/dialogs (Tab cycles, Escape dismisses)
  - Verify ARIA live regions for dynamic content
  - Check ARIA roles and states on interactive elements
  - Validate keyboard operability (Enter/Space, Arrow keys)
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/audits/focus/focus-audit-001.md | Element-by-element focus report
CONSTRAINTS: Read-only analysis | Tab through elements if Chrome DevTools available"
})
TaskUpdate({ taskId: "FOCUS-001", owner: "focus-auditor" })
```

**CRITICAL**: COLOR-001, TYPO-001, FOCUS-001 have NO blockedBy -- they run in PARALLEL.

**REMED-001** (remediation-planner):
```
TaskCreate({
  subject: "REMED-001",
  description: "PURPOSE: Synthesize all 3 audit findings into prioritized remediation plan | Success: Complete remediation plan with severity ranking, code-level fix guidance, WCAG criterion mapping
TASK:
  - Read color, typography, and focus audit reports
  - Merge and deduplicate findings
  - Prioritize by severity (Critical > High > Medium > Low)
  - Group by file/component for efficient fixing
  - Provide code-level fix guidance (specific CSS/HTML changes)
  - Map each fix to WCAG success criterion
  - Estimate effort per fix
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Upstream artifacts: audits/color/color-audit-001.md, audits/typography/typo-audit-001.md, audits/focus/focus-audit-001.md
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/remediation/remediation-plan.md | All critical/high issues addressed
CONSTRAINTS: Read-only synthesis | No code modifications"
})
TaskUpdate({ taskId: "REMED-001", addBlockedBy: ["COLOR-001", "TYPO-001", "FOCUS-001"], owner: "remediation-planner" })
```

---

### Full Pipeline Task Chain

Same as audit-only (COLOR-001, TYPO-001, FOCUS-001, REMED-001), plus:

**FIX-001** (fix-implementer):
```
TaskCreate({
  subject: "FIX-001",
  description: "PURPOSE: Implement accessibility fixes from remediation plan | Success: All critical and high severity issues fixed with passing contrast ratios and ARIA validation
TASK:
  - Read remediation plan for prioritized fix list
  - Apply OKLCH color corrections for contrast compliance
  - Add/fix focus styles (outline, outline-offset, :focus-visible)
  - Add missing ARIA attributes (role, aria-label, aria-live, aria-expanded)
  - Add reduced-motion media queries where needed
  - Fix typography (clamp(), line-height, max-width for reading)
  - Add skip link if missing
  - Apply fixes in priority order (critical first)
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Upstream artifacts: remediation/remediation-plan.md
  - Shared memory: <session>/.msg/meta.json
EXPECTED: Modified source files + <session>/fixes/fix-summary-001.md | All critical/high fixes applied
CONSTRAINTS: Modify only files identified in remediation plan | Preserve existing functionality"
})
TaskUpdate({ taskId: "FIX-001", addBlockedBy: ["REMED-001"], owner: "fix-implementer" })
```

**COLOR-002** (color-auditor):
```
TaskCreate({
  subject: "COLOR-002",
  description: "PURPOSE: Re-audit color contrast after fixes applied | Success: All color combinations pass WCAG target level
TASK:
  - Re-extract all color values from modified stylesheets
  - Re-calculate WCAG 2.1 contrast ratios
  - Re-calculate APCA Lc values
  - Compare before/after for each fixed combination
  - Verify no regressions in unfixed combinations
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Upstream artifacts: fixes/fix-summary-001.md, audits/color/color-audit-001.md
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/re-audit/color-audit-002.md | Before/after comparison with pass/fail
CONSTRAINTS: Read-only verification | Focus on fixed items + regression check"
})
TaskUpdate({ taskId: "COLOR-002", addBlockedBy: ["FIX-001"], owner: "color-auditor" })
```

**FOCUS-002** (focus-auditor):
```
TaskCreate({
  subject: "FOCUS-002",
  description: "PURPOSE: Re-audit focus management after fixes applied | Success: All focus indicators visible with correct ARIA attributes
TASK:
  - Re-audit tab order after DOM changes
  - Verify focus indicator fixes (outline, contrast)
  - Check new ARIA attributes are valid
  - Verify skip link implementation
  - Test keyboard operability of fixed elements
  - Compare before/after for each fixed element
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - WCAG Level: <level>
  - Upstream artifacts: fixes/fix-summary-001.md, audits/focus/focus-audit-001.md
  - Shared memory: <session>/.msg/meta.json
EXPECTED: <session>/re-audit/focus-audit-002.md | Before/after comparison with pass/fail
CONSTRAINTS: Read-only verification | Focus on fixed items + regression check"
})
TaskUpdate({ taskId: "FOCUS-002", addBlockedBy: ["FIX-001"], owner: "focus-auditor" })
```

**CRITICAL**: COLOR-002 and FOCUS-002 both blocked only by FIX-001 -- they run in PARALLEL after fixes.

---

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | TaskList count | audit-only: 4, full: 7 |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| 3 audit tasks have NO blockedBy | Pattern check | COLOR-001, TYPO-001, FOCUS-001 are parallel |
| REMED-001 blocked by all 3 | Check blockedBy | [COLOR-001, TYPO-001, FOCUS-001] |
| Task IDs use correct prefixes | Pattern check | COLOR/TYPO/FOCUS/REMED/FIX |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |

If validation fails, fix the specific task and re-validate.
