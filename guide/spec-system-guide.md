# 知识管理系统指南

Maestro 的知识管理系统由 **Spec**（编码规范/约束）和 **Wiki**（广谱知识图谱）两层构成。Spec 提供按 category 分类的项目规范，Wiki 提供含 knowhow、设计资产、学习笔记在内的全域知识索引。两层通过统一的 `<entry>` 标签格式、WikiIndexer 索引、和 role 角色化检索实现深度集成。

## 目录

- [Spec 系统](#spec-系统)
  - [Scope 体系](#scope-体系)
  - [Category 体系](#category-体系)
  - [Entry 格式](#entry-格式)
  - [命令](#spec-命令)
  - [渐进填充](#渐进填充)
  - [Auto-Init](#auto-init)
  - [Keyword 系统](#keyword-系统)
- [Wiki 知识图谱](#wiki-知识图谱)
  - [Knowhow 体系](#knowhow-体系)
  - [Role 角色化检索](#role-角色化检索)
  - [三层加载设计](#三层加载设计)
  - [Wiki 命令](#wiki-命令)
- [统一索引与注入](#统一索引与注入)
  - [原子节点索引](#原子节点索引)
  - [写入路径](#写入路径)
  - [写保护模型](#写保护模型)
  - [自动注入机制](#自动注入机制)
  - [Session Dedup](#session-dedup)
- [文件结构](#文件结构)
- [CLI 参考](#cli-参考)

---

## Spec 系统

### Scope 体系

Spec 支持 4 种作用域，通过 `--scope` 参数指定：

| Scope | 目录 | 用途 | Auto-Init |
|-------|------|------|-----------|
| `project`（默认） | `.workflow/specs/` | 项目级规范，所有人共享 | 是（需 `.workflow/` 存在） |
| `global` | `~/.maestro/specs/` | 跨项目通用规范 | 是（无条件） |
| `team` | `.workflow/collab/specs/` | 团队共享规范 | 否 |
| `personal` | `.workflow/collab/specs/{uid}/` | 个人偏好覆盖 | 否 |

**加载优先级**（低 → 高）：global → project → team → personal。后层内容追加，不覆盖。

### Category 体系

Category 1:1 对应文件：

| Category | 文件 | 用途 |
|----------|------|------|
| `coding` | `coding-conventions.md` | 命名、导入、格式化、编码模式 |
| `arch` | `architecture-constraints.md` | 模块结构、层级边界、架构决策 |
| `quality` | `quality-rules.md` | 质量规则、lint 配置、强制标准 |
| `debug` | `debug-notes.md` | 调试技巧、根因记录、已知问题 |
| `test` | `test-conventions.md` | 测试框架、模式、覆盖率要求 |
| `review` | `review-standards.md` | 审查清单、质量门槛 |
| `learning` | `learnings.md` | Bug、陷阱、经验教训 |

**扩展类型**（无独立文件，通过 `<spec-entry category="...">` 标记）：`bug`、`pattern`、`decision`、`rule`、`validation`

### Entry 格式

所有条目使用 `<spec-entry>` 闭合标签：

```markdown
<spec-entry category="coding" keywords="auth,token,rotation" date="2026-04-21">

### Token rotation needs email carried through refresh flow

Revoked column must be set rather than deleting tokens.

</spec-entry>
```

| 属性 | 必填 | 格式 | 说明 |
|------|------|------|------|
| `category` | 是 | 有效值之一 | 匹配所在文件的 category |
| `keywords` | 是 | 逗号分隔，小写 | 可搜索关键词 |
| `date` | 是 | `YYYY-MM-DD` | 创建日期 |
| `source` | 否 | 字符串 | 来源（manual / agent） |

### Spec 命令

```bash
# 初始化
/spec-setup                                     # 扫描项目，生成 spec 文件

# 添加条目
/spec-add coding "Always use named exports"     # 项目级
/spec-add --scope global arch "Use gRPC"        # 全局级

# 加载
/spec-load --category coding                    # 按 category
/spec-load --keyword auth                       # 按 keyword
/spec-load --role implement                     # 含 wiki role 知识（新增）

# CLI 等价
maestro spec add <category> "<title>" "<content>" --keywords kw1,kw2
maestro spec load --category coding --keyword auth --json
```

### 渐进填充

Spec 由 pipeline 各阶段渐进补充：

```
maestro-init       → spec-setup（骨架 + 扫描）
maestro-analyze    → Locked 决策 → arch，代码模式 → coding
maestro-plan       → 设计约定 → coding/arch，测试策略 → test
maestro-execute    → learnings → learning，根因 → debug
maestro-verify     → quality 发现 → quality
```

### Auto-Init

`loadSpecs()` 自动检测并创建缺失的 spec 目录（含 7 个 seed 文件），无需手动 init。

### Keyword 系统

- `spec-add` 时自动提取 3-5 个领域关键词
- `spec-load --keyword <kw>` 按 `<spec-entry>` 的 `keywords` 属性精确匹配
- 旧格式 heading 条目 fallback 到文本搜索

---

## Wiki 知识图谱

### Knowhow 体系

Knowhow 是广谱知识存储，支持多种文档类型。所有文件存储在 `.workflow/knowhow/`，通过文件名前缀区分类别：

| 前缀 | Category | 用途 |
|------|----------|------|
| `KNW-` | session | 会话紧凑记录 |
| `TIP-` | tip | 快速上下文提示 |
| `TPL-` | template | 代码/配置模板 |
| `RCP-` | recipe | 操作步骤指南 |
| `REF-` | reference | 外部文档摘要 |
| `DCS-` | decision | 架构/设计决策 |
| `AST-` | asset | 通用代码资产（API 契约、数据模型、UI 原型等） |
| `BLP-` | blueprint | 架构蓝图、系统设计 |

#### 容器模式（`<knowhow-entry>`）

类似 spec 的 `<spec-entry>`，knowhow 文件也支持容器内多条目模式：

```markdown
---
title: Session Compact 20260510
category: session
roles: [analyze, review]
---

<knowhow-entry category="pattern" keywords="auth,jwt" date="2026-05-10" id="INS-001" source="decompose">

### JWT Refresh Token Rotation

Always rotate refresh tokens on use to prevent replay attacks.

</knowhow-entry>

<knowhow-entry category="gotcha" keywords="cache,invalidation" date="2026-05-10" id="INS-002" source="investigate">

### Cache Invalidation Race Condition

Distributed lock must be acquired before cache write...

</knowhow-entry>
```

每个 `<knowhow-entry>` 被 WikiIndexer 解析为独立 WikiEntry 子节点，与 spec sub-entry 共享同一套索引机制。

#### 代码资产关联（codePaths）

代码资产类文档（AST-/BLP-）通过 frontmatter 的 `codePaths` 字段关联源码：

```yaml
---
title: Auth API Contract
category: asset
assetType: api-contract
codePaths:
  - src/api/auth/
  - src/types/auth.ts
roles: [implement, review]
tags: [auth, api, jwt]
---
```

`codePaths` 保留在 `WikiEntry.ext` 中，可通过 `entry.ext.codePaths` 访问。

#### ref 引用模式（Spec → Knowhow 桥接）

Spec 是索引/规则层，Knowhow 是详文层。当一个主题过于复杂无法内联在 spec-entry 中时，可用 `ref` 属性引用 knowhow 详文：

```markdown
<!-- 内联模式（简短洞察） -->
<spec-entry category="pattern" keywords="auth,jwt" date="2026-05-10">

### JWT Token Rotation

Always rotate refresh tokens on use.

</spec-entry>

<!-- 引用模式（复杂主题 → knowhow 详文） -->
<spec-entry category="pattern" keywords="oauth,pkce" date="2026-05-10"
  ref="knowhow/AST-oauth-flow.md">

### OAuth 2.0 集成架构

完整 OAuth PKCE 流程设计。详见引用文档。

</spec-entry>
```

WikiIndexer 解析 `ref` 属性时，自动在 spec 子条目与 knowhow 文档之间建立 `related` 链接，纳入知识图谱。

**分工原则**：
- **Spec**（`specs/`）= 索引 + 规则。条目简短，agent 自动加载
- **Knowhow**（`knowhow/`）= 详文。完整文档，按需加载
- **ref** = 索引条目指向详文的桥梁

### Role 角色化检索

Wiki 条目支持 `roles` 标注，对标 delegate 系统的 7 个角色：

```
analyze | explore | review | implement | plan | brainstorm | research
```

通过 frontmatter `roles: [analyze, review]` 声明条目适用的角色。

```bash
# 按角色浏览知识索引
maestro wiki list --role analyze

# 选择相关文档加载完整内容
maestro wiki load knowhow-auth-api spec:project:arch-001
```

`roles` 是 WikiEntry 的一级字段（非 ext），支持 `filterEntries` 直接过滤，持久化索引（wiki-index.json）也包含。子条目自动继承容器的 roles。

### 三层加载设计

| 层级 | 命令 | 内容深度 | 用途 |
|------|------|---------|------|
| 索引浏览 | `maestro wiki list --role <role>` | id + title | 浏览，决定加载哪些 |
| 精确加载 | `maestro wiki load <id1> [id2...]` | 完整 body | 按 ID 数组加载选定文档 |
| Hook 自动注入 | `loadWikiByRole()` | title + summary | 轻量上下文注入（同步） |

**使用流程**（命令/agent）：
1. `maestro wiki list --role analyze` → 浏览角色相关文档索引
2. 分析索引，识别与当前任务相关的条目
3. `maestro wiki load <id1> <id2>` → 加载选定文档完整内容
4. 审阅加载的知识后开始执行

### Wiki 命令

```bash
# 条目管理
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [-q <query>]
maestro wiki load <id1> [id2...] [--json]          # 按 ID 批量加载
maestro wiki get <id>                               # 查看单条
maestro wiki search <query>                         # BM25 全文搜索
maestro wiki create --type knowhow --slug <slug> --title <title>
maestro wiki append <containerId> --category <cat> --body <text>
maestro wiki remove-entry <subEntryId>

# Knowhow CLI
maestro knowhow add --type <type> --title <title> --body <text>
maestro knowhow add --type asset --asset-type api-contract --code-paths "src/api/"
maestro knowhow list [--type <type>]
maestro knowhow search <query>

# 图谱分析
maestro wiki health                                 # 健康评分
maestro wiki graph                                  # 图谱结构
maestro wiki orphans                                # 孤立节点
maestro wiki hubs                                   # 枢纽节点
```

---

## 统一索引与注入

### 原子节点索引

WikiIndexer 将 `<spec-entry>` 和 `<knowhow-entry>` 统一解析为独立 WikiEntry 子节点：

```
容器文件                           WikiEntry 节点
┌───────────────────┐        ┌──────────────────────────┐
│ specs/learnings.md│   ──>  │ spec:project:learnings   │ (容器)
│   <spec-entry>    │   ──>  │ spec:project:learn-001   │ (子节点, parent=容器)
│   <spec-entry>    │   ──>  │ spec:project:learn-002   │
└───────────────────┘        └──────────────────────────┘

┌───────────────────┐        ┌──────────────────────────┐
│ knowhow/KNW-*.md  │   ──>  │ knowhow-knw-session      │ (容器)
│  <knowhow-entry>  │   ──>  │ knowhow-knw-session-001  │ (子节点, parent=容器)
│  <knowhow-entry>  │   ──>  │ knowhow-knw-session-002  │
└───────────────────┘        └──────────────────────────┘
```

子节点继承容器的 `roles`、`createdBy`、`sourceRef`，`keywords` 上浮到容器 frontmatter。

### 写入路径

Spec 和 Knowhow 共享统一的 WikiWriter 写入路径：

```
/spec-add coding "..."           ──┐
maestro wiki append spec-...     ──┤──> WikiWriter.appendEntry()
maestro wiki append knowhow-...  ──┘     │
                                         ├── 检测容器类型 → <spec-entry> 或 <knowhow-entry>
                                         ├── 追加条目块
                                         ├── 上浮 keywords 到 frontmatter
                                         └── 刷新 WikiIndex
```

### 写保护模型

| 操作 | specs/*.md | knowhow/*.md | virtual (issue) |
|------|:---------:|:-----------:|:---------------:|
| 读取 | Y | Y | Y |
| title/frontmatter 更新 | Y | Y | -- |
| body 整体覆写 | **禁止 (403)** | **禁止 (403)** | -- |
| 条目追加 (appendEntry) | Y | Y | -- |
| 条目移除 (removeEntry) | Y | Y | -- |
| 文件删除 | Y | Y | -- |

> body 受保护是因为 `<*-entry>` 块是独立知识单元，覆写会破坏全部子条目。使用 `appendEntry`/`removeEntry` 精确操作。

### 自动注入机制

#### Spec 注入（按 category）

`spec-injector` hook 在 `PreToolUse:Agent` 时，按 agent 类型自动注入对应 spec：

| Agent 类型 | Spec Category |
|-----------|---------------|
| code-developer, tdd-developer | coding, test |
| workflow-planner | arch |
| workflow-reviewer | review |
| debug-explore-agent | debug |

#### Wiki 注入（按 role）

`spec-injector` 同时按 agent 类型映射的 role，从 `wiki-index.json` 加载角色相关知识（title + summary）：

| Agent 类型 | Role | 注入内容 |
|-----------|------|---------|
| code-developer | implement | 实现相关的 knowhow/spec |
| workflow-planner | plan | 规划相关的设计文档 |
| workflow-reviewer | review | 审查相关的标准/规范 |
| debug-explore-agent | analyze | 分析相关的调试经验 |

两层注入合并后一起受 context budget 控制（full/reduced/minimal/skip）。

#### Keyword 注入

`keyword-spec-injector` 在 `UserPromptSubmit` 时，从 prompt 提取关键词匹配 spec entries（每次最多 5 条，session 内去重）。

### Session Dedup

- **Bridge 文件**：`{tmpdir}/maestro-spec-kw-{sessionId}.json`
- 记录已注入的 keywords + entry IDs
- 三个注入点（用户输入/Agent 启动/Coordinator）共享 bridge

---

## 文件结构

```
~/.maestro/
└── specs/                              # scope: global
    ├── coding-conventions.md
    └── ...

.workflow/
├── specs/                              # scope: project
│   ├── coding-conventions.md
│   ├── architecture-constraints.md
│   ├── quality-rules.md
│   ├── debug-notes.md
│   ├── test-conventions.md
│   ├── review-standards.md
│   └── learnings.md
├── knowhow/                            # 广谱知识（统一 markdown）
│   ├── KNW-20260427-1912.md            # 会话记录
│   ├── TPL-20260427-1913.md            # 模板
│   ├── RCP-20260428-0900.md            # 操作指南
│   ├── REF-20260428-1000.md            # 参考文档
│   ├── DCS-20260429-1100.md            # 决策记录
│   ├── TIP-20260429-1200.md            # 提示
│   ├── AST-auth-api.md                 # 代码资产（API 契约）
│   └── BLP-microservice-arch.md        # 架构蓝图
├── collab/
│   └── specs/                          # scope: team
│       └── {uid}/                      # scope: personal
├── issues/
│   └── issues.jsonl                    # 问题追踪（virtual entry）
├── learning/
│   └── patterns.jsonl                  # SelfLearningService 内部数据（不入 wiki）
└── wiki-index.json                     # 持久化索引（自动生成）
```

**Frontmatter 示例**（knowhow 含 roles + codePaths）：

```yaml
---
title: Auth API Contract
category: asset
assetType: api-contract
roles: [implement, review]
codePaths:
  - src/api/auth/
  - src/types/auth.ts
tags: [auth, api, jwt]
---
```

---

## CLI 参考

```bash
# ── Spec ────────────────────────────────────────────────────────
maestro spec init [--scope <scope>]
maestro spec load [--category <cat>] [--keyword <kw>] [--scope <scope>] [--role <role>] [--json]
maestro spec add <category> "<title>" "<content>" [--keywords kw1,kw2] [--source <src>]
maestro spec list [--scope <scope>]
maestro spec status [--scope <scope>]

# ── Wiki 检索 ──────────────────────────────────────────────────
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [--tag <tag>] [-q <query>] [--group] [--json]
maestro wiki load <id1> [id2...] [--json]            # 按 ID 批量加载完整内容
maestro wiki get <id> [--json]                       # 查看单条
maestro wiki search <query> [--json]                 # BM25 全文搜索

# ── Wiki 写入 ──────────────────────────────────────────────────
maestro wiki create --type <spec|knowhow> --slug <slug> --title <title> [--body <text>]
maestro wiki append <containerId> --category <cat> --body <text> [--keywords <kw>]
maestro wiki remove-entry <subEntryId>
maestro wiki update <id> [--title <title>] [--frontmatter <json>]
maestro wiki delete <id>

# ── Wiki 图谱 ──────────────────────────────────────────────────
maestro wiki health
maestro wiki graph
maestro wiki orphans
maestro wiki hubs [--limit N]
maestro wiki backlinks <id>
maestro wiki forward <id>

# ── Knowhow ────────────────────────────────────────────────────
maestro knowhow add --type <type> --title <title> --body <text> [--tags <csv>]
maestro knowhow add --type asset --asset-type <type> --code-paths <paths>
maestro knowhow list [--type <type>] [--json]
maestro knowhow search <query> [--json]
maestro knowhow get <id> [--json]

# ── Hook 管理 ──────────────────────────────────────────────────
maestro hooks install --level standard               # 含 spec-injector + keyword-spec-injector
maestro hooks status
```
