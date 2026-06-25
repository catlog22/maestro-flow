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

### 2. 检查状态

```bash
# 查看 embedding 模型状态
maestro embedding status

# 输出示例：
# Transformers: available
# Device: cpu/fp32 batch=32
# Model: Xenova/multilingual-e5-small (~465 MB)
# Index: 277 docs, dim=384, model=Xenova/multilingual-e5-small
```

### 3. 预热模型

首次运行会自动下载模型（~465 MB），下载过程有进度条提示：

```bash
# 预热 embedding 模型
maestro embedding warmup

# 首次输出示例：
# Warming up model...
# Downloading model Xenova/multilingual-e5-small (~465 MB)...
# [████████████████░░░░] 80% 360 MB model.onnx
# Model ready (cpu/fp32 batch=32, 12345ms)
```

`maestro install` 也会在安装完成后自动预热模型，同样显示下载进度。

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

## 配置参数

### 设备配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `device` | `cpu` \| `gpu` | `cpu` | 计算设备 |
| `dtype` | `fp32` \| `fp16` \| `q8` \| `q4` | `fp32` | 模型精度 |
| `batchSize` | number | `32`（CPU）/ `64`（GPU） | 批量推理大小 |

**设备选择策略**：

对于小型模型（all-MiniLM-L6-v2, 22M 参数），CPU 通常更快，因为 CPU↔GPU 数据传输开销超过计算节省。GPU 仅在模型 >100M 参数或 batch size >500 时有优势。

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
maestro embedding status

# 预热模型
maestro embedding warmup

# 重建索引
maestro embedding rebuild
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
| `HTTPS_PROXY` | HTTPS 代理（用于模型下载） |
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

E5 模型要求特定前缀：
- 查询：`query: <text>`
- 文档：`passage: <text>`

系统自动添加此前缀，无需手动处理。

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
