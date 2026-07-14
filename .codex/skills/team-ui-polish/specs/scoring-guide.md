

# Scoring Guide

How to score each dimension consistently. Used by scanner for initial audit and verifier for re-assessment.

## Rating Bands (Total Score out of 36)

| Range | Rating | Description |
|-------|--------|-------------|
| 32-36 | Excellent | Distinctive, intentional design. Minimal or zero issues |
| 25-31 | Good | Solid design with minor polish opportunities |
| 18-24 | Acceptable | Functional but significant design work needed |
| 11-17 | Poor | Major overhaul required across multiple dimensions |
| 0-10 | Critical | AI slop gallery or fundamentally broken design |

## Per-Dimension Scoring (0-4)

### General Rubric

| Score | Criteria |
|-------|----------|
| 0 | Completely failing. Multiple major violations. Fundamental problems |
| 1 | Major gaps. 3-4 violations. Some effort but insufficient |
| 2 | Partial effort. 1-2 noticeable issues. Functional but not good |
| 3 | Mostly clean. Subtle issues only. Good with minor polish needed |
| 4 | Excellent. Genuinely distinctive/intentional. Meets all standards |

### Dimension 1: Anti-AI-Slop Detection

| Score | Criteria |
|-------|----------|
| 0 | 5+ AI slop tells present. Looks immediately AI-generated |
| 1 | 3-4 AI slop tells. Heavy AI influence obvious |
| 2 | 1-2 noticeable AI tells. Some templated elements |
| 3 | Subtle traces only. Mostly intentional design choices |
| 4 | Zero AI tells. Genuinely distinctive aesthetic. Would never guess AI-made |

### Dimension 2: Color Quality

| Score | Criteria |
|-------|----------|
| 0 | Multiple WCAG AA failures, pure black/white everywhere, hard-coded colors, no system |
| 1 | Some contrast issues, hard-coded colors, no token system, pure grays |
| 2 | Basic contrast OK, some OKLCH or tokens, but gaps (untinted grays, missing semantic colors) |
| 3 | Good color system with minor gaps (a few hard-coded values, imperfect 60-30-10) |
| 4 | OKLCH-based, fully tokenized, WCAG AA+ compliant, proper 60-30-10, semantic roles defined |

### Dimension 3: Typography Quality

| Score | Criteria |
|-------|----------|
| 0 | Generic font, no scale, body text <16px, no hierarchy |
| 1 | Overused font, muddy sizes (many close values), missing fluid sizing |
| 2 | Decent font choice but inconsistent scale or line-height issues |
| 3 | Good typography with minor gaps (missing clamp, slight rhythm inconsistencies) |
| 4 | Distinctive font, clear modular scale, fluid sizing, proper vertical rhythm, max-width on prose |

### Dimension 4: Spacing & Layout Quality

| Score | Criteria |
|-------|----------|
| 0 | Random spacing, nested cards, fixed widths, tiny touch targets |
| 1 | Some spacing pattern but many arbitrary values, cards overused |
| 2 | Decent spacing but monotonous rhythm or occasional arbitrary values |
| 3 | Good spacing system with minor gaps (occasional non-scale value, mostly gap usage) |
| 4 | Consistent scale, varied rhythm, gap for siblings, proper touch targets, no card nesting |

### Dimension 5: Motion & Animation Quality

| Score | Criteria |
|-------|----------|
| 0 | Layout animations, no reduced-motion, bounce easing, no system |
| 1 | Some transform-based but bad easing, missing reduced-motion |
| 2 | Decent animations but no token system or still missing reduced-motion |
| 3 | Good system with minor gaps (occasional ease default, missing exit animation) |
| 4 | Transform+opacity only, exponential easing, reduced-motion query, duration tokens, proper stagger |

### Dimension 6: Interaction States

| Score | Criteria |
|-------|----------|
| 0 | No hover, no focus, outline:none without replacement, no loading states |
| 1 | Basic hover but missing focus/active on many elements, no loading states |
| 2 | Hover + focus exist but no focus-visible, missing some states (disabled, error, empty) |
| 3 | Most states present with minor gaps (imperfect focus ring, missing empty state) |
| 4 | All 8 states implemented, focus-visible, proper focus ring, loading/error/success/empty states |

### Dimension 7: Visual Hierarchy

| Score | Criteria |
|-------|----------|
| 0 | Everything same visual weight, no clear primary action, fails squint test completely |
| 1 | Some size differences but no clear hierarchy system, multiple competing primary actions |
| 2 | Basic hierarchy via size but missing weight/color/space dimensions |
| 3 | Good hierarchy with minor issues (occasional visual competition, could be stronger) |
| 4 | Clear squint test pass, obvious primary action, multi-dimension hierarchy, progressive disclosure |

### Dimension 8: Responsive Design

| Score | Criteria |
|-------|----------|
| 0 | No responsive design, horizontal scroll, completely broken on mobile |
| 1 | Basic media queries but many breakage points, some fixed widths |
| 2 | Decent mobile but some fixed widths, small targets, or missing breakpoints |
| 3 | Good responsive with minor issues (missing container queries, occasional small target) |
| 4 | Fluid design, proper breakpoints, container queries, 44px targets, no overflow, adapted content |

### Dimension 9: Cognitive Load & UX Writing

| Score | Criteria |
|-------|----------|
| 0 | Information overload everywhere, no grouping, generic labels, useless error messages |
| 1 | Some grouping but >7 data groups visible, many generic labels, errors without fix guidance |
| 2 | Decent grouping but missing progressive disclosure, some generic buttons, partial error messages |
| 3 | Good information architecture with minor issues (occasional generic label, one missing empty state) |
| 4 | Clear progressive disclosure, verb+object labels, what+why+fix errors, guided empty states, proper grouping |

### Dimension 10: Dark Mode Quality (Conditional)

Only scored if dark mode exists. If no dark mode, this dimension is excluded from total.

| Score | Criteria |
|-------|----------|
| 0 | Pure black bg, no surface hierarchy, saturated colors vibrating, dangerous combos |
| 1 | Some dark surfaces but flat (same lightness), still using light-mode font weights |
| 2 | Basic surface hierarchy but still saturated accents or missing font weight reduction |
| 3 | Good dark mode with minor issues (occasional pure black, one dangerous combo) |
| 4 | Proper surface hierarchy (lighter=higher), desaturated accents, reduced font weights, tinted dark bg |

When dark mode exists: total out of 40, bands shift +4. When no dark mode: total out of 36.

---

## Severity Mapping

| Severity | Definition | Score Correlation | Action |
|----------|-----------|-------------------|--------|
| P0 Blocking | Prevents use or violates law/standard. WCAG AA failure, missing focus, horizontal scroll on mobile, no viewport meta | Any dimension at 0 | Fix immediately, blocks release |
| P1 Major | Significant UX harm or near-violation. Pure black/white, missing hover, all buttons primary, muddy hierarchy | Any dimension at 1 | Fix before release |
| P2 Minor | Annoyance with workaround. No OKLCH, overused fonts, monotonous spacing, no container queries | Any dimension at 2 | Fix in next polish pass |
| P3 Polish | Nice-to-fix, minimal user impact. Missing exit animation, optical adjustments, font fallback metrics | Dimension at 3 with minor issues | Fix when convenient |

---

## Scoring Process

1. For each dimension, go through every checklist item in the scanner audit
2. Count the number and severity of violations found
3. Apply the dimension-specific rubric to assign 0-4
4. Sum all 8 dimensions for total (0-32)
5. Apply rating band

### Tie-Breaking Rules
- If between two scores, the presence of any P0 issue in that dimension rounds down
- If between two scores with no P0, consider the count of P1 issues
- When in doubt, score lower (conservative) -- it is better to fix something unnecessary than miss something important

### Verification Scoring
When verifier re-scores after optimization:
- Use identical checklist and rubric as original scan
- Score independently (do not adjust based on "how much improved")
- Report both absolute score and delta from original
- Flag any dimension where score decreased (regression)
