---
title: "Embedding Model Configuration Guide"
---

Maestro Search supports embedding-based semantic search, supplementing BM25 full-text retrieval with vector similarity for more accurate results.

---

## Overview

Maestro's embedding system is built on `@huggingface/transformers` (ONNX backend), using `Xenova/multilingual-e5-small` model (22M parameters, 384 dimensions) by default. Features include:

- **Smart device detection**: Auto-benchmarks CPU vs GPU (DirectML), picks fastest
- **Batch inference**: Configurable batch sizes (4-5x performance boost)
- **Incremental indexing**: Only re-embeds new or changed documents
- **Graceful degradation**: Falls back to pure BM25 when transformers is unavailable

### Model Size

| File | Size | Description |
|------|------|-------------|
| `onnx/model.onnx` | ~448 MB | ONNX inference model (fp32) |
| `tokenizer.json` | ~16 MB | Tokenizer |
| `config.json` | <1 KB | Model config |
| **Total** | **~465 MB** | Auto-downloaded on first use |

Model cache location: `<maestro-package>/node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/`

> **Note**: Model is cached inside `node_modules`, so it will be lost after `npm install` and needs re-downloading.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install @huggingface/transformers onnxruntime-node
```

### 2. Check Status

```bash
# View embedding model status
maestro embedding status

# Output example:
# Transformers: available
# Device: cpu/fp32 batch=32
# Model: Xenova/multilingual-e5-small (~465 MB)
# Index: 277 docs, dim=384, model=Xenova/multilingual-e5-small
```

### 3. Warm Up Model

First run will auto-download the model (~465 MB) with a progress bar:

```bash
# Warm up embedding model
maestro embedding warmup

# First-time output example:
# Warming up model...
# Downloading model Xenova/multilingual-e5-small (~465 MB)...
# [████████████████░░░░] 80% 360 MB model.onnx
# Model ready (cpu/fp32 batch=32, 12345ms)
```

`maestro install` also warms up the model after installation, showing download progress.

### 4. Manual Download (Optional)

If auto-download fails (network issues, proxy restrictions), you can manually download model files:

```bash
# 1. Locate cache directory (under maestro install dir)
#    Windows: <maestro>\node_modules\@huggingface\transformers\.cache\Xenova\multilingual-e5-small\
#    Linux/macOS: <maestro>/node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/

# 2. Create directory (including onnx subdirectory)
mkdir -p node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/onnx

# 3. Download files (configure HTTPS_PROXY if needed)
CACHE=node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small
HF=https://huggingface.co/Xenova/multilingual-e5-small/resolve/main

curl -L -o $CACHE/onnx/model.onnx  $HF/onnx/model.onnx           # ~448 MB
curl -L -o $CACHE/tokenizer.json   $HF/tokenizer.json             # ~16 MB
curl -L -o $CACHE/config.json      $HF/config.json                # <1 KB
curl -L -o $CACHE/tokenizer_config.json $HF/tokenizer_config.json # <1 KB

# 4. Verify
maestro embedding status
```

> Mirror sites can also be used (replace `huggingface.co` with `hf-mirror.com`).

---

## Configuration Parameters

### Device Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `device` | `cpu` \| `gpu` | `cpu` | Compute device |
| `dtype` | `fp32` \| `fp16` \| `q8` \| `q4` | `fp32` | Model precision |
| `batchSize` | number | `32` (CPU) / `64` (GPU) | Batch inference size |

**Device Selection Strategy**:

For small models (all-MiniLM-L6-v2, 22M params), CPU is consistently faster due to CPU↔GPU data transfer overhead exceeding compute savings. GPU only wins for models >100M params or batch sizes >500.

### Model Configuration

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_MODEL` | `Xenova/multilingual-e5-small` | Default multilingual model |
| `dimension` | `384` | Vector dimensions |
| `maxTokens` | `512` | Maximum token length |

### RRF Fusion Parameters

Maestro uses RRF (Reciprocal Rank Fusion) to merge BM25 and vector search results:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `k` | `60` | RRF constant (controls rank decay speed) |
| `bm25Weight` | `0.6` | BM25 weight |
| `vectorWeight` | `0.4` | Vector search weight |
| `alpha` | `0.4` | RRF weight in hybrid fusion |

---

## Usage

### Basic Search

```bash
# Automatically use embedding (if available)
maestro search "authentication patterns"

# Explicitly skip embedding (BM25 only)
maestro search "jwt token" --no-emb
```

### Embedding Management

```bash
# View status
maestro embedding status

# Warm up model
maestro embedding warmup

# Rebuild index
maestro embedding rebuild
```

---

## Index Structure

### Binary Format

Embedding index uses efficient binary format (`embedding-index.bin`):

```
[metaLen:4][metaJSON][docIdsLen:4][docIdsJSON][vectors:n*dim*4]
```

- **meta**: Model ID, dimension, build time, device info
- **docIds**: Document ID array
- **vectors**: Float32 vector array

### Incremental Updates

Index supports incremental updates, only re-embedding documents with content changes:

1. Compute MD5 hash of document content
2. Compare with existing index hashes
3. Only regenerate vectors for changed documents
4. Preserve vectors for unchanged documents

---

## Performance Optimization

### Cold Start Optimization

| Scenario | Time | Description |
|----------|------|-------------|
| First load (no daemon) | ~1800ms | ONNX model loading |
| Daemon hot path | ~280ms | Model cached |
| BM25-only fallback | ~280ms | Skip embedding |

### Search Daemon

Search daemon keeps embedding model hot-cached:

```bash
# Start daemon
maestro search-daemon start

# View status
maestro search-daemon status
```

Daemon auto-shuts down after 30 minutes of idle.

### Automatic Fallback Strategy

When daemon is unavailable:
1. Automatically falls back to BM25-only mode
2. Spawns daemon in background
3. Subsequent searches get embedding acceleration

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HTTPS_PROXY` | HTTPS proxy (for model download) |
| `HTTP_PROXY` | HTTP proxy |
| `ALL_PROXY` | General proxy |

---

## Troubleshooting

### Model Unavailable

```bash
# Check status
maestro embedding status

# Common causes:
# 1. @huggingface/transformers not installed
# 2. onnxruntime-node not installed
# 3. Network issues (cannot download model)
```

### Index Corrupted

```bash
# Rebuild index
maestro embedding rebuild
```

### Performance Issues

```bash
# View device info
maestro embedding status

# If GPU available but not used, check onnxruntime-node version
npm list onnxruntime-node
```

---

## Related Commands

```bash
# Search commands
maestro search <query> [--no-emb] [--json]

# Embedding management
maestro embedding status
maestro embedding warmup
maestro embedding rebuild

# Search Daemon
maestro search-daemon start
maestro search-daemon stop
maestro search-daemon status
```

---

## Technical Details

### E5 Model Prefixes

E5 models require specific prefixes:
- Query: `query: <text>`
- Document: `passage: <text>`

The system automatically adds these prefixes, no manual handling needed.

### Cosine Similarity

Vector search uses cosine similarity:

```typescript
cosineSimilarity(a, b) = dot(a, b) / (norm(a) * norm(b))
```

For <10K documents, brute-force search (flat search) meets performance requirements.

### Hybrid Fusion Algorithm

Final score calculation:

```
finalScore = alpha * rrfNorm + (1 - alpha) * bm25Norm
```

- `rrfNorm`: Normalized RRF score
- `bm25Norm`: Normalized BM25 score
- `alpha`: Controls relative weight of RRF and BM25
