<!-- session-mode: inherited -->
# UI Codify: Phase 4 — Knowledge Asset Generation

读取提取的 JSON 文件，构建 knowhow-manifest.json，调用 codify-to-knowhow 固化为知识资产。

## Prerequisites

来自前序 Phase 的变量：
- `package_dir` — 包目录（包含所有 token 文件）
- `package_name` — 包名（用作 slug）
- `temp_dir` — 临时工作区（清理用）

## Step 4.1: Read Extracted Data

读取 package_dir 中的 JSON 文件，提取构建 manifest 所需的数据：

```javascript
// 1. Read design-tokens.json
const designTokens = Read("${package_dir}/design-tokens.json");
const tokenMetadata = designTokens._metadata || {};
const codePaths_tokens = Object.keys(tokenMetadata.code_snippets || {}).map(k => k.split(':')[0]);
const conflicts = tokenMetadata.conflicts || [];

// 2. Read layout-templates.json
const layoutTemplates = Read("${package_dir}/layout-templates.json");
const extractionMeta = layoutTemplates.extraction_metadata || {};
const codePaths_layout = Object.keys(extractionMeta.code_snippets || {}).map(k => k.split(':')[0]);

// Classify components
const allComponents = layoutTemplates.layout_templates || [];
const universalComponents = allComponents.filter(c => c.component_type === 'universal');
const specializedComponents = allComponents.filter(c => c.component_type === 'specialized');

// 3. Read animation-tokens.json (optional)
let animationTokens = null;
let codePaths_animation = [];
try {
  animationTokens = Read("${package_dir}/animation-tokens.json");
  const animMeta = animationTokens._metadata || {};
  codePaths_animation = Object.keys(animMeta.code_snippets || {}).map(k => k.split(':')[0]);
} catch (e) {
  // animation-tokens.json is optional
}

// 4. Deduplicate code paths
const allCodePaths = [...new Set([...codePaths_tokens, ...codePaths_layout, ...codePaths_animation])];
```

---

## Step 4.2: Build Knowhow Manifest

构建 `knowhow-manifest.json`，声明要创建的知识资产和 spec 条目。

**Slug**: 使用 `package_name` 作为 slug（已经是 kebab-case）。

### Knowhow 资产声明

```json
{
  "slug": "${package_name}",
  "domain": "ui-design",
  "roles": ["implement", "review"],
  "packagePath": "${package_dir}",

  "knowhow": [
    {
      "prefix": "AST",
      "fileSlug": "tokens",
      "title": "${package_name} Design Tokens",
      "type": "asset",
      "assetType": "design-tokens",
      "codePaths": ["<from allCodePaths — token sources>"],
      "tags": ["design-tokens", "colors", "typography", "spacing", "${package_name}"],
      "body": "## Design Token Reference\n\nExtracted from: ${package_dir}/design-tokens.json\n\n### Colors\n<summarize color categories and count>\n\n### Typography\n<summarize font families, scale>\n\n### Spacing\n<summarize spacing scale>\n\n> Full token data: `${package_dir}/design-tokens.json`",
      "entries": [
        {
          "roles": "implement",
          "keywords": "pattern,colors,design-tokens,${package_name}",
          "title": "Color System",
          "body": "<summarize primary, secondary, accent, semantic colors with values>"
        },
        {
          "roles": "implement",
          "keywords": "pattern,typography,design-tokens,${package_name}",
          "title": "Typography Scale",
          "body": "<summarize font families, sizes, weights>"
        },
        {
          "roles": "implement",
          "keywords": "pattern,spacing,design-tokens,${package_name}",
          "title": "Spacing System",
          "body": "<summarize spacing scale values>"
        }
      ]
    },
    {
      "prefix": "AST",
      "fileSlug": "components",
      "title": "${package_name} Component Patterns",
      "type": "asset",
      "assetType": "component-patterns",
      "codePaths": ["<from allCodePaths — layout sources>"],
      "tags": ["components", "layout", "universal", "specialized", "${package_name}"],
      "body": "## Component Pattern Reference\n\nExtracted from: ${package_dir}/layout-templates.json\n\n### Universal Components (${universalComponents.length})\n<list universal component names with descriptions>\n\n### Specialized Components (${specializedComponents.length})\n<list specialized component names with descriptions>\n\n> Full component data: `${package_dir}/layout-templates.json`",
      "entries": [
        {
          "roles": "implement",
          "keywords": "pattern,universal,components,${package_name}",
          "title": "Universal Components",
          "body": "<list each universal component: name, purpose, key variants>"
        },
        {
          "roles": "implement",
          "keywords": "pattern,specialized,components,${package_name}",
          "title": "Specialized Components",
          "body": "<list each specialized component: name, purpose, usage context>"
        }
      ]
    }
  ],

  "specs": [
    {
      "roles": "implement",
      "keywords": "coding,colors,design-tokens,${package_name}",
      "title": "${package_name} 颜色编码约定",
      "ref": "knowhow/AST-${package_name}-tokens.md",
      "body": "<summarize: 主色使用 var(--color-primary)，语义色映射规则，色彩命名约定>"
    },
    {
      "roles": "implement",
      "keywords": "coding,typography,design-tokens,${package_name}",
      "title": "${package_name} 排版编码约定",
      "ref": "knowhow/AST-${package_name}-tokens.md",
      "body": "<summarize: 字体家族使用规则，字号层级，font-weight 约定>"
    },
    {
      "roles": "implement",
      "keywords": "coding,spacing,design-tokens,${package_name}",
      "title": "${package_name} 间距编码约定",
      "ref": "knowhow/AST-${package_name}-tokens.md",
      "body": "<summarize: 间距 token 使用规则，padding/margin 约定>"
    },
    {
      "roles": "plan",
      "keywords": "arch,components,classification,${package_name}",
      "title": "${package_name} 组件分类约束",
      "ref": "knowhow/AST-${package_name}-components.md",
      "body": "<summarize: universal vs specialized 分类标准，复用规则>"
    }
  ]
}
```

### Conditional: DCS Decision Asset (仅当存在冲突时)

当 `conflicts.length > 0` 时，添加以下到 knowhow 数组：

```json
{
  "prefix": "DCS",
  "fileSlug": "decisions",
  "title": "${package_name} Design Decisions",
  "type": "decision",
  "tags": ["design-decisions", "conflicts", "${package_name}"],
  "body": "## Design Conflict Decisions\n\n<for each conflict: describe token, list variants with sources, document selected value and reasoning>",
  "entries": [
    {
      "roles": "plan",
      "keywords": "decision,conflict,resolution,${package_name}",
      "title": "Token Conflict Resolutions",
      "body": "<summarize each conflict: token name, file sources, chosen value, rationale>"
    }
  ]
}
```

同时添加到 specs 数组：

```json
{
  "roles": "plan",
  "keywords": "arch,design-decisions,conflicts,${package_name}",
  "title": "${package_name} 设计决策约束",
  "ref": "knowhow/DCS-${package_name}-decisions.md",
  "body": "<summarize: 冲突解决策略，优先级规则>"
}
```

---

## Step 4.3: Write Manifest

```javascript
Write("${package_dir}/knowhow-manifest.json", JSON.stringify(manifest, null, 2));
echo "  knowhow-manifest.json written to ${package_dir}"
```

---

## Step 4.4: Call codify-to-knowhow

通过 Skill tool 调用 codify-to-knowhow：

```javascript
MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Skill("codify-to-knowhow", args="${package_dir}")
```

等待 codify-to-knowhow 完成。它将：
1. 读取 knowhow-manifest.json
2. 创建 knowhow 文件（.workflow/knowhow/AST-*.md, DCS-*.md）
3. 创建 spec 条目（.workflow/specs/coding-conventions.md, architecture-constraints.md）
4. 验证 ref 链接

---

## Step 4.5: Cleanup Temporary Workspace

```bash
# 清理临时工作区
if [ -d "${temp_dir}" ]; then
  rm -rf "${temp_dir}"
  echo "  Temp workspace cleaned: ${temp_dir}"
fi
```

---

## Step 4.6: Completion Report

```
UI Design System Codified!

Package: ${package_name}
Location: ${package_dir}

Files:
  design-tokens.json       Design tokens (colors, typography, spacing)
  layout-templates.json    Component patterns (${universalComponents.length} universal, ${specializedComponents.length} specialized)
  animation-tokens.json    ${animationTokens ? 'Animation tokens' : '(not found)'}
  preview.html             Interactive showcase
  preview.css              Showcase styling
  knowhow-manifest.json    Knowledge asset manifest

Knowledge Assets:
  AST-${package_name}-tokens.md        Design token knowhow
  AST-${package_name}-components.md    Component pattern knowhow
  ${conflicts.length > 0 ? 'DCS-' + package_name + '-decisions.md    Design decisions' : ''}

Specs: ${specCount} entries (coding: colors/typography/spacing, arch: components${conflicts.length > 0 ? '/decisions' : ''})

Open preview:
  file://${absolutePath}/preview.html

Next steps:
  maestro wiki list --category coding
  maestro spec load --keyword ${package_name}
```
