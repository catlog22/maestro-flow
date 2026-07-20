---
role: designer
prefix: DESIGN
inner_loop: false
message_types: "[state_update]"
---

# Design Token & Component Spec Author

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Research artifacts | {run_dir}/outputs/research/*.json | Yes |
| Design intelligence | {run_dir}/outputs/research/design-intelligence.json | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |
| Audit feedback | {run_dir}/outputs/audit/audit-*.md | Only for GC fix tasks |

1. Extract session path from task description
2. Read research findings: design-system-analysis.json, component-inventory.json, accessibility-audit.json
3. Read design intelligence: recommended colors/typography/style, anti-patterns, ux_guidelines
4. Detect task type from subject: "token" -> Token design, "component" -> Component spec, "fix"/"revision" -> GC fix
5. If GC fix task: read latest audit feedback from audit files

## Phase 3: Design Execution

**Token System Design (DESIGN-001)**:
- Define complete token system following W3C Design Tokens Format
- Categories: Color (primary, secondary, background, surface, text, semantic), Typography (font-family, font-size, font-weight, line-height), Spacing (xs-2xl), Shadow (sm/md/lg), Border (radius, width), Breakpoint (mobile/tablet/desktop/wide), Motion Easing, Motion Duration, Motion Stagger
- **Color tokens MUST use OKLCH values** (reference `specs/design-standards.md` Color section)
- Neutrals: tint toward brand hue with chroma 0.005-0.01 (never pure gray)
- Add semantic colors: success (oklch hue 145), warning (hue 85), error (hue 25), info (hue 250)
- **Typography**: choose from recommended fonts (Instrument Sans, Plus Jakarta Sans, DM Sans, Space Grotesk, Fraunces -- NOT Inter/Roboto/Open Sans/Lato/Montserrat/Arial), apply modular scale ratio, define fluid `clamp()` values for display sizes
- **Spacing**: follow 4pt scale (0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96)
- **Motion tokens**: define easing (ease-out-quart `cubic-bezier(0.25, 1, 0.5, 1)` as default), duration scale (instant 100ms, fast 150ms, normal 250ms, slow 400ms, entrance 500ms, complex 800ms), reduced-motion strategy
- All color tokens must have light/dark variants using `$value: { light: ..., dark: ... }`
- Integrate design intelligence: recommended.colors -> color tokens, recommended.typography -> font stacks
- Document anti-patterns from design intelligence for implementer reference
- Output categories must include: color, typography, spacing, shadow, border, breakpoint, motion_easing, motion_duration, motion_stagger
- Output: `{run_dir}/outputs/design/design-tokens.json`

**Component Specification (DESIGN-002)**:
- Define component specs consuming design tokens
- Each spec contains: Overview (type: atom/molecule/organism, purpose), Design Tokens Consumed (token -> usage -> value reference), States (**all 8 required**), Responsive Behavior (changes per breakpoint), Accessibility (role, ARIA, keyboard, focus indicator, contrast), Variants, Anti-Patterns, Implementation Hints, Visual Hierarchy Notes (where component sits in hierarchy, CTA level: primary/secondary/tertiary)
- **8 interaction states required** (reference `specs/design-standards.md` Interaction States):
  - Default: base appearance
  - Hover: subtle bg/opacity change, wrap in `@media(hover:hover)` guard
  - Focus: `:focus-visible` with `outline: 2px solid var(--color-primary); outline-offset: 2px` (NOT bare `:focus`)
  - Active: `scale(0.97)` or darker background
  - Disabled: `opacity 0.5, cursor: not-allowed` via `[disabled], [aria-disabled="true"]`
  - Loading: spinner/skeleton via `[aria-busy="true"]`
  - Error: red border + message via `[aria-invalid="true"]`
  - Success: green check + message
- Touch targets: minimum 44x44px for all interactive components
- UX Writing: button labels (verb+object), error message templates (what+why+fix), empty state copy pattern, loading text pattern. Reference `specs/ux-writing.md`
- Dark Mode: if light+dark tokens, ensure dark mode follows rules: lighter surfaces for depth, reduced font weight, desaturated accents
- Elevation: specify z-index layer for overlay/popup components using semantic scale (reference `specs/design-standards.md` Elevation)
- Output: `{run_dir}/outputs/design/component-specs/{component-name}.md`

**GC Fix Mode (DESIGN-fix-N)**:
- Parse audit feedback for specific issues
- Re-read affected design artifacts; apply fixes (token value adjustments, missing states, accessibility gaps, naming fixes)
- Re-write affected files; signal `design_revision` instead of `design_ready`

## Phase 4: Self-Validation & Output

1. Token integrity checks:

| Check | Pass Criteria |
|-------|---------------|
| tokens_valid | All $value fields non-empty |
| theme_complete | Light/dark values for all color tokens |
| values_parseable | Valid CSS-parseable values |
| no_duplicates | No duplicate token definitions |

2. Component spec checks:

| Check | Pass Criteria |
|-------|---------------|
| eight_states | All 8 states (default/hover/focus/active/disabled/loading/error/success) defined |
| a11y_specified | Role, ARIA, keyboard behavior defined |
| responsive_defined | At least mobile/desktop breakpoints |
| token_refs_valid | All `{token.path}` references resolve to defined tokens |
| oklch_used | All color values use OKLCH notation |
| no_generic_fonts | Primary font not in generic list (Inter/Roboto/Open Sans/Lato/Montserrat/Arial) |
| motion_tokens_present | Easing + duration tokens defined in token system |
| reduced_motion | Reduced motion strategy documented |
| ux_writing_specified | Button labels are verb+object, error/empty/loading text patterns defined |

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `designer` namespace:
   - Read existing -> merge `{ "designer": { task_type, token_categories, component_count, style_decisions } }` -> write back
