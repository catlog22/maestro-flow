<!-- session-mode: inherited -->
# UI Codify: Phase 3 — Reference Package Generation

## Prerequisites

来自前序 Phase 的变量：
- `temp_dir` — 临时工作区，包含提取结果
- `package_dir` — 目标包目录
- `package_name` — 包名

## Step 3.1: Copy Token Files

```bash
echo "[Phase 3] Preparing component data from extraction"

# 1. Copy layout templates (required)
cp "${temp_dir}/layout-extraction/layout-templates.json" "${package_dir}/layout-templates.json"

if [ ! -f "${package_dir}/layout-templates.json" ]; then
  echo "ERROR: Failed to copy layout templates"
  exit 1
fi

component_count=$(jq -r '.layout_templates | length // 0' "${package_dir}/layout-templates.json" 2>/dev/null || echo 0)
echo "  Layout templates copied (${component_count} components)"

# 2. Copy design tokens (required)
cp "${temp_dir}/style-extraction/style-1/design-tokens.json" "${package_dir}/design-tokens.json"

if [ ! -f "${package_dir}/design-tokens.json" ]; then
  echo "ERROR: Failed to copy design tokens"
  exit 1
fi
echo "  Design tokens copied"

# 3. Copy animation tokens (optional)
if [ -f "${temp_dir}/animation-extraction/animation-tokens.json" ]; then
  cp "${temp_dir}/animation-extraction/animation-tokens.json" "${package_dir}/animation-tokens.json"
  echo "  Animation tokens copied"
else
  echo "  W001: Animation tokens not found (optional, continuing)"
fi

echo "[Phase 3] Token files prepared"
```

---

## Step 3.2: Preview Generation (Agent)

**Agent Task**:

```javascript
MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Agent(ui-design-agent): `
  [PREVIEW_SHOWCASE_GENERATION]
  Generate interactive multi-component showcase panel for reference package

  PACKAGE_DIR: ${package_dir} | PACKAGE_NAME: ${package_name}

  ## Input Files (MUST READ ALL)

  1. ${package_dir}/layout-templates.json (component layout patterns - REQUIRED)
  2. ${package_dir}/design-tokens.json (design tokens - REQUIRED)
  3. ${package_dir}/animation-tokens.json (optional, if exists)

  ## Generation Agent

  Create interactive showcase with these sections:

  ### Section 1: Colors
  - Display all color categories as color swatches
  - Show hex/rgb values
  - Group by: brand, semantic, surface, text, border

  ### Section 2: Typography
  - Display typography scale (font sizes, weights)
  - Show typography combinations if available
  - Include font family examples
  - **Display usage recommendations** (from design-tokens.json _metadata.usage_recommendations.typography):
    * Common sizes table (small_text, body_text, heading)
    * Common combinations with use cases

  ### Section 3: Components
  - Render all components from layout-templates.json (use layout_templates field)
  - **Universal Components**: Display reusable multi-component showcases (buttons, inputs, cards, etc.)
    * **Display usage_guide** (from layout-templates.json):
      - Common sizes table with dimensions and use cases
      - Variant recommendations (when to use primary/secondary/etc)
      - Usage context list (typical scenarios)
      - Accessibility tips checklist
  - **Specialized Components**: Display module-specific components from code (feature-specific layouts, custom widgets)
  - Display all variants side-by-side
  - Show DOM structure with proper styling
  - Include usage code snippets in <details> tags
  - Clearly label component types (universal vs specialized)

  ### Section 4: Spacing & Layout
  - Visual spacing scale
  - Border radius examples
  - Shadow depth examples
  - **Display spacing recommendations** (from design-tokens.json _metadata.usage_recommendations.spacing):
    * Size guide table (tight/normal/loose categories)
    * Common patterns with use cases and pixel values

  ### Section 5: Animations (if available)
  - Animation duration examples
  - Easing function demonstrations

  ## Output Requirements

  Generate 2 files:
  1. ${package_dir}/preview.html
  2. ${package_dir}/preview.css

  ### preview.html Structure:
  - Complete standalone HTML file
  - Responsive design with mobile-first approach
  - Sticky navigation for sections
  - Interactive component demonstrations
  - Code snippets in collapsible <details> elements
  - Footer with package metadata

  ### preview.css Structure:
  - CSS Custom Properties from design-tokens.json
  - Typography combination classes
  - Component classes from layout-templates.json
  - Preview page layout styles
  - Interactive demo styles

  ## Critical Requirements
  - ✅ Read ALL input files (layout-templates.json, design-tokens.json, animation-tokens.json if exists)
  - ✅ Generate complete, interactive showcase HTML
  - ✅ All CSS uses var() references to design tokens
  - ✅ Display ALL components from layout-templates.json
  - ✅ **Separate universal components from specialized components** in the showcase
  - ✅ Display component DOM structures with proper styling
  - ✅ Include usage code snippets
  - ✅ Label each component type clearly (Universal / Specialized)
  - ✅ **Display usage recommendations** when available:
    - Typography: common_sizes, common_combinations (from _metadata.usage_recommendations)
    - Components: usage_guide for universal components (from layout-templates)
    - Spacing: size_guide, common_patterns (from _metadata.usage_recommendations)
  - ✅ Gracefully handle missing usage data (display sections only if data exists)
  - ✅ Use Write() to save both files:
    - ${package_dir}/preview.html
    - ${package_dir}/preview.css
  - ❌ NO external research or MCP calls
`
```

## Output Structure

```
${package_dir}/
├── layout-templates.json    # Layout templates (copied from extraction)
├── design-tokens.json       # Design tokens (copied from extraction)
├── animation-tokens.json    # Animation tokens (optional)
├── preview.html             # Interactive showcase (NEW)
└── preview.css              # Showcase styling (NEW)
```
