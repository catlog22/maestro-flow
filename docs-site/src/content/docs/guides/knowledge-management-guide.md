---
title: "知识沉淀管理系统"
icon: "📚"
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
    └── knowledge-graph.db          # CodeGraph 知识图谱（SQLite，kg CLI 查询）
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
| `/spec add` | 向 specs 文件追加 `<spec-entry>` 条目，支持 inline 和 ref 两种模式 |
| `/manage knowledge capture` | 捕获 6 种类型知识文档到 knowhow/（compact、template、recipe、reference、decision、tip） |
| `/spec add` | 将可复用业务流程注册为 knowhow 工具文档（YAML 头 `tool: true` + `category`） |
| `/manage knowledge capture` | 捕获原子洞察到 `learnings.md`（pattern、gotcha、technique、tip） |
| `/manage knowledge harvest` | 从工作流产物中提取知识碎片，路由到 wiki/spec/issue 三个存储 |

### 读取类

| 命令 | 职责 |
|------|------|
| `/spec load` | 按 category 加载主文档 + 跨文件 keyword 匹配条目 + 自动发现 knowhow 工具 |
| `/maestro-ralph` | 从 knowhow 加载工具文档并逐步执行 |
| `/manage knowledge knowhow` | 跨 workflow knowhow 和 system memory 两个存储做 list/search/view/edit/delete |
| `/manage knowledge wiki` | Wiki 图健康度、搜索、清理、统计 |

### 分析类

| 命令 | 职责 |
|------|------|
| `/manage knowledge wiki digest` | 语义主题聚类 + 知识覆盖热力图 + gap 分析 |
| `/manage knowledge wiki connect` | 发现孤立节点和缺失连接，修复图联通性 |
| `/manage knowledge audit` | 审计 spec/knowhow/artifact 三存储 — 矛盾检测、过期淘汰、孤立清理（keep/deprecate/delete 三态决策） |
| `/learn decompose` | 从代码中提取设计模式，写入 spec 和 wiki |
| `/learn follow` | 引导式阅读代码/wiki，提取 pattern 并构建理解 |

### 初始化

| 命令 | 职责 |
|------|------|
| `/spec setup` | 扫描项目结构，初始化 specs 骨架文件（6 个种子文件） |

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
| 规划期间 | `/spec add generate` | 标准化业务流程 |
| 执行之后 | `/spec add extract` | 捕获经过验证的操作步骤 |
| 测试之前 | `/spec add generate` | 注册验证方法给 test agent |
| 复盘时 | `/spec add optimize` | 从产物中提取可复用流程 |

使用方式：按名称执行 `/maestro-ralph integration-test`、按 category 发现 `/maestro-ralph --category test`、Agent 自动发现（`spec load` 输出包含工具摘要）。

---

## 统一搜索

`maestro search` 是唯一的用户级搜索入口，基于 BM25 全文检索跨 spec/knowhow/issue 所有知识类型。

```bash
maestro search "auth token"                       # 全文搜索
maestro search "auth" --type spec                  # 仅搜索 spec
maestro search "auth" --category coding            # 按分类过滤
```

**已废弃**（请勿使用）：`spec search`、`knowhow search`、`wiki search` — 已被统一搜索替代。

---

## 自动注入机制

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `spec-injector` | PreToolUse:Agent | agent 类型 → category → 加载 spec + keyword 条目 + knowhow 工具 |
| `keyword-spec-injector` | UserPromptSubmit | prompt 关键词 → 匹配 spec-entry keywords → 注入（最多 5 条/次）+ KG 符号查找 |
| `kg-sync` | UserPromptSubmit | 源文件变更 → CodeGraph 增量同步（30 秒冷却） |
| `kg-context-injector` | PreToolUse:Agent | prompt 中的符号名 → CodeGraph 查询 → 注入调用关系和文件位置 |

| Agent 类型 | 映射 Category |
|---|---|
| code-developer, workflow-executor, universal-executor | coding, learning, ui |
| tdd-developer, test-fix-agent | coding, test |
| impeccable-agent, ui-design-agent | coding, ui |
| cli-lite-planning-agent, action-planning-agent, workflow-planner | arch, coding |
| workflow-reviewer, workflow-verifier | review, coding |
| team-supervisor, workflow-roadmapper | arch |
| team-worker, general-purpose | coding, learning |
| debug-explore-agent, workflow-debugger | debug |

Session 级去重：同一条目不会重复注入。所有注入使用统一 `<maestro-context>` 格式封装。

---

## CodeGraph 知识图谱集成

Maestro 使用 `@colbymchenry/codegraph`（tree-sitter WASM）作为唯一代码分析引擎，提供函数级调用图和符号查询。CodeGraph 为可选依赖——未安装时所有 KG 功能静默降级。

```bash
# 安装（可选）
npm install -g @colbymchenry/codegraph

# 初始化索引
maestro kg index --sqlite
```

KG 通过 Hook 自动保持新鲜：`kg-sync`（UserPromptSubmit 增量同步）+ `kg-context-injector`（Agent 启动注入）。仅在首次使用时需手动 `maestro kg index --sqlite`。

### kg CLI 子命令

| 子命令 | 功能 | 示例 |
|--------|------|------|
| `kg stats` | 图谱统计信息（节点数、边数、模块分布） | `maestro kg stats` |
| `kg search <pattern>` | 搜索符号/函数 | `maestro kg search "UserService"` |
| `kg context <node>` | 节点上下文（调用者、被调用者、依赖） | `maestro kg context "validateToken"` |
| `kg query <pattern>` | 按名称/类型搜索节点 | `maestro kg query "UserService"` |
| `kg explain <node>` | 节点详情（依赖、调用者、所在模块） | `maestro kg explain "validateToken"` |
| `kg path <from> <to>` | 查找两节点间的调用路径 | `maestro kg path "loginController" "db.query"` |
| `kg diff` | 对比图谱快照差异 | `maestro kg diff` |

### Wiki 虚拟节点

WikiIndexer 除了索引文件系统中的 spec/knowhow 文档外，还将非文件数据源适配为只读虚拟 WikiEntry 节点：

| 虚拟类型 | 数据源 | 虚拟 kind 前缀 |
|---------|--------|---------------|
| 知识图谱节点 | `knowledge-graph.json` | `uakg-node`, `uakg-layer`, `uakg-tour` |
| Issue 条目 | `issues.jsonl` | `issue` |
| 会话产物 | `.workflow/scratch/` | `session-artifact` |

虚拟节点与普通 wiki 条目统一出现在搜索结果和 `wiki search` 中，但为只读——不能通过 `wiki edit` 修改。

---

## 知识流转全景

```
执行产物                    提取                      存储                    消费
─────────                  ─────                    ─────                  ─────
分析会话 ─────┐                              ┌─→ specs/     ─→ spec-injector → agent
调试记录 ─────┼──→ /manage knowledge harvest ──────────┼─→ knowhow/   ─→ wiki load → 按需
规划文档 ─────┤    /maestro-next --promote    ├─→ issues/    ─→ manage issue → 追踪
代码变更 ─────┘    /learn decompose          └─→ learnings  ─→ keyword-injector → 上下文

                    淘汰清理                    审计                    CodeGraph
                    ─────                      ─────                  ─────
specs/     ──┐                              ┌─→ kg search   ─→ 符号搜索
knowhow/   ──┼──→ /manage knowledge audit ──┼─→ kg context  ─→ 调用关系
artifacts/ ──┘    (三态: keep/deprecate/delete) └─→ kg path    ─→ 调用链追踪
                                                             ↑ Hook 自动同步
                                                             kg-sync (UserPromptSubmit)
```

Progressive Fill——各阶段自动沉淀：

```bash
maestro-init    → spec setup（骨架 + 扫描）
maestro-ralph → 锁定决策 → arch，代码模式 → coding
maestro-next    → 设计约定 → coding/arch，测试策略 → test
maestro-ralph continue → 经验教训 → learning，根因 → debug
maestro-ralph  → 质量发现 → review
```

<details>
<summary>实践场景：前后端 API 开发闭环</summary>

以用户管理模块（注册、登录、JWT 鉴权、用户 CRUD）为例：

**1. 规划 + 分析**

```bash
/workflow-lite-plan 用户管理模块 API：注册、登录、JWT 鉴权、用户 CRUD
/maestro-ralph --engine swarm --script wf-analyze "API 端点设计模式分析"
```

**2. 实现 + 知识回收**

```bash
/workflow-lite-execute
/manage knowledge harvest --source lite-plan --to auto
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
/spec add generate User API E2E 验证：注册 → 登录 → token 刷新 → CRUD → 异常
```

**4. 测试消费**

```bash
/maestro-ralph --engine swarm --keyword user-api    # 自动测试：发现 tool → 生成测试代码
/maestro "test user management API"        # 会话式 UAT：按 tool 步骤逐项验证
```

**5. 反哺**

```bash
/spec add optimize user-api-verify   # 追加新发现的 edge case
/manage knowledge capture "refresh token 过期后重试需要处理 race condition"
```

各命令职责：

| 命令 | 产出 | 性质 |
|---|---|---|
| `/manage knowledge harvest` | spec 条目 + wiki 条目 + issue | 被动知识 |
| `/manage knowledge capture` | AST-*.md（API 契约） | 被动资产 |
| `/spec add` | RCP-*.md（验证流程） | 主动可执行 |
| `/maestro-ralph --engine swarm` | 测试代码 | 消费 tool |

</details>

---

## Spec 配置参考

### 作用域

| 作用域 | 目录 | 自动初始化 |
|-------|------|-----------|
| `project`（默认） | `.workflow/specs/` | 是 |
| `global` | `~/.maestro/specs/` | 是 |
| `team` | `.workflow/collab/specs/` | 否 |
| `personal` | `.workflow/collab/specs/{uid}/` | 否 |

**加载优先级**（由低到高）：global → project → team → personal。后层追加，不覆盖。

### 文件与 Category 映射

| 文件 | Category | 隐式角色 | 用途 |
|------|----------|---------|------|
| `coding-conventions.md` | coding | implement | 命名、导入、格式、模式 |
| `architecture-constraints.md` | arch | plan | 模块结构、层边界 |
| `review-standards.md` | review | review | 质量规则、检查清单 |
| `debug-notes.md` | debug | analyze | 调试技巧、根因记录 |
| `test-conventions.md` | test | test | 测试框架、覆盖率要求 |
| `learnings.md` | learning | implement | Bug、陷阱、经验教训 |
| `ui-conventions.md` | ui | implement | UI/UX 约定、设计令牌 |

### 条目属性

| 属性 | 必需 | 说明 |
|------|------|------|
| `category` | 是 | 单值：coding, arch, review, debug, test, learning, ui |
| `keywords` | 是 | 逗号分隔，小写，跨 category 发现 |
| `date` | 是 | `YYYY-MM-DD` |
| `source` | 否 | 来源（manual / agent / phase） |
| `ref` | 否 | 指向 knowhow 详情文档的路径 |

### Tool 发现

Tool 是标记了 `tool: true` YAML 头的 knowhow 文档。`spec load --category` 自动扫描 `knowhow/` 中匹配 category + tool 的条目，追加摘要。

### Spec 注入配置

```
Session Start / Agent Spawn
        │
        ▼
loadSpecInjectionConfig()   ← .workflow/config.json
        │
        ▼
按 Agent 类型加载对应 Category
        │
        ▼
keyword 过滤 + 额外文档关联
        │
        ▼
注入到 additionalContext
```

#### 配置 Schema

配置存储在 `.workflow/config.json` 的 `specInjection` 键中：

```json
{
  "specInjection": {
    "enabled": true,
    "globalKeywords": ["auth", "security"],
    "excludeKeywords": ["deprecated"],
    "agentCategoryMap": {
      "code-developer": ["coding", "learning", "ui"],
      "workflow-planner": ["arch"]
    },
    "extraDocs": {
      "coding": ["specs/coding-extra.md"],
      "arch": ["specs/arch-patterns.md"]
    },
    "alwaysInject": ["specs/critical-rules.md"]
  }
}
```

#### CLI 配置

```bash
maestro config get specInjection                          # 查看当前配置
maestro config set specInjection.globalKeywords "auth,security"  # 设置全局关键词
maestro config set specInjection.excludeKeywords "deprecated"    # 排除关键词
```

### Spec 分析

Spec 分析系统记录每次 spec 注入调用、关键词匹配、hook 执行和 CLI 端点使用，提供命中率统计和关键词热力分布。

```bash
maestro spec analytics              # 查看分析统计
maestro spec analytics --keywords   # 关键词热力分布
maestro spec analytics --hit-rate   # 命中率
maestro spec analytics --clear      # 清除分析数据
```

### Spec CLI 参考

```bash
maestro spec init [--scope <scope>] [--uid <uid>]
maestro spec load [--category <cat>] [--keyword <kw>] [--scope <scope>] [--json]
maestro spec add <category> "<title>" "<content>" [--keywords kw1,kw2] [--ref <path>]
maestro spec list [--scope <scope>] [--uid <uid>]
maestro spec status [--scope <scope>] [--uid <uid>]
```
