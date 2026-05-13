---
name: maestro-ui-design
description: Generate UI design prototypes, select and solidify as code
argument-hint: "<phase|topic> [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y] [--style-skill PKG]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, request_user_input
---

<purpose>
Two workflow paths, auto-selected by skill availability:
1. **Primary (ui-ux-pro-max)**: Lightweight -- delegates design generation, owns selection and solidification
2. **Fallback (self-contained)**: Full 4-layer pipeline (style -> animation -> layout -> assembly)

Both produce the same output contract for downstream plan/execute consumption.
</purpose>

<deferred_reading>
- [ui-style.md](~/.maestro/workflows/ui-style.md) — read when SKILL_PATH found (primary path)
- [ui-design.md](~/.maestro/workflows/ui-design.md) — read when SKILL_PATH empty or --full (fallback path)
- [index.json](~/.maestro/templates/index.json) — read when updating phase metadata
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
</deferred_reading>

<context>
$ARGUMENTS -- phase number or topic text, plus optional flags.

**Usage**:

```bash
$maestro-ui-design "3"                          # phase mode
$maestro-ui-design "landing page for SaaS"      # scratch mode
$maestro-ui-design -y "3 --styles 5"            # auto mode, 5 variants
$maestro-ui-design "3 --style-skill PKG --stack react"
```

**Flags**:
- `[topic]`: Phase number or topic text (scratch mode)
- `-y, --yes`: Auto mode -- skip all interactive selection
- `--style-skill PKG`: Override ui-ux-pro-max skill path
- `--styles N`: Number of style variants (default: 3, range: 2-5)
- `--stack <stack>`: Tech stack for implementation guidelines (default: html-tailwind)
- `--targets <pages>`: Comma-separated page/component targets
- `--layouts N`: Number of layout templates per target (default: 2, range: 1-4, fallback path only)
- `--refine`: Iterate on existing design-ref/ — load current tokens, present refinement options
- `--persist`: Save design system with hierarchical page overrides
- `--full`: Force full 4-layer self-contained pipeline

When `--yes` or `-y`: Skip interactive selection, auto-pick top-scored variant, skip brief review.

**Output**: `{scratch_dir}/design-ref/` with MASTER.md, design-tokens.json, animation-tokens.json, selection.json, prototypes/
</context>

<invariants>
1. **Output contract is fixed** -- both paths produce MASTER.md + design-tokens.json + animation-tokens.json + selection.json
2. **Colors in OKLCH** format in design-tokens.json
3. **WCAG AA** contrast: 4.5:1 text, 3:1 UI elements
4. **No lorem ipsum** -- use contextual placeholder content
5. **Agent calls use `run_in_background: false`** for synchronous execution
6. **Variant contrast** -- each variant must represent a distinctly different design direction
</invariants>

<execution>

### Step 0: Load UI Specs

Load project UI conventions before generating designs:

```bash
maestro spec load --category ui
```

If specs not initialized, continue without — the workflow still produces valid output.

### Step 1: Parse Input and Resolve Target

1. Parse flags from `$ARGUMENTS`: `--styles N`, `--stack`, `--targets`, `--persist`, `--full`, `-y`
2. **Phase mode** (number): resolve via state.json artifact registry to `.workflow/scratch/{YYYYMMDD}-{type}-{slug}/`
3. **Scratch mode** (text): create `.workflow/scratch/ui-design-{slug}-{date}/` with minimal index.json
4. Create output directories: `${PHASE_DIR}/design-ref/prototypes/` and `${PHASE_DIR}/design-ref/layout-templates/`

### Step 2: Detect Skill Availability

Search for `ui-ux-pro-max` script at `skills/ui-ux-pro-max/scripts/search.py` or `$HOME/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/*/scripts/search.py`.

- If `--style-skill PKG` provided: override detected path
- If `--full`: force self-contained pipeline regardless of skill availability

### Step 2.5: Refine Mode Branch (if `--refine`)

If `--refine` is set:
1. Verify `design-ref/` exists in target directory (error E004 if missing)
2. Read current `design-ref/MASTER.md`, `design-tokens.json`, `animation-tokens.json`
3. Display current design summary (palette, typography, key components)
4. `request_user_input`:
   ```json
   { "questions": [{ "id": "refine_scope", "header": "Refine", "question": "Which aspects to refine?", "options": [
     { "label": "Colors & Typography (Recommended)", "description": "Adjust palette, font pairings, and scale." },
     { "label": "Layout & Spacing", "description": "Adjust grid, spacing tokens, and breakpoints." },
     { "label": "Full Redesign", "description": "Regenerate all variants from scratch, keeping requirements." }
   ]}] }
   ```
5. Apply refinement: directly edit token files and MASTER.md based on user feedback
6. Update `selection.json` with refinement metadata (iteration count, changes)
7. Skip to Step 8 (report)

### Step 3: Gather Requirements Context

1. Read phase context (context.md, brainstorm results, spec references)
2. Synthesize design brief: product_type, industry, style_keywords, audience
3. Infer targets from phase goal if not specified (fallback: "home")
4. **Interactive brief review** (skip if `-y`):
   - Present synthesized brief (product_type, industry, style_keywords, audience, targets)
   - `request_user_input`:
     ```json
     { "questions": [{ "id": "brief_review", "header": "Brief", "question": "Design brief ready. Proceed with this direction?", "options": [
       { "label": "Proceed (Recommended)", "description": "Generate variants with current brief." },
       { "label": "Adjust", "description": "Modify keywords, audience, or targets before generating." }
     ]}] }
     ```
   - **Adjust** → user provides changes, update brief, then proceed

### Step 4: Generate Style Variants

**If SKILL_PATH found (primary path):**

Generate `styleCount` keyword sets with intentional contrast, then call ui-ux-pro-max for each:
```bash
python3 "${SKILL_PATH}" "${variant_keywords}" --design-system -p "${project_name}" -f markdown
```

**If SKILL_PATH empty or --full (fallback path):**

Spawn ui-design-agent to generate variants using 6D attribute space for maximum contrast:

| Dimension | Range | Description |
|-----------|-------|-------------|
| mood | formal ↔ playful | Overall emotional tone |
| density | spacious ↔ dense | Content density and whitespace |
| contrast | subtle ↔ bold | Visual weight and contrast ratios |
| rounding | sharp ↔ rounded | Border radius scale (0-24px) |
| motion | minimal ↔ expressive | Animation intensity and frequency |
| color-temp | cool ↔ warm | Color temperature bias |

Each variant occupies a distinct region in 6D space — no two variants within 0.3 Euclidean distance.

### Step 5: Present and Select

Present all variants with key attributes (colors, typography, effects, 6D coordinates for fallback path).

**Interactive** (default): `request_user_input` with variants as options:
```json
{ "questions": [{ "id": "variant_select", "header": "Style", "question": "Select preferred design variant:", "options": [
  { "label": "Variant 1 (Recommended)", "description": "Brief: palette + mood + key trait." },
  { "label": "Variant 2", "description": "Brief: palette + mood + key trait." },
  { "label": "Variant 3", "description": "Brief: palette + mood + key trait." }
]}] }
```
Options built dynamically from generated variants. User may respond with "Other" to request regeneration with different keywords.

**Auto** (`-y`): select variant 1

### Step 6: Solidify Selected Design

Spawn Agent to extract structured tokens from selected variant: `design-tokens.json` (OKLCH colors, component_styles, typography.combinations, spacing, border_radius, shadows, breakpoints) and `animation-tokens.json` (duration, easing, transitions, keyframes, interactions, reduced_motion).

Write output artifacts:
- `design-ref/MASTER.md` -- complete design system specification
- `design-ref/design-tokens.json` -- production-ready tokens
- `design-ref/animation-tokens.json` -- animation system
- `design-ref/selection.json` -- selection metadata + rationale

### Step 6.5: Layout Template Generation (fallback path only)

For each target, generate `layoutCount` layout templates:
- Each template defines `dom_structure` (semantic HTML skeleton) + `css_layout_rules` (grid/flex layout)
- Write to `design-ref/layout-templates/{target}-layout-{N}.json`
- Templates vary in content organization: e.g., hero-first vs. feature-grid vs. sidebar-nav

### Step 7: Prototype Generation

**Primary path**: For each target, spawn Agent to generate standalone HTML+CSS prototype from design-tokens.json and animation-tokens.json.

**Fallback path**: Assemble prototype matrix: `styles × layouts × targets`. For each combination:
- Merge selected style tokens + layout template + target content
- Generate standalone HTML+CSS prototype

Requirements (both paths): realistic content (no lorem ipsum), SVG icons via CDN, responsive at 375/768/1024px, WCAG AA contrast.

**Fallback path only**: Generate `design-ref/compare.html` — interactive matrix viewer showing all prototypes side-by-side with style/layout/target filtering.

### Step 8: Update State and Report

1. Update index.json with `design_ref` status
2. Display completion report: phase, variant count + selected, stack, targets, artifact paths
3. **Next-Step Routing** (skip if `-y` — default to Plan):
   - `request_user_input`:
     ```json
     { "questions": [{ "id": "next_step", "header": "Next Step", "question": "Design system complete. What next?", "options": [
       { "label": "Plan (Recommended)", "description": "Create execution plan with design reference." },
       { "label": "Refine", "description": "Iterate on selected design with adjustments." },
       { "label": "Analyze", "description": "Evaluate feasibility before planning." }
     ]}] }
     ```
     - **Plan** → invoke `maestro-plan {phase}`
     - **Refine** → invoke `maestro-ui-design {phase} --refine`
     - **Analyze** → invoke `maestro-analyze {phase}`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or topic argument required | Prompt user |
| E002 | error | Phase directory not found | Check phase number |
| E003 | error | Python not available for ui-ux-pro-max | Fall back to self-contained pipeline |
| E004 | error | --refine requires existing design-ref/ | Run without --refine first |
| W001 | warning | Design system returned partial results | Retry with broader keywords |
| W002 | warning | Prototype rendering failed for one variant | Continue with remaining |
| W003 | warning | No context.md found, using phase goal only | Continue with phase goal |
| W004 | warning | ui-ux-pro-max not found, using fallback | Proceed with self-contained pipeline |
</error_codes>

<success_criteria>
**Common (both paths)**:
- [ ] Target resolved (phase or scratch directory)
- [ ] Requirements context gathered (context.md, brainstorm, or user input)
- [ ] Style variants generated with intentional contrast
- [ ] User selected variant (or auto-picked in `-y` mode)
- [ ] MASTER.md + design-tokens.json + animation-tokens.json + selection.json written
- [ ] Colors in OKLCH format, WCAG AA contrast met (4.5:1 text, 3:1 UI)
- [ ] Prototypes generated for all targets with realistic content (no lorem ipsum)
- [ ] index.json updated with design_ref status
- [ ] Next-step routing presented (or auto-defaulted with `-y`)

**Primary path (ui-ux-pro-max)**:
- [ ] ui-ux-pro-max `--design-system` called with product/industry/style keywords
- [ ] Tokens extracted from ui-ux-pro-max output into structured JSON

**Fallback path (--full or no skill)**:
- [ ] 6D attribute space used with ≥0.3 Euclidean distance between variants
- [ ] Layout templates generated per target (`dom_structure` + `css_layout_rules`)
- [ ] Prototype matrix assembled: selected style × layouts × targets
- [ ] `compare.html` generated as interactive matrix viewer
</success_criteria>
