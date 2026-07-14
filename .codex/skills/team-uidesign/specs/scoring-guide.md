

# 8-Dimension Quality Scoring Rubric

Score each dimension 0-4. Total: 0-32.

## Dimensions

### 1. Anti-AI-Slop (Weight: 10%)

| Score | Criteria |
|-------|----------|
| 0 | 4+ P1 anti-patterns present |
| 1 | 2-3 P1 anti-patterns present |
| 2 | 1 P1 or 3+ P2 anti-patterns present |
| 3 | 1-2 P2 or 2+ P3 anti-patterns only |
| 4 | Zero P1/P2 anti-patterns, at most 1 P3 |

### 2. Color Quality (Weight: 15%)

| Score | Criteria |
|-------|----------|
| 0 | No color system; hex/rgb throughout; pure black/white used |
| 1 | Some tokens but not OKLCH; no tinted neutrals; contrast failures |
| 2 | OKLCH used partially; tinted neutrals attempted; most contrast passes |
| 3 | Full OKLCH; tinted neutrals; 60-30-10 applied; all WCAG AA passes; semantic tokens present |
| 4 | Score-3 plus: primitive->semantic->component hierarchy; color-mix usage; light/dark themes complete |

### 3. Typography Quality (Weight: 15%)

| Score | Criteria |
|-------|----------|
| 0 | System/generic font only; no scale; no fluid sizing |
| 1 | Generic font (Inter/Roboto/etc); basic size scale; no clamp() |
| 2 | Distinctive font chosen; modular scale present; no fluid sizing |
| 3 | Distinctive font; modular scale with clamp(); proper line-height; reading width constrained |
| 4 | Score-3 plus: font-display swap with fallback metrics; caption/body/heading line-heights differentiated |

### 4. Spacing & Layout (Weight: 12.5%)

| Score | Criteria |
|-------|----------|
| 0 | Arbitrary spacing; no system; nested cards |
| 1 | Some consistent spacing but not 4pt scale; margin-heavy |
| 2 | 4pt scale used; mostly gap over margin; some rhythm variation |
| 3 | Full 4pt scale; gap throughout; rhythm variation (tight/comfortable/generous); touch targets met |
| 4 | Score-3 plus: container queries used; no nested cards; 8px adjacent target gaps |

### 5. Motion & Animation (Weight: 10%)

| Score | Criteria |
|-------|----------|
| 0 | Layout property animations; no easing system; no reduced-motion |
| 1 | Some transform/opacity; default ease/linear; no reduced-motion |
| 2 | Transform/opacity only; custom easing present; reduced-motion exists but incomplete |
| 3 | All animations on safe properties; ease-out-quart default; duration tokens; complete reduced-motion |
| 4 | Score-3 plus: stagger system; will-change managed via JS; exit = 75% entrance |

### 6. Interaction States (Weight: 15%)

| Score | Criteria |
|-------|----------|
| 0 | Only default state; no hover/focus/disabled |
| 1 | 2-3 states (e.g., default + hover + disabled) |
| 2 | 5 states (default/hover/focus/active/disabled) but missing loading/error/success |
| 3 | All 8 states defined; :focus-visible used; hover in @media(hover:hover) |
| 4 | Score-3 plus: focus ring spec (2px solid + offset 2px); active scale(0.97); ARIA attributes on all states |

### 7. Visual Hierarchy (Weight: 10%)

| Score | Criteria |
|-------|----------|
| 0 | Everything same size/weight; no CTA hierarchy; all centered |
| 1 | Some size variation; multiple primary CTAs per viewport |
| 2 | Clear heading hierarchy; CTA levels present but inconsistent |
| 3 | Passes squint test; single primary CTA per viewport; 3:1 size ratio; max 2 weights |
| 4 | Score-3 plus: progressive disclosure; clear information density gradient |

### 8. Responsive Design (Weight: 12.5%)

| Score | Criteria |
|-------|----------|
| 0 | Fixed widths; breaks below 768px; content hidden on mobile |
| 1 | Some media queries; horizontal scroll at 320px; small touch targets |
| 2 | Mobile-first breakpoints; fluid widths; 14px min text; some issues at 320px |
| 3 | Full breakpoint coverage; fluid design (clamp/vw/fr); 44px targets; no 320px scroll |
| 4 | Score-3 plus: container queries; adapt-don't-hide approach; fluid typography |

---

## Rating Bands

| Score | Band | Meaning |
|-------|------|---------|
| 28-32 | Excellent | Production-ready, Impeccable quality |
| 22-27 | Good | Minor polish needed, shippable |
| 16-21 | Acceptable | Needs revision, core structure sound |
| 10-15 | Poor | Significant rework required |
| 0-9 | Critical | Fundamental issues, restart design phase |

## Severity Mapping

| Severity | Dimension Score | Action |
|----------|----------------|--------|
| P0 Blocking | Dimension = 0 | Must fix before any progress |
| P1 Major | Dimension = 1 | Fix in current iteration |
| P2 Minor | Dimension = 2 | Fix in next iteration |
| P3 Polish | Dimension = 3 | Track for future improvement |

## Signal Determination

| Condition | Signal | Action |
|-----------|--------|--------|
| Score >= 26 AND no P0 (no dim at 0) | `audit_passed` (GC CONVERGED) | Unblock downstream |
| Score >= 20 AND no P0 | `audit_result` (REVISION NEEDED) | Create fix task |
| Score < 20 OR any P0 | `fix_required` (CRITICAL) | Urgent fix task |
