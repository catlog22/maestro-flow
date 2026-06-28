// src/graph/kg/embedding/code-embedding.ts — Code embedding: structured text + vector index + search
// 参考: dashboard/src/server/wiki/embedding.ts (embedTexts, cosineSimilarity, binary persistence)

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { UnifiedNode, UnifiedNodeKind } from '../db/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeEmbeddingIndex {
  modelId: string;
  dimension: number;
  nodeIds: string[];        // parallel to vectors — node IDs
  vectors: Float32Array[];
  contentHashes?: string[]; // for incremental rebuild
  builtAt: number;
  buildTimeMs?: number;
  normalized?: boolean;            // true when vectors are L2-normalized
  flatMatrixBuffer?: Float32Array; // contiguous buffer: n * dim floats
}

export interface VectorSearchResult {
  nodeId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Embeddable kinds — node kinds worth embedding
// ---------------------------------------------------------------------------

export const EMBEDDABLE_KINDS: ReadonlySet<UnifiedNodeKind> = new Set<UnifiedNodeKind>([
  'function', 'method', 'class', 'interface', 'component', 'route',
  'struct', 'trait', 'protocol', 'type_alias',
]);

// ---------------------------------------------------------------------------
// Lazy import of wiki embedding module
// ---------------------------------------------------------------------------

async function getEmbedding() {
  return import('#maestro-dashboard/wiki/embedding.js');
}

// ---------------------------------------------------------------------------
// Node → structured text
// ---------------------------------------------------------------------------

/**
 * Convert a UnifiedNode into structured text suitable for embedding.
 * Fields are separated by newlines with labeled prefixes for better retrieval.
 * Adds 'passage: ' prefix when using local model (non-API mode).
 */
export function nodeToEmbeddingText(node: UnifiedNode, apiMode?: boolean): string {
  const parts = [
    `path: ${node.filePath}`,
    `kind: ${node.kind}`,
    `language: ${node.language}`,
    `symbol: ${node.qualifiedName || node.name}`,
    `exported: ${node.isExported}`,
  ];
  if (node.decorators.length > 0) parts.push(`decorators: ${node.decorators.join(', ')}`);
  if (node.keywords.length > 0) parts.push(`keywords: ${node.keywords.join(', ')}`);
  parts.push(
    `docstring: ${node.docstring || ''}`,
    `signature: ${node.signature || ''}`,
    `code: ${node.definition.slice(0, 500)}`,
  );
  const text = parts.join('\n');
  if (apiMode === undefined) {
    return text;
  }
  return apiMode ? text : 'passage: ' + text;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Returns true if the node kind is worth embedding and it originates from codegraph.
 */
export function isEmbeddable(node: UnifiedNode): boolean {
  return EMBEDDABLE_KINDS.has(node.kind) && node.sourceType === 'codegraph';
}

// ---------------------------------------------------------------------------
// Content hashing (for incremental rebuild)
// ---------------------------------------------------------------------------

function hashNodeContent(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Vector math helpers
// ---------------------------------------------------------------------------

function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function buildFlatMatrix(vectors: Float32Array[], dim: number): Float32Array {
  const flat = new Float32Array(vectors.length * dim);
  for (let i = 0; i < vectors.length; i++) flat.set(vectors[i], i * dim);
  return flat;
}

// ---------------------------------------------------------------------------
// Parallel embedding constants
// ---------------------------------------------------------------------------

const PARALLEL_CHUNK_SIZE = 200;
const MAX_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Build embedding index
// ---------------------------------------------------------------------------

/**
 * Embed texts in parallel chunks with bounded concurrency.
 */
async function embedTextsParallel(
  texts: string[],
  embedFn: (texts: string[]) => Promise<Float32Array[]>,
): Promise<Float32Array[]> {
  if (texts.length <= PARALLEL_CHUNK_SIZE) return embedFn(texts);

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += PARALLEL_CHUNK_SIZE) {
    chunks.push(texts.slice(i, i + PARALLEL_CHUNK_SIZE));
  }

  const results: Float32Array[][] = new Array(chunks.length);
  for (let start = 0; start < chunks.length; start += MAX_CONCURRENCY) {
    const batch = chunks.slice(start, start + MAX_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(c => embedFn(c)));
    for (let j = 0; j < batchResults.length; j++) {
      results[start + j] = batchResults[j];
    }
  }

  const flat: Float32Array[] = [];
  for (const r of results) flat.push(...r);
  return flat;
}

/**
 * Build a code embedding index from UnifiedNode[].
 * Supports incremental rebuild: if `existing` is provided, only re-embeds
 * nodes whose content hash has changed.
 */
export async function buildCodeEmbeddingIndex(
  nodes: UnifiedNode[],
  existing?: CodeEmbeddingIndex | null,
): Promise<CodeEmbeddingIndex> {
  const t0 = Date.now();
  const { embedTexts, isApiMode, getModelId } = await getEmbedding();
  const apiMode = isApiMode();
  const activeModel = getModelId();

  const embeddable = nodes.filter(isEmbeddable);

  const texts = embeddable.map(n => nodeToEmbeddingText(n, apiMode));
  const hashes = texts.map(hashNodeContent);
  const nodeIds = embeddable.map(n => n.id);

  let vectors: Float32Array[];

  const canIncremental = existing && existing.modelId === activeModel
    && existing.nodeIds.length > 0 && existing.contentHashes;
  if (canIncremental) {
    const ex = existing!;
    const exHashes = ex.contentHashes!;
    const existingHashMap = new Map<string, { hash: string; vector: Float32Array }>();
    for (let i = 0; i < ex.nodeIds.length; i++) {
      if (exHashes[i]) {
        existingHashMap.set(ex.nodeIds[i], {
          hash: exHashes[i],
          vector: ex.vectors[i],
        });
      }
    }

    vectors = new Array(nodeIds.length);
    const toEmbed: Array<{ slot: number; text: string }> = [];

    for (let i = 0; i < nodeIds.length; i++) {
      const cached = existingHashMap.get(nodeIds[i]);
      if (cached && cached.hash === hashes[i]) {
        vectors[i] = cached.vector;
      } else {
        toEmbed.push({ slot: i, text: texts[i] });
      }
    }

    if (toEmbed.length > 0) {
      const newVectors = await embedTextsParallel(
        toEmbed.map(e => e.text),
        embedTexts,
      );
      for (let j = 0; j < toEmbed.length; j++) {
        vectors[toEmbed[j].slot] = newVectors[j];
      }
    }
  } else {
    vectors = texts.length > 0 ? await embedTextsParallel(texts, embedTexts) : [];
  }

  // Pre-normalize all vectors for fast dot-product search
  for (let i = 0; i < vectors.length; i++) vectors[i] = normalizeVector(vectors[i]);

  const dim = vectors[0]?.length ?? 384;
  return {
    modelId: activeModel,
    dimension: dim,
    nodeIds,
    vectors,
    contentHashes: hashes,
    builtAt: Date.now(),
    buildTimeMs: Date.now() - t0,
    normalized: true,
    flatMatrixBuffer: vectors.length > 0 ? buildFlatMatrix(vectors, dim) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Cosine similarity (flat scan)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

/**
 * Vector search over the code embedding index.
 * Uses dot product on pre-normalized vectors when available, falls back to cosine.
 */
export function searchCodeVectors(
  queryVec: Float32Array,
  index: CodeEmbeddingIndex,
  limit: number,
): VectorSearchResult[] {
  const n = index.nodeIds.length;
  const scored: VectorSearchResult[] = [];

  if (index.normalized && index.flatMatrixBuffer) {
    const q = normalizeVector(queryVec);
    const dim = index.dimension;
    const flat = index.flatMatrixBuffer;
    for (let i = 0; i < n; i++) {
      const off = i * dim;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += q[j] * flat[off + j];
      if (dot > 0) scored.push({ nodeId: index.nodeIds[i], score: dot });
    }
  } else if (index.normalized) {
    const q = normalizeVector(queryVec);
    for (let i = 0; i < n; i++) {
      const sim = dotProduct(q, index.vectors[i]);
      if (sim > 0) scored.push({ nodeId: index.nodeIds[i], score: sim });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const sim = cosineSimilarity(queryVec, index.vectors[i]);
      if (sim > 0) scored.push({ nodeId: index.nodeIds[i], score: sim });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Persistence — binary format
// Format: [metaLen:4][metaJSON][packedVectors: n*dim*4]
// metaJSON contains: modelId, dimension, nodeIds, contentHashes, builtAt, buildTimeMs
// ---------------------------------------------------------------------------

const BINARY_FILE = 'code-embedding-index.bin';

/**
 * Save a CodeEmbeddingIndex to disk in binary format.
 */
export function saveCodeEmbeddingIndex(index: CodeEmbeddingIndex, dir: string): void {
  mkdirSync(dir, { recursive: true });

  const dim = index.dimension;
  const n = index.nodeIds.length;

  const metaJson = JSON.stringify({
    modelId: index.modelId,
    dimension: dim,
    nodeIds: index.nodeIds,
    contentHashes: index.contentHashes,
    builtAt: index.builtAt,
    buildTimeMs: index.buildTimeMs,
    normalized: index.normalized ?? false,
  });
  const metaBytes = Buffer.from(metaJson, 'utf-8');

  // Format: [metaLen:4][meta][packedVectors: n*dim*4]
  const vectorBytes = n * dim * 4;
  const totalSize = 4 + metaBytes.length + vectorBytes;
  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  buf.writeUInt32LE(metaBytes.length, offset); offset += 4;
  metaBytes.copy(buf, offset); offset += metaBytes.length;

  for (let i = 0; i < n; i++) {
    const v = index.vectors[i];
    const vBuf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    vBuf.copy(buf, offset);
    offset += dim * 4;
  }

  const tmpPath = join(dir, BINARY_FILE + '.tmp');
  writeFileSync(tmpPath, buf);
  renameSync(tmpPath, join(dir, BINARY_FILE));
}

/**
 * Load a CodeEmbeddingIndex from disk. Returns null if file doesn't exist.
 */
export function loadCodeEmbeddingIndex(dir: string): CodeEmbeddingIndex | null {
  const filePath = join(dir, BINARY_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath);
    let offset = 0;

    const metaLen = raw.readUInt32LE(offset); offset += 4;
    const meta = JSON.parse(raw.subarray(offset, offset + metaLen).toString('utf-8')) as {
      modelId: string;
      dimension: number;
      nodeIds: string[];
      contentHashes?: string[];
      builtAt: number;
      buildTimeMs?: number;
      normalized?: boolean;
    };
    offset += metaLen;

    const dim = meta.dimension;
    const n = meta.nodeIds.length;
    const vecBytes = n * dim * 4;
    const vecStart = raw.byteOffset + offset;
    const vectors: Float32Array[] = new Array(n);

    if (vecStart % 4 === 0) {
      const allFloats = new Float32Array(raw.buffer, vecStart, n * dim);
      for (let i = 0; i < n; i++) vectors[i] = allFloats.subarray(i * dim, (i + 1) * dim);
    } else {
      const aligned = new ArrayBuffer(vecBytes);
      new Uint8Array(aligned).set(raw.subarray(offset, offset + vecBytes));
      const allFloats = new Float32Array(aligned);
      for (let i = 0; i < n; i++) vectors[i] = allFloats.subarray(i * dim, (i + 1) * dim);
    }

    const isNormalized = meta.normalized ?? false;
    return {
      modelId: meta.modelId,
      dimension: dim,
      nodeIds: meta.nodeIds,
      vectors,
      contentHashes: meta.contentHashes,
      builtAt: meta.builtAt,
      buildTimeMs: meta.buildTimeMs,
      normalized: isNormalized,
      flatMatrixBuffer: isNormalized && n > 0 ? buildFlatMatrix(vectors, dim) : undefined,
    };
  } catch {
    return null;
  }
}
