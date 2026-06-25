---
title: "搜索系统指南"
---

Maestro 搜索系统基于 BM25F 算法，提供统一的知识搜索能力，支持 spec、knowhow、issue、domain 等多种数据源。

---

## 概述

`maestro search` 是知识系统的统一搜索入口，整合了：
- **WikiIndexer** — BM25F 加权全文检索
- **MaestroGraph** — AST 级代码符号搜索（可选）
- **类型过滤** — 按 spec/knowhow/issue/domain 等类型筛选

---

## 基本用法

```bash
# 关键词搜索（1-3 个核心词最佳）
maestro search "authentication"

# 带类型过滤
maestro search "jwt token" --type spec

# 按 category 过滤
maestro search --category coding

# 组合查询
maestro search "oauth pkce" --type spec --category arch --limit 10

# 代码搜索（需启用 MaestroGraph）
maestro search "UserService" --code

# KG 统一搜索（MaestroGraph full-source，替代废弃的 maestro kg search）
maestro search "UserService" --kg

# 搜索所有来源（wiki + code），统一归一化排名
maestro search "UserService" --all

# 跳过 embedding，仅用 BM25（避免 ONNX 冷启动）
maestro search "jwt token" --no-emb

# JSON 输出（适合脚本消费）
maestro search "jwt token" --json
```

### 查询最佳实践

**1-3 个核心词**是最优查询长度。超过 4 个词时，BM25 评分会被不相关词稀释：

```bash
# ❌ 堆砌多个不相关关键词
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ 拆分为针对性查询
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro search "elk layout" --type knowhow
```

**CamelCase 标识符**自动拆分：搜索 `DetailedTopologySVG` 会同时匹配 `detailed`、`topology`、`svg` 和完整标识符。

**IDF 自适应加权**：超过 3 个词时，系统自动为高特异性词（如符号名）加权、为通用词降权。

---

## BM25F 算法

### 字段权重

搜索系统使用 BM25F（Best Match 25 with Field weighting）算法，对不同字段赋予不同权重。系统针对三类文档维护独立配置：

**Default（spec/knowhow/issue 等标准文档）**

| 字段 | boost | b | 说明 |
|------|-------|---|------|
| `title` | 3 | 0.3 | 标题匹配权重最高 |
| `tags` | 2 | 0 | 标签匹配，无长度归一化 |
| `summary` | 1.5 | 0.75 | 摘要匹配 |
| `body` | 1 | 0.75 | 正文匹配（基准） |

**KG（知识图谱虚拟节点）**

| 字段 | boost | b | 说明 |
|------|-------|---|------|
| `title` | 2 | 0.3 | 仅标题参与评分 |
| `tags` | 1 | 0 | 标签匹配 |
| `summary` | 0 | 0 | 不参与评分 |
| `body` | 0 | 0 | 不参与评分 |

**Scratch（scratch 文档）**

| 字段 | boost | b | 说明 |
|------|-------|---|------|
| `title` | 1 | 0.3 | 标题匹配（权重较低） |
| `summary` | 0.5 | 0.75 | 摘要匹配 |
| `tags` | 0.5 | 0 | 标签匹配，无长度归一化 |
| `body` | 0.3 | 0.75 | 正文匹配 |

### 评分公式

```
score = Σ_idf(tf~ × (k1 + 1)) / (tf~ + k1)
```

其中 `tf~` 为跨字段加权词频：

```
tf~ = Σ(boost_f × tf_f / (1 - b + b × dl_f / avgdl_f))
```

- `tf_f` — 字段 f 内的词频
- `dl_f` — 字段 f 的文档长度
- `avgdl_f` — 字段 f 的平均文档长度
- `k1 = 1.5` — 饱和参数
- `boost` / `b` — 按上表各配置独立设定

### 除零保护

当某字段的 `avgFieldLength = 0` 时，该字段自动跳过计算，避免除零错误。

---

## 中文支持

### CJK 分词

中文字符自动按 bigram + trigram 分词（`cjkNgrams`，n=2..3），单字不单独输出：
- 输入 `"认证"` → tokens: `["认证"]`
- 输入 `"用户认证"` → tokens: `["用户", "户认", "认证", "用户认", "户认证"]`
- 输入 `"JWT认证"` → tokens: `["jwt", "认证"]`

### 双语索引

doc-site 搜索支持双语元数据：
- `name` / `name_zh` — 英文/中文命令名
- `description` / `description_zh` — 英文/中文描述
- `workflow_zh` — 中文工作流说明

---

## 去重机制

### 源级去重

同一 `source.path` 下的多个条目（如 `spec-entry` 和 `knowhow-entry`）**不会被去重合并**，而是独立展示。

### 查询词去重

重复的查询词自动合并，防止分数膨胀：
```bash
# "token token jwt" 等价于 "token jwt"
maestro search "token token jwt"
```

---

## 索引来源

WikiIndexer 会自动索引以下数据源：

| 来源 | 路径 | 说明 |
|------|------|------|
| Spec | `.workflow/spec/` | 规范文档 |
| Knowhow | `.workflow/knowhow/` | 知识条目 |
| Scratch | `.workflow/scratch/` | 临时文档，使用独立 BM25F 配置（权重较低） |
| Session Archive | `.workflow/session/` | 归档会话记录 |
| Claude Code 会话 | `~/.claude/` | Claude Code 会话历史（自动扫描） |
| Codex 会话 | `~/.codex/sessions/` | Codex 会话历史（自动扫描） |

索引构建时，WikiIndexer 根据条目类型自动选择对应的 BM25F 配置（default/kg/scratch）。

### Wiki Session 解析

WikiIndexer 会自动解析并索引 Claude Code 和 Codex 的会话历史：

- **Claude Code**：扫描 `~/.claude/` 目录下的会话文件
- **Codex**：扫描 `~/.codex/sessions/` 目录下的会话文件
- **Session Archive**：扫描 `.workflow/scratch/` 下的 `archive.json`（生命周期状态为 `sealed` 或 `archived` 的会话）
- **自动检测**：daemon 启动时监控 CLI 会话目录，自动发现新会话

会话历史作为可搜索的知识来源，支持按 `--type session` 过滤。

---

## 可信度与搜索热度

搜索命中会异步更新节点的 `search_hits` 计数（通过 `CredibilityStore`），用于后续可信度评分。该操作为 best-effort，不阻塞搜索返回。

---

## Search Cache Invalidator Hook

`search-cache-invalidator` 是一个 PostToolUse hook，在文件修改后自动重建 WikiIndexer 缓存：

- **触发条件**：Write 或 Edit 工具调用后
- **作用范围**：仅在工作区启用（`requiresWorkspace: true`）
- **行为**：自动重建 WikiIndexer 索引，确保搜索结果反映最新文件内容

该 hook 在标准 hook 集合中默认启用，无需手动配置。当通过 Write|Edit 修改 `.workflow/` 下的 spec/knowhow 等文件时，搜索索引会自动更新。

---

## 性能特性

| 优化项 | 改进 | 说明 |
|--------|------|------|
| 冷启动优化 | ~3200ms → ~280ms | daemon 热路径 + BM25-only 降级 + 后台 daemon 启动 |
| Backlinks 构建 | O(n²) → O(1) | 使用 Set 替代 Array.includes |
| 倒排索引 | 预构建 | 首次加载时构建，后续复用 |
| 候选集裁剪 | 3x limit | 搜索候选集为 limit 的 3 倍，过滤后返回 |
| 工作区过滤 | limit 前应用 | 在截断结果前过滤，避免丢失有效条目 |
| Embedding 跳过 | 非 embedding 查询自动跳过 | daemon 不可用时降级为 BM25-only，避免 ONNX 冷启动惩罚 |

---

## Search Daemon（常驻进程）

Search daemon 是一个常驻后台进程，保持 WikiIndexer 和 ONNX embedding 模型热缓存，避免每次搜索的冷启动开销。

### 基本操作

```bash
# 启动 daemon
maestro search-daemon start

# 停止 daemon
maestro search-daemon stop

# 查看 daemon 状态
maestro search-daemon status
```

### 工作原理

- **协议**：TCP localhost，行分隔 JSON
- **锁文件**：`.workflow/search-daemon.json`（记录 PID + 端口）
- **空闲超时**：30 分钟无请求后自动关闭
- **ONNX 热缓存**：daemon 启动时预加载 embedding 模型，后续搜索无需重新加载

### 自动降级策略

当 daemon 不可用时，搜索命令会自动降级：

1. 使用 BM25-only 模式（跳过 embedding）避免 ONNX 冷启动（~1800ms）
2. 后台自动启动 daemon，使后续搜索获得 embedding 加速

```bash
# daemon 可用时：热路径，包含 embedding
maestro search "query"          # ~280ms

# daemon 不可用时：降级为 BM25-only
maestro search "query"          # ~280ms（BM25-only）
maestro search "query" --no-emb # 显式跳过 embedding
```

---

## Embedding 管理

Maestro 支持基于 Embedding 的语义搜索，通过向量相似度补充 BM25 全文检索。详细配置请参考 [Embedding 模型配置指南](embedding-guide.md)。

> **注意**：`embedding` 是独立的顶级命令，不是 `search` 的子命令。`maestro search embedding status` 会被 `search <query...>` 的 variadic 参数贪婪捕获为搜索关键词 `"embedding status"`。

```bash
# 查看 embedding 模型状态
maestro embedding status

# 预热 embedding 模型
maestro embedding warmup

# 重建 embedding 索引
maestro embedding rebuild
```

**快速配置**：

```bash
# 安装依赖
npm install @huggingface/transformers onnxruntime-node

# 检查状态
maestro embedding status

# 预热模型（首次加载较慢）
maestro embedding warmup
```

**自动降级**：当 embedding 不可用时，搜索自动降级为 BM25-only 模式，无需手动干预。

---

## 搜索结果结构

```typescript
interface SearchResult {
  id: string;           // 唯一标识
  type: WikiNodeType;   // spec/knowhow/issue/domain/...
  title: string;        // 标题
  category: string;     // coding/arch/review/...
  summary: string;      // 摘要
  score: number;        // BM25F 评分
  snippet: string;      // 上下文片段（高亮关键词）
  source: { path: string };  // 来源文件路径
}
```

---

## 过滤语法

### 按类型过滤

```bash
maestro search "query" --type spec       # 仅搜索 spec
maestro search "query" --type knowhow    # 仅搜索 knowhow
maestro search "query" --type issue      # 仅搜索 issue
maestro search "query" --type domain     # 仅搜索 domain
```

有效类型：`project`, `roadmap`, `spec`, `issue`, `knowhow`, `note`, `domain`

### 按 category 过滤

```bash
maestro search "query" --category coding   # 编码规范
maestro search "query" --category arch     # 架构约束
maestro search "query" --category review   # 审查标准
maestro search "query" --category debug    # 调试笔记
maestro search "query" --category test     # 测试规范
maestro search "query" --category learning # 经验教训
```

### 按工作区过滤

```bash
maestro search "query" --workspace shared  # 搜索共享工作区
```

---

## 代码搜索

启用 `--code` 标志后，搜索会同时查询 MaestroGraph AST 索引：

```bash
maestro search "UserService" --code
```

代码搜索结果独立展示，包含：
- 符号名称和类型（function/class/interface/...）
- 文件路径和行号
- 函数签名（如有）

---

## 常见问题

### 搜索结果为空

1. 确认 `.workflow/wiki-index.json` 存在
2. 运行 `maestro wiki health` 检查索引状态
3. 尝试更宽泛的关键词

### 中文搜索不准确

CJK 分词为 bigram + trigram 级别，短查询（2 字以下）可能匹配不足。建议：
- 使用 3 字以上关键词以触发 trigram 匹配
- 结合 `--category` 过滤缩小范围

### 评分异常

如果某条目评分异常高，可能是：
- 标题字段命中（default 配置下 3x 权重）
- 标签字段命中（2x 权重，无长度归一化）
- 关键词大量重复（已优化，但仍可能影响）

---

## 相关命令

```bash
# 统一搜索（推荐）
maestro search <query> [--type <type>] [--category <cat>] [--code] [--kg] [--all] [--no-emb] [--json]

# Wiki 系统搜索
maestro wiki search <query> [--json]
maestro wiki list [--type <type>] [--category <cat>] [--keyword <kw>]

# 知识图谱搜索（已废弃，使用 maestro search --kg 替代）
maestro kg search <symbol>   # [deprecated] Use "maestro search --kg" instead
maestro kg context <node>

# Search Daemon
maestro search-daemon start   # 启动常驻进程
maestro search-daemon stop    # 停止常驻进程
maestro search-daemon status  # 查看状态

# Embedding 管理
maestro embedding status   # 查看 embedding 模型状态
maestro embedding warmup   # 预热 embedding 模型
maestro embedding rebuild  # 重建 embedding 索引

# 索引健康检查
maestro wiki health
```
