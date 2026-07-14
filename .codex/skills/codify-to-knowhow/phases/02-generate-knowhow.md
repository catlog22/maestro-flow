# Phase 2: Generate Knowhow Assets

按 `manifest.knowhow[]` 声明创建 knowhow 文件。

## Objective

- 遍历 `manifest.knowhow[]` 数组
- 每个条目生成对应的 knowhow 文件
- 幂等：同名文件存在则跳过

## Execution

### Step 2.1: Ensure Directory

```bash
mkdir -p .workflow/knowhow
```

### Step 2.2: Iterate and Write

对 `manifest.knowhow[]` 中的每一项执行：

```javascript
for (const asset of manifest.knowhow) {
  const filename = `${asset.prefix}-${manifest.slug}-${asset.fileSlug}.md`;
  const filepath = `.workflow/knowhow/${filename}`;

  // 幂等检查
  if (fileExists(filepath)) {
    REPORT(`SKIP: ${filename} (already exists)`);
    continue;
  }

  // 构建 frontmatter
  let frontmatter = `---
title: ${asset.title}
type: ${asset.category}`;

  if (asset.assetType) {
    frontmatter += `\nassetType: ${asset.assetType}`;
  }

  frontmatter += `\nroles: [${manifest.roles.join(', ')}]`;

  if (asset.codePaths && asset.codePaths.length > 0) {
    frontmatter += `\ncodePaths:`;
    for (const cp of asset.codePaths) {
      frontmatter += `\n  - ${cp}`;
    }
  }

  frontmatter += `\ntags: [${asset.tags.join(', ')}]`;
  frontmatter += `\n---`;

  // 构建 body
  let body = asset.body || '';

  // 如果有 entries[]，生成 <knowhow-entry> 闭合标签
  if (asset.entries && asset.entries.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    for (let i = 0; i < asset.entries.length; i++) {
      const entry = asset.entries[i];
      const entryId = `${asset.prefix}-${manifest.slug}-${String(i + 1).padStart(3, '0')}`;
      body += `\n\n<knowhow-entry keywords="${entry.category},${entry.keywords}" date="${today}" id="${entryId}" roles="${manifest.roles.join(',')}" source="codify-to-knowhow">

### ${entry.title}

${entry.body}

</knowhow-entry>`;
    }
  }

  const content = `${frontmatter}\n\n${body}`;
  Write(filepath, content);
  REPORT(`CREATED: ${filename}`);
  knowhowPaths.push(filepath);
}
```

### Step 2.3: Collect Results

```javascript
const knowhowPaths = []; // 已创建的文件路径
const skippedCount = manifest.knowhow.length - knowhowPaths.length;

REPORT(`Knowhow assets: ${knowhowPaths.length} created, ${skippedCount} skipped`);
```

## Output

- **Variable**: `knowhowPaths` — 已创建的文件路径列表
- **update_plan**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Generate Specs](03-generate-specs.md).
