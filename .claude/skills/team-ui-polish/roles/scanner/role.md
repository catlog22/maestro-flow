---
role: scanner
prefix: SCAN
inner_loop: false
message_types: [scan_complete, scan_progress, error]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# UI Scanner -- 8-Dimension Design Audit

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Target files or URL | From task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Anti-patterns catalog | specs/anti-patterns.md | Yes |
| Design standards | specs/design-standards.md | Yes |

1. Extract session path and target from task description
2. Read specs/anti-patterns.md and specs/design-standards.md for reference criteria
3. Load target files based on target type:
   - **URL target**: Use Chrome DevTools to navigate, take screenshots at 3 viewports:
     - Mobile: `mcp__chrome-devtools__resize_page(width=375, height=812)` + screenshot
     - Tablet: `mcp__chrome-devtools__resize_page(width=768, height=1024)` + screenshot
     - Desktop: `mcp__chrome-devtools__resize_page(width=1440, height=900)` + screenshot
     - Save to `<session>/evidence/before-mobile.png`, `before-tablet.png`, `before-desktop.png`
   - **Component target**: Read CSS/SCSS, HTML, JS/TS/JSX/TSX files
   - **Full site target**: Glob for all frontend source files (*.css, *.scss, *.tsx, *.jsx, *.html, *.vue, *.svelte)
4. Extract raw data for analysis:
   - All color values (hex, rgb, hsl, oklch, named colors, CSS custom properties)
   - All font declarations (font-family, font-size, font-weight, line-height)
   - All spacing values (margin, padding, gap, inset)
   - All animation/transition declarations
   - All interactive pseudo-classes and state handling
5. If Chrome DevTools available: extract computed styles via `mcp__chrome-devtools__evaluate_script`

## Phase 3: 8-Dimension Scan

For each dimension, check every item in the checklist. Record each finding with:
- Location: file:line (or "screenshot: viewport" for visual-only issues)
- Severity: P0 (blocking) / P1 (major) / P2 (minor) / P3 (polish)
- Description: what is wrong and why it matters
- Evidence: the specific code or visual that triggers the finding

---

### Dimension 1: Anti-AI-Slop Detection (CRITICAL -- scan first)

**The AI Slop Test**: "If you showed this to someone and said 'AI made this,' would they believe you immediately? If yes, that is the problem."

Check for these AI-generated UI fingerprints:

| # | Pattern | What to Look For | Severity |
|---|---------|-------------------|----------|
| 1 | AI color palette | cyan-on-dark (#00d4ff, #06b6d4), purple-to-blue gradients, neon accents on dark backgrounds | P1 |
| 2 | Gradient text | `background-clip: text` + gradient on metrics, headings, or hero text for "impact" | P1 |
| 3 | Default dark mode | Dark background with glowing/neon accents as the default theme; avoids real design decisions | P2 |
| 4 | Glassmorphism everywhere | `backdrop-filter: blur()`, glass cards, glow borders (`box-shadow: 0 0 Xpx color`), used decoratively not functionally | P1 |
| 5 | Hero metric layout | Big number + small label + supporting stats in a row + gradient accent. The "AI dashboard" template | P2 |
| 6 | Identical card grids | Same-sized cards with icon + heading + body text repeated 3-6 times in a grid | P2 |
| 7 | Nested cards | Cards inside cards (`.card .card`, multiple layers of bordered containers) | P2 |
| 8 | Generic fonts | Inter, Roboto, Arial, Open Sans, Lato, Montserrat, system-ui used without intentional choice | P2 |
| 9 | Rounded rect + shadow | `border-radius: 8-16px` + `box-shadow: 0 1-4px 6-24px rgba(0,0,0,0.1)` on everything | P3 |
| 10 | Icon-above-heading | Large icons (24-48px) with rounded corners/background placed above every heading or card | P2 |
| 11 | One-side border accent | `border-left: 3-4px solid <accent>` or `border-top` as lazy accent on cards | P3 |
| 12 | Decorative sparklines | Tiny charts/graphs that look sophisticated but convey no actionable data | P2 |
| 13 | Bounce/elastic easing | `cubic-bezier(0.68, -0.55, 0.265, 1.55)` or spring animations. Dated, 2015 aesthetic | P2 |
| 14 | Redundant copy | Intro paragraphs that restate the heading. "Welcome to Dashboard. This dashboard shows..." | P3 |
| 15 | All buttons primary | Every button is filled/primary. No ghost buttons, text links, or secondary variants | P1 |
| 16 | Everything centered | `text-align: center` or `justify-content: center` on everything. No asymmetry | P2 |
| 17 | Same spacing everywhere | Identical margin/padding on all elements. No spacing rhythm or variation | P2 |
| 18 | Monospace as tech | Monospace fonts used for non-code content to appear "techy" | P3 |
| 19 | Modal overuse | Modals for confirmations, settings, forms -- when inline or drawer would work | P3 |
| 20 | Pure black/white | `#000000` or `#ffffff` without any tint toward brand hue | P1 |

**Scoring**:
- 0: AI slop gallery (5+ tells present)
- 1: Heavy AI influence (3-4 tells)
- 2: Some AI tells (1-2 noticeable)
- 3: Mostly clean (subtle traces only)
- 4: Distinctive (genuinely intentional design, zero AI tells)

---

### Dimension 2: Color Quality

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Pure black usage | `#000`, `#000000`, `rgb(0,0,0)` anywhere except borders/outlines | P1 |
| 2 | Pure white usage | `#fff`, `#ffffff`, `rgb(255,255,255)` for backgrounds without brand tint | P1 |
| 3 | Untinted grays | Gray values with chroma exactly 0 (pure gray). Should have chroma 0.005-0.01 toward brand hue | P2 |
| 4 | Gray on colored bg | Gray text (#666, #999, etc.) on colored backgrounds. Looks washed out. Use shade of background or transparency | P1 |
| 5 | WCAG AA contrast | Text contrast below 4.5:1 (normal text) or 3:1 (large text >= 18px/24px bold) | P0 |
| 6 | UI component contrast | Interactive component boundaries below 3:1 contrast against adjacent colors | P1 |
| 7 | No OKLCH | All colors in hex/rgb/hsl without oklch() for perceptual uniformity | P2 |
| 8 | Accent overuse | Accent color exceeds 10% of visual weight. Violates 60-30-10 rule (60% neutral, 30% secondary, 10% accent) | P2 |
| 9 | No semantic roles | Colors not organized into primary/neutral/semantic(success,warning,error)/surface layers | P2 |
| 10 | Hard-coded colors | Color values inline in components instead of CSS custom properties or design tokens | P2 |
| 11 | No dark/light tokens | Single-theme colors without alternate theme support | P3 |

**Scoring**:
- 0: Multiple contrast failures, pure black/white everywhere, no system
- 1: Contrast issues, hard-coded colors, no tokens
- 2: Basic contrast OK but no OKLCH, some hard-coded values
- 3: Good system with minor gaps (some untinted grays or missing tokens)
- 4: OKLCH-based, fully tokenized, WCAG AA+ compliant, proper 60-30-10

---

### Dimension 3: Typography Quality

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Overused fonts | Inter, Roboto, Open Sans, Lato, Montserrat, Arial without intentional justification | P2 |
| 2 | Muddy hierarchy | Too many close font sizes (e.g., 13/14/15/16/18). Should have clear steps | P1 |
| 3 | No modular scale | Font sizes without mathematical ratio (1.125, 1.2, 1.25, 1.333, 1.5, 1.618) | P2 |
| 4 | Small body text | Body/paragraph text below 16px (1rem) | P1 |
| 5 | Line length | Body text wider than 75ch or narrower than 45ch. Optimal: 65ch | P2 |
| 6 | Inconsistent line-height | Different line-heights without system. Should follow vertical rhythm | P2 |
| 7 | No fluid sizing | Headings without `clamp()` for responsive scaling. Fixed px that are too big on mobile or too small on desktop | P2 |
| 8 | Monospace misuse | Monospace fonts for non-code body content used as "tech" aesthetic | P3 |
| 9 | Missing font-display | No `font-display: swap` causing FOIT (flash of invisible text) | P2 |
| 10 | Too many font families | More than 2-3 font families in use (excluding monospace for code) | P2 |
| 11 | No fallback metrics | Custom fonts without `size-adjust`, `ascent-override` for CLS prevention | P3 |

**Scoring**:
- 0: Generic font, no scale, tiny text, no hierarchy
- 1: Overused font, muddy sizes, missing fluid sizing
- 2: Decent font choice but inconsistent scale or line-height
- 3: Good typography with minor gaps (missing clamp, slight inconsistencies)
- 4: Distinctive font, clear modular scale, fluid sizing, proper rhythm

---

### Dimension 4: Spacing & Layout Quality

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Arbitrary spacing | Spacing values outside a consistent scale (e.g., 7px, 13px, 22px, 37px) | P2 |
| 2 | No spacing scale | No evidence of 4pt base (4, 8, 12, 16, 24, 32, 48, 64, 96px) or similar system | P2 |
| 3 | Monotonous spacing | Same padding/margin value everywhere. No rhythm (tight groups + generous separations) | P2 |
| 4 | Card overuse | Everything wrapped in cards. Cards for single text items, cards for navigation, cards for everything | P2 |
| 5 | Nested cards | Cards inside cards. Multiple bordered containers creating visual noise | P1 |
| 6 | Fixed widths | Hard-coded pixel widths that break on different viewports | P1 |
| 7 | Small touch targets | Interactive elements below 44x44px (buttons, links, inputs on mobile) | P1 |
| 8 | Margin for siblings | Using `margin` between sibling elements instead of `gap` on parent | P3 |
| 9 | No optical adjustment | Purely mathematical centering without optical corrections (e.g., play button in circle) | P3 |
| 10 | No max-width on prose | Text containers without max-width causing ultra-wide line lengths | P2 |

**Scoring**:
- 0: Random spacing, nested cards, fixed widths, tiny touch targets
- 1: Some system but many arbitrary values, cards overused
- 2: Decent spacing but monotonous or missing rhythm
- 3: Good system with minor gaps (occasional arbitrary value)
- 4: Consistent scale, varied rhythm, gap usage, proper touch targets

---

### Dimension 5: Motion & Animation Quality

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Layout property animation | Animating `width`, `height`, `top`, `left`, `margin`, `padding` (causes layout thrashing) | P1 |
| 2 | Bad easing | Using `ease` (default), `linear`, or `ease-in-out` for UI transitions. Should use exponential curves | P2 |
| 3 | Bounce/elastic | `cubic-bezier(0.68, -0.55, 0.265, 1.55)` or similar bounce curves. Dated aesthetic | P2 |
| 4 | No reduced-motion | Missing `@media (prefers-reduced-motion: reduce)` query. Affects ~35% of adults over 40 | P0 |
| 5 | No motion tokens | No consistent duration/easing system. Random 200ms/300ms/0.5s values | P2 |
| 6 | Uncapped stagger | Stagger animation over 10 items or total duration > 500ms | P2 |
| 7 | Premature will-change | `will-change` set in CSS instead of activated on interaction (wastes GPU memory) | P3 |
| 8 | No exit animation | Elements appear with animation but disappear instantly | P3 |
| 9 | Slow feedback | Hover/focus/active feedback slower than 150ms | P2 |
| 10 | Animation on load | Heavy entrance animations on page load that delay content access | P2 |

**Scoring**:
- 0: Layout animations, no reduced-motion, bounce easing, no system
- 1: Some transform-based but bad easing, missing reduced-motion
- 2: Decent animations but no token system or missing reduced-motion
- 3: Good system with minor gaps (occasional bad easing, missing exit animation)
- 4: Transform+opacity only, exponential easing, reduced-motion, token system, proper stagger

---

### Dimension 6: Interaction States

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Missing hover | Interactive elements without `:hover` state (no pointer feedback) | P1 |
| 2 | Missing focus | Interactive elements without `:focus` state (keyboard users invisible) | P0 |
| 3 | outline: none | `outline: none` or `outline: 0` without replacement focus indicator | P0 |
| 4 | No focus-visible | Using `:focus` instead of `:focus-visible` (showing focus ring on mouse click) | P2 |
| 5 | Missing active | No `:active` / pressed state on buttons/links | P2 |
| 6 | Missing disabled | No visual distinction for disabled state, or `disabled` without opacity/cursor change | P2 |
| 7 | Missing loading | Async actions (form submit, API calls) without loading feedback | P1 |
| 8 | Missing error/success | Forms without error/success state indication | P1 |
| 9 | Placeholder as label | `placeholder` used as the only label for form inputs (disappears on focus) | P1 |
| 10 | No empty state | Lists/tables without empty state design (blank space when no data) | P2 |
| 11 | Focus ring quality | Focus ring not meeting 2px solid accent, offset 2px, 3:1 contrast spec | P2 |

**Scoring**:
- 0: No hover, no focus, outline:none everywhere, no loading states
- 1: Basic hover but missing focus/active, no loading states
- 2: Hover + focus exist but no focus-visible, missing some states
- 3: Most states present with minor gaps (missing empty state, imperfect focus ring)
- 4: All 8 states implemented, focus-visible, proper focus ring, loading/error/success/empty

---

### Dimension 7: Visual Hierarchy

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Fails squint test | When page is blurred/squinted, cannot identify 1st and 2nd most important elements | P1 |
| 2 | Primary action unclear | Cannot identify the primary action within 2 seconds of viewing | P1 |
| 3 | Size-only hierarchy | Hierarchy established only through font size, not combining size + weight + color + space | P2 |
| 4 | No information grouping | Related content not grouped by proximity. Equal spacing between related and unrelated items | P2 |
| 5 | Visual competition | Multiple elements competing for attention at the same visual weight | P1 |
| 6 | No 3:1 ratio | Less than 3:1 size ratio between major hierarchy levels (e.g., h1 vs body) | P2 |
| 7 | Decoration over content | Visual decorations (icons, borders, backgrounds) draw more attention than content | P2 |
| 8 | No progressive disclosure | All information shown at once. No layering of detail (summary -> detail on demand) | P3 |

**Scoring**:
- 0: Everything same visual weight, no clear action, fails squint test
- 1: Some size differences but no clear hierarchy system
- 2: Basic hierarchy via size but missing weight/color/space dimensions
- 3: Good hierarchy with minor issues (occasional visual competition)
- 4: Clear squint test pass, obvious primary action, multi-dimension hierarchy, progressive disclosure

---

### Dimension 8: Responsive Design

| # | Check | What to Look For | Severity |
|---|-------|-------------------|----------|
| 1 | Fixed widths | Hard-coded pixel widths that break below certain viewport sizes | P1 |
| 2 | Horizontal scroll | Content causing horizontal scrollbar on viewports >= 320px | P0 |
| 3 | Hidden content | Content hidden on mobile via `display:none` instead of being adapted/restructured | P2 |
| 4 | No container queries | Components that should adapt to container size still using viewport media queries only | P3 |
| 5 | Small mobile text | Text below 14px on mobile viewports (illegible without zoom) | P1 |
| 6 | Tiny mobile targets | Touch targets below 44x44px on mobile (frustrating to tap) | P1 |
| 7 | No breakpoints | Single layout for all viewports. No media queries or responsive grid | P1 |
| 8 | Broken images | Images that overflow or distort on narrow viewports (missing max-width:100%) | P1 |
| 9 | No viewport meta | Missing `<meta name="viewport" content="width=device-width, initial-scale=1">` | P0 |
| 10 | Desktop-first only | Only desktop layout works properly. Mobile is broken or unusable | P1 |

**Scoring**:
- 0: No responsive design, horizontal scroll, broken on mobile
- 1: Basic media queries but many breakage points
- 2: Decent mobile but some fixed widths or small targets
- 3: Good responsive with minor issues (missing container queries, occasional small target)
- 4: Fluid design, proper breakpoints, container queries, 44px targets, no overflow

---

### Dimension 9: Cognitive Load

Evaluate information processing burden per Impeccable's cognitive load principles.

| Check | Detection | Score Impact |
|-------|-----------|-------------|
| Information overload | >7 distinct data groups visible simultaneously without progressive disclosure | -1 per violation |
| Choice overload | >5 equally-weighted CTAs in one viewport | -1 |
| No progressive disclosure | All details shown at once, no expand/collapse or summary→detail | -1 |
| Redundant copy | Heading text repeated in body paragraph (>50% overlap) | -0.5 |
| Generic labels | "OK/Submit/Cancel" buttons without verb+object | -0.5 |
| Error without guidance | Error messages missing what+why+fix formula | -1 |
| Empty state without action | Data list shows "No data" without create/import guidance | -0.5 |
| No visual grouping | Related items not proximity-grouped or separated from unrelated | -1 |

### Dimension 10: Dark Mode Quality

Only score if dark mode exists. Skip and note "N/A — no dark mode" if not present.

| Check | Detection | Score Impact |
|-------|-----------|-------------|
| Pure black background | #000 or rgb(0,0,0) as base background | -2 |
| Same font weights as light | No weight reduction in dark theme | -1 |
| Saturated accents on dark | Same chroma values as light theme (vibrating colors) | -1 |
| No surface hierarchy | All dark surfaces same lightness (flat, no depth) | -1 |
| Dangerous combinations | Gray text on colored bg, saturated red-green adjacent | -1 |

---

## Phase 4: Generate Scan Report

Output: `<session>/scan/scan-report.md`

Report structure:

```markdown
# UI Polish Scan Report

## Overall Score: X/36 (<rating-band>)

## Anti-Patterns Verdict (Dimension 1)
Score: X/4
<verdict summary -- this section comes FIRST as it is most important>
<list of detected AI slop tells>

## Per-Dimension Scores

| Dimension | Score | Key Finding |
|-----------|-------|-------------|
| 1. Anti-Patterns | X/4 | <one-line summary> |
| 2. Color Quality | X/4 | <one-line summary> |
| 3. Typography | X/4 | <one-line summary> |
| 4. Spacing/Layout | X/4 | <one-line summary> |
| 5. Motion | X/4 | <one-line summary> |
| 6. Interaction States | X/4 | <one-line summary> |
| 7. Visual Hierarchy | X/4 | <one-line summary> |
| 8. Responsive | X/4 | <one-line summary> |
| 9. Cognitive Load | X/4 | <one-line summary> |
| 10. Dark Mode | X/4 or N/A | <one-line summary> |

## Issue Inventory

### P0 -- Blocking
| # | Dimension | Location | Description |
|---|-----------|----------|-------------|
| 1 | ... | file:line | ... |

### P1 -- Major
...

### P2 -- Minor
...

### P3 -- Polish
...

## Patterns & Systemic Issues
<recurring problems that affect multiple locations>

## Positive Findings
<what works well -- important for optimizer to not break>

## Scan Metadata
- Target: <target>
- Files scanned: <count>
- Screenshots: <yes/no, viewports>
- Timestamp: <ISO timestamp>
```

**Rating Bands** (total out of 36, or 40 with dark mode):
- 32-36: Excellent (36-40 with dark mode)
- 25-31: Good (29-35 with dark mode)
- 18-24: Acceptable (22-28 with dark mode)
- 11-17: Poor (15-21 with dark mode)
- 0-10: Critical (0-14 with dark mode)

After writing the report, send completion message:
```
mcp__maestro__team_msg(session_id, role="scanner", type="scan_complete", content="Scan complete. Score: X/36. P0: N, P1: N, P2: N, P3: N issues found.")
SendMessage(participant="coordinator", message="[scanner] SCAN-001 complete. Score: X/36 (<rating-band>). Issues: P0=N P1=N P2=N P3=N. Report: <session>/scan/scan-report.md")
```
