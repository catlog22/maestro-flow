---
title: "MOA 多模型聚合指南"
---

Mixture of Agents (MOA)——多个 reference 模型并行搜索同一个问题，aggregator 综合它们的结果给出最终答案。

---

## 快速开始

```bash
# 使用默认 preset
maestro moa "FIND: auth middleware\nSCOPE: src/"

# 指定 preset
maestro moa "query" --preset thorough

# 多 prompt（每个都走 MOA 流程）
maestro moa "Find DB patterns" "Check error handling"
```

---

## 工作原理

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

---

## 配置

编辑 `~/.maestro/api-explore.json`，添加 `moa` 配置节：

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

### Preset 字段

| 字段 | 说明 | 必填 |
|------|------|------|
| `referenceEndpoints` | reference 端点名称列表（最多 4 个） | ✅ |
| `aggregatorEndpoint` | aggregator 端点名称 | ✅ |
| `mode` | 编排模式：`"initial-only"`（默认） | ❌ |
| `enabled` | 是否启用此 preset | ❌ |

温度、max_tokens 等模型参数由端点自己的 `extraBody` 控制，preset 只描述流程编排。

### 设计原则

- **Preset 只管流程**：哪些端点做 reference，哪个做 aggregator，什么模式
- **端点管模型参数**：温度、token 限制、特殊参数写在 endpoint 的 `extraBody` 中
- **一处配置一处生效**：修改端点参数自动在 explore 和 moa 中同时生效

---

## 命令用法

```bash
# 基础用法
maestro moa "your search query"

# 指定 preset
maestro moa "query" --preset thorough

# 限制搜索轮数
maestro moa "query" --max-turns 3

# 指定工作目录
maestro moa "query" --cd /path/to/project

# JSON 输出
maestro moa "query" --json

# 不保存 session
maestro moa "query" --no-save
```

### Session 管理

```bash
# 查看历史 session
maestro moa show

# 查看 session 结果
maestro moa output <session-id>
```

---

## 与 explore 的关系

| 特性 | `maestro explore` | `maestro moa` |
|------|-------------------|---------------|
| agent 数量 | 1 个 agent / prompt | N reference + 1 aggregator |
| 多端点 | `--all` 扇出（独立运行） | preset 协作（reference → aggregator）|
| 工具访问 | ✅ 完整 | ✅ reference 和 aggregator 都有 |
| 成本 | 1x | (N+1)x（N 个 reference + 1 aggregator）|
| 适用场景 | 快速查找、简单搜索 | 复杂分析、需要交叉验证 |

两者共享端点配置（`~/.maestro/api-explore.json`）和 session 存储（`.workflow/explore/`）。

---

## 退化行为

- **部分 reference 失败**：失败信息注入 aggregator 上下文，不中断流程
- **全部 reference 失败**：aggregator 退化为单 agent 运行（标记为 `degraded`）
- **aggregator 端点不存在**：命令报错退出

---

## 最佳实践

1. **reference 用便宜模型，aggregator 用强模型**——性价比最高
2. **2-3 个 reference 足够**——更多 reference 收益递减，成本线性增长
3. **不同模型做 reference**——同质模型的 reference 输出高度重复，浪费资源
4. **结构化 prompt 效果更好**——FIND/SCOPE/EXPECTED 让每个 reference 搜索更精准
