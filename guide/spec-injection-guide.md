# Spec 注入配置指南

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

Spec 注入系统在 session 启动和 agent 创建时，自动将项目规范注入到上下文中。默认使用 `AGENT_CATEGORY_MAP` 硬编码映射 agent-type → category，新增的注入配置系统允许你：

1. **keyword 级别过滤** — 仅注入/排除包含特定 keyword 的 spec entry
2. **额外文档关联** — 为 category 或 agent 绑定额外的 markdown 文档
3. **始终注入** — 指定无论哪种 agent 都注入的文档
4. **全局过滤** — 跨所有 agent 的 keyword 白名单/黑名单

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

### 空文件跳过

仅含 markdown 标题的空 seed 文件（如 `# Coding Conventions\n## Entries`）会被自动跳过，不注入。只有包含实质内容或 `<spec-entry>` 的文件才参与注入。

---

## 注入流程

```
Session Start / Agent Spawn
        │
        ▼
loadSpecInjectionConfig(projectPath)  ← 读取 .workflow/config.json
        │
        ▼
resolveCategories(agentType, config)  ← config.mapping 覆盖默认映射
        │
        ▼
resolveKeywordFilters(agentType, config)  ← 合并 agent 级 + 全局级过滤
        │
        ▼
┌─ for each category ──────────────────────────────────┐
│  loadSpecs(category, { includeKeywords,              │
│    excludeKeywords, extraSpecFiles })                 │
│  loadExtraDocs(config.categoryDocs[category].docs)   │
│  loadWikiByCategory(category)                         │
└──────────────────────────────────────────────────────┘
        │
        ▼
loadExtraDocs(config.mapping[agent].extras)  ← agent 专属额外文档
        │
        ▼
loadExtraDocs(config.always)  ← 始终注入文档
        │
        ▼
maxContentLength 截断 → context budget 评估 → 注入
```

---

## 配置 Schema

配置存储在 `.workflow/config.json` → `specInjection`：

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

### 字段说明

| 字段 | 作用 |
|------|------|
| `mapping.{agent}.categories` | 覆盖默认的 category 映射 |
| `mapping.{agent}.includeKeywords` | 仅注入包含这些 keyword 的 entry |
| `mapping.{agent}.excludeKeywords` | 排除包含这些 keyword 的 entry |
| `mapping.{agent}.extras` | 该 agent 额外注入的文档路径 |
| `categoryDocs.{cat}.specFiles` | 扩展 category 关联的 spec 文件 |
| `categoryDocs.{cat}.docs` | category 额外关联的文档（相对项目根或 `knowhow/` 前缀） |
| `always` | 所有 agent 都注入的文档 |
| `keywordFilters.include` | 全局 keyword 白名单 |
| `keywordFilters.exclude` | 全局 keyword 黑名单 |
| `maxContentLength` | 截断阈值（字符数），在 context budget 之前应用 |

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
# 为 coding category 添加额外文档
maestro spec injection category coding \
  --spec-files api-conventions.md \
  --docs knowhow/AST-patterns.md,.workflow/docs/style.md

# 移除 category 文档关联
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
# 查看特定 agent type 的注入结果
maestro spec injection preview code-developer
maestro spec injection preview general --json
```

---

## TUI 配置

通过 `maestro config specs` 进入 TUI 面板，有四种模式：

### 模式切换

| 按键 | 模式 | 功能 |
|------|------|------|
| `v` | View | 查看各 scope 的 spec 文件和 entry 数量 |
| `b` | Browse | keyword 颗粒度浏览所有 entry，支持 `/` 过滤 |
| `p` | Preview | 选择 agent type 预览注入效果 |
| `c` | Config | 交互式配置编辑器 |

### Config 模式（交互式编辑器）

按 `c` 进入后，有 5 个 section，按 `1-5` 切换：

**Section 1: Agent Mappings**
- 查看和编辑 agent → category 映射
- `a` 添加新 agent 映射（从预设列表选择）
- `Enter` 展开选中 agent 的子编辑器：
  - 按 `1-7` 切换 category 开关
  - 添加/删除 include/exclude keyword
  - 添加/删除 extras 文档路径
- `d` 删除选中 agent 映射

**Section 2: Category Documents**
- 查看 7 个 category 的文档关联
- `Enter` 展开添加/删除 specFiles 和 docs
- `d` 清除 category 文档配置

**Section 3: Always Inject**
- 管理始终注入的文件路径
- `a` 添加新路径，`d` 删除选中路径

**Section 4: Global Filters**
- 管理全局 include/exclude keyword 列表
- `Tab` 切换 include/exclude 子列表
- `a` 添加，`d` 删除

**Section 5: Preview**
- 实时预览注入效果
- `←/→` 切换 agent type
- 显示注入内容摘要

所有修改即时保存到 `.workflow/config.json`。

### Browse 模式

按 `b` 进入 keyword 颗粒度浏览器：

- 展示所有 scope 中的 `<spec-entry>` 列表
- 每个 entry 显示 title、category、keywords
- 选中 entry 显示内容预览
- 按 `/` 进入 keyword 过滤模式，实时匹配

---

## Dashboard 配置

在 Dashboard 的 **Settings → Specs** 区域：

### Keyword Browser

顶部的关键词浏览面板：
- 搜索框：输入关键词查找跨 agent 的引用关系
- 关键词标签：绿色=include，红色=exclude
- 点击标签查看哪些 agent 引用了它
- "Quick Bind" 按钮：快速将关键词绑定到指定 agent 的 include 列表

### Agent Mappings 编辑器

- 每个 agent 显示 category 彩色标签和 keyword 数量
- 点击展开编辑：category checkbox、keyword tag input、extras 路径列表
- "Test" 按钮：预览该 agent 的完整注入效果

### Category Documents

- 为 category 添加/删除额外的 spec 文件和文档
- Document Finder：路径输入带常用目录建议（`.workflow/docs/`、`knowhow/` 等）
- 路径验证指示器

### Always Inject & Global Filters

- 路径列表管理
- Include/exclude keyword 标签编辑
- maxContentLength 数值输入

---

## 使用场景

### 场景 1：前端项目只注入前端相关 spec

```bash
# code-developer 只注入包含 react/css/component 的 entry
maestro spec injection agent code-developer \
  --categories coding,ui \
  --include react,css,component,hooks \
  --exclude backend,sql,migration
```

### 场景 2：为 coding category 关联 API 规范文档

```bash
# 创建 API 规范文档
echo "## API 命名规范\n\n- REST 风格..." > .workflow/docs/api-guide.md

# 关联到 coding category
maestro spec injection category coding \
  --docs .workflow/docs/api-guide.md
```

### 场景 3：所有 agent 都注入项目架构概览

```bash
maestro spec injection always --add .workflow/docs/project-overview.md
```

### 场景 4：排除已废弃的 spec entry

```bash
# 全局排除标记了 deprecated 的 entry
maestro spec injection filter --exclude deprecated,legacy,removed
```

### 场景 5：预览配置效果后微调

```bash
# 预览当前配置对 code-developer 的注入效果
maestro spec injection preview code-developer

# 在 TUI 中交互式调整
maestro config specs  # 按 c 进入 Config，按 5 切 Preview
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
