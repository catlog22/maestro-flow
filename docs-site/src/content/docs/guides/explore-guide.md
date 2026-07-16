---
title: "Explore 轻量搜索指南"
icon: "🔍"
---

通过 API 端点驱动的轻量代码探索命令，支持多 prompt 并行、多端点路由、结构化搜索。

---

## 快速开始

```bash
# 单 prompt 搜索
maestro explore "What test framework is used?"

# 多 prompt 并行
maestro explore "Find DB query patterns" "Check error handling" "Map API routes"

# 结构化 prompt
maestro explore "FIND: N+1 query patterns
SCOPE: src/db/
EXCLUDE: test files
EXPECTED: file:line evidence list"
```

---

## 端点配置

API 端点配置：`~/.maestro/api.json`
MOA 模板配置：`~/.maestro/moa.json`

> **弃用说明**: `~/.maestro/api-explore.json` 仍作为 fallback 读取（1 个版本周期），建议迁移到 `api.json` + `moa.json`。

### 多端点配置（推荐）

```json
{
  "endpoints": {
    "qwen": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "sk-xxx",
      "model": "Qwen/Qwen3-8B",
      "maxTurns": 3
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-yyy",
      "model": "deepseek-chat",
      "maxTurns": 4
    },
    "sonnet": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxx",
      "model": "claude-sonnet-4-20250514",
      "format": "anthropic",
      "maxTurns": 4
    },
    "local": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "model": "qwen2.5-coder:7b",
      "maxTurns": 3,
      "extraBody": { "temperature": 0.2 }
    }
  },
  "maxTurns": 3,
  "concurrency": 4
}
```

### 端点字段说明

| 字段 | 说明 | 必填 |
|------|------|------|
| `baseUrl` | API 地址 | ✅ |
| `apiKey` | API 密钥（每个端点可不同） | ✅ |
| `model` | 模型名称 | ✅ |
| `format` | API 格式：`"openai"`（默认）或 `"anthropic"` | ❌ |
| `maxTurns` | 该端点最大搜索轮数（覆盖全局） | ❌ |
| `extraBody` | 模型特定参数（如 `enable_thinking`、`temperature`） | ❌ |
| `concurrency` | 该端点最大并发 job 数（默认无限制） | ❌ |

### API 格式（format）

每个端点可指定 `format` 字段：

| 值 | 说明 | 适用场景 |
|------|------|----------|
| `"openai"` | OpenAI Chat Completions 格式（默认） | vLLM、Ollama、SiliconFlow、DeepSeek、OpenRouter 等兼容端点 |
| `"anthropic"` | Anthropic Messages API 格式 | Anthropic 官方 API、ModelScope 等提供 Anthropic 兼容接口的平台 |

`"anthropic"` 格式自动处理：`x-api-key` 认证头、`tool_use`/`tool_result` 消息格式转换、usage 字段映射。

遗留单端点配置同样支持顶层 `"format"` 字段。CLI 入口支持 `--format` 参数覆盖。

### 全局字段

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `maxTurns` | 全局最大搜索轮数 | `6` |
| `concurrency` | 最大并行端点队列数 | `4` |

### 代理配置

在 `api.json` 中统一管理 proxy（CLI 工具的 `cli-tools.json` proxy 作为 fallback）：

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  },
  "endpoints": { ... }
}
```

优先级：`api.json` proxy > `cli-tools.json` proxy。

**代理传输层回退**（v0.5.50+）：当通过代理连接端点失败（传输层错误如 `ECONNREFUSED`、`ETIMEDOUT`）时，自动直连回退。仅传输错误触发回退，HTTP 状态码错误（如 401、429）不会重试。

### 遗留单端点配置

```json
{
  "baseUrl": "https://api.siliconflow.cn/v1",
  "apiKey": "sk-xxx",
  "model": "Qwen/Qwen3-8B",
  "maxTurns": 3
}
```

也支持环境变量：`API_EXPLORE_BASE_URL`、`API_EXPLORE_API_KEY`、`API_EXPLORE_MODEL`。

---

## 命令参考

```bash
maestro explore "<PROMPT>" [more prompts...] [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-e, --endpoint <names>` | 端点名称（逗号分隔） | 第一个可用 |
| `--all` | 每个 prompt 扇出到所有端点 | — |
| `--parallel <n>` | 最大并行端点队列数 | 配置或 `4` |
| `--ep-concurrency <n>` | 同一端点最大并发 job 数 | 无限制（或端点配置 `concurrency`） |
| `--max-turns <n>` | 最大搜索轮数（覆盖配置） | 配置或 `6` |
| `-f, --file <path>` | 从 JSON/文本文件加载 prompt | — |
| `--cd <dir>` | 工作目录 | 当前目录 |
| `-o, --output-dir <dir>` | 自定义 session 保存目录 | `.workflow/explore/` |
| `--no-save` | 不保存 session | — |
| `--json` | JSON 格式输出 | — |

### 子命令

| 子命令 | 说明 |
|--------|------|
| `maestro explore show` | 列出当前工作区的 explore 历史 |
| `maestro explore output <id>` | 查看指定 session 的结果 |
| `maestro explore output <id> --json` | JSON 格式查看 |

---

## Prompt 格式

### 结构化格式

```
FIND: [找什么 — 核心搜索目标]
SCOPE: [在哪找 — 文件模式或目录]
EXCLUDE: [不找什么 — 跳过的文件/模式]
ATTENTION: [注意什么 — 边界情况、陷阱]
EXPECTED: [输出什么 — 证据列表、摘要、JSON]
```

只有 `FIND` 必填。纯文本（无 `FIND:` 前缀）直接作为搜索查询。

### 字段详解

| 字段 | 作用 | 示例 |
|------|------|------|
| `FIND` | 搜索目标 | `所有可能导致 N+1 的数据库查询模式` |
| `SCOPE` | 搜索范围 | `src/db/**/*.ts`、`src/api/` |
| `EXCLUDE` | 排除内容 | `测试文件、生成代码、node_modules` |
| `ATTENTION` | 注意事项 | `ORM 懒加载陷阱、service 层的原始 SQL` |
| `EXPECTED` | 输出格式 | `file:line 证据列表，带严重级别` |

---

## 多 Prompt 输入

### 内联

```bash
maestro explore "分析 DB 查询模式" "审查错误处理" "映射 API 路由"
```

### JSON 文件

```bash
maestro explore -f prompts.json
```

**简单格式**：

```json
["Find DB patterns", "Check error handling", "Map API routes"]
```

**富格式**（per-prompt 端点绑定）：

```json
[
  { "prompt": "FIND: auth bypass\nSCOPE: src/api/", "endpoint": "deepseek" },
  { "prompt": "FIND: performance bottlenecks\nSCOPE: src/db/", "endpoint": "qwen" },
  { "prompt": "Check config consistency" }
]
```

### 文本文件

段落以空行分隔，每段为一个 prompt。

### 混合

```bash
maestro explore "内联 prompt" -f more-prompts.json
```

---

## 执行模型

**默认全并行，配置可限流。**

```
端点 A:  [job1] [job2] [job3]    ← 默认并行
端点 B:  [job4] → [job5]          ← concurrency: 1 时串行
          ↑ 并行 ↑
```

- 所有 job 默认并行执行（同端点、跨端点均并行）
- 限流优先级：`--ep-concurrency`（全局覆盖）> 端点配置 `concurrency` > 无限制
- 端点易触发 rate limit 时，在其配置中加 `"concurrency": 1` 恢复串行

---

## Session 管理

每次 explore 结果自动保存到 `.workflow/explore/{session-id}.json`，按工作空间隔离。

**输出分工**：文本模式下每个 job 完成即向 stdout 输出该结果（不等全部完成）；`--json` 在全部完成后输出结果数组（不含 trace）。session JSON 额外记录每个 job 的详细调用轨迹 `trace`（assistant 消息、工具调用、截断后的工具结果）与 token 用量 `usage`。

```bash
maestro explore show                    # 列出历史
maestro explore output exp-20260624-... # 查看结果
maestro explore output exp-20260624-... --json
```

`--no-save` 跳过保存。`-o /custom/path` 指定保存位置。

---

## 熔断切换（Circuit Breaker）

多端点场景下，当某个端点连续失败达到阈值，自动将后续 job 切换到健康端点，避免整批任务因单点故障全部失败。

### 行为规则

1. 每个端点独立计数连续失败次数
2. 达到阈值（默认 3 次）→ 熔断该端点
3. 后续 job 自动切换到备选端点执行
4. 无可用备选端点时，job 直接标记失败并跳过
5. 端点成功响应会重置失败计数
6. 仅在配置了 2 个以上端点时生效

### 配置

在 `~/.maestro/api.json` 中添加 `circuitBreaker` 字段：

```json
{
  "endpoints": {
    "qwen": { "baseUrl": "...", "apiKey": "...", "model": "Qwen/Qwen3-8B" },
    "deepseek": { "baseUrl": "...", "apiKey": "...", "model": "deepseek-chat" },
    "gpt-mini": { "baseUrl": "...", "apiKey": "...", "model": "gpt-5.4-mini" }
  },
  "circuitBreaker": {
    "threshold": 3,
    "fallbackOrder": ["gpt-mini", "deepseek", "qwen"]
  }
}
```

### 字段说明

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `threshold` | 连续失败几次后熔断 | `3` |
| `fallbackOrder` | 备选端点优先级列表 | 按配置顺序 |

### 运行时输出

熔断触发时会在 stderr 输出提示：

```
⚡ Circuit breaker: qwen tripped after 3 consecutive failures
[4/10] qwen tripped, fallback → gpt-mini:gpt-5.4-mini
```

运行结束后汇总：

```
Circuit breaker summary: qwen tripped during this run
```

### 注意事项

- 熔断状态仅在单次 `maestro explore` 运行期间有效，不跨运行持久化
- `--all` 模式下同样生效：某端点熔断后，其剩余 job 切换到备选端点
- 不配置 `circuitBreaker` 时保持原有行为（不熔断，失败即失败）
- `fallbackOrder` 中的端点也可能被熔断，此时继续查找下一个健康端点

---

## 常见用法

### 快速代码查询

```bash
maestro explore "Where is the auth middleware defined?"
```

### 多角度扫描

```bash
maestro explore \
  "FIND: security vulnerabilities
SCOPE: src/api/
ATTENTION: injection, auth bypass, SSRF" \
  "FIND: performance bottlenecks
SCOPE: src/db/
ATTENTION: N+1, missing indexes" \
  "FIND: error handling gaps
SCOPE: src/
ATTENTION: uncaught exceptions"
```

### Per-Prompt 端点路由

```bash
maestro explore -f tasks.json
```

```json
[
  { "prompt": "Deep architecture analysis", "endpoint": "deepseek" },
  { "prompt": "Quick pattern scan", "endpoint": "qwen" }
]
```

### 全端点对比

```bash
maestro explore "How does the auth system work?" --all --json
```

---

## MOA 多模型聚合

MOA (Mixture of Agents) 是 Explore 的高级模式——多个 reference 模型并行搜索，aggregator 综合最终答案。

### 快速开始

```bash
# 使用默认 preset
maestro moa "FIND: auth middleware\nSCOPE: src/"

# 指定 preset
maestro moa "query" --preset thorough

# 多 prompt（每个都走 MOA 流程）
maestro moa "Find DB patterns" "Check error handling"
```

### 工作原理

```
prompt ──→ reference 1 (agentLoop + 工具) ──┐
       ──→ reference 2 (agentLoop + 工具) ──┤ 并行
       ──→ reference 3 (agentLoop + 工具) ──┘
                     │
                     ▼
           聚合所有 reference 输出
           拼入 aggregator prompt 尾部
                     │
                     ▼
           aggregator (agentLoop + 工具) → 最终结果
```

1. **Reference 阶段**：每个 reference 端点运行完整的 agentLoop（有 Search/Read 工具），独立搜索代码并生成分析
2. **聚合阶段**：所有 reference 输出拼接到原始 prompt 尾部，传给 aggregator
3. **Aggregator 阶段**：aggregator 综合 reference 分析，执行自己的搜索验证，生成最终答案

System prompt 在 reference 和 aggregator 之间保持一致，确保 provider 侧缓存前缀稳定。

### MOA 配置

编辑 `~/.maestro/moa.json` 配置 MOA 预设（端点定义在 `~/.maestro/api.json`）：

```json
{
  "endpoints": {
    "qwen": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "sk-xxx",
      "model": "Qwen/Qwen3-8B"
    },
    "gpt-codex": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-yyy",
      "model": "gpt-5.3-codex-spark",
      "extraBody": { "max_completion_tokens": 4000 }
    },
    "sonnet": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxx",
      "model": "claude-sonnet-4-6",
      "format": "anthropic"
    }
  },
  "moa": {
    "defaultPreset": "default",
    "presets": {
      "default": {
        "referenceEndpoints": ["qwen"],
        "aggregatorEndpoint": "gpt-codex"
      },
      "thorough": {
        "referenceEndpoints": ["qwen", "sonnet"],
        "aggregatorEndpoint": "gpt-codex"
      }
    }
  }
}
```

#### Preset 字段

| 字段 | 说明 | 必填 |
|------|------|------|
| `referenceEndpoints` | reference 端点名称列表（最多 4 个） | ✅ |
| `aggregatorEndpoint` | aggregator 端点名称 | ✅ |
| `mode` | 编排模式：`"initial-only"`（默认） | ❌ |
| `enabled` | 是否启用此 preset | ❌ |

温度、max_tokens 等模型参数由端点自己的 `extraBody` 控制，preset 只描述流程编排。

#### 设计原则

- **Preset 只管流程**：哪些端点做 reference，哪个做 aggregator，什么模式
- **端点管模型参数**：温度、token 限制、特殊参数写在 endpoint 的 `extraBody` 中
- **一处配置一处生效**：修改端点参数自动在 explore 和 moa 中同时生效

### MOA 命令用法

```bash
maestro moa "your search query"              # 基础用法
maestro moa "query" --preset thorough         # 指定 preset
maestro moa "query" --max-turns 3             # 限制搜索轮数
maestro moa "query" --cd /path/to/project     # 指定工作目录
maestro moa "query" --json                    # JSON 输出
maestro moa "query" --no-save                 # 不保存 session
```

#### Session 管理

```bash
maestro moa show                    # 查看历史 session
maestro moa output <session-id>     # 查看 session 结果
```

### Explore vs MOA 对比

| 特性 | `maestro explore` | `maestro moa` |
|------|-------------------|---------------|
| agent 数量 | 1 个 agent / prompt | N reference + 1 aggregator |
| 多端点 | `--all` 扇出（独立运行） | preset 协作（reference → aggregator）|
| 工具访问 | ✅ 完整 | ✅ reference 和 aggregator 都有 |
| 成本 | 1x | (N+1)x（N 个 reference + 1 aggregator）|
| 适用场景 | 快速查找、简单搜索 | 复杂分析、需要交叉验证 |

两者共享端点配置（`~/.maestro/api.json`）和 session 存储（`.workflow/explore/`）。MOA 预设在 `~/.maestro/moa.json` 中独立配置。

### 退化行为

- **部分 reference 失败**：失败信息注入 aggregator 上下文，不中断流程
- **全部 reference 失败**：aggregator 退化为单 agent 运行（标记为 `degraded`）
- **aggregator 端点不存在**：命令报错退出

### 最佳实践

1. **reference 用便宜模型，aggregator 用强模型**——性价比最高
2. **2-3 个 reference 足够**——更多 reference 收益递减，成本线性增长
3. **不同模型做 reference**——同质模型的 reference 输出高度重复，浪费资源
4. **结构化 prompt 效果更好**——FIND/SCOPE/EXPECTED 让每个 reference 搜索更精准
