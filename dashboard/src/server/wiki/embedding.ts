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
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open, rm, type FileHandle } from 'node:fs/promises';

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
const DEFAULT_API_CONCURRENCY = 4;
const DEFAULT_CONTEXT_LENGTH = 8192;
const MAX_TEXTS_PER_REQUEST = 256;
const MAX_API_CONCURRENCY = 64;
const MAX_EMBEDDING_DIMENSION = 65_536;

function isBoundedPositiveInteger(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
}

/** Validate and narrow the persisted external embedding API configuration. */
export function validateEmbeddingApiConfig(raw: unknown): EmbeddingApiConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.baseUrl !== 'string' || candidate.baseUrl.length === 0
    || typeof candidate.apiKey !== 'string' || candidate.apiKey.length === 0
    || typeof candidate.model !== 'string' || candidate.model.length === 0
  ) return null;
  if (candidate.dimensions !== undefined
    && !isBoundedPositiveInteger(candidate.dimensions, MAX_EMBEDDING_DIMENSION)) return null;
  if (candidate.batchSize !== undefined
    && !isBoundedPositiveInteger(candidate.batchSize, MAX_TEXTS_PER_REQUEST)) return null;
  if (candidate.concurrency !== undefined
    && !isBoundedPositiveInteger(candidate.concurrency, MAX_API_CONCURRENCY)) return null;
  if (candidate.contextLength !== undefined
    && !isBoundedPositiveInteger(candidate.contextLength, 1_000_000)) return null;
  return candidate as unknown as EmbeddingApiConfig;
}

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
    const raw = JSON.parse(readFileSync(API_CONFIG_PATH, 'utf-8')) as unknown;
    _apiConfig = validateEmbeddingApiConfig(raw);
    return _apiConfig;
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

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchBatchWithRetry(
  doFetch: FetchFn,
  url: string,
  batch: string[],
  batchOffset: number,
  config: EmbeddingApiConfig,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const body: Record<string, unknown> = { model: config.model, input: batch, encoding_format: 'float' };
  if (config.dimensions) body.dimensions = config.dimensions;
  const reqInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal,
  };

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal);
    if (attempt > 0) {
      await abortableDelay(Math.min(1000 * 2 ** (attempt - 1), 4000), signal);
    }
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
      let responseDimension: number | null = null;
      for (const item of json.data as Array<{ embedding?: number[]; index?: number }>) {
        if (!Array.isArray(item.embedding) || !Number.isSafeInteger(item.index)) continue;
        const index = item.index!;
        if (index < 0 || index >= batch.length || out[index]) {
          throw new Error(`Embedding API returned invalid or duplicate input index ${index}`);
        }
        const dimension = item.embedding.length;
        if (!isBoundedPositiveInteger(dimension, MAX_EMBEDDING_DIMENSION)) {
          throw new Error(`Embedding API returned invalid vector dimension ${dimension}`);
        }
        if (config.dimensions !== undefined && dimension !== config.dimensions) {
          throw new Error(`Embedding API returned dimension ${dimension}; expected ${config.dimensions}`);
        }
        if (responseDimension !== null && dimension !== responseDimension) {
          throw new Error(`Embedding API returned inconsistent vector dimensions ${responseDimension} and ${dimension}`);
        }
        if (!item.embedding.every(Number.isFinite)) {
          throw new Error('Embedding API returned a vector containing a non-finite value');
        }
        responseDimension = dimension;
        out[index] = new Float32Array(item.embedding);
      }
      for (let j = 0; j < batch.length; j++) {
        if (!out[j]) throw new Error(`Embedding API returned no vector for input index ${j} in batch starting at ${batchOffset}`);
      }
      return out;
    } catch (e: unknown) {
      throwIfAborted(signal);
      lastErr = e instanceof Error ? e : new Error(String(e));
      const isNetwork = lastErr.message.includes('fetch failed') || lastErr.message.includes('ECONNREFUSED') || lastErr.message.includes('Timeout');
      if (isNetwork && attempt < MAX_RETRIES) continue;
      throw lastErr;
    }
  }
  throw lastErr!;
}

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

async function callEmbeddingApi(
  texts: string[],
  config: EmbeddingApiConfig,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  throwIfAborted(signal);
  const doFetch = await getFetcher();
  throwIfAborted(signal);
  const url = config.baseUrl.replace(/\/+$/, '') + '/embeddings';
  const concurrency = config.concurrency ?? DEFAULT_API_CONCURRENCY;

  const chunks = buildChunks(texts, config);

  const results: Float32Array[] = new Array(texts.length);

  let firstErr: Error | null = null;
  for (let w = 0; w < chunks.length; w += concurrency) {
    throwIfAborted(signal);
    const window = chunks.slice(w, w + concurrency);
    const settled = await Promise.allSettled(
      window.map(c => fetchBatchWithRetry(doFetch, url, c.batch, c.offset, config, signal)),
    );
    for (let ci = 0; ci < window.length; ci++) {
      const s = settled[ci];
      if (s.status === 'fulfilled') {
        for (let j = 0; j < s.value.length; j++) results[window[ci].offset + j] = s.value[j];
      } else if (!firstErr) {
        firstErr = s.reason instanceof Error ? s.reason : new Error(String(s.reason));
      }
    }
    if (firstErr) throw firstErr;
  }

  throwIfAborted(signal);
  const dimension = results[0]?.length;
  if (dimension !== undefined && results.some(vector => vector.length !== dimension)) {
    throw new Error('Embedding API returned inconsistent vector dimensions across batches');
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
  merged.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
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
    // Vector-only docs get a floor so pure semantic matches aren't capped at alpha*rrf.
    const bn = bm25Norm.get(r.docId) ?? 0.15;
    merged.push({ docId: r.docId, score: alpha * rn + (1 - alpha) * bn });
  }

  merged.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Smart device detection — micro-benchmark to pick fastest backend
// ---------------------------------------------------------------------------

interface BackendInfo {
  name: string;
  bundled: boolean;
}

type OnnxLogLevel = 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
const ONNX_LOG_LEVELS = new Set<OnnxLogLevel>(['verbose', 'info', 'warning', 'error', 'fatal']);

export function resolveOnnxLogLevel(value = process.env.MAESTRO_ONNX_LOG_LEVEL): OnnxLogLevel {
  return value && ONNX_LOG_LEVELS.has(value as OnnxLogLevel)
    ? value as OnnxLogLevel
    : process.env.MAESTRO_DEBUG === '1' ? 'warning' : 'error';
}

export async function configureOnnxRuntimeLogging(): Promise<typeof import('onnxruntime-node')> {
  const ort = await import('onnxruntime-node');
  // ORT defaults to warning and emits benign provider-assignment diagnostics
  // during every fresh search process. Keep actionable errors while allowing
  // explicit verbose diagnostics through MAESTRO_ONNX_LOG_LEVEL.
  ort.env.logLevel = resolveOnnxLogLevel();
  return ort;
}

let _detectedConfig: DeviceConfig | null = null;

async function listBackends(): Promise<BackendInfo[]> {
  try {
    const ort = await configureOnnxRuntimeLogging();
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

  // Check the cache next to the vendored Transformers.js runtime.
  try {
    const localRequire = createRequire(import.meta.url);
    const tjsMainPath = localRequire.resolve('#maestro-transformers');
    const normalized = tjsMainPath.replace(/\\/g, '/');
    const marker = 'vendor/transformers';
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
let _pipelineInflight: Promise<any> | null = null;
let _available: boolean | null = null;

async function configureProxy(): Promise<void> {
  const proxy = getApiProxy();
  if (!proxy) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent({ uri: proxy }));
  } catch { /* undici not available */ }
}

async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return await import('#maestro-transformers');
}

export type ModelProgressCallback = (info: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => void;

let _progressCallback: ModelProgressCallback | null = null;

export function setProgressCallback(cb: ModelProgressCallback | null): void {
  _progressCallback = cb;
}

// 允许通过 HF_ENDPOINT 指向国内镜像（如 https://hf-mirror.com）。
// @huggingface/transformers（JS 版）不读 HF_ENDPOINT（那是 Python huggingface_hub 约定），
// 只认 env.remoteHost，故在此手动透传。
function configureRemoteHost(env: any): void {
  const endpoint = process.env.HF_ENDPOINT || process.env.HF_MIRROR;
  if (!endpoint) return;
  env.remoteHost = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
}

async function getPipeline(): Promise<any> {
  if (_pipeline) return _pipeline;
  if (_pipelineInflight) return _pipelineInflight;

  const progressCallback = _progressCallback;
  const flight = (async () => {
    await configureProxy();
    await configureOnnxRuntimeLogging();
    const config = await detectDevice();
    const modelId = resolveLocalModel();
    const { pipeline, env } = await loadTransformers();
    configureRemoteHost(env);
    const pipelineOpts: Record<string, unknown> = {
      dtype: config.dtype,
      device: config.device,
      progress_callback: progressCallback ?? undefined,
    };
    if (isLocalModelPath()) {
      pipelineOpts.local_files_only = true;
    }
    return pipeline('feature-extraction', modelId, pipelineOpts);
  })();
  _pipelineInflight = flight;
  try {
    _pipeline = await flight;
    _progressCallback = null;
    return _pipeline;
  } finally {
    if (_pipelineInflight === flight) _pipelineInflight = null;
  }
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

export async function embedTexts(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  throwIfAborted(signal);
  if (texts.length === 0) return [];

  const apiConf = loadEmbeddingApiConfig();
  if (apiConf) {
    return callEmbeddingApi(texts.map(t => t.slice(0, 8192)), apiConf, signal);
  }

  const pipe = await getPipeline();
  throwIfAborted(signal);
  const config = await detectDevice();
  const batchSize = config.batchSize;
  const results: Float32Array[] = [];

  const truncated = texts.map(t => t.slice(0, 512));

  for (let i = 0; i < truncated.length; i += batchSize) {
    throwIfAborted(signal);
    const batch = truncated.slice(i, i + batchSize);
    const output = await pipe(batch, { pooling: 'mean', normalize: true });
    throwIfAborted(signal);

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

export async function embedQuery(query: string, signal?: AbortSignal): Promise<Float32Array> {
  throwIfAborted(signal);
  const apiConf = loadEmbeddingApiConfig();
  if (apiConf) {
    const [vec] = await callEmbeddingApi([query.slice(0, 8192)], apiConf, signal);
    return vec;
  }

  const pipe = await getPipeline();
  throwIfAborted(signal);
  const output = await pipe(('query: ' + query).slice(0, 512), { pooling: 'mean', normalize: true });
  throwIfAborted(signal);
  return new Float32Array(output.data);
}

// ---------------------------------------------------------------------------
// Vector search — zvec backend (default) with flat cosine fallback
// ---------------------------------------------------------------------------

const ZVEC_DIR = 'embedding.zvec';
const ZVEC_ID_ENCODING = 'sha256';

function toZvecId(docId: string): string {
  return createHash('sha256').update(docId).digest('hex');
}

export function vectorSearch(
  queryVector: Float32Array,
  index: EmbeddingIndex,
  limit: number,
  allowedDocIds?: ReadonlySet<string>,
): VectorSearchResult[] {
  if (index.dimension && queryVector.length !== index.dimension) {
    console.error(`[embedding] dimension mismatch: query=${queryVector.length} index=${index.dimension} — falling back to BM25-only (rebuild with "maestro embedding rebuild")`);
    return [];
  }
  return flatCosineSearch(queryVector, index, limit, allowedDocIds);
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
      return docs.map(d => {
        const docId = d.fields.docId;
        if (typeof docId !== 'string' || docId.length === 0) {
          throw new Error(`zvec query result ${d.id} is missing its original docId`);
        }
        return {
          docId,
          score: 1 - d.score,
        };
      });
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
  allowedDocIds?: ReadonlySet<string>,
): VectorSearchResult[] {
  const scored: VectorSearchResult[] = [];
  for (let i = 0; i < index.docIds.length; i++) {
    const parentId = index.chunkDocIds?.[i] ?? index.docIds[i];
    if (allowedDocIds && !allowedDocIds.has(parentId)) continue;
    const sim = cosineSimilarity(queryVector, index.vectors[i]);
    if (sim > 0) scored.push({ docId: index.docIds[i], score: sim });
  }
  scored.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Persistence — zvec collection (primary) + binary fallback + legacy migration
// ---------------------------------------------------------------------------

const SQLITE_FILE = 'embedding-index.db';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

const BINARY_FILE = 'embedding-index.bin';

const MAX_EMBEDDING_VECTORS = 10_000_000;
const MAX_EMBEDDING_METADATA_BYTES = 64 * 1024 * 1024;
const MAX_EMBEDDING_BINARY_BYTES = 512 * 1024 * 1024;
let _embeddingSaveTail: Promise<void> = Promise.resolve();

function readBoundedFileSync(path: string, maxBytes: number): Buffer {
  const before = statSync(path);
  if (!before.isFile() || before.size < 0 || before.size > maxBytes) {
    throw new Error(`Embedding artifact exceeds ${maxBytes} byte limit`);
  }
  const fd = openSync(path, 'r');
  try {
    const output = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < output.length) {
      const bytesRead = readSync(fd, output, offset, output.length - offset, offset);
      if (bytesRead === 0) throw new Error('Embedding artifact changed while being read');
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    if (readSync(fd, extra, 0, 1, offset) !== 0) {
      throw new Error('Embedding artifact grew while being read');
    }
    return output;
  } finally {
    closeSync(fd);
  }
}

function validateStringArray(
  value: unknown,
  name: string,
  expectedLength: number,
  required: boolean,
): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length !== expectedLength
    || value.some(item => typeof item !== 'string')) {
    throw new Error(`Invalid embedding index ${name}`);
  }
  return value as string[];
}

function hasVectorShape(
  vectors: readonly unknown[],
  count: number,
  dimension: number,
): vectors is Float32Array[] {
  if (vectors.length !== count) return false;
  for (let i = 0; i < count; i++) {
    const vector = vectors[i];
    if (!(vector instanceof Float32Array) || vector.length !== dimension) return false;
  }
  return true;
}

function validateEmbeddingIndex(index: EmbeddingIndex): void {
  if (typeof index.modelId !== 'string' || index.modelId.length === 0) {
    throw new Error('Invalid embedding index modelId');
  }
  if (!isBoundedPositiveInteger(index.dimension, MAX_EMBEDDING_DIMENSION)) {
    throw new Error(`Invalid embedding index dimension ${index.dimension}`);
  }
  const count = index.docIds.length;
  if (!Number.isSafeInteger(count) || count > MAX_EMBEDDING_VECTORS) {
    throw new Error(`Invalid embedding index count ${count}`);
  }
  validateStringArray(index.docIds, 'docIds', count, true);
  if (!Array.isArray(index.vectors) || !hasVectorShape(index.vectors, count, index.dimension)) {
    throw new Error('Embedding index contains an invalid vector shape');
  }
  validateStringArray(index.contentHashes, 'contentHashes', count, false);
  validateStringArray(index.chunkDocIds, 'chunkDocIds', count, false);
  if (!Number.isFinite(index.builtAt)) throw new Error('Invalid embedding index builtAt');
}

async function writeBuffers(
  handle: FileHandle,
  buffers: Buffer[],
  signal?: AbortSignal,
): Promise<void> {
  let bufferIndex = 0;
  let bufferOffset = 0;
  while (bufferIndex < buffers.length) {
    throwIfAborted(signal);
    const views = buffers.slice(bufferIndex);
    if (bufferOffset > 0) views[0] = views[0].subarray(bufferOffset);
    const { bytesWritten } = await handle.writev(views);
    if (bytesWritten <= 0) throw new Error('Failed to make progress writing embedding index');
    let remaining = bytesWritten;
    while (bufferIndex < buffers.length) {
      const available = buffers[bufferIndex].length - bufferOffset;
      if (remaining < available) {
        bufferOffset += remaining;
        break;
      }
      remaining -= available;
      bufferIndex++;
      bufferOffset = 0;
    }
  }
}

async function writeBinaryIndexTemp(
  index: EmbeddingIndex,
  tmpPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const metaBytes = Buffer.from(JSON.stringify({
    modelId: index.modelId,
    dimension: index.dimension,
    count: index.docIds.length,
    builtAt: index.builtAt,
    deviceUsed: index.deviceUsed,
    buildTimeMs: index.buildTimeMs,
    contentHashes: index.contentHashes,
    chunkDocIds: index.chunkDocIds,
  }), 'utf-8');
  const docIdsBytes = Buffer.from(JSON.stringify(index.docIds), 'utf-8');
  if (metaBytes.length > MAX_EMBEDDING_METADATA_BYTES
    || docIdsBytes.length > MAX_EMBEDDING_METADATA_BYTES) {
    throw new Error('Embedding index metadata is too large');
  }

  const metaLength = Buffer.allocUnsafe(4);
  metaLength.writeUInt32LE(metaBytes.length);
  const docIdsLength = Buffer.allocUnsafe(4);
  docIdsLength.writeUInt32LE(docIdsBytes.length);
  const handle = await open(tmpPath, 'w');
  try {
    await writeBuffers(handle, [metaLength, metaBytes, docIdsLength, docIdsBytes], signal);
    // Write bounded vector batches directly from their existing views. writev
    // avoids both a packed whole-index copy and one syscall per vector.
    const VECTOR_WRITE_BATCH_SIZE = 256;
    for (let i = 0; i < index.vectors.length; i += VECTOR_WRITE_BATCH_SIZE) {
      throwIfAborted(signal);
      const buffers = index.vectors
        .slice(i, i + VECTOR_WRITE_BATCH_SIZE)
        .map(vector => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
      await writeBuffers(handle, buffers, signal);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function saveEmbeddingIndex(
  index: EmbeddingIndex,
  dir: string,
  signal?: AbortSignal,
): Promise<void> {
  const previousSave = _embeddingSaveTail;
  let releaseSave!: () => void;
  _embeddingSaveTail = new Promise<void>(resolve => { releaseSave = resolve; });
  await previousSave;
  try {
    throwIfAborted(signal);
    validateEmbeddingIndex(index);
    mkdirSync(dir, { recursive: true });
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const binaryTmp = join(dir, `${BINARY_FILE}.tmp-${token}`);
    let preparedZvec: PreparedZvecIndex | null = null;
    try {
      await writeBinaryIndexTemp(index, binaryTmp, signal);
      try {
        preparedZvec = await prepareZvecIndex(index, dir, token, signal);
      } catch (error) {
        rmSync(join(dir, `${ZVEC_DIR}.tmp-${token}`), { recursive: true, force: true });
        try { unlinkSync(join(dir, `${ZVEC_DIR}.meta.json.tmp-${token}`)); } catch { /* absent */ }
        throwIfAborted(signal);
        if (process.env.MAESTRO_DEBUG === '1') {
          console.warn(`[embedding] zvec index save failed, keeping binary fallback: ${error instanceof Error ? error.message : error}`);
        }
      }
      throwIfAborted(signal);

      // Publication is a short synchronous generation boundary: invalidate()
      // cannot interleave between the final abort check and the atomic renames.
      renameSync(binaryTmp, join(dir, BINARY_FILE));
      publishPreparedZvec(preparedZvec, dir);

      for (const f of [CACHE_FILE, SQLITE_FILE, SQLITE_FILE + '-shm', SQLITE_FILE + '-wal', SQLITE_FILE + '-journal']) {
        try { if (existsSync(join(dir, f))) unlinkSync(join(dir, f)); } catch { /* ignore */ }
      }
    } finally {
      await rm(binaryTmp, { force: true }).catch(() => undefined);
      cleanupPreparedZvec(preparedZvec);
    }
  } finally {
    releaseSave();
  }
}

interface PreparedZvecIndex {
  collectionPath: string;
  metaPath: string;
}

async function prepareZvecIndex(
  index: EmbeddingIndex,
  dir: string,
  token: string,
  signal?: AbortSignal,
): Promise<PreparedZvecIndex | null> {
  throwIfAborted(signal);
  const zvec = await getZvec();
  throwIfAborted(signal);
  if (!zvec) return null;

  const collectionPath = join(dir, `${ZVEC_DIR}.tmp-${token}`);
  const metaPath = join(dir, `${ZVEC_DIR}.meta.json.tmp-${token}`);
  rmSync(collectionPath, { recursive: true, force: true });
  const schema = new zvec.ZVecCollectionSchema({
    name: 'embedding',
    vectors: {
      name: 'embedding',
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension: index.dimension,
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
    const BATCH_SIZE = 500;
    for (let i = 0; i < index.docIds.length; i += BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = [];
      const end = Math.min(i + BATCH_SIZE, index.docIds.length);
      for (let j = i; j < end; j++) {
        batch.push({
          id: toZvecId(index.docIds[j]),
          vectors: { embedding: index.vectors[j] },
          fields: { docId: index.docIds[j] },
        });
      }
      collection.upsertSync(batch);
      await new Promise(resolve => setImmediate(resolve));
    }
  } catch (error) {
    collection.closeSync();
    rmSync(collectionPath, { recursive: true, force: true });
    throw error;
  }
  collection.closeSync();
  try {
    throwIfAborted(signal);
    writeFileSync(metaPath, JSON.stringify({
      modelId: index.modelId,
      dimension: index.dimension,
      builtAt: index.builtAt,
      deviceUsed: index.deviceUsed,
      buildTimeMs: index.buildTimeMs,
      contentHashes: index.contentHashes,
      chunkDocIds: index.chunkDocIds,
      docIds: index.docIds,
      zvecIdEncoding: ZVEC_ID_ENCODING,
    }));
    return { collectionPath, metaPath };
  } catch (error) {
    rmSync(collectionPath, { recursive: true, force: true });
    try { unlinkSync(metaPath); } catch { /* not written */ }
    throw error;
  }
}

function publishPreparedZvec(prepared: PreparedZvecIndex | null, dir: string): void {
  const collectionPath = join(dir, ZVEC_DIR);
  const metaPath = join(dir, `${ZVEC_DIR}.meta.json`);
  rmSync(collectionPath, { recursive: true, force: true });
  try { unlinkSync(metaPath); } catch { /* missing sidecar */ }
  if (!prepared) return;
  renameSync(prepared.collectionPath, collectionPath);
  renameSync(prepared.metaPath, metaPath);
}

function cleanupPreparedZvec(prepared: PreparedZvecIndex | null): void {
  if (!prepared) return;
  rmSync(prepared.collectionPath, { recursive: true, force: true });
  try { unlinkSync(prepared.metaPath); } catch { /* already published or absent */ }
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
      persistMigratedEmbeddingIndex(idx, dir);
      return idx;
    } catch { /* fall through */ }
  }

  // Legacy: JSON → migrate to binary
  const jsonPath = join(dir, CACHE_FILE);
  if (existsSync(jsonPath)) {
    try {
      const idx = loadFromLegacyJson(jsonPath);
      persistMigratedEmbeddingIndex(idx, dir);
      return idx;
    } catch { return null; }
  }

  return null;
}

interface PersistedEmbeddingMeta {
  modelId: string;
  dimension: number;
  count?: number;
  builtAt: number;
  deviceUsed?: string;
  buildTimeMs?: number;
  contentHashes?: string[];
  chunkDocIds?: string[];
  docIds?: string[];
  zvecIdEncoding?: typeof ZVEC_ID_ENCODING;
}

function validatePersistedMeta(
  value: unknown,
  expectedCount?: number,
): PersistedEmbeddingMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Embedding metadata must be an object');
  }
  const meta = value as Record<string, unknown>;
  if (typeof meta.modelId !== 'string' || meta.modelId.length === 0) {
    throw new Error('Embedding metadata has an invalid modelId');
  }
  if (!isBoundedPositiveInteger(meta.dimension, MAX_EMBEDDING_DIMENSION)) {
    throw new Error(`Embedding metadata has an invalid dimension ${String(meta.dimension)}`);
  }
  if (!Number.isFinite(meta.builtAt)) throw new Error('Embedding metadata has an invalid builtAt');
  if (meta.buildTimeMs !== undefined && !Number.isFinite(meta.buildTimeMs)) {
    throw new Error('Embedding metadata has an invalid buildTimeMs');
  }
  if (meta.zvecIdEncoding !== undefined && meta.zvecIdEncoding !== ZVEC_ID_ENCODING) {
    throw new Error(`Embedding metadata has an unsupported ID encoding ${String(meta.zvecIdEncoding)}`);
  }
  if (expectedCount !== undefined) {
    validateStringArray(meta.contentHashes, 'contentHashes', expectedCount, false);
    validateStringArray(meta.chunkDocIds, 'chunkDocIds', expectedCount, false);
  }
  return meta as unknown as PersistedEmbeddingMeta;
}

/**
 * Load EmbeddingIndex from zvec metadata sidecar.
 * The sidecar stores everything needed to reconstruct the in-memory index;
 * the actual zvec collection is used for vectorSearchZvec queries.
 */
function loadFromZvecMeta(metaPath: string, _collectionPath: string): EmbeddingIndex {
  const metaBytes = readBoundedFileSync(metaPath, MAX_EMBEDDING_METADATA_BYTES);
  const rawMeta = JSON.parse(metaBytes.toString('utf-8')) as unknown;
  if (!rawMeta || typeof rawMeta !== 'object' || !Array.isArray((rawMeta as Record<string, unknown>).docIds)) {
    throw new Error('zvec metadata has invalid docIds');
  }
  const rawDocIds = (rawMeta as Record<string, unknown>).docIds as unknown[];
  if (rawDocIds.length > MAX_EMBEDDING_VECTORS) {
    throw new Error(`zvec metadata count ${rawDocIds.length} exceeds the supported limit`);
  }
  const meta = validatePersistedMeta(rawMeta, rawDocIds.length);
  const docIds = validateStringArray(rawDocIds, 'docIds', rawDocIds.length, true)!;

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
    const vectors: Float32Array[] = new Array(docIds.length);
    // Fetch vectors in batches by ID
    const BATCH_SIZE = 500;
    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
      const batchDocIds = docIds.slice(i, Math.min(i + BATCH_SIZE, docIds.length));
      const zvecIds = meta.zvecIdEncoding === ZVEC_ID_ENCODING
        ? batchDocIds.map(toZvecId)
        : batchDocIds;
      const fetched = collection.fetchSync({ ids: zvecIds, includeVector: true, outputFields: [] });
      const fetchedMap = Array.isArray(fetched)
        ? Object.fromEntries(fetched.map((d: any) => [d.id, d]))
        : fetched;
      for (let j = 0; j < zvecIds.length; j++) {
        const doc = fetchedMap[zvecIds[j]];
        if (doc?.vectors?.embedding) {
          const v = doc.vectors.embedding;
          if (!(v instanceof Float32Array) && !Array.isArray(v)) {
            throw new Error(`zvec collection returned an invalid vector for ${zvecIds[j]}`);
          }
          if (v.length !== meta.dimension) {
            throw new Error(`zvec vector dimension ${v.length} does not match metadata ${meta.dimension}`);
          }
          for (let k = 0; k < v.length; k++) {
            if (!Number.isFinite(v[k])) {
              throw new Error(`zvec collection returned a non-finite vector for ${zvecIds[j]}`);
            }
          }
          vectors[i + j] = v instanceof Float32Array ? v : new Float32Array(v as number[]);
        } else {
          throw new Error(`zvec collection is missing document ${zvecIds[j]}`);
        }
      }
    }

    return {
      modelId: meta.modelId,
      dimension: meta.dimension,
      docIds,
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
  const raw = readBoundedFileSync(filePath, MAX_EMBEDDING_BINARY_BYTES);
  let offset = 0;
  if (raw.length < 8) throw new Error('Binary embedding index is shorter than its header');

  const metaLen = raw.readUInt32LE(offset); offset += 4;
  if (metaLen > MAX_EMBEDDING_METADATA_BYTES || metaLen > raw.length - offset - 4) {
    throw new Error(`Binary embedding metadata length ${metaLen} is invalid`);
  }
  const rawMeta = JSON.parse(raw.subarray(offset, offset + metaLen).toString('utf-8')) as unknown;
  offset += metaLen;

  if (offset + 4 > raw.length) throw new Error('Binary embedding index is missing docIds length');
  const docIdsLen = raw.readUInt32LE(offset); offset += 4;
  if (docIdsLen > MAX_EMBEDDING_METADATA_BYTES || docIdsLen > raw.length - offset) {
    throw new Error(`Binary embedding docIds length ${docIdsLen} is invalid`);
  }
  const rawDocIds = JSON.parse(raw.subarray(offset, offset + docIdsLen).toString('utf-8')) as unknown;
  offset += docIdsLen;

  if (!rawMeta || typeof rawMeta !== 'object') throw new Error('Binary embedding metadata is invalid');
  const rawCount = (rawMeta as Record<string, unknown>).count;
  if (!Number.isSafeInteger(rawCount) || (rawCount as number) < 0
    || (rawCount as number) > MAX_EMBEDDING_VECTORS) {
    throw new Error(`Binary embedding count ${String(rawCount)} is invalid`);
  }
  const n = rawCount as number;
  const meta = validatePersistedMeta(rawMeta, n);
  const docIds = validateStringArray(rawDocIds, 'docIds', n, true)!;
  const dim = meta.dimension;
  const floatCount = n * dim;
  const vecBytes = floatCount * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(floatCount) || !Number.isSafeInteger(vecBytes)
    || offset + vecBytes !== raw.length) {
    throw new Error(`Binary embedding vector payload length ${raw.length - offset} is invalid`);
  }

  // Only allocate vector views after every metadata and file-length bound has
  // been checked. Most files are naturally aligned and stay zero-copy.
  const vecStart = raw.byteOffset + offset;
  const vectors: Float32Array[] = new Array(n);
  if (vecStart % Float32Array.BYTES_PER_ELEMENT === 0) {
    const allFloats = new Float32Array(raw.buffer, vecStart, floatCount);
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

function persistMigratedEmbeddingIndex(index: EmbeddingIndex, dir: string): void {
  void saveEmbeddingIndex(index, dir).catch(error => {
    console.warn(`[embedding] legacy index migration save failed: ${error instanceof Error ? error.message : error}`);
  });
}

function assertBoundedLegacySqliteArtifactFamily(dir: string): void {
  const dbPath = join(dir, SQLITE_FILE);
  const artifactPaths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
  let totalBytes = 0;
  for (let i = 0; i < artifactPaths.length; i++) {
    let artifactStat;
    try {
      artifactStat = lstatSync(artifactPaths[i]);
    } catch (error) {
      if (i > 0 && typeof error === 'object' && error !== null
        && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.size < 0) {
      throw new Error(`Legacy SQLite embedding artifact family exceeds ${MAX_EMBEDDING_BINARY_BYTES} byte limit`);
    }
    totalBytes += artifactStat.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_EMBEDDING_BINARY_BYTES) {
      throw new Error(`Legacy SQLite embedding artifact family exceeds ${MAX_EMBEDDING_BINARY_BYTES} byte limit`);
    }
  }
}

function loadFromSqlite(dir: string): EmbeddingIndex {
  const dbPath = join(dir, SQLITE_FILE);
  assertBoundedLegacySqliteArtifactFamily(dir);

  const Database = _require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    db.exec('BEGIN');
    const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
    const modelId = getMeta.get('modelId')?.value ?? 'unknown';
    assertBoundedLegacySqliteArtifactFamily(dir);
    const dimension = parseInt(getMeta.get('dimension')?.value ?? '384', 10);
    const builtAt = parseInt(getMeta.get('builtAt')?.value ?? '0', 10);
    const deviceUsed = getMeta.get('deviceUsed')?.value;
    const buildTimeMs = parseInt(getMeta.get('buildTimeMs')?.value ?? '0', 10) || undefined;
    if (!isBoundedPositiveInteger(dimension, MAX_EMBEDDING_DIMENSION)) {
      throw new Error(`Legacy SQLite embedding index has invalid dimension ${dimension}`);
    }

    const countRow = db.prepare('SELECT COUNT(*) AS count FROM vectors').get() as { count?: unknown } | undefined;
    const count = countRow?.count;
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > MAX_EMBEDDING_VECTORS) {
      throw new Error(`Legacy SQLite embedding index has invalid count ${String(count)}`);
    }
    const docIds: string[] = [];
    const vectors: Float32Array[] = [];
    const rows = db.prepare('SELECT doc_id, vector FROM vectors ORDER BY rowid')
      .iterate() as Iterable<{ doc_id: unknown; vector: unknown }>;
    for (const row of rows) {
      if (typeof row.doc_id !== 'string' || !Buffer.isBuffer(row.vector)
        || row.vector.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
        throw new Error('Legacy SQLite embedding index contains an invalid vector row');
      }
      const bytes = row.vector as Buffer;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const vector = new Float32Array(copy.buffer);
      for (let i = 0; i < vector.length; i++) {
        if (!Number.isFinite(vector[i])) {
          throw new Error('Legacy SQLite embedding index contains a non-finite vector');
        }
      }
      docIds.push(row.doc_id);
      vectors.push(vector);
    }
    const index = { modelId, dimension, docIds, vectors, builtAt, deviceUsed, buildTimeMs };
    validateEmbeddingIndex(index);
    return index;
  } finally {
    db.close();
  }
}

function loadFromLegacyJson(filePath: string): EmbeddingIndex {
  const parsed = JSON.parse(readBoundedFileSync(filePath, MAX_EMBEDDING_METADATA_BYTES).toString('utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Legacy JSON embedding index must be an object');
  }
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.docIds) || !Array.isArray(raw.vectors)
    || raw.docIds.length !== raw.vectors.length || raw.docIds.length > MAX_EMBEDDING_VECTORS
    || !isBoundedPositiveInteger(raw.dimension, MAX_EMBEDDING_DIMENSION)) {
    throw new Error('Legacy JSON embedding index has invalid dimensions or vector count');
  }
  const dimension = raw.dimension;
  const vectors = raw.vectors.map(value => {
    if (typeof value !== 'string' || value.length > Math.ceil(dimension * Float32Array.BYTES_PER_ELEMENT / 3) * 4 + 4) {
      throw new Error('Legacy JSON embedding index contains an invalid vector');
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
      throw new Error('Legacy JSON embedding index contains an invalid vector payload');
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const vector = new Float32Array(copy.buffer);
    for (let i = 0; i < vector.length; i++) {
      if (!Number.isFinite(vector[i])) {
        throw new Error('Legacy JSON embedding index contains a non-finite vector');
      }
    }
    return vector;
  });
  const index: EmbeddingIndex = {
    modelId: raw.modelId as string,
    dimension,
    docIds: raw.docIds as string[],
    vectors,
    builtAt: raw.builtAt as number,
    deviceUsed: typeof raw.deviceUsed === 'string' ? raw.deviceUsed : undefined,
    buildTimeMs: typeof raw.buildTimeMs === 'number' ? raw.buildTimeMs : undefined,
  };
  validateEmbeddingIndex(index);
  return index;
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
  signal?: AbortSignal,
): Promise<EmbeddingIndex> {
  throwIfAborted(signal);
  const apiMode = isApiMode();
  const config = apiMode ? null : await detectDevice();
  const t0 = Date.now();

  const currentHashes = precomputedHashes ?? docs.map(d => hashDocContent(d));
  if (currentHashes.length !== docs.length) {
    throw new Error('Precomputed embedding hashes do not match the document count');
  }

  // Split all docs into chunks (1:N doc-to-chunk mapping)
  const allChunkIds: string[] = [];
  const allChunkDocIds: string[] = [];
  const allChunkTexts: string[] = [];
  // Track which doc index each chunk group belongs to (for incremental rebuild)
  const docChunkRanges: Array<{ docIndex: number; startSlot: number; count: number }> = [];

  for (let i = 0; i < docs.length; i++) {
    throwIfAborted(signal);
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
  const existingShapeValid = existingIndex
    && isBoundedPositiveInteger(existingIndex.dimension, MAX_EMBEDDING_DIMENSION)
    && hasVectorShape(existingIndex.vectors, existingIndex.docIds.length, existingIndex.dimension);
  const modelMatch = existingShapeValid
    && existingIndex!.modelId === activeModel
    && (activeDim === 0 || existingIndex!.dimension === activeDim);
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
      throwIfAborted(signal);
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
      const newVectors = await embedTexts(texts, signal);
      for (let j = 0; j < chunksToEmbed.length; j++) {
        vectors[chunksToEmbed[j].slot] = newVectors[j];
      }
    }
  } else {
    // Full rebuild
    vectors = await embedTexts(allChunkTexts, signal);
  }

  throwIfAborted(signal);
  let dimension = vectors[0]?.length ?? (activeDim || existingIndex?.dimension || 384);
  if ((!isBoundedPositiveInteger(dimension, MAX_EMBEDDING_DIMENSION)
    || !hasVectorShape(vectors, allChunkIds.length, dimension)) && modelMatch) {
    // An API may change its default dimension when dimensions is omitted.
    // Discard mixed incremental reuse and rebuild once with the current shape.
    vectors = await embedTexts(allChunkTexts, signal);
    throwIfAborted(signal);
    dimension = vectors[0]?.length ?? (activeDim || existingIndex?.dimension || 384);
  }
  if (!isBoundedPositiveInteger(dimension, MAX_EMBEDDING_DIMENSION)
    || !hasVectorShape(vectors, allChunkIds.length, dimension)) {
    throw new Error('Embedding build returned an invalid or inconsistent vector shape');
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
    dimension,
    docIds: allChunkIds,
    vectors,
    contentHashes: chunkContentHashes,
    chunkDocIds: allChunkDocIds,
    builtAt: Date.now(),
    deviceUsed: apiMode ? 'api' : `${config!.device}/${config!.dtype}`,
    buildTimeMs: Date.now() - t0,
  };
}
