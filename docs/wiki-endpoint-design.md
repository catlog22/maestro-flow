# Wiki 端点设计与使用指南

`/api/wiki` 是 Maestro Dashboard 的知识图谱端点，把 `.workflow/` 目录下的 markdown 文件和 JSONL 行当作统一的文档网络。本文档说明其设计思想、端点命令，以及与 `/api/specs` 的关系。

## 设计思想

### 一、统一视角：一切皆节点

`.workflow/` 下散落着多种信息载体：`project.md`、`roadmap.md`、`specs/*.md`、`memory/MEM-*.md`、`memory/TIP-*.md`、`issues/*.jsonl`、`learning/*.jsonl`。Wiki 端点把它们抽象成同一种节点（`WikiEntry`），通过 `id = <type>-<slug>` 统一寻址。

| 类型 | 来源 | 写入权限 |
|------|------|---------|
| `project` | `project.md` | 只读 |
| `roadmap` | `roadmap.md` | 只读 |
| `spec` | `specs/<slug>.md` | 可写 |
| `memory` | `memory/MEM-<slug>.md` | 可写 |
| `note` | `memory/TIP-<slug>.md` | 可写 |
| `issue` | `issues/*.jsonl` 行 | 只读（虚拟） |
| `lesson` | `learning/*.jsonl` 行 | 只读（虚拟） |

> **JSONL 神圣不可写**：虚拟条目永远只读，写入必须走 markdown 文件。这是端点的第一条红线。

### 二、灵感来源：Turbovault

设计时参考了 [Epistates/turbovault](https://github.com/Epistates/turbovault)（为 Obsidian vault 提供图谱分析的工具），吸收了四项能力：

1. **BM25-lite 搜索** — 零依赖的倒排索引 + BM25 排序（k1=1.5, b=0.75）
2. **图谱分析** — 从 `[[wikilinks]]` 和 frontmatter `related:` 字段构建前向/反向链接图
3. **健康审计** — 量化文档网络的健康度（破损链接、孤立节点、缺失标题）
4. **Markdown 渲染** — 客户端 `react-markdown` + `remark-gfm` + 自定义 `wiki:` 协议拦截 `[[link]]`

### 三、作用域边界

- **仅扫描 `.workflow/**`**：不引入 vault 目录、不接管全局笔记
- **零新依赖**：BM25 手写 80 行，graph 纯函数，markdown 复用已有组件
- **Windows 友好**：全路径走正斜杠，chokidar 已配好 polling 回退
- **单一真理源**：`WikiIndexer` 持有 `{ index, graphCache, searchCache }`，`invalidate()` 三缓存一起清空

### 四、缓存模型

```
┌─────────────┐  invalidate()   ┌─────────────┐
│ fs-watcher  │ ───────────────▶│ WikiIndexer │
└─────────────┘                 └──────┬──────┘
                                       │ rebuild()（单飞锁）
                                       ▼
                          ┌────────────┴────────────┐
                          ▼            ▼            ▼
                      index       graphCache   searchCache
```

- **单飞锁（single-flight）**：并发 `rebuild()` 合并成一次扫描
- **按需构建**：graph 和 BM25 索引在首次访问时才构建，由 `invalidate()` 统一清空
- **被动失效**：fs-watcher 检测到任何匹配文件变化即触发 `wiki:invalidated`，下次读取时重建

### 五、写入安全模型

- **路径校验三重闸门**：`isInsideRoot()`（防越界）、`isWritablePath()`（仅 specs/memory）、`safeLstat()`（拒绝 symlink）
- **乐观并发**：`expectedHash`（sha256）不匹配返回 409，携带当前 hash 和 body 让客户端合并
- **Per-path mutex**：`withLock(absPath, fn)` 串行化同一文件的 read-modify-write，防 TOCTOU 竞态
- **slug 白名单**：`/^[a-z0-9][a-z0-9-]*$/`，拒绝大写、空格、点号、斜杠
- **id 白名单**：`/^[\w.-]+$/`，拒绝任何路径注入字符

## CLI 端点命令

所有端点挂载在 `/api/wiki` 下，服务器运行于 `http://127.0.0.1:3001`。

### 读操作

| 方法 | 路径 | 用途 | 参数 |
|------|------|------|------|
| GET | `/api/wiki` | 列表/过滤 | `type`, `tag`, `status`, `category`, `createdBy`, `q`（BM25 搜索）, `group=true`（按类型分组） |
| GET | `/api/wiki/stats` | 统计 | — |
| GET | `/api/wiki/health` | 健康评分 | — |
| GET | `/api/wiki/graph` | 完整图谱 | — |
| GET | `/api/wiki/orphans` | 孤立节点 | — |
| GET | `/api/wiki/hubs` | 中心节点 Top-N | `limit` |
| GET | `/api/wiki/:id` | 单个节点 | — |
| GET | `/api/wiki/:id/backlinks` | 反向链接 | — |
| GET | `/api/wiki/:id/forward` | 前向链接 | — |

**示例**

```bash
# 列出所有 specs
curl 'http://127.0.0.1:3001/api/wiki?type=spec'

# BM25 搜索
curl 'http://127.0.0.1:3001/api/wiki?q=authentication'

# 按分类过滤 + 分组
curl 'http://127.0.0.1:3001/api/wiki?category=security&group=true'

# 健康审计
curl 'http://127.0.0.1:3001/api/wiki/health'

# 取单个节点的反向链接
curl 'http://127.0.0.1:3001/api/wiki/spec-auth/backlinks'

# Top-5 中心节点
curl 'http://127.0.0.1:3001/api/wiki/hubs?limit=5'
```

**健康评分公式**

```
score = max(0, 100 − 2×brokenLinks − 1×orphans − 3×missingTitles)
```

返回体包含 `score`、`totals`、`orphans`、`hubs`、`brokenLinks`。

### 写操作

| 方法 | 路径 | 用途 | 说明 |
|------|------|------|------|
| POST | `/api/wiki` | 创建 markdown 节点 | 仅限 `spec` / `memory` / `note` |
| PUT | `/api/wiki/:id` | 更新节点 | 支持 `expectedHash` 乐观并发 |
| DELETE | `/api/wiki/:id` | 删除节点 | 虚拟节点返回 403 |

**POST 请求体**

```json
{
  "type": "spec",
  "slug": "auth-refresh",
  "title": "Auth Refresh Tokens",
  "body": "# Refresh Tokens\n...",
  "frontmatter": { "tags": ["auth", "security"] }
}
```

- `type=memory` 写入 `memory/MEM-<slug>.md`，`type=note` 写入 `memory/TIP-<slug>.md`
- 可选字段：`category`、`createdBy`、`sourceRef`、`parent`（持久化到 frontmatter）
- `slug` 必须匹配 `/^[a-z0-9][a-z0-9-]*$/`

**PUT 请求体**

```json
{
  "title": "New Title",
  "body": "updated body",
  "frontmatter": { "status": "active" },
  "expectedHash": "a3f2c1...（sha256）"
}
```

- 字段均可选；未提供的字段保留当前值
- `expectedHash` 不匹配时返回 `409 Conflict`，响应体包含 `{ currentHash, currentBody }`
- 未提供 `expectedHash` 时采用 last-write-wins

**写入示例**

```bash
# 创建 spec
curl -X POST 'http://127.0.0.1:3001/api/wiki' \
  -H 'Content-Type: application/json' \
  -d '{"type":"spec","slug":"rate-limit","title":"Rate Limiting","body":"# Rate Limit\n..."}'

# 更新（带 hash 校验）
curl -X PUT 'http://127.0.0.1:3001/api/wiki/spec-rate-limit' \
  -H 'Content-Type: application/json' \
  -d '{"body":"# Updated","expectedHash":"abc123..."}'

# 删除
curl -X DELETE 'http://127.0.0.1:3001/api/wiki/spec-rate-limit'
```

### 错误码

| 状态码 | 场景 |
|--------|------|
| 400 | slug 格式非法、id 格式非法、缺失必填字段 |
| 403 | 尝试写入虚拟条目（issue/lesson）或只读文件（project.md/roadmap.md）、symlink 拦截 |
| 404 | 节点不存在、文件已被外部删除 |
| 409 | `expectedHash` 不匹配、POST 创建时目标文件已存在 |

## Maestro CLI 子命令

`src/commands/wiki.ts` 把 HTTP 端点包装成 `maestro wiki <subcmd>`，需要 dashboard 服务已运行（`maestro view`）。基址默认 `http://127.0.0.1:3001`，可用 `--base <url>` 或 `MAESTRO_DASHBOARD_URL` 覆盖。

### 读子命令

| 子命令 | 说明 | 常用选项 |
|--------|------|---------|
| `wiki list` / `ls` | 列表 + 过滤 | `--type --tag --status --category --created-by -q --group --json` |
| `wiki get <id>` | 单个节点 | `--json` |
| `wiki search <query...>` | BM25 搜索 | `--json` |
| `wiki health` | 健康评分 + Top hubs | `--json` |
| `wiki graph` | 完整图谱（JSON） | — |
| `wiki orphans` | 孤立节点列表 | `--json` |
| `wiki hubs` | Top-N 中心节点 | `--limit <n> --json` |
| `wiki backlinks <id>` | 反向链接 | — |
| `wiki forward <id>` | 前向链接 | — |

### 写子命令

| 子命令 | 说明 | 必填选项 |
|--------|------|---------|
| `wiki create` | 创建 markdown 节点 | `--type --slug --title` （`--body` 或 `--body-file`；可选 `--category --created-by --source-ref --parent`） |
| `wiki update <id>` | 更新节点 | 任一可选：`--title --body --body-file --frontmatter --expected-hash` |
| `wiki delete <id>` / `rm` | 删除节点 | — |

### 示例

```bash
# 列出所有 specs
maestro wiki ls --type spec

# BM25 搜索
maestro wiki search authentication refresh token

# 按分类过滤 + JSON 输出
maestro wiki ls --category security --group --json

# 健康审计
maestro wiki health

# 创建 spec（body 从文件读）
maestro wiki create --type spec --slug rate-limit \
  --title "Rate Limiting" --body-file ./rate-limit.md

# 创建 memory 节点（带溯源字段）
maestro wiki create --type memory --slug auth-session \
  --title "Auth Session Notes" --body "# Auth" \
  --created-by memory-capture --source-ref WFS-auth-001

# 更新（乐观并发）
maestro wiki update spec-rate-limit \
  --body-file ./new-body.md --expected-hash abc123...

# 删除
maestro wiki rm spec-rate-limit
```

### 错误处理

所有子命令在 HTTP 非 2xx 时打印 `HTTP <code>: <error>` 并以退出码 1 终止。连接失败时提示 `maestro view` 启动 dashboard。

## 与 `/api/specs` 的关系

两个端点读取**相同的** `specs/*.md` 文件，但语义粒度不同，互不冲突。

| 维度 | `/api/specs` | `/api/wiki` |
|------|-------------|-------------|
| **粒度** | 文件内**子条目** — 每个 `### [type] [YYYY-MM-DD] Title` 小节一条 | 文件级**节点** — 一个 `.md` 文件一条 |
| **作用域** | 仅 `specs/*.md` | `project.md` + `roadmap.md` + `specs/` + `memory/` + JSONL |
| **ID 格式** | `<file-stem>-<nnn>`（如 `learnings-003`） | `<type>-<slug>`（如 `spec-auth`） |
| **写入模型** | POST 追加 heading block | POST 创建新文件；PUT 整体重写（hash 守卫）；DELETE unlink |
| **并发控制** | 全局 `withWriteLock` | per-path async mutex |
| **共享基建** | 复用 `server/wiki/frontmatter-util.ts`（re-export） | 主宿主 |
| **失效机制** | fs-watcher 感知 mtime 变化 → `wiki:invalidated` → wiki 下次读取时重建 | 同一 watcher；wiki 写操作直接调用 `indexer.invalidate()` |

**为什么能共存**

1. **锁域不同**：specs 的全局写锁和 wiki 的 per-path 锁作用于不同的内存对象，互不阻塞
2. **粒度正交**：specs 只关心 heading block 的追加，wiki 只关心整文件 CRUD；前者 append 不会破坏后者的图谱扫描
3. **单向失效链**：任意 specs 写入触发 fs-watcher，fs-watcher 把 `wiki:invalidated` 喂给 wiki 索引，wiki 保持最新
4. **约定分工**：specs 用于追加学习日志（append-only），wiki 用于结构化知识文档（CRUD）

> **理论上的交叉竞态**：同一文件上的 specs-POST 和 wiki-PUT 交错是一个极小概率的边界情况。实践中用户会为每个文件选择一种写入端点（specs 记流水账，wiki 改结构），不会同时触发。

## 学习工具集（基于 Wiki + Spec 的上层命令）

Wiki 和 Spec 端点之上，构建了学习与知识管理命令（`/learn` 子命令与 `/manage knowledge wiki` 子命令），将知识图谱从存储层升级为主动学习引擎：

| 命令 | 用途 | 消费的 Wiki/Spec 能力 |
|------|------|----------------------|
| `/learn consult` | Git 活动复盘 / 决策追溯评估 | `lessons.jsonl` 写入、`wiki search/list`、`specs/architecture-constraints.md` |
| `/learn follow` | 跟读学习 | `wiki get/backlinks/forward`、`specs/coding-conventions.md` |
| `/learn decompose` | 代码模式拆解 | `spec add` 写入、`wiki create` 创建笔记 |
| `/learn consult` | 多视角分析 | `wiki search`、`spec load` |
| `/learn investigate` | 系统化探究 | `wiki search`、`specs/debug-notes.md` |
| `/manage knowledge wiki connect` | 图谱连接发现 | `wiki list/graph/health/orphans/hubs`、`wiki update` |
| `/manage knowledge wiki digest` | 知识摘要生成 | `wiki list/search/get/backlinks/forward/health` |

详见 `guide/command-usage-guide.md` 学习工具集章节。

## 参考

- **README**：`dashboard/README.md` → "Wiki Endpoint" 章节
- **源码**：`dashboard/src/server/wiki/`
- **路由**：`dashboard/src/server/routes/wiki.ts`
- **集成测试**：`dashboard/src/server/routes/wiki.integration.test.ts`（28 个用例）
- **压力测试**：`dashboard/src/server/wiki/stress.test.ts`（16 个用例）、`writer-stress.test.ts`（21 个用例）
