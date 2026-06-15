# MaestroGraph 统一知识图谱引擎设计文档

> **状态**: ✅ **已完成** (2026-06-15) — MaestroGraph 已全面实现并超越 CodeGraph，`@colbymchenry/codegraph` 依赖已移除。
>
> **关联文档**: [Domain 领域知识系统](./plan-domain-knowledge.md) — Domain 层是 MaestroGraph 的知识源之一，已集成实现。
>
> **参考实现**: ~~CodeGraph~~ — 代码索引层已通过 `web-tree-sitter` + `tree-sitter-wasms` 直接集成，不再依赖外部包。
>
> **实现成果**:
> - 统一 Schema v2: `nodes` + `edges` + `files` + 双 FTS5 虚拟表 (`code_fts` unicode61 / `knowledge_fts` trigram)
> - 6 种知识来源: codegraph / domain / spec / knowhow / codebase / issue
> - 24 项查询能力完整覆盖 (搜索 + 遍历 + 分析)，其中 7 项为 MaestroGraph 独有
> - 937 测试通过，176 项搜索/遍历基准测试全部通过

---

## 一、统一知识图谱（Unified Knowledge Graph）

### 问题：五套孤立的知识系统

当前 maestro 有五套独立的知识存储，各自有索引、搜索、注入机制，但**彼此不知道对方的存在**：

| 系统 | 存储 | 索引 | 搜索 | 注入 |
|------|------|------|------|------|
| CodeGraph (代码图谱) | `.codegraph/` SQLite | tree-sitter AST | FTS5 + BM25 | kg-context-injector hook |
| Spec (约束规则) | `.workflow/specs/*.md` | keyword inverted index | keyword match | spec-injector + keyword-spec-injector |
| Wiki/Knowhow (知识文档) | `.workflow/knowhow/*.md` | WikiIndexer BM25 | `maestro search` | wiki-role-loader |
| Domain (领域定义) | `.workflow/domain/glossary.json` | alias exact match | `maestro search --type domain` | domain section in keyword-spec-injector |
| Codebase (代码文档) | `.workflow/codebase/*.md` | WikiIndexer (virtual) | `maestro search` | 按需读取 |

**核心矛盾**：用户问"Tenant 的数据隔离怎么实现的？"时，答案分散在：
- CodeGraph: `interface Tenant` 在 `src/models/tenant.ts:15`，被 `TenantService.create()` 引用
- Domain: `Tenant = 多租户隔离单元`，关联 `Workspace`, `Permission`
- Spec: `Tenant 数据必须用 RLS 隔离`
- Codebase: `architecture.md` 里的租户架构描述
- Knowhow: `DCS-tenant-isolation.md` 里的架构决策记录

五次查询，五种 API，五种格式。应该**一次查询，一个图，所有答案**。

### 设计目标：参考 CodeGraph 架构，统一为单一知识图谱

CodeGraph 的核心价值是将**代码结构**表达为 `Node + Edge` 的图，通过 SQLite + FTS5 实现高效查询。我们的目标是将 maestro 的**全部知识**（代码 + 领域 + 约束 + 文档 + 决策）统一到同一套图模型中。

```
                    统一知识图谱 (Unified KG)
                    ========================
                         SQLite DB
                    .workflow/kg/maestro.db

    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ CodeGraph │  │  Domain  │  │   Spec   │  │  Wiki/   │  │ Codebase │
    │  Nodes   │  │  Terms   │  │  Entries  │  │ Knowhow  │  │   Docs   │
    │          │  │          │  │          │  │          │  │          │
    │ function │  │ Tenant   │  │ RLS规则  │  │ DCS-租户  │  │ arch.md  │
    │ class    │  │ Workspace│  │ JWT约束  │  │ RCP-认证  │  │ features │
    │ interface│  │ Pipeline │  │ 编码规范  │  │ TIP-缓存  │  │          │
    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
         │             │             │             │             │
         └─────────────┴──────┬──────┴─────────────┴─────────────┘
                              │
                         统一 Edge 层
                    defines / constrains / documents /
                    implements / references / relates_to
```

### Node 统一模型

扩展 CodeGraph 的 Node 概念，新增知识节点类型：

```typescript
// 扩展后的 NodeKind — 在 CodeGraph 原有类型基础上追加
type CodeNodeKind =    // CodeGraph 原有 (保持不变)
  | 'function' | 'method' | 'class' | 'interface' | 'struct'
  | 'trait' | 'enum' | 'module' | 'property' | 'field'
  | 'variable' | 'constant' | 'enum_member' | 'type_alias'
  | 'namespace' | 'parameter' | 'import' | 'export'
  | 'route' | 'component';

type KnowledgeNodeKind = // Maestro 新增
  | 'domain_term'      // Domain glossary term
  | 'spec_entry'       // Spec constraint/rule
  | 'knowhow_entry'    // Wiki knowhow document
  | 'codebase_section' // Codebase doc section
  | 'issue'            // Issue tracker entry
  | 'decision'         // Architecture decision record
  | 'requirement';     // Requirement from context-package

type UnifiedNodeKind = CodeNodeKind | KnowledgeNodeKind;
```

### Edge 统一模型

扩展 CodeGraph 的 Edge 概念，新增知识关系类型：

```typescript
// CodeGraph 原有 Edge 类型 (保持不变)
type CodeEdgeKind =
  | 'contains' | 'calls' | 'imports' | 'exports'
  | 'extends' | 'implements' | 'references'
  | 'type_of' | 'returns' | 'instantiates'
  | 'overrides' | 'decorates';

// Maestro 新增 Edge 类型
type KnowledgeEdgeKind =
  | 'defines'          // domain_term → code (Tenant 定义对应 interface Tenant)
  | 'constrains'       // spec_entry → code (RLS规则 约束 TenantRepository)
  | 'documents'        // knowhow → code (DCS-tenant-isolation 记录 TenantService)
  | 'relates_to'       // domain_term → domain_term (Tenant 关联 Workspace)
  | 'implements_rule'  // code → spec_entry (TenantRepo.findAll 实现了 RLS规则)
  | 'resolves'         // code → issue (commit abc123 解决了 ISS-001)
  | 'derived_from'     // spec_entry → decision (RLS规则 来源于 DCS-tenant-isolation)
  | 'supersedes'       // decision → decision (新决策替代旧决策)
  | 'aliases';         // domain_term → domain_term (同义词关系)

type UnifiedEdgeKind = CodeEdgeKind | KnowledgeEdgeKind;
```

### SQLite Schema 设计

参考 CodeGraph 的 schema 模式（nodes + edges + FTS5），扩展为统一 schema：

```sql
-- 统一节点表 — 兼容 CodeGraph 原有字段 + 知识扩展字段
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,              -- UnifiedNodeKind
  name          TEXT NOT NULL,              -- 标准名称
  qualified_name TEXT,                      -- 完全限定名
  file_path     TEXT,                       -- 代码节点: 文件路径; 知识节点: 来源文件
  language      TEXT,                       -- 代码节点: 编程语言; 知识节点: null
  start_line    INTEGER DEFAULT 0,
  end_line      INTEGER DEFAULT 0,

  -- CodeGraph 原有字段 (代码节点使用)
  docstring     TEXT,
  signature     TEXT,
  visibility    TEXT,
  is_exported   INTEGER DEFAULT 0,

  -- 知识扩展字段 (知识节点使用)
  source_type   TEXT,                       -- 'codegraph' | 'domain' | 'spec' | 'knowhow' | 'codebase' | 'issue'
  definition    TEXT,                       -- domain_term: 一行定义; spec_entry: 规则内容
  aliases       TEXT,                       -- JSON array of alias strings
  keywords      TEXT,                       -- JSON array of keyword strings
  category      TEXT,                       -- spec category / knowhow type
  roles         TEXT,                       -- JSON array of agent roles
  priority      TEXT,                       -- 'must' | 'should' | 'may' (for requirements)
  status        TEXT,                       -- 'active' | 'locked' | 'deprecated' | 'superseded'
  body          TEXT,                       -- 完整内容（knowhow body, spec content）
  metadata      TEXT,                       -- JSON catch-all for type-specific data

  updated_at    INTEGER NOT NULL
);

-- 统一边表 — 兼容 CodeGraph + 知识关系
CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL REFERENCES nodes(id),
  target    TEXT NOT NULL REFERENCES nodes(id),
  kind      TEXT NOT NULL,                  -- UnifiedEdgeKind
  metadata  TEXT,                           -- JSON
  line      INTEGER,
  col       INTEGER,
  provenance TEXT,                          -- 'codegraph' | 'domain' | 'spec' | 'harvest' | 'manual'
  UNIQUE(source, target, kind)
);

-- FTS5 全文索引 — 覆盖代码 + 知识
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id,
  name,
  qualified_name,
  docstring,
  definition,                              -- domain/spec 定义文本
  body,                                    -- knowhow/codebase 完整内容
  aliases,                                 -- domain 别名
  keywords,                                -- spec/domain 关键词
  content='nodes',
  content_rowid='rowid'
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON nodes(source_type);
CREATE INDEX IF NOT EXISTS idx_nodes_category ON nodes(category);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);
CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);

-- 文件追踪表 (CodeGraph 兼容)
CREATE TABLE IF NOT EXISTS files (
  path          TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  language      TEXT,
  size          INTEGER,
  modified_at   INTEGER,
  indexed_at    INTEGER,
  node_count    INTEGER DEFAULT 0,
  source_type   TEXT DEFAULT 'codegraph'    -- 'codegraph' | 'spec' | 'knowhow' | 'domain'
);

-- Schema 版本
CREATE TABLE IF NOT EXISTS schema_versions (
  version       INTEGER PRIMARY KEY,
  applied_at    INTEGER NOT NULL,
  description   TEXT
);
```

### 数据同步策略

#### 方案选择：增量同步 + 双源适配器

**不重写 CodeGraph**，而是将其作为代码层的数据源，通过适配器同步到统一 KG：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Sync Orchestrator                          │
│                 maestro kg sync [--full | --incremental]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────────────────────┐   │
│  │ CodeGraph Source │    │    Knowledge Source Adapters      │   │
│  │   .codegraph/   │    │                                  │   │
│  │   SQLite DB     │    │  DomainAdapter                   │   │
│  │                 │    │    .workflow/domain/glossary.json │   │
│  │  Reads nodes +  │    │    → domain_term nodes           │   │
│  │  edges from CG  │    │    → relates_to edges            │   │
│  │  → inserts into │    │                                  │   │
│  │  unified KG     │    │  SpecAdapter                     │   │
│  │  with source_   │    │    .workflow/specs/*.md           │   │
│  │  type=codegraph │    │    → spec_entry nodes            │   │
│  │                 │    │    → constrains edges (to code)   │   │
│  └────────┬────────┘    │                                  │   │
│           │             │  WikiAdapter                     │   │
│           │             │    .workflow/knowhow/*.md         │   │
│           │             │    → knowhow_entry nodes          │   │
│           │             │    → documents edges              │   │
│           │             │                                  │   │
│           │             │  CodebaseAdapter                  │   │
│           │             │    .workflow/codebase/*.md         │   │
│           │             │    → codebase_section nodes       │   │
│           │             │                                  │   │
│           │             │  IssueAdapter                    │   │
│           │             │    .workflow/issues/issues.jsonl   │   │
│           │             │    → issue nodes                  │   │
│           │             └──────────────────────────────────┘   │
│           │                         │                          │
│           └────────────┬────────────┘                          │
│                        ▼                                       │
│              .workflow/kg/maestro.db                            │
│              (Unified Knowledge Graph)                          │
└─────────────────────────────────────────────────────────────────┘
```

#### 同步触发时机

| 触发 | 范围 | 机制 |
|------|------|------|
| `maestro kg sync` | 全量 | 手动命令 |
| `UserPromptSubmit` hook | 增量（变更文件） | kg-sync hook（已有） |
| `finish-work` Step 3.5 | Domain 增量 | 新 domain term 注册后 |
| `spec add` | Spec 增量 | 新 spec entry 添加后 |
| `knowhow add` | Wiki 增量 | 新 knowhow 添加后 |
| git commit | CodeGraph 增量 | codegraph sync（已有） |

#### 增量同步逻辑

```typescript
// src/graph/kg-sync-orchestrator.ts

interface SyncResult {
  source: string;
  nodesAdded: number;
  nodesUpdated: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
  durationMs: number;
}

async function syncKnowledgeGraph(
  projectPath: string,
  options: { full?: boolean; sources?: string[] }
): Promise<SyncResult[]> {
  const db = openKgDatabase(projectPath);
  const results: SyncResult[] = [];

  // 1. CodeGraph → Unified KG (如果 .codegraph/ 存在)
  if (shouldSync('codegraph', options)) {
    results.push(await syncFromCodeGraph(db, projectPath));
  }

  // 2. Domain → Unified KG
  if (shouldSync('domain', options)) {
    results.push(await syncFromDomain(db, projectPath));
  }

  // 3. Spec → Unified KG
  if (shouldSync('spec', options)) {
    results.push(await syncFromSpec(db, projectPath));
  }

  // 4. Wiki/Knowhow → Unified KG
  if (shouldSync('knowhow', options)) {
    results.push(await syncFromWiki(db, projectPath));
  }

  // 5. Cross-source edge resolution
  //    匹配 domain_term.canonical 与 code node.name
  //    → 自动建立 defines edge
  results.push(await resolveKnowledgeEdges(db));

  return results;
}
```

### Cross-source Edge Resolution（跨源边解析）

这是统一图谱的**核心价值**——自动发现知识层与代码层之间的关系：

```typescript
// 自动边解析规则

// Rule 1: domain_term → code node (defines)
// 当 domain term 的 canonical/aliases 匹配 code node 的 name
// → 建立 defines edge
// 例: domain:Tenant defines→ code:interface:Tenant

// Rule 2: spec_entry → code node (constrains)
// 当 spec entry 的 keywords 匹配 code node 所在文件/模块
// → 建立 constrains edge
// 例: spec:rls-isolation constrains→ code:TenantRepository.findAll

// Rule 3: knowhow → code node (documents)
// 当 knowhow entry 的 keywords/title 匹配 code symbols
// → 建立 documents edge
// 例: knowhow:DCS-tenant-isolation documents→ code:TenantService

// Rule 4: spec_entry → domain_term (derived_from)
// 当 spec entry 有 domain="" 属性
// → 建立 derived_from edge
// 例: spec:rls-isolation derived_from→ domain:tenant

// Rule 5: domain_term → domain_term (relates_to)
// 从 glossary.json 的 relationships 字段直接映射
// 例: domain:tenant relates_to→ domain:workspace
```

### 统一查询 API

```typescript
// src/graph/kg-query.ts

// 单一入口: 跨所有知识层查询
async function queryKnowledgeGraph(
  query: string,
  options?: {
    sourceTypes?: string[];   // 限定来源: 'codegraph' | 'domain' | 'spec' | 'knowhow'
    nodeKinds?: string[];     // 限定节点类型
    maxDepth?: number;        // 图遍历深度
    limit?: number;
  }
): Promise<KgQueryResult>

interface KgQueryResult {
  // FTS5 直接匹配的节点
  directMatches: UnifiedNode[];
  // 通过边关系发现的关联节点（1-2 hop）
  relatedNodes: Array<{
    node: UnifiedNode;
    path: UnifiedEdge[];      // 到达路径
    relevance: number;        // 关联强度
  }>;
  // 聚合摘要
  summary: {
    codeSymbols: number;
    domainTerms: number;
    specRules: number;
    knowhowDocs: number;
  };
}
```

#### 查询示例

用户问："Tenant 的数据隔离怎么实现的？"

```
queryKnowledgeGraph("Tenant 数据隔离")
  │
  ├─ FTS5 直接命中:
  │   [domain_term] Tenant: 多租户隔离单元
  │   [spec_entry] RLS数据隔离: 所有Tenant查询必须通过RLS
  │   [interface] Tenant (src/models/tenant.ts:15)
  │
  ├─ 1-hop 关系扩展:
  │   Tenant ──defines──→ interface:Tenant
  │   Tenant ──relates_to──→ Workspace, Permission
  │   spec:RLS ──constrains──→ TenantRepository.findAll
  │   spec:RLS ──derived_from──→ DCS-tenant-isolation
  │
  ├─ 2-hop 扩展:
  │   interface:Tenant ──contains──→ Tenant.id, Tenant.name, Tenant.config
  │   TenantRepository ──calls──→ applyRlsPolicy()
  │
  └─ 组装输出:
     code:   interface Tenant (src/models/tenant.ts:15) — 5 fields, 3 methods
     domain: Tenant = 多租户隔离单元 → Workspace, Permission
     spec:   RLS规则: 所有查询必须通过 RLS policy
     knowhow: DCS-tenant-isolation — 架构决策记录
     code:   TenantRepository.findAll → applyRlsPolicy()
```

### Hook 注入升级

统一 KG 建成后，现有的多个 injector hook 可以合并为一个：

```
现在 (5 个独立 hook):
  keyword-spec-injector  (UserPromptSubmit) — spec keyword 匹配
  spec-injector          (PreToolUse:Agent) — spec category 注入
  kg-context-injector    (PreToolUse:Agent) — code graph 注入
  domain-injector        (集成在 keyword-spec-injector 中)
  wiki-role-loader       (集成在 spec-injector 中)

未来 (1 个统一 hook):
  kg-unified-injector    (UserPromptSubmit + PreToolUse:Agent)
    → 单次 KG 查询
    → 按 source_type 分组组装 sections
    → context budget 统一管控
    → 输出 <maestro-context> 包含所有层
```

### 与 CodeGraph 的关系

| 维度 | 不重写 CodeGraph | 理由 |
|------|-----------------|------|
| 代码解析 | 复用 CodeGraph 的 tree-sitter 提取 | 19 语言 + 21 框架，自己写成本巨大 |
| 代码 SQLite | 保留 `.codegraph/` 作为代码源 | CodeGraph 有自己的 sync/watch 机制 |
| MCP Server | 保留 CodeGraph MCP（codegraph_search 等） | agent 直接用的工具不变 |
| 统一 KG | 新建 `.workflow/kg/maestro.db` | 从 CodeGraph + 知识源增量同步 |
| 知识查询 | 新增 `maestro kg query` | 跨所有层的统一查询入口 |

**核心原则：CodeGraph 是代码层的"真相源"，统一 KG 是它的超集——包含代码 + 领域 + 约束 + 文档。**

### CLI 命令

```bash
# 图谱管理
maestro kg init                           # 创建 .workflow/kg/maestro.db
maestro kg sync                           # 增量同步全部源
maestro kg sync --source codegraph        # 只同步代码图谱
maestro kg sync --source domain,spec      # 只同步指定源
maestro kg sync --full                    # 全量重建
maestro kg stats                          # 图谱统计

# 统一查询
maestro kg query "Tenant"                 # 跨所有层查询
maestro kg query "Tenant" --source domain,codegraph  # 限定源
maestro kg query "Tenant" --depth 2       # 扩展到 2 hop

# 图遍历
maestro kg context <node-id>              # 显示节点的完整上下文（所有关联）
maestro kg path <from-id> <to-id>         # 两个节点之间的最短路径

# 搜索 (替代现有 maestro search)
maestro search "tenant"                   # → 路由到 kg query
maestro search "tenant" --type domain     # → kg query --source domain
```

### 实现分期

| Phase | 内容 | 依赖 | 优先级 |
|-------|------|------|--------|
| Phase A | 统一 Schema + DB 初始化 + Migration | 无 | P1 |
| Phase B | Source Adapters (Domain, Spec, Wiki, Issue) | Phase A | P1 |
| Phase C | CodeGraph Adapter (从 .codegraph/ 同步) | Phase A + codegraph 已安装 | P1 |
| Phase D | Cross-source Edge Resolution | Phase B + C | P2 |
| Phase E | 统一查询 API (kg query / kg context) | Phase D | P2 |
| Phase F | Hook 统一 (kg-unified-injector) | Phase E | P3 |
| Phase G | `maestro search` 路由到 KG 查询 | Phase E | P3 |

Phase A-C 可并行开发。Phase D 是核心价值（跨层关联），Phase E-G 是上层消费。

### 风险和 trade-off

| 风险 | 缓解 |
|------|------|
| SQLite DB 膨胀（代码 + 知识） | 知识节点不存储 body 全文，只存摘要 + 引用路径 |
| CodeGraph 版本升级导致 schema 不兼容 | 适配器层隔离，只读 CodeGraph 不修改 |
| 跨源 edge resolution 误匹配 | 高置信度才建边：exact name match + same-domain keyword |
| 同步延迟（知识文件变更后 KG 未更新） | hook 触发增量同步 + `maestro kg sync` 兜底 |
| 多处存储增加复杂度 | 原始文件保持不变，KG 是只读索引，删了可重建 |

---

## 二、方案对比：适配器 vs 重写

### 两种路径

| 维度 | 方案 A：适配器同步（第十三章） | 方案 B：参考 CodeGraph 重写 |
|------|-------------------------------|---------------------------|
| 核心思路 | 保留 CodeGraph + 各知识源不变，新建 maestro.db 通过 adapter 同步 | 将 CodeGraph 的核心能力内化到 maestro，构建原生统一引擎 |
| 代码解析 | 依赖外部 `@colbymchenry/codegraph` npm 包 | 内置 tree-sitter WASM，自己拥有解析层 |
| 数据源 | 2 个 DB（.codegraph/ + .workflow/kg/）+ 多个原始文件 | 1 个 DB（.workflow/kg/maestro.db）+ 原始文件作为来源 |
| 同步机制 | adapter 层做 ETL（extract-transform-load） | 统一 extractor 直接写入同一 DB |
| 知识节点 | 二等公民（从外部同步进来，有延迟） | 一等公民（和代码节点同一管道） |
| 外部依赖 | codegraph（~15MB，19 个 WASM grammar） | 内置 tree-sitter + 按需 WASM grammar |
| 开发成本 | 低（~2 周 adapter + query 层） | 中高（~4-6 周引擎 + adapter + query 层） |
| 维护成本 | 跟随 codegraph 版本升级 | 自主掌控，但需维护 tree-sitter 更新 |
| MCP 暴露 | 2 套 MCP tools（codegraph + maestro kg） | 1 套 MCP tools（统一的 maestro kg） |
| 查询延迟 | 跨 DB join 需要双查 | 单 DB 查询，原生 SQL join |
| 数据一致性 | 同步窗口内可能不一致 | 始终一致 |

### 推荐：方案 B 重写

理由：
1. **消除同步层** — 适配器方案的核心问题是两个 DB 之间的同步永远存在数据不一致窗口
2. **消除外部依赖** — codegraph 是第三方包，API 变更不可控
3. **原生 cross-source 边** — 代码提取时就能同时看到 domain/spec，当场建立 `defines` / `constrains` 边，不需要事后解析
4. **单一查询引擎** — 一个 FTS5 index 覆盖所有，不需要多源聚合
5. **已有 70% 的基础** — maestro 已有 WikiIndexer (BM25)、spec-keyword-index、codegraph-adapter，重写是整合不是从零开始

---

## 三、重写方案：MaestroGraph 统一引擎

### 架构总览

```
                       MaestroGraph
              .workflow/kg/maestro.db (SQLite)
        ┌──────────────────────────────────────────┐
        │              Unified Engine               │
        │                                          │
        │  ┌────────────────────────────────────┐  │
        │  │         Extraction Layer           │  │
        │  │                                    │  │
        │  │  CodeExtractor     KnowledgeExtractor │
        │  │  (tree-sitter)     (md/json parser)   │
        │  │   ↓                  ↓              │  │
        │  │  code nodes      knowledge nodes    │  │
        │  │  code edges      knowledge edges    │  │
        │  └───────────┬──────────┬─────────────┘  │
        │              │          │                 │
        │  ┌───────────▼──────────▼─────────────┐  │
        │  │         Storage Layer              │  │
        │  │  SQLite + FTS5 + WAL               │  │
        │  │  nodes / edges / files / metadata  │  │
        │  └───────────┬────────────────────────┘  │
        │              │                           │
        │  ┌───────────▼────────────────────────┐  │
        │  │         Query Layer                │  │
        │  │  FTS5 search + graph traversal     │  │
        │  │  cross-source edge resolution      │  │
        │  │  context builder (for hook inject) │  │
        │  └───────────┬────────────────────────┘  │
        │              │                           │
        │  ┌───────────▼────────────────────────┐  │
        │  │         Surface Layer              │  │
        │  │  CLI (maestro kg)                  │  │
        │  │  MCP Server (maestro-kg-tools)     │  │
        │  │  Hook injector (kg-unified-inject) │  │
        │  └────────────────────────────────────┘  │
        └──────────────────────────────────────────┘
```

### 模块分解：从 CodeGraph 取什么、自己写什么

| CodeGraph 模块 | 大小 | 取/弃 | 理由 |
|----------------|------|-------|------|
| `src/extraction/tree-sitter.ts` | 核心 | **取** | tree-sitter WASM 解析，直接复用 |
| `src/extraction/languages/*.ts` | 19 文件 | **取** | 语言提取规则，逐文件复用 |
| `src/extraction/grammars.ts` | 中 | **取** | WASM grammar 加载/缓存 |
| `src/extraction/parse-worker.ts` | 中 | **取** | worker 线程解析 + 内存管理 |
| `src/extraction/wasm/*.wasm` | 19 文件 ~15MB | **取** | tree-sitter WASM 二进制 |
| `src/resolution/` | 21 框架 | **取** | 框架级引用解析（Express, React 等） |
| `src/db/sqlite-adapter.ts` | 小 | **改写** | 改用 maestro 已有的 sqlite 基础 |
| `src/db/queries.ts` | 大 | **改写** | 扩展 schema，统一 node/edge 类型 |
| `src/graph/traversal.ts` | 中 | **取** | BFS/DFS 图遍历，直接复用 |
| `src/context/` | 中 | **改写** | context builder 需要适配知识节点 |
| `src/mcp/` | 中 | **弃** | 自己实现 MCP server，暴露统一工具 |
| `src/installer/` | 中 | **弃** | maestro 有自己的安装系统 |
| `src/sync/` | 中 | **取** | file watcher + hash diff，复用 |
| `src/search/` | 小 | **取** | query parser + scoring utils |

**取 = 直接复用源码（MIT 许可证允许）；改写 = 基于其设计重写；弃 = 不需要。**

### 目录结构

```
src/graph/kg/                         # MaestroGraph 统一引擎
├── engine.ts                         # 主入口类 MaestroGraph (对标 CodeGraph 的 index.ts)
├── schema.sql                        # 统一 SQLite schema
├── migrations.ts                     # Schema 版本迁移
│
├── db/                               # 存储层
│   ├── connection.ts                 # SQLite 连接管理 (WAL + FTS5)
│   ├── queries.ts                    # 统一 CRUD (扩展 CodeGraph 的 QueryBuilder)
│   └── types.ts                      # UnifiedNode, UnifiedEdge 类型定义
│
├── extraction/                       # 提取层
│   ├── code/                         # 代码提取 (从 CodeGraph 复用)
│   │   ├── tree-sitter.ts            # tree-sitter WASM 解析核心
│   │   ├── parse-worker.ts           # worker 线程解析
│   │   ├── grammars.ts               # WASM grammar 加载
│   │   ├── languages/                # 19 个语言提取器 (直接复用)
│   │   │   ├── typescript.ts
│   │   │   ├── python.ts
│   │   │   └── ...
│   │   └── wasm/                     # tree-sitter WASM 二进制 (直接复用)
│   │       ├── tree-sitter-typescript.wasm
│   │       └── ...
│   │
│   ├── knowledge/                    # 知识提取 (新写)
│   │   ├── domain-extractor.ts       # glossary.json → domain_term nodes + relates_to edges
│   │   ├── spec-extractor.ts         # specs/*.md → spec_entry nodes + constrains edges
│   │   ├── wiki-extractor.ts         # knowhow/*.md → knowhow_entry nodes + documents edges
│   │   ├── codebase-extractor.ts     # codebase/*.md → codebase_section nodes
│   │   ├── issue-extractor.ts        # issues.jsonl → issue nodes
│   │   └── context-pkg-extractor.ts  # context-package.json → requirement/decision nodes
│   │
│   └── orchestrator.ts               # 统一编排：code + knowledge 提取 → 同一 DB
│
├── resolution/                       # 引用解析 (从 CodeGraph 复用 + 扩展)
│   ├── code-resolver.ts              # 代码级引用解析 (复用 CodeGraph 的 21 个框架)
│   ├── frameworks/                   # 框架解析器 (直接复用)
│   │   ├── express.ts
│   │   ├── react.ts
│   │   └── ...
│   ├── knowledge-resolver.ts         # 知识级跨源边解析 (新写)
│   │   # domain_term.canonical ↔ code.name → defines edge
│   │   # spec_entry.keywords ↔ code.file_path → constrains edge
│   │   # knowhow.keywords ↔ code.name → documents edge
│   └── index.ts                      # 统一 resolver 入口
│
├── query/                            # 查询层
│   ├── search.ts                     # FTS5 统一搜索 (扩展 CodeGraph 的 searchNodes)
│   ├── traversal.ts                  # 图遍历 (复用 CodeGraph 的 BFS/DFS)
│   ├── context-builder.ts            # 上下文组装 (改写，支持知识节点)
│   └── query-parser.ts              # 查询解析 (复用 CodeGraph 的 field-qualified 解析)
│
├── sync/                             # 增量同步
│   ├── file-watcher.ts               # 文件变更监听 (复用 CodeGraph 的 chokidar)
│   ├── incremental-sync.ts           # hash diff 增量同步 (复用 + 扩展到知识文件)
│   └── hook-trigger.ts               # hook 触发的增量更新
│
└── surface/                          # 对外接口
    ├── cli.ts                        # maestro kg 命令
    ├── mcp-tools.ts                  # MCP tool 定义
    └── hook-injector.ts              # 统一注入 hook (替代现有 5 个 hook)
```

### 统一 Extraction Pipeline

CodeGraph 的 extraction 流程是：

```
scan files → detect language → tree-sitter parse → extract nodes+edges → store to DB
```

MaestroGraph 扩展为**双轨 extraction**：

```
                    Unified Orchestrator
                          │
            ┌─────────────┴──────────────┐
            ▼                            ▼
    Code Extraction               Knowledge Extraction
    (tree-sitter)                 (md/json parser)
            │                            │
    ┌───────┴────────┐          ┌────────┴─────────┐
    │ scan .ts/.py/  │          │ scan .workflow/   │
    │ .go/.rs/...    │          │   domain/         │
    │                │          │   specs/           │
    │ tree-sitter    │          │   knowhow/         │
    │ AST parse      │          │   issues/          │
    │                │          │   codebase/         │
    │ → code nodes   │          │                    │
    │ → code edges   │          │ markdown/json      │
    └───────┬────────┘          │ parse              │
            │                   │                    │
            │                   │ → knowledge nodes  │
            │                   │ → knowledge edges  │
            │                   └────────┬───────────┘
            │                            │
            └─────────────┬──────────────┘
                          ▼
                Knowledge Resolution
                (cross-source edges)
                          │
                  domain:Tenant
                      │ defines
                      ▼
                  code:interface:Tenant
                      │ constrains (from spec)
                      ▼
                  spec:rls-isolation
                          │
                          ▼
                   Write to DB
              .workflow/kg/maestro.db
```

### Knowledge Extractor 设计

每个知识源有自己的 extractor，但共享同一个输出管道：

```typescript
// src/graph/kg/extraction/knowledge/domain-extractor.ts

interface ExtractionResult {
  nodes: UnifiedNode[];
  edges: UnifiedEdge[];
  fileRecord: FileRecord;
}

export function extractDomain(
  glossaryPath: string,
  glossary: DomainGlossary
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];

  for (const term of glossary.terms) {
    // 1. 创建 domain_term node
    nodes.push({
      id: `domain:${term.id}`,
      kind: 'domain_term',
      name: term.canonical,
      sourceType: 'domain',
      definition: term.definition,
      aliases: JSON.stringify(term.aliases),
      keywords: JSON.stringify(term.keywords),
      filePath: glossaryPath,
      status: 'active',
    });

    // 2. 创建 relates_to edges (从 relationships 字段)
    for (const relId of term.relationships) {
      edges.push({
        source: `domain:${term.id}`,
        target: `domain:${relId}`,
        kind: 'relates_to',
        provenance: 'domain',
      });
    }

    // 3. 创建 aliases edges (别名关系)
    for (const alias of term.aliases) {
      // 别名作为虚拟节点或存储在 aliases 字段中
      // 搜索时 FTS5 会覆盖 aliases 字段
    }
  }

  return { nodes, edges, fileRecord: { path: glossaryPath, ... } };
}
```

```typescript
// src/graph/kg/extraction/knowledge/spec-extractor.ts

export function extractSpec(
  specFilePath: string,
  entries: SpecEntryParsed[]
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];

  for (const entry of entries) {
    nodes.push({
      id: `spec:${specFilePath}:${entry.lineStart}`,
      kind: 'spec_entry',
      name: entry.title,
      sourceType: 'spec',
      definition: entry.content,
      keywords: JSON.stringify(entry.keywords),
      category: entry.category,
      roles: JSON.stringify(entry.roles),
      filePath: specFilePath,
      status: 'active',
    });

    // 如果有 domain="" 属性，创建 derived_from edge
    if (entry.domain) {
      edges.push({
        source: `spec:${specFilePath}:${entry.lineStart}`,
        target: `domain:${entry.domain}`,
        kind: 'derived_from',
        provenance: 'spec',
      });
    }
  }

  return { nodes, edges, fileRecord: { path: specFilePath, ... } };
}
```

### Knowledge Resolver：跨源边自动发现

这是重写方案相比适配器方案的**核心优势**——在同一个 DB 内直接 SQL join 发现跨层关系：

```typescript
// src/graph/kg/resolution/knowledge-resolver.ts

export function resolveKnowledgeEdges(db: SqliteDatabase): ResolutionResult {
  const edgesCreated: UnifiedEdge[] = [];

  // Rule 1: domain_term → code (defines)
  // 在同一 DB 内 join，零延迟
  const definesMatches = db.prepare(`
    SELECT d.id AS domain_id, c.id AS code_id, c.kind AS code_kind
    FROM nodes d
    JOIN nodes c ON (
      -- canonical name 精确匹配 code node name
      d.name = c.name
      -- 或者别名匹配
      OR EXISTS (
        SELECT 1 FROM json_each(d.aliases) AS a
        WHERE a.value = c.name
      )
    )
    WHERE d.source_type = 'domain'
      AND c.source_type = 'codegraph'
      AND c.kind IN ('class', 'interface', 'struct', 'type_alias', 'enum')
  `).all();

  for (const m of definesMatches) {
    edgesCreated.push({
      source: m.domain_id,
      target: m.code_id,
      kind: 'defines',
      provenance: 'knowledge-resolver',
    });
  }

  // Rule 2: spec_entry → code (constrains)
  // spec 的 keywords 匹配 code node 所在模块/文件
  const constrainsMatches = db.prepare(`
    SELECT s.id AS spec_id, c.id AS code_id
    FROM nodes s
    JOIN nodes c ON (
      EXISTS (
        SELECT 1 FROM json_each(s.keywords) AS kw
        WHERE c.name LIKE '%' || kw.value || '%'
           OR c.file_path LIKE '%' || kw.value || '%'
      )
    )
    WHERE s.source_type = 'spec'
      AND c.source_type = 'codegraph'
      AND c.kind IN ('function', 'method', 'class')
    LIMIT 500
  `).all();

  for (const m of constrainsMatches) {
    edgesCreated.push({
      source: m.spec_id,
      target: m.code_id,
      kind: 'constrains',
      provenance: 'knowledge-resolver',
    });
  }

  // Rule 3: knowhow → code (documents)
  // 类似 Rule 2，基于 keywords 匹配

  return { edgesCreated: edgesCreated.length, edges: edgesCreated };
}
```

### 统一 Hook Injector

替代现有 5 个 hook 的单一注入器：

```typescript
// src/graph/kg/surface/hook-injector.ts

export async function evaluateUnifiedInjection(
  prompt: string,
  agentType: string | null,  // null = UserPromptSubmit, string = PreToolUse:Agent
  projectPath: string,
  sessionId: string
): Promise<InjectionResult> {

  const db = openKgDatabase(projectPath);
  const tokens = tokenizePrompt(prompt);

  // 1. FTS5 搜索 — 一次查询覆盖所有知识层
  const directHits = db.prepare(`
    SELECT id, kind, source_type, name, definition, body,
           bm25(nodes_fts, 0, 20, 5, 1, 2, 5, 5) AS score
    FROM nodes_fts
    JOIN nodes ON nodes_fts.id = nodes.id
    WHERE nodes_fts MATCH ?
    ORDER BY score
    LIMIT 15
  `).all(buildFtsQuery(tokens));

  // 2. 图遍历 — 从命中节点扩展 1 hop
  const related = expandRelated(db, directHits.map(h => h.id), { maxDepth: 1 });

  // 3. 按 source_type 分组组装 sections
  const sections: ContextSection[] = [];

  const domainHits = [...directHits, ...related].filter(n => n.source_type === 'domain');
  if (domainHits.length > 0) {
    sections.push({ label: `domain[${domainHits.map(n => n.name).join(',')}]`, lines: formatDomain(domainHits) });
  }

  const specHits = [...directHits, ...related].filter(n => n.source_type === 'spec');
  if (specHits.length > 0) {
    sections.push({ label: `spec[${specHits.map(n => n.category).join(',')}]`, lines: formatSpec(specHits) });
  }

  const codeHits = [...directHits, ...related].filter(n => n.source_type === 'codegraph');
  if (codeHits.length > 0) {
    sections.push({ label: 'kg-symbols', lines: formatCode(codeHits) });
  }

  // 4. Agent-type 特化：PreToolUse 时加载 role-based spec
  if (agentType) {
    const roleCategories = AGENT_CATEGORY_MAP[agentType];
    if (roleCategories) {
      const roleSpecs = loadByCategory(db, roleCategories);
      sections.push({ label: `role-specs[${roleCategories.join(',')}]`, lines: formatSpec(roleSpecs) });
    }
  }

  // 5. Always-inject domain compact summary
  const compactSummary = getCompactDomainSummary(db);
  if (compactSummary) {
    sections.unshift({ label: 'domain-compact', lines: [compactSummary] });
  }

  // 6. Context budget 管控
  const content = wrapMaestroContext(sections, computeBudget(sections));
  const budget = evaluateContextBudget(content, sessionId);

  return { inject: budget.action !== 'skip', content: budget.content };
}
```

### MCP Tool 定义

替代 CodeGraph 的 `codegraph_search` / `codegraph_node` / `codegraph_explore`：

```typescript
// MCP Tools — 统一暴露

// 1. maestro_kg_search — 跨所有层搜索
//    替代: codegraph_search + maestro search
{
  name: 'maestro_kg_search',
  description: 'Search across code symbols, domain terms, spec rules, and knowledge docs',
  inputSchema: {
    query: string,           // 搜索词
    sourceTypes?: string[],  // 'codegraph' | 'domain' | 'spec' | 'knowhow' | 'issue'
    nodeKinds?: string[],    // 'function' | 'domain_term' | 'spec_entry' | ...
    limit?: number,
  }
}

// 2. maestro_kg_context — 获取节点完整上下文（含关联）
//    替代: codegraph_node + codegraph_explore
{
  name: 'maestro_kg_context',
  description: 'Get full context for a node including related code, specs, and domain knowledge',
  inputSchema: {
    nodeId: string,
    depth?: number,          // 图遍历深度 (默认 1)
    includeCode?: boolean,   // 是否内联源码
  }
}

// 3. maestro_kg_explore — 智能上下文探索
//    替代: codegraph_explore
{
  name: 'maestro_kg_explore',
  description: 'Explore the unified knowledge graph for a task or question',
  inputSchema: {
    query: string,           // 自然语言问题
    projectPath: string,
  }
}
```

### 实现分期

| Phase | 内容 | 工期 | 产出 |
|-------|------|------|------|
| **R1: Foundation** | 统一 schema + DB 层 + 类型定义 | 3 天 | `.workflow/kg/maestro.db` 可创建，CRUD 可用 |
| **R2: Knowledge Extractors** | domain/spec/wiki/issue/codebase 提取器 | 4 天 | 知识节点可提取入库 |
| **R3: Code Extraction** | 从 CodeGraph 移植 tree-sitter + languages | 5 天 | 代码节点可提取入库 |
| **R4: Resolution** | CodeGraph 框架解析器 + knowledge-resolver | 3 天 | 跨源边自动建立 |
| **R5: Query + Search** | FTS5 统一搜索 + 图遍历 + context builder | 3 天 | `maestro kg query/search/context` 可用 |
| **R6: CLI + Sync** | maestro kg 命令 + 增量同步 + file watcher | 3 天 | `maestro kg init/sync/stats` 可用 |
| **R7: Hook Unification** | kg-unified-injector 替代现有 5 个 hook | 3 天 | 单一 hook 注入所有知识 |
| **R8: MCP Server** | MCP tool 定义 + daemon | 2 天 | agent 可通过 MCP 查询统一图谱 |

**总计：~26 天。** 可分两个里程碑：
- **M1 (R1-R5, ~18 天)**：核心引擎可用——知识 + 代码提取、跨源边、统一搜索
- **M2 (R6-R8, ~8 天)**：对外接口——CLI、hook 统一、MCP

### 降低重写风险的关键决策

| 决策 | 说明 |
|------|------|
| **tree-sitter 二进制直接复用** | 不重新编译 WASM grammar，直接用 CodeGraph 的 19 个 .wasm 文件（MIT 许可证） |
| **语言提取器源码复用** | 19 个 `languages/*.ts` 文件直接拷贝，只改 import 路径 |
| **框架解析器源码复用** | 21 个 `frameworks/*.ts` 文件直接拷贝，保持稳定性 |
| **knowledge extractor 参考现有代码** | spec-entry-parser、WikiIndexer 的解析逻辑已存在，重构而非重写 |
| **渐进式替代现有 hook** | R7 之前，现有 5 个 hook 保持工作；R7 完成后灰度切换 |
| **保留 codegraph 作为 fallback** | 如果项目已安装 codegraph，不冲突，两者可共存 |

### 与适配器方案的关键差异

```
适配器方案:
  .codegraph/db.sqlite  ──adapter──→  .workflow/kg/maestro.db  ←──adapter── .workflow/specs/
       (CodeGraph 管理)                  (Maestro 管理)                    (Maestro 管理)

  问题：adapter 层是永久的复杂度税

重写方案:
  .workflow/kg/maestro.db
       ↑ code extractor (内置 tree-sitter)
       ↑ knowledge extractor (内置 md/json parser)
       ↑ knowledge resolver (内置 cross-source edge)

  优势：一个 DB，一套管道，零 adapter 层
  代价：前期多投入 ~3-4 周，但消除了永久的维护税
```

---

## 四、审核结果与 Gap 修补

> 审核来源：内部 workflow-analyzer Agent 对照 CodeGraph 源码逐项审查（82 个功能点）。
> 审核结论：**原方案覆盖率 13.4%，需大幅修订。**

### 覆盖率矩阵

| 类别 | 总数 | ✅ | ⚠️ | ❌ | 覆盖率 |
|------|------|---|---|---|--------|
| 类型系统与数据模型 | 9 | 1 | 6 | 2 | 11% |
| 代码提取层 | 14 | 2 | 4 | 8 | 14% |
| 引用解析层 | 16 | 7 | 6 | 3 | 44% |
| 回调合成（1224 行） | 16 | 0 | 0 | 16 | 0% |
| 同步与监听 | 6 | 1 | 1 | 4 | 17% |
| MCP Server 与查询 | 7 | 0 | 0 | 7 | 0% |
| 搜索与评分 | 8 | 0 | 1 | 7 | 0% |
| 数据库 Schema | 6 | 0 | 2 | 4 | 0% |
| **总计** | **82** | **11** | **20** | **51** | **13.4%** |

---

### Gap 修补 1：统一 Schema 修订版

原方案 schema 存在 6 个致命/高危问题。以下是修订版：

```sql
-- ============================================================================
-- MaestroGraph Unified Schema v2 (审核修订版)
-- ============================================================================

-- Schema 版本追踪
CREATE TABLE IF NOT EXISTS schema_versions (
    version       INTEGER PRIMARY KEY,
    applied_at    INTEGER NOT NULL,
    description   TEXT
);

INSERT INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial unified schema');

-- ---------------------------------------------------------------------------
-- 统一节点表
-- 修订: 补全 CodeGraph 全部代码字段 + 知识扩展字段
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,           -- UnifiedNodeKind
    name            TEXT NOT NULL,
    qualified_name  TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    language        TEXT NOT NULL,
    start_line      INTEGER NOT NULL DEFAULT 0,
    end_line        INTEGER NOT NULL DEFAULT 0,
    start_column    INTEGER NOT NULL DEFAULT 0, -- [修订] 补充: CodeGraph 原有
    end_column      INTEGER NOT NULL DEFAULT 0, -- [修订] 补充: CodeGraph 原有

    -- CodeGraph 代码字段 (完整保留)
    docstring       TEXT,
    signature       TEXT,
    visibility      TEXT,
    is_exported     INTEGER DEFAULT 0,
    is_async        INTEGER DEFAULT 0,          -- [修订] 补充
    is_static       INTEGER DEFAULT 0,          -- [修订] 补充
    is_abstract     INTEGER DEFAULT 0,          -- [修订] 补充
    decorators      TEXT,                       -- [修订] JSON array, 补充
    type_parameters TEXT,                       -- [修订] JSON array, 补充

    -- 知识扩展字段 (知识节点使用)
    source_type     TEXT,                       -- 'codegraph'|'domain'|'spec'|'knowhow'|'codebase'|'issue'
    definition      TEXT,
    aliases         TEXT,                       -- JSON array
    keywords        TEXT,                       -- JSON array
    category        TEXT,
    roles           TEXT,                       -- JSON array
    priority        TEXT,
    status          TEXT,
    body            TEXT,
    metadata        TEXT,                       -- JSON catch-all

    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 统一边表
-- 修订: 移除 UNIQUE 约束 → 保留多处 call site
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    kind        TEXT NOT NULL,               -- UnifiedEdgeKind
    metadata    TEXT,                        -- JSON
    line        INTEGER,
    col         INTEGER,
    provenance  TEXT,                        -- [修订] 保留细粒度: 'tree-sitter'|'heuristic'|'domain'|'spec'|'harvest'|'manual'|'callback-synth'
    -- [修订] 不设 UNIQUE 约束: 同一对节点可有多条同类型边(不同行号)
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- [修订] 未解析引用表 — 解析管道的核心中间存储
-- CodeGraph 两阶段模型: extraction → unresolved_refs → resolution → edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unresolved_refs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id    TEXT NOT NULL,
    reference_name  TEXT NOT NULL,
    reference_kind  TEXT NOT NULL,
    line            INTEGER NOT NULL,
    col             INTEGER NOT NULL,
    candidates      TEXT,                    -- JSON array of possible qualified names
    file_path       TEXT NOT NULL DEFAULT '',
    language        TEXT NOT NULL DEFAULT 'unknown',
    FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 文件追踪表
-- 修订: 补充 errors 字段
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    path            TEXT PRIMARY KEY,
    content_hash    TEXT NOT NULL,
    language        TEXT,
    size            INTEGER,
    modified_at     INTEGER,
    indexed_at      INTEGER,
    node_count      INTEGER DEFAULT 0,
    errors          TEXT,                    -- [修订] JSON array, CodeGraph 原有
    source_type     TEXT DEFAULT 'codegraph'
);

-- ---------------------------------------------------------------------------
-- 项目元数据表
-- [修订] 补充: CodeGraph 原有
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_metadata (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- ============================================================================
-- 索引
-- ============================================================================

-- 节点索引
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line); -- [修订] 补充
CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));          -- [修订] 补充
CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON nodes(source_type);
CREATE INDEX IF NOT EXISTS idx_nodes_category ON nodes(category);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

-- 边索引 (使用复合索引, 不设单列索引 — CodeGraph migration v4 经验)
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);
CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);

-- 文件索引
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);

-- 未解析引用索引 [修订] 补充
CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name);

-- ============================================================================
-- [修订] FTS5 分离索引 — 代码和知识各一套, 避免 BM25 权重失衡
-- ============================================================================

-- 代码 FTS5 (与 CodeGraph 一致的 5 列 + 权重)
CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='rowid'
);

-- 知识 FTS5 (知识节点专用列)
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    id,
    name,
    definition,
    body,
    aliases,
    keywords,
    content='nodes',
    content_rowid='rowid'
);

-- FTS5 同步触发器 — 按 source_type 路由到不同索引
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature
    WHERE NEW.source_type = 'codegraph' OR NEW.source_type IS NULL;

    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type IS NOT NULL AND NEW.source_type != 'codegraph';
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO code_fts(code_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);

    INSERT INTO knowledge_fts(knowledge_fts, rowid, id, name, definition, body, aliases, keywords)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.definition, OLD.body, OLD.aliases, OLD.keywords);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO code_fts(code_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature
    WHERE NEW.source_type = 'codegraph' OR NEW.source_type IS NULL;

    INSERT INTO knowledge_fts(knowledge_fts, rowid, id, name, definition, body, aliases, keywords)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.definition, OLD.body, OLD.aliases, OLD.keywords);
    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type IS NOT NULL AND NEW.source_type != 'codegraph';
END;
```

**修订要点**：
1. `unresolved_refs` 表 + 4 个索引 — 修复致命 gap
2. `start_column`/`end_column`/`is_async`/`is_static`/`is_abstract`/`decorators`/`type_parameters` — 补全代码字段
3. 移除 `UNIQUE(source, target, kind)` — 保留多处 call site
4. FTS5 分离为 `code_fts` + `knowledge_fts` — 避免 BM25 权重失衡
5. `provenance` 值域扩展 — 保留 `tree-sitter`/`heuristic`/`callback-synth` 细粒度区分
6. `project_metadata` 表 — 补充
7. `files.errors` 字段 + `modified_at` 索引 — 补充
8. 触发器按 `source_type` 路由到不同 FTS5 索引

---

### Gap 修补 2：完整类型系统

```typescript
// src/graph/kg/db/types.ts — 修订版

// ---------------------------------------------------------------------------
// NodeKind — 完整复用 CodeGraph 22 种 + 新增 7 种知识类型
// ---------------------------------------------------------------------------

export const CODE_NODE_KINDS = [
  'file',           // [修订] 补充: CodeGraph 原有
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',       // [修订] 补充: Swift 协议, callback-synthesizer 依赖
  'function',
  'method',
  'property',
  'field',
  'variable',
  'constant',
  'enum',
  'enum_member',
  'type_alias',
  'namespace',
  'parameter',
  'import',
  'export',
  'route',
  'component',
] as const;

export const KNOWLEDGE_NODE_KINDS = [
  'domain_term',
  'spec_entry',
  'knowhow_entry',
  'codebase_section',
  'issue',
  'decision',
  'requirement',
] as const;

export const UNIFIED_NODE_KINDS = [...CODE_NODE_KINDS, ...KNOWLEDGE_NODE_KINDS] as const;
export type UnifiedNodeKind = (typeof UNIFIED_NODE_KINDS)[number];

// ---------------------------------------------------------------------------
// EdgeKind — 完整复用 CodeGraph 12 种 + 新增 8 种知识关系
// ---------------------------------------------------------------------------

export type CodeEdgeKind =
  | 'contains' | 'calls' | 'imports' | 'exports'
  | 'extends' | 'implements' | 'references'
  | 'type_of' | 'returns' | 'instantiates'
  | 'overrides' | 'decorates';

export type KnowledgeEdgeKind =
  | 'defines' | 'constrains' | 'documents'
  | 'relates_to' | 'implements_rule' | 'resolves'
  | 'derived_from' | 'supersedes' | 'aliases';

export type UnifiedEdgeKind = CodeEdgeKind | KnowledgeEdgeKind;

// ---------------------------------------------------------------------------
// Language — 完整复用 CodeGraph 28 种
// [修订] 补充 luau/twig/yaml/xml/properties/objc/pascal/scala 等
// ---------------------------------------------------------------------------

export const LANGUAGES = [
  'typescript', 'javascript', 'tsx', 'jsx',
  'python', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'php', 'ruby',
  'swift', 'kotlin', 'dart',
  'svelte', 'vue', 'liquid',
  'pascal', 'scala', 'lua', 'luau', 'objc',
  'yaml', 'twig', 'xml', 'properties',
  'unknown',
] as const;

export type Language = (typeof LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Edge provenance — 细粒度来源追踪
// ---------------------------------------------------------------------------

export type EdgeProvenance =
  | 'tree-sitter'      // 代码: tree-sitter AST 直接提取
  | 'heuristic'        // 代码: 名称匹配启发式
  | 'callback-synth'   // 代码: 回调合成器 (14 阶段)
  | 'framework'        // 代码: 框架解析器 (21 种)
  | 'domain'           // 知识: domain glossary
  | 'spec'             // 知识: spec entry
  | 'knowhow'          // 知识: wiki/knowhow
  | 'harvest'          // 知识: harvest 提取
  | 'knowledge-resolver' // 知识: 跨源自动边解析
  | 'manual';          // 手动添加
```

---

### Gap 修补 3：WASM 运行时稳定性（致命级补充）

新增文件：`src/graph/kg/extraction/code/wasm-stability.ts`

```typescript
// ---------------------------------------------------------------------------
// WASM 运行时稳定性 — 从 CodeGraph 移植的 3 个保护机制
// 缺少任何一个都会导致生产环境崩溃
// ---------------------------------------------------------------------------

// 机制 1: V8 Turboshaft Zone OOM 缓解
// Node 22+ 的 V8 引擎在编译大型 WASM 模块时会触发 turboshaft Zone OOM
// 必须在进程启动时注入 --liftoff-only flag
//
// 来源: codegraph/src/extraction/wasm-runtime-flags.ts
export function applyWasmRuntimeFlags(): void {
  // --liftoff-only: 禁用 turboshaft 优化编译器, 只用 Liftoff 基线编译
  // 牺牲 ~10% WASM 执行速度, 换取 100% 内存安全
  // 必须在任何 WASM 模块加载之前调用
}

// 机制 2: Parser 周期性重置
// WASM 线性内存只增不缩 (WebAssembly 规范限制)
// 唯一的回收方式是销毁整个 Parser 实例
//
// 来源: codegraph/src/extraction/parse-worker.ts L55-56
const PARSER_RESET_INTERVAL = 5000;  // 每 5000 次解析重置一次
// 配合 worker 线程的 WORKER_RECYCLE_INTERVAL = 250 (每 250 文件回收 worker)

// 机制 3: Emscripten stderr 过滤
// tree-sitter WASM 在遇到无法解析的语法时会调用 Emscripten 的 abort()
// 导致大量 stderr 噪声 ("Aborted()" 消息)
// 必须在 worker 线程中拦截 process.stderr.write
//
// 来源: codegraph/src/extraction/parse-worker.ts L31-52
```

---

### Gap 修补 4：回调合成器（1224 行, 14 阶段）

这是 CodeGraph 从"符号索引"到"语义理解"的核心跨越，设计文档原方案零覆盖。

```
新增文件: src/graph/kg/resolution/callback-synthesizer.ts
来源: codegraph/src/resolution/callback-synthesizer.ts (直接复用)

14 个合成阶段:
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: 字段观察者通道                                       │
│   registrar (on*/subscribe/addListener)                      │
│   + dispatcher (emit/trigger/notify)                         │
│   → 通过共享字段名配对建立 calls edge                         │
├─────────────────────────────────────────────────────────────┤
│ Phase 2: EventEmitter 通道                                   │
│   .on('event', fn) ↔ .emit('event')                         │
│   → 字符串键精确匹配建立 calls edge                           │
├─────────────────────────────────────────────────────────────┤
│ Phase 3: 闭包集合分派                                         │
│   .forEach { $0() } + .append(closure)                       │
│   → 全局配对 (Swift/Alamofire 场景)                           │
├─────────────────────────────────────────────────────────────┤
│ Phase 4: 框架特化桥接                                         │
│   4a: React setState → render                                │
│   4b: Flutter setState → build                               │
│   4c: C++ virtual override (基类→子类同名方法)                │
├─────────────────────────────────────────────────────────────┤
│ Phase 5: JSX 子组件渲染                                       │
│   PascalCase 标签 → component 节点                            │
├─────────────────────────────────────────────────────────────┤
│ Phase 5.5: 接口/抽象分派                                      │
│   Java/Kotlin/C#/TS/Swift/Scala                              │
│   implements/extends 的方法桥接 (含重载处理)                   │
├─────────────────────────────────────────────────────────────┤
│ Phase 6: Vue SFC 模板                                         │
│   kebab-case 子组件 + @click 事件处理器                       │
│   + composable 解构处理器                                     │
├─────────────────────────────────────────────────────────────┤
│ Phase 7: Go gRPC Stub→Impl                                   │
│   UnimplementedXxxServer → 手写实现的方法名子集匹配           │
├─────────────────────────────────────────────────────────────┤
│ Phase 8: React Native 跨语言事件通道                          │
│   ObjC sendEventWithName / Swift sendEvent / Java .emit()    │
│   → JS .addListener()                                        │
├─────────────────────────────────────────────────────────────┤
│ Phase 9: Fabric Native Impl                                  │
│   codegenNativeComponent spec → native class (后缀约定匹配)  │
├─────────────────────────────────────────────────────────────┤
│ Phase 10: MyBatis Java↔XML                                   │
│   Java mapper 接口方法 → XML statement 后缀匹配              │
├─────────────────────────────────────────────────────────────┤
│ Phase 11: Gin 中间件链                                        │
│   c.handlers[c.index](c) → .Use()/.GET() 注册的处理函数      │
├─────────────────────────────────────────────────────────────┤
│ 扇出上限保护:                                                 │
│   MAX_CALLBACKS_PER_CHANNEL = 40                              │
│   EVENT_FANOUT_CAP = 6                                        │
│   CC_FANOUT_CAP = 8                                           │
│   MAX_JSX_CHILDREN = 30                                       │
├─────────────────────────────────────────────────────────────┤
│ 去重: 全局 seen Set + 统一 insertEdges (provenance='callback-synth') │
└─────────────────────────────────────────────────────────────┘
```

**复用策略**: 直接从 CodeGraph 复制 `callback-synthesizer.ts`，只修改 import 路径。此文件对 `QueryBuilder` 的依赖是唯一接口——统一 `QueryBuilder` 保持 `getNodesByKind`/`getOutgoingEdges`/`getIncomingEdges`/`insertEdges` 方法签名即可。

---

### Gap 修补 5：5 个自定义提取器

```
新增文件 (从 CodeGraph 直接复用):

src/graph/kg/extraction/code/
├── vue-extractor.ts         # Vue SFC: <script>/<script setup> 块委托 tree-sitter
│                            #   + 行号偏移校正 (script 块起始行 → 全文件行号)
│
├── svelte-extractor.ts      # Svelte: script 块 + 模板函数调用 + PascalCase 组件引用
│                            #   + Svelte 5 rune 过滤 ($state/$derived/$effect 不产生节点)
│
├── liquid-extractor.ts      # Shopify/Jekyll Liquid 模板:
│                            #   render/include/section 标签 → import edge
│                            #   schema/assign 块 → variable node
│
├── mybatis-extractor.ts     # MyBatis XML mapper:
│                            #   select/insert/update/delete 语句 → method node
│                            #   include refid → references edge
│
└── dfm-extractor.ts         # Delphi DFM/FMX 窗体:
                             #   组件层级 → contains edge
                             #   OnClick 等事件 → calls edge
```

---

### Gap 修补 6：搜索评分系统

```typescript
// src/graph/kg/query/scoring.ts
// 从 CodeGraph 的 search/query-utils.ts 复用, 适配统一图谱

// ---------------------------------------------------------------------------
// 1. 停用词过滤 (78 个英语词 + 代码噪声词)
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  // ... (复用 CodeGraph 完整列表)
  // 代码噪声词:
  'function', 'class', 'import', 'export', 'const', 'return',
  'true', 'false', 'null', 'undefined', 'string', 'number',
]);

// ---------------------------------------------------------------------------
// 2. 词干变体生成
// ---------------------------------------------------------------------------
function getStemVariants(term: string): string[] {
  // -ing → '', -tion/-sion → '', -ment → '', -ies → 'y',
  // -es → '', -s → '', -ed → '', -er → ''
}

// ---------------------------------------------------------------------------
// 3. 驼峰/蛇形分词
// ---------------------------------------------------------------------------
function extractSearchTerms(query: string): string[] {
  // CamelCase → ['Camel', 'Case']
  // snake_case → ['snake', 'case']
  // SCREAMING_SNAKE → ['SCREAMING', 'SNAKE']
  // dot.notation → ['dot', 'notation']
  // 保留原始复合标识符
}

// ---------------------------------------------------------------------------
// 4. 多信号评分
// ---------------------------------------------------------------------------

function kindBonus(kind: UnifiedNodeKind): number {
  // function/method: +10
  // interface/trait/protocol/route: +9
  // class/component: +8
  // type_alias/struct: +6
  // domain_term: +12  (知识节点额外加分, 但在独立 FTS5 中不与代码竞争)
  // spec_entry: +8
}

function scorePathRelevance(filePath: string, query: string): number {
  // 文件名匹配: +10
  // 目录匹配: +5
  // 路径匹配: +3
  // 测试文件: -15 (降权)
}

function nameMatchBonus(name: string, query: string): number {
  // 精确匹配: +80
  // 令牌精确: +60
  // 前缀匹配: +10~40 (按长度比例)
  // 全分词包含: +15
  // 子串匹配: +10
}

// ---------------------------------------------------------------------------
// 5. 搜索策略链: FTS5 → LIKE → Fuzzy (edit distance)
// ---------------------------------------------------------------------------
function searchUnified(query: string, opts: SearchOptions): SearchResult[] {
  // Step 1: 代码 FTS5 搜索 (bm25 weights: id=0, name=20, qn=5, doc=1, sig=2)
  let codeResults = searchCodeFTS(query, opts);

  // Step 2: 知识 FTS5 搜索 (bm25 weights: id=0, name=20, def=10, body=1, aliases=15, kw=10)
  let knowledgeResults = searchKnowledgeFTS(query, opts);

  // Step 3: LIKE fallback (当 FTS5 无结果时)
  if (codeResults.length === 0) {
    codeResults = searchNodesLike(query, opts);
  }

  // Step 4: Fuzzy fallback (edit distance ≤ 2, 当 LIKE 也无结果时)
  if (codeResults.length === 0 && query.length >= 3) {
    codeResults = searchNodesFuzzy(query, opts);
  }

  // Step 5: 多信号 rescore (kindBonus + pathRelevance + nameMatchBonus)
  // Step 6: 合并代码 + 知识结果, 按 score 排序

  return mergeAndSort(codeResults, knowledgeResults);
}

// ---------------------------------------------------------------------------
// 6. Field-qualified 查询解析
// ---------------------------------------------------------------------------
// kind:function — 按节点类型过滤
// lang:typescript — 按语言过滤
// path:src/auth — 按路径过滤
// name:Tenant — 按名称过滤
// source:domain — 按来源过滤 (知识扩展)
```

---

### Gap 修补 7：生成文件检测

```typescript
// src/graph/kg/extraction/code/generated-detection.ts
// 从 CodeGraph 直接复用, 30+ 正则模式

const GENERATED_PATTERNS: ReadonlyArray<RegExp> = [
  // Go — protobuf / gRPC / mockgen
  /\.pb\.go$/, /\.pulsar\.go$/, /_grpc\.pb\.go$/,
  /_mock\.go$/, /_mocks\.go$/, /^mock_[^/]+\.go$/,

  // TypeScript / JavaScript — codegen
  /\.generated\.[jt]sx?$/, /\.gen\.[jt]sx?$/,
  /\.pb\.[jt]s$/, /_pb\.[jt]s$/, /_grpc_pb\.[jt]s$/,

  // Python — protobuf
  /_pb2(_grpc)?\.py$/, /_pb2\.pyi$/,

  // C++ — protobuf
  /\.pb\.(cc|h)$/,

  // C# — protobuf / gRPC
  /\.g\.cs$/, /Grpc\.cs$/,

  // Java — protobuf / gRPC
  /OuterClass\.java$/, /Grpc\.java$/,

  // Swift — protobuf
  /\.pb\.swift$/,

  // Dart — build_runner / freezed / json_serializable
  /\.g\.dart$/, /\.freezed\.dart$/,

  // Rust — protobuf
  /\.pb\.rs$/,
];

// 用途: 搜索结果降权 (排最后), dominant file 检测排除, 不硬过滤 (仍在图中)
export function isGeneratedFile(filePath: string): boolean {
  return GENERATED_PATTERNS.some(p => p.test(filePath));
}
```

---

### Gap 修补 8：名称匹配启发式

```
新增文件: src/graph/kg/resolution/name-matcher.ts
来源: codegraph/src/resolution/name-matcher.ts (直接复用)

6 种匹配策略链 (按优先级):
1. 精确名称匹配 — name == referenceName
2. 限定名匹配 — qualifiedName endsWith referenceName
3. 文件路径匹配 — import path 推导出 file path
4. 方法调用解析 — receiver.method() → 查找 receiver 类型的 method
5. 模糊匹配 — camelCase 分词后子集匹配
6. 路径邻近度评分 — 同目录/同模块加分

额外特化:
- C++ 接收者类型推断 (从声明回溯推断变量类型)
- Java/Kotlin @Resource/@Autowired 字段类型推断
- 注释剥离 (strip-comments.ts): 多语言注释/字符串剥离, 保持偏移不变
```

---

### Gap 修补 9：WSL2 监听策略 + Git 钩子

```
新增文件: src/graph/kg/sync/watch-policy.ts
来源: codegraph/src/sync/watch-policy.ts

WSL2 检测:
- /mnt/* 路径 → 禁用 recursive watch (drvfs 性能极差, 会阻塞 MCP 握手)
- 改用 Git 钩子作为替代同步触发

Git 同步钩子:
- post-commit / post-merge / post-checkout
- 当 file watcher 不可用时的替代方案
- 来源: codegraph/src/sync/git-hooks.ts

Worktree 感知:
- 检测 git worktree 借用主分支索引的不一致情况
- MCP 工具返回中注入 worktree mismatch 警告
- 来源: codegraph/src/sync/worktree.ts
```

---

### Gap 修补 10：MCP 工具的自适应输出

```
codegraph_explore 的 Explore Budget (按项目规模分级):

| 文件数    | explore 调用次数 | 说明 |
|----------|-----------------|------|
| < 500    | 1               | 小项目, 一次搜索覆盖全部 |
| < 5,000  | 2               | 中项目 |
| < 15,000 | 3               | 大项目 |
| < 25,000 | 4               | 超大项目 |
| ≥ 25,000 | 5               | 巨型项目 (VS Code 级别) |

Adaptive Output Budget (7 级输出预算, 14 个参数):

| 文件数    | maxOutputChars | defaultMaxFiles | maxCharsPerFile | gapThreshold |
|----------|---------------|-----------------|-----------------|-------------|
| < 200    | 8000          | 6               | 3000            | 200         |
| < 500    | 10000         | 7               | 3500            | 250         |
| < 2000   | 12000         | 8               | 4000            | 350         |
| < 5000   | 13000         | 9               | 4500            | 400         |
| < 10000  | 14000         | 10              | 5000            | 450         |
| < 20000  | 14500         | 11              | 5000            | 500         |
| ≥ 20000  | 15000         | 12              | 5500            | 550         |

容器节点大纲模式:
- class/struct/interface/trait/protocol/enum/namespace/module
- 返回成员签名列表 + 行号, 而非全文源码
- 避免大型类 (1000+ 行) 撑爆 context

安全限制:
- MAX_INPUT_LENGTH = 10,000 chars (防 FTS5 滥用)
- MAX_PATH_LENGTH = 4,096 chars
- MAX_OUTPUT_LENGTH = 15,000 chars
```

---

### 修订后的实施计划

| Phase | 内容 | 原估计 | 修订估计 | 修订原因 |
|-------|------|--------|---------|---------|
| R1: Foundation | Schema v2 + DB + 类型 | 3 天 | 4 天 | Schema 复杂度翻倍 (分离 FTS5, unresolved_refs) |
| R2: Knowledge Extractors | domain/spec/wiki/issue | 4 天 | 4 天 | 无变化 |
| R3: Code Extraction | tree-sitter + 19 语言 + 5 自定义 + WASM 稳定性 + 生成文件检测 | 5 天 | **12 天** | 6000+ 行 + WASM 运行时 flag + worker 内存管理 |
| R4: Resolution | 21 框架 + name-matcher + **callback-synthesizer** + strip-comments | 3 天 | **10 天** | 回调合成器 1224 行独立复杂子系统 |
| R5: Query + Search | FTS5 分离搜索 + 评分系统 + 图遍历 + context builder | 3 天 | **6 天** | 搜索评分系统 (停用词/词干/驼峰/多信号) 全部补充 |
| R6: CLI + Sync | maestro kg 命令 + 增量同步 + file watcher + WSL2 策略 + git 钩子 | 3 天 | **5 天** | WSL2 + git hooks + worktree 感知 |
| R7: Hook Unification | kg-unified-injector | 3 天 | 4 天 | 分离 FTS5 的查询聚合逻辑 |
| R8: MCP Server | MCP tools + adaptive output + explore budget | 2 天 | **5 天** | 14 参数自适应输出系统 + 安全限制 |
| **总计** | | **26 天** | **50 天** | |

里程碑拆分：
- **M1 (R1-R4, 30 天)**: 核心引擎 — 提取 + 解析 + 存储可用
- **M2 (R5-R6, 11 天)**: 查询 + 同步 — 搜索和增量更新可用
- **M3 (R7-R8, 9 天)**: 对外接口 — hook 统一 + MCP 工具

---

### 修订后的模块取用清单

| CodeGraph 模块 | 文件数 | 行数 | 操作 | 说明 |
|----------------|--------|------|------|------|
| `extraction/tree-sitter.ts` | 1 | ~300 | 取 | tree-sitter WASM 核心 |
| `extraction/grammars.ts` | 1 | ~200 | 取 | 延迟加载 + 缓存 |
| `extraction/parse-worker.ts` | 1 | ~150 | 取 | worker 线程 + 内存管理 + stderr 过滤 |
| `extraction/wasm-runtime-flags.ts` | 1 | ~30 | 取 | V8 --liftoff-only |
| `extraction/generated-detection.ts` | 1 | ~80 | 取 | 30+ 生成文件模式 |
| `extraction/tree-sitter-helpers.ts` | 1 | ~100 | 取 | generateNodeId 等 |
| `extraction/tree-sitter-types.ts` | 1 | ~100 | 取 | LanguageExtractor 接口 |
| `extraction/languages/*.ts` | 19 | ~4000 | 取 | 19 语言提取器 |
| `extraction/vue-extractor.ts` | 1 | ~150 | 取 | Vue SFC |
| `extraction/svelte-extractor.ts` | 1 | ~200 | 取 | Svelte + rune 过滤 |
| `extraction/liquid-extractor.ts` | 1 | ~150 | 取 | Liquid 模板 |
| `extraction/mybatis-extractor.ts` | 1 | ~120 | 取 | MyBatis XML |
| `extraction/dfm-extractor.ts` | 1 | ~100 | 取 | Delphi DFM |
| `extraction/wasm/*.wasm` | 19 | ~15MB | 取 | WASM 二进制 |
| `resolution/frameworks/*.ts` | 21 | ~2000 | 取 | 21 框架解析器 |
| `resolution/callback-synthesizer.ts` | 1 | ~1224 | **取** | **[修订新增]** 14 阶段回调合成 |
| `resolution/name-matcher.ts` | 1 | ~400 | **取** | **[修订新增]** 6 级匹配策略 |
| `resolution/import-resolver.ts` | 1 | ~300 | 取 | import 路径解析 |
| `graph/traversal.ts` | 1 | ~200 | 取 | BFS/DFS |
| `search/query-utils.ts` | 1 | ~300 | **取** | **[修订新增]** 评分系统 |
| `search/query-parser.ts` | 1 | ~100 | **取** | **[修订新增]** field-qualified 解析 |
| `sync/index.ts` | 1 | ~200 | 取 | file watcher |
| `sync/worktree.ts` | 1 | ~100 | **取** | **[修订新增]** worktree 检测 |
| `sync/watch-policy.ts` | 1 | ~50 | **取** | **[修订新增]** WSL2 策略 |
| `sync/git-hooks.ts` | 1 | ~80 | **取** | **[修订新增]** git 同步钩子 |
| `db/schema.sql` | 1 | ~150 | 改写 | 扩展为统一 schema v2 |
| `db/queries.ts` | 1 | ~1700 | 改写 | 扩展 QueryBuilder |
| `db/sqlite-adapter.ts` | 1 | ~120 | 改写 | 适配 maestro 基础 |
| `context/index.ts` + `formatter.ts` | 2 | ~400 | 改写 | 适配知识节点 |
| `mcp/tools.ts` | 1 | ~500 | 弃/重写 | 自己的 MCP 工具 |
| `mcp/daemon.ts` + `server.ts` 等 | 5 | ~800 | 弃 | maestro 有自己的 MCP |
| `installer/` | 8 | ~600 | 弃 | maestro 有自己的安装 |
| **总计取用** | **~80 文件** | **~12,000 行** | | |
| **总计改写** | **~5 文件** | **~2,800 行** | | |
| **总计新写** | **~10 文件** | **~3,000 行** | | 知识提取器 + 统一查询 + hook |

---

## 五、Codex 二审补充 Gap

> 审核来源：Codex (gpt-5.5) 对照 CodeGraph 源码逐文件审查（38 个粗粒度功能点）。
> 审核结论：严格覆盖率 21.1%，加权覆盖率 42.1%。与 Agent 审核结论一致，另发现 8 个额外 gap。

### 双源交叉验证

两个审核源独立得出相同的致命 gap：

| 致命 Gap | Agent 发现 | Codex 发现 |
|----------|-----------|-----------|
| `unresolved_refs` 表缺失 | ✅ | ✅ |
| WASM 运行时稳定性 | ✅ | ✅ |
| callback-synthesizer 零覆盖 | ✅ | ✅ |
| 搜索评分系统零覆盖 | ✅ | ✅ |
| FTS5 BM25 权重失衡 | ✅ | ✅ (BM25 weights contract 不完整) |
| UNIQUE 约束错误 | ✅ | — (Codex 粒度未到此级别) |

### Codex 独立发现的 8 个额外 Gap

以下 gap 在 Agent 审核中未被覆盖，需要额外补充：

#### Gap C1：MCP 工具数量错误（9 个，非 3 个）

设计文档只定义了 3 个 MCP 工具（`maestro_kg_search`/`maestro_kg_context`/`maestro_kg_explore`），但 CodeGraph 实际暴露 **9 个工具**：

```
CodeGraph MCP 工具完整清单:
┌─────────────────────────────────────────────────────────────────┐
│ 设计文档已覆盖:                                                  │
│   1. codegraph_search  → maestro_kg_search                      │
│   2. codegraph_node    → maestro_kg_context                     │
│   3. codegraph_explore → maestro_kg_explore                     │
│                                                                 │
│ 设计文档缺失 (需补充):                                           │
│   4. codegraph_trace   → maestro_kg_trace                       │
│      调用链追踪: A→B→C→D 完整路径                                │
│   5. codegraph_callers → maestro_kg_callers                     │
│      谁调用了这个函数 (incoming edges, kind=calls)               │
│   6. codegraph_callees → maestro_kg_callees                     │
│      这个函数调用了谁 (outgoing edges, kind=calls)               │
│   7. codegraph_impact  → maestro_kg_impact                      │
│      变更影响分析: 修改 X 会影响哪些下游                          │
│   8. codegraph_files   → maestro_kg_files                       │
│      已索引文件列表 + 统计                                       │
│   9. codegraph_status  → maestro_kg_status                      │
│      索引状态: 节点数/边数/文件数/DB 大小/最后更新                │
└─────────────────────────────────────────────────────────────────┘
```

**MCP 工具补充定义**:

```typescript
// 4. maestro_kg_trace — 调用链追踪
{
  name: 'maestro_kg_trace',
  inputSchema: {
    startSymbol: string,    // 起点符号
    endSymbol?: string,     // 终点符号 (可选, 不指定则 BFS 全展开)
    maxDepth?: number,      // 最大深度 (默认 5)
    edgeKinds?: string[],   // 边类型过滤 (默认 ['calls'])
  }
}

// 5-6. maestro_kg_callers / maestro_kg_callees — 调用方/被调用方
{
  name: 'maestro_kg_callers',  // 或 'maestro_kg_callees'
  inputSchema: {
    symbol: string,
    depth?: number,         // 递归深度 (默认 1)
    limit?: number,
  }
}

// 7. maestro_kg_impact — 变更影响分析
{
  name: 'maestro_kg_impact',
  inputSchema: {
    symbol: string,         // 修改的符号
    maxDepth?: number,      // 影响传播深度 (默认 3)
  }
}

// 8. maestro_kg_files — 已索引文件列表
{
  name: 'maestro_kg_files',
  inputSchema: {
    language?: string,
    pattern?: string,       // glob 过滤
  }
}

// 9. maestro_kg_status — 索引状态
{
  name: 'maestro_kg_status',
  inputSchema: {}           // 无参数
}
```

#### Gap C2：Framework Resolver 数量修正（24 个，非 21 个）

Codex 源码审查发现 `resolution/frameworks/index.ts` 的 resolver 注册表实际包含 **24 个实例**，而非设计文档笼统表述的"21 个框架解析器"：

```
文件级 resolver (1 个文件可包含多个 resolver):
┌────────────────────────┬───────────────────────────────────────┐
│ 文件                    │ 实际 resolver 实例                    │
├────────────────────────┼───────────────────────────────────────┤
│ express.ts             │ 1. express                            │
│ nestjs.ts              │ 2. nestjs                             │
│ react.ts               │ 3. react                              │
│ react-native.ts        │ 4. react-native-legacy                │
│                        │ 5. react-native-turbomodules          │
│ expo-modules.ts        │ 6. expo-modules                       │
│ svelte.ts              │ 7. svelte                             │
│ vue.ts                 │ 8. vue                                │
│ python.ts              │ 9. django                             │
│                        │ 10. flask                             │
│                        │ 11. fastapi                           │
│ ruby.ts                │ 12. rails                             │
│ go.ts                  │ 13. gin                               │
│                        │ 14. go-standard                       │
│ rust.ts                │ 15. actix-web                         │
│                        │ 16. axum                              │
│ java.ts                │ 17. spring                            │
│ play.ts                │ 18. play-framework                    │
│ laravel.ts             │ 19. laravel                           │
│ drupal.ts              │ 20. drupal                            │
│ csharp.ts              │ 21. aspnet                            │
│ swift.ts               │ 22. swiftui                           │
│                        │ 23. uikit                             │
│                        │ 24. vapor                             │
│ swift-objc.ts          │ (桥接, 非独立 resolver)                │
│ cargo-workspace.ts     │ (工作区, 非独立 resolver)              │
│ fabric.ts              │ (Fabric 视图, 附属于 react-native)     │
└────────────────────────┴───────────────────────────────────────┘
```

**修正**: 设计文档中的"21 个框架解析器"应改为"**24 个 resolver 实例**（分布在 21 个文件中）"。模块取用清单中 `resolution/frameworks/*.ts` 的行数估算从 ~2000 调整为 **~2500**。

#### Gap C3：tsconfig alias / go.mod / compile_commands 路径解析

CodeGraph 的 `import-resolver.ts`（986 行）包含 3 个跨语言路径解析子系统：

```
新增复用文件:

src/graph/kg/resolution/
├── import-resolver.ts        # 已在取用清单, 但以下子系统未明确:
│   ├── tsconfig alias        # 解析 tsconfig.json paths 别名映射
│   │   extractImportMappings() → { "@/*": "./src/*" }
│   │
│   ├── go.mod 模块解析        # 解析 go.mod 的 module 路径
│   │   resolveGoCrossPackageReference()
│   │   → "github.com/org/repo/pkg" → "pkg/"
│   │
│   └── compile_commands.json  # C/C++ 编译数据库
│       resolveCppIncludePath()
│       → "#include <header.h>" → 项目内文件
│
├── go-module.ts              # [修订新增] Go module 辅助解析
│                             # 来源: codegraph/src/resolution/go-module.ts
│
└── path-aliases.ts           # [修订新增] tsconfig/jsconfig paths 解析
                              # (如果独立文件存在)
```

#### Gap C4：Re-export 链传递解析

```typescript
// import-resolver.ts 中的 re-export 解析
// 场景: index.ts re-exports from internal modules
//
// a.ts: export { Foo } from './foo'
// b.ts: import { Foo } from './a'   ← 需要穿透 re-export 链
//
// extractReExports() 构建 re-export 映射:
//   { 'a.ts::Foo' → 'foo.ts::Foo' }
// resolveViaImport() 在解析时自动穿透链

// 来源: codegraph/src/resolution/import-resolver.ts L225, L296
// 复用策略: import-resolver.ts 已在取用清单, 但此能力需要
//          在验收测试中明确覆盖 re-export 场景
```

#### Gap C5：YAML/Twig/properties file-level tracking

CodeGraph 对无法 tree-sitter 解析的文件类型（YAML, Twig, Java properties）仍做**文件级索引**：

```typescript
// grammars.ts 中的 file-level-only 语言
// 这些语言没有 tree-sitter grammar, 但 CodeGraph 仍然:
// 1. 注册文件到 files 表 (content_hash 追踪变更)
// 2. 创建 'file' 类型的 node (无子符号)
// 3. 允许 path: 过滤匹配这些文件

const FILE_LEVEL_ONLY_LANGUAGES = ['yaml', 'twig', 'properties'];

function isFileLevelOnlyLanguage(lang: Language): boolean {
  return FILE_LEVEL_ONLY_LANGUAGES.includes(lang);
}

// 在 extraction/index.ts 中:
// if (isFileLevelOnlyLanguage(language)) {
//   → 创建 file node, 不调用 tree-sitter
//   → 仍然注册到 files 表追踪变更
// }
```

**补充位置**: `src/graph/kg/extraction/code/` 的 orchestrator 中需要处理此逻辑。

#### Gap C6：Small-repo autotrace + staleness + tool allowlist

CodeGraph MCP 工具中有 3 个面向小仓库和运行时健康的工程化特性：

```
1. Small-repo Autotrace (tools.ts:1240)
   当项目 < 500 文件时, codegraph_explore 自动执行 trace
   (大项目需要用户显式调用 codegraph_trace)
   → 小仓库获得更丰富的默认上下文

2. Staleness Detection (tools.ts:959)
   检测 .codegraph/ 索引是否过期 (files.modified_at vs 文件系统 mtime)
   → 过期时在 MCP 返回中注入警告:
     "⚠️ Index may be stale. Run `codegraph index` to update."

3. Tool Allowlist (tools.ts:732)
   限制每个 project session 可用的 MCP 工具子集
   → 防止非初始化项目调用搜索工具导致 crash

补充: 这些是 MCP UX 细节, 在 R8 (MCP Server) 阶段实现。
```

#### Gap C7：Resolver LRU + batched resolution + postExtract

CodeGraph 的引用解析层有 3 个性能优化机制：

```typescript
// 1. Resolution LRU Cache (resolution/lru-cache.ts)
// 缓存 "referenceName → resolved nodeId" 映射
// 避免对同一符号名重复做 6 级匹配策略
// 容量: 可配置, 默认按项目规模自适应

// 2. Batched Resolution (resolution/index.ts:717)
// resolveAndPersistBatched(): 不是逐个解析 unresolved_ref
// 而是按 file_path 分组, 批量加载同文件的全部引用
// → 减少 SQLite 查询次数, 大项目快 3-5x

// 3. postExtract / finalizeFrameworkExtractions (resolution/index.ts:235)
// 框架解析器的 postExtract 钩子:
//   每个框架 resolver 可以注册 postExtract 回调
//   在全量提取完成后执行框架级别的全局优化
//   例: Express resolver 在 postExtract 中合并路由树

// 复用策略: resolution/index.ts 和 lru-cache.ts 已在取用清单,
// 但需在 R4 实施阶段明确验证这 3 个机制的正确迁移
```

#### Gap C8：Public lifecycle contract

CodeGraph 的 `index.ts` 暴露了完整的生命周期 API，设计文档的 `engine.ts` 需要对齐：

```typescript
// CodeGraph Public API (index.ts)

class CodeGraph {
  // Lifecycle
  static async init(projectRoot, options?): Promise<CodeGraph>   // 首次初始化
  static initSync(projectRoot): CodeGraph                        // 同步初始化
  static async open(projectRoot, options?): Promise<CodeGraph>   // 打开已有项目
  static openSync(projectRoot): CodeGraph                        // 同步打开
  static isInitialized(projectRoot): boolean                     // 检测是否已初始化
  close(): void                                                  // 关闭 + 释放资源 + 释放锁

  // Indexing
  async indexAll(options?): Promise<IndexResult>                  // 全量索引
  async sync(options?): Promise<SyncResult>                      // 增量同步
  resolveReferences(): ResolutionResult                          // 引用解析 (同步)

  // Query
  searchNodes(query, options?): SearchResult[]                   // 搜索
  getNode(id): Node | null                                       // 按 ID 获取节点
  getCallers(nodeId, depth?): Subgraph                           // 调用方
  getCallees(nodeId, depth?): Subgraph                           // 被调用方
  getImpact(nodeId, depth?): Subgraph                            // 影响分析
  getTypeHierarchy(nodeId): Subgraph                             // 类型层次
  traverse(startId, options?): Subgraph                          // 通用遍历

  // Context
  buildContext(task): TaskContext                                 // 构建任务上下文
  findRelevantContext(query, options?): TaskContext               // 查找相关上下文

  // File Watch
  startWatching(options?): void                                  // 启动文件监听
  unwatch(): void                                                // 停止监听

  // Stats
  getStats(): GraphStats                                         // 图谱统计
  getDetectedFrameworks(): string[]                              // 检测到的框架
}
```

**MaestroGraph 的 `engine.ts` 需要实现的对应 API**:

```typescript
class MaestroGraph {
  // Lifecycle — 同 CodeGraph
  static async init(projectRoot, options?): Promise<MaestroGraph>
  static async open(projectRoot, options?): Promise<MaestroGraph>
  static isInitialized(projectRoot): boolean
  close(): void

  // Indexing — 双轨 (代码 + 知识)
  async indexAll(options?): Promise<UnifiedIndexResult>           // 代码 + 知识全量
  async indexCode(options?): Promise<IndexResult>                 // 仅代码
  async indexKnowledge(options?): Promise<KnowledgeIndexResult>   // 仅知识
  async sync(options?): Promise<UnifiedSyncResult>               // 增量同步
  resolveReferences(): ResolutionResult                          // 代码引用解析
  resolveKnowledgeEdges(): KnowledgeResolutionResult             // 知识跨源边解析

  // Query — CodeGraph parity + 知识扩展
  searchNodes(query, options?): SearchResult[]                   // 代码搜索
  searchKnowledge(query, options?): SearchResult[]               // 知识搜索
  searchUnified(query, options?): UnifiedSearchResult[]          // 统一搜索
  getNode(id): UnifiedNode | null
  getCallers(nodeId, depth?): Subgraph
  getCallees(nodeId, depth?): Subgraph
  getImpact(nodeId, depth?): Subgraph
  getTypeHierarchy(nodeId): Subgraph
  traverse(startId, options?): Subgraph

  // Context — 统一上下文 (代码 + 知识)
  buildContext(task): UnifiedTaskContext
  findRelevantContext(query, options?): UnifiedTaskContext

  // File Watch
  startWatching(options?): void
  unwatch(): void

  // Stats
  getStats(): UnifiedGraphStats                                  // 含代码 + 知识统计
  getDetectedFrameworks(): string[]
}
```

---

### 修订后的工期影响

Codex 额外 gap 对工期的增量影响：

| Phase | 原修订估计 | Codex gap 增量 | 最终估计 | 原因 |
|-------|----------|---------------|---------|------|
| R3 Code Extraction | 12 天 | +1 天 | **13 天** | file-level tracking (C5) |
| R4 Resolution | 10 天 | +2 天 | **12 天** | go.mod/tsconfig/re-export (C3,C4) + resolver LRU/batch (C7) |
| R5 Query + Search | 6 天 | +1 天 | **7 天** | lifecycle API 完整性 (C8) |
| R8 MCP Server | 5 天 | +3 天 | **8 天** | 6 个额外工具 (C1) + autotrace/staleness/allowlist (C6) |
| **总计** | **50 天** | **+7 天** | **57 天** | |

最终里程碑：
- **M1 (R1-R4, 33 天)**: 核心引擎 — 提取 + 解析 + 存储
- **M2 (R5-R6, 12 天)**: 查询 + 同步 — 搜索和增量更新
- **M3 (R7-R8, 12 天)**: 对外接口 — hook 统一 + 9 个 MCP 工具

---

### Codex 推荐的质量门禁

> "先做 CodeGraph parity checklist 作为 R0 gate"

建议在 R1 之前新增 **R0: Parity Verification Gate**（2 天）：

```
R0: CodeGraph Parity Checklist (2 天)
├── 将本文档所有 ❌/⚠️ 功能点转为三选一:
│   ├── INCLUDED — 确认复用/重写, 标注来源文件和行号
│   ├── INTENTIONALLY_DROPPED — 明确放弃, 记录理由
│   └── REPLACED_BY_X — 用替代方案覆盖, 记录对等证明
│
├── 建立 Golden Behavior Tests:
│   ├── extraction/ — 每种语言 + 每个特殊提取器至少 1 个 fixture
│   ├── resolution/ — 每个框架 resolver 至少 1 个 fixture
│   ├── callback-synthesizer — 14 个阶段各 1 个 fixture
│   ├── search — FTS5/LIKE/fuzzy 各 1 个 case + scoring 验证
│   └── schema — 全部表/索引/触发器存在性验证
│
└── 产出: parity-checklist.json (机器可读, CI 可验证)
```

最终计划：**R0 (2天) + M1 (33天) + M2 (12天) + M3 (12天) = 59 天**

---

## 附录 A：设计漏洞审计与修复方案

> 以下修复方案来自多维度设计审计（数据安全、性能、一致性、架构集成、运维、UX、CJK、边界情况），覆盖 MaestroGraph 相关的 20 个漏洞。Domain 系统相关漏洞见 [plan-domain-knowledge.md 附录 A](./plan-domain-knowledge.md#附录-a设计漏洞审计与修复方案)。

### 漏洞总览

| 编号 | 维度 | 漏洞 | 优先级 | 预估 |
|------|------|------|--------|------|
| D1.4 | 数据安全 | SQLite 跨进程写锁缺失 | P0 | 0.5 天 |
| D1.5 | 数据安全 | FTS5 输入未消毒 | P0 | 0.5 天 |
| D2.3 | 性能 | knowledge-resolver 低效 SQL | P1 | 1 天 |
| D2.4 | 性能 | 同步无优先级调度 | P2 | 0.5 天 |
| D2.5 | 性能 | 关系传播无深度/广度限制 | P0 | 0.5 天 |
| D3.1 | 一致性 | WikiIndexer 与 MaestroGraph 双重索引 | P0 | 1 天 |
| D3.2 | 一致性 | Domain 删除后残留边 | P0 | 0.5 天 |
| D3.4 | 一致性 | FTS5 触发器 source_type 路由假设 | P0 | 0.5 天 |
| D3.5 | 一致性 | knowledge-resolver defines 边过度匹配 | P1 | 1 天 |
| D4.3 | UX | 搜索结果缺少溯源解释 | P2 | 1 天 |
| D4.4 | UX | MCP 工具无降级策略 | P1 | 1 天 |
| D5.1 | 架构 | 现有系统迁移路径未定义 | P1 | 2 天 |
| D5.2 | 架构 | Hook 过渡期无共存机制 | P0 | 1 天 |
| D5.3 | 架构 | CodeGraph 与 MaestroGraph 共存冲突 | P0 | 0.5 天 |
| D5.4 | 架构 | Domain hook 修改在 MaestroGraph 阶段被覆盖 | P1 | 1 天 |
| D6.1 | 运维 | knowledge-resolver 无可观测性 | P2 | 1 天 |
| D6.2 | 运维 | MaestroGraph DB 无健康检查 | P1 | 1 天 |
| D6.3 | 运维 | 无索引损坏恢复机制 | P1 | 1.5 天 |
| D7.1 | CJK | FTS5 单一 tokenizer 无法兼顾中英文 | P0 | 0.5 天 |
| D8.4 | 边界 | term id 与 node id 命名空间冲突 | P0 | 0.5 天 |

---

### D1.4 SQLite 跨进程写锁缺失

**[问题]**
maestro.db 被三个入口同时写入：CLI 命令、MCP daemon、git hook。SQLite WAL 模式允许并发读但写锁是整库级别，多写入者会触发 `SQLITE_BUSY`。

**[修复]**
双层策略：SQLite 连接层设置 `busy_timeout` + 应用层 `FileLock` 保护长写操作。

**[实现位置]**
- 修改: `src/graph/kg/db/connection.ts`
- 新增: `src/graph/kg/sync/incremental-sync.ts` 中的锁集成

**[代码片段]**

```typescript
// src/graph/kg/db/connection.ts
export function openKgDatabase(projectPath: string): Database.Database {
  const dbPath = join(projectPath, '.workflow', 'kg', 'maestro.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

```typescript
// src/graph/kg/sync/incremental-sync.ts — 全量同步用 FileLock
export async function syncKnowledgeGraph(projectPath: string, options: { full?: boolean }): Promise<SyncResult[]> {
  const lock = new FileLock(join(projectPath, '.workflow', 'kg', '.maestro-db.lock'));
  return lock.withLock(() => {
    const db = openKgDatabase(projectPath);
    try {
      return db.transaction(() => { /* 各 adapter 同步逻辑 */ })();
    } finally { db.close(); }
  });
}
```

**[对现有设计的影响]**
- 第三节 Storage Layer 标注 "WAL + busy_timeout 5s + FileLock"
- `.maestro-db.lock` 加入 `.gitignore`

---

### D1.5 FTS5 输入未消毒

**[问题]**
用户 prompt 中的 `*`、`"`、`(`、`NOT`、`NEAR` 等被 FTS5 解释为查询语法，导致 SQL 异常。

**[修复]**
在构建 FTS5 MATCH 前转义所有特殊语法字符。

**[实现位置]**
- 新增: `src/graph/kg/query/fts-sanitize.ts`
- 修改: `src/graph/kg/query/search.ts`

**[代码片段]**

```typescript
// src/graph/kg/query/fts-sanitize.ts
const FTS5_SPECIAL_CHARS = /[*"(){}[\]:^~+\-!\\]/g;
const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b/gi;

export function sanitizeFtsQuery(input: string): string {
  const tokens = input.replace(FTS5_SPECIAL_CHARS, ' ').split(/\s+/)
    .filter(t => t.length > 0).map(t => t.replace(FTS5_OPERATORS, '')).filter(t => t.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}
```

```typescript
// src/graph/kg/query/search.ts — 调用消毒后查询
function searchCodeFTS(query: string, db: Database): SearchResult[] {
  const safeQuery = sanitizeFtsQuery(query);
  try {
    return db.prepare(`SELECT ... FROM code_fts WHERE code_fts MATCH ? ORDER BY bm25(...) LIMIT ?`)
      .all(safeQuery, opts.limit ?? 20);
  } catch {
    return searchNodesLike(query, db, opts);  // 降级到 LIKE
  }
}
```

**[对现有设计的影响]**
- Gap 修补 6 的 `searchUnified` 在 FTS5 调用前必须插入 `sanitizeFtsQuery`
- MCP 工具的 `MAX_INPUT_LENGTH = 10,000 chars` 是第二道防线

---

### D2.3 knowledge-resolver 低效 SQL

**[问题]**
当前 knowledge-resolver 通过 `json_each(d.aliases) JOIN c.name` 做跨源匹配。`json_each` 在 SQLite 中是虚表扫描，对每个 domain term 的每个 alias 都做全表 JOIN，复杂度 O(D×A×C)。

**[修复]**
应用层 alias 展开 + IN-clause 批量匹配 + FTS5 MATCH 替代 LIKE。

**[代码片段]**

```typescript
// 应用层展开 alias → 批量 IN-clause
const allAliases: Array<{ domainId: string; alias: string }> = [];
for (const domain of domainNodes) {
  const aliases: string[] = JSON.parse(domain.aliases || '[]');
  for (const alias of [domain.name, ...aliases]) {
    allAliases.push({ domainId: domain.id, alias });
  }
}
// 分批查询（每批 500 参数）
const BATCH_SIZE = 500;
for (let i = 0; i < allAliases.length; i += BATCH_SIZE) {
  const batch = allAliases.slice(i, i + BATCH_SIZE);
  const placeholders = batch.map(() => '?').join(',');
  const matches = db.prepare(`
    SELECT id, name, kind FROM nodes
    WHERE source_type = 'codegraph' AND name IN (${placeholders})
  `).all(batch.map(b => b.alias));
  // ... 建立 defines 边
}
```

**[对现有设计的影响]**
- 第一节 Cross-source Edge Resolution 的 SQL 策略从 `json_each JOIN` 改为应用层 IN-clause

---

### D2.4 同步无优先级调度

**[问题]**
`kg-sync` hook 将代码索引和知识索引放在同一队列。知识源（domain/spec/knowhow）文件少但对 hook 注入敏感，代码源文件多但注入不紧急。

**[修复]**
优先级双队列：knowledge 源（domain/spec/knowhow/wiki）优先同步，code 源异步后台。

**[代码片段]**

```typescript
async function syncIncremental(changedFiles: string[]): Promise<void> {
  const knowledgeFiles = changedFiles.filter(f => isKnowledgeSource(f));
  const codeFiles = changedFiles.filter(f => !isKnowledgeSource(f));
  // 知识源立即同步（同步阻塞，确保 hook 注入最新数据）
  if (knowledgeFiles.length > 0) await syncBatch(knowledgeFiles, { priority: 'high' });
  // 代码源异步后台（不阻塞 hook 返回）
  if (codeFiles.length > 0) queueAsyncSync(codeFiles);
}
```

---

### D2.5 关系传播无深度/广度限制

**[问题]**
`expandRelated(db, nodeIds, { maxDepth })` 的 `maxDepth` 在调用方可被设为任意值。大型图中 3 跳以上可能返回数千节点。

**[修复]**
硬限制: `MAX_PROPAGATION_DEPTH = 3`、`MAX_RELATED_TERMS = 50` + visited Set 防止环。

**[代码片段]**

```typescript
const MAX_PROPAGATION_DEPTH = 3;
const MAX_RELATED_TERMS = 50;

function expandRelated(db: Database, seedNodeIds: string[], opts: { maxDepth: number }): RelatedNode[] {
  const depth = Math.min(opts.maxDepth, MAX_PROPAGATION_DEPTH);
  const visited = new Set<string>(seedNodeIds);
  const results: RelatedNode[] = [];
  let frontier = [...seedNodeIds];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (results.length >= MAX_RELATED_TERMS) return results;
      const neighbors = db.prepare(`
        SELECT target AS id, kind FROM edges WHERE source = ?
        UNION SELECT source AS id, kind FROM edges WHERE target = ?
      `).all(nodeId, nodeId);
      for (const n of neighbors) {
        if (!visited.has(n.id)) {
          visited.add(n.id);
          next.push(n.id);
          results.push({ nodeId: n.id, depth: d + 1, edgeKind: n.kind });
        }
      }
    }
    frontier = next;
  }
  return results;
}
```

---

### D3.1 WikiIndexer 与 MaestroGraph 双重索引

**[问题]**
plan-domain-knowledge.md 第七节设计了 WikiIndexer 扫描 glossary.json，同时 MaestroGraph 的 `domain-extractor.ts` 也将 glossary.json 提取为 `domain_term` 节点。`maestro search "Tenant"` 会返回重复结果。

**[修复]**
确立"单一索引权威源"原则：**MaestroGraph 是 domain 的唯一索引**。WikiIndexer 从 maestro.db 读取 domain_term 节点，不直接扫描 glossary.json。

**[实现位置]**
- 修改: `dashboard/src/server/wiki/wiki-indexer.ts`
- 新增: `dashboard/src/server/wiki/virtual-wiki-adapters.ts` — `adaptDomainEntries()`

**[代码片段]**

```typescript
// dashboard/src/server/wiki/virtual-wiki-adapters.ts
export function adaptDomainEntries(workflowRoot: string): WikiEntry[] {
  const dbPath = join(workflowRoot, 'kg', 'maestro.db');
  if (existsSync(dbPath)) {
    // 主路径: 从 MaestroGraph 读取（单一索引源）
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare(`
        SELECT id, name, definition, aliases, keywords
        FROM nodes WHERE source_type = 'domain' AND status = 'active'
      `).all();
      return rows.map(row => ({
        id: row.id, type: 'domain' as WikiNodeType, title: row.name,
        summary: row.definition, body: row.definition, category: 'domain',
        tags: [...safeJsonParse(row.aliases, []), ...safeJsonParse(row.keywords, [])],
      }));
    } finally { db.close(); }
  }
  // 降级: MaestroGraph 未初始化时直接读 glossary.json
  return adaptGlossaryDirect(workflowRoot);
}
```

**[对现有设计的影响]**
- plan-domain-knowledge.md 第七节改为 "WikiIndexer 从 MaestroGraph 读取 domain 节点"
- 对 MaestroGraph 未初始化的项目保留降级路径

---

### D3.2 Domain 删除后残留边

**[问题]**
`maestro domain remove` 删除 glossary.json 中的 term，但 maestro.db 中对应节点和边仍存在。

**[修复]**
在 `removeTerm` 操作后立即触发 KG 增量清理。edges 通过 `ON DELETE CASCADE` 自动级联删除。

**[代码片段]**

```typescript
// src/graph/kg/extraction/knowledge/domain-extractor.ts
export function purgeDomainTerm(db: Database.Database, termId: string): void {
  const nodeId = `domain:${termId}`;
  db.transaction(() => {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    db.prepare('DELETE FROM edges WHERE target = ?').run(nodeId);  // 补充: target 侧清理
  })();
}
```

```typescript
// src/tools/domain-loader.ts — removeTerm 末尾追加
const dbPath = join(workflowRoot, 'kg', 'maestro.db');
if (existsSync(dbPath)) {
  const db = openKgDatabase(join(workflowRoot, '..'));
  try { purgeDomainTerm(db, termId); } finally { db.close(); }
}
```

---

### D3.4 FTS5 触发器 source_type 路由假设

**[问题]**
FTS5 触发器按 `source_type` 路由，但 `source_type` 可为 NULL，`WHERE NEW.source_type IS NULL` 分支会将未设置来源的节点错误归类为代码节点。

**[修复]**
`source_type` 改为 `NOT NULL DEFAULT 'codegraph'` + 触发器移除 NULL 分支。

**[Schema 修订]**

```sql
CREATE TABLE IF NOT EXISTS nodes (
    -- ...
    source_type     TEXT NOT NULL DEFAULT 'codegraph',
    -- ...
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature
    WHERE NEW.source_type = 'codegraph';

    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type != 'codegraph';
END;
```

**[对现有设计的影响]**
- Gap 修补 1 schema 中 `source_type TEXT` 改为 `source_type TEXT NOT NULL DEFAULT 'codegraph'`
- 所有 extractor 必须显式设置 `source_type`

---

### D3.5 knowledge-resolver defines 边过度匹配

**[问题]**
Rule 1 通过 `d.name = c.name` 匹配 domain_term 和 code node。名为 "Error"、"Config" 等通用名称会匹配大量代码节点。

**[修复]**
多维置信度打分 + 阈值门控（0.6）+ 通用名称黑名单。

**[代码片段]**

```typescript
const GENERIC_NAMES = new Set([
  'Error', 'Config', 'State', 'Event', 'Action', 'Type', 'Result',
  'Response', 'Request', 'Context', 'Options', 'Handler', 'Factory',
  'Service', 'Provider', 'Controller', 'Component', 'Module',
]);
const DEFINES_CONFIDENCE_THRESHOLD = 0.6;

function resolveDefinesEdges(db: Database): UnifiedEdge[] {
  const candidates = db.prepare(`
    SELECT d.id AS did, d.name AS dname, c.id AS cid, c.name AS cname, c.kind, c.file_path
    FROM nodes d JOIN nodes c ON d.name = c.name
    WHERE d.source_type = 'domain' AND c.source_type = 'codegraph'
      AND c.kind IN ('class', 'interface', 'struct', 'type_alias', 'enum')
      AND c.file_path NOT LIKE '%node_modules%'
  `).all();

  return candidates.filter(c => {
    let conf = 0.5;
    if (GENERIC_NAMES.has(c.dname)) conf -= 0.3;
    const node = db.prepare('SELECT is_exported FROM nodes WHERE id = ?').get(c.cid);
    if (node?.is_exported) conf += 0.15;
    // keywords 出现在代码路径中加分
    const dnode = db.prepare('SELECT keywords FROM nodes WHERE id = ?').get(c.did);
    const kws: string[] = JSON.parse(dnode?.keywords || '[]');
    if (kws.some(kw => c.file_path.toLowerCase().includes(kw.toLowerCase()))) conf += 0.2;
    // 同名节点过多降权
    const cnt = db.prepare(`SELECT COUNT(*) as n FROM nodes WHERE name = ? AND source_type = 'codegraph'`).get(c.cname)?.n;
    if (cnt > 3) conf -= 0.2;
    return conf >= DEFINES_CONFIDENCE_THRESHOLD;
  }).map(c => ({ source: c.did, target: c.cid, kind: 'defines', provenance: 'knowledge-resolver' }));
}
```

**[对现有设计的影响]**
- 第一节 Cross-source Resolution Rule 1 重写为置信度打分模式
- edges 表 `metadata` 存储 `confidence` 值

---

### D4.3 搜索结果缺少溯源解释

**[问题]**
`maestro search "tenant"` 返回混合结果但不解释"为什么出现"。用户无法区分直接匹配和边传播命中。

**[修复]**
搜索结果添加 `MatchReason` annotation。

**[代码片段]**

```typescript
type MatchReason =
  | { kind: 'direct'; field: 'name' | 'definition' | 'aliases' | 'keywords' }
  | { kind: 'edge'; fromNodeId: string; fromNodeName: string; edgeKind: string }
  | { kind: 'hop'; path: Array<{ nodeName: string; edgeKind: string }> };

// CLI 输出示例:
//   [domain] Tenant — 多租户隔离单元
//     匹配: name
//   [spec] RLS 数据隔离
//     关联: Tenant --derived_from--> RLS 数据隔离
//   [codegraph] interface Tenant (src/models/tenant.ts:15)
//     关联: Tenant --defines--> interface Tenant
```

**[对现有设计的影响]**
- Gap 修补 6 搜索输出格式追加 `matchReason`
- MCP 工具 `maestro_kg_search` 返回新增 `matchReason` 字段

---

### D4.4 MCP 工具无降级策略

**[问题]**
项目未执行 `maestro kg init` 时，9 个 MCP 工具全部因数据库不存在而报错。

**[修复]**
前置检查 + 分级降级：`ready` / `stale`（执行 + 注入警告）/ `uninitialized`（返回引导信息，不报错）。

**[代码片段]**

```typescript
function precheckKg(projectPath: string): KgPrecheck {
  const dbPath = join(projectPath, '.workflow', 'kg', 'maestro.db');
  if (!existsSync(dbPath)) return {
    status: 'uninitialized', dbPath: null,
    message: 'MaestroGraph 未初始化。运行 `maestro kg init` 创建知识图谱。',
  };
  const db = openReadonly(dbPath);
  const staleCount = db.prepare(`SELECT COUNT(*) as n FROM files WHERE indexed_at < modified_at`).get()?.n;
  if (staleCount > 0) return { status: 'stale', dbPath, message: `${staleCount} 文件需重新索引` };
  return { status: 'ready', dbPath };
}

function withPrecheck(handler) {
  return async (input) => {
    const check = precheckKg(input.projectPath);
    if (check.status === 'uninitialized') return {
      content: [{ type: 'text', text: `${check.message}\n\n快速开始:\n  1. maestro kg init\n  2. maestro kg sync\n  3. 重新调用此工具` }],
      isError: false,  // 引导，不是错误
    };
    const result = await handler(openReadonly(check.dbPath!), input);
    if (check.status === 'stale') result.content[0].text += `\n---\n⚠ ${check.message}`;
    return result;
  };
}
```

**[对现有设计的影响]**
- `maestro_kg_status` 工具始终可用（即使未初始化也返回状态信息）
- 其余 8 个工具包裹 `withPrecheck`

---

### D5.1 现有系统迁移路径未定义

**[问题]**
现有项目有 `.codegraph/` + `.workflow/specs/` + `.workflow/knowhow/`，但无 `maestro kg migrate` 命令。

**[修复]**
设计 `maestro kg migrate` 命令，三阶段迁移：探测 → 提取 → 验证。迁移是**非破坏性的**——原始文件保持不变，`maestro.db` 是只读索引。

**[实现位置]**
- 新增: `src/graph/kg/migration/migrate-legacy.ts`
- 修改: `src/commands/kg.ts` — `migrate` 子命令

**[代码片段]**

```typescript
interface MigrationResult {
  sources: Array<{ name: string; detected: boolean; path: string; nodeCount?: number }>;
  nodesImported: number;
  edgesImported: number;
  edgesResolved: number;
  durationMs: number;
  warnings: string[];
}

export async function migrateLegacyToKg(projectPath: string, opts?: { dryRun?: boolean }): Promise<MigrationResult> {
  // Phase 1: Detect — scan .codegraph/, specs/, knowhow/, domain/
  // Phase 2: Extract — call each source adapter
  // Phase 3: Verify — compare pre/post node/edge counts
  // Phase 4: Cross-source edge resolution
}
```

**[对现有设计的影响]**
- 依赖 R2 完成后实施（需要 schema 和 adapter 就绪）
- 预估 2 天

---

### D5.2 Hook 过渡期无共存机制

**[问题]**
R7 计划用 1 个 `kg-unified-injector` 替代现有 5 个 hook，但 M1-M2 期间新旧必须共存。

**[修复]**
利用现有 hook toggle 系统和 `HOOK_DEFS` level 机制，三阶段灰度切换：

| 阶段 | kg-unified-injector level | 旧 hook | 条件 |
|------|--------------------------|---------|------|
| M1-M2 | `full`（默认不装） | 正常运行 | 无 |
| M3 早期 | `full` + toggle 启用 | 正常运行 | `kgUnifiedInjector: true` |
| M3 后期 | `standard`（默认安装） | 降为 `full` | maestro.db 可用 |

**[关键设计]**
统一 hook 内部有 fallback 逻辑——如果 `maestro.db` 不可用，自动降级到调用旧 evaluator 函数：

```typescript
// src/hooks/kg-unified-injector.ts
export async function evaluateUnifiedInjection(agentType, prompt, projectPath, sessionId) {
  if (loadHooksConfig().toggles['kgUnifiedInjector'] === false) return { inject: false };
  const dbPath = join(projectPath, '.workflow', 'kg', 'maestro.db');
  if (!existsSync(dbPath)) return fallbackToLegacyInjection(agentType, prompt, projectPath, sessionId);
  // ... 统一查询路径
}
```

---

### D5.3 CodeGraph 与 MaestroGraph 共存冲突

**[问题]**
两个系统都通过 hook 注入代码上下文。`kg-context-injector` 从 `.codegraph/` 读取，`kg-unified-injector` 从 `maestro.db` 读取。同时运行会产生重复注入。

**[修复]**
互斥检测：当统一 hook 活跃时，旧 hook 自动让步。

**[实现位置]**
- 新增: `src/hooks/shared/injector-mutex.ts`
- 修改: `src/hooks/kg-context-injector.ts` + `keyword-spec-injector.ts`

**[代码片段]**

```typescript
// src/hooks/shared/injector-mutex.ts
export function isUnifiedInjectorActive(projectPath: string): boolean {
  const config = loadHooksConfig();
  if (config.toggles['kgUnifiedInjector'] === false) return false;
  return existsSync(join(projectPath, '.workflow', 'kg', 'maestro.db'));
}

// 旧 hook 入口增加检查
if (isUnifiedInjectorActive(projectPath)) return { inject: false, reason: 'deferred-to-unified' };
```

---

### D5.4 Domain hook 修改在 MaestroGraph 阶段被覆盖

**[问题]**
Domain Phase 3 修改 `keyword-spec-injector` 和 `spec-injector` 加入 domain 注入。R7 用统一 hook 替代这两个 hook，Domain 修改变成临时代码。

**[修复]**
Domain Phase 3 遵循**可提取原则**——将 domain 匹配逻辑封装为独立函数 `matchDomainTerms()`（`src/tools/domain-matcher.ts`），R7 统一 hook 直接调用同一函数。

```typescript
// src/tools/domain-matcher.ts — 可被两阶段复用
export function matchDomainTerms(prompt: string, projectPath: string): DomainMatchResult {
  // 返回 { compactSummary, expandedSections, matchedTermIds }
}

// Phase 3: keyword-spec-injector 调用
const domain = matchDomainTerms(prompt, projectPath);
// R7: kg-unified-injector 同样调用
const domain = matchDomainTerms(prompt, projectPath);
```

---

### D6.1 knowledge-resolver 无可观测性

**[问题]**
跨源边自动建立是黑盒，没有日志、analytics、dry-run 模式。

**[修复]**
复用 `spec-analytics.ts` 的 jsonl-log 模式，三层可观测性：

1. **Resolution Log**: 每次 resolve 的 jsonl 日志（`.workflow/kg/resolution.jsonl`）
2. **Dry-run**: `maestro kg resolve --dry-run` 输出将建立的边
3. **Stats**: `maestro kg stats --resolution` 输出统计

**[代码片段]**

```typescript
interface ResolutionLogEntry {
  timestamp: string;
  rule: string;        // 'defines' | 'constrains' | 'documents'
  sourceId: string;
  targetId: string;
  confidence: 'exact' | 'heuristic' | 'fuzzy';
  matchDetail: string;
}

export function logResolutionEdge(projectPath: string, entry: ResolutionLogEntry): void {
  appendLine(join(projectPath, '.workflow', 'kg', 'resolution.jsonl'), entry);
}
```

---

### D6.2 MaestroGraph DB 无健康检查

**[问题]**
无法检测 maestro.db 索引过期、数据完整性、FTS5 损坏。

**[修复]**
`maestro kg health` 命令，5 个健康指标：

| 指标 | pass | warn | fail |
|------|------|------|------|
| DB 存在 | 存在 | — | 不存在 |
| Schema 版本 | 最新 | 旧版本 | — |
| 过期率 | < 10% | < 30% | ≥ 30% |
| 源覆盖 | 所有期望源 | 缺少可选源 | 缺少必需源 |
| FTS5 完整性 | integrity-check 通过 | — | 损坏 |

**[代码片段]**

```typescript
export function checkKgHealth(projectPath: string): HealthCheckResult {
  const db = openKgDatabase(projectPath);
  // Check staleness
  const staleFiles = db.prepare('SELECT COUNT(*) as n FROM files WHERE modified_at > indexed_at').get()?.n;
  const totalFiles = db.prepare('SELECT COUNT(*) as n FROM files').get()?.n;
  const stalenessRatio = totalFiles > 0 ? staleFiles / totalFiles : 0;
  // Check FTS5 integrity
  try { db.prepare("INSERT INTO code_fts(code_fts) VALUES('integrity-check')").run(); }
  catch { /* fts corrupted */ }
  // ... aggregate to overall status
}
```

---

### D6.3 无索引损坏恢复机制

**[问题]**
maestro.db 损坏后需完整重建，但没有检测和恢复命令。

**[修复]**
三层恢复：

1. **自动检测**: hook 中轻量级 `PRAGMA quick_check`（每 60 秒一次，缓存结果）
2. **手动重建**: `maestro kg rebuild` 删除 DB 后从源重建
3. **优雅降级**: 损坏时 hook 自动 fallback 到旧注入路径

**[代码片段]**

```typescript
// 快速损坏检测（hook 热路径，< 50ms）
export function quickCorruptionCheck(dbPath: string): { healthy: boolean; issues: string[] } {
  try {
    const db = new Database(dbPath, { readonly: true });
    const qc = db.prepare('PRAGMA quick_check(1)').get();
    if (qc.quick_check !== 'ok') return { healthy: false, issues: [qc.quick_check] };
    db.prepare("SELECT COUNT(*) FROM code_fts WHERE code_fts MATCH 'test' LIMIT 1").get();
    return { healthy: true, issues: [] };
  } catch (e) { return { healthy: false, issues: [e.message] }; }
}

// 统一 hook 中的周期性检测 + fallback
let _corruptionCache: { ts: number; ok: boolean } | null = null;
if (!_corruptionCache || Date.now() - _corruptionCache.ts > 60_000) {
  const check = quickCorruptionCheck(dbPath);
  _corruptionCache = { ts: Date.now(), ok: check.healthy };
  if (!check.healthy) return fallbackToLegacyInjection(...);
}
```

---

### D7.1 FTS5 分裂 tokenizer

**[问题]**
单一 FTS5 虚表无法同时满足代码搜索（需要 camelCase 分词）和知识搜索（需要 CJK 支持）。

**[修复]**
拆分为两个 FTS5 虚表：
- `code_fts`: 使用 `unicode61` tokenizer（适合代码标识符）
- `knowledge_fts`: 使用 `trigram` tokenizer（支持 CJK 子串匹配）

**[Schema]**

```sql
CREATE VIRTUAL TABLE code_fts USING fts5(
    id, name, qualified_name, docstring, signature,
    tokenize = 'unicode61 remove_diacritics 2',
    content = 'nodes', content_rowid = 'rowid'
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
    id, name, definition, body, aliases, keywords,
    tokenize = 'trigram',
    content = 'nodes', content_rowid = 'rowid'
);
```

**[CJK 降级]**
2 字符 CJK 查询 trigram 无法匹配（trigram 最小单元 3 字符），降级到 LIKE：

```typescript
function searchKnowledge(query: string, db: Database): SearchResult[] {
  const isCjkShort = /^[一-鿿぀-ヿ가-힯]{1,2}$/.test(query);
  if (isCjkShort) {
    return db.prepare(`SELECT ... FROM nodes WHERE source_type != 'codegraph' AND name LIKE ?`)
      .all(`%${query}%`);
  }
  return db.prepare(`SELECT ... FROM knowledge_fts WHERE knowledge_fts MATCH ?`).all(sanitizeFtsQuery(query));
}
```

---

### D8.4 term id 与 node id 命名空间冲突

**[问题]**
Domain term id 是 kebab-case（如 `auth-flow`），code node 可能有同名标识符。无前缀时 FTS5 搜索和 edge source/target 无法区分来源。

**[修复]**
强制命名空间前缀规范：

| 来源 | ID 格式 | 示例 |
|------|---------|------|
| Code | `code:<file>:<qualified_name>` | `code:src/models/tenant.ts:Tenant` |
| Domain | `domain:<term_id>` | `domain:tenant` |
| Spec | `spec:<file>:<line>` | `spec:specs/project.md:42` |
| Knowhow | `knowhow:<slug>` | `knowhow:DCS-tenant-isolation` |
| Codebase | `codebase:<file>:<heading>` | `codebase:architecture.md:tenant-model` |
| Issue | `issue:<id>` | `issue:ISS-001` |

**[代码片段]**

```typescript
type NodeIdPrefix = 'code' | 'domain' | 'spec' | 'knowhow' | 'codebase' | 'issue';

function makeNodeId(prefix: NodeIdPrefix, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

function validateNodeId(id: string): boolean {
  const VALID = new Set(['code', 'domain', 'spec', 'knowhow', 'codebase', 'issue']);
  const colonIdx = id.indexOf(':');
  return colonIdx > 0 && VALID.has(id.slice(0, colonIdx));
}
```

**[对现有设计的影响]**
- 第一节 Node 统一模型补充 ID 规范
- 所有 extractor 使用 `makeNodeId()` 生成 ID

---

### 修复实施路径

```
Phase 1: 基础保障（M1 开始前，4 天）
├── D5.2 Hook 灰度切换（HOOK_DEFS + toggle）
├── D5.3 CodeGraph 共存互斥
├── D3.4 source_type NOT NULL
├── D8.4 Node ID 命名空间
├── D1.4 SQLite 写锁
├── D1.5 FTS5 消毒
└── D2.5 传播限制

Phase 2: 与 Domain Phase 3 同步（3 天）
├── D5.4 domain-matcher.ts 可提取化
├── D7.1 FTS5 双虚表
└── D3.5 置信度打分

Phase 3: M1 完成后（4 天）
├── D5.1 迁移命令
├── D3.1 单一索引源
├── D3.2 删除级联清理
├── D6.2 健康检查
└── D6.3 损坏恢复

Phase 4: M2-M3 期间（4 天）
├── D4.3 搜索溯源
├── D4.4 MCP 降级
├── D6.1 resolver 可观测性
├── D2.3 SQL 优化
└── D2.4 同步优先级
```

总增量：**~15 天**（分散在各里程碑中，不影响关键路径）

---

## 附录 B：Codebase JSON 废弃与存储统一

### 现状分析

`.workflow/codebase/` 目录下存在两套数据源：

| 文件 | 类型 | 生成方式 | 消费方 |
|------|------|---------|--------|
| `codegraph.db` (SQLite) | 代码索引主后端 | `maestro kg index --sqlite` | `GraphFacade`（优先）、MCP 工具 |
| `knowledge-graph.json` | 历史遗留 JSON | `maestro kg index`（旧） | `WikiIndexer`（直接读 JSON）、`GraphFacade`（降级路径） |
| `doc-index.json` | 结构化文档索引 | `codebase-rebuild` workflow | `WikiIndexer`（`adaptCodebaseDocIndex`） |

**问题**：

1. `GraphFacade.detectBackend()` 优先级为 `sqlite > json > none`。当 `codegraph.db` 存在时，`knowledge-graph.json` 不被 `GraphFacade` 读取——**数据冗余**
2. `WikiIndexer`（`wiki-indexer.ts:497-504`）**绕过 `GraphFacade`**，直接读 `knowledge-graph.json`。两个系统读不同数据源，可能不一致
3. `doc-index.json` 在当前项目中**不存在**（`codebase-rebuild` 从未执行或产物已清理），但 `WikiIndexer` 仍尝试读取
4. MaestroGraph 上线后，`codegraph.db` 将被 `.workflow/kg/maestro.db` 取代，JSON 更无存在必要

### 废弃方案

#### Phase 1：WikiIndexer 切换到 SQLite（M1 前置，1 天）

将 WikiIndexer 对 codebase 的索引从"读 JSON 文件"改为"读 SQLite 数据库"：

**改动文件**：

| 文件 | 改动 |
|------|------|
| `dashboard/src/server/wiki/wiki-indexer.ts` | KG 索引从 `knowledge-graph.json` 切换到 `codegraph.db` |
| `dashboard/src/server/wiki/virtual-wiki-adapters.ts` | 新增 `adaptKnowledgeGraphFromDb()` |
| `src/graph/loader.ts` | `loadGraph()` 标记 `@deprecated` |

**WikiIndexer 改动**：

```typescript
// wiki-indexer.ts — 替换 L497-504

// Before: 直接读 JSON（与 GraphFacade 脱节）
// const kgPath = join(this.workflowRoot, 'codebase', 'knowledge-graph.json');
// out.push(...(await loadVirtualJsonEntries(kgPath, adaptKnowledgeGraph, kgRel)));

// After: 通过 SQLite 读取（与 GraphFacade 一致）
const dbPath = join(this.workflowRoot, 'codebase', 'codegraph.db');
if (existsSync(dbPath) && this.isInsideRoot(dbPath)) {
  const dbRel = toForwardSlash(relative(this.workflowRoot, dbPath));
  const kgEntries = adaptKnowledgeGraphFromDb(dbPath, dbRel);
  crossReferenceKgWithDocIndex(kgEntries, out);
  out.push(...kgEntries);
} else {
  // 降级: 如果 SQLite 不存在但 JSON 存在，仍读 JSON（向后兼容）
  const kgPath = join(this.workflowRoot, 'codebase', 'knowledge-graph.json');
  if (existsSync(kgPath) && this.isInsideRoot(kgPath)) {
    const kgRel = toForwardSlash(relative(this.workflowRoot, kgPath));
    out.push(...(await loadVirtualJsonEntries(kgPath, adaptKnowledgeGraph, kgRel)));
  }
}
```

**新增 adapter**：

```typescript
// virtual-wiki-adapters.ts — 新增

import Database from 'better-sqlite3';

export function adaptKnowledgeGraphFromDb(dbPath: string, sourcePath: string): WikiEntry[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const nodes = db.prepare(`
      SELECT id, kind, name, qualified_name, file_path, docstring, signature
      FROM nodes LIMIT 5000
    `).all();

    return nodes.map(n => ({
      id: `kg-${n.id}`,
      type: 'knowhow' as const,
      title: n.name,
      summary: n.docstring || n.signature || `${n.kind} in ${n.file_path}`,
      tags: [n.kind, ...(n.file_path ? [n.file_path.split('/')[0]] : [])],
      status: 'active' as const,
      created: '', updated: '',
      related: [],
      source: { kind: 'virtual' as const, path: sourcePath },
      body: '',
      raw: n,
      ext: {
        virtualKind: 'kg-node',
        codeLocations: n.file_path ? [n.file_path] : [],
        nodeKind: n.kind,
      },
      scope: null, category: kgCategory(n.kind),
      specCategory: null, createdBy: 'codegraph-db',
      sourceRef: n.id, parent: null,
    }));
  } finally {
    db.close();
  }
}
```

#### Phase 2：删除 JSON 降级路径（M1 完成后，0.5 天）

当确认所有消费方都使用 SQLite 后：

1. 删除 `src/graph/loader.ts` 中的 `loadGraph()` 函数
2. 删除 `src/graph/migration.ts`（JSON → SQLite 迁移工具不再需要）
3. `GraphFacade.detectBackend()` 移除 `json` 分支
4. 删除 `.workflow/codebase/knowledge-graph.json` 文件
5. `virtual-wiki-adapters.ts` 中 `adaptKnowledgeGraph()`（JSON 版）标记废弃

#### Phase 3：合入 MaestroGraph（M3 完成后）

`codegraph.db` 的数据迁移到 `maestro.db`，`.workflow/codebase/` 目录最终只保留 `doc-index.json`（如果 `codebase-rebuild` 仍在使用），或完全废弃。

### 最终存储格式

```
.workflow/
├── kg/
│   └── maestro.db              ← 唯一数据库（统一所有知识源）
├── codebase/
│   └── (目录废弃或仅保留 doc-index.json)
├── domain/
│   └── glossary.json           ← 人工编辑的权威定义（MaestroGraph 的知识源）
├── specs/                      ← 约束规则（MaestroGraph 的知识源）
└── knowhow/                    ← 人工知识文档（MaestroGraph 的知识源）
```
