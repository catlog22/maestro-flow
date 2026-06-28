# Embedding 模型集成设计

## 概述

Maestro Search 的 Embedding 系统基于 `@huggingface/transformers`（ONNX 后端），提供语义搜索能力，与 BM25 全文检索形成混合搜索。

## 架构设计

### 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│                    Maestro Search                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   BM25F     │    │  Embedding  │    │   RRF       │     │
│  │  全文检索   │    │  语义搜索   │    │  融合排序   │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                    ┌───────▼───────┐                        │
│                    │  WikiIndexer  │                        │
│                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

1. **索引构建**
   - WikiIndexer 收集文档（spec/knowhow/issue 等）
   - Embedding 引擎生成文档向量（本地 ONNX 或外部 API）
   - 向量索引保存为二进制文件（原子写入：temp+rename）

2. **查询流程**
   - 用户输入查询
   - 并行执行 BM25 和向量搜索
   - RRF 融合结果
   - 返回排序后的结果

3. **双模式路由**
   - `~/.maestro/api-embedding.json` 存在 → API 模式（OpenAI 兼容端点）
   - 否则 → 本地模式（ONNX + transformers）
   - 模式切换触发全量索引重建（模型不同，向量不兼容）

## 技术实现

### 模型选择

**本地模式**（默认）使用 `Xenova/multilingual-e5-small`：
- **参数量**：22M
- **向量维度**：384
- **多语言支持**：中英文等 100+ 语言
- **模型大小**：~465MB（ONNX 格式）

**API 模式**通过 `~/.maestro/api-embedding.json` 配置：
- 支持任何 OpenAI 兼容的 `/v1/embeddings` 端点
- 并行批次请求（并发上限 4）+ 自动重试（429/5xx）
- API 模式不添加 E5 特有的 `passage:`/`query:` 前缀

### 设备检测

```typescript
async function detectDevice(): Promise<DeviceConfig> {
  const backends = await listBackends();
  const hasGpu = backends.some(b => b.name === 'dml' || b.name === 'cuda');

  // 小模型 CPU 更快（传输开销 > 计算节省）
  return {
    device: 'cpu',
    dtype: 'fp32',
    batchSize: hasGpu ? 64 : 32,
  };
}
```

### 批量推理

```typescript
async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getPipeline();
  const config = await detectDevice();
  const batchSize = config.batchSize;
  const results: Float32Array[] = [];

  // 截断到 512 tokens
  const truncated = texts.map(t => t.slice(0, 512));

  for (let i = 0; i < truncated.length; i += batchSize) {
    const batch = truncated.slice(i, i + batchSize);
    const output = await pipe(batch, { pooling: 'mean', normalize: true });
    // 处理批量输出...
  }

  return results;
}
```

### 增量索引

```typescript
async function buildEmbeddingIndex(
  docs: DocForEmbedding[],
  existingIndex?: EmbeddingIndex | null,
): Promise<EmbeddingIndex> {
  const currentHashes = docs.map(hashDocContent);

  if (existingIndex && existingIndex.modelId === DEFAULT_MODEL) {
    // 增量更新：仅重新嵌入变更文档
    const changedDocs = findChangedDocs(docs, existingIndex, currentHashes);
    if (changedDocs.length > 0) {
      const newVectors = await embedTexts(changedDocs.map(docToText));
      // 合并新旧向量...
    }
  } else {
    // 全量重建
    const vectors = await embedTexts(docs.map(docToText));
  }
}
```

## RRF 融合算法

### 基本 RRF

```typescript
function mergeRRF(
  bm25Results: RankedResult[],
  vectorResults: RankedResult[],
  limit: number,
  k = 60,
  bm25Weight = 0.6,
  vectorWeight = 0.4,
): RankedResult[] {
  const scores = new Map<string, number>();

  for (const { weight, results } of [
    { weight: bm25Weight, results: bm25Results },
    { weight: vectorWeight, results: vectorResults },
  ]) {
    for (let i = 0; i < results.length; i++) {
      const rrf = weight / (k + i + 1);
      scores.set(results[i].docId, (scores.get(results[i].docId) ?? 0) + rrf);
    }
  }

  return Array.from(scores.entries())
    .map(([docId, score]) => ({ docId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

### 混合融合

```typescript
function mergeHybrid(
  bm25Results: RankedResult[],
  vectorResults: RankedResult[],
  limit: number,
  options?: { k?: number; alpha?: number; bm25Weight?: number; vectorWeight?: number },
): RankedResult[] {
  const k = options?.k ?? 10;
  const alpha = options?.alpha ?? 0.4;

  // RRF 排序
  const rrfResults = mergeRRFSignals([...], limit * 3, k);

  // 归一化
  const maxRrf = rrfResults[0]?.score ?? 1;
  const maxBm25 = bm25Results[0]?.score ?? 1;

  // 混合分数
  const merged = rrfResults.map(r => ({
    docId: r.docId,
    score: alpha * (r.score / maxRrf) + (1 - alpha) * (bm25Score / maxBm25),
  }));

  return merged.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

## 存储格式

### 二进制格式

```
┌─────────────────────────────────────────────────────────────┐
│  Meta Length (4 bytes)                                      │
├─────────────────────────────────────────────────────────────┤
│  Meta JSON                                                  │
│  { modelId, dimension, count, builtAt, deviceUsed, ... }   │
├─────────────────────────────────────────────────────────────┤
│  DocIds Length (4 bytes)                                    │
├─────────────────────────────────────────────────────────────┤
│  DocIds JSON                                                │
│  ["doc1", "doc2", ...]                                      │
├─────────────────────────────────────────────────────────────┤
│  Vectors (n * dimension * 4 bytes)                          │
│  [vec1_float32, vec2_float32, ...]                          │
└─────────────────────────────────────────────────────────────┘
```

### 向量格式

每个向量为 `Float32Array`，长度为 `dimension`（默认 384）。

## 性能指标

| 指标 | 值 | 说明 |
|------|-----|------|
| 模型加载 | ~1800ms | 首次加载 ONNX 模型 |
| 查询延迟 | ~50ms | 热路径（daemon） |
| 索引构建 | ~1200ms | 277 文档 |
| 内存占用 | ~100MB | 模型 + 索引 |

## Multi-chunk 文档分割策略

长文档（body ≥ 500 字符）按 markdown 标题 `/^#{1,3}\s/m` 分割为最多 5 个 chunk，每个 chunk 继承 title + summary 作为上下文前缀。短文档产生单个 chunk。

**chunk ID 格式**：`{docId}#{chunkIndex}`

**EmbeddingIndex 映射**：
- `docIds[]` — 存储 chunkId（如 `spec-coding#0`、`spec-coding#1`）
- `chunkDocIds[]` — 与 docIds 平行，映射每个 chunk 回原始文档 ID
- `contentHashes[]` — 每个 chunk 存储其父文档的内容哈希

**增量重建**：当文档哈希未变时复用已有 chunk 向量；chunk 结构变化（如标题增减）触发该文档全部 chunk 重新嵌入。

## 结构化 docToText 格式

文档转文本使用结构化字段标签，提升语义搜索质量：

```
title: {title}
summary: {summary}
tags: {tag1, tag2}
content: {body_or_section}
title: {title}    ← 尾部重复 title 增强匹配
```

- 本地模式添加 `passage:` 前缀（E5 模型要求）
- API 模式不添加前缀

## 未来扩展

1. **GPU 加速**：支持 DirectML/CUDA 后端
2. ~~**外部 API 支持**~~：✅ 已实现 — `~/.maestro/api-embedding.json` 配置外部 embedding API
3. ~~**向量数据库**~~：✅ zvec 向量数据库集成 — 已完成（`@zvec/zvec` FLAT/COSINE 索引，feature flag `MAESTRO_EMBEDDING_FLAT_SCAN` 回退到平坦余弦扫描）
4. **分布式索引**：支持多节点索引
