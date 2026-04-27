# UI Design Workflow

4-layer extraction pipeline (style → animation → layout → assembly) producing design prototypes.
Powered by ui-ux-pro-max (design system recommendations) and ui-design-agent (token generation + assembly).
User reviews via compare.html, selects winner(s), design solidified as code reference for plan/execute.

Pipeline position: analyze -> **ui-design** -> plan -> execute -> verify

> **Note:** This is the full self-contained pipeline. When ui-ux-pro-max skill is available,
> the command routes to `ui-style.md` instead (lightweight delegation).
> This workflow runs when the skill is absent or `--full` is explicitly requested.

---

## Prerequisites

- `.workflow/` directory initialized (or auto-bootstrap)
- Python 3 available (required by ui-ux-pro-max skill)
- ui-ux-pro-max skill installed (search.py available)

---

## Scope Resolution

```
Input: <phase> (number) OR topic text
Output: .workflow/scratch/ui-design-{slug}-{date}/

Resolve scope:
  number → phase slug from roadmap.md, scope="phase", register with phase
  text   → slugify(topic), scope="adhoc"|"standalone" (based on current_milestone)

mkdir -p ${OUTPUT_DIR}
```

---

## Flag Processing

| Flag | Default | Effect |
|------|---------|--------|
| `--styles N` | 3 | Number of style variants (2-5) |
| `--layouts N` | 2 | Layout variants per target (1-3) |
| `--stack <stack>` | html-tailwind | Tech stack for guidelines |
| `--targets <pages>` | (inferred) | Comma-separated page/component targets |
| `--refine` | false | Refinement mode: fine-tune existing design-ref |
| `--persist` | false | Save MASTER.md + page overrides |
| `-y` | false | Auto mode: skip interactive selection |

---

### Step 1: Parse Arguments & Validate Environment

**1a. Parse flags:**
Extract from $ARGUMENTS per flag table above (styleCount clamped 2-5, layoutCount clamped 1-3, defaults applied).

**1b. Validate Python & locate ui-ux-pro-max:**
Require Python 3. Locate `search.py` in: `skills/ui-ux-pro-max/scripts/search.py` or `$HOME/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/*/scripts/search.py`. If not found: **Error E003**.

**1c. Refinement mode validation:**
If `--refine` but `${PHASE_DIR}/design-ref/design-tokens.json` missing: **Error E004**.

**1d. Create output directories:**
```bash
mkdir -p "${PHASE_DIR}/design-ref/prototypes"
mkdir -p "${PHASE_DIR}/design-ref/layout-templates"
mkdir -p "${PHASE_DIR}/design-ref/.intermediates/style-analysis"
mkdir -p "${PHASE_DIR}/design-ref/.intermediates/layout-analysis"
mkdir -p "${PHASE_DIR}/design-ref/variants"
```

**1e. Display banner:**
Show: phase/topic, mode (explore|refine), styleCount, layoutCount, stack, targets, auto flag.

---

### Step 2: Gather Requirements Context

**Purpose:** Collect design-relevant context from existing artifacts.

Gather from available sources:
- **2a.** `${PHASE_DIR}/context.md` -- product type, industry, audience, design preferences, locked UI decisions
- **2b.** `${PHASE_DIR}/brainstorm/` -- ui-designer/analysis.md, product-manager/analysis.md (visual keywords, personas)
- **2c.** `spec-summary.md` + `requirements/_index.md` (if index.json.spec_ref) -- UI-relevant requirements & acceptance criteria
- **2d.** `.workflow/codebase/doc-index.json` -- existing design tokens, CSS frameworks, component libraries, brand colors

**2e. Synthesize design brief:**
```json
DESIGN_BRIEF = {
  "product_type": "SaaS dashboard | e-commerce | landing page | ...",
  "industry": "fintech | healthcare | beauty | ...",
  "style_keywords": "modern minimalist professional | bold geometric | ...",
  "audience": "enterprise users | young consumers | ...",
  "constraints": { "brand_colors": [], "existing_components": [], "accessibility": "WCAG AA" },
  "stack": "{resolved stack}"
}
```

**2f. Infer targets** (if not specified):
Extract page names from phase goal / brainstorm / spec epics. Fallback: `["home"]`.

**2g. Interactive refinement** (skip if -y):
Present DESIGN_BRIEF summary, allow user adjustments before proceeding.

---

### Step 3: Generate Style Variants (Layer 1 — Style)

**Purpose:** Generate maximally contrasting design systems via ui-ux-pro-max + ui-design-agent.

#### 3a. Get primary design recommendations from ui-ux-pro-max

```bash
# Primary design system + stack guidelines
python3 "${SKILL_PATH}" "${product_type} ${industry} ${style_keywords}" --design-system -p "${project_name}" -f markdown
python3 "${SKILL_PATH}" "layout responsive form component" --stack ${stack}

# Supplementary domain data (parallel): color, typography, ux
python3 "${SKILL_PATH}" "${industry} ${product_type}" --domain color
python3 "${SKILL_PATH}" "${style_keywords}" --domain typography
python3 "${SKILL_PATH}" "accessibility animation interaction" --domain ux
```

#### 3b. Generate design direction options via ui-design-agent

```
Agent(ui-design-agent): [DESIGN_DIRECTION_GENERATION]

Generate ${styleCount} maximally contrasting design directions (min 6D distance: 0.7).

Input: DESIGN_BRIEF, ui-ux-pro-max recommendations, color/typography data.
If refine mode: also read existing design-tokens.json.

6D Attribute Space (each 0.0-1.0):
  color_saturation | visual_weight | formality | organic_geometric | innovation | density

Per direction generate:
  Core: philosophy_name, 6D scores, search_keywords, anti_keywords, rationale
  Preview: colors (OKLCH), fonts (Google Fonts), border_radius_base, mood_description

Output: ${PHASE_DIR}/design-ref/.intermediates/style-analysis/analysis-options.json
Schema: { "mode": "explore|refine", "design_directions": [...], "attribute_space_coverage": {...} }
```

#### 3c. Interactive style selection (skip if -y)

Present directions with 6D visualization (colors, fonts, attribute scores, mood). Multi-select supported.
Update `analysis-options.json` with `user_selection` field.

#### 3d. Generate design-tokens.json for selected variant(s) (parallel)

For each selected direction, spawn ui-design-agent:

```
Agent(ui-design-agent): [DESIGN_SYSTEM_GENERATION #${variant_index}]

Generate production-ready design tokens from selected direction.
Map 6D attributes to token values:
  color_saturation→chroma | visual_weight→weights/shadows | formality→serif choice/radius
  organic_geometric→shapes | innovation→experimental values | density→spacing compression

Output: ${PHASE_DIR}/design-ref/variants/style-${variant_index}/design-tokens.json

Required schema:
{
  "colors": {
    "brand":    { "primary|secondary|accent": "oklch(...)" },
    "surface":  { "background|elevated|card|overlay": "oklch(...)" },
    "semantic": { "success|warning|error|info": "oklch(...)" },
    "text":     { "primary|secondary|tertiary|inverse": "oklch(...)" },
    "border":   { "default|strong|subtle": "oklch(...)" }
  },
  "typography": {
    "font_family": { "heading|body|mono": "..." },
    "font_size":   { "xs..5xl": "rem scale" },
    "font_weight": { "normal(400)|medium(500)|semibold(600)|bold(700)" },
    "line_height": { "tight(1.25)|normal(1.5)|relaxed(1.75)" },
    "letter_spacing": { "tight(-0.025em)|normal(0)|wide(0.025em)|wider(0.05em)" },
    "combinations": { "heading-primary|heading-secondary|body-regular|body-emphasis|caption|label": "{family,size,weight,line_height,letter_spacing}" }
  },
  "spacing":       { "0..24": "rem scale (0.25rem increments)" },
  "opacity":       { "0..100": "0.0-1.0 scale" },
  "border_radius": { "none|sm|md|lg|xl|2xl|full": "0-9999px" },
  "shadows":       { "sm|md|lg|xl": "oklch shadow values" },
  "component_styles": {
    "button": { "primary|secondary|tertiary": "{bg, color, padding, radius, weight}" },
    "card":   { "default|interactive": "{bg, padding, radius, shadow}" },
    "input":  { "default|focus|error": "{border, padding, radius}" }
  },
  "breakpoints": { "sm(640)|md(768)|lg(1024)|xl(1280)|2xl(1536)": "px" }
}

Requirements: ALL colors OKLCH, WCAG AA (4.5:1 text, 3:1 UI), complete combinations + component_styles with var() refs, full opacity scale.
```

---

### Step 4: Generate Animation Tokens (Layer 2 — Animation)

**Purpose:** Generate animation system complementing the selected styles.

```
Agent(ui-design-agent): [ANIMATION_SYSTEM_GENERATION]

Input: selected variant's design-tokens.json (mood/weight context) + ui-ux-pro-max UX data.
Output: ${PHASE_DIR}/design-ref/animation-tokens.json

Schema:
{
  "duration":       { "instant(0ms)|fast(100ms)|normal(200ms)|slow(300ms)|slower(500ms)|slowest(1000ms)" },
  "easing":         { "linear|ease-out|ease-in|ease-in-out|spring": "cubic-bezier values" },
  "transitions":    { "color|transform|opacity|shadow|all": "property + duration + easing var() refs" },
  "keyframes":      { "fadeIn|slideUp|scaleIn": "from/to with transform + opacity" },
  "interactions":   { "button-hover|card-hover|link-hover": "transform + shadow + transition var() refs" },
  "reduced_motion": { "strategy": "remove-motion-keep-opacity", "media_query": "@media (prefers-reduced-motion: reduce)" }
}

Requirements: CSS custom properties, prefers-reduced-motion mandatory, var() refs for interactions, 100-300ms micro / up to 1000ms page transitions.
```

---

### Step 5: Generate Layout Templates (Layer 3 — Layout)

**Purpose:** Generate structural layout templates per target, separate from visual style.

#### 5a. Generate layout concept options

```
Agent(ui-design-agent): [LAYOUT_CONCEPT_GENERATION]

Generate ${layoutCount} structurally distinct layout concepts per target.
Concepts must differ in: grid structure, component arrangement, visual hierarchy, navigation pattern.

Per Target x Concept: concept_name, design_philosophy, layout_pattern (grid-3col|flex-row|single-column|asymmetric-grid),
key_components, structural_features, ascii_art wireframe.

Output: ${PHASE_DIR}/design-ref/.intermediates/layout-analysis/analysis-options.json
Schema: { "layout_concepts": { "${target}": [concepts] }, "device_type": "responsive" }
```

#### 5b. Interactive layout selection (skip if -y)

Present layout concepts per target with ASCII wireframes. Multi-select supported.
Update analysis-options.json with `user_selection.selected_variants`.

#### 5c. Generate layout template files (parallel)

For each selected concept × target:

```
Agent(ui-design-agent): [LAYOUT_TEMPLATE_GENERATION -- ${target} variant ${variant_id}]

Structure ONLY, no visual style. Output: ${PHASE_DIR}/design-ref/layout-templates/layout-${target}-${variant_id}.json

Schema:
{
  "target": "${target}",
  "variant_id": "layout-${variant_id}",
  "device_type": "responsive",
  "design_philosophy": "...",
  "dom_structure": { "tag": "body", "children": [header>nav, div.layout-main-wrapper>[main+aside], footer] },
  "component_hierarchy": ["header", "main-content", "sidebar", "footer"],
  "css_layout_rules": "grid/flex rules using var(--spacing-*), var(--breakpoint-*)"
}

Rules: semantic HTML5, ARIA roles, var() refs only (no hard-coded values), mobile-first responsive. NO colors/fonts/shadows.
```

---

### Step 6: Assemble HTML Prototypes (Layer 4 — Assembly)

**Purpose:** Combine layout templates + design tokens + animation tokens into viewable HTML.

For each `style × layout × target` combination, spawn ui-design-agent:

```
Agent(ui-design-agent): [PROTOTYPE_ASSEMBLY -- ${target}-style-${s}-layout-${l}]

Pure assembly: combine pre-extracted structure + tokens. NO design decisions.

Inputs: layout-${target}-${l}.json + style-${s}/design-tokens.json + animation-tokens.json

Assembly:
  HTML: dom_structure -> <!DOCTYPE html>, Google Fonts CDN, realistic content (not lorem ipsum), ARIA preserved
  CSS:  css_layout_rules + resolved token values (colors, typography, shadows, radius) +
        component_styles + typography.combinations + animation keyframes/interactions + reduced-motion

Quality: SVG icons (not emojis), cursor-pointer on clickables, 150-300ms transitions,
  4.5:1 contrast, prefers-reduced-motion, responsive (375/768/1024/1440px)

Output: ${PHASE_DIR}/design-ref/prototypes/${target}-style-${s}-layout-${l}.{html,css}
```

**Agent grouping**: Max 6 concurrent agents. Each agent processes ONE style (may handle multiple layouts).

**Generate compare.html**: Interactive matrix viewer with:
- Style tabs × Layout tabs × Target tabs
- Each cell: iframe loading the corresponding HTML
- Side-by-side comparison mode

---

### Step 7: User Selection & Solidification

**Purpose:** Present variants, collect user choice, solidify as canonical reference.

#### 7a. Present overview

Present S x L x T matrix overview with compare.html link. Per style: name, colors, fonts, 6D scores.
Selection options: `1-N` (select), `mix` (merge), `redo` (regenerate), `all` (keep all).

#### 7b. Process selection

Auto mode (-y): select variant 1. Otherwise: `redo` -> Step 3, `mix` -> merge tokens, `all` -> keep all, number -> select that variant.

#### 7c. Solidify selected design

**Write MASTER.md:**
Sections: Selected Style (6D attributes), Color Palette (token table), Typography (fonts/scale/combinations),
Spacing & Layout, Effects & Interactions, Component Styles, Animation System, Anti-Patterns, Reference Prototypes.

**Copy canonical files:**
- `design-ref/design-tokens.json` ← selected variant's tokens
- `design-ref/animation-tokens.json` ← already at root
- `design-ref/layout-templates/` ← already populated

**Write selection.json:**
```json
{
  "selected_variant": 1,
  "variant_name": "Clean Minimalist",
  "selection_mode": "user_choice|auto|mix|all",
  "rationale": "...",
  "design_attributes": { "color_saturation": 0.3, "visual_weight": 0.2, "...": "..." },
  "alternatives_reviewed": 3,
  "selected_at": "ISO timestamp"
}
```

**Write page-specific overrides** (if --persist):
`design-ref/pages/{target}.md` per target page.

**Update index.json:**
```json
{
  "design_ref": {
    "status": "selected",
    "variant": "{variant_name}",
    "master": "design-ref/MASTER.md",
    "tokens": "design-ref/design-tokens.json",
    "animation": "design-ref/animation-tokens.json",
    "layouts": "design-ref/layout-templates/",
    "prototypes": "design-ref/prototypes/",
    "created_at": "ISO timestamp"
  }
}
```

---

## Integration with maestro-plan

`maestro-plan` P1 (Context Collection):
- If `${PHASE_DIR}/design-ref/MASTER.md` exists: load as planner context, add `design-tokens.json`, `layout-templates/layout-*.json`, `animation-tokens.json` to UI task `read_first[]`
- If missing + phase goal has UI keywords: suggest `maestro-ui-design` (non-blocking)

---

## Error Handling

| Error | Action |
|-------|--------|
| Python not found | Abort with install instructions per OS |
| ui-ux-pro-max not found | Abort, suggest skill installation |
| Design system returns empty | Retry with broader keywords, then abort |
| Prototype agent fails | Log error, continue with other variants |
| User cancels selection | Save all variants as-is, exit without MASTER.md |
| --refine without existing design-ref | Error E004 |

---

## State Updates

| When | Field | Value |
|------|-------|-------|
| Step 1 start | index.json.status | "designing" |
| Step 6 complete | index.json.design_ref.status | "variants_ready" |
| Step 7 complete | index.json.design_ref.status | "selected" |
| Step 7 complete | index.json.updated_at | Current timestamp |
