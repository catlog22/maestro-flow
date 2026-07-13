---
role: typo-auditor
prefix: TYPO
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Typography Readability Auditor

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Target (URL or file paths) | From task description CONTEXT | Yes |
| WCAG level (AA/AAA) | From task description CONTEXT | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path, target, and WCAG level from task description
2. Identify target:
   - URL -> use Chrome DevTools for rendered typography (navigate_page, resize_page, screenshot)
   - File paths -> read CSS/SCSS files directly for typography definitions
   - Full site -> enumerate stylesheets from HTML entry points
3. Read typography standards from specs/typography-scale.md for reference thresholds

## Phase 3: Typography Audit Execution

### Step 1: Typography Definition Extraction

**Static analysis** (always):
- Glob for CSS/SCSS/Tailwind files -> extract typography definitions
- Extract: font-family, font-size, line-height, letter-spacing, font-weight, font-display
- Parse clamp() functions: `clamp(min, preferred, max)` -> validate min/max bounds
- Parse @media queries for responsive breakpoints
- Record source location (file:line) for each rule

**Runtime analysis** (if Chrome DevTools available):
- Navigate to target URL
- For each breakpoint (320px, 768px, 1024px, 1400px):
  - `mcp__chrome-devtools__resize_page({ width: <breakpoint>, height: 900 })`
  - `mcp__chrome-devtools__evaluate_script({ expression: "..." })` to measure:
    - Computed font-size on body, headings (h1-h6), paragraphs, captions
    - Computed line-height on same elements
    - Container width and character count per line
  - `mcp__chrome-devtools__take_screenshot({})` -> save to `<session>/evidence/typo-{breakpoint}px.png`

### Step 2: Font Size Audit

| Breakpoint | Element | Minimum Size | Standard |
|-----------|---------|-------------|----------|
| 320px (mobile) | Body text | 16px | WCAG 1.4.4 |
| 320px (mobile) | Small/caption | 14px | Best practice |
| 768px (tablet) | Body text | 16px | WCAG 1.4.4 |
| 1024px (desktop) | Body text | 16px | WCAG 1.4.4 |
| 1400px (wide) | Body text | 16px | WCAG 1.4.4 |

**clamp() validation**:
- Minimum value >= 14px (absolute floor)
- Maximum value reasonable for element type (headings: max ~72px, body: max ~20px)
- Preferred value uses viewport unit (vw) for fluid scaling
- Check: `clamp(min, preferred, max)` where min >= 14px for any text

**200% zoom check** (WCAG 1.4.4):
- At 200% zoom, no content should be clipped or lost
- Text should reflow without horizontal scrolling

### Step 3: Line Height Audit

| Element Type | Expected Range | Standard |
|-------------|---------------|----------|
| Body text | 1.5 - 1.75 | WCAG 1.4.12, readability |
| Headings | 1.1 - 1.3 | Visual impact |
| Code blocks | 1.5 - 1.7 | Scanning readability |
| Buttons/labels | 1.2 - 1.5 | UI element |

Check for unitless line-height (preferred over px/em for inheritance).

### Step 4: Letter Spacing Audit

| Element Type | Expected Range | Standard |
|-------------|---------------|----------|
| Display headings | -0.02em to 0 | Tight for visual |
| Body text | 0 (default) | Normal |
| Uppercase labels | 0.05em - 0.1em | Legibility |
| Monospace code | 0.08em - 0.15em | Wide for scanning |

**WCAG 1.4.12 override test**: Text must remain readable when user overrides:
- Line height to at least 1.5x font size
- Letter spacing to at least 0.12em
- Word spacing to at least 0.16em

### Step 5: Reading Width Audit

Measure characters per line for body text containers:

| Metric | Optimal | Acceptable | Flag |
|--------|---------|-----------|------|
| Characters per line | 66ch | 45-75ch | < 45 or > 75 |
| Max container width | 65ch-75ch | Up to 900px | > 900px without column |

Check: `max-width` or `width` on body text containers.

### Step 6: Font Loading Strategy

| Property | Good | Acceptable | Poor |
|----------|------|-----------|------|
| Body font | `font-display: swap` | `font-display: fallback` | `font-display: block` or missing |
| Display font | `font-display: optional` | `font-display: swap` | `font-display: block` |
| Preload | Critical fonts preloaded | Some preloaded | None preloaded |
| Fallback stack | System font fallback defined | Generic fallback | No fallback |

Check for FOUT (Flash of Unstyled Text) / FOIT (Flash of Invisible Text) risks.

## Phase 4: Report Generation & Output

1. Write audit report to `<session>/audits/typography/typo-audit-{NNN}.md`:

```markdown
# Typography Accessibility Audit - {NNN}
[typo-auditor]

## Summary
- **Total typography rules audited**: {count}
- **Pass**: {pass_count} | **Fail**: {fail_count}
- **WCAG Level**: {AA|AAA}
- **Critical issues**: {count}
- **High issues**: {count}

## Font Size by Breakpoint
| Breakpoint | Element | Computed Size | Min Required | Status |
|-----------|---------|--------------|-------------|--------|
| 320px | body | Xpx | 16px | PASS/FAIL |
| 320px | h1 | Xpx | -- | OK |
| ... | ... | ... | ... | ... |

## clamp() Validation
| Rule | clamp() Value | Min | Max | Status |
|------|--------------|-----|-----|--------|
| .body | clamp(1rem, 2vw, 1.25rem) | 16px | 20px | PASS/FAIL |
| ... | ... | ... | ... | ... |

## Line Height Audit
| Element | Current | Expected Range | Status |
|---------|---------|---------------|--------|
| body | 1.6 | 1.5-1.75 | PASS |
| h1 | 1.2 | 1.1-1.3 | PASS |
| ... | ... | ... | ... |

## Letter Spacing Audit
| Element | Current | Expected Range | Status |
|---------|---------|---------------|--------|
| ... | ... | ... | ... |

## Reading Width
| Container | Width | Chars/Line | Optimal (45-75) | Status |
|-----------|-------|-----------|-----------------|--------|
| .content | 700px | ~68ch | Yes | PASS |
| ... | ... | ... | ... | ... |

## Font Loading
| Font | font-display | Preload | Fallback | Status |
|------|-------------|---------|----------|--------|
| ... | swap | yes/no | system | PASS/FAIL |

## Text Spacing Override Test (WCAG 1.4.12)
| Override | Applied | Content Readable | Status |
|---------|---------|-----------------|--------|
| line-height: 1.5x | Yes | Yes/No | PASS/FAIL |
| letter-spacing: 0.12em | Yes | Yes/No | PASS/FAIL |
| word-spacing: 0.16em | Yes | Yes/No | PASS/FAIL |

## Issues (by severity)
### Critical
- ...
### High
- ...
### Medium
- ...
```

2. Update `<session>/.msg/meta.json` under `typo-auditor` namespace:
   - Read existing -> merge `{ "typo-auditor": { audit_id, total_rules, pass_count, fail_count, critical_count, high_count, breakpoints_tested, timestamp } }` -> write back
