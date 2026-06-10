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
| `/manage-knowledge-audit` | 审计 spec/knowhow/artifact 三存储 — 矛盾检测、过期淘汰、孤立清理（keep/deprecate/delete 三态决策） |
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
