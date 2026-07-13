<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Explore Flow

Generate multiple design system variants, render HTML prototypes for visual comparison, and let the user select, mix, or redo until the visual direction is locked.

**Output**: `.workflow/impeccable/design-system/{project}/MASTER.md` (selected variant) + `.workflow/impeccable/DESIGN.md` (bridged, if bridge succeeds)

**Position in pipeline**: After `teach` (PRODUCT.md exists), before `shape` (visual direction locked). Can be called standalone or as part of `impeccable` build chain.

## Prerequisites

- `.workflow/impeccable/PRODUCT.md` exists (run `teach` first if not)
- Python 3 available (for `search.py`)
- Node.js available (for `render-prototype.js`; optional — falls back to text comparison)

## Step 1: Extract Context from PRODUCT.md

Read `.workflow/impeccable/PRODUCT.md` and extract:

| Field | Source | Use |
|-------|--------|-----|
| register | `## Register` | brand → expressive keywords, product → functional keywords |
| personality | `## Brand Personality` | Primary query keywords |
| anti_references | `## Anti-references` | Exclude matching styles |
| industry | Inferred from `## Product Purpose` + `## Users` | Industry keyword |
| project_name | `# Product` title | `-p` flag value |

Also scan `.workflow/impeccable/design-system/harvest/rejected-variants/` for prior rejection feedback — append to anti_references if found.

## Step 2: Build Variant Keyword Sets

Generate `styles_count` (default 3, range 2-5 via `--styles` flag) contrasting keyword sets:

```
variant_1: "${industry} ${personality} conservative clean"
variant_2: "${industry} ${personality} expressive bold"
variant_3: "${industry} ${personality} premium refined"
```

Adjust keywords to ensure variants diverge meaningfully. If register is `brand`, lean toward visual keywords; if `product`, lean toward functional keywords.

## Step 3: Generate Variants

Resolve script path (project-local → installed fallback):

```bash
SCRIPT_PATH="$HOME/.maestro/workflows/impeccable/ui-search/search.py"
[ ! -f "$SCRIPT_PATH" ] && SCRIPT_PATH="workflows/impeccable/ui-search/search.py"
```

For each variant:

```bash
python "$SCRIPT_PATH" "${variant_keywords}" --design-system -p "${project_name}" -f markdown
```

Save output as `MASTER_A.md`, `MASTER_B.md`, `MASTER_C.md` in a temp directory.

## Step 4: Render HTML Prototypes

Resolve render script:

```bash
RENDER_PATH="$HOME/.maestro/workflows/impeccable/ui-search/render-prototype.js"
[ ! -f "$RENDER_PATH" ] && RENDER_PATH="workflows/impeccable/ui-search/render-prototype.js"
```

```bash
node "$RENDER_PATH" MASTER_A.md MASTER_B.md MASTER_C.md \
  --output "{temp_dir}/prototypes" --project "${project_name}"
```

Produces `prototype_A.html`, `prototype_B.html`, `prototype_C.html` + `manifest.json`.

If Node.js unavailable → W008, skip to Step 5 text-only mode.

## Step 5: Present for Comparison

**Visual mode** (prototypes rendered):

1. Start visualize server:
   ```bash
   maestro brainstorm-visualize start --dir "{temp_dir}/prototypes/"
   ```
2. Direct user to compare view:
   ```
   Design variants ready:
     {url}/compare?files=prototype_A.html,prototype_B.html,prototype_C.html

     [A] {style_A} — {font_heading_A}/{font_body_A}
     [B] {style_B} — {font_heading_B}/{font_body_B}
     [C] {style_C} — {font_heading_C}/{font_body_C}
   ```
3. AskUserQuestion: **Approve [A/B/C]** | **Mix** | **Redo**
4. Stop server after decision.

**Text-only fallback**: Display style name, color palette, typography, effects for each variant. AskUserQuestion: pick [1-N] | redo.

**Auto mode** (`-y`): Select variant 1 without asking.

## Step 6: Mix Protocol (if selected)

1. AskUserQuestion — dimension selection:
   ```
   Which dimensions from which variant?
     Colors:     [A] / [B] / [C]
     Typography: [A] / [B] / [C]
     Spacing:    [A] / [B] / [C]
     Shadows:    [A] / [B] / [C]
   ```

2. Extract sections by Markdown heading from each variant:
   - Colors → `### Color Palette`
   - Typography → `### Typography`
   - Spacing → `### Spacing Variables`
   - Shadows → `### Shadow Depths`

3. Assemble new MASTER.md: selected blocks + remaining sections from primary variant.

4. Re-render mixed prototype and show for confirmation. **Approve** → Step 7. **Redo mix** → back to step 1 (max 2 rounds).

## Step 7: Persist & Harvest

**Persist selected variant**:

```
.workflow/impeccable/design-system/{project-slug}/MASTER.md
```

Copy directly if approved, or write assembled content if mixed.

**Harvest rejected variants**: Move rejected `MASTER_{N}.md` to `.workflow/impeccable/design-system/harvest/rejected-variants/` with YAML frontmatter:

```yaml
---
status: rejected
date: "{ISO-8601}"
selected_variant: "{winner}"
user_feedback: "{reason if provided}"
---
```

## Step 8: Bridge to DESIGN.md

After MASTER.md is persisted, automatically run the bridge transformation:

1. Read deferred: `~/.maestro/workflows/impeccable/design.md` Phase B
2. Transform MASTER.md → `.workflow/impeccable/DESIGN.md`
3. Register: `maestro spec add ui "Design System: {project}" "{style}" --keywords design,colors,typography --ref .workflow/impeccable/DESIGN.md`
4. Refresh: `maestro impeccable load-context`

If bridge fails → W005, MASTER.md still available for manual conversion.

```
Explore complete: {style_name}
  DESIGN.md: {N} colors, {heading}/{body}, {shadow_count} elevations
  Variants compared: {total} | Selected: {winner} | Rejected: {rejected_count}
```
