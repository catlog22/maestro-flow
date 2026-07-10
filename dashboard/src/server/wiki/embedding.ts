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
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync, readdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Lazy zvec import — avoids hard failure when @zvec/zvec is not installed
// ---------------------------------------------------------------------------

type ZvecModule = typeof import('@zvec/zvec');
let _zvecModule: ZvecModule | null | undefined;

async function getZvec(): Promise<ZvecModule | null> {
  if (_zvecModule !== undefined) return _zvecModule;
  try {
    _zvecModule = await import('@zvec/zvec');
    return _zvecModule;
  } catch {
    _zvecModule = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingIndex {
  modelId: string;
  dimension: number;
  docIds: string[];
  vectors: Float32Array[];
  contentHashes?: string[];
  chunkDocIds?: string[];  // parallel to docIds — maps each vector slot to its parent document ID
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

// ---------------------------------------------------------------------------
// Local model path configuration (~/.maestro/local-embedding.json or env)
// ---------------------------------------------------------------------------

export interface LocalEmbeddingConfig {
  /** Absolute path to local ONNX model folder (must contain onnx/model.onnx) */
  modelPath: string;
}

const LOCAL_CONFIG_PATH = join(homedir(), '.maestro', 'local-embedding.json');

let _localConfig: LocalEmbeddingConfig | null | undefined;

export function loadLocalEmbeddingConfig(): LocalEmbeddingConfig | null {
  if (_localConfig !== undefined) return _localConfig;

  const envPath = process.env.MAESTRO_EMBEDDING_MODEL_PATH;
  if (envPath) {
    _localConfig = { modelPath: envPath };
    return _localConfig;
  }

  if (!existsSync(LOCAL_CONFIG_PATH)) {
    _localConfig = null;
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(LOCAL_CONFIG_PATH, 'utf-8')) as LocalEmbeddingConfig;
    if (raw.modelPath) {
      _localConfig = raw;
      return raw;
    }
    _localConfig = null;
    return null;
  } catch {
    _localConfig = null;
    return null;
  }
}

export function isLocalModelPath(): boolean {
  return loadLocalEmbeddingConfig() !== null;
}

export function getLocalModelPath(): string | null {
  const cfg = loadLocalEmbeddingConfig();
  return cfg?.modelPath ?? null;
}

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
  const envDevice = process.env.MAESTRO_EMBEDDING_DEVICE as DeviceType | undefined;
  const envBatch = process.env.MAESTRO_EMBEDDING_BATCH_SIZE;
  const useGpu = envDevice === 'cpu' ? false : hasGpu;

  _detectedConfig = {
    device: useGpu ? 'gpu' : 'cpu',
    dtype: useGpu ? 'fp16' : 'fp32',
    batchSize: useGpu ? 128 : (hasGpu ? 64 : 32),
  };

  if (envBatch) {
    const parsed = parseInt(envBatch, 10);
    if (parsed > 0) _detectedConfig.batchSize = parsed;
  }

  return _detectedConfig;
}

export function getDeviceSummary(): string {
  if (isApiMode()) return 'api (external)';
  if (!_detectedConfig) return 'not initialized';
  const suffix = isLocalModelPath() ? ' (local)' : '';
  return `${_detectedConfig.device}/${_detectedConfig.dtype} batch=${_detectedConfig.batchSize}${suffix}`;
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

  let reason: string;
  if (!hasGpu) {
    reason = 'CPU only — no GPU backend detected';
  } else if (config.device === 'gpu') {
    reason = 'GPU auto-selected (DML/CUDA detected) — set MAESTRO_EMBEDDING_DEVICE=cpu to force CPU';
  } else {
    reason = 'GPU available but CPU forced via MAESTRO_EMBEDDING_DEVICE=cpu';
  }

  return {
    backends,
    gpuAvailable: hasGpu,
    selectedDevice: config,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Pipeline management — lazy-loads model with detected device
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_MODEL = 'Xenova/multilingual-e5-small';
export function getModelId(): string {
  const apiConf = loadEmbeddingApiConfig();
  if (apiConf) return apiConf.model;
  const localConf = loadLocalEmbeddingConfig();
  if (localConf) return localConf.modelPath;
  return DEFAULT_LOCAL_MODEL;
}
export const DEFAULT_MODEL_ID = DEFAULT_LOCAL_MODEL;

function resolveLocalModel(): string {
  const localConf = loadLocalEmbeddingConfig();
  return localConf ? localConf.modelPath : DEFAULT_LOCAL_MODEL;
}

/**
 * Check if the local ONNX model is already downloaded in the HuggingFace cache.
 * Returns true for API mode (no local model needed).
 */
export function isModelCached(): boolean {
  if (isApiMode()) return true;

  const localConf = loadLocalEmbeddingConfig();
  if (localConf) {
    const p = localConf.modelPath;
    return existsSync(join(p, 'onnx', 'model.onnx'))
      || existsSync(join(p, 'model.onnx'));
  }

  const cacheKey = DEFAULT_LOCAL_MODEL.replace('/', '--');
  const hfHome = process.env.HF_HOME || join(homedir(), '.cache', 'huggingface');

  // Check standard HuggingFace Hub cache
  for (const base of [hfHome, join(hfHome, 'hub')]) {
    const snapshotsDir = join(base, `models--${cacheKey}`, 'snapshots');
    if (!existsSync(snapshotsDir)) continue;
    try {
      const snapshots = readdirSync(snapshotsDir);
      for (const snap of snapshots) {
        if (existsSync(join(snapshotsDir, snap, 'onnx', 'model.onnx'))) return true;
      }
    } catch { /* ignore */ }
  }

  // Check transformers.js cache (node_modules/@huggingface/transformers/.cache/)
  try {
    const localRequire = createRequire(import.meta.url);
    const tjsMainPath = localRequire.resolve('@huggingface/transformers');
    const normalized = tjsMainPath.replace(/\\/g, '/');
    const marker = '@huggingface/transformers';
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const tjsRoot = tjsMainPath.slice(0, idx + marker.length);
      if (existsSync(join(tjsRoot, '.cache', DEFAULT_LOCAL_MODEL, 'onnx', 'model.onnx'))) return true;
    }
  } catch { /* transformers not resolvable */ }

  return false;
}

const CACHE_FILE = 'embedding-index.json';

let _pipeline: any = null;
let _available: boolean | null = null;

async function configureProxy(): Promise<void> {
  const proxy = getApiProxy();
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
  const modelId = resolveLocalModel();
  const { pipeline } = await loadTransformers();
  const pipelineOpts: Record<string, unknown> = {
    dtype: config.dtype,
    device: config.device,
    progress_callback: _progressCallback ?? undefined,
  };
  if (isLocalModelPath()) {
    pipelineOpts.local_files_only = true;
  }
  _pipeline = await pipeline('feature-extraction', modelId, pipelineOpts);
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
// Vector search — zvec backend (default) with flat cosine fallback
// ---------------------------------------------------------------------------

const ZVEC_DIR = 'embedding.zvec';

export function vectorSearch(
  queryVector: Float32Array,
  index: EmbeddingIndex,
  limit: number,
): VectorSearchResult[] {
  if (index.dimension && queryVector.length !== index.dimension) return [];
  return flatCosineSearch(queryVector, index, limit);
}

/**
 * Async vector search using zvec collection.
 * Falls back to flat cosine scan when zvec is unavailable or feature flag is set.
 */
export async function vectorSearchZvec(
  queryVector: Float32Array,
  dir: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  if (process.env.MAESTRO_EMBEDDING_FLAT_SCAN) {
    return []; // caller handles fallback via sync vectorSearch
  }
  const zvec = await getZvec();
  if (!zvec) return []; // zvec not installed, caller handles fallback

  const collectionPath = join(dir, ZVEC_DIR);
  if (!existsSync(collectionPath)) return []; // no zvec collection yet

  try {
    const collection = zvec.ZVecOpen(collectionPath, { readOnly: true });
    try {
      const docs = await collection.query({
        fieldName: 'embedding',
        vector: queryVector,
        topk: limit,
        outputFields: ['docId'],
      });
      return docs.map(d => ({
        docId: (d.fields.docId as string) ?? d.id,
        score: 1 - d.score,
      }));
    } finally {
      collection.closeSync();
    }
  } catch {
    return []; // zvec query failed, caller handles fallback
  }
}

function flatCosineSearch(
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
// Persistence — zvec collection (primary) + binary fallback + legacy migration
// ---------------------------------------------------------------------------

const SQLITE_FILE = 'embedding-index.db';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

const BINARY_FILE = 'embedding-index.bin';

export async function saveEmbeddingIndex(index: EmbeddingIndex, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });

  // --- Binary format (kept for backward compat and feature flag fallback) ---
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
    chunkDocIds: index.chunkDocIds,
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

  // --- zvec collection save ---
  await saveZvecIndex(index, dir);

  // Remove legacy files
  for (const f of [CACHE_FILE, SQLITE_FILE, SQLITE_FILE + '-shm', SQLITE_FILE + '-wal', SQLITE_FILE + '-journal']) {
    try { if (existsSync(join(dir, f))) unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
}

let _zvecSaving = false;

/**
 * Save embedding index to zvec collection format.
 * Creates/replaces a zvec collection at `dir/embedding.zvec`.
 */
async function saveZvecIndex(index: EmbeddingIndex, dir: string): Promise<void> {
  if (_zvecSaving) return;
  const zvec = await getZvec();
  if (!zvec) return;
  _zvecSaving = true;
  try {
    await _saveZvecIndexInner(zvec, index, dir);
  } finally {
    _zvecSaving = false;
  }
}

async function _saveZvecIndexInner(zvec: ZvecModule, index: EmbeddingIndex, dir: string): Promise<void> {

  const collectionPath = join(dir, ZVEC_DIR);
  const dim = index.dimension;

  // Remove existing collection directory if present
  if (existsSync(collectionPath)) {
    try {
      const existing = zvec.ZVecOpen(collectionPath);
      existing.destroySync();
    } catch {
      // If we can't open it, try to remove the directory manually
      try {
        const { rmSync } = await import('node:fs');
        rmSync(collectionPath, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  const schema = new zvec.ZVecCollectionSchema({
    name: 'embedding',
    vectors: {
      name: 'embedding',
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension: dim,
      indexParams: {
        indexType: zvec.ZVecIndexType.FLAT,
        metricType: zvec.ZVecMetricType.COSINE,
      },
    },
    fields: [
      { name: 'docId', dataType: zvec.ZVecDataType.STRING },
    ],
  });

  const collection = zvec.ZVecCreateAndOpen(collectionPath, schema);
  try {
    // Batch upsert all vectors
    const BATCH_SIZE = 500;
    for (let i = 0; i < index.docIds.length; i += BATCH_SIZE) {
      const batch = [];
      const end = Math.min(i + BATCH_SIZE, index.docIds.length);
      for (let j = i; j < end; j++) {
        batch.push({
          id: index.docIds[j],
          vectors: { embedding: index.vectors[j] },
          fields: { docId: index.docIds[j] },
        });
      }
      collection.upsertSync(batch);
      // Yield to event loop to prevent event loop starvation/blocking
      await new Promise(resolve => setImmediate(resolve));
    }

    // Save metadata as JSON sidecar (zvec doesn't store arbitrary metadata)
    const metaSidecar = {
      modelId: index.modelId,
      dimension: dim,
      builtAt: index.builtAt,
      deviceUsed: index.deviceUsed,
      buildTimeMs: index.buildTimeMs,
      contentHashes: index.contentHashes,
      chunkDocIds: index.chunkDocIds,
      docIds: index.docIds,
    };
    writeFileSync(join(dir, ZVEC_DIR + '.meta.json'), JSON.stringify(metaSidecar));
  } finally {
    collection.closeSync();
  }
}

export function loadEmbeddingIndex(dir: string): EmbeddingIndex | null {
  // Primary: zvec collection + metadata sidecar
  const zvecMetaPath = join(dir, ZVEC_DIR + '.meta.json');
  const zvecCollPath = join(dir, ZVEC_DIR);
  if (existsSync(zvecMetaPath) && existsSync(zvecCollPath)) {
    try {
      return loadFromZvecMeta(zvecMetaPath, zvecCollPath);
    } catch (e: unknown) {
      if (process.env.MAESTRO_DEBUG === '1') {
        console.warn(`[embedding] zvec index load failed, falling back: ${e instanceof Error ? e.message : e}`);
      }
      // Fall through to binary
    }
  }

  // Fallback: packed binary
  const binPath = join(dir, BINARY_FILE);
  if (existsSync(binPath)) {
    try {
      return loadFromBinary(binPath);
    } catch (e: unknown) {
      if (process.env.MAESTRO_DEBUG === '1') {
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
      void saveEmbeddingIndex(idx, dir);
      return idx;
    } catch { /* fall through */ }
  }

  // Legacy: JSON → migrate to binary
  const jsonPath = join(dir, CACHE_FILE);
  if (existsSync(jsonPath)) {
    try {
      const idx = loadFromLegacyJson(jsonPath);
      void saveEmbeddingIndex(idx, dir);
      return idx;
    } catch { return null; }
  }

  return null;
}

/**
 * Load EmbeddingIndex from zvec metadata sidecar.
 * The sidecar stores everything needed to reconstruct the in-memory index;
 * the actual zvec collection is used for vectorSearchZvec queries.
 */
function loadFromZvecMeta(metaPath: string, _collectionPath: string): EmbeddingIndex {
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
    modelId: string;
    dimension: number;
    builtAt: number;
    deviceUsed?: string;
    buildTimeMs?: number;
    contentHashes?: string[];
    chunkDocIds?: string[];
    docIds: string[];
  };

  // Use cached zvec module if available, otherwise try sync require
  let zvec: ZvecModule | null = _zvecModule ?? null;
  if (!zvec) {
    try {
      zvec = _require('@zvec/zvec') as ZvecModule;
      _zvecModule = zvec;
    } catch {
      throw new Error('zvec not available for loading collection');
    }
  }

  const collection = zvec.ZVecOpen(_collectionPath, { readOnly: true });
  try {
    const vectors: Float32Array[] = new Array(meta.docIds.length);
    // Fetch vectors in batches by ID
    const BATCH_SIZE = 500;
    for (let i = 0; i < meta.docIds.length; i += BATCH_SIZE) {
      const batchIds = meta.docIds.slice(i, Math.min(i + BATCH_SIZE, meta.docIds.length));
      const fetched = collection.fetchSync({ ids: batchIds, includeVector: true, outputFields: [] });
      const fetchedMap = Array.isArray(fetched)
        ? Object.fromEntries(fetched.map((d: any) => [d.id, d]))
        : fetched;
      for (let j = 0; j < batchIds.length; j++) {
        const doc = fetchedMap[batchIds[j]];
        if (doc?.vectors?.embedding) {
          const v = doc.vectors.embedding;
          vectors[i + j] = v instanceof Float32Array ? v : new Float32Array(v as number[]);
        } else {
          vectors[i + j] = new Float32Array(meta.dimension);
        }
      }
    }

    return {
      modelId: meta.modelId,
      dimension: meta.dimension,
      docIds: meta.docIds,
      vectors,
      contentHashes: meta.contentHashes,
      chunkDocIds: meta.chunkDocIds,
      builtAt: meta.builtAt,
      deviceUsed: meta.deviceUsed,
      buildTimeMs: meta.buildTimeMs,
    };
  } finally {
    collection.closeSync();
  }
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
    chunkDocIds: meta.chunkDocIds,
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

export function hashDocContent(d: DocForEmbedding, enrichedText?: string): string {
  const parts = [d.title, d.summary, d.tags.join(','), d.body ?? ''];
  if (enrichedText) parts.push(enrichedText);
  return createHash('md5').update(parts.join('|')).digest('hex');
}

/**
 * Extract meaningful content from a markdown body: first paragraph + heading lines,
 * up to `maxLen` characters.
 */
function extractMeaningfulContent(body: string, maxLen: number): string {
  const lines = body.split('\n');
  const parts: string[] = [];
  let len = 0;
  let firstParaDone = false;

  for (const line of lines) {
    if (len >= maxLen) break;
    const trimmed = line.trim();
    // Always include heading lines
    if (/^#{1,3}\s/.test(trimmed)) {
      parts.push(trimmed);
      len += trimmed.length + 1;
      continue;
    }
    // Include non-empty lines until we hit the first blank line (first paragraph)
    if (!firstParaDone) {
      if (trimmed === '') {
        if (parts.length > 0) firstParaDone = true;
        continue;
      }
      parts.push(trimmed);
      len += trimmed.length + 1;
    }
  }

  const result = parts.join('\n');
  return result.length > maxLen ? result.slice(0, maxLen) : result;
}

function docToText(d: DocForEmbedding): string {
  const parts = [`title: ${d.title}`];
  if (d.summary) parts.push(`summary: ${d.summary}`);
  if (d.tags.length > 0) parts.push(`tags: ${d.tags.join(', ')}`);
  if (d.body) {
    const body = d.body.length > 500 ? extractMeaningfulContent(d.body, 450) : d.body;
    parts.push(`content: ${body}`);
  }
  parts.push(`title: ${d.title}`);
  const text = parts.join('\n');
  return isApiMode() ? text : 'passage: ' + text;
}

/**
 * Split a document into multiple chunks for embedding.
 * Short docs (<500 chars body) produce a single chunk.
 * Long docs are split by markdown heading regex /^#{1,3}\s/m, max 5 chunks.
 * Each chunk inherits title+summary as context prefix.
 */
export function splitDocToChunks(d: DocForEmbedding): Array<{ chunkId: string; text: string }> {
  const contextPrefix: string[] = [`title: ${d.title}`];
  if (d.summary) contextPrefix.push(`summary: ${d.summary}`);
  if (d.tags.length > 0) contextPrefix.push(`tags: ${d.tags.join(', ')}`);
  const prefix = contextPrefix.join('\n');

  // Short or empty body — single chunk using docToText
  if (!d.body || d.body.length < 500) {
    return [{ chunkId: `${d.id}#0`, text: docToText(d) }];
  }

  // Split body by markdown headings
  const sections = d.body.split(/^(?=#{1,3}\s)/m).filter(s => s.trim().length > 0);

  // If splitting produced only one section, single chunk
  if (sections.length <= 1) {
    return [{ chunkId: `${d.id}#0`, text: docToText(d) }];
  }

  // Cap at 5 chunks
  const capped = sections.slice(0, 5);
  const apiMode = isApiMode();

  return capped.map((section, i) => {
    const parts = [prefix, `content: ${section.trim()}`, `title: ${d.title}`];
    const text = parts.join('\n');
    return {
      chunkId: `${d.id}#${i}`,
      text: apiMode ? text : 'passage: ' + text,
    };
  });
}

export async function buildEmbeddingIndex(
  docs: DocForEmbedding[],
  existingIndex?: EmbeddingIndex | null,
  precomputedHashes?: string[],
): Promise<EmbeddingIndex> {
  const apiMode = isApiMode();
  const config = apiMode ? null : await detectDevice();
  const t0 = Date.now();

  const currentHashes = precomputedHashes ?? docs.map(d => hashDocContent(d));

  // Split all docs into chunks (1:N doc-to-chunk mapping)
  const allChunkIds: string[] = [];
  const allChunkDocIds: string[] = [];
  const allChunkTexts: string[] = [];
  // Track which doc index each chunk group belongs to (for incremental rebuild)
  const docChunkRanges: Array<{ docIndex: number; startSlot: number; count: number }> = [];

  for (let i = 0; i < docs.length; i++) {
    const chunks = splitDocToChunks(docs[i]);
    const startSlot = allChunkIds.length;
    for (const chunk of chunks) {
      allChunkIds.push(chunk.chunkId);
      allChunkDocIds.push(docs[i].id);
      allChunkTexts.push(chunk.text);
    }
    docChunkRanges.push({ docIndex: i, startSlot, count: chunks.length });
  }

  let vectors: Float32Array[];

  const activeModel = getModelId();
  const activeDim = apiMode ? (loadEmbeddingApiConfig()?.dimensions ?? 0) : 384;
  // Model, dimensions, or mode changed → discard all cached vectors, force full rebuild
  const modelMatch = existingIndex
    && existingIndex.modelId === activeModel
    && (activeDim === 0 || existingIndex.dimension === activeDim);
  if (modelMatch && existingIndex!.docIds.length > 0) {
    const existingChunkMap = new Map<string, Float32Array>();
    if (existingIndex!.chunkDocIds && existingIndex!.contentHashes) {
      for (let i = 0; i < existingIndex!.docIds.length; i++) {
        existingChunkMap.set(existingIndex!.docIds[i], existingIndex!.vectors[i]);
      }
    } else {
      for (let i = 0; i < existingIndex!.docIds.length; i++) {
        existingChunkMap.set(existingIndex!.docIds[i], existingIndex!.vectors[i]);
      }
    }

    // Determine which docs changed (hash comparison at doc level)
    // Rebuild per-doc hash from existing contentHashes
    const existingPerDocHash = new Map<string, string>();
    if (existingIndex!.contentHashes) {
      if (existingIndex!.chunkDocIds) {
        // Chunk-based: contentHashes[i] corresponds to the doc that produced chunk i
        // Each doc's hash is stored on its first chunk
        const docSeen = new Set<string>();
        for (let i = 0; i < existingIndex!.chunkDocIds.length; i++) {
          const pid = existingIndex!.chunkDocIds[i];
          if (!docSeen.has(pid)) {
            docSeen.add(pid);
            existingPerDocHash.set(pid, existingIndex!.contentHashes[i] ?? '');
          }
        }
      } else {
        // Legacy: docIds are 1:1 with docs
        for (let i = 0; i < existingIndex!.docIds.length; i++) {
          existingPerDocHash.set(existingIndex!.docIds[i], existingIndex!.contentHashes[i] ?? '');
        }
      }
    }

    vectors = new Array(allChunkIds.length);
    const chunksToEmbed: Array<{ slot: number; text: string }> = [];

    for (const range of docChunkRanges) {
      const docId = docs[range.docIndex].id;
      const cachedHash = existingPerDocHash.get(docId);
      const currentHash = currentHashes[range.docIndex];

      if (cachedHash && cachedHash === currentHash) {
        // Doc unchanged — try to reuse cached chunk vectors
        let allReused = true;
        for (let s = range.startSlot; s < range.startSlot + range.count; s++) {
          const cachedVec = existingChunkMap.get(allChunkIds[s]);
          if (cachedVec) {
            vectors[s] = cachedVec;
          } else {
            allReused = false;
            break;
          }
        }
        if (!allReused) {
          // Chunk structure changed (e.g., headings added/removed) — re-embed all chunks
          for (let s = range.startSlot; s < range.startSlot + range.count; s++) {
            chunksToEmbed.push({ slot: s, text: allChunkTexts[s] });
          }
        }
      } else {
        // Doc changed — re-embed all its chunks
        for (let s = range.startSlot; s < range.startSlot + range.count; s++) {
          chunksToEmbed.push({ slot: s, text: allChunkTexts[s] });
        }
      }
    }

    if (chunksToEmbed.length > 0) {
      const texts = chunksToEmbed.map(c => c.text);
      const newVectors = await embedTexts(texts);
      for (let j = 0; j < chunksToEmbed.length; j++) {
        vectors[chunksToEmbed[j].slot] = newVectors[j];
      }
    }
  } else {
    // Full rebuild
    vectors = await embedTexts(allChunkTexts);
  }

  // Build per-chunk contentHashes (each chunk gets its parent doc's hash)
  const parentToHash = new Map<string, string>();
  for (const range of docChunkRanges) {
    parentToHash.set(docs[range.docIndex].id, currentHashes[range.docIndex]);
  }
  const chunkContentHashes = allChunkDocIds.map(parentId =>
    parentToHash.get(parentId) ?? '',
  );

  return {
    modelId: activeModel,
    dimension: vectors[0]?.length ?? 384,
    docIds: allChunkIds,
    vectors,
    contentHashes: chunkContentHashes,
    chunkDocIds: allChunkDocIds,
    builtAt: Date.now(),
    deviceUsed: apiMode ? 'api' : `${config!.device}/${config!.dtype}`,
    buildTimeMs: Date.now() - t0,
  };
}
