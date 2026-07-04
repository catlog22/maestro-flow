---
title: "Explore 轻量搜索指南"
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
      "model": "claude-sonnet-4-6",
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
  "defaults": {
    "maxTurns": 3,
    "concurrency": 4
  }
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
| `concurrency` | 该端点最大并发数（默认 1 = 串行） | ❌ |

### API 格式（format）

每个端点可指定 `format` 字段：

| 值 | 说明 | 适用场景 |
|------|------|----------|
| `"openai"` | OpenAI Chat Completions 格式（默认） | vLLM、Ollama、SiliconFlow、DeepSeek、OpenRouter 等兼容端点 |
| `"anthropic"` | Anthropic Messages API 格式 | Anthropic 官方 API（Claude 系列模型） |

`"anthropic"` 格式自动处理：`x-api-key` 认证头、`tool_use`/`tool_result` 消息格式转换、usage 字段映射。

遗留单端点配置同样支持顶层 `"format"` 字段。CLI 入口支持 `--format` 参数覆盖。

### 全局默认值

在 `api.json` 的 `defaults` 字段中配置：

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

### MOA 模板配置

MOA（Mixture-of-Agents）模板在 `~/.maestro/moa.json` 中独立配置：

```json
{
  "defaultPreset": "default",
  "presets": {
    "default": {
      "referenceEndpoints": ["gpt-mini"],
      "aggregatorEndpoint": "gpt-codex"
    },
    "deep": {
      "referenceEndpoints": ["gpt-codex", "deepseek"],
      "aggregatorEndpoint": "sonnet"
    }
  }
}
```

端点名引用 `api.json` 中的命名端点。

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
| `--ep-concurrency <n>` | 同一端点最大并发 job 数 | `1`（串行） |
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

**同端点串行，跨端点并行。**

```
端点 A:  [job1] → [job2] → [job3]    ← 串行（避免限流）
端点 B:  [job4] → [job5]              ← 串行
          ↑ 并行 ↑
```

- 同一 API 的 job 排队逐个执行，避免触发 rate limit
- 不同 API 的队列同时运行
- `--ep-concurrency 2` 可提升单端点并发（API 允许时）

---

## Session 管理

每次 explore 结果自动保存到 `.workflow/explore/{session-id}.json`，按工作空间隔离。

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
