import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

import { MaestroGraph } from '../../graph/kg/engine.js';
import type { UnifiedNode } from '../../graph/kg/db/types.js';
import {
  SEARCH_MEASUREMENT_LANES,
  type SearchMeasurementLane,
} from '#built-search-adapter-contract';

export { SEARCH_MEASUREMENT_LANES };
export type { SearchMeasurementLane };

export const LATENCY_WARMUPS = 20;
export const LATENCY_SAMPLES = 100;
export const DEFAULT_QUALITY_RUNS = 5;
export const DEFAULT_TOP_K = 20;

/**
 * The benchmark lanes are generated from the adapter contract so evaluator
 * and release-machine validation cannot drift. Callers still provide each
 * evaluation-only operation; the contract does not alter production paths.
 */
export type SearchMeasurementPhase = 'cold' | 'warm' | 'update' | 'freshness';

export interface SearchMeasurementStats {
  warmups: number;
  measuredSamples: number;
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface SearchMeasurementLaneReport {
  lane: SearchMeasurementLane;
  phase: SearchMeasurementPhase;
  status: 'measured' | 'deferred';
  stats: SearchMeasurementStats | null;
  reason?: string;
}

export interface SearchMeasurementReport {
  schema_version: 'search-ranking-measurements/1.0';
  lanes: SearchMeasurementLaneReport[];
  complete: boolean;
}

export type SearchMeasurementOperation = () => void | Promise<void>;

export interface SearchMeasurementOptions {
  warmups?: number;
  measuredSamples?: number;
}

export type SearchMeasurementOperations = Partial<
  Record<SearchMeasurementLane, SearchMeasurementOperation>
>;

export type RankingCategory =
  | 'exact-symbol'
  | 'wiki-short'
  | 'knowledge'
  | 'mixed'
  | 'linked-scope'
  | string;

export interface RankingDocument {
  id: string;
  kind: string;
  title: string;
  summary: string;
  tags: string[];
  body: string;
  status?: string;
  workspace?: string;
  authorized?: boolean;
  provenance?: {
    source: string;
    path: string;
  };
}

export interface RankingCorpusManifest {
  schema_version: 'search-ranking-corpus-manifest/1.0';
  expandedDocumentCount: number;
  expandedSha256: string;
  wikiSourceDocumentCount: number;
  measurementLanes: SearchMeasurementLane[];
}

export interface RankingCorpusFixture {
  schema_version: 'search-ranking-corpus/1.0';
  documents: RankingDocument[];
  latencyCorpus: {
    size: number;
    idPrefix: string;
    vocabulary: string[];
  };
  manifest: RankingCorpusManifest;
  absoluteQueries?: Array<{ id: string; query: string }>;
}

export interface RankingJudgment {
  id: string;
  query: string;
  category: RankingCategory;
  relevance: Record<string, number>;
}

export interface RankingQrelsFixture {
  schema_version: 'search-ranking-qrels/1.0';
  queries: RankingJudgment[];
}

export interface RankingHoldout {
  id: string;
  query: string;
  targetIds: string[];
  category: string;
}

export interface RankingHoldoutsFixture {
  schema_version: 'search-ranking-holdouts/1.0';
  queries: RankingHoldout[];
}

export interface RankingMetrics {
  ndcgAt10: number;
  mrrAt10: number;
  recallAt20: number;
}

export interface RankingBaselineFixture {
  schema_version: 'search-ranking-baseline/1.0';
  qrelsSha256: string;
  sourceRevision: string;
  knownOrder: Record<string, string[]>;
  metrics: {
    overall: RankingMetrics;
    categories: Record<string, RankingMetrics>;
  };
  protocol: {
    qualityRuns: number;
    topK: number;
    warmups: number;
    measuredSamples: number;
    corpusSize: number;
    wikiSourceDocumentCount: number;
    expandedSha256: string;
  };
}

export interface RankedDocument {
  id: string;
  score: number;
}

export type RankingProvider = (
  query: string,
  documents: readonly RankingDocument[],
  limit: number,
) => readonly RankedDocument[] | Promise<readonly RankedDocument[]>;

export interface QueryStability {
  queryId: string;
  top20Runs: string[][];
  stable: boolean;
}

export interface QuerySpecialCaseHit {
  path: string;
  line: number;
  kind: 'query-literal' | 'pi-branch';
  match: string;
}

export interface QuerySpecialCaseScan {
  querySpecialCaseHits: number;
  hits: QuerySpecialCaseHit[];
  scannedFiles: number;
}

export interface SearchRankingReport {
  schema_version: 'search-ranking-report/1.0';
  ok: true;
  qrelsSha256: string;
  qrelsSha256Match: true;
  metrics: {
    overall: RankingMetrics;
    categories: Record<string, RankingMetrics>;
  };
  overallNdcgGain: number;
  maxCategoryNdcgDrop: number;
  categoryNdcgDeltas: Record<string, number>;
  qualityGate: {
    minOverallNdcgGain: 0.1;
    maxCategoryNdcgDrop: 0.02;
    pass: true;
  };
  stability: {
    runs: number;
    topK: number;
    stableTop20: boolean;
    queries: QueryStability[];
  };
  latency: {
    warmups: 20;
    measuredSamples: 100;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    corpusSize: number;
    runner: {
      node: string;
      platform: NodeJS.Platform;
      arch: string;
      cpuCount: number;
    };
  };
  scanner: QuerySpecialCaseScan;
  integrity: {
    deprecatedLeakCount: number;
    unauthorizedWorkspaceHitCount: number;
    provenanceLossCount: number;
    holdoutOverlapCount: 0;
  };
  workspace: {
    root: string;
    wikiFixturePath: string;
    maestroGraphPath: string;
  };
}

export interface EvaluateRankingInput {
  workspaceRoot: string;
  corpusPath: string;
  qrelsPath: string;
  baselinePath: string;
  holdoutsPath: string;
  runs?: number;
  topK?: number;
  ranker?: RankingProvider;
  productionPaths?: string[];
  excludeGlobs?: string[];
}

export interface QuerySpecialCaseInput {
  queryFiles: string[];
  productionPaths: string[];
  excludeGlobs?: string[];
}

interface MachineFailure {
  schema_version: 'search-ranking-failure/1.0';
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export class RankingEvaluationError extends Error {
  readonly failure: MachineFailure;

  constructor(code: string, message: string, details?: unknown) {
    const failure: MachineFailure = {
      schema_version: 'search-ranking-failure/1.0',
      ok: false,
      code,
      message,
      ...(details === undefined ? {} : { details }),
    };
    super(JSON.stringify(failure));
    this.name = 'RankingEvaluationError';
    this.failure = failure;
  }

  toJSON(): MachineFailure {
    return this.failure;
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new RankingEvaluationError(code, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadRankingFixture<T>(path: string): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    fail('INVALID_FIXTURE', `cannot read ranking fixture: ${path}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed) || typeof parsed.schema_version !== 'string') {
    fail('INVALID_FIXTURE', `ranking fixture has no schema_version: ${path}`);
  }
  return parsed as T;
}

export async function sha256File(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hashes the expanded, generated corpus rather than the self-referential fixture manifest. */
export function expandedCorpusSha256(corpus: RankingCorpusFixture): string {
  return createHash('sha256').update(canonicalJson(expandCorpus(corpus))).digest('hex');
}

export function wikiSourceDocuments(
  corpus: RankingCorpusFixture,
): RankingDocument[] {
  return expandCorpus(corpus).filter(document => (
    (document.workspace === 'local' || document.workspace === undefined)
    && document.kind !== 'code-symbol'
  ));
}

export interface WikiCorpusIndexEntry {
  id?: unknown;
  source?: { kind?: unknown; path?: unknown };
  sourceRef?: unknown;
}

export interface WikiCorpusIndexEvidence {
  expectedEntryCount: number;
  indexedEntryCount: number;
  missingSourceRefs: string[];
  duplicateSourceRefs: string[];
}

/**
 * Count only file-backed corpus entries.  KG virtual projections are
 * intentionally excluded: they are a separate provider and must not make a
 * Wiki corpus appear indexed when its source files were never scanned.
 */
export function inspectWikiCorpusIndex(
  entries: readonly WikiCorpusIndexEntry[],
  corpus: RankingCorpusFixture,
): WikiCorpusIndexEvidence {
  const expected = wikiSourceDocuments(corpus);
  const expectedRefs = new Set(expected.map(document => document.id));
  const generatedRefs = new Set(expected
    .filter(document => document.kind === 'latency-noise')
    .map(document => document.id));
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const entry of entries) {
    if (entry.source?.kind !== 'file') continue;
    const sourceRef = typeof entry.sourceRef === 'string' && expectedRefs.has(entry.sourceRef)
      ? entry.sourceRef
      : typeof entry.id === 'string'
        && entry.id.startsWith('domain-')
        && entry.source?.path === 'domain/glossary.json'
        && generatedRefs.has(entry.id.slice('domain-'.length))
        ? entry.id.slice('domain-'.length)
        : null;
    if (sourceRef === null) continue;
    if (seen.has(sourceRef)) duplicate.add(sourceRef);
    seen.add(sourceRef);
  }
  const missing = [...expectedRefs].filter(sourceRef => !seen.has(sourceRef)).sort();
  return {
    expectedEntryCount: expectedRefs.size,
    indexedEntryCount: seen.size,
    missingSourceRefs: missing,
    duplicateSourceRefs: [...duplicate].sort(),
  };
}

export function assertWikiCorpusIndex(
  entries: readonly WikiCorpusIndexEntry[],
  corpus: RankingCorpusFixture,
): WikiCorpusIndexEvidence {
  const evidence = inspectWikiCorpusIndex(entries, corpus);
  if (evidence.indexedEntryCount !== evidence.expectedEntryCount
      || evidence.missingSourceRefs.length > 0
      || evidence.duplicateSourceRefs.length > 0) {
    fail('WIKI_CORPUS_NOT_INDEXED', 'Wiki source corpus is incomplete or duplicated', evidence);
  }
  return evidence;
}

function measurementStats(samples: readonly number[], warmups: number): SearchMeasurementStats {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  )]!;
  return {
    warmups,
    measuredSamples: samples.length,
    samplesMs: [...samples],
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1]!,
  };
}

function validMeasurementCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export async function measureSearchLane(
  lane: SearchMeasurementLane,
  operation: SearchMeasurementOperation,
  options: SearchMeasurementOptions & { phase?: SearchMeasurementPhase } = {},
): Promise<SearchMeasurementLaneReport> {
  const warmups = options.warmups ?? LATENCY_WARMUPS;
  const measuredSamples = options.measuredSamples ?? LATENCY_SAMPLES;
  if (!validMeasurementCount(warmups) || !validMeasurementCount(measuredSamples)
      || warmups < 1 || measuredSamples < 1) {
    fail('INVALID_MEASUREMENT_OPTIONS', 'measurement warmups and samples must be positive integers', {
      warmups,
      measuredSamples,
    });
  }
  const phase = options.phase ?? 'warm';
  for (let index = 0; index < warmups; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    const started = performance.now();
    await operation();
    const duration = performance.now() - started;
    if (!Number.isFinite(duration) || duration < 0) {
      fail('INVALID_MEASUREMENT_SAMPLE', 'measurement operation returned an invalid duration', {
        lane,
        index,
        duration,
      });
    }
    samples.push(Number(duration.toFixed(6)));
  }
  return { lane, phase, status: 'measured', stats: measurementStats(samples, warmups) };
}

const MEASUREMENT_PHASES: Readonly<Record<SearchMeasurementLane, SearchMeasurementPhase>> = {
  daemon: 'cold',
  semantic: 'warm',
  'cache-load': 'cold',
  'single-file-update': 'update',
  freshness: 'freshness',
};

export async function measureSearchLanes(
  operations: SearchMeasurementOperations,
  options: SearchMeasurementOptions = {},
): Promise<SearchMeasurementReport> {
  const lanes: SearchMeasurementLaneReport[] = [];
  for (const lane of SEARCH_MEASUREMENT_LANES) {
    const operation = operations[lane];
    lanes.push(operation
      ? await measureSearchLane(lane, operation, { ...options, phase: MEASUREMENT_PHASES[lane] })
      : {
        lane,
        phase: MEASUREMENT_PHASES[lane],
        status: 'deferred',
        stats: null,
        reason: 'operation was not supplied by this evaluation runner',
      });
  }
  return {
    schema_version: 'search-ranking-measurements/1.0',
    lanes,
    complete: lanes.every(lane => lane.status === 'measured'),
  };
}

export function assertCompleteSearchMeasurements(
  report: SearchMeasurementReport,
): void {
  if (report.schema_version !== 'search-ranking-measurements/1.0'
      || !Array.isArray(report.lanes)
      || report.lanes.length !== SEARCH_MEASUREMENT_LANES.length
      || report.lanes.some((lane, index) => lane.lane !== SEARCH_MEASUREMENT_LANES[index])
      || report.complete !== true) {
    fail('INCOMPLETE_SEARCH_MEASUREMENTS', 'search measurement report is not complete', report);
  }
  for (const lane of report.lanes) {
    if (lane.status !== 'measured' || lane.stats === null
        || lane.stats.warmups < 1
        || lane.stats.measuredSamples < 1
        || lane.stats.samplesMs.length !== lane.stats.measuredSamples) {
      fail('INCOMPLETE_SEARCH_MEASUREMENTS', 'search measurement lane is invalid', lane);
    }
  }
}

export function validateSearchMeasurementReport(
  report: SearchMeasurementReport,
  requireComplete = true,
): void {
  if (report.schema_version !== 'search-ranking-measurements/1.0'
      || !Array.isArray(report.lanes)
      || report.lanes.length !== SEARCH_MEASUREMENT_LANES.length) {
    fail('INVALID_SEARCH_MEASUREMENTS', 'invalid search-ranking-measurements/1.0 report');
  }
  for (let index = 0; index < report.lanes.length; index += 1) {
    const lane = report.lanes[index]!;
    if (lane.lane !== SEARCH_MEASUREMENT_LANES[index]
        || !['measured', 'deferred'].includes(lane.status)
        || !['cold', 'warm', 'update', 'freshness'].includes(lane.phase)) {
      fail('INVALID_SEARCH_MEASUREMENTS', 'invalid search measurement lane', lane);
    }
    if (lane.status === 'deferred') {
      if (lane.stats !== null || typeof lane.reason !== 'string' || lane.reason.length === 0) {
        fail('INVALID_SEARCH_MEASUREMENTS', 'deferred lane must expose a reason and no stats', lane);
      }
      continue;
    }
    if (!lane.stats || !validMeasurementCount(lane.stats.warmups)
        || !validMeasurementCount(lane.stats.measuredSamples)
        || lane.stats.warmups < 1 || lane.stats.measuredSamples < 1
        || lane.stats.samplesMs.length !== lane.stats.measuredSamples
        || lane.stats.samplesMs.some(sample => typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0)) {
      fail('INVALID_SEARCH_MEASUREMENTS', 'measured lane has invalid stats', lane);
    }
    const recomputed = measurementStats(lane.stats.samplesMs, lane.stats.warmups);
    if (lane.stats.p50Ms !== recomputed.p50Ms
        || lane.stats.p95Ms !== recomputed.p95Ms
        || lane.stats.maxMs !== recomputed.maxMs) {
      fail('INVALID_SEARCH_MEASUREMENTS', 'measurement aggregates do not match raw samples', {
        lane: lane.lane,
        expected: {
          p50Ms: recomputed.p50Ms,
          p95Ms: recomputed.p95Ms,
          maxMs: recomputed.maxMs,
        },
        actual: {
          p50Ms: lane.stats.p50Ms,
          p95Ms: lane.stats.p95Ms,
          maxMs: lane.stats.maxMs,
        },
      });
    }
  }
  if (report.complete !== report.lanes.every(lane => lane.status === 'measured')) {
    fail('INVALID_SEARCH_MEASUREMENTS', 'measurement complete flag does not match lane statuses');
  }
  if (requireComplete) assertCompleteSearchMeasurements(report);
}

export function validateCorpus(value: RankingCorpusFixture): void {
  if (value.schema_version !== 'search-ranking-corpus/1.0'
      || !Array.isArray(value.documents)
      || !isRecord(value.latencyCorpus)
      || !Number.isInteger(value.latencyCorpus.size)
      || value.latencyCorpus.size < value.documents.length
      || !Array.isArray(value.latencyCorpus.vocabulary)
      || value.latencyCorpus.vocabulary.length === 0) {
    fail('INVALID_CORPUS', 'invalid search-ranking-corpus/1.0 fixture');
  }

  const ids = new Set<string>();
  for (const document of value.documents) {
    if (!document || typeof document.id !== 'string' || document.id.length === 0
        || typeof document.title !== 'string' || typeof document.summary !== 'string'
        || typeof document.body !== 'string' || !Array.isArray(document.tags)) {
      fail('INVALID_CORPUS', 'corpus contains an invalid document');
    }
    if (ids.has(document.id)) fail('INVALID_CORPUS', `duplicate corpus document id: ${document.id}`);
    ids.add(document.id);
  }

  const manifest = value.manifest;
  const expanded = expandCorpus(value);
  const expectedWikiCount = expanded.filter(document => (
    (document.workspace === 'local' || document.workspace === undefined)
    && document.kind !== 'code-symbol'
  )).length;
  if (!manifest
      || manifest.schema_version !== 'search-ranking-corpus-manifest/1.0'
      || manifest.expandedDocumentCount !== expanded.length
      || manifest.expandedDocumentCount !== value.latencyCorpus.size
      || !/^[a-f0-9]{64}$/.test(manifest.expandedSha256)
      || manifest.expandedSha256 !== expandedCorpusSha256(value)
      || manifest.wikiSourceDocumentCount !== expectedWikiCount
      || !Array.isArray(manifest.measurementLanes)
      || manifest.measurementLanes.length !== SEARCH_MEASUREMENT_LANES.length
      || manifest.measurementLanes.some(
        (lane, index) => lane !== SEARCH_MEASUREMENT_LANES[index],
      )) {
    fail('INVALID_CORPUS_MANIFEST', 'corpus manifest does not match deterministic expansion', {
      expectedExpandedDocumentCount: expanded.length,
      actualExpandedDocumentCount: manifest?.expandedDocumentCount ?? null,
      expectedWikiSourceDocumentCount: expectedWikiCount,
      actualWikiSourceDocumentCount: manifest?.wikiSourceDocumentCount ?? null,
      expectedExpandedSha256: expandedCorpusSha256(value),
      actualExpandedSha256: manifest?.expandedSha256 ?? null,
    });
  }
}

export function validateQrels(value: RankingQrelsFixture, documentIds: Set<string>): void {
  if (value.schema_version !== 'search-ranking-qrels/1.0' || !Array.isArray(value.queries)
      || value.queries.length === 0) {
    fail('INVALID_QRELS', 'invalid search-ranking-qrels/1.0 fixture');
  }

  const queryIds = new Set<string>();
  for (const judgment of value.queries) {
    if (!judgment || typeof judgment.id !== 'string' || typeof judgment.query !== 'string'
        || judgment.query.trim().length === 0 || typeof judgment.category !== 'string'
        || !isRecord(judgment.relevance)) {
      fail('INVALID_QRELS', 'qrels contains an invalid query');
    }
    if (queryIds.has(judgment.id)) fail('INVALID_QRELS', `duplicate qrels query id: ${judgment.id}`);
    queryIds.add(judgment.id);
    const entries = Object.entries(judgment.relevance);
    if (entries.length === 0) fail('INVALID_QRELS', `qrels query has no judgments: ${judgment.id}`);
    for (const [documentId, grade] of entries) {
      if (!documentIds.has(documentId)) {
        fail('INVALID_QRELS', `qrels references unknown document: ${documentId}`);
      }
      if (!Number.isInteger(grade) || grade < 0 || grade > 3) {
        fail('INVALID_QRELS', `qrels grade must be an integer from 0 to 3: ${judgment.id}/${documentId}`);
      }
    }
  }
}

export function validateBaseline(value: RankingBaselineFixture): void {
  const validMetrics = (metrics: unknown): metrics is RankingMetrics => (
    isRecord(metrics)
    && ['ndcgAt10', 'mrrAt10', 'recallAt20'].every(key => (
      typeof metrics[key] === 'number'
      && Number.isFinite(metrics[key])
      && metrics[key] >= 0
      && metrics[key] <= 1
    ))
  );
  if (value.schema_version !== 'search-ranking-baseline/1.0'
      || !/^[a-f0-9]{64}$/.test(value.qrelsSha256)
      || !isRecord(value.metrics)
      || !validMetrics(value.metrics.overall)
      || !isRecord(value.metrics.categories)
      || !isRecord(value.knownOrder)
      || !isRecord(value.protocol)
      || value.protocol.warmups !== LATENCY_WARMUPS
      || value.protocol.measuredSamples !== LATENCY_SAMPLES
      || !Number.isInteger(value.protocol.qualityRuns)
      || value.protocol.qualityRuns < 1
      || !Number.isInteger(value.protocol.topK)
      || value.protocol.topK < DEFAULT_TOP_K
      || !Number.isInteger(value.protocol.corpusSize)
      || value.protocol.corpusSize < 1
      || !Number.isInteger(value.protocol.wikiSourceDocumentCount)
      || value.protocol.wikiSourceDocumentCount < 1
      || !/^[a-f0-9]{64}$/.test(value.protocol.expandedSha256)
      || !Object.values(value.metrics.categories).every(validMetrics)
      || !Object.values(value.knownOrder).every(order => (
        Array.isArray(order)
        && order.length > 0
        && order.every(id => typeof id === 'string' && id.length > 0)
        && new Set(order).size === order.length
      ))) {
    fail('INVALID_BASELINE', 'invalid search-ranking-baseline/1.0 fixture');
  }
}

export function validateHoldouts(value: RankingHoldoutsFixture): void {
  if (value.schema_version !== 'search-ranking-holdouts/1.0' || !Array.isArray(value.queries)) {
    fail('INVALID_HOLDOUTS', 'invalid search-ranking-holdouts/1.0 fixture');
  }
  for (const query of value.queries) {
    if (!query || typeof query.id !== 'string' || typeof query.query !== 'string'
        || query.query.trim().length === 0 || !Array.isArray(query.targetIds)
        || query.targetIds.length === 0) {
      fail('INVALID_HOLDOUTS', 'holdout fixture contains an invalid query');
    }
  }
}

export function assertQrelsHash(
  qrelsSha256: string,
  baseline: RankingBaselineFixture,
): void {
  if (qrelsSha256 !== baseline.qrelsSha256) {
    fail('QRELS_HASH_MISMATCH', 'qrels hash mismatch', {
      expected: baseline.qrelsSha256,
      actual: qrelsSha256,
    });
  }
}

export function validateRankingFixtures(
  corpus: RankingCorpusFixture,
  qrels: RankingQrelsFixture,
  baseline: RankingBaselineFixture,
  holdouts: RankingHoldoutsFixture,
): void {
  validateCorpus(corpus);
  validateBaseline(baseline);
  validateHoldouts(holdouts);
  const documentIds = new Set(corpus.documents.map(document => document.id));
  validateQrels(qrels, documentIds);
  validateKnownOrderBaseline(baseline, qrels, documentIds);
  if (baseline.protocol.corpusSize !== corpus.manifest.expandedDocumentCount
      || baseline.protocol.wikiSourceDocumentCount !== corpus.manifest.wikiSourceDocumentCount
      || baseline.protocol.expandedSha256 !== corpus.manifest.expandedSha256) {
    fail('CORPUS_BASELINE_MISMATCH', 'baseline protocol does not match corpus manifest', {
      baseline: {
        corpusSize: baseline.protocol.corpusSize,
        wikiSourceDocumentCount: baseline.protocol.wikiSourceDocumentCount,
        expandedSha256: baseline.protocol.expandedSha256,
      },
      manifest: {
        expandedDocumentCount: corpus.manifest.expandedDocumentCount,
        wikiSourceDocumentCount: corpus.manifest.wikiSourceDocumentCount,
        expandedSha256: corpus.manifest.expandedSha256,
      },
    });
  }
  assertHoldoutsDisjoint(holdouts, qrels, corpus);
}

function normalizedQuery(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

export function assertHoldoutsDisjoint(
  holdouts: RankingHoldoutsFixture,
  qrels: RankingQrelsFixture,
  corpus: RankingCorpusFixture,
): void {
  const frozenQueries = new Set(qrels.queries.map(item => normalizedQuery(item.query)));
  for (const item of corpus.absoluteQueries ?? []) frozenQueries.add(normalizedQuery(item.query));
  const overlaps = holdouts.queries
    .filter(item => frozenQueries.has(normalizedQuery(item.query)))
    .map(item => item.id);
  if (overlaps.length > 0) {
    fail('HOLDOUT_OVERLAP', 'holdout queries overlap relative qrels or absolute fixtures', { overlaps });
  }
}

export function expandCorpus(corpus: RankingCorpusFixture): RankingDocument[] {
  const documents = [...corpus.documents];
  const vocabulary = corpus.latencyCorpus.vocabulary;
  for (let index = documents.length; index < corpus.latencyCorpus.size; index += 1) {
    const tokenA = vocabulary[index % vocabulary.length];
    const tokenB = vocabulary[(index * 7 + 3) % vocabulary.length];
    const suffix = String(index + 1).padStart(4, '0');
    documents.push({
      id: `${corpus.latencyCorpus.idPrefix}-${suffix}`,
      kind: 'latency-noise',
      title: `Synthetic ${tokenA} ${suffix}`,
      summary: `Deterministic ${tokenA} ${tokenB} latency document`,
      tags: ['latency', tokenA, tokenB],
      body: `${tokenA} ${tokenB} synthetic benchmark corpus entry ${suffix}`,
      status: 'active',
      workspace: 'local',
      authorized: true,
      provenance: { source: 'fixture', path: `latency/${suffix}.json` },
    });
  }
  return documents;
}

export interface HermeticSearchWorkspace {
  root: string;
  wikiFixturePath: string;
  maestroGraphPath: string;
  linkedWorkspaceRoot: string;
  linkedMaestroGraphPath: string;
  unauthorizedWorkspaceRoot: string;
  unauthorizedMaestroGraphPath: string;
  corpusSize: number;
  wikiSourceDocumentCount: number;
  expandedCorpusSha256: string;
}

function graphNode(document: RankingDocument): UnifiedNode {
  const code = document.kind === 'code-symbol';
  return {
    id: document.id,
    kind: code ? (document.id.includes(':class:') ? 'class' : 'function') : document.kind,
    name: document.title,
    qualifiedName: document.title,
    filePath: document.provenance?.path ?? '',
    language: code ? 'typescript' : 'unknown',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 1,
    docstring: document.summary,
    signature: code ? `${document.title}(): void` : '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: code ? 'codegraph' : 'knowhow',
    definition: document.summary,
    aliases: [],
    keywords: document.tags,
    category: document.kind,
    roles: [],
    priority: '',
    status: document.status ?? 'active',
    body: document.body,
    metadata: {
      fixtureProvenance: document.provenance ?? null,
      fixtureWorkspace: document.workspace ?? 'local',
      fixtureAuthorized: document.authorized !== false,
    },
    updatedAt: 0,
  };
}

async function createCanonicalGraph(root: string, documents: readonly RankingDocument[]): Promise<string> {
  const graph = await MaestroGraph.init(root);
  try {
    graph.getQueryBuilder().insertNodes(documents.map(graphNode));
  } finally {
    graph.close();
  }
  return join(resolve(root), '.workflow', 'kg', 'maestro.db');
}

function safeFixtureName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '');
}

async function projectWikiSourceFiles(
  workflowRoot: string,
  documents: readonly RankingDocument[],
): Promise<number> {
  const wikiDocuments = documents.filter(document => (
    (document.workspace === 'local' || document.workspace === undefined)
    && document.kind !== 'code-symbol'
  ));
  const generatedNoise = wikiDocuments.filter(document => document.kind === 'latency-noise');
  const authoredDocuments = wikiDocuments.filter(document => document.kind !== 'latency-noise');
  for (const document of authoredDocuments) {
    const path = join(workflowRoot, 'knowhow', `FIXTURE-${safeFixtureName(document.id)}.md`);
    await mkdir(dirname(path), { recursive: true });
    const tags = document.tags.map(tag => `  - ${JSON.stringify(tag)}`).join('\n');
    await writeFile(path, [
      '---',
      `title: ${JSON.stringify(document.title)}`,
      `summary: ${JSON.stringify(document.summary)}`,
      `status: ${document.status === 'deprecated' ? 'deprecated' : 'active'}`,
      `sourceRef: ${JSON.stringify(document.id)}`,
      `fixtureWorkspace: ${JSON.stringify(document.workspace ?? 'local')}`,
      `fixtureAuthorized: ${document.authorized !== false}`,
      `fixtureProvenanceSource: ${JSON.stringify(document.provenance?.source ?? '')}`,
      `fixtureProvenancePath: ${JSON.stringify(document.provenance?.path ?? '')}`,
      'tags:',
      tags,
      '---',
      `# ${document.title}`,
      '',
      document.body,
      '',
    ].join('\n'), 'utf8');
  }

  // Materialize generated distractors through the Wiki indexer's file-backed
  // domain source. A single compact JSON parse avoids thousands of repeated
  // XML/frontmatter normalization calls while every document still enters the
  // same cold WikiIndex + BM25 construction measured by the gate.
  if (generatedNoise.length > 0) {
    const path = join(workflowRoot, 'domain', 'glossary.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      terms: generatedNoise.map(document => ({
        id: document.id,
        canonical: document.title,
        definition: `${document.summary} ${document.body}`,
        keywords: document.tags,
        status: 'active',
        tier: 'evaluation',
        source: { kind: 'fixture' },
      })),
    }), 'utf8');
  }
  return wikiDocuments.length;
}

export async function buildHermeticSearchWorkspace(
  corpus: RankingCorpusFixture,
  root: string,
): Promise<HermeticSearchWorkspace> {
  validateCorpus(corpus);
  const workspaceRoot = resolve(root);
  const workflowRoot = join(workspaceRoot, '.workflow');
  const wikiFixturePath = join(workflowRoot, 'wiki', 'search-ranking-corpus.json');
  const maestroGraphPath = join(workflowRoot, 'kg', 'maestro.db');
  const linkedWorkspaceRoot = join(workspaceRoot, 'linked-peer');
  const linkedMaestroGraphPath = join(linkedWorkspaceRoot, '.workflow', 'kg', 'maestro.db');
  const unauthorizedWorkspaceRoot = join(workspaceRoot, 'linked-secret-control');
  const unauthorizedMaestroGraphPath = join(
    unauthorizedWorkspaceRoot,
    '.workflow',
    'kg',
    'maestro.db',
  );
  const documents = expandCorpus(corpus);

  await mkdir(dirname(wikiFixturePath), { recursive: true });
  try {
    await stat(maestroGraphPath);
    fail('NON_HERMETIC_WORKSPACE', `hermetic MaestroGraph path already exists: ${maestroGraphPath}`);
  } catch (error) {
    if (error instanceof RankingEvaluationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await writeFile(wikiFixturePath, `${JSON.stringify({
    schema_version: corpus.schema_version,
    documents,
  }, null, 2)}\n`, 'utf8');
  const wikiSourceDocumentCount = await projectWikiSourceFiles(workflowRoot, documents);

  // The Wiki lane owns the generated distractors as file-backed entries. Keep
  // them out of the KG virtual projection so one logical corpus does not get
  // counted twice (and so KG latency remains a separate, curated-provider
  // measurement).
  const localDocuments = documents.filter(document => (
    (document.workspace === 'local' || document.workspace === undefined)
    && document.status !== 'deprecated'
    && document.kind !== 'latency-noise'
  ));
  const linkedDocuments = documents.filter(document => (
    document.workspace === 'peer' && document.authorized !== false
  ));
  const unauthorizedDocuments = documents.filter(document => document.authorized === false);
  await createCanonicalGraph(workspaceRoot, localDocuments);
  await createCanonicalGraph(linkedWorkspaceRoot, linkedDocuments);
  await createCanonicalGraph(unauthorizedWorkspaceRoot, unauthorizedDocuments);
  await writeFile(join(workflowRoot, 'config.json'), `${JSON.stringify({
    workspaces: {
      linked: [{
        name: 'peer',
        path: linkedWorkspaceRoot,
        share: ['codebase'],
      }],
    },
  }, null, 2)}\n`, 'utf8');

  return {
    root: workspaceRoot,
    wikiFixturePath,
    maestroGraphPath,
    linkedWorkspaceRoot,
    linkedMaestroGraphPath,
    unauthorizedWorkspaceRoot,
    unauthorizedMaestroGraphPath,
    corpusSize: documents.length,
    wikiSourceDocumentCount,
    expandedCorpusSha256: corpus.manifest.expandedSha256,
  };
}

function tokenize(value: string): string[] {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return expanded.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_$]+/gu) ?? [];
}

function termFrequency(tokens: readonly string[], term: string): number {
  let count = 0;
  for (const token of tokens) if (token === term) count += 1;
  return count;
}

export const lexicalFixtureRanker: RankingProvider = (query, documents, limit) => {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];
  const normalized = normalizedQuery(query);
  const ranked: RankedDocument[] = [];

  for (const document of documents) {
    if (document.status === 'deprecated' || document.authorized === false) continue;
    const title = tokenize(document.title);
    const summary = tokenize(document.summary);
    const tags = document.tags.flatMap(tokenize);
    const body = tokenize(document.body);
    let score = normalizedQuery(document.title) === normalized ? 16 : 0;
    for (const term of queryTerms) {
      score += termFrequency(title, term) * 5;
      score += termFrequency(tags, term) * 3;
      score += termFrequency(summary, term) * 2;
      score += termFrequency(body, term);
    }
    if (score > 0) ranked.push({ id: document.id, score });
  }

  ranked.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return ranked.slice(0, limit);
};

export function normalizeRanking(ranking: readonly RankedDocument[], limit: number): RankedDocument[] {
  const bestById = new Map<string, number>();
  for (const item of ranking) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0
        || typeof item.score !== 'number' || !Number.isFinite(item.score)) {
      fail('INVALID_RANKING', 'ranking provider returned a non-finite score or invalid id');
    }
    const previous = bestById.get(item.id);
    if (previous === undefined || item.score > previous) bestById.set(item.id, item.score);
  }
  return [...bestById.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function computeRankingMetrics(
  rankedIds: readonly string[],
  relevance: Readonly<Record<string, number>>,
): RankingMetrics {
  const relevantIds = Object.entries(relevance)
    .filter(([, grade]) => grade > 0)
    .map(([id]) => id);
  if (relevantIds.length === 0) fail('INVALID_QRELS', 'metrics require at least one relevant document');

  let dcg = 0;
  for (let index = 0; index < Math.min(10, rankedIds.length); index += 1) {
    const grade = relevance[rankedIds[index]] ?? 0;
    dcg += (2 ** grade - 1) / Math.log2(index + 2);
  }
  const idealGrades = relevantIds.map(id => relevance[id]).sort((left, right) => right - left).slice(0, 10);
  const idcg = idealGrades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
  const firstRelevant = rankedIds.slice(0, 10).findIndex(id => (relevance[id] ?? 0) > 0);
  const recalled = new Set(rankedIds.slice(0, 20).filter(id => (relevance[id] ?? 0) > 0)).size;

  return {
    ndcgAt10: idcg === 0 ? 0 : dcg / idcg,
    mrrAt10: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    recallAt20: recalled / relevantIds.length,
  };
}

function meanMetrics(values: readonly RankingMetrics[]): RankingMetrics {
  if (values.length === 0) return { ndcgAt10: 0, mrrAt10: 0, recallAt20: 0 };
  return {
    ndcgAt10: values.reduce((sum, value) => sum + value.ndcgAt10, 0) / values.length,
    mrrAt10: values.reduce((sum, value) => sum + value.mrrAt10, 0) / values.length,
    recallAt20: values.reduce((sum, value) => sum + value.recallAt20, 0) / values.length,
  };
}

export interface AggregatedRankingMetrics {
  overall: RankingMetrics;
  categories: Record<string, RankingMetrics>;
}

export function aggregateRankingMetrics(
  values: readonly { category: string; metrics: RankingMetrics }[],
): AggregatedRankingMetrics {
  const categories: Record<string, RankingMetrics> = {};
  for (const category of [...new Set(values.map(item => item.category))].sort()) {
    categories[category] = meanMetrics(
      values.filter(item => item.category === category).map(item => item.metrics),
    );
  }
  return {
    overall: meanMetrics(values.map(item => item.metrics)),
    categories,
  };
}

export function computeKnownOrderBaselineMetrics(
  qrels: RankingQrelsFixture,
  knownOrder: Readonly<Record<string, readonly string[]>>,
): AggregatedRankingMetrics {
  const knownIds = new Set(Object.keys(knownOrder));
  const queryIds = new Set(qrels.queries.map(query => query.id));
  const missing = [...queryIds].filter(id => !knownIds.has(id)).sort();
  const extra = [...knownIds].filter(id => !queryIds.has(id)).sort();
  if (missing.length > 0 || extra.length > 0) {
    fail('INVALID_BASELINE', 'baseline known-order query set does not match qrels', { missing, extra });
  }
  return aggregateRankingMetrics(qrels.queries.map(judgment => ({
    category: judgment.category,
    metrics: computeRankingMetrics(knownOrder[judgment.id], judgment.relevance),
  })));
}

function assertMetricsEqual(
  actual: RankingMetrics,
  expected: RankingMetrics,
  label: string,
): void {
  for (const key of ['ndcgAt10', 'mrrAt10', 'recallAt20'] as const) {
    if (Math.abs(actual[key] - expected[key]) > 1e-12) {
      fail('INVALID_BASELINE', `baseline metrics are not reproducible: ${label}.${key}`, {
        stored: actual[key],
        recomputed: expected[key],
      });
    }
  }
}

function validateKnownOrderBaseline(
  baseline: RankingBaselineFixture,
  qrels: RankingQrelsFixture,
  documentIds: ReadonlySet<string>,
): AggregatedRankingMetrics {
  for (const [queryId, order] of Object.entries(baseline.knownOrder)) {
    const unknownIds = order.filter(id => !documentIds.has(id));
    if (unknownIds.length > 0) {
      fail('INVALID_BASELINE', `baseline known order references unknown documents: ${queryId}`, {
        unknownIds,
      });
    }
  }
  const recomputed = computeKnownOrderBaselineMetrics(qrels, baseline.knownOrder);
  assertMetricsEqual(baseline.metrics.overall, recomputed.overall, 'overall');
  const storedCategories = Object.keys(baseline.metrics.categories).sort();
  const recomputedCategories = Object.keys(recomputed.categories).sort();
  if (JSON.stringify(storedCategories) !== JSON.stringify(recomputedCategories)) {
    fail('INVALID_BASELINE', 'baseline metric categories do not match qrels categories', {
      storedCategories,
      recomputedCategories,
    });
  }
  for (const category of recomputedCategories) {
    assertMetricsEqual(
      baseline.metrics.categories[category],
      recomputed.categories[category],
      `categories.${category}`,
    );
  }
  return recomputed;
}

export function assertStableTopK(
  runs: readonly (readonly string[])[],
  queryId = 'unknown',
): void {
  if (runs.length === 0) fail('UNSTABLE_RANKING', `no ranking runs recorded for query: ${queryId}`);
  const expected = JSON.stringify(runs[0]);
  const mismatch = runs.findIndex(run => JSON.stringify(run) !== expected);
  if (mismatch >= 0) {
    fail('UNSTABLE_RANKING', `Top-20 ranking is unstable for query: ${queryId}`, {
      expected: runs[0],
      actual: runs[mismatch],
      run: mismatch + 1,
    });
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) fail('INVALID_LATENCY', 'latency sample set is empty');
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function roundedMilliseconds(value: number): number {
  return Number(value.toFixed(6));
}

function collectQueryStrings(value: unknown, queries: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectQueryStrings(item, queries);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.query === 'string' && value.query.trim().length > 0) queries.add(value.query);
  for (const nested of Object.values(value)) collectQueryStrings(nested, queries);
}

function globPattern(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/');
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const doubleStar = '\u0000';
  const expression = escaped
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, '[^/]*')
    .replaceAll(doubleStar, '.*');
  return new RegExp(`^${expression}$`);
}

function excludedProductionPath(path: string, excludeGlobs: readonly string[]): boolean {
  const normalized = path.replaceAll('\\', '/');
  const lower = normalized.toLocaleLowerCase('en-US');
  if (/(^|\/)__tests__(\/|$)/.test(lower)
      || /(^|\/)fixtures(\/|$)/.test(lower)
      || /(^|\/)\.workflow\/knowhow(\/|$)/.test(lower)
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(lower)) {
    return true;
  }
  return excludeGlobs.some(pattern => globPattern(pattern).test(normalized));
}

async function productionFiles(paths: readonly string[], excludeGlobs: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const absolute = resolve(path);
    if (excludedProductionPath(absolute, excludeGlobs)) return;
    const info = await stat(absolute).catch(error => {
      fail('PRODUCTION_SCAN_IO', `cannot inspect production scan path: ${absolute}`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    });
    if (info.isDirectory()) {
      const names = (await readdir(absolute)).sort((left, right) => left.localeCompare(right));
      for (const name of names) await visit(join(absolute, name));
      return;
    }
    if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(absolute).toLocaleLowerCase('en-US'))) {
      files.push(absolute);
    }
  };
  for (const path of paths) await visit(path);
  return files.sort((left, right) => left.localeCompare(right));
}

function lineNumber(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source.charCodeAt(index) === 10) line += 1;
  return line;
}

function stringLiterals(source: string): Array<{ value: string; offset: number }> {
  const literals: Array<{ value: string; offset: number }> = [];
  const pattern = /(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[2].replace(/\\(['"`\\])/g, '$1');
    literals.push({ value, offset: match.index });
  }
  return literals;
}

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith(`..${sep}`) || rel === '..' ? path : rel;
}

export async function scanQuerySpecialCases(input: QuerySpecialCaseInput): Promise<QuerySpecialCaseScan> {
  const queries = new Set<string>();
  for (const queryFile of input.queryFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(queryFile, 'utf8')) as unknown;
    } catch (error) {
      fail('QUERY_SCAN_INPUT', `cannot parse query fixture: ${queryFile}`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    collectQueryStrings(parsed, queries);
  }
  if (queries.size === 0) fail('QUERY_SCAN_INPUT', 'query scanner received no query literals');

  const files = await productionFiles(input.productionPaths, input.excludeGlobs ?? []);
  const hits: QuerySpecialCaseHit[] = [];
  const branchPatterns = [
    /\b(?:isPiQuery|piBoost|boostPi)\b/g,
    /\bif\s*\([^\r\n]*(?:\bpi\b|['"`]pi['"`])[^\r\n]*\)/gi,
  ];

  for (const path of files) {
    const source = await readFile(path, 'utf8');
    const literals = stringLiterals(source);
    for (const query of queries) {
      for (const literal of literals) {
        if (literal.value !== query) continue;
        hits.push({
          path: displayPath(path),
          line: lineNumber(source, literal.offset),
          kind: 'query-literal',
          match: query,
        });
      }
    }
    for (const pattern of branchPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        hits.push({
          path: displayPath(path),
          line: lineNumber(source, match.index),
          kind: 'pi-branch',
          match: match[0],
        });
      }
    }
  }

  hits.sort((left, right) => left.path.localeCompare(right.path)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.match.localeCompare(right.match));
  return { querySpecialCaseHits: hits.length, hits, scannedFiles: files.length };
}

export async function assertNoQuerySpecialCases(
  input: QuerySpecialCaseInput,
): Promise<QuerySpecialCaseScan> {
  const scan = await scanQuerySpecialCases(input);
  if (scan.querySpecialCaseHits > 0) {
    fail('QUERY_SPECIAL_CASES', 'production query special cases detected', scan);
  }
  return scan;
}

function metricDelta(current: RankingMetrics, baseline: RankingMetrics): RankingMetrics {
  return {
    ndcgAt10: current.ndcgAt10 - baseline.ndcgAt10,
    mrrAt10: current.mrrAt10 - baseline.mrrAt10,
    recallAt20: current.recallAt20 - baseline.recallAt20,
  };
}

export interface RankingBaselineComparison {
  ok: boolean;
  overall: RankingMetrics;
  categories: Record<string, RankingMetrics>;
  overallNdcgGain: number;
  maxCategoryNdcgDrop: number;
  categoryNdcgDeltas: Record<string, number>;
  thresholds: {
    minOverallNdcgGain: number;
    maxCategoryNdcgDrop: number;
  };
}

export function compareRankingBaseline(
  report: Pick<SearchRankingReport, 'qrelsSha256' | 'metrics'>,
  baseline: RankingBaselineFixture,
  options: { minOverallNdcgGain?: number; maxCategoryNdcgDrop?: number } = {},
): RankingBaselineComparison {
  validateBaseline(baseline);
  if (report.qrelsSha256 !== baseline.qrelsSha256) {
    fail('QRELS_HASH_MISMATCH', 'qrels hash mismatch', {
      expected: baseline.qrelsSha256,
      actual: report.qrelsSha256,
    });
  }

  const minOverallNdcgGain = options.minOverallNdcgGain ?? 0.1;
  const maxCategoryNdcgDrop = options.maxCategoryNdcgDrop ?? 0.02;
  const overall = metricDelta(report.metrics.overall, baseline.metrics.overall);
  const categories: Record<string, RankingMetrics> = {};
  const categoryNdcgDeltas: Record<string, number> = {};
  for (const [category, metrics] of Object.entries(report.metrics.categories)) {
    const baselineMetrics = baseline.metrics.categories[category];
    if (!baselineMetrics) fail('INVALID_BASELINE', `baseline category missing: ${category}`);
    categories[category] = metricDelta(metrics, baselineMetrics);
    categoryNdcgDeltas[category] = categories[category].ndcgAt10;
  }
  const missingCategories = Object.keys(baseline.metrics.categories)
    .filter(category => !(category in report.metrics.categories))
    .sort();
  if (missingCategories.length > 0) {
    fail('INVALID_RANKING', 'candidate report is missing baseline categories', { missingCategories });
  }
  const observedMaxCategoryDrop = Math.max(
    0,
    ...Object.values(categoryNdcgDeltas).map(delta => -delta),
  );
  return {
    ok: overall.ndcgAt10 >= minOverallNdcgGain
      && observedMaxCategoryDrop <= maxCategoryNdcgDrop,
    overall,
    categories,
    overallNdcgGain: overall.ndcgAt10,
    maxCategoryNdcgDrop: observedMaxCategoryDrop,
    categoryNdcgDeltas,
    thresholds: { minOverallNdcgGain, maxCategoryNdcgDrop },
  };
}

export async function evaluateRanking(input: EvaluateRankingInput): Promise<SearchRankingReport> {
  const runs = input.runs ?? DEFAULT_QUALITY_RUNS;
  const topK = input.topK ?? DEFAULT_TOP_K;
  if (!Number.isInteger(runs) || runs < 1) fail('INVALID_PROTOCOL', 'runs must be a positive integer');
  if (!Number.isInteger(topK) || topK < DEFAULT_TOP_K) {
    fail('INVALID_PROTOCOL', `topK must be at least ${DEFAULT_TOP_K}`);
  }

  const baseline = await loadRankingFixture<RankingBaselineFixture>(input.baselinePath);
  validateBaseline(baseline);
  const qrelsSha256 = await sha256File(input.qrelsPath);
  assertQrelsHash(qrelsSha256, baseline);

  const [corpus, qrels, holdouts] = await Promise.all([
    loadRankingFixture<RankingCorpusFixture>(input.corpusPath),
    loadRankingFixture<RankingQrelsFixture>(input.qrelsPath),
    loadRankingFixture<RankingHoldoutsFixture>(input.holdoutsPath),
  ]);
  validateCorpus(corpus);
  validateHoldouts(holdouts);
  const corpusDocumentIds = new Set(corpus.documents.map(document => document.id));
  validateQrels(qrels, corpusDocumentIds);
  validateKnownOrderBaseline(baseline, qrels, corpusDocumentIds);
  assertHoldoutsDisjoint(holdouts, qrels, corpus);

  const workspace = await buildHermeticSearchWorkspace(corpus, input.workspaceRoot);
  const documents = expandCorpus(corpus);
  const ranker = input.ranker ?? lexicalFixtureRanker;
  const queryMetrics: Array<{ category: string; metrics: RankingMetrics }> = [];
  const stabilityQueries: QueryStability[] = [];
  const firstRankings = new Map<string, string[]>();

  for (const judgment of qrels.queries) {
    const top20Runs: string[][] = [];
    for (let run = 0; run < runs; run += 1) {
      const ranked = normalizeRanking(await ranker(judgment.query, documents, topK), topK);
      top20Runs.push(ranked.map(item => item.id));
    }
    assertStableTopK(top20Runs, judgment.id);
    firstRankings.set(judgment.id, top20Runs[0]);
    queryMetrics.push({
      category: judgment.category,
      metrics: computeRankingMetrics(top20Runs[0], judgment.relevance),
    });
    stabilityQueries.push({ queryId: judgment.id, top20Runs, stable: true });
  }

  const metrics = aggregateRankingMetrics(queryMetrics);
  const baselineComparison = compareRankingBaseline(
    { qrelsSha256, metrics },
    baseline,
  );
  if (!baselineComparison.ok) {
    fail('RANKING_QUALITY_GATE', 'ranking quality gate failed', baselineComparison);
  }

  const latencyQuery = qrels.queries[0]?.query;
  if (!latencyQuery) fail('INVALID_QRELS', 'latency protocol requires at least one query');
  for (let index = 0; index < LATENCY_WARMUPS; index += 1) {
    normalizeRanking(await ranker(latencyQuery, documents, topK), topK);
  }
  const latencySamples: number[] = [];
  for (let index = 0; index < LATENCY_SAMPLES; index += 1) {
    const started = performance.now();
    normalizeRanking(await ranker(latencyQuery, documents, topK), topK);
    latencySamples.push(performance.now() - started);
  }
  latencySamples.sort((left, right) => left - right);

  const documentById = new Map(documents.map(document => [document.id, document]));
  const returnedIds = [...new Set([...firstRankings.values()].flat())];
  const deprecatedLeakCount = returnedIds
    .filter(id => documentById.get(id)?.status === 'deprecated').length;
  const unauthorizedWorkspaceHitCount = returnedIds
    .filter(id => documentById.get(id)?.authorized === false).length;
  const provenanceLossCount = returnedIds
    .filter(id => !documentById.get(id)?.provenance).length;
  const scanner = input.productionPaths
    ? await assertNoQuerySpecialCases({
      queryFiles: [input.qrelsPath, input.holdoutsPath],
      productionPaths: input.productionPaths,
      excludeGlobs: input.excludeGlobs,
    })
    : { querySpecialCaseHits: 0, hits: [], scannedFiles: 0 };

  return {
    schema_version: 'search-ranking-report/1.0',
    ok: true,
    qrelsSha256,
    qrelsSha256Match: true,
    metrics,
    overallNdcgGain: baselineComparison.overallNdcgGain,
    maxCategoryNdcgDrop: baselineComparison.maxCategoryNdcgDrop,
    categoryNdcgDeltas: baselineComparison.categoryNdcgDeltas,
    qualityGate: {
      minOverallNdcgGain: 0.1,
      maxCategoryNdcgDrop: 0.02,
      pass: true,
    },
    stability: {
      runs,
      topK,
      stableTop20: stabilityQueries.every(item => item.stable),
      queries: stabilityQueries,
    },
    latency: {
      warmups: LATENCY_WARMUPS,
      measuredSamples: LATENCY_SAMPLES,
      p50Ms: roundedMilliseconds(percentile(latencySamples, 0.5)),
      p95Ms: roundedMilliseconds(percentile(latencySamples, 0.95)),
      maxMs: roundedMilliseconds(latencySamples[latencySamples.length - 1]),
      corpusSize: workspace.corpusSize,
      runner: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: cpus().length,
      },
    },
    scanner,
    integrity: {
      deprecatedLeakCount,
      unauthorizedWorkspaceHitCount,
      provenanceLossCount,
      holdoutOverlapCount: 0,
    },
    workspace,
  };
}
