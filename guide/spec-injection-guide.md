---
title: "Spec 注入配置指南"
---

通过 keyword 颗粒度控制哪些 spec entry 注入到 agent 上下文中，支持关联额外文档、全局过滤、自定义 agent 映射。配置存储在 `.workflow/config.json` 的 `specInjection` 键中。

---

## 目录

- [概览](#概览)
- [注入流程](#注入流程)
- [配置 Schema](#配置-schema)
- [CLI 配置](#cli-配置)
- [TUI 配置](#tui-配置)
- [Dashboard 配置](#dashboard-配置)
- [使用场景](#使用场景)
- [参考](#参考)

---

## 概览

Spec 注入系统在 session 启动和 agent 创建时，自动将项目规范注入到上下文中。

核心能力：
- **keyword 级别过滤** — 仅注入/排除包含特定 keyword 的 spec entry
- **额外文档关联** — 为 category 或 agent 绑定额外的 markdown 文档
- **始终注入** — 指定无论哪种 agent 都注入的文档
- **全局过滤** — 跨所有 agent 的 keyword 白名单/黑名单

### 默认 Agent → Category 映射

| Agent Type | 默认 Categories |
|------------|-----------------|
| `code-developer` | coding, learning, ui |
| `tdd-developer` | coding, test |
| `workflow-executor` | coding |
| `universal-executor` | coding, ui |
| `test-fix-agent` | coding, test |
| `cli-lite-planning-agent` | arch |
| `action-planning-agent` | arch |
| `workflow-planner` | arch |
| `workflow-reviewer` | review |
| `debug-explore-agent` | debug |
| `workflow-debugger` | debug |
| `general` (session 启动) | coding, learning |

> 仅含 markdown 标题的空 seed 文件会被自动跳过。只有包含实质内容或 `<spec-entry>` 的文件才参与注入。

---

## 注入流程

```
Session Start / Agent Spawn
        │
        ▼
loadSpecInjectionConfig()   ← .workflow/config.json
        │
        ▼
resolveCategories()         ← config.mapping 覆盖默认映射
        │
        ▼
resolveKeywordFilters()     ← 合并 agent 级 + 全局级过滤
        │
        ▼
┌─ for each category ────────────────────┐
│  loadSpecs(category, filters)          │
│  loadExtraDocs(categoryDocs[cat])      │
│  loadWikiByCategory(category)          │
└────────────────────────────────────────┘
        │
        ▼
loadExtraDocs(always)  →  maxContentLength 截断 → context budget → 注入
```

---

## 配置 Schema

配置存储在 `.workflow/config.json` → `specInjection`：

<details>
<summary>完整 JSON Schema 示例</summary>

```json
{
  "specInjection": {
    "mapping": {
      "<agent-type>": {
        "categories": ["coding", "test"],
        "includeKeywords": ["react", "typescript"],
        "excludeKeywords": ["legacy", "deprecated"],
        "extras": [".workflow/docs/api-guide.md"]
      }
    },
    "categoryDocs": {
      "<category>": {
        "specFiles": ["api-conventions.md"],
        "docs": ["knowhow/AST-patterns.md", ".workflow/docs/style.md"]
      }
    },
    "always": [".workflow/docs/project-overview.md"],
    "keywordFilters": {
      "include": ["react", "hooks"],
      "exclude": ["deprecated"]
    },
    "maxContentLength": 8000
  }
}
```

</details>

### 字段说明

| 字段 | 作用 |
|------|------|
| `mapping.{agent}.categories` | 覆盖默认的 category 映射 |
| `mapping.{agent}.includeKeywords` | 仅注入包含这些 keyword 的 entry |
| `mapping.{agent}.excludeKeywords` | 排除包含这些 keyword 的 entry |
| `mapping.{agent}.extras` | 该 agent 额外注入的文档路径 |
| `categoryDocs.{cat}.specFiles` | 扩展 category 关联的 spec 文件 |
| `categoryDocs.{cat}.docs` | category 额外关联的文档 |
| `always` | 所有 agent 都注入的文档 |
| `keywordFilters.include` | 全局 keyword 白名单 |
| `keywordFilters.exclude` | 全局 keyword 黑名单 |
| `maxContentLength` | 截断阈值（字符数） |

### Keyword 过滤优先级

1. Agent 级 `includeKeywords` 覆盖全局 `keywordFilters.include`
2. Agent 级和全局 `excludeKeywords` 合并（取并集）
3. 先 include 过滤，再 exclude 排除

### 文档路径解析

| 路径格式 | 解析为 |
|----------|--------|
| `knowhow/AST-patterns.md` | `.workflow/knowhow/AST-patterns.md` |
| `.workflow/docs/guide.md` | `<project>/.workflow/docs/guide.md` |
| `docs/architecture.md` | `<project>/docs/architecture.md` |

---

## CLI 配置

通过 `maestro spec injection` 命令组管理配置：

### 查看配置

```bash
maestro spec injection show          # 格式化显示
maestro spec injection show --json   # 原始 JSON
```

### 配置 Agent 映射

```bash
# 设置 agent 的 categories 和 keyword 过滤
maestro spec injection agent code-developer \
  --categories coding,ui \
  --include react,typescript \
  --exclude legacy

# 删除 agent 映射（恢复默认）
maestro spec injection agent code-developer --remove
```

### 关联 Category 文档

```bash
maestro spec injection category coding \
  --spec-files api-conventions.md \
  --docs knowhow/AST-patterns.md,.workflow/docs/style.md

maestro spec injection category coding --remove
```

### 管理 Always 注入

```bash
maestro spec injection always --add .workflow/docs/overview.md
maestro spec injection always --remove .workflow/docs/overview.md
maestro spec injection always --clear
```

### 全局 Keyword 过滤

```bash
maestro spec injection filter --include react,hooks --exclude deprecated
maestro spec injection filter --clear
```

### 预览注入效果

```bash
maestro spec injection preview code-developer
maestro spec injection preview general --json
```

---

## TUI 配置

通过 `maestro config specs` 进入 TUI 面板：

| 按键 | 模式 | 功能 |
|------|------|------|
| `v` | View | 查看 spec 文件和 entry 数量 |
| `b` | Browse | keyword 颗粒度浏览所有 entry，`/` 过滤 |
| `p` | Preview | 选择 agent type 预览注入效果 |
| `c` | Config | 交互式配置编辑器 |

### Config 模式

按 `c` 进入，5 个 section 按 `1-5` 切换：

| Section | 功能 |
|---------|------|
| 1: Agent Mappings | 编辑 agent → category 映射，`a` 添加，`d` 删除 |
| 2: Category Documents | 管理 category 的 specFiles 和 docs |
| 3: Always Inject | 管理始终注入的文件路径 |
| 4: Global Filters | 管理全局 keyword 列表，`Tab` 切换 include/exclude |
| 5: Preview | 实时预览注入效果，`←/→` 切换 agent type |

所有修改即时保存到 `.workflow/config.json`。

---

## Dashboard 配置

在 Dashboard 的 **Settings → Specs** 区域：

| 功能 | 说明 |
|------|------|
| Keyword Browser | 搜索关键词，查看引用关系，Quick Bind 快速绑定 |
| Agent Mappings | 编辑 category、keyword、extras，Test 按钮预览 |
| Category Documents | 添加/删除 spec 文件和文档，Document Finder 路径建议 |
| Always Inject & Filters | 路径管理、keyword 标签编辑、maxContentLength |

---

## 使用场景

### 前端项目只注入前端相关 spec

```bash
maestro spec injection agent code-developer \
  --categories coding,ui \
  --include react,css,component,hooks \
  --exclude backend,sql,migration
```

### 为 coding category 关联 API 规范文档

```bash
echo "## API 命名规范\n\n- REST 风格..." > .workflow/docs/api-guide.md
maestro spec injection category coding --docs .workflow/docs/api-guide.md
```

### 所有 agent 注入项目架构概览

```bash
maestro spec injection always --add .workflow/docs/project-overview.md
```

### 排除已废弃的 spec entry

```bash
maestro spec injection filter --exclude deprecated,legacy,removed
```

### 预览后微调

```bash
maestro spec injection preview code-developer
maestro config specs  # TUI 交互式调整
```

---

## 参考

| 文件 | 作用 |
|------|------|
| `src/types/index.ts` | `SpecInjectionConfig` 类型定义 |
| `src/config/index.ts` | `loadSpecInjectionConfig()` / `saveSpecInjectionConfig()` |
| `src/tools/spec-loader.ts` | `loadSpecs()` keyword 过滤、`loadExtraDocs()` |
| `src/hooks/spec-injector.ts` | `evaluateSpecInjection()` 注入流程 |
| `src/commands/spec.ts` | `maestro spec injection` CLI 命令 |
| `src/tui/config-ui/SpecPanel.tsx` | TUI 四模式面板 |
| `dashboard/.../SpecsSection.tsx` | Dashboard 注入配置 UI |
| `.workflow/config.json` | 配置存储位置 |
