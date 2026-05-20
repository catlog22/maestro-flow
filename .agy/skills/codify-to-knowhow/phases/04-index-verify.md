# Phase 4: Index and Verify

刷新 wiki 索引，验证所有创建的资产已正确索引和链接。

## Objective

- 刷新 wiki-index.json 以包含新创建的资产
- 验证 knowhow 文件存在并已索引
- 验证 spec 条目已写入
- 验证 ref 链接从 spec 指向 knowhow
- 输出完成报告

## Execution

### Step 4.1: Refresh Wiki Index

触发 wiki 索引刷新以识别新增的 knowhow 文件：

```bash
# 刷新 wiki 索引
maestro wiki health 2>/dev/null || echo "Wiki index refresh skipped (command not available)"
```

索引刷新确保 `wiki-index.json` 包含新创建的 AST-/DCS- 文件的 WikiEntry。

### Step 4.2: Verify Knowhow Files

检查所有预期的 knowhow 文件是否存在：

```bash
echo "=== Knowhow 资产验证 ==="

# 必需文件
for file in ${knowhowPaths}; do
  if test -f "$file"; then
    echo "  OK: $file"
  else
    echo "  MISSING: $file"
  fi
done
```

### Step 4.3: Verify Spec Entries

检查 spec 文件中是否包含新增的条目：

```bash
echo "=== Spec 条目验证 ==="

# 检查 coding-conventions.md 中是否含 slug 相关条目
grep -c "${slug}" .workflow/specs/coding-conventions.md 2>/dev/null && \
  echo "  OK: coding-conventions.md (${slug} entries found)" || \
  echo "  MISSING: No ${slug} entries in coding-conventions.md"

# 检查 architecture-constraints.md 中是否含 slug 相关条目
grep -c "${slug}" .workflow/specs/architecture-constraints.md 2>/dev/null && \
  echo "  OK: architecture-constraints.md (${slug} entries found)" || \
  echo "  MISSING: No ${slug} entries in architecture-constraints.md"
```

### Step 4.4: Verify Ref Links

检查 spec 条目中的 ref 属性指向的 knowhow 文件是否存在：

```bash
echo "=== Ref 链接验证 ==="

# 从 spec 文件中提取 ref 属性值
refs=$(grep -oP 'ref="knowhow/[^"]*"' .workflow/specs/coding-conventions.md .workflow/specs/architecture-constraints.md 2>/dev/null | grep "${slug}" || true)

if [ -n "$refs" ]; then
  echo "$refs" | while IFS= read -r ref; do
    # 提取文件路径
    filepath=$(echo "$ref" | grep -oP 'knowhow/[^"]*')
    if test -f ".workflow/$filepath"; then
      echo "  OK: $filepath"
    else
      echo "  BROKEN: $filepath (file not found)"
    fi
  done
else
  echo "  WARNING: No ref links found for ${slug}"
fi
```

### Step 4.5: Generate Completion Report

```
=== Codify to Knowhow 完成 ===

包: {slug}
来源: {packagePath}

Knowhow 资产:
  AST-{slug}-tokens.md       — 设计 token 资产
  AST-{slug}-components.md   — 组件模式资产
  DCS-{slug}-decisions.md    — 设计决策 {仅当有冲突}

Spec 条目 ({specEntryCount} 条):
  coding: 颜色约定, 排版约定, 间距约定
  arch: 组件分类约束{, 设计决策约束 — 仅当有冲突}

Ref 链接: spec → knowhow 桥梁已建立
Wiki 索引: 已刷新

后续操作:
  maestro wiki list --category coding    # 按角色浏览
  maestro spec load --keyword {slug}    # 加载相关 spec
  maestro wiki load <id>                # 加载详文
```

## Output

- **Report**: 验证结果（所有资产/条目/链接状态）
- **TodoWrite**: Mark Phase 4 completed (all tasks done)

## Completion

Codify to Knowhow 已完成。设计包已固化为知识资产。
