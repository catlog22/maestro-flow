# Domain 领域知识系统设计文档

> **状态**: ✅ **已完成** (2026-06-15) — Domain 系统已作为 MaestroGraph 知识源完整集成，glossary.json → domain nodes + cross-source edges 自动解析。
>
> **关联文档**: [MaestroGraph 统一知识图谱引擎](./plan-maestrograph.md) — Domain 已作为 MaestroGraph 的 `source_type = 'domain'` 统一索引。

## 一、设计动机

### 现有知识体系的局限

| 层 | 职责 | 局限 |
|----|------|------|
| `project.md` | 描述当前项目结构 | 随代码变化，是状态不是定义 |
| `spec` | 约束/规则（怎么做） | 不回答"什么是什么" |
| `wiki/knowhow` | 详细知识文档 | 被动查阅，不主动消歧 |
| `codebase` | 自动生成的代码文档 | 描述代码结构，不是领域语义 |

**缺失层**：当用户说"租户"时，系统不知道这等同于 `Tenant`（多租户隔离单元），也不知道它和 `Workspace`、`Permission` 的关系。需要一个**权威的语义定义层**。

### Domain 的定位

```
Domain = 语义层（什么是什么）
Spec   = 约束层（怎么做）
两者互补，不覆盖
```

Domain 提供：
- **术语标准化** — 为项目定义唯一的规范术语
- **概念关系** — 术语之间的关联
- **Prompt 消歧** — 当 prompt 中出现领域术语时自动注入定义
- **Always-inject** — 核心术语始终在 LLM 上下文中

---

## 二、存储设计

### 目录结构

```
.workflow/domain/
├── glossary.json          # 核心：术语定义 + 别名 + 关系
└── concepts/              # 可选：复杂概念的详细说明文档
    ├── tenant.md
    └── auth-flow.md
```

### glossary.json Schema

```jsonc
{
  "$schema": "domain/1.0",
  "project": "my-project",
  "terms": [
    {
      "id": "tenant",                          // 唯一标识（kebab-case）
      "canonical": "Tenant",                    // 规范名称（PascalCase）
      "aliases": ["租户", "org", "组织"],        // 用户可能输入的变体
      "definition": "多租户隔离单元，每个 Tenant 拥有独立数据分区和配置空间",
      "relationships": ["workspace", "user", "permission"],  // 关联的其他 term id
      "keywords": ["multi-tenant", "isolation", "data-partition"],  // 触发关键词
      "concept_ref": "concepts/tenant.md",      // 可选：详细文档路径
      "rewrite_hints": {                        // 可选：prompt 理解提示
        "组织": "Tenant（多租户隔离单元）",
        "org": "Tenant"
      },
      "source": {                               // 注册来源追溯
        "kind": "discover | finish-work | manual | import",
        "session": "20260612-grill-auth",       // 可选
        "registered_at": "2026-06-12T10:30:00Z"
      }
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一标识，kebab-case，用于跨系统引用 |
| `canonical` | 是 | 规范名称，优先用于注入和展示 |
| `aliases` | 是 | 别名列表，精确匹配用户输入 |
| `definition` | 是 | 一行定义（< 200 字符） |
| `relationships` | 否 | 关联 term 的 id 列表，用于关系传播 |
| `keywords` | 否 | 辅助触发关键词（非精确匹配） |
| `concept_ref` | 否 | 指向 concepts/ 下的详细文档 |
| `rewrite_hints` | 否 | 别名到规范表达的映射 |
| `source` | 是 | 注册来源，用于追溯和审计 |

### 与 context-package 的关系

| 维度 | glossary.json | context-package#domain.terminology |
|------|--------------|-----------------------------------|
| 生命周期 | 项目级持久 | 单次 session 快照 |
| 权威性 | 权威定义源 | session 内临时提取 |
| 来源 | 经用户确认注册 | 自动提取，未确认 |
| 联动 | finish-work 从 terminology 导入到 glossary | brainstorm/grill 产出 terminology |

---

## 三、注入机制

### 两层注入策略

#### 层 1：Always-inject（Compact 模式）

每次 `UserPromptSubmit` 都注入极简术语摘要（~100-200 chars），确保 LLM 始终了解项目语义空间：

```
<domain-context mode="compact">
本项目核心术语：Tenant=多租户隔离单元 | Workspace=Tenant下的工作空间 | Pipeline=数据处理管线
</domain-context>
```

#### 层 2：Keyword-enhanced（展开模式）

当用户 prompt 中匹配到 domain term（canonical / alias / keyword）时，展开完整定义：

```
<domain-context mode="expanded" matched="tenant,workspace">
## Tenant
多租户隔离单元，每个 Tenant 拥有独立的数据分区和配置空间。
- 别名：租户、org、组织
- 关联：Workspace（Tenant 下的工作空间）、User（Tenant 成员）
- 提示：当用户提到"组织"时，理解为 Tenant

## Workspace
Tenant 下的工作空间，一个 Tenant 可包含多个 Workspace。
- 关联：Tenant、Project
</domain-context>
```

### 匹配逻辑

```
tokenizePrompt(prompt)
  │
  ├─ 精确匹配 ──────────────────────────────────────────┐
  │  prompt tokens vs. term.canonical (case-insensitive)  │  "Tenant" → 命中
  │  prompt tokens vs. term.aliases[] (exact)             │  "租户"   → 命中
  │  prompt tokens vs. term.keywords[] (fuzzy)            │  "isolation" → 命中
  │                                                       │
  ├─ 关系传播（1 级深度）────────────────────────────────┐
  │  命中 "tenant" → relationships: ["workspace", "user"] │
  │  → 追加 workspace, user 的 compact 定义                │
  │                                                       │
  └─ 输出组装 ──────────────────────────────────────────┐
     compact summary (always)                             │
     + expanded definitions (matched terms)               │
     + rewrite_hints (if any)                             │
```

### Hook 集成位置

**不新增独立 hook**，集成到现有 hook 中：

```
UserPromptSubmit 执行链:
┌───────────────────────────────────────────────────┐
│ 1. keyword-spec-injector (MODIFIED)               │
│    ├─ 加载 glossary.json                          │
│    ├─ Always: compact term summary                │
│    ├─ Keyword: alias/canonical 精确匹配           │
│    │  └─ 命中 → expanded definitions              │
│    │  └─ 关系传播（1 级深度）                      │
│    ├─ Spec keyword index → matched spec entries    │
│    ├─ Spec entry 有 domain="" 属性? → 追加 domain  │
│    └─ 输出 sections: domain + spec + kg-symbols    │
├───────────────────────────────────────────────────┤
│ 2. kg-sync (UNCHANGED)                            │
└───────────────────────────────────────────────────┘

PreToolUse:Agent 执行链:
┌───────────────────────────────────────────────────┐
│ 1. spec-injector (MODIFIED)                       │
│    ├─ agent type → categories → spec entries       │
│    ├─ always-inject domain compact summary   ← NEW│
│    └─ inject additionalContext                     │
├───────────────────────────────────────────────────┤
│ 2. kg-context-injector (UNCHANGED)                │
└───────────────────────────────────────────────────┘
```

### Spec entry `domain` 属性联动

在 `<spec-entry>` 格式中增加可选 `domain` 属性：

```xml
<spec-entry roles="implement" keywords="tenant,rls" domain="tenant">
### Tenant 数据隔离
所有 Tenant 数据查询必须通过 RLS policy 隔离。
</spec-entry>
```

当 keyword-spec-injector 匹配到带 `domain` 属性的 spec entry 时，自动追加对应 domain term 的定义注入。

---

## 四、`maestro domain discover` 命令

### 用途

扫描代码仓库，提取领域术语候选，交互确认后注册到 glossary.json。

### 命令语法

```bash
maestro domain discover [options]

Options:
  --scope <dir>          限定扫描目录（默认: 项目根目录）
  --recent <N>           只扫描最近 N 天变更的文件（默认: 不限）
  --from <source>        从上游产物提取：context-package | terminology | blueprint
  --min-freq <N>         最小出现频次阈值（默认: 2）
  --limit <N>            最大候选数量（默认: 20）
```

### 扫描流程

```
Phase 1: 扫描源
┌────────────────────────────────────────────────────────────┐
│ 代码层:                                                     │
│   • TypeScript/JS: interface, type, enum, class 名称        │
│     正则: /(?:interface|type|enum|class)\s+([A-Z]\w+)/g     │
│   • JSDoc/TSDoc: 声明上方的 /** */ 第一行 → autoDefinition   │
│   • 常量枚举: /const\s+\w*(?:Type|Status|Role|Kind)\w*/g    │
│   • API 路由: /\.(get|post|put|delete)\(['"]\/api\/(\w+)/g  │
│     → "tenants" → "Tenant"                                  │
│                                                             │
│ 文档层:                                                     │
│   • README.md, docs/ 下的 ## 标题 → term，后续段落 → 定义   │
│   • CHANGELOG 中的功能名称                                   │
│                                                             │
│ 上游层（--from）:                                            │
│   • context-package.json#domain.terminology[]               │
│   • terminology.md (grill 产出) — locked terms              │
│   • blueprint/glossary.json — blueprint 阶段提取的术语       │
└────────────────────────────────────────────────────────────┘

Phase 2: 去重 + 过滤
┌────────────────────────────────────────────────────────────┐
│ • 已注册的 glossary.json terms → 跳过                       │
│ • 通用编程术语黑名单 → 跳过                                  │
│   (string, array, error, config, handler, service,          │
│    component, module, utils, helper, interface, type...)     │
│ • 合并同义词候选 (Tenant/tenant/TENANT → 一组)              │
│ • 按出现频次降序排序                                         │
│ • 截断到 --limit                                            │
└────────────────────────────────────────────────────────────┘

Phase 3: 交互确认（见第六节确认机制）

Phase 4: 注册
┌────────────────────────────────────────────────────────────┐
│ • 写入 .workflow/domain/glossary.json                       │
│ • 每个 term 的 source.kind = "discover"                     │
│ • 输出报告:                                                 │
│   Registered: 3 domain terms (Tenant, Pipeline, Workspace) │
│   Skipped: 1 (Credential — user declined)                  │
└────────────────────────────────────────────────────────────┘
```

### 扫描实现关键点

```typescript
// src/tools/domain-scanner.ts

interface TermCandidate {
  term: string;                  // 原始名称
  normalized: string;            // PascalCase 标准化
  sources: Array<{
    kind: 'interface' | 'type' | 'enum' | 'class' | 'const' | 'route' | 'doc' | 'upstream';
    file: string;
    line?: number;
    definition?: string;         // JSDoc 或 README 中的定义
  }>;
  frequency: number;             // 出现次数
  autoDefinition: string | null; // 自动提取的定义（JSDoc > README > null）
  autoAliases: string[];         // 自动发现的变体
}

// 通用编程术语黑名单（不应作为 domain term）
const BLACKLIST = new Set([
  'string', 'number', 'boolean', 'array', 'object', 'error',
  'config', 'options', 'params', 'props', 'state', 'context',
  'handler', 'service', 'controller', 'middleware', 'router',
  'component', 'module', 'utils', 'helper', 'factory', 'builder',
  'request', 'response', 'result', 'data', 'item', 'list',
  'event', 'callback', 'promise', 'observable', 'stream',
]);
```

---

## 五、finish-work 集成

### 新增 Step 3.5: Domain Term Extraction

在 `workflows/finish-work.md` 的 Step 3（Route fragments）和 Step 4（Write archive.json）之间：

```
### 3.5 Domain Term Extraction (interactive, conditional)

Prerequisites:
  - .workflow/domain/ 目录存在（不存在则跳过整个步骤）
  - Session 包含术语源文件

Source priority:
  1. terminology.md (grill session) — locked terms with code references
  2. context-package.json#domain.terminology[] — brainstorm/grill/import 产出
  3. conclusions.json#recommendations with domain-like keywords

Process:
  1. 从 session 产物中收集术语候选
  2. 过滤已注册的 glossary.json terms
  3. 0 个新候选 → 跳过（静默）
  4. ≥ 1 个新候选 → 交互确认（见第六节）
  5. 确认的术语写入 glossary.json
  6. 记录到 archive.json 的 extraction.domain_ids[]

Skip conditions:
  - .workflow/domain/ 不存在
  - Session 无术语源文件
  - 所有候选术语已注册
```

### archive.json Schema 变更

```jsonc
"extraction": {
  "harvested": true,
  "harvested_at": "2026-06-12T10:30:00Z",
  "spec_ids": ["spec:project:coding-conventions:42"],
  "knowhow_ids": ["knowhow-jwt-rotation"],
  "domain_ids": ["tenant", "pipeline"],        // ← NEW
  "skipped_count": 0
}
```

### finish-work 路由表变更

原始 `terminology.md` 的路由从：

```
| `terminology.md` locked terms | knowhow | knowhow (`REF`) | `coding` |
```

变更为：

```
| `terminology.md` locked terms | domain + knowhow | domain (confirmed) + knowhow (`REF`, remaining) | — |
```

逻辑：先尝试注册为 domain（需确认），未确认的回退到 knowhow (`REF`) 存储。

---

## 六、确认机制

### 核心原则

**所有 domain 注册都需要用户明确确认，`-y` / `--yes` 标志对 domain 注册无效。**

理由：Domain 是项目的权威语义定义，通过 always-inject 机制注入到所有后续 prompt。错误的 domain 定义持续污染所有对话，影响远大于错误的 spec 或 knowhow。

### 确认入口矩阵

| 入口 | 确认方式 | `-y` 是否跳过确认 |
|------|----------|-------------------|
| `maestro domain add` | 单个术语交互确认 | **否** |
| `maestro domain discover` | 批量 multiSelect + 逐个细节确认 | **否** |
| `finish-work` Step 3.5 | multiSelect + 缺定义时追问 | **否** |
| `maestro domain import` | 批量预览 → multiSelect 选择 | **否** |
| `manage-harvest` domain 路由 | 同 finish-work | **否** |

### 确认交互流程

#### 批量选择（discover / finish-work / import）

```
=== NEW DOMAIN TERMS DETECTED ===

From: {source description}

  #  Term        Definition (auto)              Source
  ─  ──────────  ─────────────────────────────  ──────────
  1  Tenant      多租户隔离单元                  interface (12 refs)
  2  Pipeline    数据处理管线                    type + README
  3  Workspace   (no auto definition)           interface (6 refs)
  4  Credential  认证凭据                        class + JSDoc

AskUserQuestion:
  question: "选择要注册到领域知识库的术语"
  multiSelect: true
  options:
    - "Tenant — 多租户隔离单元 (推荐: 高频, 有定义)"
    - "Pipeline — 数据处理管线"
    - "Workspace — 需要补充定义"
    - "Credential — 认证凭据"
```

#### 单个术语详细确认

对每个选中的术语：

```
AskUserQuestion:
  question: "确认术语 'Tenant' 的注册信息？"
  options:
    - label: "确认注册"
      description: "定义: 多租户隔离单元 | 别名: 租户, org | 关联: workspace, user"
    - label: "修改后注册"
      description: "编辑定义、别名或关联关系"
    - label: "跳过"
      description: "不注册，保留在 knowhow 中"
```

如果选择"修改后注册"：
- 追问定义（如果 autoDefinition 为 null 或用户不满意）
- 追问别名（逗号分隔）
- 追问关联术语（逗号分隔，引用已有 term id）

#### 简化快速确认（术语信息完整时）

当 autoDefinition 存在且 source 可靠时，合并为一步确认：

```
AskUserQuestion:
  question: "注册以下术语到领域知识库？"
  multiSelect: true
  options:
    - "Tenant: 多租户隔离单元 (别名: 租户, org)"
    - "Pipeline: 数据处理管线 (别名: 管线)"
    - "全部跳过"
```

---

## 七、搜索集成

### WikiNodeType 扩展

```typescript
// dashboard/src/server/wiki/wiki-types.ts
export type WikiNodeType =
  | 'project'
  | 'roadmap'
  | 'spec'
  | 'issue'
  | 'knowhow'
  | 'note'
  | 'domain';    // ← NEW
```

### WikiIndexer 扫描 domain

```typescript
// dashboard/src/server/wiki/wiki-indexer.ts — 新增方法

async scanDomain(): Promise<WikiEntry[]> {
  const glossaryPath = join(this.workflowRoot, 'domain', 'glossary.json');
  if (!existsSync(glossaryPath)) return [];

  const raw = await readFile(glossaryPath, 'utf-8');
  const glossary = JSON.parse(raw);

  return glossary.terms.map(term => ({
    id: `domain-${term.id}`,
    type: 'domain' as WikiNodeType,
    title: term.canonical,
    summary: term.definition,
    tags: [...term.aliases, ...term.keywords],
    body: buildDomainEntryBody(term),
    status: 'active',
    category: 'domain',
    scope: 'project',
    source: { kind: 'file', path: 'domain/glossary.json' },
    // ...
  }));
}

function buildDomainEntryBody(term: DomainTerm): string {
  const lines = [`# ${term.canonical}`, '', term.definition, ''];
  if (term.aliases.length) lines.push(`别名: ${term.aliases.join(', ')}`);
  if (term.relationships.length) lines.push(`关联: ${term.relationships.join(', ')}`);
  if (term.keywords.length) lines.push(`关键词: ${term.keywords.join(', ')}`);
  return lines.join('\n');
}
```

### 统一搜索入口

```bash
# 所有类型搜索
maestro search "tenant"                    # → [domain] Tenant, [spec] tenant-rls, [knowhow] RCP-auth

# 限定 domain 类型
maestro search "tenant" --type domain      # → [domain] Tenant: 多租户隔离单元

# 别名搜索（aliases 在 tags 中，BM25 会匹配）
maestro search "租户"                      # → [domain] Tenant (匹配 alias)
maestro search "组织" --type domain        # → [domain] Tenant (匹配 alias)
```

### `maestro domain search` 快捷命令

```bash
maestro domain search "auth"
# 等价于 maestro search "auth" --type domain
# 但附加: 同时显示匹配到的 spec entries 和 relationships
```

输出格式：

```
Domain: "auth" (3 results)

  [domain] Credential — 认证凭据，用于身份验证的令牌或密码
    别名: 凭证, token, 令牌
    关联: → User, → Permission

  [domain] AuthFlow — OAuth2 认证流程
    别名: 认证流程, login-flow
    关联: → Credential, → Session

  Related specs:
    [spec] coding · auth,jwt · Token Rotation: 刷新令牌时必须轮换
    [spec] arch · auth,session · Stateless JWT: 禁止 server-side session
```

---

## 八、CLI 命令完整参考

### 管理命令

```bash
# 初始化
maestro domain init
  # 创建 .workflow/domain/glossary.json (空模板)
  # 创建 .workflow/domain/concepts/ 目录

# 新增（交互确认）
maestro domain add "<canonical>" "<definition>" [options]
  --aliases <csv>          # 别名列表
  --keywords <csv>         # 触发关键词
  --relationships <csv>    # 关联 term id
  --concept-ref <path>     # 详细文档路径
  # → 显示确认 → 用户确认后写入

# 列表
maestro domain list [--json]
  # 输出: id | canonical | aliases | definition (truncated)

# 详情
maestro domain show <id> [--json]
  # 输出: 完整定义 + 关系 + 来源 + concept_ref 内容

# 更新（交互确认）
maestro domain update <id> [options]
  --definition <text>      # 更新定义
  --add-alias <csv>        # 追加别名
  --remove-alias <csv>     # 移除别名
  --add-relationship <csv> # 追加关联
  --add-keyword <csv>      # 追加关键词
  # → 显示变更差异 → 用户确认后写入

# 删除（交互确认）
maestro domain remove <id>
  # → 显示将要删除的内容 → 用户确认后删除

# 搜索
maestro domain search <query> [--json]
  # 搜索 canonical + aliases + definition + keywords
```

### 发现命令

```bash
maestro domain discover [options]
  --scope <dir>            # 限定扫描目录
  --recent <N>             # 只扫描最近 N 天变更的文件
  --from <source>          # 从上游产物提取: context-package | terminology | blueprint
  --min-freq <N>           # 最小出现频次阈值（默认: 2）
  --limit <N>              # 最大候选数量（默认: 20）
  --exclude <pattern>      # 排除文件 glob pattern
```

### 导入命令

```bash
maestro domain import [options]
  --from context-package   # 从当前/指定 session 的 context-package 导入
  --from @<file>           # 从外部文件导入（csv, json, md）
  --session <path>         # 指定 session 目录
  --merge                  # 合并到已有 glossary（默认行为）
  --replace                # 替换整个 glossary（危险，需双重确认）
```

---

## 九、知识层次模型

### 完整体系图

```
┌─────────────────────────────────────────────────────────────┐
│                       知识层次模型                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Domain（语义层）— 权威定义，always-inject                    │
│  "什么是什么" — 术语定义、概念关系、语义消歧                   │
│  .workflow/domain/glossary.json                              │
│  → keyword-spec-injector (domain section)                   │
│  → spec-injector (compact summary)                          │
│                    │                                        │
│                    │ 互补（domain 提供语义，spec 提供规则）    │
│                    ↓                                        │
│  Spec（约束层）— role-based 注入                              │
│  "怎么做" — 编码规范、架构约束、质量规则                      │
│  .workflow/specs/*.md                                        │
│  → spec-injector + keyword-spec-injector                    │
│                    │                                        │
│                    │ ref 指向（spec-entry → knowhow detail） │
│                    ↓                                        │
│  Wiki/Knowhow（知识层）— 按需加载                             │
│  "详细怎么做" — 配方、模板、决策记录、学习笔记               │
│  .workflow/knowhow/*.md                                      │
│  → wiki-role-loader                                         │
│                    │                                        │
│                    │ 独立                                    │
│                    ↓                                        │
│  Project.md / Codebase（状态层）— 按需读取                    │
│  "现在是什么" — 当前结构、代码文档                            │
│  .workflow/project.md, .workflow/codebase/*.md                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 跨层联动点

| 联动 | 方向 | 机制 |
|------|------|------|
| Spec → Domain | spec-entry `domain="<id>"` 属性 | keyword-spec-injector 匹配时追加 domain 定义 |
| Domain → Spec | domain term 的 keywords 覆盖 spec keyword index | 同一 keyword 同时返回 domain + spec |
| Domain → Wiki | domain term 的 concept_ref 指向 knowhow | `maestro domain show` 可展开 |
| Finish-work → Domain | session 术语 → domain 注册 | Step 3.5 交互确认 |
| Discover → Domain | 代码扫描 → domain 注册 | Phase 3 交互确认 |
| WikiIndexer → Domain | glossary.json → WikiEntry[] | 统一搜索覆盖 domain |

---

## 十、实现计划

### Phase 1: 基础设施（核心）

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `src/tools/domain-loader.ts` | 新增 | P0 |
| `src/commands/domain.ts` | 新增 | P0 |

交付：`maestro domain init/add/list/show/update/remove/search` 可用。

### Phase 2: 发现能力

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `src/tools/domain-scanner.ts` | 新增 | P1 |
| `src/commands/domain.ts` (discover/import) | 扩展 | P1 |

交付：`maestro domain discover` 和 `maestro domain import` 可用。

### Phase 3: 注入集成

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `src/hooks/keyword-spec-injector.ts` | 修改 | P1 |
| `src/hooks/spec-injector.ts` | 修改 | P1 |
| `src/hooks/context-format.ts` | 修改 | P2 |

交付：domain 术语自动注入到 LLM context。

### Phase 4: 搜索 + WikiIndexer

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `dashboard/src/server/wiki/wiki-types.ts` | 修改 | P2 |
| `dashboard/src/server/wiki/wiki-indexer.ts` | 修改 | P2 |
| `src/commands/search.ts` | 修改 | P2 |

交付：`maestro search --type domain` 可用。

### Phase 5: finish-work 集成

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `workflows/finish-work.md` | 修改 | P2 |
| `workflows/harvest.md` | 修改 | P2 |
| `src/tools/spec-entry-parser.ts` | 修改 | P3 |

交付：finish-work 自动检测并提议注册新术语。

### Phase 6: Spec domain 属性联动

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `src/tools/spec-entry-parser.ts` | 修改 | P3 |
| `src/hooks/keyword-spec-injector.ts` | 修改 | P3 |

交付：spec-entry `domain=""` 属性触发 domain 定义注入。

---

## 十一、输出格式示例

### 完整注入示例

用户输入：`帮我检查租户数据隔离的实现`

keyword-spec-injector 输出的 additionalContext：

```xml
<maestro-context budget="620/620">
  <section label="domain[tenant,workspace]">
    • Tenant: 多租户隔离单元，每个 Tenant 拥有独立的数据分区和配置空间
    • ↳ 别名: 租户, org, 组织
    • ↳ 关联: Workspace(Tenant下的工作空间), User(Tenant成员), Permission(租户级权限)
    • Workspace: Tenant 下的工作空间，一个 Tenant 可包含多个 Workspace
  </section>
  <section label="keyword[tenant,rls,isolation]">
    • coding · tenant,rls · Tenant数据隔离: 所有Tenant数据查询必须通过RLS policy隔离
    • arch · tenant,isolation · 多租户架构: 采用shared-database + schema-per-tenant模式
  </section>
  <section label="kg-symbols">
    • [interface] Tenant (src/models/tenant.ts:15) — export interface Tenant
    • [function] getTenantById (src/services/tenant-service.ts:42)
  </section>
</maestro-context>
```

### discover 命令输出示例

```
$ maestro domain discover --scope src/

Scanning src/ for domain terms...
  Files scanned: 142
  Types found: 38
  After filtering: 6 candidates

=== DOMAIN TERM CANDIDATES ===

  #  Term         Freq  Source              Auto Definition
  ─  ───────────  ────  ──────────────────  ────────────────────────────
  1  Tenant        12   interface + route   多租户隔离单元 (from JSDoc)
  2  Pipeline       8   type + README       数据处理管线 (from README)
  3  Workspace      6   interface           (no auto definition)
  4  Credential     4   class + JSDoc       认证凭据 (from JSDoc)
  5  Subscription   3   interface           订阅计划 (from JSDoc)
  6  Webhook        2   type + route        (no auto definition)

? 选择要注册到领域知识库的术语 (多选)
  [x] Tenant — 多租户隔离单元 (推荐: 高频+有定义)
  [x] Pipeline — 数据处理管线
  [ ] Workspace — 需要补充定义
  [ ] Credential — 认证凭据
  [ ] Subscription — 订阅计划
  [ ] Webhook — 需要补充定义

? 确认 'Tenant' 注册信息
  > 确认注册 (定义: 多租户隔离单元 | 别名: tenant)
    修改后注册
    跳过

? 确认 'Pipeline' 注册信息
  > 确认注册 (定义: 数据处理管线 | 别名: pipeline, 管线)
    修改后注册
    跳过

=== REGISTERED ===
  ✓ Tenant — 多租户隔离单元
  ✓ Pipeline — 数据处理管线
  ○ Workspace, Credential, Subscription, Webhook — skipped

Glossary: .workflow/domain/glossary.json (2 terms total)
```

---

## 十二、错误码

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/domain/` not initialized | Run `maestro domain init` |
| E002 | error | Term ID already exists in glossary | Use `maestro domain update` |
| E003 | error | Term ID not found | Check `maestro domain list` |
| E004 | error | glossary.json parse error | Validate JSON format |
| E005 | error | --from source not found | Check session path |
| W001 | warning | No candidates found during discover | Widen scope or lower --min-freq |
| W002 | warning | User skipped all candidates | No changes made |
| W003 | warning | Auto-definition extraction failed for some terms | Manual definition required |

---

## 十三、后续演进

Domain 系统建成后，将作为 MaestroGraph 统一知识图谱（`.workflow/kg/maestro.db`）的知识源之一。具体集成设计见 [plan-maestrograph.md](./plan-maestrograph.md)。

Domain → MaestroGraph 的集成路径：
- `glossary.json` → `domain-extractor.ts` → `domain_term` 节点 + `relates_to` 边
- Domain 的 `canonical`/`aliases` 与代码 `interface`/`class` 名称自动匹配 → `defines` 边
- Domain 的 `keywords` 与 `spec_entry` 的 `keywords` 交叉匹配 → `derived_from` 边

---

## 附录 A：设计漏洞审计与修复方案

> 以下修复方案来自多维度设计审计（数据安全、性能、一致性、UX、边界情况），覆盖 Domain 系统相关的 12 个漏洞。MaestroGraph 相关漏洞见 [plan-maestrograph.md 附录 A](./plan-maestrograph.md#附录-a设计漏洞审计与修复方案)。

### 漏洞总览

| 编号 | 维度 | 漏洞 | 优先级 | 预估 |
|------|------|------|--------|------|
| D1.1 | 数据安全 | glossary.json 并发写入冲突 | P0 | 0.5 天 |
| D1.2 | 数据安全 | glossary.json 无备份策略 | P1 | 0.5 天 |
| D1.3 | 数据安全 | glossary.json 无 schema 校验 | P0 | 1 天 |
| D2.1 | 性能 | compact summary 无大小控制 | P0 | 0.5 天 |
| D2.2 | 性能 | glossary.json 重复 I/O | P1 | 0.5 天 |
| D3.3 | 一致性 | spec-entry domain="" 悬空引用 | P1 | 0.5 天 |
| D4.1 | UX | discover 确认疲劳 | P1 | 1 天 |
| D4.2 | UX | 无 domain term 弃用生命周期 | P1 | 1 天 |
| D7.2 | CJK | domain 匹配缺乏 CJK 语义 | P1 | 0.5 天 |
| D8.1 | 边界 | 空 glossary.json 行为未定义 | P0 | 0.5 天 |
| D8.2 | 边界 | 超大 concepts/ 文件 | P1 | 0.5 天 |
| D8.3 | 边界 | relationships 环形引用 | P1 | 1 天 |

---

### D1.1 glossary.json 并发写入冲突

**[问题]**
`finish-work`、`domain discover`、`domain add` 命令以及 hook 都直接对 glossary.json 做 read-modify-write 操作。没有文件锁机制，多个 CLI 实例并行执行时，后写入者静默覆盖先写入者的数据。

**[修复]**
引入跨进程文件锁，参考 CodeGraph 的 `FileLock` 实现。在 `domain-loader.ts` 中封装所有 glossary 写操作，统一通过锁保护。

**[实现位置]**
- 新增: `src/tools/domain-lock.ts`
- 修改: `src/tools/domain-loader.ts`（所有写入函数包裹 `withLock`）

**[代码片段]**

```typescript
// src/tools/domain-lock.ts
const STALE_TIMEOUT_MS = 30_000;

export class GlossaryLock {
  private lockPath: string;
  private held = false;

  constructor(workflowRoot: string) {
    this.lockPath = join(workflowRoot, 'domain', '.glossary.lock');
  }

  acquire(): void {
    if (existsSync(this.lockPath)) {
      const content = readFileSync(this.lockPath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      const lockAge = Date.now() - statSync(this.lockPath).mtimeMs;
      if (lockAge < STALE_TIMEOUT_MS && !isNaN(pid) && isProcessAlive(pid)) {
        throw new Error(`glossary.json is locked by PID ${pid}. Delete ${this.lockPath} if stale.`);
      }
      unlinkSync(this.lockPath);
    }
    writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
    this.held = true;
  }

  release(): void {
    if (!this.held) return;
    try {
      if (parseInt(readFileSync(this.lockPath, 'utf-8').trim(), 10) === process.pid)
        unlinkSync(this.lockPath);
    } catch { /* already gone */ }
    this.held = false;
  }

  withLock<T>(fn: () => T): T {
    this.acquire();
    try { return fn(); } finally { this.release(); }
  }
}
```

```typescript
// src/tools/domain-loader.ts — 所有写操作包裹锁
export function addTerm(workflowRoot: string, term: DomainTerm): void {
  const lock = new GlossaryLock(workflowRoot);
  lock.withLock(() => {
    const glossary = readGlossary(workflowRoot);
    if (glossary.terms.some(t => t.id === term.id)) {
      throw new Error(`Term "${term.id}" already exists`);
    }
    glossary.terms.push(term);
    writeGlossary(workflowRoot, glossary);
  });
}
```

**[对现有设计的影响]**
- 第八节 CLI 命令需标注"自动获取文件锁"
- `.glossary.lock` 加入 `.gitignore`
- 不影响读操作（hook 注入是只读的）

---

### D1.2 glossary.json 无备份策略

**[问题]**
glossary.json 包含经用户人工确认的权威语义定义，是高价值数据。文件损坏或误删后无法恢复。

**[修复]**
每次写操作前自动创建时间戳备份，保留最近 10 份。

**[实现位置]**
- 修改: `src/tools/domain-loader.ts`（`writeGlossary` 内部）
- 备份目录: `.workflow/domain/.backups/`

**[代码片段]**

```typescript
const MAX_BACKUPS = 10;

function backupGlossary(workflowRoot: string): void {
  const glossaryPath = join(workflowRoot, 'domain', 'glossary.json');
  if (!existsSync(glossaryPath)) return;
  const backupDir = join(workflowRoot, 'domain', '.backups');
  mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:\-]/g, '').replace(/\..+/, '');
  copyFileSync(glossaryPath, join(backupDir, `glossary-${ts}.json`));
  // 清理旧备份
  const backups = readdirSync(backupDir)
    .filter(f => f.startsWith('glossary-') && f.endsWith('.json'))
    .sort().reverse();
  for (const old of backups.slice(MAX_BACKUPS)) unlinkSync(join(backupDir, old));
}
```

**[对现有设计的影响]**
- 第二节目录结构追加 `.backups/`
- 第十二节追加恢复命令: `maestro domain restore [--backup <file>]`
- `.backups/` 加入 `.gitignore`

---

### D1.3 glossary.json 无 schema 校验

**[问题]**
glossary.json 可被手动编辑或损坏程序写入非法数据，格式错误可能静默传播到 hook 注入层，污染所有 LLM prompt。

**[修复]**
在读取时做运行时校验（轻量级，不引入 ajv 等重依赖）。

**[实现位置]**
- 新增: `src/tools/domain-schema.ts`
- 修改: `src/tools/domain-loader.ts`（`readGlossary` 调用校验）

**[代码片段]**

```typescript
// src/tools/domain-schema.ts
export function validateGlossary(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data || typeof data !== 'object') return [{ path: '$', message: 'must be object' }];
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.terms)) return [{ path: '$.terms', message: 'must be array' }];

  const seenIds = new Set<string>();
  for (let i = 0; i < obj.terms.length; i++) {
    const term = obj.terms[i] as Record<string, unknown>;
    const p = `$.terms[${i}]`;
    // 必填字段校验
    if (typeof term.id !== 'string' || !/^[a-z0-9-]+$/.test(term.id))
      errors.push({ path: `${p}.id`, message: 'must be kebab-case' });
    else if (seenIds.has(term.id))
      errors.push({ path: `${p}.id`, message: `duplicate: ${term.id}` });
    else seenIds.add(term.id);
    if (typeof term.canonical !== 'string' || !term.canonical.length)
      errors.push({ path: `${p}.canonical`, message: 'required' });
    if (typeof term.definition !== 'string' || !term.definition.length)
      errors.push({ path: `${p}.definition`, message: 'required' });
    if (typeof term.definition === 'string' && term.definition.length > 200)
      errors.push({ path: `${p}.definition`, message: 'exceeds 200 chars' });
  }
  // 第二遍: relationships 引用目标校验
  const allIds = new Set((obj.terms as any[]).map(t => t.id).filter(Boolean));
  for (let i = 0; i < obj.terms.length; i++) {
    const term = obj.terms[i] as Record<string, unknown>;
    for (const relId of (term.relationships as string[]) ?? []) {
      if (!allIds.has(relId))
        errors.push({ path: `$.terms[${i}].relationships`, message: `dangling: "${relId}"` });
    }
  }
  return errors;
}
```

**[对现有设计的影响]**
- 第二节 schema 定义升级为运行时强制校验
- 第十二节 E004 recovery 改为 "Run `maestro domain validate` or restore from backup"
- 新增 CLI: `maestro domain validate`

---

### D2.1 compact summary 无大小控制

**[问题]**
always-inject compact summary 将所有 term 拼接为一行注入 LLM context。当 glossary 超过 30+ 术语时，compact summary 可能超过 2000 chars，浪费 token 预算。

**[修复]**
引入 `tier` 字段（`core` / `extended` / `peripheral`）+ `MAX_COMPACT_CHARS = 800` 硬限制。compact summary 仅注入 `core` 级术语。

**[实现位置]**
- 修改: 第二节 glossary.json Schema — term 新增 `tier` 字段
- 修改: `src/hooks/spec-injector.ts` — compact summary 过滤 + 截断

**[代码片段]**

```jsonc
// glossary.json — term 新增 tier 字段
{
  "id": "tenant",
  "canonical": "Tenant",
  "tier": "core",           // "core" | "extended" | "peripheral"
  "definition": "多租户隔离单元",
  // ...
}
```

```typescript
// src/hooks/spec-injector.ts — compact summary 构建
const MAX_COMPACT_CHARS = 800;

function buildCompactSummary(glossary: DomainGlossary): string | null {
  const coreTerms = glossary.terms.filter(t =>
    (t.status ?? 'active') === 'active' && (t.tier ?? 'core') === 'core'
  );
  if (coreTerms.length === 0) return null;
  let summary = '';
  for (const t of coreTerms) {
    const entry = `${t.canonical}=${t.definition}`;
    if (summary.length + entry.length + 3 > MAX_COMPACT_CHARS) break;
    summary += (summary ? ' | ' : '') + entry;
  }
  return summary;
}
```

**[对现有设计的影响]**
- 第二节 Schema 追加 `tier` 字段（默认 `core`）
- 第三节注入机制的 compact summary 改为"仅 core 级 + 800 字符上限"
- `maestro domain add` 和 `discover` 需提供 `--tier` 选项

---

### D2.2 glossary.json 重复 I/O

**[问题]**
每次 hook 触发都会 `readFileSync` 读取 glossary.json。在高频场景（多 Agent 并行 spawn）下产生大量重复磁盘 I/O。

**[修复]**
引入 file-mtime LRU 缓存：检查文件 mtime，未变则返回缓存数据。

**[实现位置]**
- 修改: `src/tools/domain-loader.ts` — 新增缓存层

**[代码片段]**

```typescript
// src/tools/domain-loader.ts
let _glossaryCache: { mtime: number; data: DomainGlossary } | null = null;

export function readGlossaryCached(workflowRoot: string): DomainGlossary {
  const glossaryPath = join(workflowRoot, 'domain', 'glossary.json');
  if (!existsSync(glossaryPath)) return { $schema: 'domain/1.0', terms: [] };
  const mtime = statSync(glossaryPath).mtimeMs;
  if (_glossaryCache && _glossaryCache.mtime === mtime) return _glossaryCache.data;
  const data = readGlossary(workflowRoot);  // 含 schema 校验
  _glossaryCache = { mtime, data };
  return data;
}
```

**[对现有设计的影响]**
- Hook 注入（只读路径）改用 `readGlossaryCached`
- 写操作仍用 `readGlossary`（绕过缓存，确保最新）
- 写操作完成后清空 `_glossaryCache`

---

### D3.3 spec-entry domain="" 悬空引用

**[问题]**
第三节设计了 `<spec-entry domain="tenant">` 属性。当 domain term `tenant` 被删除，`domain="tenant"` 变成悬空引用，注入时可能 crash 或产生空内容。

**[修复]**
- **删除侧**: `removeTerm` 时检查并警告存在悬空 spec 引用
- **注入侧**: keyword-spec-injector 解析 `domain` 属性时做安全查找，找不到则跳过

**[实现位置]**
- 修改: `src/tools/domain-loader.ts`（`removeTerm` 增加悬空检测）
- 修改: `src/hooks/keyword-spec-injector.ts`（domain 属性安全解析）
- 修改: `src/tools/spec-entry-parser.ts`（`SpecEntryParsed` 新增 `domain?: string`）

**[代码片段]**

```typescript
// src/hooks/keyword-spec-injector.ts — domain 属性安全查找
function resolveDomainContext(domainId: string, workflowRoot: string): string | null {
  try {
    const glossary = readGlossaryCached(workflowRoot);
    const term = glossary.terms.find(t => t.id === domainId);
    return term ? `${term.canonical}: ${term.definition}` : null;
  } catch { return null; }
}
```

```typescript
// src/tools/domain-loader.ts — removeTerm 警告悬空引用
const danglingRefs = checkDanglingSpecRefs(workflowRoot, termId);
if (danglingRefs.length > 0) {
  console.warn(`Warning: ${danglingRefs.length} spec entries reference domain="${termId}":\n` +
    danglingRefs.map(r => `  - ${r}`).join('\n'));
}
```

**[对现有设计的影响]**
- 第三节标注: "当 domain term 被删除，注入侧静默跳过悬空 domain 属性"
- 第十二节新增警告码: `W004 | warning | Spec entries reference deleted domain term`

---

### D4.1 discover 确认疲劳

**[问题]**
`maestro domain discover` 对每个候选术语逐个 AskUserQuestion 确认。大仓库扫描出 50+ 候选时，交互轮次过多。

**[修复]**
引入 `confidence` 评分（0-1），基于 4 个信号分桶，按置信度分层确认：

| 信号 | 权重 | 说明 |
|------|------|------|
| `hasAutoDefinition` | 0.3 | JSDoc/README 中有定义 |
| `sourceReliability` | 0.3 | interface/class/enum > type > const |
| `frequency` | 0.2 | 出现频次归一化 |
| `hasCodeReference` | 0.2 | 有明确类型声明 |

- **Tier 1（≥ 0.7）**: 高置信度，批量一键确认，不逐个追问
- **Tier 2（0.4–0.7）**: 中置信度，分组展示，用户补充缺失字段
- **Tier 3（< 0.4）**: 低置信度，逐个确认

**[实现位置]**
- `src/tools/domain-scanner.ts` — 新增 `computeConfidence()`
- 第六章确认流程重写

**[代码片段]**

```typescript
function computeConfidence(candidate: TermCandidate): number {
  let score = 0;
  if (candidate.autoDefinition) score += 0.3;
  const reliabilityMap: Record<string, number> = {
    interface: 0.3, class: 0.3, enum: 0.3, type: 0.2, const: 0.15, route: 0.1,
  };
  score += candidate.sources.reduce((best, s) => Math.max(best, reliabilityMap[s.kind] ?? 0), 0);
  score += Math.min(candidate.frequency / 20, 1) * 0.2;
  if (candidate.sources.some(s => ['interface', 'class', 'enum', 'type'].includes(s.kind)))
    score += 0.2;
  return Math.min(score, 1);
}
```

---

### D4.2 无 domain term 弃用生命周期

**[问题]**
删除术语直接从 glossary.json 移除，没有过渡期。依赖该术语的 spec entry 和 KG 边突然断裂。

**[修复]**
引入三态生命周期: `active` → `deprecated` → `removed`

**[Schema 变更]**

```jsonc
{
  "id": "legacy-org",
  "canonical": "Organization",
  "status": "deprecated",             // "active" | "deprecated"
  "deprecated_info": {
    "reason": "Renamed to Tenant in v2.0",
    "successor_id": "tenant",
    "deprecated_at": "2026-06-01T00:00:00Z"
  }
}
```

**[行为变更]**

| 状态 | compact summary | keyword 匹配 | 搜索 |
|------|----------------|-------------|------|
| `active` | 参与 | 正常注入 | 正常展示 |
| `deprecated` | 不参与 | 注入降级提示 | 标记 `[deprecated]` |

**[新增 CLI]**

```bash
maestro domain deprecate <id> [--reason <text>] [--successor <term-id>]
```

**[对现有设计的影响]**
- 第二节 Schema 追加 `status` + `deprecated_info` 字段
- 第八节新增 `deprecate` 子命令
- `maestro domain remove` 增加前置检查: active term 需先 deprecate

---

### D7.2 CJK domain 匹配语义

**[问题]**
domain term 的 aliases 包含中文（如"租户"），当前字符串匹配使用 `prompt.includes(alias)` 对英文有效，但对 CJK 存在问题：(1) 2 字符的中文别名（如"流水"）容易误匹配长词（如"流水线"）；(2) 英文需要词边界匹配但中文无空格分隔。

**[修复]**
统一 `matchDomainTerms()` 函数，对 CJK 和 ASCII 分别处理：

**[实现位置]**
- 新增: `src/tools/domain-matcher.ts`（可复用核心，D5.4 双轨生命周期复用）

**[代码片段]**

```typescript
const CJK_RANGE = /[一-鿿぀-ヿ가-힯]/;

function matchAlias(prompt: string, alias: string): boolean {
  if (CJK_RANGE.test(alias)) {
    // CJK: 包含匹配，但要求别名长度 >= 2 且不是更长词的子串
    if (alias.length < 2) return false;
    const idx = prompt.indexOf(alias);
    if (idx === -1) return false;
    // 检查前后字符是否也是 CJK（避免"流水"匹配"流水线"）
    const before = idx > 0 ? prompt[idx - 1] : '';
    const after = idx + alias.length < prompt.length ? prompt[idx + alias.length] : '';
    if (CJK_RANGE.test(after) || CJK_RANGE.test(before)) return false;
    return true;
  }
  // ASCII: 词边界匹配
  const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
  return re.test(prompt);
}
```

---

### D8.1 空 glossary.json 行为未定义

**[问题]**
glossary.json 存在但 `terms: []` 为空时，各消费方行为未定义。可能出现 compact summary 输出空字符串、搜索索引空值异常等。

**[修复]**
统一的空 glossary 防护——所有消费方遵循同一规则：`terms` 为空是合法状态，消费方静默跳过且不报错。

**[实现位置]**
- 新增: `src/tools/domain-utils.ts` — 统一加载函数

**[代码片段]**

```typescript
interface GlossaryLoadResult {
  exists: boolean;
  glossary: DomainGlossary | null;
  activeTerms: DomainTerm[];
  isEmpty: boolean;
}

function loadGlossary(projectPath: string): GlossaryLoadResult {
  const glossaryPath = join(projectPath, '.workflow', 'domain', 'glossary.json');
  if (!existsSync(glossaryPath))
    return { exists: false, glossary: null, activeTerms: [], isEmpty: false };
  try {
    const glossary = JSON.parse(readFileSync(glossaryPath, 'utf-8'));
    if (!Array.isArray(glossary.terms))
      return { exists: true, glossary, activeTerms: [], isEmpty: true };
    const activeTerms = glossary.terms.filter(t => (t.status ?? 'active') === 'active');
    return { exists: true, glossary, activeTerms, isEmpty: glossary.terms.length === 0 };
  } catch {
    return { exists: false, glossary: null, activeTerms: [], isEmpty: false };
  }
}
```

**[消费方行为契约]**
- keyword-spec-injector: isEmpty → 跳过 compact summary（不注入空字符串）
- WikiIndexer.scanDomain(): isEmpty → return []
- DomainExtractor: isEmpty → return { nodes: [], edges: [] }
- `maestro domain list`: isEmpty → 提示 "No terms. Run `maestro domain discover`."

---

### D8.2 超大 concepts/ 文件

**[问题]**
`concept_ref` 指向的 `concepts/*.md` 文件无大小限制。keyword-spec-injector 展开模式可能将 5000+ 行的 concept 文件注入 LLM context。

**[修复]**
分级读取 + 大小保护：

| 场景 | 限制 | 行为 |
|------|------|------|
| hook 注入 | 500 chars | 仅注入首段摘要 |
| CLI show | 3000 chars | 截断 + 提示总行数 |
| CLI show --full | 无限制 | 完整输出 |

**[代码片段]**

```typescript
const CONCEPT_INJECT_LIMIT = 500;
const CONCEPT_SHOW_LIMIT = 3000;

function readConceptRef(projectPath: string, conceptRef: string, mode: 'inject' | 'show' | 'full'): ConceptContent {
  const content = readFileSync(join(projectPath, '.workflow', 'domain', conceptRef), 'utf-8');
  const summaryMatch = content.match(/^([\s\S]*?)(?:\n\n|\n##)/);
  const summary = (summaryMatch?.[1] ?? content).slice(0, CONCEPT_INJECT_LIMIT);
  const limit = mode === 'inject' ? CONCEPT_INJECT_LIMIT : mode === 'show' ? CONCEPT_SHOW_LIMIT : Infinity;
  const truncated = content.length > limit;
  return {
    summary,
    full: truncated && mode !== 'full' ? content.slice(0, limit) + `\n... (${content.split('\n').length} 行)` : content,
    truncated,
  };
}
```

---

### D8.3 relationships 环形引用

**[问题]**
glossary.json 的 `relationships` 字段允许 A→B→C→A 环形引用。注入机制的"1 级深度关系传播"在遇到环时可能注入重复内容。

**[修复]**
三层防护：

1. **写入验证**: 检测环并警告（不阻塞，因为双向引用 A↔B 是合法的）
2. **遍历 visited set**: 图遍历时维护已访问集合
3. **注入去重**: 同一 term 不会被注入两次

**[代码片段]**

```typescript
// Layer 1: 写入时环检测
function validateRelationships(glossary: DomainGlossary): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const graph = new Map(glossary.terms.map(t => [t.id, t.relationships ?? []]));
  for (const term of glossary.terms) {
    const visited = new Set<string>([term.id]);
    let frontier = [term.id], depth = 0;
    while (frontier.length > 0 && depth < 5) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of graph.get(id) ?? []) {
          if (neighbor === term.id && depth >= 2)
            warnings.push({ termId: term.id, kind: 'cycle', message: `cycle at depth ${depth + 1}` });
          if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
        }
      }
      frontier = next; depth++;
    }
  }
  return warnings;
}

// Layer 3: 注入去重
function buildExpandedInjection(matchedTermIds: string[], glossary: DomainGlossary): string {
  const injected = new Set<string>();
  const sections: string[] = [];
  for (const termId of matchedTermIds) {
    if (injected.has(termId)) continue;
    injected.add(termId);
    const term = glossary.terms.find(t => t.id === termId);
    if (!term) continue;
    sections.push(buildExpandedDefinition(term));
    for (const relId of term.relationships ?? []) {
      if (!injected.has(relId)) {
        injected.add(relId);
        const rel = glossary.terms.find(t => t.id === relId);
        if (rel) sections.push(buildCompactDefinition(rel));
      }
    }
  }
  return sections.join('\n\n');
}
```

---

## 附录 B：Wiki/Knowhow 文件夹重组

### 现状问题

当前 knowhow 目录是**平铺结构**，14 个文件靠前缀区分类型：

```
.workflow/knowhow/
├── DCS-20260427-1912.md    # decision
├── DCS-20260531-1048.md    # decision
├── KNW-20260427-1912.md    # session
├── RCP-20260427-1912.md    # recipe
├── RCP-20260520-1753.md    # recipe
├── RCP-20260530-1630.md    # recipe
├── REF-20260427-1912.md    # reference
├── REF-20260518-0326.md    # reference
├── REF-20260530-1640.md    # reference
├── REF-20260530-ua-kg-wiki-integration.md  # reference
├── REF-20260531-1216.md    # reference
├── TIP-20260427-1912.md    # tip
├── TPL-20260427-1912.md    # template
└── TPL-20260427-1913.md    # template
```

问题：
1. 文件数量增长后（50+），目录浏览困难
2. 前缀只有 3 个字母，类型辨识度低
3. 无法按类型快速定位——需要 `ls | grep DCS` 才能找到所有决策
4. wiki 目录当前**完全空置**，未被使用

### 目标结构

将 knowhow 改为**按 type 分文件夹**，同时明确 wiki 目录的定位：

```
.workflow/
├── knowhow/
│   ├── decisions/              # DCS- 架构决策
│   │   ├── DCS-20260427-1912.md
│   │   └── DCS-20260531-1048.md
│   ├── recipes/                # RCP- 操作配方/最佳实践
│   │   ├── RCP-20260427-1912.md
│   │   ├── RCP-20260520-1753.md
│   │   └── RCP-20260530-1630.md
│   ├── references/             # REF- 参考资料/外部链接
│   │   ├── REF-20260427-1912.md
│   │   ├── REF-20260518-0326.md
│   │   ├── REF-20260530-1640.md
│   │   ├── REF-20260530-ua-kg-wiki-integration.md
│   │   └── REF-20260531-1216.md
│   ├── tips/                   # TIP- 技巧提示
│   │   └── TIP-20260427-1912.md
│   ├── templates/              # TPL- 模板
│   │   ├── TPL-20260427-1912.md
│   │   └── TPL-20260427-1913.md
│   └── sessions/               # KNW- 会话记录
│       └── KNW-20260427-1912.md
├── wiki/                       # 废弃（不再单独使用）
│   └── (空或删除)
└── ...
```

### 前缀 → 文件夹映射

| 前缀 | frontmatter type | 文件夹 |
|------|-----------------|--------|
| `DCS-` | `decision` | `decisions/` |
| `RCP-` | `recipe` | `recipes/` |
| `REF-` | `reference` | `references/` |
| `TIP-` | `tip` | `tips/` |
| `TPL-` | `template` | `templates/` |
| `KNW-` | `session` | `sessions/` |

### 需要改动的文件

#### 1. WikiIndexer — 递归扫描子目录

```typescript
// dashboard/src/server/wiki/wiki-indexer.ts — scanKnowhow 改动

// Before: 单层扫描
// for (const name of await safeReaddir(join(this.workflowRoot, 'knowhow'))) {
//   const entry = await this.parseFileEntry(join(this.workflowRoot, 'knowhow', name), 'knowhow');

// After: 递归扫描（兼容平铺和文件夹两种结构）
private async scanKnowhowDir(dir: string): Promise<WikiEntry[]> {
  const out: WikiEntry[] = [];
  for (const name of await safeReaddir(dir)) {
    const fullPath = join(dir, name);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats) continue;
    if (stats.isDirectory()) {
      // 递归扫描子文件夹
      out.push(...(await this.scanKnowhowDir(fullPath)));
    } else if (stats.isFile() && name.endsWith('.md')) {
      const entry = await this.parseFileEntry(fullPath, 'knowhow');
      if (entry) out.push(entry);
    }
  }
  return out;
}
```

#### 2. WikiWriter — 写入时按 type 路由

```typescript
// dashboard/src/server/wiki/writer.ts — 路由改动

const TYPE_TO_FOLDER: Record<string, string> = {
  decision: 'decisions',
  recipe: 'recipes',
  reference: 'references',
  tip: 'tips',
  template: 'templates',
  session: 'sessions',
};

function resolveKnowhowPath(workflowRoot: string, type: string, filename: string): string {
  const folder = TYPE_TO_FOLDER[type];
  if (folder) {
    const dir = join(workflowRoot, 'knowhow', folder);
    mkdirSync(dir, { recursive: true });
    return join(dir, filename);
  }
  // 未知类型: 放在 knowhow 根目录（向后兼容）
  return join(workflowRoot, 'knowhow', filename);
}
```

#### 3. knowhow capture 命令 — 生成路径更新

```typescript
// /manage-knowhow-capture 命令生成文件时：
// Before: .workflow/knowhow/{PREFIX}-{YYYYMMDD}-{slug}.md
// After:  .workflow/knowhow/{folder}/{PREFIX}-{YYYYMMDD}-{slug}.md
//
// 例：DCS-20260612-auth-decision.md
//   → .workflow/knowhow/decisions/DCS-20260612-auth-decision.md
```

#### 4. 迁移脚本 — 将现有文件移入子目录

```bash
# 一次性迁移（在 maestro init 或手动执行）
cd .workflow/knowhow
mkdir -p decisions recipes references tips templates sessions
for f in DCS-*.md; do [ -f "$f" ] && mv "$f" decisions/; done
for f in RCP-*.md; do [ -f "$f" ] && mv "$f" recipes/; done
for f in REF-*.md; do [ -f "$f" ] && mv "$f" references/; done
for f in TIP-*.md; do [ -f "$f" ] && mv "$f" tips/; done
for f in TPL-*.md; do [ -f "$f" ] && mv "$f" templates/; done
for f in KNW-*.md; do [ -f "$f" ] && mv "$f" sessions/; done
```

### Wiki 目录处理

**结论：wiki 目录废弃。**

| 方案 | 评估 |
|------|------|
| wiki 保留为独立类型 | ❌ 当前为空，`WikiNodeType` 中无 `'wiki'` 类型，从未使用 |
| wiki 合入 knowhow | ✅ knowhow 已覆盖所有知识文档场景 |
| wiki 作为 knowhow 别名 | ❌ 增加混乱 |

`WikiNodeType` 当前定义为 `'project' | 'roadmap' | 'spec' | 'issue' | 'knowhow' | 'note'`，没有 `'wiki'` 类型。`wiki-indexer.ts` 名称中的 "wiki" 指的是**索引系统**，不是文件类型。所有知识文档统一使用 `knowhow` 类型即可。

`.workflow/wiki/` 目录可以安全删除（当前为空）。

### 向后兼容

WikiIndexer 的递归扫描自动兼容两种结构：
- **旧结构**（平铺）：扫描到 `.md` 文件直接索引
- **新结构**（分文件夹）：递归进入子目录扫描 `.md` 文件
- **混合结构**（迁移中）：同时处理根目录和子目录的文件

不需要版本检测或迁移标记。

### 实施时间线

| 步骤 | 预估 | 依赖 |
|------|------|------|
| WikiIndexer 递归扫描 | 0.5 天 | 无 |
| WikiWriter 路由改动 | 0.5 天 | 无 |
| knowhow capture 路径更新 | 0.5 天 | 无 |
| 迁移脚本 + 现有文件移动 | 0.5 天 | 上述完成后 |
| wiki 目录清理 | 即时 | 确认无引用 |

总计：**~2 天**

---
