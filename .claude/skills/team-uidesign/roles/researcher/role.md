---
role: researcher
prefix: RESEARCH
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Design System Researcher

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Detect project type and tech stack from package.json or equivalent:

| Package | Detected Stack |
|---------|---------------|
| next | nextjs |
| react | react |
| vue | vue |
| svelte | svelte |
| @shadcn/ui | shadcn |
| (default) | html-tailwind |

3. Use CLI tools (e.g., `maestro delegate "..." --to agy --mode analysis`) or direct tools (Glob, Grep) to scan for existing design tokens, component files, styling patterns
4. Read industry context from session config (industry, strictness, must-have features)
5. **Context-First Protocol**: Before any design work, ensure these are known (extract from task description, or ask coordinator to clarify):
   - **Target audience**: Who uses it, in what context? (e.g., developers, end users, admins)
   - **Use cases**: What jobs are they doing? (e.g., data entry, monitoring, content creation)
   - **Brand personality**: How should it feel? (e.g., professional, playful, technical, luxurious)
   - If not provided in task description, flag as `context_missing` in output — designer cannot make good decisions without this

## Phase 3: Research Execution

Execute 4 analysis streams:

**Stream 1 -- Design System Analysis**:
- Search for existing design tokens (CSS variables, theme configs, token files)
- Identify styling patterns (CSS-in-JS, CSS modules, utility classes, SCSS)
- Map color palette, typography scale, spacing system
- Find component library usage (MUI, Ant Design, shadcn, custom)
- Check dark mode implementation quality: surface hierarchy, font weight adjustments, accent desaturation
- Check z-index patterns: arbitrary values vs semantic scale
- Output: `<session>/research/design-system-analysis.json`

**Stream 2 -- Component Inventory**:
- Find all UI component files; identify props/API surface
- Identify states supported (hover, focus, disabled, etc.)
- Check accessibility attributes (ARIA labels, roles)
- Map inter-component dependencies and usage counts
- Output: `<session>/research/component-inventory.json`

**Stream 3 -- Accessibility Baseline**:
- Check ARIA attribute usage patterns, keyboard navigation support
- Assess color contrast ratios (if design tokens found)
- Find focus management and semantic HTML patterns
- Output: `<session>/research/accessibility-audit.json`

**Stream 4 -- Design Intelligence (ui-ux-pro-max)**:
- Call `Skill(skill="ui-ux-pro-max", args="<industry> <keywords> --design-system")` for design system recommendations
- Call `Skill(skill="ui-ux-pro-max", args="accessibility animation responsive --domain ux")` for UX guidelines
- Call `Skill(skill="ui-ux-pro-max", args="<keywords> --stack <detected-stack>")` for stack guidelines
- Degradation: when unavailable, use LLM general knowledge, mark `_source: "llm-general-knowledge"`
- Output: `<session>/research/design-intelligence.json`

**Stream 5 -- Visual Quality Baseline**:
- Scan for AI slop tells (reference `specs/anti-patterns.md`): check for P1 items (AI color palette, gradient text, glassmorphism, all-buttons-primary, pure black/white)
- Check color system: OKLCH usage, pure black/white (`#000`/`#fff`), tinted neutrals (chroma 0.005-0.01), 60-30-10 distribution
- Check typography: font choices (flag Inter/Roboto/Open Sans/Lato/Montserrat/Arial), modular scale presence, fluid `clamp()` usage
- Check spacing: 4pt scale adherence, `gap` vs `margin` usage ratio, nested cards detection
- Check motion: easing values (flag `bounce`/`elastic`/`linear`/`ease`), `prefers-reduced-motion` query presence, `will-change` in CSS (should not be permanent)
- Check interaction states: count distinct states per interactive component (target: 8 per `specs/design-standards.md`)
- Check UX writing quality: generic button labels (OK/Submit/Cancel), error messages without fix guidance, empty states without actions
- Check dark mode: pure black backgrounds, non-desaturated accents, same font weights as light
- Output: `<session>/research/visual-quality-baseline.json`

Compile research summary metrics: design_system_exists, styling_approach, total_components, accessibility_level, design_intelligence_source, anti_patterns_count, visual_quality_score.

## Phase 4: Validation & Output

1. Verify all 5 output files exist and contain valid JSON with required fields:

| File | Required Fields |
|------|----------------|
| design-system-analysis.json | existing_tokens, styling_approach |
| component-inventory.json | components array |
| accessibility-audit.json | wcag_level |
| design-intelligence.json | _source, design_system |
| visual-quality-baseline.json | slop_tells, color_system, typography, spacing, motion, interaction_states |

2. If any file missing or invalid, re-run corresponding stream

3. Update `<session>/wisdom/.msg/meta.json` under `researcher` namespace:
   - Read existing -> merge `{ "researcher": { detected_stack, component_count, wcag_level, di_source, scope } }` -> write back
