---
role: implementer
prefix: BUILD
inner_loop: false
message_types: "[state_update]"
---

# Component Code Builder

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Design tokens | {run_dir}/outputs/design/design-tokens.json | Yes (token build) |
| Component specs | {run_dir}/outputs/design/component-specs/*.md | Yes (component build) |
| Design intelligence | {run_dir}/outputs/research/design-intelligence.json | Yes |
| Latest audit report | {run_dir}/outputs/audit/audit-*.md | No |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Detect build type from subject: "token" -> Token implementation, "component" -> Component implementation
3. Read design artifacts: design-tokens.json (token build), component-specs/*.md (component build)
4. Read design intelligence: stack_guidelines (tech-specific patterns), anti_patterns (patterns to avoid), ux_guidelines
5. Read latest audit report for approved changes and feedback
6. Detect project tech stack from package.json

## Phase 3: Implementation Execution

**Token Implementation (BUILD-001)**:
- Convert design tokens to production code
- Output files in `{run_dir}/outputs/build/token-files/`:
  - `tokens.css`: CSS custom properties with `:root` (light) and `[data-theme="dark"]` selectors, plus `@media (prefers-color-scheme: dark)` fallback
  - `tokens.ts`: TypeScript constants and types for programmatic access with autocomplete support
  - `README.md`: Token usage guide
- **Color tokens**: generate OKLCH values in CSS custom properties (no hex/rgb)
- **Motion tokens**: generate easing + duration custom properties + reduced-motion query:
  ```css
  --easing-default: cubic-bezier(0.25, 1, 0.5, 1);
  --duration-instant: 100ms;
  --duration-fast: 150ms;
  /* ... */
  @media (prefers-reduced-motion: reduce) { /* ... */ }
  ```
- **Spacing**: 4pt scale custom properties (--space-0 through --space-24)
- Z-index tokens: generate semantic z-index custom properties (`--z-dropdown` through `--z-tooltip`)
- Dark mode: ensure dark theme uses lighter surfaces for depth, reduced font weight references
- All color tokens must have both light and dark values
- Semantic token names must match design token definitions

**Component Implementation (BUILD-002)**:
- Implement component code from design specifications
- Per-component output in `{run_dir}/outputs/build/component-files/`:
  - `{ComponentName}.tsx`: React/Vue/Svelte component (match detected stack)
  - `{ComponentName}.css`: Styles consuming tokens via `var(--token-name)` only
  - `{ComponentName}.test.tsx`: Basic render + state tests
  - `index.ts`: Re-export
- Requirements: no hardcoded colors/spacing (use design tokens), implement **all 8 states**, add ARIA attributes per spec, support responsive breakpoints, follow project component patterns
- **Focus**: use `:focus-visible` not bare `:focus`. Spec: `outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: inherit`
- **Hover**: wrap in `@media(hover:hover)` guard
- **Animation**: transform+opacity only (NEVER width/height/margin/padding), use motion tokens for easing and duration, add reduced-motion fallback via `@media (prefers-reduced-motion: reduce)`
- **Touch targets**: 44x44px minimum for all interactive elements, 8px gap between adjacent targets
- Accessibility: keyboard navigation, screen reader support, visible focus indicators, WCAG AA contrast
- Responsive images: use `srcset` with width descriptors + `sizes` attribute for content images. Use `<picture>` for art direction
- Input method: beyond `@media(hover:hover)`, also use `@media(pointer:coarse)` for touch-specific adjustments (larger targets, simpler hover alternatives)
- UX writing: implement button labels, error messages, empty states as specified in component spec. No generic "OK/Cancel"
- Check implementation against design intelligence anti_patterns and `specs/anti-patterns.md`

## Phase 4: Validation & Output

1. Token build validation:

| Check | Pass Criteria |
|-------|---------------|
| File existence | tokens.css and tokens.ts exist |
| Token coverage | All defined tokens present in CSS |
| Theme support | Light/dark variants exist |

2. Component build validation:

| Check | Pass Criteria |
|-------|---------------|
| File existence | At least 3 files per component (component, style, index) |
| No hardcoded values | No `#xxx` or `rgb()` in component CSS (only in tokens.css) |
| focus_visible_used | Uses `:focus-visible` not bare `:focus` |
| Responsive | `@media` queries present |
| Anti-pattern clean | No violations of design intelligence anti_patterns |
| no_layout_animations | No width/height/margin/padding animations (transform+opacity only) |
| reduced_motion_present | `@media (prefers-reduced-motion: reduce)` exists in stylesheets |
| touch_targets | Interactive elements >= 44x44px (min-width/min-height or padding) |

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `implementer` namespace:
   - Read existing -> merge `{ "implementer": { build_type, file_count, output_dir, components_built } }` -> write back
