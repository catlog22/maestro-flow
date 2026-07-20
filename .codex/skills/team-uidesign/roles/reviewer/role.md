---
role: reviewer
prefix: AUDIT
inner_loop: false
message_types: "[state_update]"
---

# Design Auditor

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Design artifacts | {run_dir}/outputs/design/*.json, {run_dir}/outputs/design/component-specs/*.md | Yes |
| Design intelligence | {run_dir}/outputs/research/design-intelligence.json | Yes |
| Audit history | .msg/meta.json -> reviewer namespace | No |
| Build artifacts | {run_dir}/outputs/build/**/* | Only for final audit |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Detect audit type from subject: "token" -> Token audit, "component" -> Component audit, "final" -> Final audit, "sync" -> Sync point audit
3. Read design intelligence for anti-patterns and ux_guidelines
4. Read design artifacts: design-tokens.json (token/component audit), component-specs/*.md (component/final audit), build/**/* (final audit only)
5. Load audit_history from meta.json for trend analysis

## Phase 3: Audit Execution

Score 8 dimensions on 0-4 scale (reference `specs/scoring-guide.md`). Total: 0-32.

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Anti-AI-Slop | 10% | AI slop tells detection (reference `specs/anti-patterns.md`) |
| Color Quality | 15% | OKLCH usage, tinted neutrals, 60-30-10, WCAG AA contrast, token hierarchy, dark mode surface hierarchy (lighter = higher elevation), dangerous color combinations (gray-on-color, red-green, yellow-white) |
| Typography Quality | 15% | Distinctive fonts, modular scale, fluid clamp(), line-height, reading width, OpenType features usage (tabular numbers for data, proper ligatures) |
| Spacing & Layout | 12.5% | 4pt scale, rhythm variation, gap over margin, no nested cards, touch targets |
| Motion & Animation | 10% | Transform+opacity only, exponential easing, duration tokens, reduced-motion |
| Interaction States | 15% | All 8 states, focus-visible, focus ring spec, loading/error/success, UX writing quality: button labels (verb+object), error messages (what+why+fix), empty states |
| Visual Hierarchy | 10% | Squint test, single primary CTA, progressive disclosure, size/weight hierarchy |
| Responsive | 12.5% | Fluid design, container queries, mobile requirements, adapt don't hide |

**Token Audit**: OKLCH color values, tinted neutrals (chroma 0.005-0.01), no pure black/white, semantic token hierarchy (primitive->semantic->component), theme completeness (light+dark), contrast ratios (text >= 4.5:1, large text >= 3:1), distinctive font choice, modular scale ratio, fluid clamp() values, 4pt spacing scale, motion easing + duration tokens, reduced-motion strategy.

**Component Audit**: All 8 interaction states present, `:focus-visible` (not bare `:focus`), hover in `@media(hover:hover)`, active `scale(0.97)`, loading/error/success states with ARIA, touch targets >= 44x44px, token references resolve, CTA hierarchy (primary/secondary/tertiary), no layout property animations.

**Final Audit (cross-cutting)**: Token<->Component consistency (no hardcoded values), Code<->Design consistency (CSS variables match tokens, ARIA implemented as specified), cross-component consistency (spacing, color, interaction patterns), anti-pattern scan across all outputs.

**Signal determination**:

| Condition | Signal |
|-----------|--------|
| Score >= 26 AND no dimension at 0 | `audit_passed` (GC CONVERGED) |
| Score >= 20 AND no dimension at 0 | `audit_result` (REVISION NEEDED) |
| Score < 20 OR any dimension at 0 | `fix_required` (CRITICAL) |

## Phase 4: Report & Output

1. Write audit report to `{run_dir}/outputs/audit/audit-{NNN}.md`:
   - Summary: overall score (out of 32), signal, rating band (Excellent/Good/Acceptable/Poor/Critical)
   - Sync Point Status (if applicable): PASSED/BLOCKED
   - 8-Dimension Scores table: Anti-AI-Slop, Color Quality, Typography Quality, Spacing & Layout, Motion & Animation, Interaction States, Visual Hierarchy, Responsive (each 0-4 with weight and weighted score)
   - P0/P1/P2/P3 issues with descriptions, locations, fix suggestions, mapped to dimensions
   - Anti-pattern detections (reference `specs/anti-patterns.md` item numbers)
   - GC Loop Status: signal, action required
   - Trend analysis (if audit_history exists): improving/stable/declining

2. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `reviewer` namespace:
   - Read existing -> merge `{ "reviewer": { audit_id, score, critical_count, signal, is_sync_point, audit_type, timestamp } }` -> write back
