/**
 * Embedding-based semantic search using @huggingface/transformers (ONNX backend).
 *
 * Features:
 * - Smart device detection: auto-benchmarks CPU vs GPU (DirectML), picks fastest
 * - Batch inference: processes documents in configurable batch sizes (4-5x faster)
 * - Incremental indexing: only re-embeds new or changed documents
 * - Graceful degradation: falls back to pure BM25 when transformers is unavailable
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingIndex {
  modelId: string;
  dimension: number;
  docIds: string[];
  vectors: Float32Array[];
  contentHashes?: string[];
  builtAt: number;
  deviceUsed?: string;
  buildTimeMs?: number;
}

export interface VectorSearchResult {
  docId: string;
  score: number;
}

export type DeviceType = 'cpu' | 'gpu';
export type DtypeType = 'fp32' | 'fp16' | 'q8' | 'q4';

export interface DeviceConfig {
  device: DeviceType;
  dtype: DtypeType;
  batchSize: number;
}

// ---------------------------------------------------------------------------
// External embedding API configuration (~/.maestro/api-embedding.json)
// ---------------------------------------------------------------------------

export interface EmbeddingApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
  /** Model context window in tokens. Used for dynamic batch sizing. Default: 8192. */
  contextLength?: number;
  /** Fixed batch size (number of texts). Overrides dynamic batching when set. */
  batchSize?: number;
  concurrency?: number;
}

const API_CONFIG_PATH = join(homedir(), '.maestro', 'api-embedding.json');

let _apiConfig: EmbeddingApiConfig | null | undefined;

export function loadEmbeddingApiConfig(): EmbeddingApiConfig | null {
  if (_apiConfig !== undefined) return _apiConfig;
  if (!existsSync(API_CONFIG_PATH)) {
    _apiConfig = null;
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(API_CONFIG_PATH, 'utf-8')) as EmbeddingApiConfig;
    if (raw.baseUrl && raw.apiKey && raw.model) {
      _apiConfig = raw;
      return raw;
    }
    _apiConfig = null;
    return null;
  } catch {
    _apiConfig = null;
    return null;
  }
}

export function isApiMode(): boolean {
  return loadEmbeddingApiConfig() !== null;
}

function getApiProxy(): string | undefined {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxy) return proxy;
  const cliToolsPath = join(homedir(), '.maestro', 'cli-tools.json');
  if (!existsSync(cliToolsPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(cliToolsPath, 'utf-8')) as { proxy?: { enabled?: boolean; httpProxy?: string } };
    if (raw.proxy?.enabled && raw.proxy.httpProxy) return raw.proxy.httpProxy;
  } catch { /* ignore */ }
  return undefined;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
let _cachedFetcher: FetchFn | null = null;

async function getFetcher(): Promise<FetchFn> {
  if (_cachedFetcher) return _cachedFetcher;
  const proxy = getApiProxy();
  if (!proxy) {
    _cachedFetcher = (u, init) => globalThis.fetch(u, init);
    return _cachedFetcher;
  }
  try {
    const undici = await import('undici');
    const dispatcher = new undici.ProxyAgent({ uri: proxy });
    _cachedFetcher = (u, init) => undici.fetch(u, { ...init, dispatcher } as any) as unknown as Promise<Response>;
  } catch {
    _cachedFetcher = (u, init) => globalThis.fetch(u, init);
  }
  return _cachedFetcher;
}

const MAX_RETRIES = 2;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

async function fetchBatchWithRetry(
  doFetch: FetchFn, url: string, batch: string[], batchOffset: number, config: EmbeddingApiConfig,
): Promise<Float32Array[]> {
  const body: Record<string, unknown> = { model: config.model, input: batch, encoding_format: 'float' };
  if (config.dimensions) body.dimensions = config.dimensions;
  const reqInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  };

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 4000)));
    try {
      const resp = await doFetch(url, reqInit);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        if (RETRY_STATUS.has(resp.status) && attempt < MAX_RETRIES) { lastErr = new Error(`Embedding API error ${resp.status}: ${errText}`); continue; }
        throw new Error(`Embedding API error ${resp.status}: ${errText}`);
      }
      const json = await resp.json() as { data?: unknown };
      if (!Array.isArray(json.data)) throw new Error(`Embedding API returned invalid data: missing "data" array`);

      const out = new Array<Float32Array>(batch.length);
      for (const item of json.data as Array<{ embedding?: number[]; index?: number }>) {
        if (!Array.isArray(item.embedding) || typeof item.index !== 'number') continue;
        out[item.index] = new Float32Array(item.embedding);
      }
      for (let j = 0; j < batch.length; j++) {
        if (!out[j]) throw new Error(`Embedding API returned no vector for input index ${j} in batch starting at ${batchOffset}`);
      }
      return out;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const isNetwork = lastErr.message.includes('fetch failed') || lastErr.message.includes('ECONNREFUSED') || lastErr.message.includes('Timeout');
      if (isNetwork && attempt < MAX_RETRIES) continue;
      throw lastErr;
    }
  }
  throw lastErr!;
}

const DEFAULT_API_CONCURRENCY = 4;
const DEFAULT_CONTEXT_LENGTH = 8192;
const MAX_TEXTS_PER_REQUEST = 256;

function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
  }
  return Math.ceil(ascii / 4 + (text.length - ascii) / 1.5);
}

function buildChunks(texts: string[], config: EmbeddingApiConfig): { offset: number; batch: string[] }[] {
  if (config.batchSize) {
    const chunks: { offset: number; batch: string[] }[] = [];
    for (let i = 0; i < texts.length; i += config.batchSize) {
      chunks.push({ offset: i, batch: texts.slice(i, i + config.batchSize) });
    }
    return chunks;
  }

  const ctxLen = config.contextLength ?? DEFAULT_CONTEXT_LENGTH;
  const maxBatchTokens = ctxLen * 0.9;
  const chunks: { offset: number; batch: string[] }[] = [];
  let batchStart = 0;
  let batchTokens = 0;
  let batchCount = 0;
  for (let i = 0; i < texts.length; i++) {
    const t = estimateTokens(texts[i]);
    if ((batchTokens + t > maxBatchTokens || batchCount >= MAX_TEXTS_PER_REQUEST) && i > batchStart) {
      chunks.push({ offset: batchStart, batch: texts.slice(batchStart, i) });
      batchStart = i;
      batchTokens = 0;
      batchCount = 0;
    }
    batchTokens += t;
    batchCount++;
  }
  if (batchStart < texts.length) {
    chunks.push({ offset: batchStart, batch: texts.slice(batchStart) });
  }
  return chunks;
}

async function callEmbeddingApi(texts: string[], config: EmbeddingApiConfig): Promise<Float32Array[]> {
  const doFetch = await getFetcher();
  const url = config.baseUrl.replace(/\/+$/, '') + '/embeddings';
  const concurrency = config.concurrency ?? DEFAULT_API_CONCURRENCY;

  const chunks = buildChunks(texts, config);

  const results: Float32Array[] = new Array(texts.length);

  let firstErr: Error | null = null;
  for (let w = 0; w < chunks.length; w += concurrency) {
    const window = chunks.slice(w, w + concurrency);
    const settled = await Promise.allSettled(
      window.map(c => fetchBatchWithRetry(doFetch, url, c.batch, c.offset, config)),
    );
    for (let ci = 0; ci < window.length; ci++) {
      const s = settled[ci];
      if (s.status === 'fulfilled') {
        for (let j = 0; j < s.value.length; j++) results[window[ci].offset + j] = s.value[j];
      } else if (!firstErr) {
        firstErr = s.reason instanceof Error ? s.reason : new Error(String(s.reason));
      }
    }
  }

  if (firstErr) {
    const filled = results.filter(Boolean).length;
    if (filled === 0) throw firstErr;
    if (filled < texts.length) throw firstErr;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Cosine similarity (flat search — fast enough for <10K docs)
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
// RRF (Reciprocal Rank Fusion) — merges BM25 and vector results
// ---------------------------------------------------------------------------

export interface RankedResult {
  docId: string;
  score: number;
}

export interface RRFSignal {
  name: string;
  weight: number;
  results: RankedResult[];
}

export function mergeRRFSignals(
  signals: RRFSignal[],
  limit: number,
  k = 60,
): RankedResult[] {
  const scores = new Map<string, number>();
  for (const { weight, results } of signals) {
    for (let i = 0; i < results.length; i++) {
      const rrf = weight / (k + i + 1);
      scores.set(results[i].docId, (scores.get(results[i].docId) ?? 0) + rrf);
    }
  }
  const merged: RankedResult[] = [];
  for (const [docId, score] of scores) merged.push({ docId, score });
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}

/**
 * Hybrid fusion: RRF for ordering stability + BM25 magnitude for score discrimination.
 * finalScore = alpha * rrfNorm + (1-alpha) * bm25Norm
 */
export function mergeHybrid(
  bm25Results: RankedResult[],
  vectorResults: RankedResult[],
  limit: number,
  options?: { k?: number; alpha?: number; bm25Weight?: number; vectorWeight?: number },
): RankedResult[] {
  const k = options?.k ?? 10;
  const alpha = options?.alpha ?? 0.4;
  const bm25W = options?.bm25Weight ?? 0.6;
  const vectorW = options?.vectorWeight ?? 0.4;

  const rrfResults = mergeRRFSignals([
    { name: 'bm25', weight: bm25W, results: bm25Results },
    { name: 'vector', weight: vectorW, results: vectorResults },
  ], limit * 3, k);

  const maxRrf = rrfResults.length > 0 ? rrfResults[0].score : 1;
  const rrfNorm = new Map(rrfResults.map(r => [r.docId, maxRrf > 0 ? r.score / maxRrf : 0]));

  const maxBm25 = bm25Results.length > 0 ? bm25Results[0].score : 1;
  const bm25Norm = new Map(bm25Results.map(r => [r.docId, maxBm25 > 0 ? r.score / maxBm25 : 0]));

  const merged: RankedResult[] = [];
  const seen = new Set<string>();
  for (const r of rrfResults) {
    if (seen.has(r.docId)) continue;
    seen.add(r.docId);
    const rn = rrfNorm.get(r.docId) ?? 0;
    const bn = bm25Norm.get(r.docId) ?? 0;
    merged.push({ docId: r.docId, score: alpha * rn + (1 - alpha) * bn });
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Smart device detection — micro-benchmark to pick fastest backend
// ---------------------------------------------------------------------------

interface BackendInfo {
  name: string;
  bundled: boolean;
}

let _detectedConfig: DeviceConfig | null = null;

async function listBackends(): Promise<BackendInfo[]> {
  try {
    const ort = await import('onnxruntime-node');
    if (typeof ort.listSupportedBackends === 'function') {
      return ort.listSupportedBackends() as BackendInfo[];
    }
  } catch { /* onnxruntime-node not available */ }
  return [{ name: 'cpu', bundled: true }];
}

export async function detectDevice(): Promise<DeviceConfig> {
  if (_detectedConfig) return _detectedConfig;

  const backends = await listBackends();
  const hasGpu = backends.some(b => b.name === 'dml' || b.name === 'cuda');

  // For small models (all-MiniLM-L6-v2, 22M params), CPU is consistently faster
  // due to CPU↔GPU data transfer overhead exceeding compute savings.
  // GPU only wins for models >100M params or batch sizes >500.
  _detectedConfig = {
    device: 'cpu',
    dtype: 'fp32',
    batchSize: 32,
  };

  if (hasGpu) {
    // Store GPU availability for future large-model support
    _detectedConfig.batchSize = 64;
  }

  return _detectedConfig;
}

export function getDeviceSummary(): string {
  if (isApiMode()) return 'api (external)';
  if (!_detectedConfig) return 'not initialized';
  return `${_detectedConfig.device}/${_detectedConfig.dtype} batch=${_detectedConfig.batchSize}`;
}

// ---------------------------------------------------------------------------
// Hardware info — reports what's available without benchmarking
// ---------------------------------------------------------------------------

export interface HardwareInfo {
  backends: BackendInfo[];
  gpuAvailable: boolean;
  selectedDevice: DeviceConfig;
  reason: string;
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const backends = await listBackends();
  const hasGpu = backends.some(b => b.name === 'dml' || b.name === 'cuda');
  const config = await detectDevice();

  return {
    backends,
    gpuAvailable: hasGpu,
    selectedDevice: config,
    reason: hasGpu
      ? 'GPU available (DML/CUDA) but CPU selected — small model (22M params) runs faster on CPU due to transfer overhead'
      : 'CPU only — no GPU backend detected',
  };
}

// ---------------------------------------------------------------------------
// Pipeline management — lazy-loads model with detected device
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_MODEL = 'Xenova/multilingual-e5-small';
export function getModelId(): string {
  const apiConf = loadEmbeddingApiConfig();
  return apiConf ? apiConf.model : DEFAULT_LOCAL_MODEL;
}
export const DEFAULT_MODEL_ID = DEFAULT_LOCAL_MODEL;
const CACHE_FILE = 'embedding-index.json';

let _pipeline: any = null;
let _available: boolean | null = null;

async function configureProxy(): Promise<void> {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (!proxy) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent({ uri: proxy }));
  } catch { /* undici not available */ }
}

async function loadTransformers(): Promise<{ pipeline: any }> {
  return await import('@huggingface/transformers');
}

export type ModelProgressCallback = (info: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => void;

let _progressCallback: ModelProgressCallback | null = null;

export function setProgressCallback(cb: ModelProgressCallback | null): void {
  _progressCallback = cb;
}

async function getPipeline(): Promise<any> {
  if (_pipeline) return _pipeline;

  await configureProxy();
  const config = await detectDevice();
  const { pipeline } = await loadTransformers();
  _pipeline = await pipeline('feature-extraction', DEFAULT_LOCAL_MODEL, {
    dtype: config.dtype,
    device: config.device,
    progress_callback: _progressCallback ?? undefined,
  });
  _progressCallback = null;
  return _pipeline;
}

let _unavailableReason: string | null = null;

export async function isAvailable(): Promise<boolean> {
  if (isApiMode()) {
    _available = true;
    return true;
  }
  if (_available !== null) return _available;
  try {
    await loadTransformers();
    _available = true;
  } catch (e: unknown) {
    _available = false;
    _unavailableReason = e instanceof Error ? e.message : String(e);
  }
  return _available;
}

export function getUnavailableReason(): string | null {
  return _unavailableReason;
}

// ---------------------------------------------------------------------------
// Batch embedding — processes texts in configurable batch sizes
// ---------------------------------------------------------------------------

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const apiConf = loadEmbeddingApiConfig();
  if (apiConf) {
    return callEmbeddingApi(texts.map(t => t.slice(0, 8192)), apiConf);
  }

  const pipe = await getPipeline();
  const config = await detectDevice();
  const batchSize = config.batchSize;
  const results: Float32Array[] = [];

  const truncated = texts.map(t => t.slice(0, 512));

  for (let i = 0; i < truncated.length; i += batchSize) {
    const batch = truncated.slice(i, i + batchSize);
    const output = await pipe(batch, { pooling: 'mean', normalize: true });

    if (batch.length === 1) {
      results.push(new Float32Array(output.data));
    } else {
      const dim = output.dims[1];
      for (let j = 0; j < batch.length; j++) {
        const start = j * dim;
        results.push(new Float32Array(output.data.slice(start, start + dim)));
      }
    }
  }

  return results;
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const apiConf = loadEmbeddingApiConfig();
  if (apiConf) {
    const [vec] = await callEmbeddingApi([query.slice(0, 8192)], apiConf);
    return vec;
  }

  const pipe = await getPipeline();
  const output = await pipe(('query: ' + query).slice(0, 512), { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

// ---------------------------------------------------------------------------
// Vector search (flat cosine — no index structure needed for <10K docs)
// ---------------------------------------------------------------------------

export function vectorSearch(
  queryVector: Float32Array,
  index: EmbeddingIndex,
  limit: number,
): VectorSearchResult[] {
  const scored: VectorSearchResult[] = [];
  for (let i = 0; i < index.docIds.length; i++) {
    const sim = cosineSimilarity(queryVector, index.vectors[i]);
    if (sim > 0) scored.push({ docId: index.docIds[i], score: sim });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Persistence — SQLite binary BLOB (primary) with JSON fallback for migration
// ---------------------------------------------------------------------------

const SQLITE_FILE = 'embedding-index.db';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

const BINARY_FILE = 'embedding-index.bin';

export function saveEmbeddingIndex(index: EmbeddingIndex, dir: string): void {
  mkdirSync(dir, { recursive: true });

  const dim = index.dimension;
  const n = index.docIds.length;
  const docIdsJson = JSON.stringify(index.docIds);
  const docIdsBytes = Buffer.from(docIdsJson, 'utf-8');
  const metaJson = JSON.stringify({
    modelId: index.modelId,
    dimension: dim,
    count: n,
    builtAt: index.builtAt,
    deviceUsed: index.deviceUsed,
    buildTimeMs: index.buildTimeMs,
    contentHashes: index.contentHashes,
  });
  const metaBytes = Buffer.from(metaJson, 'utf-8');

  // Format: [metaLen:4][meta][docIdsLen:4][docIds][packedVectors:n*dim*4]
  const vectorBytes = n * dim * 4;
  const totalSize = 4 + metaBytes.length + 4 + docIdsBytes.length + vectorBytes;
  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  buf.writeUInt32LE(metaBytes.length, offset); offset += 4;
  metaBytes.copy(buf, offset); offset += metaBytes.length;
  buf.writeUInt32LE(docIdsBytes.length, offset); offset += 4;
  docIdsBytes.copy(buf, offset); offset += docIdsBytes.length;

  for (let i = 0; i < n; i++) {
    const v = index.vectors[i];
    const vBuf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    vBuf.copy(buf, offset);
    offset += dim * 4;
  }

  const tmpPath = join(dir, BINARY_FILE + '.tmp');
  writeFileSync(tmpPath, buf);
  renameSync(tmpPath, join(dir, BINARY_FILE));

  // Remove legacy files
  for (const f of [CACHE_FILE, SQLITE_FILE, SQLITE_FILE + '-shm', SQLITE_FILE + '-wal', SQLITE_FILE + '-journal']) {
    try { if (existsSync(join(dir, f))) unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
}

export function loadEmbeddingIndex(dir: string): EmbeddingIndex | null {
  // Primary: packed binary
  const binPath = join(dir, BINARY_FILE);
  if (existsSync(binPath)) {
    try {
      return loadFromBinary(binPath);
    } catch (e: unknown) {
      if (process.env.DEBUG || process.env.MAESTRO_DEBUG) {
        console.warn(`[embedding] binary index corrupted, will rebuild: ${e instanceof Error ? e.message : e}`);
      }
      return null;
    }
  }

  // Legacy: SQLite → migrate to binary
  const dbPath = join(dir, SQLITE_FILE);
  if (existsSync(dbPath)) {
    try {
      const idx = loadFromSqlite(dir);
      saveEmbeddingIndex(idx, dir);
      return idx;
    } catch { /* fall through */ }
  }

  // Legacy: JSON → migrate to binary
  const jsonPath = join(dir, CACHE_FILE);
  if (existsSync(jsonPath)) {
    try {
      const idx = loadFromLegacyJson(jsonPath);
      saveEmbeddingIndex(idx, dir);
      return idx;
    } catch { return null; }
  }

  return null;
}

function loadFromBinary(filePath: string): EmbeddingIndex {
  const raw = readFileSync(filePath);
  let offset = 0;

  const metaLen = raw.readUInt32LE(offset); offset += 4;
  const meta = JSON.parse(raw.subarray(offset, offset + metaLen).toString('utf-8'));
  offset += metaLen;

  const docIdsLen = raw.readUInt32LE(offset); offset += 4;
  const docIds: string[] = JSON.parse(raw.subarray(offset, offset + docIdsLen).toString('utf-8'));
  offset += docIdsLen;

  const dim = meta.dimension;
  const n = meta.count;
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

  return {
    modelId: meta.modelId,
    dimension: dim,
    docIds,
    vectors,
    contentHashes: meta.contentHashes,
    builtAt: meta.builtAt,
    deviceUsed: meta.deviceUsed,
    buildTimeMs: meta.buildTimeMs,
  };
}

function loadFromSqlite(dir: string): EmbeddingIndex {
  const Database = _require('better-sqlite3');
  const dbPath = join(dir, SQLITE_FILE);
  const db = new Database(dbPath, { readonly: true });
  try {
    const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
    const modelId = getMeta.get('modelId')?.value ?? 'unknown';
    const dimension = parseInt(getMeta.get('dimension')?.value ?? '384', 10);
    const builtAt = parseInt(getMeta.get('builtAt')?.value ?? '0', 10);
    const deviceUsed = getMeta.get('deviceUsed')?.value;
    const buildTimeMs = parseInt(getMeta.get('buildTimeMs')?.value ?? '0', 10) || undefined;

    const rows = db.prepare('SELECT doc_id, vector FROM vectors ORDER BY rowid').all() as Array<{ doc_id: string; vector: Buffer }>;
    const docIds: string[] = [];
    const vectors: Float32Array[] = [];
    for (const row of rows) {
      docIds.push(row.doc_id);
      const ab = row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength);
      vectors.push(new Float32Array(ab));
    }
    return { modelId, dimension, docIds, vectors, builtAt, deviceUsed, buildTimeMs };
  } finally {
    db.close();
  }
}

function loadFromLegacyJson(filePath: string): EmbeddingIndex {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return {
    modelId: raw.modelId,
    dimension: raw.dimension,
    docIds: raw.docIds,
    vectors: raw.vectors.map((b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return new Float32Array(ab);
    }),
    builtAt: raw.builtAt,
    deviceUsed: raw.deviceUsed,
    buildTimeMs: raw.buildTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Incremental index building — only re-embeds new or changed documents
// ---------------------------------------------------------------------------

export interface DocForEmbedding {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  body?: string;
}

export function hashDocContent(d: DocForEmbedding): string {
  const text = [d.title, d.summary, d.tags.join(','), d.body?.slice(0, 500) ?? ''].join('|');
  return createHash('md5').update(text).digest('hex');
}

function docToText(d: DocForEmbedding): string {
  const parts = [d.title];
  if (d.summary) parts.push(d.summary);
  if (d.tags.length > 0) parts.push(d.tags.join(' '));
  if (d.body) parts.push(d.body.slice(0, 500));
  const text = parts.join('. ');
  return isApiMode() ? text : 'passage: ' + text;
}

export async function buildEmbeddingIndex(
  docs: DocForEmbedding[],
  existingIndex?: EmbeddingIndex | null,
  precomputedHashes?: string[],
): Promise<EmbeddingIndex> {
  const apiMode = isApiMode();
  const config = apiMode ? null : await detectDevice();
  const t0 = Date.now();

  const currentHashes = precomputedHashes ?? docs.map(hashDocContent);
  let vectors: Float32Array[];

  const activeModel = getModelId();
  // Model changed → discard all cached vectors, force full rebuild
  const modelMatch = existingIndex && existingIndex.modelId === activeModel;
  if (modelMatch && existingIndex!.docIds.length > 0) {
    // Incremental: reuse vectors only for docs with matching content hash
    const existingMap = new Map<string, { vector: Float32Array; hash: string }>();
    for (let i = 0; i < existingIndex!.docIds.length; i++) {
      existingMap.set(existingIndex!.docIds[i], {
        vector: existingIndex!.vectors[i],
        hash: existingIndex!.contentHashes?.[i] ?? '',
      });
    }

    const changedDocs: { index: number; doc: DocForEmbedding }[] = [];
    vectors = new Array(docs.length);

    for (let i = 0; i < docs.length; i++) {
      const cached = existingMap.get(docs[i].id);
      if (cached && cached.hash && cached.hash === currentHashes[i]) {
        vectors[i] = cached.vector;
      } else {
        changedDocs.push({ index: i, doc: docs[i] });
      }
    }

    if (changedDocs.length > 0) {
      const texts = changedDocs.map(nd => docToText(nd.doc));
      const newVectors = await embedTexts(texts);
      for (let j = 0; j < changedDocs.length; j++) {
        vectors[changedDocs[j].index] = newVectors[j];
      }
    }
  } else {
    // Full rebuild
    const texts = docs.map(docToText);
    vectors = await embedTexts(texts);
  }

  return {
    modelId: activeModel,
    dimension: vectors[0]?.length ?? 384,
    docIds: docs.map(d => d.id),
    vectors,
    contentHashes: currentHashes,
    builtAt: Date.now(),
    deviceUsed: apiMode ? 'api' : `${config!.device}/${config!.dtype}`,
    buildTimeMs: Date.now() - t0,
  };
}
