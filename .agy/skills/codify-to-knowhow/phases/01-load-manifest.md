# Phase 1: Load and Validate Manifest

读取和验证 `knowhow-manifest.json`。

## Objective

- 验证 package path 存在
- 验证 `knowhow-manifest.json` 存在并可解析
- 提取 manifest 结构供后续 phase 使用

## Execution

### Step 1.1: Validate Package Path

```bash
package_path="${PACKAGE_PATH}"

# 验证目录存在
test -d "$package_path" || { echo "ERROR: Package path not found: $package_path"; exit 1; }

# 验证 manifest 存在
manifest_file="${package_path}/knowhow-manifest.json"
test -f "$manifest_file" || { echo "ERROR: knowhow-manifest.json not found in $package_path"; exit 1; }

echo "Package: $package_path"
echo "Manifest: $manifest_file"
```

### Step 1.2: Read and Parse Manifest

```javascript
view_file("${package_path}/knowhow-manifest.json")
```

**必需字段验证**:

| 字段 | 必需 | 说明 |
|------|------|------|
| `slug` | 是 | 包名 slug，用于文件命名 |
| `roles` | 是 | 角色标注数组 |
| `knowhow` | 是 | knowhow 资产声明数组（可为空） |
| `specs` | 是 | spec 条目声明数组（可为空） |
| `domain` | 否 | 领域标识（如 ui-design, api, data） |
| `packagePath` | 否 | 原始包路径（元数据） |

**knowhow[] 每项必需字段**:

| 字段 | 说明 |
|------|------|
| `prefix` | 文件前缀: AST, DCS, BLP, TIP, RCP, REF 等 |
| `fileSlug` | 文件名后缀（如 "tokens" → AST-{slug}-tokens.md） |
| `title` | 文档标题 |
| `category` | knowhow 类别: asset, decision, blueprint, tip, recipe, reference |
| `tags` | 标签数组 |
| `body` | Markdown 正文内容 |

**可选字段**: `assetType`, `codePaths`, `entries[]`（`<knowhow-entry>` 子条目）

**specs[] 每项必需字段**:

| 字段 | 说明 |
|------|------|
| `category` | spec 类别: coding, arch, quality, debug, test, review, learning |
| `title` | 条目标题 |
| `keywords` | 关键词（逗号分隔字符串） |
| `body` | 条目正文 |

**可选字段**: `ref`（引用 knowhow 文件路径）

### Step 1.3: Validate and Summarize

```javascript
const manifest = JSON.parse(manifestContent);

// 必需字段检查
const required = ['slug', 'roles', 'knowhow', 'specs'];
const missing = required.filter(f => !manifest[f]);
if (missing.length > 0) {
  REPORT("ERROR: Missing required fields: " + missing.join(', '));
  EXIT(1);
}

// 摘要
REPORT(`Manifest loaded:
  Slug: ${manifest.slug}
  Domain: ${manifest.domain || 'generic'}
  Roles: ${manifest.roles.join(', ')}
  Knowhow assets: ${manifest.knowhow.length}
  Spec entries: ${manifest.specs.length}
`);
```

## Output

- **Variable**: `manifest` — 解析后的 manifest 对象
- **Variable**: `slug` — `manifest.slug`
- **TodoWrite**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 2: Generate Knowhow](02-generate-knowhow.md).
