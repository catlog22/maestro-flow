# Phase 3: Generate Spec Entries

按 `manifest.specs[]` 声明写入 spec 条目。

## Objective

- 遍历 `manifest.specs[]` 数组
- 每个条目追加到对应的 spec 文件
- 幂等：同 title 的条目已存在则跳过
- 使用 `<spec-entry>` 闭合标签格式

## Execution

### Step 3.1: Idempotency Check

对每个 spec 条目，检查是否已存在同 title 的 entry：

```bash
# 按 keyword 搜索
maestro load --type spec --keyword "${manifest.slug}" --json 2>/dev/null | head -5
```

### Step 3.2: Iterate and Write

对 `manifest.specs[]` 中的每一项执行：

```javascript
const today = new Date().toISOString().split('T')[0];
let specEntryCount = 0;

for (const spec of manifest.specs) {
  // spec.category 决定目标文件
  const categoryFileMap = {
    coding: 'coding-conventions.md',
    arch: 'architecture-constraints.md',
    quality: 'quality-rules.md',
    debug: 'debug-notes.md',
    test: 'test-conventions.md',
    review: 'review-standards.md',
    learning: 'learnings.md'
  };

  const targetFile = `.workflow/specs/${categoryFileMap[spec.category]}`;

  // 幂等检查：grep title 是否已存在
  const titleExists = Bash(`grep -q "${spec.title}" "${targetFile}" 2>/dev/null && echo "exists" || echo "new"`);

  if (titleExists.trim() === 'exists') {
    REPORT(`SKIP spec: "${spec.title}" (already exists in ${spec.category})`);
    continue;
  }

  // 构建 spec-entry 闭合标签
  let refAttr = '';
  if (spec.ref) {
    refAttr = `\n  ref="${spec.ref}"`;
  }

  const entryBlock = `

<spec-entry category="${spec.category}" keywords="${spec.keywords}" date="${today}"${refAttr}>

### ${spec.title}

${spec.body}

</spec-entry>`;

  // 追加到目标文件
  // 优先使用 maestro spec add CLI
  const descFlag = spec.description ? ` --description "${spec.description}"` : '';
  const cliResult = Bash(`maestro spec add ${spec.category} "${spec.title}" "${spec.body}" --keywords "${spec.keywords}"${descFlag} 2>/dev/null`);

  if (cliResult.exitCode !== 0) {
    // 回退：直接追加到文件
    Edit(targetFile, { append: entryBlock });
  }

  specEntryCount++;
  REPORT(`CREATED spec: "${spec.title}" → ${spec.category}`);
}

REPORT(`Spec entries: ${specEntryCount} created`);
```

## Output

- **Variable**: `specEntryCount` — 创建的 spec 条目数量
- **TodoWrite**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 4: Index and Verify](04-index-verify.md).
