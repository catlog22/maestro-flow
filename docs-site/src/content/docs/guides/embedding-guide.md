---
title: "Embedding 模型配置指南"
---

Maestro Search 支持基于 Embedding 的语义搜索，通过向量相似度补充 BM25 全文检索，提供更精准的搜索结果。

---

## 概述

Maestro 的 Embedding 系统基于 `@huggingface/transformers`（ONNX 后端），默认使用 `Xenova/multilingual-e5-small` 模型（22M 参数，384 维），支持：

- **智能设备检测**：自动 benchmark CPU vs GPU（DirectML），选择最快后端
- **批量推理**：可配置 batch size（4-5x 性能提升）
- **增量索引**：仅重新嵌入新增或变更文档
- **优雅降级**：transformers 不可用时自动回退到纯 BM25

### 模型大小

| 文件 | 大小 | 说明 |
|------|------|------|
| `onnx/model.onnx` | ~448 MB | ONNX 推理模型（fp32） |
| `tokenizer.json` | ~16 MB | 分词器 |
| `config.json` | <1 KB | 模型配置 |
| **合计** | **~465 MB** | 首次使用自动下载 |

模型缓存位置：`<maestro-package>/node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/`

> **注意**：模型缓存在 `node_modules` 内，`npm install` 后会丢失，需要重新下载。

---

## 快速开始

### 1. 安装依赖

```bash
npm install @huggingface/transformers onnxruntime-node
```

### 2. 管理 Embedding（TUI 命令）

```bash
# 查看状态（模式、模型、缓存、设备、索引）
maestro install embedding --status

# 输出示例：
#   Mode:     Local (ONNX)
#   Model:    Xenova/multilingual-e5-small
#   Cached:   Yes
#   Device:   gpu/fp16 batch=128
#   GPU:      Available
#   Wiki idx: 804 docs
#   Code idx: 7720 nodes

# 下载本地模型（~465 MB）
maestro install embedding --download

# 切换到本地模式（从 API 模式切换）
maestro install embedding --local

# 重建代码向量索引
maestro install embedding --rebuild
```

### 3. 预热模型

首次运行会自动下载模型（~465 MB），下载过程有进度条提示。
`maestro install` 在安装完成后也会自动预热模型。

```bash
# 手动预热
maestro install embedding --download
```

### 4. 手动下载模型（可选）

如果自动下载失败（网络问题、代理限制），可以手动下载模型文件：

```bash
# 1. 定位缓存目录（在 maestro 安装目录下）
#    Windows: <maestro>\node_modules\@huggingface\transformers\.cache\Xenova\multilingual-e5-small\
#    Linux/macOS: <maestro>/node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/

# 2. 创建目录（含 onnx 子目录）
mkdir -p node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/onnx

# 3. 下载文件（需要代理的地区请配置 HTTPS_PROXY）
CACHE=node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small
HF=https://huggingface.co/Xenova/multilingual-e5-small/resolve/main

curl -L -o $CACHE/onnx/model.onnx  $HF/onnx/model.onnx           # ~448 MB
curl -L -o $CACHE/tokenizer.json   $HF/tokenizer.json             # ~16 MB
curl -L -o $CACHE/config.json      $HF/config.json                # <1 KB
curl -L -o $CACHE/tokenizer_config.json $HF/tokenizer_config.json # <1 KB

# 4. 验证
maestro embedding status
```

> 也可从镜像源下载（将 `huggingface.co` 替换为 `hf-mirror.com`）。

---

## 外部 API 配置

除本地 ONNX 模型外，Maestro 支持通过外部 API 获取 embedding 向量。配置文件 `~/.maestro/api-embedding.json` 存在时自动启用 API 模式，跳过本地模型加载。

### 配置文件

创建 `~/.maestro/api-embedding.json`：

```json
{
  "baseUrl": "https://api.siliconflow.cn/v1",
  "apiKey": "sk-your-api-key",
  "model": "BAAI/bge-m3",
  "dimensions": 1024,
  "batchSize": 64
}
```

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | ✅ | — | OpenAI 兼容的 API 端点（需支持 `/embeddings`） |
| `apiKey` | ✅ | — | API 密钥 |
| `model` | ✅ | — | 模型名称（如 `BAAI/bge-m3`、`text-embedding-3-small`） |
| `dimensions` | ❌ | — | 向量维度（部分 API 支持指定输出维度） |
| `batchSize` | ❌ | `100` | 每次 API 请求的最大文本数 |

### 兼容的 API 服务

任何支持 OpenAI `/v1/embeddings` 接口格式的服务均可使用：

| 服务 | baseUrl | 推荐模型 |
|------|---------|----------|
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `BAAI/bge-m3` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `text-embedding-v3` |
| 本地 Ollama | `http://localhost:11434/v1` | `nomic-embed-text` |

### 验证配置

```bash
# 检查 API 模式状态
maestro embedding status

# API 模式输出示例：
# Mode: API (external)
# Endpoint: https://api.siliconflow.cn/v1
# Model: BAAI/bge-m3
# Dimensions: 1024
# Batch size: 64
# Active model: BAAI/bge-m3

# 测试 API 连通性
maestro embedding warmup

# 输出：
# Warming up API embedding (BAAI/bge-m3)...
# API embedding ready (234ms)
```

### 切换模式

| 操作 | 命令 / 方法 |
|------|------|
| 切换到本地模式 | `maestro install embedding --local` |
| 切换到 API 模式 | 创建 `~/.maestro/api-embedding.json` |
| 切换模型 | 修改配置文件中的 `model` 字段 |
| 重建索引 | `maestro install embedding --rebuild` |

> **注意**：切换模型后首次搜索会触发全量索引重建（模型不同，向量不兼容），后续搜索使用增量更新。

### 代理配置

API 模式自动读取代理设置，优先级：

1. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
2. `~/.maestro/cli-tools.json` 中的 `proxy` 配置

### 容错机制

- **自动重试**：429/5xx 错误自动重试 2 次（指数退避 1s→2s→4s）
- **并行请求**：多批次并发上限 4，加速大量文档的索引构建
- **降级回退**：API 不可达时自动使用上一次成功构建的索引（而非完全禁用 embedding）
- **原子写入**：索引文件使用 temp+rename 防止写入中断导致损坏

---

## 本地模型文件夹

当自动下载不可用（离线环境、网络限制）或需要使用自定义 ONNX 模型时，可以指定本地模型文件夹路径，跳过 HuggingFace Hub 下载。

### 配置方式

**方式一：配置文件**（推荐）

创建 `~/.maestro/local-embedding.json`：

```json
{
  "modelPath": "D:/models/multilingual-e5-small"
}
```

**方式二：环境变量**

```bash
export MAESTRO_EMBEDDING_MODEL_PATH="D:/models/multilingual-e5-small"
```

> 环境变量优先于配置文件。

### 模型文件夹结构

本地模型文件夹必须包含 ONNX 模型文件，支持两种目录结构：

```
# 标准结构（推荐）
models/multilingual-e5-small/
├── onnx/
│   └── model.onnx          # ONNX 推理模型
├── tokenizer.json           # 分词器
├── tokenizer_config.json    # 分词器配置
└── config.json              # 模型配置

# 扁平结构
models/multilingual-e5-small/
├── model.onnx               # ONNX 推理模型
├── tokenizer.json
└── config.json
```

### 准备本地模型

```bash
# 从 HuggingFace 下载到本地文件夹
mkdir -p D:/models/multilingual-e5-small/onnx
HF=https://huggingface.co/Xenova/multilingual-e5-small/resolve/main

curl -L -o D:/models/multilingual-e5-small/onnx/model.onnx  $HF/onnx/model.onnx
curl -L -o D:/models/multilingual-e5-small/tokenizer.json   $HF/tokenizer.json
curl -L -o D:/models/multilingual-e5-small/config.json      $HF/config.json
curl -L -o D:/models/multilingual-e5-small/tokenizer_config.json $HF/tokenizer_config.json
```

### 验证配置

```bash
maestro embedding status

# 本地模型文件夹模式输出示例：
# Transformers: available
# Device: gpu/fp16 batch=128 (local)
# Model: local → D:/models/multilingual-e5-small
# Active model: D:/models/multilingual-e5-small
```

### 优先级

模型加载按以下优先级选择：

1. **API 模式** — `~/.maestro/api-embedding.json` 存在时使用外部 API
2. **本地文件夹** — `MAESTRO_EMBEDDING_MODEL_PATH` 环境变量 > `~/.maestro/local-embedding.json`
3. **HuggingFace Hub** — 默认从 Hub 下载 `Xenova/multilingual-e5-small`

---

## 本地模型配置

### 设备配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `device` | `cpu` \| `gpu` | 自动检测 | GPU 可用时自动使用 DML/CUDA |
| `dtype` | `fp32` \| `fp16` \| `q8` \| `q4` | `fp16`（GPU）/ `fp32`（CPU） | 模型精度 |
| `batchSize` | number | `128`（GPU）/ `32`（CPU） | 批量推理大小 |

**设备选择策略**：

系统自动检测 GPU（DirectML/CUDA），可用时默认使用 GPU + fp16 以获得最佳吞吐量。可通过环境变量 `MAESTRO_EMBEDDING_DEVICE=cpu` 强制使用 CPU。

### 模型配置

| 常量 | 值 | 说明 |
|------|-----|------|
| `DEFAULT_MODEL` | `Xenova/multilingual-e5-small` | 默认多语言模型 |
| `dimension` | `384` | 向量维度 |
| `maxTokens` | `512` | 最大 token 长度 |

### RRF 融合参数

Maestro 使用 RRF（Reciprocal Rank Fusion）融合 BM25 和向量搜索结果：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `k` | `60` | RRF 常数（控制排名衰减速度） |
| `bm25Weight` | `0.6` | BM25 权重 |
| `vectorWeight` | `0.4` | 向量搜索权重 |
| `alpha` | `0.4` | 混合融合中 RRF 的权重 |

---

## 使用方式

### 基本搜索

```bash
# 自动使用 embedding（如果可用）
maestro search "authentication patterns"

# 显式跳过 embedding（仅 BM25）
maestro search "jwt token" --no-emb
```

### Embedding 管理

```bash
# 查看状态
maestro install embedding --status

# 下载/预热模型
maestro install embedding --download

# 重建代码向量索引
maestro install embedding --rebuild

# 切换本地模式
maestro install embedding --local
```

---

## 索引结构

### 二进制格式

Embedding 索引使用高效的二进制格式存储（`embedding-index.bin`）：

```
[metaLen:4][metaJSON][docIdsLen:4][docIdsJSON][vectors:n*dim*4]
```

- **meta**：模型 ID、维度、构建时间、设备信息
- **docIds**：文档 ID 数组
- **vectors**：Float32 向量数组

### 增量更新

索引支持增量更新，仅重新嵌入内容变更的文档：

1. 计算文档内容 MD5 哈希
2. 对比现有索引的哈希值
3. 仅对变更文档重新生成向量
4. 保留未变更文档的向量

---

## 性能优化

### 冷启动优化

| 场景 | 耗时 | 说明 |
|------|------|------|
| 首次加载（无 daemon） | ~1800ms | ONNX 模型加载 |
| daemon 热路径 | ~280ms | 模型已缓存 |
| BM25-only 降级 | ~280ms | 跳过 embedding |

### Search Daemon

Search daemon 保持 embedding 模型热缓存：

```bash
# 启动 daemon
maestro search-daemon start

# 查看状态
maestro search-daemon status
```

daemon 空闲 30 分钟后自动关闭。

### 自动降级策略

当 daemon 不可用时：
1. 自动降级为 BM25-only 模式
2. 后台自动启动 daemon
3. 后续搜索获得 embedding 加速

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `MAESTRO_EMBEDDING_MODEL_PATH` | 本地 ONNX 模型文件夹路径（优先于配置文件） |
| `MAESTRO_EMBEDDING_DEVICE` | 强制设备选择：`cpu`（跳过 GPU） |
| `MAESTRO_EMBEDDING_BATCH_SIZE` | 覆盖默认 batch size |
| `HTTPS_PROXY` | HTTPS 代理（用于模型下载和 API 调用） |
| `HTTP_PROXY` | HTTP 代理 |
| `ALL_PROXY` | 通用代理 |

---

## 故障排除

### 模型不可用

```bash
# 检查状态
maestro embedding status

# 常见原因：
# 1. @huggingface/transformers 未安装
# 2. onnxruntime-node 未安装
# 3. 网络问题（无法下载模型）
```

### 索引损坏

```bash
# 重建索引
maestro embedding rebuild
```

### 性能问题

```bash
# 查看设备信息
maestro embedding status

# 如果 GPU 可用但未使用，检查 onnxruntime-node 版本
npm list onnxruntime-node
```

---

## 相关命令

```bash
# 搜索命令
maestro search <query> [--no-emb] [--json]

# Embedding 管理
maestro embedding status
maestro embedding warmup
maestro embedding rebuild

# Search Daemon
maestro search-daemon start
maestro search-daemon stop
maestro search-daemon status
```

---

## 技术细节

### E5 模型前缀

本地 E5 模型要求特定前缀：
- 查询：`query: <text>`
- 文档：`passage: <text>`

本地模式下系统自动添加此前缀。API 模式下不添加前缀，由 API 服务端处理。

### 余弦相似度

向量搜索使用余弦相似度：

```typescript
cosineSimilarity(a, b) = dot(a, b) / (norm(a) * norm(b))
```

对于 <10K 文档，使用暴力搜索（flat search）即可满足性能需求。

### 混合融合算法

最终分数计算：

```
finalScore = alpha * rrfNorm + (1 - alpha) * bm25Norm
```

- `rrfNorm`：RRF 分数归一化
- `bm25Norm`：BM25 分数归一化
- `alpha`：控制 RRF 和 BM25 的相对权重
