---
title: "知识管理系统指南"
---

Maestro 知识管理分为 **Spec**（编码约束/工具）和 **Wiki**（广义知识图谱）。Spec 提供基于 category 的项目规范，Wiki 提供操作经验、设计资产和学习笔记。两层通过 `<entry>` 标签格式、WikiIndexer 索引和 category 检索统一。

---

## Spec 系统

### 作用域

| 作用域 | 目录 | 自动初始化 |
|-------|------|-----------|
| `project`（默认） | `.workflow/specs/` | 是 |
| `global` | `~/.maestro/specs/` | 是 |
| `team` | `.workflow/collab/specs/` | 否 |
| `personal` | `.workflow/collab/specs/{uid}/` | 否 |

**加载优先级**（由低到高）：global → project → team → personal。后层追加，不覆盖。

### 文件与 Category 映射

每个 spec 文件是一个 category 的主文档。`spec load --category` 加载主文档全文 + 跨文件 keyword 匹配条目。

| 文件 | Category | 隐式角色 | 用途 |
|------|----------|---------|------|
| `coding-conventions.md` | coding | implement | 命名、导入、格式、模式 |
| `architecture-constraints.md` | arch | plan | 模块结构、层边界 |
| `review-standards.md` | review | review | 质量规则、检查清单 |
| `debug-notes.md` | debug | analyze | 调试技巧、根因记录 |
| `test-conventions.md` | test | test | 测试框架、覆盖率要求 |
| `learnings.md` | learning | implement | Bug、陷阱、经验教训 |
| `ui-conventions.md` | ui | implement | UI/UX 约定、设计令牌 |

### 条目格式

所有条目使用 `<spec-entry>` 闭合标签，**category** 为必需属性：

<details>
<summary>示例</summary>

```markdown
<spec-entry category="coding" keywords="auth,token,rotation" date="2026-04-21">
### Token rotation needs email carried through refresh flow
Revoked column must be set rather than deleting tokens.
</spec-entry>
```

</details>

| 属性 | 必需 | 说明 |
|------|------|------|
| `category` | 是 | 单值：coding, arch, review, debug, test, learning, ui |
| `keywords` | 是 | 逗号分隔，小写，跨 category 发现 |
| `date` | 是 | `YYYY-MM-DD` |
| `source` | 否 | 来源（manual / agent / phase） |
| `ref` | 否 | 指向 knowhow 详情文档的路径 |

### Tool 发现

Tool 是标记了 `tool: true` YAML 头的 knowhow 文档。`spec load --category` 自动扫描 `knowhow/` 中匹配 category + tool 的条目，追加摘要。

<details>
<summary>Knowhow tool 示例 + spec ref 条目</summary>

```markdown
---
title: Payment Gateway Idempotency Verification
type: recipe
category: coding
keywords: [payment, gateway, idempotency, testing]
tool: true
---

## Steps
1. Generate idempotency key (UUID v4)
2. Submit charge request with key
3. Retry same request with same key -- assert identical response
4. Submit different amount with same key -- assert 409 conflict
```

可选的 spec ref 条目：
```markdown
<spec-entry category="coding" keywords="payment,gateway,idempotency" date="2026-05-10"
  ref="knowhow/RCP-payment-idempotency.md">
### Payment Gateway Idempotency Verification
Use when testing payment integration endpoints for retry safety.
</spec-entry>
```

</details>

- **注册**：`/maestro-tools-register` — 将可复用流程编码为 knowhow tool 文档
- **执行**：`/maestro-tools-execute` — 按名称或 category 加载 tool，逐步执行

### Spec 命令

```bash
maestro spec init [--scope <scope>] [--uid <uid>]
maestro spec add <category> "<title>" "<content>" --keywords kw1,kw2 [--ref <path>] [--json]
maestro spec load --category <category>              # 主文档 + 跨文件 + tools
maestro spec load --category <category> --keyword <kw>
maestro spec load --keyword <kw>                     # 跨所有文件
```

### Progressive Fill

```
maestro-init    → spec-setup     maestro-analyze → arch, coding
maestro-plan    → coding, test   maestro-execute → learning, debug
maestro-execute → review (via E2.7 verification gate)
```

### 关键词系统

- `spec add` 自动提取 3-5 个领域关键词
- `spec load --keyword <kw>` 跨所有 category 文件匹配 `<spec-entry>` 的 keywords
- 旧版标题条目回退到文本搜索

---

## Wiki 知识图谱

### Knowhow 系统

`.workflow/knowhow/` 中的广义知识存储，按文件名前缀区分：

| 前缀 | 类型 | 用途 |
|------|------|------|
| `KNW-` | session | 会话压缩记录 |
| `TIP-` | tip | 快速上下文提示 |
| `TPL-` | template | 代码/配置模板 |
| `RCP-` | recipe | 步骤指南 |
| `REF-` | reference | 外部文档摘要 |
| `DCS-` | decision | 架构/设计决策 |
| `AST-` | asset | 代码资产（API 契约、数据模型） |
| `BLP-` | blueprint | 架构蓝图 |
| `DOC-` | document | 长文档（兜底） |

#### YAML Frontmatter

| 字段 | 必需 | 说明 |
|------|------|------|
| `title` / `type` | 是 | 文档标题和 knowhow 类型 |
| `category` | 否 | 单值 category，用于 agent 注入 |
| `keywords` | 否 | 可搜索的关键词列表 |
| `tool` | 否 | `true` 标记为可执行 tool |
| `summary` | 否 | 一行描述，缺省取首段 |
| 类型特有 | 否 | `lang`、`source`、`status`、`assetType`、`codePaths` |

#### 容器模式

Knowhow 文件支持通过 `<knowhow-entry>` 标签的多条目模式。子条目继承容器的 `category`；条目级可覆盖。

<details>
<summary>容器示例</summary>

```markdown
---
title: Session Compact 20260510
type: session
category: debug
---
<knowhow-entry keywords="auth,jwt" date="2026-05-10" category="coding">
### JWT Refresh Token Rotation
Always rotate refresh tokens on use to prevent replay attacks.
</knowhow-entry>
```

</details>

#### Ref 模式（Spec → Knowhow 桥接）

Spec = 索引 + 规则（自动加载）。Knowhow = 详情文档（按需加载）。`ref` 从索引桥接到详情。

<details>
<summary>Inline vs Ref 模式对比</summary>

```markdown
<!-- Inline（短内容） -->
<spec-entry category="coding" keywords="auth,jwt" date="2026-05-10">
### JWT Token Rotation
Always rotate refresh tokens on use.
</spec-entry>

<!-- Ref（复杂内容 → knowhow 详情） -->
<spec-entry category="coding" keywords="oauth,pkce" date="2026-05-10"
  ref="knowhow/RCP-oauth-flow.md">
### OAuth 2.0 Integration
Complete OAuth PKCE flow design.
</spec-entry>
```

Inline 显示（完整内容）：`### JWT Token Rotation > coding . auth, jwt . 2026-05-10`
Ref 显示（摘要 + 加载命令）：`-> 详情: maestro wiki load knowhow-oauth-flow`

</details>

### 基于 Category 的检索

Wiki 条目支持与 spec 一致的 `category` 标注。每个 category 映射到 delegate 角色，用于自动注入。

```bash
maestro wiki list --category coding    # 按 category 浏览
maestro wiki list --keyword auth       # 按关键词过滤
maestro wiki list --tool               # 列出所有 tool
maestro wiki load <id1> [id2...]       # 加载选定文档
```

### 三层加载

| 层级 | 命令 | 深度 | 用途 |
|------|------|------|------|
| 索引浏览 | `wiki list --category <cat>` | id + title | 浏览 |
| 精确加载 | `wiki load <id1> [id2...]` | 完整内容 | 按 ID 加载 |
| Hook 自动注入 | `loadWikiByCategory()` | title + summary | 上下文注入 |

### Wiki 命令

```bash
maestro wiki list [--type <type>] [--category <cat>] [--keyword <kw>] [--tool] [-q <query>]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id> | search <query>
maestro wiki create --type knowhow --slug <slug> --title <title>
maestro wiki append <containerId> --body <text> [--category <cat>] [--keywords <kw>]
maestro wiki remove-entry <subEntryId>

maestro knowhow add --type <type> --title <title> --body <text>
maestro knowhow add --type asset --asset-type api-contract --code-paths "src/api/"
maestro knowhow list [--type <type>] | search <query>

maestro wiki health | graph | orphans | hubs
```

---

## 统一索引与注入

### 原子节点索引

WikiIndexer 将 `<spec-entry>` 和 `<knowhow-entry>` 解析为独立的 WikiEntry 子节点。子节点继承容器 `category`；条目级可覆盖。Keywords 冒泡上传。

```
+-------------------+        +----------------------------+
| specs/coding-     |   →    | spec:project:coding        | (容器)
|   <spec-entry>    |   →    | spec:project:coding-001    | (子节点)
+-------------------+        +----------------------------+
```

### 写入路径

所有写操作共享统一 WikiWriter：检测容器类型 → 追加条目块 → 冒泡关键词 → 刷新索引。

### 写入保护

| 操作 | specs | knowhow | virtual |
|------|:-----:|:-------:|:-------:|
| 读取 / 标题更新 / 追加 / 移除 / 删除 | ✓ | ✓ | ✓* |
| 内容覆写 | **禁止** | **禁止** | — |

### 自动注入

**Spec 注入**：`spec-injector` 在 `PreToolUse:Agent` 时按 agent 类型自动注入 spec：

| Agent 类型 | 注入 Category |
|-----------|--------------|
| code-developer, tdd-developer | coding, learning |
| workflow-planner, action-planning-agent | arch |
| workflow-reviewer | review |
| debug-explore-agent, workflow-debugger | debug |

**Wiki 注入**：同时从索引加载 category 相关 wiki（title + summary），受 context budget 控制（full/reduced/minimal/skip）。

**关键词注入**：`keyword-spec-injector` 在 `UserPromptSubmit` 时提取关键词，匹配条目（每次最多 5 条，session 级去重）。

---

## 文件结构

```
~/.maestro/specs/                    # scope: global
    coding-conventions.md

.workflow/
+-- specs/                           # scope: project
|   +-- coding-conventions.md        # category: coding
|   +-- architecture-constraints.md  # category: arch
|   +-- review-standards.md          # category: review
|   +-- debug-notes.md               # category: debug
|   +-- test-conventions.md          # category: test
|   +-- learnings.md                 # category: learning
+-- knowhow/                         # 广义知识
|   +-- KNW-/TIP-/TPL-/RCP-/REF-/DCS-/AST-/BLP-/DOC-*.md
+-- collab/specs/                    # scope: team
|       +-- {uid}/                   # scope: personal
+-- issues/issues.jsonl              # Issue 追踪（virtual）
+-- learning/patterns.jsonl          # SelfLearningService 数据
+-- wiki-index.json                  # 持久化索引（自动生成）
```

---

## CLI 参考

```bash
# -- Spec -----------------------------------------------------------------
maestro spec init [--scope <scope>] [--uid <uid>]
maestro spec load [--category <cat>] [--keyword <kw>] [--scope <scope>] [--json] [--uid <uid>] [--stdin]
maestro spec add <category> "<title>" "<content>" [--keywords kw1,kw2] [--source <src>] [--ref <path>] [--knowhow-type <type>] [--uid <uid>] [--stdin] [--json]
maestro spec list [--scope <scope>] [--uid <uid>]
maestro spec status [--scope <scope>] [--uid <uid>]

# -- Tool 发现 ------------------------------------------------------------
/maestro-tools-register "<description>"
/maestro-tools-execute "<name>" | --category <cat>

# -- Wiki -----------------------------------------------------------------
maestro wiki list [--type <type>] [--category <cat>] [--keyword <kw>] [--tool] [-q <query>] [--group] [--json]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id> [--json]
maestro wiki search <query> [--json]
maestro wiki create --type <spec|knowhow> --slug <slug> --title <title> [--body <text>]
maestro wiki append <containerId> --body <text> [--category <cat>] [--keywords <kw>]
maestro wiki remove-entry <subEntryId> | update <id> [--title <title>] [--frontmatter <json>] | delete <id>

# -- Knowhow --------------------------------------------------------------
maestro knowhow add --type <type> --title <title> --body <text> [--keywords <csv>]
maestro knowhow add --type asset --asset-type <type> --code-paths <paths>
maestro knowhow list [--type <type>] [--json] | search <query> [--json] | get <id> [--json]

# -- 图 -------------------------------------------------------------------
maestro wiki health | graph | orphans | hubs [--limit N] | backlinks <id> | forward <id>

# -- Hooks ----------------------------------------------------------------
maestro hooks install --level standard | status
```
