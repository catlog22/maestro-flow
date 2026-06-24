---
name: codify-to-knowhow
description: Manifest-driven knowledge asset generator — converts any structured package into maestro knowhow + spec entries with ref linking. Triggers on "codify-to-knowhow", "style to knowhow", "知识固化".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, TodoWrite
auto-continue: true
---

# Codify to Knowhow

通用 manifest 驱动的知识资产生成器。读取 `knowhow-manifest.json`，按声明创建 knowhow 文件和 spec 条目，通过 ref 建立索引-详文桥梁。

**适用场景**: 任何工作流产出需要固化为知识资产时使用。上游 skill（如 `maestro-ui-codify`）负责生成 manifest，本 skill 负责执行知识写入。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Codify to Knowhow (SKILL.md) — Manifest-Driven            │
│  → Read manifest → Create knowhow → Create specs → Verify  │
└──────────────────────────┬──────────────────────────────────┘
                           │
    ┌──────────┬───────────┼───────────┬──────────┐
    ↓          ↓           ↓           ↓          │
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│Phase 1 │ │Phase 2 │ │Phase 3 │ │Phase 4 │      │
│ Load   │ │Generate│ │Generate│ │ Index  │      │
│Manifest│ │Knowhow │ │ Specs  │ │ Verify │      │
└───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘      │
    │          │          │          │             │
 manifest   AST-/DCS-  spec-entry  verified       │
 parsed     files       + ref       assets        │
```

## Key Design Principles

1. **Manifest 驱动**: 所有行为由 `knowhow-manifest.json` 声明，不含硬编码领域知识
2. **幂等执行**: 每个写入前按 slug 检查已存在资产，存在则跳过
3. **ref 桥梁**: spec-entry 通过 `ref` 引用 knowhow 详文
4. **闭合标签**: 所有条目使用 `<spec-entry>`/`<knowhow-entry>` 闭合标签
5. **上游生成 manifest**: 本 skill 不做知识提取，只做知识写入

## Manifest Format

`knowhow-manifest.json` 由上游 skill 生成，放在 package 目录中：

```json
{
  "slug": "my-style-v1",
  "domain": "ui-design",
  "roles": ["implement", "review"],
  "packagePath": ".workflow/reference_style/my-style-v1",

  "knowhow": [
    {
      "prefix": "AST",
      "fileSlug": "tokens",
      "title": "Design Tokens",
      "category": "asset",
      "assetType": "design-tokens",
      "codePaths": ["src/styles/"],
      "tags": ["design-tokens", "colors"],
      "entries": [
        {
          "category": "pattern",
          "keywords": "colors,tokens",
          "title": "Color System",
          "body": "## Colors\n\n..."
        }
      ]
    }
  ],

  "specs": [
    {
      "category": "coding",
      "keywords": "colors,design-tokens",
      "title": "颜色编码约定",
      "ref": "knowhow/AST-my-style-v1-tokens.md",
      "body": "主色使用 var(--color-primary)..."
    }
  ]
}
```

## Execution Flow

```
Input: <package-path> (must contain knowhow-manifest.json)

Phase 1: Load and Validate Manifest
   └─ Ref: phases/01-load-manifest.md
      ├─ Validate package path and manifest existence
      ├─ Parse knowhow-manifest.json
      └─ Output: manifest object

Phase 2: Generate Knowhow Assets
   └─ Ref: phases/02-generate-knowhow.md
      ├─ Idempotency check per file
      ├─ Write knowhow files per manifest.knowhow[]
      └─ Output: knowhowPaths[]

Phase 3: Generate Spec Entries
   └─ Ref: phases/03-generate-specs.md
      ├─ Idempotency check per entry
      ├─ Write spec entries per manifest.specs[]
      └─ Output: specEntryCount

Phase 4: Index and Verify
   └─ Ref: phases/04-index-verify.md
      └─ Output: verification report
```

**Phase Reference Documents**:

| Phase | Document | Purpose |
|-------|----------|---------|
| 1 | [phases/01-load-manifest.md](phases/01-load-manifest.md) | Load and validate manifest |
| 2 | [phases/02-generate-knowhow.md](phases/02-generate-knowhow.md) | Create knowhow files |
| 3 | [phases/03-generate-specs.md](phases/03-generate-specs.md) | Create spec entries with ref |
| 4 | [phases/04-index-verify.md](phases/04-index-verify.md) | Verify assets and index |

## Core Rules

1. **Manifest 必需**: 无 manifest 则报错退出
2. **幂等写入**: 同 slug 文件存在则跳过
3. **闭合标签**: 所有 entry 使用闭合标签格式
4. **Auto-Continue**: Phase 完成后自动执行下一 Phase
5. **不提取知识**: 本 skill 只写入，知识提取由上游完成

## Data Flow

```
Input (packagePath)
    ↓
Phase 1 → manifest: { slug, knowhow[], specs[] }
    ↓
Phase 2 → knowhowPaths: string[], knowhowIds: string[]
    ↓
Phase 3 → specEntryCount: number
    ↓
Phase 4 → verificationResult
    ↓
Completion report
```

## TodoWrite Pattern

```json
[
  {"content": "Phase 1: 加载 Manifest", "status": "in_progress"},
  {"content": "Phase 2: 生成 Knowhow 资产", "status": "pending"},
  {"content": "Phase 3: 生成 Spec 条目", "status": "pending"},
  {"content": "Phase 4: 索引验证", "status": "pending"}
]
```

## Error Handling

- **Manifest 不存在**: 报告错误，提示上游 skill 需先生成 manifest
- **Manifest 格式错误**: 报告缺失字段
- **幂等冲突**: 跳过已存在资产，报告跳过数量
- **CLI 失败**: 回退到 Write tool 直接写文件

## Related Commands

**上游**: `maestro-ui-codify`, `learn-decompose`, 或任何生成 manifest 的 skill
**后续**: `maestro wiki list --category coding`, `maestro load --type spec --keyword <slug>`
