---
title: "知识沉淀管理系统"
---

Maestro 知识沉淀分两种：**约束**和**积累**。约束是编码规范、架构决策、质量规则——规定"不能做什么"。积累是操作步骤、设计资产、调试经验——记录"怎么做过"。前者需要强制加载，后者需要按需检索。

<details>
<summary>产物目录结构</summary>

```
.workflow/
├── specs/                          # 约束层：基于 category 的规则索引
│   ├── coding-conventions.md       # category: coding
│   ├── architecture-constraints.md # category: arch
│   ├── review-standards.md         # category: review
│   ├── debug-notes.md              # category: debug
│   ├── test-conventions.md         # category: test
│   └── learnings.md                # category: learning（经验教训）
├── knowhow/                        # 积累层：完整知识文档
│   ├── KNW-*.md                    # 会话压缩记录
│   ├── RCP-*.md                    # 操作配方（步骤指南，可标记 tool: true）
│   ├── TPL-*.md                    # 代码/配置模板
│   ├── REF-*.md                    # 外部文档摘要
│   ├── DCS-*.md                    # 架构决策记录
│   ├── TIP-*.md                    # 快速提示
│   ├── AST-*.md                    # 代码资产（API 契约、数据模型）
│   ├── BLP-*.md                    # 架构蓝图
│   └── DOC-*.md                    # 长文档（通用兜底）
├── domain/                         # 领域知识：项目术语表
│   └── glossary.yaml               # 领域术语（YAML 格式，主格式；另有 glossary.json 向后兼容）
├── wiki-index.json                 # 统一索引（WikiIndexer 自动生成）
└── codebase/
    └── knowledge-graph.json        # 代码知识图谱（kg CLI 查询）
```

</details>

---

## Spec 与 Knowhow 的关系

**Spec 是索引和规则，Knowhow 是详情和过程。** 二者通过 `ref` 属性桥接。

| 层 | 定位 | 内容特征 | 加载方式 |
|---|---|---|---|
| Spec (`specs/`) | 索引 + 规则 | 短条目，<200 字摘要 | 自动注入（hook） |
| Knowhow (`knowhow/`) | 详情文档 | 完整步骤、代码示例 | 按需加载（`wiki load`） |

<details>
<summary>条目格式示例</summary>

Spec 条目使用 `<spec-entry>` 闭合标签：

```markdown
<spec-entry category="coding" keywords="auth,token,rotation" date="2026-04-21">

### Token rotation needs email carried through refresh flow

Revoked column must be set rather than deleting tokens.

</spec-entry>
```

Knowhow 文档使用 YAML frontmatter：

```markdown
---
title: OAuth PKCE Authorization Flow
type: recipe
category: coding
keywords: [oauth, pkce, auth]
tool: true
summary: "Use when implementing OAuth 2.0 login for public clients."
---

## Steps
1. Generate code_verifier ...
```

- `category` = **谁负责**（决定文件路由和 agent 注入）
- `keywords` = **关于什么**（跨 category 发现）

</details>

---

## 知识生命周期

### 稳定标识（sid）

每个 `<spec-entry>` 在创建时自动分配一个稳定 ID（格式 `S-YYYYMMDD-xxxx`），用于跨文件引用和演化链追踪。存量条目可通过 `maestro spec backfill-sid` 回填。

### 演化链（Supersession）

当新知识替代旧知识时，使用 supersede 建立演化链：

```bash
# 1. 添加新条目（自动生成 sid）
maestro spec add coding "新规则" "内容" --keywords kw1,kw2 --json
# 输出中包含 sid，如 S-20260704-a1b2

# 2. 将旧条目标记为 deprecated
maestro spec supersede <old-sid> --by <new-sid>

# 3. 查看演化链
maestro spec history <sid>
# ○ deprecated  S-20260101-x1y2  "旧规则"
#     ↓
# ● CURRENT     S-20260704-a1b2  "新规则"
```

被替代的条目自动 `status="deprecated"`，从搜索和 agent 注入中排除，但仍可通过 `--include-deprecated` 查看。

### 冲突双轨

新知识与旧条目的关系分两种，语义不同、操作不同：

| 关系 | 场景 | 操作 | 旧条目状态 |
|------|------|------|-----------|
| **supersede** | 新规则替代旧规则（演化） | `maestro spec supersede` | `deprecated`（排除） |
| **conflict** | 两条规则均有道理（争议） | `maestro spec conflict mark` | `contested`（降权但保留） |

### 健康检查

```bash
maestro spec health
```

输出：生命周期统计（active/deprecated/contested）、演化链数量、悬空/循环 supersedes 检测、整体新鲜度均值。

---

## 相关命令

### 写入类

| 命令 | 职责 |
|------|------|
| `/spec-add` | 向 specs 文件追加 `<spec-entry>` 条目，支持 inline 和 ref 两种模式 |
| `/manage-knowhow-capture` | 捕获 6 种类型知识文档到 knowhow/（compact、template、recipe、reference、decision、tip） |
| `/maestro-tools-register` | 将可复用业务流程注册为 knowhow 工具文档（YAML 头 `tool: true` + `category`） |
| `/manage-learn` | 捕获原子洞察到 `learnings.md`（pattern、gotcha、technique、tip） |
| `/manage-harvest` | 从工作流产物中提取知识碎片，路由到 wiki/spec/issue 三个存储 |

### 读取类

| 命令 | 职责 |
|------|------|
| `/spec-load` | 按 category 加载主文档 + 跨文件 keyword 匹配条目 + 自动发现 knowhow 工具 |
| `/maestro-tools-execute` | 从 knowhow 加载工具文档并逐步执行 |
| `/manage-knowhow` | 跨 workflow knowhow 和 system memory 两个存储做 list/search/view/edit/delete |
| `/manage-wiki` | Wiki 图健康度、搜索、清理、统计 |

### 分析类

| 命令 | 职责 |
|------|------|
| `/wiki-digest` | 语义主题聚类 + 知识覆盖热力图 + gap 分析 |
| `/wiki-connect` | 发现孤立节点和缺失连接，修复图联通性 |
| `/manage-knowledge-audit` | 审计 spec/knowhow/artifact 三存储 — 矛盾检测、过期淘汰、孤立清理（keep/supersede/contest/deprecate/delete 五态决策） |
| `/learn-decompose` | 从代码中提取设计模式，写入 spec 和 wiki |
| `/learn-follow` | 引导式阅读代码/wiki，提取 pattern 并构建理解 |

### 初始化

| 命令 | 职责 |
|------|------|
| `/spec-setup` | 扫描项目结构，初始化 specs 骨架文件（6 个种子文件） |

---

## Tool — 可执行知识

Tool 是标记了 `tool: true` 的 knowhow 文档，定义**可执行的业务流程**——轻量化的 workflow，沉淀在项目目录下，具有自发现自使用特性。

```yaml
---
title: Payment Gateway Idempotency Verification
type: recipe
category: test
keywords: [payment, gateway, idempotency]
tool: true
summary: "Use when testing payment endpoints for retry safety."
---

## Steps
1. Generate idempotency key (UUID v4)
2. Submit charge request with key
3. Retry same request — assert identical response
4. Submit different amount with same key — assert 409
5. Verify webhook delivers exactly once
```

`spec load --category test` 自动扫描 knowhow/ 中 `category=test` 且 `tool=true` 的文档，将工具摘要与 spec 一起注入 agent 上下文。

### 注册与使用

| 阶段 | 命令 | 场景 |
|------|------|------|
| 规划期间 | `/maestro-tools-register generate` | 标准化业务流程 |
| 执行之后 | `/maestro-tools-register extract` | 捕获经过验证的操作步骤 |
| 测试之前 | `/maestro-tools-register generate` | 注册验证方法给 test agent |
| 复盘时 | `/maestro-tools-register optimize` | 从产物中提取可复用流程 |

使用方式：按名称执行 `/maestro-tools-execute integration-test`、按 category 发现 `/maestro-tools-execute --category test`、Agent 自动发现（`spec load` 输出包含工具摘要）。

---

## 自动注入机制

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `spec-injector` | PreToolUse:Agent | agent 类型 → category → 加载 spec + keyword 条目 + knowhow 工具 |
| `keyword-spec-injector` | UserPromptSubmit | prompt 关键词 → 匹配 spec-entry keywords → 注入（最多 5 条/次） |

| Agent 类型 | 映射 Category |
|---|---|
| code-developer, tdd-developer | coding, learning |
| workflow-planner | arch |
| workflow-reviewer | review |
| debug-explore-agent | debug |
| test-fix-agent | coding, test |

Session 级去重：同一条目不会重复注入。

---

## 代码知识图谱集成（KG × Wiki）

当 `maestro kg index` 生成 `knowledge-graph.json` 后，WikiIndexer 自动将 KG 数据索引为虚拟 wiki 条目：

| KG 数据 | Wiki 条目 | virtualKind | 用途 |
|---------|-----------|-------------|------|
| GraphNode | `kg-{id}` | `kg-node` | 代码实体（函数、类、模块） |
| Layer | `kg-layer-{id}` | `kg-layer` | 架构层（CLI、Core、Orchestration） |
| TourStep | `kg-tour-{order}` | `kg-tour-step` | 代码导览步骤（链表串联） |

**Edge 双层存储**：`related[]` 保存 top-N 关联 ID（用于 wiki 图分析），`ext.kgEdges[]` 保存完整有向异构边（用于语义遍历）。

**搜索降级**：KG 节点在 BM25 中仅索引 title + tags，避免代码标识符污染常规搜索。

**交叉引用**：KG 节点通过 `filePath` 自动匹配 `codebase-comp-*` 条目，建立 `ext.semanticDuplicateOf` 引用。

```bash
# 查看 KG 索引
maestro wiki list --keyword kg

# 搜索代码实体
maestro wiki search "AuthMiddleware"

# 代码变更影响分析
maestro kg diff-wiki

# KG 节点详情（含关联 wiki 条目）
maestro kg explain <node-id>
```

---

## Domain 领域知识系统

Domain 系统管理项目领域术语表（glossary），为 spec 注入和代码理解提供领域上下文。核心模块包括 `domain-loader.ts`（术语 CRUD + 文件锁）、`domain-scanner.ts`（代码扫描发现候选术语）、`domain-matcher.ts`（CJK 感知的术语匹配）。

### CLI 子命令

| 子命令 | 职责 |
|--------|------|
| `domain init` | 初始化 `.workflow/domain/` 和空 `glossary.yaml` |
| `domain add <canonical> <definition>` | 添加领域术语（支持 aliases、keywords、relationships、tier） |
| `domain list` | 列出所有术语，支持 `--status active\|deprecated` 过滤 |
| `domain show <id>` | 查看术语详情（含 concept_ref 文档内容） |
| `domain update <id>` | 更新术语（definition、aliases、relationships、keywords、tier） |
| `domain remove <id>` | 删除术语（检查引用依赖，返回 warnings） |
| `domain search <query>` | 搜索术语（canonical + aliases + definition + keywords） |
| `domain discover` | 扫描代码库发现候选术语（基于 interface/type/enum/class/route/doc） |
| `domain import` | 从外部源导入术语（`--from context-package \| @<file>`） |
| `domain deprecate <id>` | 软删除术语（标记 deprecated，可指定 successor） |
| `domain validate` | 校验 `glossary.yaml` schema 和关系完整性 |

### 术语结构

每个术语包含：`id`（kebab-case）、`canonical`（显示名）、`definition`、`aliases[]`、`keywords[]`、`relationships[]`、`tier`（core/extended/peripheral）、`status`（active/deprecated）、`source`（manual/discover/import）、可选 `concept_ref`（详细概念文档路径）。

### 与 Spec 注入的集成

`spec-injector` 和 `keyword-spec-injector` 在注入 spec 条目前，先通过 `domain-matcher` 匹配 prompt 中的领域术语，将匹配到的术语定义作为上下文前缀注入，帮助 agent 理解项目专有概念。

---

## 可信度评估系统

`credibility.ts` 实现基于**指数衰减**的知识可信度评分，`spec-analytics.ts` 记录注入日志用于改进分析。

### 衰减模型

```
factor = floor + (1 - floor) * e^(-λ * age_days)
λ = ln(2) / half_life
```

| 节点类型 | 半衰期（天） | 说明 |
|----------|-------------|------|
| domain | 180 | 领域术语变化缓慢 |
| spec | 60 | 约束规则中等更新频率 |
| knowhow | 30 | 操作知识衰减较快 |
| issue | 14 | 问题状态变化频繁 |
| project/roadmap/note | 90 | 通用中等衰减 |

- `floor = 0.3`：最低可信度保底
- `ceiling = 1.2`：搜索命中可提升至上限
- `warningThreshold = 0.5`：低于此值触发低可信度警告

### 存储与更新

`CredibilityStore` 使用 SQLite `credibility` 表，记录 `search_hits`、`consumption_count`、`last_hit_at`、`last_consumed_at`、`content_changed_at`。内容变更时通过 `content_hash` 比对重置衰减起点。支持 `incrementSearchHits`（批量）和 `incrementConsumption`（单条）追踪使用情况。

### Spec Analytics

`spec-analytics.ts` 记录三种日志类型到 `.workflow/spec-analytics.jsonl`：

| 类型 | 来源 | 记录内容 |
|------|------|---------|
| `injection` | spec-injector / keyword-spec-injector / spec-injection-plugin | agent 类型、匹配 category、注入条目数、budget 动作、命中关键词 |
| `cli` | CLI 端点 | 命令名、参数 |
| `hook` | workflow hook | hook 名称、持续时间、结果 |

统计聚合提供：按来源/agent 类型/分类的注入命中率、关键词 Top-N 排名、CLI 使用频次、hook 调用统计。日志文件自动轮转（默认 5MB）。

---

## 跨工作空间知识共享

`workspace.ts` 提供跨项目知识共享能力，通过链接其他 Maestro 工作空间实现 spec/knowhow/domain 的跨项目复用。

### CLI 子命令

| 子命令 | 职责 |
|--------|------|
| `workspace link <path>` | 链接目标工作空间，支持 `--name` 和 `--share spec,knowhow,domain,codebase` |
| `workspace unlink <name>` | 移除已链接的工作空间 |
| `workspace list` | 列出所有已链接工作空间（路径、共享类型、有效性） |
| `workspace status` | 显示详细状态（各共享类型的条目计数） |

### 共享类型

| 类型 | 共享内容 | 来源目录 |
|------|---------|---------|
| `spec` | 约束规则条目 | `specs/*.md` |
| `knowhow` | 知识文档 | `knowhow/**/*.md` |
| `domain` | 领域术语表 | `domain/glossary.yaml` |
| `codebase` | 代码文档索引 | `codebase/doc-index.json` |

链接信息持久化在 `.workflow/config.json` 的 `workspace.linked[]` 中。加载时自动解析路径并校验目标 `.workflow/` 目录是否存在。

---

## KG 自定义提取器插件机制

`plugin-engine.ts` 支持两种插件模式扩展知识图谱的代码提取能力，配置文件为 `.workflow/kg/extractors.yaml`。

### 两种插件模式

| 模式 | 配置方式 | 运行方式 | 适用场景 |
|------|---------|---------|---------|
| **declarative** | YAML 中定义 `rules[]` | 正则/call/assignment 模式匹配 | 简单的符号提取（常量、路由、装饰器） |
| **script** | `.workflow/kg/extractors/*.mjs` | 动态 import + `extract(ctx)` 调用 | 复杂逻辑（AST 遍历、跨文件分析） |

### Declarative 规则类型

- `regex`：正则匹配，支持 `$1`-`$9` 模板提取名称
- `call`：函数调用模式（如 `builder.define_constant($NAME, $_)`）
- `assignment`：赋值模式，支持 `module`/`class`/`any` 作用域过滤

### Script 插件 API

Script 插件导出 `extract(ctx)` 函数，`PluginContext` 提供：

- `ctx.filePath` / `ctx.sourceCode` / `ctx.language`：文件信息
- `ctx.findAll(nodeType)`：遍历 tree-sitter AST 查找指定类型节点
- `ctx.text(startLine, endLine)`：提取源码行
- `ctx.makeSymbol(input)`：构建标准化符号对象

### 合并策略

插件提取结果与核心 tree-sitter 结果合并，冲突策略由 `defaults.conflictPolicy` 控制：`merge-metadata`（默认，保留核心符号）、`plugin-wins`（插件覆盖）、`core-wins`（核心保留）。

---

## CooldownGuard 抽象

`cooldown-guard.ts` 提供跨进程的冷却时间守卫，通过 tmpdir 桥接文件实现子进程间的节流控制。

### 核心 API

```typescript
class CooldownGuard {
  shouldRun(sessionId): boolean   // 是否在冷却期内
  markDone(sessionId, extra?)     // 标记完成，写入时间戳
  timeSinceLastMs(sessionId)      // 距上次触发的毫秒数
}
```

### 预配置实例

| 实例 | 冷却时间 | 用途 |
|------|---------|------|
| `kgSyncGuard` | 30 秒 | KG 同步节流，避免频繁重建索引 |
| `kgInitGuard` | 5 分钟 | KG 初始化节流，避免重复全量扫描 |

桥接文件存储在系统 tmpdir（`maestro-kg-sync-{sessionId}.json` / `maestro-kg-init-{sessionId}.json`），包含 `last_trigger` 时间戳。`shouldRun()` 比对当前时间与上次触发时间，超过冷却窗口返回 `true`。

---

## Script Plugins 安全策略

Script 插件（`.mjs` 文件）默认**禁用**，需显式开启以防止不受信任的代码执行。

### 启用方式

```bash
# CLI 显式启用
maestro kg sync --allow-extractor-scripts

# 在 code-extractor 调用链中传递
codeExtractor.extract({ allowScripts: true })
```

### 安全行为

| 场景 | 行为 |
|------|------|
| 存在 `.mjs` 文件但未启用 | 输出 stderr 警告，跳过所有 script 插件 |
| 已启用 | 动态 `import()` 加载，`extract()` 失败时根据 `onError` 策略处理 |
| 插件无 `export function extract` | 静默跳过 |
| 声明式插件 | 始终加载，不受此安全策略限制 |

`warn`（默认）：插件失败时输出警告继续执行；`fail`：插件失败时抛出错误终止提取。

---

## 知识流转全景

```
执行产物                    提取                      存储                    消费
─────────                  ─────                    ─────                  ─────
分析会话 ─────┐                              ┌─→ specs/     ─→ spec-injector → agent
调试记录 ─────┼──→ /manage-harvest ──────────┼─→ knowhow/   ─→ wiki load → 按需
规划文档 ─────┤    /quality-retrospective    ├─→ issues/    ─→ manage-issue → 追踪
代码变更 ─────┘    /learn-decompose          └─→ learnings  ─→ keyword-injector → 上下文
```

Progressive Fill——各阶段自动沉淀：

```bash
maestro-init    → spec-setup（骨架 + 扫描）
maestro-analyze → 锁定决策 → arch，代码模式 → coding
maestro-plan    → 设计约定 → coding/arch，测试策略 → test
maestro-execute → 经验教训 → learning，根因 → debug
maestro-execute → 内置验证（E2.7）→ 质量发现 → review
```

<details>
<summary>实践场景：前后端 API 开发闭环</summary>

以用户管理模块（注册、登录、JWT 鉴权、用户 CRUD）为例：

**1. 规划 + 分析**

```bash
/workflow-lite-plan 用户管理模块 API：注册、登录、JWT 鉴权、用户 CRUD
/maestro-analyze API 端点设计模式分析
```

**2. 实现 + 知识回收**

```bash
/workflow-lite-execute
/manage-harvest --source lite-plan --to auto
```

harvest 自动路由：

| 提取内容 | 路由目标 | 示例 |
|---|---|---|
| API 命名规范 | spec → coding | "所有端点使用 `/api/v1/` 前缀" |
| 鉴权方案决策 | spec → arch | "密码 bcrypt(12)，token RS256 签名" |
| 响应格式知识 | wiki → knowhow | "统一返回 `{ data, error, meta }` 结构" |
| 缺失功能 | issue | "缺少 rate limiting 中间件" |

**3. 注册验证工具**

```bash
/maestro-tools-register generate User API E2E 验证：注册 → 登录 → token 刷新 → CRUD → 异常
```

**4. 测试消费**

```bash
/quality-auto-test --keyword user-api    # 自动测试：发现 tool → 生成测试代码
/quality-test user management API        # 会话式 UAT：按 tool 步骤逐项验证
```

**5. 反哺**

```bash
/maestro-tools-register optimize user-api-verify   # 追加新发现的 edge case
/manage-learn "refresh token 过期后重试需要处理 race condition"
```

各命令职责：

| 命令 | 产出 | 性质 |
|---|---|---|
| `/manage-harvest` | spec 条目 + wiki 条目 + issue | 被动知识 |
| `/manage-knowhow-capture` | AST-*.md（API 契约） | 被动资产 |
| `/maestro-tools-register` | RCP-*.md（验证流程） | 主动可执行 |
| `/quality-auto-test` | 测试代码 | 消费 tool |

</details>
