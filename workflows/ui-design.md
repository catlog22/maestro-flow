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
Input: <phase> argument (number) OR topic text

All output goes to scratch: .workflow/scratch/ui-design-{slug}-{date}/

IF argument is a number:
  1. Resolve phase slug from roadmap.md
  2. OUTPUT_DIR = .workflow/scratch/ui-design-{phase-slug}-{date}
  3. scope = "phase", register artifact with phase number

ELSE (topic text):
  1. slug = slugify(topic)
  2. OUTPUT_DIR = .workflow/scratch/ui-design-{slug}-{date}
  3. scope = state.json.current_milestone ? "adhoc" : "standalone"

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
```javascript
const styleCount = clamp(parseInt($ARGUMENTS.match(/--styles\s+(\d+)/)?.[1]) || 3, 2, 5)
const layoutCount = clamp(parseInt($ARGUMENTS.match(/--layouts\s+(\d+)/)?.[1]) || 2, 1, 3)
const stack = $ARGUMENTS.match(/--stack\s+(\S+)/)?.[1] || 'html-tailwind'
const targets = $ARGUMENTS.match(/--targets\s+"?([^"]+)"?/)?.[1]?.split(',').map(s => s.trim()) || null
const refineMode = /--refine/.test($ARGUMENTS)
const persist = /--persist/.test($ARGUMENTS)
const autoMode = /\b(-y|--yes)\b/.test($ARGUMENTS)
```

**1b. Validate Python & locate ui-ux-pro-max:**
```bash
python3 --version || python --version

# Find search.py in known locations
SKILL_PATH=""
for path in \
  "skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/*/scripts/search.py"; do
  expanded=$(ls $path 2>/dev/null | tail -1)
  if [ -n "$expanded" ]; then SKILL_PATH="$expanded"; break; fi
done
[ -z "$SKILL_PATH" ] && SKILL_PATH=$(find "$HOME/.claude/plugins" -path "*/ui-ux-pro-max/*/scripts/search.py" -print -quit 2>/dev/null)
```
If not found: **Error E003**.

**1c. Refinement mode validation:**
```
IF refineMode AND NOT exists "${PHASE_DIR}/design-ref/design-tokens.json":
  Error E004: "--refine requires existing design-ref/"
```

**1d. Create output directories:**
```bash
mkdir -p "${PHASE_DIR}/design-ref/prototypes"
mkdir -p "${PHASE_DIR}/design-ref/layout-templates"
mkdir -p "${PHASE_DIR}/design-ref/.intermediates/style-analysis"
mkdir -p "${PHASE_DIR}/design-ref/.intermediates/layout-analysis"
mkdir -p "${PHASE_DIR}/design-ref/variants"
```

**1e. Display banner:**
```
============================================================
  MAESTRO UI DESIGN
============================================================
  Phase:   {phase_name or topic}
  Mode:    {explore | refine}
  Styles:  {styleCount} variants
  Layouts: {layoutCount} per target
  Stack:   {stack}
  Targets: {targets or "auto-detect"}
  Auto:    {yes | no}
```

---

### Step 2: Gather Requirements Context

**Purpose:** Collect design-relevant context from existing artifacts.

**2a. Load phase context** (if exists):
```
Read ${PHASE_DIR}/context.md
  Extract: product type, industry, audience, design preferences, Locked UI decisions
```

**2b. Load brainstorm results** (if exists):
```
IF exists ${PHASE_DIR}/brainstorm/:
  Scan for ui-designer/analysis.md, product-manager/analysis.md
  Extract: visual direction keywords, user persona descriptions, product type
```

**2c. Load spec reference** (if exists):
```
IF index.json.spec_ref exists:
  Read spec-summary.md -> extract UI-relevant requirements
  Read requirements/_index.md -> extract UI/UX acceptance criteria
```

**2d. Load existing codebase design patterns** (if available):
```
IF exists .workflow/codebase/doc-index.json:
  Scan for existing design tokens, CSS frameworks, component libraries
  Detect: existing stack (React/Vue/Tailwind), brand colors, component patterns
```

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
```
IF targets not provided:
  Extract page names from phase goal / brainstorm / spec epics
  FALLBACK -> targets = ["home"]
```

**2g. Interactive refinement** (skip if -y):
```
Present design brief to user, allow adjustments.
"Design Brief: Product={product_type}, Industry={industry}, Style={style_keywords}, Targets={targets}"
"Modify? (enter changes or 'ok')"
```

---

### Step 3: Generate Style Variants (Layer 1 — Style)

**Purpose:** Generate maximally contrasting design systems via ui-ux-pro-max + ui-design-agent.

#### 3a. Get primary design recommendations from ui-ux-pro-max

```bash
# Primary design system
python3 "${SKILL_PATH}" "${product_type} ${industry} ${style_keywords}" --design-system -p "${project_name}" -f markdown

# Stack-specific guidelines
python3 "${SKILL_PATH}" "layout responsive form component" --stack ${stack}

# Supplementary domain data (parallel)
python3 "${SKILL_PATH}" "${industry} ${product_type}" --domain color
python3 "${SKILL_PATH}" "${style_keywords}" --domain typography
python3 "${SKILL_PATH}" "accessibility animation interaction" --domain ux
```

#### 3b. Generate design direction options via ui-design-agent

```javascript
Agent(ui-design-agent): `
  [DESIGN_DIRECTION_GENERATION]
  Generate ${styleCount} maximally contrasting design directions

  SESSION: ${session_id} | MODE: ${refineMode ? "refine" : "explore"} | BASE_PATH: ${PHASE_DIR}/design-ref

  ## Input
  - Design Brief: ${JSON.stringify(DESIGN_BRIEF)}
  - ui-ux-pro-max recommendations: ${primary_recommendations}
  - Color palette data: ${color_data}
  - Typography data: ${typography_data}
  ${refineMode ? "- Existing tokens: Read(${PHASE_DIR}/design-ref/design-tokens.json)" : ""}

  ## 6D Design Attribute Space Analysis
  Analyze along 6 dimensions (each scored 0.0-1.0):
  - color_saturation: muted ↔ vibrant
  - visual_weight: light/airy ↔ bold/heavy
  - formality: casual/playful ↔ corporate/formal
  - organic_geometric: organic curves ↔ geometric precision
  - innovation: conventional ↔ experimental
  - density: spacious ↔ compact

  ## Rules
  - Generate ${styleCount} directions with MAXIMUM contrast (min distance score: 0.7)
  - Each direction must be distinctly different in 6D space

  ## Generate for EACH Direction
  1. **Core Philosophy**:
     - philosophy_name (2-3 words, e.g., "Minimalist & Airy")
     - design_attributes (6D scores)
     - search_keywords (3-5 keywords)
     - anti_keywords (2-3 keywords to avoid)
     - rationale (why this is distinct)

  2. **Visual Preview**:
     - primary_color, secondary_color, accent_color (OKLCH format)
     - font_family_heading, font_family_body (specific Google Fonts)
     - border_radius_base (e.g., "0.5rem")
     - mood_description (1-2 sentences)

  ## Output
  Write: ${PHASE_DIR}/design-ref/.intermediates/style-analysis/analysis-options.json
  Schema: { "mode": "explore|refine", "design_directions": [...], "attribute_space_coverage": {...} }
`
```

#### 3c. Interactive style selection (skip if -y)

```
Present direction options with 6D attribute visualization:

  Option 1: "Clean Minimalist"
  Colors: oklch(0.7 0.15 250) / oklch(0.8 0.10 150) / oklch(0.65 0.20 30)
  Typography: Inter (headings) + Source Sans 3 (body)
  Attributes: saturation=0.3 weight=0.2 formality=0.7 geometric=0.8 innovation=0.3 density=0.3
  Mood: Professional clarity with ample whitespace
  ...

Select direction(s): [multi-select supported]
```

Update `analysis-options.json` with `user_selection` field.

#### 3d. Generate design-tokens.json for selected variant(s) (parallel)

For each selected direction, spawn ui-design-agent:

```javascript
Agent(ui-design-agent): `
  [DESIGN_SYSTEM_GENERATION #${variant_index}]
  Generate production-ready design tokens from selected direction

  VARIANT: ${variant_index} | DIRECTION: ${selected_direction.philosophy_name}
  BASE_PATH: ${PHASE_DIR}/design-ref

  ## Design Direction
  - Philosophy: ${selected_direction.philosophy_name}
  - Attributes: ${JSON.stringify(selected_direction.design_attributes)}
  - Keywords: ${selected_direction.search_keywords}
  - Anti-keywords: ${selected_direction.anti_keywords}
  - Preview Colors: ${selected_direction.preview}

  ## Apply 6D Attributes to Tokens
  - color_saturation → OKLCH chroma values
  - visual_weight → font weights, shadow depths, border widths
  - formality → serif vs sans-serif, border radius, letter spacing
  - organic_geometric → border radius (round vs sharp), shape patterns
  - innovation → token naming, experimental values, unconventional choices
  - density → spacing scale compression/expansion

  ## Generate design-tokens.json
  Write: ${PHASE_DIR}/design-ref/variants/style-${variant_index}/design-tokens.json

  Required schema:
  {
    "colors": {
      "brand": { "primary": "oklch(...)", "secondary": "oklch(...)", "accent": "oklch(...)" },
      "surface": { "background": "oklch(...)", "elevated": "oklch(...)", "card": "oklch(...)", "overlay": "oklch(...)" },
      "semantic": { "success": "oklch(...)", "warning": "oklch(...)", "error": "oklch(...)", "info": "oklch(...)" },
      "text": { "primary": "oklch(...)", "secondary": "oklch(...)", "tertiary": "oklch(...)", "inverse": "oklch(...)" },
      "border": { "default": "oklch(...)", "strong": "oklch(...)", "subtle": "oklch(...)" }
    },
    "typography": {
      "font_family": { "heading": "...", "body": "...", "mono": "..." },
      "font_size": { "xs": "0.75rem", "sm": "0.875rem", "base": "1rem", "lg": "1.125rem", "xl": "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem", "5xl": "3rem" },
      "font_weight": { "normal": "400", "medium": "500", "semibold": "600", "bold": "700" },
      "line_height": { "tight": "1.25", "normal": "1.5", "relaxed": "1.75" },
      "letter_spacing": { "tight": "-0.025em", "normal": "0", "wide": "0.025em", "wider": "0.05em" },
      "combinations": {
        "heading-primary": { "family": "var(--font-family-heading)", "size": "var(--font-size-3xl)", "weight": "var(--font-weight-bold)", "line_height": "var(--line-height-tight)", "letter_spacing": "var(--letter-spacing-tight)" },
        "heading-secondary": { "..." },
        "body-regular": { "..." },
        "body-emphasis": { "..." },
        "caption": { "..." },
        "label": { "..." }
      }
    },
    "spacing": { "0": "0", "1": "0.25rem", "2": "0.5rem", "3": "0.75rem", "4": "1rem", "5": "1.25rem", "6": "1.5rem", "8": "2rem", "10": "2.5rem", "12": "3rem", "16": "4rem", "20": "5rem", "24": "6rem" },
    "opacity": { "0": "0", "10": "0.1", "20": "0.2", "40": "0.4", "60": "0.6", "80": "0.8", "90": "0.9", "100": "1" },
    "border_radius": { "none": "0", "sm": "0.25rem", "md": "0.5rem", "lg": "1rem", "xl": "1.5rem", "2xl": "2rem", "full": "9999px" },
    "shadows": { "sm": "0 1px 2px oklch(0 0 0 / 0.05)", "md": "0 4px 6px oklch(0 0 0 / 0.1)", "lg": "0 10px 15px oklch(0 0 0 / 0.1)", "xl": "0 20px 25px oklch(0 0 0 / 0.1)" },
    "component_styles": {
      "button": {
        "primary": { "background": "var(--color-brand-primary)", "color": "var(--color-text-inverse)", "padding": "var(--spacing-3) var(--spacing-6)", "border_radius": "var(--border-radius-md)", "font_weight": "var(--font-weight-semibold)" },
        "secondary": { "..." },
        "tertiary": { "..." }
      },
      "card": {
        "default": { "background": "var(--color-surface-elevated)", "padding": "var(--spacing-6)", "border_radius": "var(--border-radius-lg)", "shadow": "var(--shadow-md)" },
        "interactive": { "..." }
      },
      "input": {
        "default": { "border": "1px solid var(--color-border-default)", "padding": "var(--spacing-3)", "border_radius": "var(--border-radius-md)" },
        "focus": { "..." },
        "error": { "..." }
      }
    },
    "breakpoints": { "sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px", "2xl": "1536px" }
  }

  ## Critical Requirements
  - ✅ ALL colors in OKLCH format
  - ✅ WCAG AA compliance: 4.5:1 text contrast, 3:1 UI contrast
  - ✅ Complete typography.combinations with var() references
  - ✅ Complete component_styles with var() references
  - ✅ Full opacity scale
`
```

---

### Step 4: Generate Animation Tokens (Layer 2 — Animation)

**Purpose:** Generate animation system complementing the selected styles.

```javascript
Agent(ui-design-agent): `
  [ANIMATION_SYSTEM_GENERATION]
  Generate production-ready animation tokens

  BASE_PATH: ${PHASE_DIR}/design-ref
  DESIGN_BRIEF: ${JSON.stringify(DESIGN_BRIEF)}
  UX_GUIDELINES: ${ux_data}

  ## Input
  - Style direction: Read selected variant's design-tokens.json for mood/weight context
  - UX best practices from ui-ux-pro-max

  ## Generate animation-tokens.json
  Write: ${PHASE_DIR}/design-ref/animation-tokens.json

  Schema:
  {
    "duration": {
      "instant": "0ms", "fast": "100ms", "normal": "200ms",
      "slow": "300ms", "slower": "500ms", "slowest": "1000ms"
    },
    "easing": {
      "linear": "linear",
      "ease-out": "cubic-bezier(0.0, 0, 0.2, 1)",
      "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
      "ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
      "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)"
    },
    "transitions": {
      "color": "color var(--duration-normal) var(--easing-ease-out)",
      "transform": "transform var(--duration-normal) var(--easing-ease-out)",
      "opacity": "opacity var(--duration-fast) var(--easing-ease-out)",
      "shadow": "box-shadow var(--duration-normal) var(--easing-ease-out)",
      "all": "all var(--duration-normal) var(--easing-ease-out)"
    },
    "keyframes": {
      "fadeIn": { "from": { "opacity": "0" }, "to": { "opacity": "1" } },
      "slideUp": { "from": { "transform": "translateY(10px)", "opacity": "0" }, "to": { "transform": "translateY(0)", "opacity": "1" } },
      "scaleIn": { "from": { "transform": "scale(0.95)", "opacity": "0" }, "to": { "transform": "scale(1)", "opacity": "1" } }
    },
    "interactions": {
      "button-hover": { "transform": "translateY(-1px)", "shadow": "var(--shadow-lg)", "transition": "var(--transition-transform), var(--transition-shadow)" },
      "card-hover": { "transform": "translateY(-2px)", "shadow": "var(--shadow-xl)", "transition": "var(--transition-transform), var(--transition-shadow)" },
      "link-hover": { "opacity": "0.8", "transition": "var(--transition-opacity)" }
    },
    "reduced_motion": {
      "strategy": "remove-motion-keep-opacity",
      "media_query": "@media (prefers-reduced-motion: reduce)"
    }
  }

  ## Rules
  - ✅ All durations use CSS custom properties pattern
  - ✅ prefers-reduced-motion support mandatory
  - ✅ Interaction patterns use var() references to duration/easing
  - ✅ Duration range: 100-300ms for micro-interactions, up to 1000ms for page transitions
`
```

---

### Step 5: Generate Layout Templates (Layer 3 — Layout)

**Purpose:** Generate structural layout templates per target, separate from visual style.

#### 5a. Generate layout concept options

```javascript
Agent(ui-design-agent): `
  [LAYOUT_CONCEPT_GENERATION]
  Generate ${layoutCount} structurally distinct layout concepts per target

  TARGETS: ${targets.join(", ")} | DEVICE: responsive
  BASE_PATH: ${PHASE_DIR}/design-ref

  ## Input
  - Design Brief: ${JSON.stringify(DESIGN_BRIEF)}
  - Targets: ${targets}

  ## Rules
  - For EACH target, generate ${layoutCount} structurally DIFFERENT layout concepts
  - Concepts must differ in: grid structure, component arrangement, visual hierarchy, navigation pattern
  - Each concept includes ASCII wireframe preview

  ## Generate for EACH Target × Concept
  1. concept_name (e.g., "Classic Three-Column Holy Grail")
  2. design_philosophy (1-2 sentences)
  3. layout_pattern ("grid-3col" | "flex-row" | "single-column" | "asymmetric-grid")
  4. key_components (array of main layout regions)
  5. structural_features (distinguishing characteristics)
  6. ascii_art (simple wireframe diagram):
     ┌─────────────────┐
     │     HEADER      │
     ├──┬─────────┬────┤
     │ L│  MAIN   │ R  │
     └──┴─────────┴────┘

  ## Output
  Write: ${PHASE_DIR}/design-ref/.intermediates/layout-analysis/analysis-options.json
  Schema: { "layout_concepts": { "${target}": [array of concepts] }, "device_type": "responsive" }
`
```

#### 5b. Interactive layout selection (skip if -y)

Present layout concepts per target with ASCII wireframes. Multi-select supported.
Update analysis-options.json with `user_selection.selected_variants`.

#### 5c. Generate layout template files (parallel)

For each selected concept × target:

```javascript
Agent(ui-design-agent): `
  [LAYOUT_TEMPLATE_GENERATION — ${target} variant ${variant_id}]
  Generate detailed layout template. Structure ONLY, no visual style.

  TARGET: ${target} | VARIANT: ${variant_id} | DEVICE: responsive
  CONCEPT: ${concept.concept_name} — ${concept.design_philosophy}

  ## Generate
  Write: ${PHASE_DIR}/design-ref/layout-templates/layout-${target}-${variant_id}.json

  Schema:
  {
    "target": "${target}",
    "variant_id": "layout-${variant_id}",
    "device_type": "responsive",
    "design_philosophy": "${concept.design_philosophy}",
    "dom_structure": {
      "tag": "body",
      "children": [
        { "tag": "header", "attributes": {"class": "layout-header"}, "children": [{"tag": "nav"}] },
        { "tag": "div", "attributes": {"class": "layout-main-wrapper"}, "children": [
          {"tag": "main", "attributes": {"class": "layout-main-content"}},
          {"tag": "aside", "attributes": {"class": "layout-sidebar"}}
        ]},
        { "tag": "footer", "attributes": {"class": "layout-footer"} }
      ]
    },
    "component_hierarchy": ["header", "main-content", "sidebar", "footer"],
    "css_layout_rules": ".layout-main-wrapper { display: grid; grid-template-columns: 1fr 3fr; gap: var(--spacing-6); } @media (max-width: var(--breakpoint-md)) { .layout-main-wrapper { grid-template-columns: 1fr; } }"
  }

  ## Rules
  - ✅ Semantic HTML5 tags (header, nav, main, aside, section, footer)
  - ✅ ARIA roles and accessibility attributes
  - ✅ CSS uses var(--spacing-*), var(--breakpoint-*) — NO hard-coded values
  - ✅ Mobile-first responsive (@media min-width breakpoints)
  - ❌ NO colors, fonts, shadows — structure only
`
```

---

### Step 6: Assemble HTML Prototypes (Layer 4 — Assembly)

**Purpose:** Combine layout templates + design tokens + animation tokens into viewable HTML.

For each `style × layout × target` combination, spawn ui-design-agent:

```javascript
Agent(ui-design-agent): `
  [PROTOTYPE_ASSEMBLY — ${target}-style-${s}-layout-${l}]
  Pure assembly: combine pre-extracted structure + tokens. NO design decisions.

  ## Inputs (READ ALL)
  1. Layout: Read("${PHASE_DIR}/design-ref/layout-templates/layout-${target}-${l}.json")
  2. Tokens: Read("${PHASE_DIR}/design-ref/variants/style-${s}/design-tokens.json")
  3. Animation: Read("${PHASE_DIR}/design-ref/animation-tokens.json")

  ## Assembly Rules
  1. Build HTML from layout template dom_structure
     - <!DOCTYPE html>, <head>, <meta viewport>, Google Fonts CDN
     - Realistic placeholder content (contextual to ${DESIGN_BRIEF.product_type}, NOT lorem ipsum)
     - ARIA attributes preserved from template

  2. Build CSS from layout template css_layout_rules + design tokens
     - Replace ALL var(--*) with actual token values
     - Add visual styling: colors, typography, shadows, border-radius from tokens
     - Add component_styles classes (button, card, input variants)
     - Add typography.combinations classes
     - Inject animation tokens: CSS custom properties, @keyframes, interaction classes
     - Include prefers-reduced-motion media query

  3. Quality checklist:
     - ✅ SVG icons (Heroicons/Lucide CDN), NOT emojis
     - ✅ cursor-pointer on clickable elements
     - ✅ Smooth transitions (150-300ms)
     - ✅ 4.5:1 minimum contrast ratio
     - ✅ prefers-reduced-motion respected
     - ✅ Responsive at 375px, 768px, 1024px, 1440px

  ## Output
  Write: ${PHASE_DIR}/design-ref/prototypes/${target}-style-${s}-layout-${l}.html
  Write: ${PHASE_DIR}/design-ref/prototypes/${target}-style-${s}-layout-${l}.css
`
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

```
============================================================
  DESIGN VARIANTS READY — Matrix: {S}×{L}×{T} = {total} prototypes
============================================================
  Preview: {PHASE_DIR}/design-ref/prototypes/compare.html

  Style 1: {name} — {description}
    Colors: {primary} / {accent}  |  Font: {heading} + {body}
    6D: sat={x} weight={x} formal={x} geo={x} innov={x} dense={x}

  Style 2: {name} — {description}
    ...

  Select preferred style(s):
    1-{N}  — Select variant
    "mix"  — Mix elements from multiple variants
    "redo" — Generate new variants with different keywords
    "all"  — Keep all as reference
```

#### 7b. Process selection

```
IF auto mode (-y): Select variant 1
IF "redo": Go back to Step 3
IF "mix": Record mix instructions, merge tokens
IF "all": Mark all as reference
IF number: Select that variant
```

#### 7c. Solidify selected design

**Write MASTER.md:**
```markdown
# Design System — {project_name}

## Selected Style: {variant_name}
6D Attributes: sat={x} weight={x} formal={x} geo={x} innov={x} dense={x}

### Color Palette
| Token | Value (OKLCH) | Usage |
|-------|---------------|-------|
| brand.primary | oklch(...) | Primary actions, key UI |
| brand.secondary | oklch(...) | Supporting elements |
...

### Typography
- **Heading**: {font} — {weights} (Google Fonts)
- **Body**: {font} — {weights}
- **Mono**: {font}
- **Scale**: xs(12) sm(14) base(16) lg(18) xl(20) 2xl(24) 3xl(30) 4xl(36) 5xl(48)
- **Combinations**: heading-primary, heading-secondary, body-regular, body-emphasis, caption, label

### Spacing & Layout
{spacing scale table}

### Effects & Interactions
{shadows, border-radius, transitions, animation patterns}

### Component Styles
{button variants, card variants, input variants — from component_styles}

### Animation System
{duration scale, easing functions, interaction patterns, keyframes}

### Anti-Patterns
{from ui-ux-pro-max: what to avoid}

### Reference Prototypes
{links to selected HTML prototypes}
```

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

When `maestro-plan` runs P1 (Context Collection), it SHOULD:

1. Check for `${PHASE_DIR}/design-ref/MASTER.md`
2. If found:
   - Load MASTER.md as design context for planner agent
   - Include `design-ref/design-tokens.json` in every UI task's `read_first[]`
   - Include `design-ref/layout-templates/layout-{target}-*.json` in relevant task's `read_first[]`
   - Include `design-ref/animation-tokens.json` in UI task's `read_first[]`
3. If NOT found AND phase goal matches UI keywords:
   - Suggest: `Skill({ skill: "maestro-ui-design", args: "{phase}" })`
   - Non-blocking — user can skip

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
