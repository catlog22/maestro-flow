<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# UI Codify: Phase 2 — Parallel Agent Extraction

## Overview

- 3 个 Agent 并行运行：Style、Animation、Layout
- 每个 Agent 可读取所有文件类型（CSS/SCSS/JS/TS/HTML）进行交叉引用
- 直接生成完整性报告
- 优雅的失败处理

## Prerequisites

来自 Phase 1 的变量：
- `source_path` — 源代码目录绝对路径
- `temp_dir` — 临时工作区路径

## Step 2.1: File Discovery

```bash
echo "[Phase 2] File Discovery Started"
echo "  Source: ${source_path}"

# Discover files using script
discovery_file="${temp_dir}/.intermediates/import-analysis/discovered-files.json"
ccw tool exec discover_design_files '{"sourceDir":"'"${source_path}"'","outputPath":"'"${discovery_file}"'"}'

echo "  Output: ${discovery_file}"
```

**File Discovery Behavior**:
- **Automatic discovery**: 智能扫描源目录中所有样式相关文件
- **Supported file types**: CSS, SCSS, JavaScript, TypeScript, HTML
- **Smart filtering**: 查找主题相关 JS/TS 文件（tailwind.config.js, theme.js, styled-components 等）
- **Exclusions**: 自动排除 `node_modules/`, `dist/`, `.git/`, build 目录
- **Output**: `discovered-files.json` — `{ "css": [...], "js": [...], "html": [...], "counts": {...} }`

---

## Step 2.2: Parallel Agent Analysis

```bash
echo "[Phase 2] Starting parallel agent analysis (3 agents)"
```

### Style Agent Task (design-tokens.json)

**Agent Task**:

```javascript
Task(subagent_type="ui-design-agent",
     run_in_background=false,
     prompt="[STYLE_TOKENS_EXTRACTION]
  Extract visual design tokens from code files using code import extraction pattern.

  MODE: style-extraction | SOURCE: ${source_path} | BASE_PATH: ${temp_dir}

  ## Input Files

  **Discovered Files**: ${temp_dir}/.intermediates/import-analysis/discovered-files.json
  $(cat \"${temp_dir}/.intermediates/import-analysis/discovered-files.json\" 2>/dev/null | grep -E '(count|files)' | head -30)

  ## Code Import Extraction Strategy

  **Step 0: Fast Conflict Detection** (Use Bash/Grep for quick global scan)
  - Quick scan: \`rg --color=never -n "^\\s*--primary:|^\\s*--secondary:|^\\s*--accent:" --type css ${source_path}\` to find core color definitions with line numbers
  - Semantic search: \`rg --color=never -B3 -A1 "^\\s*--primary:" --type css ${source_path}\` to capture surrounding context and comments
  - Core token scan: Search for --primary, --secondary, --accent, --background patterns to detect all theme-critical definitions
  - Pattern: rg → Extract values → Compare → If different → Read full context with comments → Record conflict
  - Alternative (if many files): Execute CLI analysis for comprehensive report:
    \`\`\`bash
    ccw cli -p \"
    PURPOSE: Detect color token conflicts across all CSS/SCSS/JS files
    TASK: • Scan all files for color definitions • Identify conflicting values • Extract semantic comments
    MODE: analysis
    CONTEXT: @**/*.css @**/*.scss @**/*.js @**/*.ts
    EXPECTED: JSON report listing conflicts with file:line, values, semantic context
    RULES: Focus on core tokens | Report ALL variants | analysis=READ-ONLY
    \" --tool gemini --mode analysis --cd ${source_path}
    \`\`\`

  **Step 1: Load file list**
  - Read(${temp_dir}/.intermediates/import-analysis/discovered-files.json)
  - Extract: file_types.css.files, file_types.js.files, file_types.html.files

  **Step 2: Cross-source token extraction**
  - CSS/SCSS: Colors, typography, spacing, shadows, borders
  - JavaScript/TypeScript: Theme configs (Tailwind, styled-components, CSS-in-JS)
  - HTML: Inline styles, usage patterns

  **Step 3: Validation and Conflict Detection**
  - Report missing tokens WITHOUT inference (mark as \"missing\" in _metadata.completeness)
  - Detect and report inconsistent values across files (list ALL variants with file:line sources)
  - Report missing categories WITHOUT auto-filling (document gaps for manual review)
  - CRITICAL: Verify core tokens (primary, secondary, accent) against semantic comments in source code

  ## Output Files

  **Target Directory**: ${temp_dir}/style-extraction/style-1/

  **Files to Generate**:
  1. **design-tokens.json**
     - Follow [DESIGN_SYSTEM_GENERATION_TASK] standard token structure
     - Add \"_metadata.extraction_source\": \"code_import\"
     - Add \"_metadata.files_analyzed\": {css, js, html file lists}
     - Add \"_metadata.completeness\": {status, missing_categories, recommendations}
     - Add \"_metadata.conflicts\": Array of conflicting definitions (MANDATORY if conflicts exist)
     - Add \"_metadata.code_snippets\": Map of code snippets (see below)
     - Add \"_metadata.usage_recommendations\": Usage patterns from code (see below)
     - Include \"source\" field for each token (e.g., \"file.css:23\")

  **Code Snippet Recording**:
  - For each extracted token, record the actual code snippet in `_metadata.code_snippets`
  - Structure:
    ```json
    \"code_snippets\": {
      \"file.css:23\": {
        \"lines\": \"23-27\",
        \"snippet\": \":root {\\n  --color-primary: oklch(0.5555 0.15 270);\\n  /* Primary brand color */\\n  --color-primary-hover: oklch(0.6 0.15 270);\\n}\",
        \"context\": \"css-variable\"
      }
    }
    ```
  - Context types: \"css-variable\" | \"css-class\" | \"js-object\" | \"js-theme-config\" | \"inline-style\"
  - Record complete code blocks with all dependencies and relevant comments
  - Typical ranges: Simple declarations (1-5 lines), Utility classes (5-15 lines), Complete configs (15-50 lines)
  - Preserve original formatting and indentation

  **Conflict Detection and Reporting**:
  - When the same token is defined differently across multiple files, record in `_metadata.conflicts`
  - Follow Agent schema for conflicts array structure (see ui-design-agent.md)
  - Each conflict MUST include: token_name, category, all definitions with context, selected_value, selection_reason
  - Selection priority:
    1. Definitions with semantic comments explaining intent (/* Blue theme */, /* Primary brand color */)
    2. Definitions that align with overall color scheme described in comments
    3. When in doubt, report ALL variants and flag for manual review in completeness.recommendations

  **Usage Recommendations Generation**:
  - Analyze code usage patterns to extract `_metadata.usage_recommendations` (see ui-design-agent.md schema)
  - **Typography recommendations**:
    * `common_sizes`: Identify most frequent font size usage (e.g., \"body_text\": \"base (1rem)\")
    * `common_combinations`: Extract heading+body pairings from actual usage (e.g., h1 with p tags)
  - **Spacing recommendations**:
    * `size_guide`: Categorize spacing values into tight/normal/loose based on frequency
    * `common_patterns`: Extract frequent padding/margin combinations from components
  - Analysis method: Scan code for class/style usage frequency, extract patterns from component implementations
  - Optional: If insufficient usage data, mark fields as empty arrays/objects with note in completeness.recommendations

  ## Code Import Specific Requirements
  - ✅ Read discovered-files.json FIRST to get file paths
  - ✅ Track extraction source for each token (file:line)
  - ✅ Record complete code snippets in _metadata.code_snippets (complete blocks with dependencies/comments)
  - ✅ Include completeness assessment in _metadata
  - ✅ Report inconsistent values with ALL source locations in _metadata.conflicts (DO NOT auto-normalize or choose)
  - ✅ CRITICAL: Verify core theme tokens (primary, secondary, accent) match source code semantic intent
  - ✅ When conflicts exist, prefer definitions with semantic comments explaining intent
  - ❌ NO inference, NO smart filling, NO automatic conflict resolution
  - ❌ NO external research or web searches (code-only extraction)
")
```

### Animation Agent Task (animation-tokens.json)

**Agent Task**:

```javascript
Task(subagent_type="ui-design-agent",
     run_in_background=false,
     prompt="[ANIMATION_TOKEN_GENERATION_TASK]
  Extract animation tokens from code files using code import extraction pattern.

  MODE: animation-extraction | SOURCE: ${source_path} | BASE_PATH: ${temp_dir}

  ## Input Files

  **Discovered Files**: ${temp_dir}/.intermediates/import-analysis/discovered-files.json
  $(cat \"${temp_dir}/.intermediates/import-analysis/discovered-files.json\" 2>/dev/null | grep -E '(count|files)' | head -30)

  ## Code Import Extraction Strategy

  **Step 0: Fast Animation Discovery** (Use Bash/Grep for quick pattern detection)
  - Quick scan: \`rg --color=never -n "@keyframes|animation:|transition:" --type css ${source_path}\` to find animation definitions with line numbers
  - Framework detection: \`rg --color=never "framer-motion|gsap|@react-spring|react-spring" --type js --type ts ${source_path}\` to detect animation frameworks
  - Pattern categorization: \`rg --color=never -B2 -A5 "@keyframes" --type css ${source_path}\` to extract keyframe animations with context
  - Pattern: rg → Identify animation types → Map framework usage → Prioritize extraction targets
  - Alternative (if complex framework mix): Execute CLI analysis for comprehensive report:
    \`\`\`bash
    ccw cli -p \"
    PURPOSE: Detect animation frameworks and patterns
    TASK: • Identify frameworks • Map animation patterns • Categorize by complexity
    MODE: analysis
    CONTEXT: @**/*.css @**/*.scss @**/*.js @**/*.ts
    EXPECTED: JSON report listing frameworks, animation types, file locations
    RULES: Focus on framework consistency | Map all animations | analysis=READ-ONLY
    \" --tool gemini --mode analysis --cd ${source_path}
    \`\`\`

  **Step 1: Load file list**
  - Read(${temp_dir}/.intermediates/import-analysis/discovered-files.json)
  - Extract: file_types.css.files, file_types.js.files, file_types.html.files

  **Step 2: Cross-source animation extraction**
  - CSS/SCSS: @keyframes, transitions, animation properties
  - JavaScript/TypeScript: Animation frameworks (Framer Motion, GSAP), CSS-in-JS
  - HTML: Inline styles, data-animation attributes

  **Step 3: Framework detection & normalization**
  - Detect animation frameworks used (css-animations | framer-motion | gsap | none)
  - Normalize into semantic token system
  - Cross-reference CSS animations with JS configs

  ## Output Files

  **Target Directory**: ${temp_dir}/animation-extraction/

  **Files to Generate**:
  1. **animation-tokens.json**
     - Follow [ANIMATION_TOKEN_GENERATION_TASK] standard structure
     - Add \"_metadata.framework_detected\"
     - Add \"_metadata.files_analyzed\"
     - Add \"_metadata.completeness\"
     - Add \"_metadata.code_snippets\": Map of code snippets (same format as Style Agent)
     - Include \"source\" field for each token

  **Code Snippet Recording**:
  - Record actual animation/transition code in `_metadata.code_snippets`
  - Context types: \"css-keyframes\" | \"css-transition\" | \"js-animation\" | \"framer-motion\" | \"gsap\"
  - Record complete blocks: @keyframes animations (10-30 lines), transition configs (5-15 lines), JS animation objects (15-50 lines)
  - Include all animation steps, timing functions, and related comments
  - Preserve original formatting and framework-specific syntax

  ## Code Import Specific Requirements
  - ✅ Read discovered-files.json FIRST to get file paths
  - ✅ Detect animation framework if present
  - ✅ Track extraction source for each token (file:line)
  - ✅ Record complete code snippets in _metadata.code_snippets (complete animation blocks with all steps/timing)
  - ✅ Normalize framework-specific syntax into standard tokens
  - ❌ NO external research or web searches (code-only extraction)
")
```

### Layout Agent Task (layout-templates.json)

**Agent Task**:

```javascript
Task(subagent_type="ui-design-agent",
     run_in_background=false,
     prompt="[LAYOUT_TEMPLATE_GENERATION_TASK]
  Extract layout patterns from code files using code import extraction pattern.

  MODE: layout-extraction | SOURCE: ${source_path} | BASE_PATH: ${temp_dir}

  ## Input Files

  **Discovered Files**: ${temp_dir}/.intermediates/import-analysis/discovered-files.json
  $(cat \"${temp_dir}/.intermediates/import-analysis/discovered-files.json\" 2>/dev/null | grep -E '(count|files)' | head -30)

  ## Code Import Extraction Strategy

  **Step 0: Fast Component Discovery** (Use Bash/Grep for quick component scan)
  - Layout pattern scan: \`rg --color=never -n "display:\\s*(grid|flex)|grid-template" --type css ${source_path}\` to find layout systems
  - Component class scan: \`rg --color=never "class.*=.*\\"[^\"]*\\b(btn|button|card|input|modal|dialog|dropdown)" --type html --type js --type ts ${source_path}\` to identify UI components
  - Universal component heuristic: Components appearing in 3+ files = universal, <3 files = specialized
  - Pattern: rg → Count occurrences → Classify by frequency → Prioritize universal components
  - Alternative (if large codebase): Execute CLI analysis for comprehensive categorization:
    \`\`\`bash
    ccw cli -p \"
    PURPOSE: Classify components as universal vs specialized
    TASK: • Identify UI components • Classify reusability • Map layout systems
    MODE: analysis
    CONTEXT: @**/*.css @**/*.scss @**/*.js @**/*.ts @**/*.html
    EXPECTED: JSON report categorizing components, layout patterns, naming conventions
    RULES: Focus on component reusability | Identify layout systems | analysis=READ-ONLY
    \" --tool gemini --mode analysis --cd ${source_path}
    \`\`\`

  **Step 1: Load file list**
  - Read(${temp_dir}/.intermediates/import-analysis/discovered-files.json)
  - Extract: file_types.css.files, file_types.js.files, file_types.html.files

  **Step 2: Cross-source layout extraction**
  - CSS/SCSS: Grid systems, flexbox utilities, layout classes, media queries
  - JavaScript/TypeScript: Layout components (React/Vue), grid configs
  - HTML: Semantic structure, component hierarchies

  **Component Classification** (MUST annotate in extraction):
  - **Universal Components**: Reusable multi-component templates (buttons, inputs, cards, modals, etc.)
  - **Specialized Components**: Module-specific components from code (feature-specific layouts, custom widgets, domain components)

  **Step 3: System identification**
  - Detect naming convention (BEM | SMACSS | utility-first | css-modules)
  - Identify layout system (12-column | flexbox | css-grid | custom)
  - Extract responsive strategy and breakpoints

  ## Output Files

  **Target Directory**: ${temp_dir}/layout-extraction/

  **Files to Generate**:

  1. **layout-templates.json**
     - Follow [LAYOUT_TEMPLATE_GENERATION_TASK] standard structure
     - Add \"extraction_metadata\" section:
       * extraction_source: \"code_import\"
       * naming_convention: detected convention
       * layout_system: {type, confidence, source_files}
       * responsive: {breakpoints, mobile_first, source}
       * completeness: {status, missing_items, recommendations}
       * code_snippets: Map of code snippets (same format as Style Agent)
     - For each component in \"layout_templates\":
       * Include \"source\" field (file:line)
       * **Include \"component_type\" field: \"universal\" | \"specialized\"**
       * dom_structure with semantic HTML5
       * css_layout_rules using var() placeholders
       * Add \"description\" field explaining component purpose and classification rationale
       * **Add \"usage_guide\" field for universal components** (see ui-design-agent.md schema):
         - common_sizes: Extract size variants (small/medium/large) from code
         - variant_recommendations: Document when to use each variant (primary/secondary/etc)
         - usage_context: List typical usage scenarios from actual implementation
         - accessibility_tips: Extract ARIA patterns and a11y notes from code

  **Code Snippet Recording**:
  - Record actual layout/component code in `extraction_metadata.code_snippets`
  - Context types: \"css-grid\" | \"css-flexbox\" | \"css-utility\" | \"html-structure\" | \"react-component\"
  - Record complete blocks: Utility classes (5-15 lines), HTML structures (10-30 lines), React components (20-100 lines)
  - For components: include HTML structure + associated CSS rules + component logic
  - Preserve original formatting and framework-specific syntax

  ## Code Import Specific Requirements
  - ✅ Read discovered-files.json FIRST to get file paths
  - ✅ Detect and document naming conventions
  - ✅ Identify layout system with confidence level
  - ✅ Extract component variants and states from usage patterns
  - ✅ **Classify each component as \"universal\" or \"specialized\"** based on:
    * Universal: Reusable across multiple features (buttons, inputs, cards, modals)
    * Specialized: Feature-specific or domain-specific (checkout form, dashboard widget)
  - ✅ Record complete code snippets in extraction_metadata.code_snippets (complete components/structures)
  - ✅ **Document classification rationale** in component description
  - ✅ **Generate usage_guide for universal components** (REQUIRED):
    * Analyze code to extract size variants (scan for size-related classes/props)
    * Document variant usage from code comments and implementation patterns
    * List usage contexts from component instances in codebase
    * Extract accessibility patterns from ARIA attributes and a11y comments
    * If insufficient data, populate with minimal valid structure and note in completeness
  - ❌ NO external research or web searches (code-only extraction)
")
```

### Wait for All Agents

```bash
# Agents run in parallel and write separate output files
# Each agent generates its own JSON directly
Glob ${temp_dir}/style-extraction/style-1/design-tokens.json, ${temp_dir}/animation-extraction/animation-tokens.json, ${temp_dir}/layout-extraction/layout-templates.json MUST exist before Phase 2 complete; BLOCKED if missing
echo "[Phase 2] Parallel agent analysis complete"
```

## Output Files

**Directory Structure**:
```
${temp_dir}/
├── style-extraction/
│   └── style-1/
│       └── design-tokens.json       # Design tokens with code snippets
├── animation-extraction/
│   └── animation-tokens.json        # Animation tokens with code snippets
├── layout-extraction/
│   └── layout-templates.json        # Layout patterns with code snippets
└── .intermediates/
    └── import-analysis/
        └── discovered-files.json    # All discovered files
```
