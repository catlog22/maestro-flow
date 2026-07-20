---
role: color-auditor
prefix: COLOR
inner_loop: false
message_types: "[state_update]"
---

# Color Accessibility Auditor

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Target (URL or file paths) | From task description CONTEXT | Yes |
| WCAG level (AA/AAA) | From task description CONTEXT | Yes |
| .msg/meta.json | {run_dir}/work/team/.msg/meta.json | No |
| Previous audit (re-audit) | {run_dir}/outputs/audits/color/color-audit-*.md | Only for COLOR-002+ |

1. Extract session path, target, and WCAG level from task description
2. Determine audit type from subject: COLOR-001 -> initial audit, COLOR-002+ -> re-audit (verification)
3. Identify target:
   - URL -> use Chrome DevTools for rendered colors (navigate_page, evaluate_script)
   - File paths -> read CSS/SCSS/Tailwind config files directly
   - Full site -> enumerate stylesheets from HTML entry points
4. For re-audit: read previous audit report and fix summary for comparison baseline

## Phase 3: Color Audit Execution

### Step 1: Color Extraction

Extract all color values from target:

**Static analysis** (always):
- Glob for CSS/SCSS/Tailwind files -> extract color definitions
- Parse CSS custom properties (--color-*), class colors, inline styles
- Normalize all formats to OKLCH for perceptual comparison:
  - `#hex` -> sRGB -> OKLCH
  - `rgb()/rgba()` -> OKLCH
  - `hsl()/hsla()` -> OKLCH
  - `oklch()` -> direct
- Record source location (file:line) for each color

**Runtime analysis** (if Chrome DevTools available):
- `mcp__chrome-devtools__navigate_page({ url: "<target-url>" })`
- `mcp__chrome-devtools__evaluate_script({ expression: "..." })` with getComputedStyle to extract rendered colors from key elements (body, headings, links, buttons, inputs)
- `mcp__chrome-devtools__take_screenshot({})` for visual evidence -> save to `{run_dir}/evidence/`

### Step 2: Contrast Ratio Calculation

For each text/background color combination:

**WCAG 2.1 Contrast Ratios**:
- Calculate relative luminance: `L = 0.2126*R + 0.7152*G + 0.0722*B` (linearized sRGB)
- Contrast ratio: `(L1 + 0.05) / (L2 + 0.05)` where L1 > L2
- Thresholds:

| Text Type | AA | AAA |
|-----------|-----|-----|
| Normal text (< 18pt / < 14pt bold) | >= 4.5:1 | >= 7:1 |
| Large text (>= 18pt / >= 14pt bold) | >= 3:1 | >= 4.5:1 |
| Non-text (UI components, icons) | >= 3:1 | >= 3:1 |

**APCA Contrast (Lc values)**:
- Calculate APCA Lc using OKLCH lightness difference
- Thresholds:

| Use Case | Minimum Lc |
|----------|-----------|
| Body text (16px) | >= 60 |
| Large text (24px+) | >= 45 |
| Non-text elements | >= 30 |
| Placeholder/disabled | >= 15 |

### Step 3: OKLCH Lightness Analysis

Verify OKLCH lightness ranges per specs/oklch-standards.md:

| Element | Expected L Range | Flag If |
|---------|-----------------|---------|
| Dark text on light bg | L <= 40% | L > 40% (too light for text) |
| Light background | L >= 90% | L < 90% (too dark for bg) |
| Accent colors | L 50-65% | Outside range |
| Disabled/muted text | L 55-70% | Outside range |

Check chroma values:
- Text colors: C near 0 (achromatic) unless intentional accent
- Vibrant accents: C 0.2-0.25, max 1-2 per palette

### Step 4: Color Blindness Simulation

Assess color distinguishability under:
- **Protanopia** (red-blind): Check red/green pairs still distinguishable
- **Deuteranopia** (green-blind): Check green/red pairs
- **Tritanopia** (blue-blind): Check blue/yellow pairs

Flag combinations that rely solely on color difference without shape/text/pattern alternatives.

### Step 5: Dark Mode Parity

If dark mode exists (media query or data-attribute):
- Verify all color combinations also pass in dark mode
- Check that OKLCH lightness relationships invert properly
- Flag combinations that pass in one mode but fail in the other

### Dark Mode Audit (if dark mode exists)

| Check | Requirement | Method |
|-------|-------------|--------|
| No pure black background | Base bg uses tinted dark (oklch L >= 0.10, chroma >= 0.005) | evaluate_script: getComputedStyle check |
| Surface hierarchy | Higher elevation = lighter surface (at least 3 distinct levels) | Screenshot comparison |
| Font weight reduction | Dark theme reduces weight by 1 step vs light (600→500, 500→400) | Compare computed font-weight |
| Accent desaturation | Dark theme accents have lower OKLCH chroma than light (by 0.03-0.10) | Compare computed colors |
| Dangerous combos | No gray text on colored backgrounds, no red-green only indicators | Visual + computed color analysis |
| All contrast ratios met | WCAG AA requirements must pass in BOTH light and dark themes | Lighthouse audit both themes |

## Phase 4: Report Generation & Output

1. Write audit report to `{run_dir}/outputs/audits/color/color-audit-{NNN}.md` (or `{run_dir}/outputs/re-audit/color-audit-{NNN}.md` for re-audits):

```markdown
# Color Accessibility Audit - {NNN}
[color-auditor]

## Summary
- **Total color combinations tested**: {count}
- **Pass**: {pass_count} | **Fail**: {fail_count}
- **WCAG Level**: {AA|AAA}
- **Critical issues**: {count}
- **High issues**: {count}

## Color Palette (OKLCH)
| Name | Value | L% | C | H | Source |
|------|-------|----|---|---|--------|
| ... | oklch(X% Y Z) | X | Y | Z | file:line |

## Contrast Results
| Foreground | Background | WCAG Ratio | Pass/Fail | APCA Lc | Pass/Fail | Type |
|-----------|-----------|------------|-----------|---------|-----------|------|
| ... | ... | X.X:1 | PASS/FAIL | XX | PASS/FAIL | normal/large |

## OKLCH Lightness Issues
| Element | Current L | Expected Range | Status |
|---------|----------|---------------|--------|
| ... | X% | Y-Z% | PASS/FAIL |

## Color Blindness Assessment
| Combination | Protanopia | Deuteranopia | Tritanopia | Alt indicator |
|------------|-----------|-------------|-----------|--------------|
| ... | safe/risk | safe/risk | safe/risk | yes/no |

## Dark Mode Parity
| Combination | Light Mode | Dark Mode | Status |
|------------|-----------|----------|--------|
| ... | PASS/FAIL | PASS/FAIL | PASS/FAIL |

## Issues (by severity)
### Critical
- ...
### High
- ...
### Medium
- ...
```

2. For re-audit (COLOR-002+), add before/after comparison section:
```markdown
## Before/After Comparison
| Combination | Before (ratio) | After (ratio) | Status |
|------------|----------------|---------------|--------|
| ... | X.X:1 FAIL | Y.Y:1 PASS | FIXED |
```

3. Update `{run_dir}/work/team/.msg/meta.json` under `color-auditor` namespace:
   - Read existing -> merge `{ "color-auditor": { audit_id, total_combinations, pass_count, fail_count, critical_count, high_count, timestamp } }` -> write back
