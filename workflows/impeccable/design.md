<!-- session-mode: inherited -->
# Design Stage + Bridge

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

## Architecture

```
PRODUCT.md → A1 Extract → A2 Keywords → A3 Generate MASTER_{A,B,C}.md
  → A3.1 Render HTML prototypes → A4 Visualize (/compare)
  → A4.1 User Review (Approve / Mix / Redo) → A4.2 Mix (optional)
  → A5 Persist → Phase B Bridge → DESIGN.md
```

## Phase A: Design System Generation

Generate a design system recommendation using the local ui-search tooling, then let the user select from multiple contrasting variants.

### Prerequisites

- `.workflow/impeccable/PRODUCT.md` exists (from teach step)
- Python 3 available
- `~/.maestro/workflows/impeccable/ui-search/search.py` exists (or project-local fallback)

### A1. Extract Query Context from PRODUCT.md

Read `.workflow/impeccable/PRODUCT.md` and extract:

| Field | Source in PRODUCT.md | Use |
|-------|---------------------|-----|
| register | `## Register` value (brand\|product) | Query direction: brand → expressive keywords, product → functional keywords |
| personality | `## Brand Personality` | Primary query keywords |
| anti_references | `## Anti-references` | Negative constraints (exclude matching styles) |
| industry | Inferred from `## Product Purpose` + `## Users` | Industry keyword for search |
| project_name | `# Product` title or inferred | `-p` flag value |

### A2. Build Variant Keyword Sets

Generate `styles_count` (default 3, range 2-5 via `--styles`) contrasting keyword sets from the extracted context:

```
variant_1: "${industry} ${personality} conservative clean"
variant_2: "${industry} ${personality} expressive bold"
variant_3: "${industry} ${personality} premium refined"
```

Adjust keywords to ensure variants diverge meaningfully. If register is `brand`, lean toward visual keywords; if `product`, lean toward functional keywords.

### A3. Generate Variants

Resolve the script path relative to the maestro installation:

```bash
# Find the script — prefer installed, fallback to project-local (dev)
SCRIPT_PATH="$HOME/.maestro/workflows/impeccable/ui-search/search.py"
if [ ! -f "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="workflows/impeccable/ui-search/search.py"
fi
```

For each variant, call:

```bash
python "$SCRIPT_PATH" "${variant_keywords}" --design-system -p "${project_name}" -f markdown
```

Save each output to a temporary directory as `MASTER_A.md`, `MASTER_B.md`, `MASTER_C.md` etc.

Optionally gather supplementary context:

```bash
# Stack guidelines (if --stack flag provided)
python "$SCRIPT_PATH" "layout responsive component" --stack ${stack}

# Domain supplements
python "$SCRIPT_PATH" "${industry}" --domain color
python "$SCRIPT_PATH" "${personality}" --domain typography
```

### A3.1. Render HTML Prototypes

For each generated `MASTER_{N}.md`, render a visual HTML prototype using the render script:

```bash
# Resolve render script — same search order as search.py
RENDER_PATH="$HOME/.maestro/workflows/impeccable/ui-search/render-prototype.js"
if [ ! -f "$RENDER_PATH" ]; then
  RENDER_PATH="workflows/impeccable/ui-search/render-prototype.js"
fi

# Render all variants at once
node "$RENDER_PATH" MASTER_A.md MASTER_B.md MASTER_C.md \
  --output "{temp_dir}/prototypes" --project "${project_name}"
```

This produces:
```
{temp_dir}/prototypes/
├── prototype_A.html    ← self-contained, all CSS inline
├── prototype_B.html
├── prototype_C.html
└── manifest.json       ← metadata for downstream tools
```

Each prototype shows the design system's visual language: color palette swatches, typography hierarchy, card grid, form inputs, buttons, stats, and layout rhythm. It does NOT contain business logic or real data.

If `node` is not available or rendering fails → W008, fall back to A4 text-only comparison.

### A4. Present Variants for Comparison

**Visual mode** (prototypes rendered successfully):

1. Start the visualize server:
   ```bash
   maestro brainstorm-visualize start --dir "{temp_dir}/prototypes/"
   ```
   Save `execId` and `url`.

2. Direct user to the compare view:
   ```
   ▸ Design variants ready for comparison:
     {url}/compare?files=prototype_A.html,prototype_B.html,prototype_C.html

     [A] {style_name_A} — {font_heading_A}/{font_body_A}
     [B] {style_name_B} — {font_heading_B}/{font_body_B}
     [C] {style_name_C} — {font_heading_C}/{font_body_C}
   ```

3. Collect user decision via AskUserQuestion:
   - **Approve [A/B/C]** — adopt this variant directly
   - **Mix** — enter mix protocol (A4.1)
   - **Redo** — adjust keywords and regenerate (back to A2, max 3 redo rounds)

4. Stop server after decision:
   ```bash
   maestro brainstorm-visualize stop {execId}
   ```

**Text-only fallback** (no Node.js, CI/headless, or rendering failed):

Display each variant summary showing: style name, color palette, typography, effects, anti-patterns.
If `-y` flag: auto-select variant 1.
Otherwise: ask user to pick [1-N | "redo"].

### A4.1. Mix Protocol (Optional)

When user selects "Mix", enter the dimension-based mixing flow:

1. AskUserQuestion with dimension selection:
   ```
   Which dimensions from which variant?
     Colors:     [A] / [B] / [C]
     Typography: [A] / [B] / [C]
     Spacing:    [A] / [B] / [C]
     Shadows:    [A] / [B] / [C]
   ```

2. Extract sections by Markdown heading from each selected variant:
   | Dimension | MASTER.md Section |
   |-----------|-------------------|
   | Colors | `### Color Palette` (up to next `###`) |
   | Typography | `### Typography` (up to next `###`) |
   | Spacing | `### Spacing Variables` (up to next `###`) |
   | Shadows | `### Shadow Depths` (up to next `###`) |

3. Assemble new MASTER.md:
   - Take selected dimension blocks from their respective variants
   - Take remaining sections (Component Specs, Style Guidelines, Anti-Patterns, Checklist) from the variant with the most selected dimensions (primary variant)
   - Regenerate Component Specs CSS using the mixed color values

4. Re-render HTML prototype of the mixed result:
   ```bash
   node "$RENDER_PATH" MASTER_mixed.md --output "{temp_dir}/prototypes" --project "${project_name}"
   ```

5. Show mixed prototype to user for final confirmation:
   - **Approve** → proceed to A5
   - **Redo mix** → back to step 1 (max 2 re-mix rounds)

### A4.2. Harvest Rejected Variants

After selection, archive rejected variants for knowledge accumulation:

1. Move rejected `MASTER_{N}.md` files to `.workflow/impeccable/design-system/harvest/rejected-variants/`
2. Append rejection metadata as YAML frontmatter:
   ```yaml
   ---
   status: rejected
   date: "{ISO-8601}"
   selected_variant: "{winner_label}"
   user_feedback: "{reason if provided, else 'not selected'}"
   ---
   ```
3. On next design-explore invocation, scan `harvest/rejected-variants/` for `user_feedback` entries and append as supplementary anti-references to the keyword generation (A2), making the system learn from past rejections.

### A5. Persist Selected Variant

```bash
python "$SCRIPT_PATH" "${selected_keywords}" --design-system --persist \
  -p "${project_name}" --output-dir ".workflow/impeccable"
```

If the selected variant was directly approved (not mixed), copy the already-generated `MASTER_{N}.md` instead of re-running search.py:

```bash
cp "{temp_dir}/MASTER_{selected}.md" ".workflow/impeccable/design-system/{project-slug}/MASTER.md"
```

If the variant was mixed, write the assembled `MASTER_mixed.md` as the final MASTER.md.

This creates:
```
.workflow/impeccable/design-system/{project-slug}/MASTER.md
```

Record selection metadata for status.json:
```json
{
  "selected_variant": "A",
  "variant_name": "{style_name}",
  "keywords": "{selected_keywords}",
  "mix_config": null | { "colors": "A", "typography": "B", "spacing": "C", "shadows": "A" },
  "redo_count": 0,
  "rejected_variants": ["B", "C"],
  "selected_at": "ISO-8601"
}
```

---

## Phase B: Bridge (MASTER.md to DESIGN.md)

Transform the persisted MASTER.md into `.workflow/impeccable/DESIGN.md` following the Google Stitch DESIGN.md format that `design-parser.ts` expects.

### Input

Read `.workflow/impeccable/design-system/{project-slug}/MASTER.md`.

The MASTER.md contains these sections:
- **Color Palette** table: 10 roles (Primary, On Primary, Secondary, Accent, Background, Foreground, Muted, Muted Foreground, Border, Destructive, Ring) with hex values and CSS vars
- **Typography**: heading font, body font, mood, Google Fonts URL, CSS import
- **Spacing Variables**: 7 tokens (--space-xs to --space-3xl) with px values
- **Shadow Depths**: 4 levels (--shadow-sm to --shadow-xl) with RGBA values
- **Component Specs**: CSS blocks for .btn-primary, .btn-secondary, .card, .input, .modal
- **Style Guidelines**: style name, keywords, best-for, key effects
- **Anti-Patterns**: list of patterns to avoid
- **Pre-Delivery Checklist**: quality checks

### Output: DESIGN.md

Write `.workflow/impeccable/DESIGN.md` with two layers:

#### Layer 1: YAML Frontmatter

```yaml
---
name: "{project_name}"
description: "{style_name} design system for {industry}"
colors:
  primary: "{Primary hex from table}"
  on-primary: "{On Primary hex}"
  secondary: "{Secondary hex}"
  accent: "{Accent hex}"
  background: "{Background hex}"
  foreground: "{Foreground hex}"
  muted: "{Muted hex}"
  border: "{Border hex}"
  destructive: "{Destructive hex}"
  ring: "{Ring hex}"
typography:
  display:
    fontFamily: "{Heading Font}"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "{Body Font}"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "{--space-xs value}"
  sm: "{--space-sm value}"
  md: "{--space-md value}"
  lg: "{--space-lg value}"
  xl: "{--space-xl value}"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "white"
    rounded: "{rounded.md}"
    padding: "{from .btn-primary CSS}"
  card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "{from .card CSS}"
  input:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "{from .input CSS}"
---
```

Rules:
- Use hex values (not OKLCH) in frontmatter for Stitch parser compatibility
- Component tokens use `{path.to.token}` references where possible
- Only 8 allowed component props: backgroundColor, textColor, typography, rounded, padding, size, height, width

#### Layer 2: Markdown Body (6 Canonical Sections)

Section headers MUST contain the canonical keyword (case-insensitive). Numbered prefixes are allowed.

**## Overview**

```markdown
## Overview

**Creative North Star: "{synthesized metaphor from style name + keywords}"**

{2-3 paragraphs describing the design philosophy, derived from style guidelines section}

**Key Characteristics:**
- {characteristic from keywords}
- {characteristic from best-for}
- {characteristic from effects}
```

Synthesize the Creative North Star from style name + keywords. Example: style "Bento Box Grid" → "The Modular Canvas — asymmetric rhythm, breathing whitespace, Apple-caliber precision."

**## Colors**

```markdown
## Colors

### Primary
- **{Descriptive name}** ({Primary hex}): Main brand color, used for primary actions and key UI anchors
- **On Primary** ({On Primary hex}): Text/icons on primary color surfaces

### Secondary
- **{Descriptive name}** ({Secondary hex}): Supporting color for secondary actions and accents

### Tertiary
- **{Descriptive name}** ({Accent hex}): Accent color for highlights, CTAs, and interactive elements

### Neutral
- **Background** ({Background hex}): Page and section backgrounds
- **Foreground** ({Foreground hex}): Primary text color
- **Muted** ({Muted hex}): Muted surfaces, secondary backgrounds
- **Border** ({Border hex}): Dividers, input borders, card edges

### Semantic
- **Destructive** ({Destructive hex}): Error states, delete actions, warnings
- **Ring** ({Ring hex}): Focus rings, selection indicators
```

Generate descriptive color names from hex hue analysis (e.g., #2563EB → "Signal Blue", #F97316 → "Warm Amber").

**## Typography**

```markdown
## Typography

**Display Font:** {Heading Font} (with system-ui fallback)
**Body Font:** {Body Font} (with system-ui fallback)
**Character:** {Mood from typography section}

**Hierarchy:**
- **Display** (700, clamp(2.5rem, 5vw, 4rem), 1.1): Hero headlines, landing page titles
- **Headline** (700, 2rem, 1.2): Section headers, page titles
- **Title** (600, 1.25rem, 1.3): Card titles, subsection headers
- **Body** (400, 1rem, 1.6): Running text, descriptions — max 65-75ch line length
- **Label** (500, 0.875rem, 1.4): Buttons, badges, metadata, navigation items

Google Fonts: {Google Fonts URL}
```

**## Elevation**

```markdown
## Elevation

{Philosophy paragraph — infer from style type:
 - Flat/Minimal → "Flat by default. Shadows appear only on state changes (hover, focus, active) to reinforce interaction feedback."
 - Layered/Cards → "Progressive depth through shadow scale. Cards float above the surface; modals command attention with deeper shadows."
}

- **Subtle** ({--shadow-sm value}): Resting state for cards and containers
- **Medium** ({--shadow-md value}): Hover state, dropdown menus, popovers
- **Elevated** ({--shadow-lg value}): Modals, drawers, floating action elements
- **Prominent** ({--shadow-xl value}): Hero sections, featured content, overlays
```

**## Components**

```markdown
## Components

### Buttons
- **Shape:** Rounded corners ({border-radius from .btn-primary CSS})
- **Primary:** {background} + {color} + {padding} from .btn-primary CSS
- **Primary Hover:** {hover transition/transform from CSS}
- **Secondary:** {border} + {color} from .btn-secondary CSS

### Cards
- **Corner Radius:** {border-radius from .card CSS}
- **Background:** {background from .card CSS}
- **Shadow:** References Elevation "Subtle" at rest, "Medium" on hover
- **Padding:** {padding from .card CSS}
- **Hover:** {transition from .card CSS}

### Inputs
- **Border:** {border from .input CSS}
- **Border Radius:** {border-radius from .input CSS}
- **Focus:** {border-color and box-shadow from .input:focus CSS}
- **Padding:** {padding from .input CSS}

### Modals
- **Overlay:** {background and backdrop-filter from .modal-overlay CSS}
- **Panel:** {border-radius, padding, box-shadow from .modal CSS}
```

**## Do's and Don'ts**

```markdown
## Do's and Don'ts

### Do
- Use SVG icons (Heroicons, Lucide) — never emojis as structural icons
- Add cursor:pointer to all clickable elements
- Include smooth hover transitions (150-300ms, ease-out)
- Maintain 4.5:1 contrast ratio for all text
- Test on mobile viewport (375px) before shipping
- {additional Do items from Pre-Delivery Checklist}

### Don't
- {each anti-pattern from MASTER.md, converted to imperative}
- {additional forbidden patterns from MASTER.md}
```

### Post-Bridge Actions

After writing DESIGN.md:

1. Register in spec system:
   ```bash
   maestro spec add ui "Design System: {project_name}" "{style_name} — {color_strategy}" \
     --keywords "design,colors,typography,{style_name}" \
     --description "{style_name} design system for {project_name}" \
     --ref ".workflow/impeccable/DESIGN.md"
   ```

2. Refresh context:
   ```bash
   maestro impeccable load-context
   ```

3. Announce to conversation:
   ```
   ✓ Design system bridged: {style_name}
     DESIGN.md written with {N} colors, {heading_font}/{body_font}, {shadow_count} elevation levels
     Shape will use this as visual baseline — skipping color/theme/anchor questions
   ```
