<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# UI Codify: Phase 4 — Knowledge Candidate Generation

读取提取的 JSON 文件，构建 knowhow-manifest.json，并按 manifest 暂存 knowhow/spec 候选；只有 seal 后的显式 promotion 才会创建语料资产。

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

构建 `knowhow-manifest.json`，声明要暂存的 knowhow/spec 候选。

**Slug**: 使用 `package_name` 作为 slug（已经是 kebab-case）。

### Knowhow 候选声明

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
      "category": "ui",
      "relatedPaths": ["<from allCodePaths — token sources>"],
      "keywords": ["asset:design-tokens", "design-tokens", "colors", "typography", "spacing", "${package_name}"],
      "content": "## Design Token Reference\n\nExtracted from: ${package_dir}/design-tokens.json\n\n### Colors\n<summarize color categories and count>\n\n### Typography\n<summarize font families, scale>\n\n### Spacing\n<summarize spacing scale>\n\n> Full token data: `${package_dir}/design-tokens.json`",
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
      "category": "ui",
      "relatedPaths": ["<from allCodePaths — layout sources>"],
      "keywords": ["asset:component-patterns", "components", "layout", "universal", "specialized", "${package_name}"],
      "content": "## Component Pattern Reference\n\nExtracted from: ${package_dir}/layout-templates.json\n\n### Universal Components (${universalComponents.length})\n<list universal component names with descriptions>\n\n### Specialized Components (${specializedComponents.length})\n<list specialized component names with descriptions>\n\n> Full component data: `${package_dir}/layout-templates.json`",
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
      "category": "coding",
      "roles": "implement",
      "keywords": "coding,colors,design-tokens,${package_name}",
      "title": "${package_name} 颜色编码约定",
      "evidence": "${package_dir}/design-tokens.json",
      "body": "<summarize: 主色使用 var(--color-primary)，语义色映射规则，色彩命名约定>"
    },
    {
      "category": "coding",
      "roles": "implement",
      "keywords": "coding,typography,design-tokens,${package_name}",
      "title": "${package_name} 排版编码约定",
      "evidence": "${package_dir}/design-tokens.json",
      "body": "<summarize: 字体家族使用规则，字号层级，font-weight 约定>"
    },
    {
      "category": "coding",
      "roles": "implement",
      "keywords": "coding,spacing,design-tokens,${package_name}",
      "title": "${package_name} 间距编码约定",
      "evidence": "${package_dir}/design-tokens.json",
      "body": "<summarize: 间距 token 使用规则，padding/margin 约定>"
    },
    {
      "category": "arch",
      "roles": "plan",
      "keywords": "arch,components,classification,${package_name}",
      "title": "${package_name} 组件分类约束",
      "evidence": "${package_dir}/layout-templates.json",
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
  "category": "arch",
  "keywords": ["design-decisions", "conflicts", "${package_name}"],
  "content": "## Design Conflict Decisions\n\n<for each conflict: describe token, list variants with sources, document selected value and reasoning>",
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
  "category": "arch",
  "roles": "plan",
  "keywords": "arch,design-decisions,conflicts,${package_name}",
  "title": "${package_name} 设计决策约束",
  "evidence": "${package_dir}/design-tokens.json",
  "body": "<summarize: 冲突解决策略，优先级规则>"
}
```

**引用不变量**：此时 knowhow 仍是候选，不存在可声明的 canonical Knowhow 文件路径/ID。manifest 不得根据 `prefix`、`fileSlug` 或 `package_name` 拼出 `knowhow/*.md`，spec 正文也不得写入这种预测路径。若尚未从已晋升语料的 JSON 结果取得真实 canonical target，则 spec 候选只暂存 `body`，把互链推迟到 promotion 返回真实 ID/path 之后。

---

## Step 4.3: Write Manifest

```javascript
Write("${package_dir}/knowhow-manifest.json", JSON.stringify(manifest, null, 2));
echo "  knowhow-manifest.json written to ${package_dir}"
```

---

## Step 4.4: Stage Knowledge Candidates（manifest 驱动，走治理管道）

读取 knowhow-manifest.json，按声明**经 `maestro knowledge stage` 暂存候选**（codify-to-knowhow 已并入本步骤，不再调用独立 skill）。`.workflow/knowhow/` 与 `.workflow/specs/` 是受治理语料，唯一写入口是 post-seal `maestro knowledge promote` —— **本步骤绝不直接 Write 语料文件**：

```javascript
// 1. 读取 manifest；所有 stage 都要求 --json，并把完整 JSON 与 candidate_id 写入结果文件。
const manifest = JSON.parse(Read("${package_dir}/knowhow-manifest.json"));
const stageReport = {
  $schema: "ui-codify-knowledge-stage/1.0",
  candidates: [],
  failures: [],
  existing_title_skips: [],
};
let attemptedStageCount = 0;

// shellQuote 必须对每个动态 argv 值做平台安全转义；不得拼接未转义 manifest 数据。
// hasExactCorpusTitle 必须解析 search JSON 的条目 title 并做 exact match；不得用 substring 或“出现 id”代替。
// prefix 与 ordinal 是工作流生成值；basename 绝不使用 title/fileSlug/ref/path 等 manifest 数据.
function safeTempPath(prefix, ordinal) {
  return `${temp_dir}/${prefix}-${String(ordinal + 1).padStart(4, '0')}.md`;
}

function stageAndCapture(kind, title, args) {
  attemptedStageCount += 1;
  let raw = null;
  try {
    raw = Bash([...args, "--json"].join(" "));
    const output = JSON.parse(raw);
    if (typeof output.candidate_id !== "string" || !/^KDC-[a-f0-9]{16}$/.test(output.candidate_id)) {
      throw new Error("stage JSON missing a valid candidate_id");
    }
    stageReport.candidates.push({ kind, title, candidate_id: output.candidate_id, output });
  } catch (error) {
    stageReport.failures.push({ kind, title, error: String(error), raw_output: raw });
    echo(`[LOW CONFIDENCE] ${kind} stage failed or returned no candidate_id: ${title}`);
  }
}

// 2. knowhow 候选 —— 幂等（语料库中同标题已存在则跳过），逐字段无损 stage。
for (const [index, kh] of (manifest.knowhow || []).entries()) {
  const title = kh.title;
  const searchOutput = JSON.parse(Bash(`maestro wiki search ${shellQuote(title)} --json`));
  if (hasExactCorpusTitle(searchOutput, title)) {
    stageReport.existing_title_skips.push({ kind: "knowhow", title });
    echo(`  SKIP (already promoted): ${title}`);
    continue;
  }

  const tmp = safeTempPath("knowhow", index);
  Write(tmp, kh.content); // 原样保留 content；不从 entries/relatedPaths 重建正文。
  const evidence = (kh.relatedPaths || [])[0] || `${package_dir}/knowhow-manifest.json`;
  stageAndCapture("knowhow", title, [
    `maestro knowledge stage knowhow ${shellQuote(title)}`,
    `--content-file ${shellQuote(tmp)}`,
    `--type ${shellQuote(kh.type)}`,
    `--category ${shellQuote(kh.category)}`,
    `--keywords ${shellQuote((kh.keywords || []).join(','))}`,
    ...(kh.relatedPaths || []).map(p => `--related-path ${shellQuote(p)}`),
    `--evidence ${shellQuote(evidence)}`,
  ]);
}

// 3. spec 候选 —— promote 时才会以 <spec-entry> 形态落入 canonical conventions 文件。
for (const [index, sp] of (manifest.specs || []).entries()) {
  const title = sp.title;
  const searchOutput = JSON.parse(Bash(`maestro spec search ${shellQuote(title)} --json`));
  if (hasExactCorpusTitle(searchOutput, title)) {
    stageReport.existing_title_skips.push({ kind: "spec", title });
    echo(`  SKIP (already promoted): ${title}`);
    continue;
  }

  const tmp = safeTempPath("spec", index);
  Write(tmp, sp.body); // 未 promotion 时不拼接或伪造 knowhow ref。
  stageAndCapture("spec", title, [
    `maestro knowledge stage spec ${shellQuote(title)}`,
    `--content-file ${shellQuote(tmp)}`,
    `--category ${shellQuote(sp.category)}`,
    `--keywords ${shellQuote(sp.keywords || '')}`,
    `--evidence ${shellQuote(sp.evidence || `${package_dir}/knowhow-manifest.json`)}`,
  ]);
}

// 4. 只统计已验证 candidate_id 的成功 stage；持久化每次 stage 的 JSON/失败信息后再报告。
stageReport.counts = {
  attempted: attemptedStageCount,
  staged: stageReport.candidates.length,
  knowhow: stageReport.candidates.filter(x => x.kind === "knowhow").length,
  specs: stageReport.candidates.filter(x => x.kind === "spec").length,
  failed: stageReport.failures.length,
  existing_title_skips: stageReport.existing_title_skips.length,
};
Write("${package_dir}/knowledge-stage-results.json", JSON.stringify(stageReport, null, 2));

if (stageReport.failures.length > 0) {
  echo(`[LOW CONFIDENCE] ${stageReport.failures.length} stage operation(s) returned no usable candidate_id`);
}
if (attemptedStageCount > 0 && stageReport.candidates.length === 0) {
  throw new Error("Phase 4 BLOCKED: staging was attempted but no candidate IDs were captured");
}
echo(`  Knowledge candidates staged successfully: ${stageReport.counts.staged}`);
```

写入规范：
1. knowhow/spec 候选一律 `--content-file`（绝不 inline）；`--evidence` 必须指向真实关联代码/包文件，不得用预测的 Knowhow 路径
2. 临时文件 basename 只能由固定前缀 + loop ordinal 生成；不得把 `title`、`fileSlug`、`ref`、代码路径或任何 manifest 字段嵌入 basename
3. 每个 `knowledge stage` 必须带 `--json`，解析并验证 `candidate_id`，把完整 JSON 记录到 `knowledge-stage-results.json`；只有验证成功的 ID 才计入 staged 数量
4. 任一 stage 失败、JSON 无效或缺少 candidate ID → 记录 failure 并标记 `[LOW CONFIDENCE]`；若尝试过 staging 但成功数为 0 → Phase 4 BLOCKED，不得输出成功完成消息
5. knowhow stage 必须原样保留 manifest 的 `content`，并分别通过 canonical `--keywords`、repeatable `--related-path`、`--category` 传递 metadata；不得从 `entries` 重建正文、硬编码 category 或改写 title
6. 所有动态 CLI 参数必须进行 argv-safe 转义，避免空格/引号/路径破坏命令
7. 幂等以解析 JSON 后的语料库 exact-title match 为准；已晋升条目只记入 `existing_title_skips`，不冒充本次 staged candidate
8. promotion 前只报告 candidate IDs。只有 promotion JSON 返回真实 canonical ID/path 后才能报告语料资产并补充 Spec → Knowhow 链接
9. 候选晋升走常规双源门禁（sealed + fresh receipt），本步骤不 promote

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
  design-tokens.json             Design tokens (colors, typography, spacing)
  layout-templates.json          Component patterns (${universalComponents.length} universal, ${specializedComponents.length} specialized)
  animation-tokens.json          ${animationTokens ? 'Animation tokens' : '(not found)'}
  preview.html                   Interactive showcase
  preview.css                    Showcase styling
  knowhow-manifest.json          Knowledge candidate manifest
  knowledge-stage-results.json   Captured stage JSON, candidate IDs, skips, and failures

Knowledge Candidates (staged successfully; not promoted corpus assets):
  Knowhow candidate IDs: ${stageReport.candidates.filter(x => x.kind === 'knowhow').map(x => x.candidate_id).join(', ') || '(none)'}
  Spec candidate IDs: ${stageReport.candidates.filter(x => x.kind === 'spec').map(x => x.candidate_id).join(', ') || '(none)'}
  Successful: ${stageReport.counts.staged}; failed: ${stageReport.counts.failed}; already-promoted title skips: ${stageReport.counts.existing_title_skips}
  Confidence: ${stageReport.counts.failed > 0 ? '[LOW CONFIDENCE] stage failures recorded' : stageReport.counts.attempted === 0 ? 'no staging needed (exact-title skips only)' : 'candidate capture verified'}

Canonical Knowhow paths / Spec links: deferred until promotion returns actual targets; none are fabricated here.

Open preview:
  file://${absolutePath}/preview.html

Next steps:
  seal → `maestro knowledge review <session-id> --refresh` → resolve → explicit promote
  after promotion, use only returned canonical IDs/paths when adding Spec → Knowhow links
```
