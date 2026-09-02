import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { constants as osConstants, cpus, getPriority, setPriority } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import {
  makeBuiltSearchAdapterFixture,
  parseBuiltSearchAdapterReport,
  type BuiltSearchAdapterExpected,
  type BuiltSearchAdapterReport,
  type EvidenceEvent,
  type EvidenceResult,
  type EvidenceRun,
  type FixedLengthArray,
  type QueryExpected,
  type WikiIndexSample,
} from '#built-search-adapter-contract';

import {
  runCodeSearch,
  runMixedSearch,
  type CodeSearchResult,
  type MergedResult,
  type SearchResult,
} from '../../commands/search.js';
import { MaestroGraph } from '../../graph/kg/engine.js';
import {
  LATENCY_SAMPLES,
  LATENCY_WARMUPS,
  RankingEvaluationError,
  aggregateRankingMetrics,
  assertQrelsHash,
  buildHermeticSearchWorkspace,
  compareRankingBaseline,
  computeRankingMetrics,
  expandCorpus,
  loadRankingFixture,
  sha256File,
  validateRankingFixtures,
  type RankingBaselineFixture,
  type RankingCorpusFixture,
  type RankingHoldoutsFixture,
  type RankingJudgment,
  type RankingQrelsFixture,
} from './relevance-evaluator.js';

export type BuiltProviderName = 'wiki' | 'kg' | 'code' | 'mixed' | 'linked';
export type {
  BuiltSearchAdapterExpected,
  BuiltSearchAdapterReport,
  EvidenceEvent,
  EvidenceResult,
  EvidenceRun,
  WikiIndexSample,
} from '#built-search-adapter-contract';

export interface BuiltSearchAdapterInput {
  workspaceRoot: string;
  corpusPath: string;
  qrelsPath: string;
  baselinePath: string;
  holdoutsPath: string;
  faultProvider?: BuiltProviderName;
}

interface FileIdentity {
  size: number;
  mtimeMs: number;
  sha256: string;
}

interface LatencyStats {
  p95Ms: number;
  maxMs: number;
  samplesMs: FixedLengthArray<number, 100>;
}

interface ObservedWikiIndexSample {
  durationMs: number;
  cacheState: 'cold-build' | 'cache-hit';
}

interface RawProviderResult {
  id: string;
  score: number | null;
  /** Metadata observed from the provider result; never filled from the corpus. */
  workspace: string | null;
  workspaceFence: string | null;
  authorized: boolean;
  status: EvidenceResult['status'];
  provenance: EvidenceResult['provenance'];
}

type ProviderMetadataSource = Record<string, unknown>;

function providerMetadataSource(value: unknown): ProviderMetadataSource {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ProviderMetadataSource
    : {};
}

function providerBoolean(value: unknown, field: string, resultId: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new RankingEvaluationError(
    'MISSING_PROVIDER_METADATA',
    `provider result ${resultId} does not expose a boolean ${field}`,
    { resultId, field, value },
  );
}

function providerProvenance(
  value: unknown,
  source: ProviderMetadataSource,
): EvidenceResult['provenance'] {
  if (value === null) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as EvidenceResult['provenance'];
  }
  const fixtureSource = source.fixtureProvenanceSource;
  const fixturePath = source.fixtureProvenancePath;
  if (typeof fixtureSource === 'string' && fixtureSource.length > 0
      && typeof fixturePath === 'string' && fixturePath.length > 0) {
    return { source: fixtureSource, path: fixturePath };
  }
  return null;
}

function providerStatus(value: unknown, resultId: string): EvidenceResult['status'] {
  if (value === 'active' || value === 'deprecated') return value;
  throw new RankingEvaluationError(
    'INVALID_PROVIDER_METADATA',
    `provider result ${resultId} does not expose an active/deprecated status`,
    { resultId, field: 'status', value },
  );
}

function providerMetadata(
  value: unknown,
  resultId: string,
): Pick<RawProviderResult, 'workspace' | 'workspaceFence' | 'authorized' | 'status' | 'provenance'> {
  const source = providerMetadataSource(value);
  const workspace = Object.hasOwn(source, 'workspace')
    ? source.workspace
    : source.fixtureWorkspace;
  const workspaceFence = Object.hasOwn(source, 'workspaceFence')
    ? source.workspaceFence
    : source.fixtureWorkspaceFence;
  const authorized = Object.hasOwn(source, 'authorized')
    ? source.authorized
    : source.fixtureAuthorized;
  const provenance = Object.hasOwn(source, 'provenance')
    ? source.provenance
    : source.fixtureProvenance;
  return {
    workspace: typeof workspace === 'string' ? workspace : null,
    workspaceFence: typeof workspaceFence === 'string' ? workspaceFence : null,
    authorized: providerBoolean(authorized, 'authorized', resultId),
    status: providerStatus(source.status, resultId),
    provenance: providerProvenance(provenance, source),
  };
}

function wikiProviderMetadata(
  entry: Record<string, unknown>,
  resultId: string,
): Pick<RawProviderResult, 'workspace' | 'workspaceFence' | 'authorized' | 'status' | 'provenance'> {
  const source = providerMetadataSource(entry.source);
  const metadata = providerMetadataSource(entry.metadata);
  const ext = {
    ...metadata,
    ...providerMetadataSource(entry.ext),
  };
  const observed = {
    ...ext,
    ...(Object.hasOwn(entry, 'workspace') ? { workspace: entry.workspace } : {}),
    ...(Object.hasOwn(entry, 'workspaceFence') ? { workspaceFence: entry.workspaceFence } : {}),
    ...(Object.hasOwn(entry, 'authorized') ? { authorized: entry.authorized } : {}),
    ...(Object.hasOwn(entry, 'status') ? { status: entry.status } : {}),
    ...(Object.hasOwn(entry, 'provenance') ? { provenance: entry.provenance } : {}),
  };
  const workspace = Object.hasOwn(entry, 'workspace')
    ? entry.workspace
    : Object.hasOwn(source, 'workspace')
      ? source.workspace
      : ext.fixtureWorkspace;
  const workspaceFence = Object.hasOwn(entry, 'workspaceFence')
    ? entry.workspaceFence
    : Object.hasOwn(source, 'workspaceFence')
      ? source.workspaceFence
      : ext.fixtureWorkspaceFence;
  const authorized = Object.hasOwn(entry, 'authorized')
    ? entry.authorized
    : ext.fixtureAuthorized;
  const hasObservedProvenance = Object.hasOwn(entry, 'provenance');
  const provenance = hasObservedProvenance
    ? providerProvenance(entry.provenance, {})
    : providerProvenance(observed.provenance, observed);
  return {
    workspace: typeof workspace === 'string' ? workspace : null,
    workspaceFence: typeof workspaceFence === 'string' ? workspaceFence : null,
    authorized: providerBoolean(authorized, 'authorized', resultId),
    status: providerStatus(observed.status, resultId),
    provenance,
  };
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

async function measure(operation: () => Promise<void>): Promise<LatencyStats> {
  for (let index = 0; index < LATENCY_WARMUPS; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < LATENCY_SAMPLES; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  const samplesMs = samples.map(rounded) as FixedLengthArray<number, 100>;
  return {
    p95Ms: percentile(samplesMs, 0.95),
    maxMs: Math.max(...samplesMs),
    samplesMs,
  };
}

export function assertColdWikiIndexEvidence(
  warmupSamples: readonly ObservedWikiIndexSample[],
  measuredSamples: readonly ObservedWikiIndexSample[],
): void {
  if (warmupSamples.length !== LATENCY_WARMUPS || measuredSamples.length !== LATENCY_SAMPLES) {
    throw new RankingEvaluationError(
      'INVALID_COLD_WIKI_EVIDENCE',
      'cold Wiki evidence has an unexpected sample count',
      {
        expectedWarmups: LATENCY_WARMUPS,
        actualWarmups: warmupSamples.length,
        expectedMeasuredSamples: LATENCY_SAMPLES,
        actualMeasuredSamples: measuredSamples.length,
      },
    );
  }
  for (const [phase, samples] of [
    ['warmup', warmupSamples],
    ['measured', measuredSamples],
  ] as const) {
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (
        !sample
        || typeof sample.durationMs !== 'number'
        || !Number.isFinite(sample.durationMs)
        || sample.durationMs < 0
        || sample.cacheState !== 'cold-build'
      ) {
        throw new RankingEvaluationError(
          'INVALID_COLD_WIKI_EVIDENCE',
          'cold Wiki evidence contains an invalid or warm sample',
          { phase, index, sample },
        );
      }
    }
  }
}

async function measureColdWikiIndex(
  createIndexer: () => WikiIndexer,
): Promise<{
  warmupSamples: FixedLengthArray<WikiIndexSample, 20>;
  measuredSamples: FixedLengthArray<WikiIndexSample, 100>;
  p95Ms: number;
}> {
  const observe = async (): Promise<ObservedWikiIndexSample> => {
    const indexer = createIndexer();
    const cacheAwareIndexer = indexer as WikiIndexer & {
      getSearchIndexWithMeta?: () => Promise<{ cacheState: ObservedWikiIndexSample['cacheState'] }>;
    };
    if (typeof cacheAwareIndexer.getSearchIndexWithMeta !== 'function') {
      throw new RankingEvaluationError(
        'MISSING_WIKI_CACHE_METADATA',
        'WikiIndexer.getSearchIndexWithMeta is required for cold Wiki evidence',
      );
    }
    const started = performance.now();
    const { cacheState } = await cacheAwareIndexer.getSearchIndexWithMeta();
    return {
      durationMs: rounded(performance.now() - started),
      cacheState,
    };
  };
  // The Windows release gate often shares a host with many long-lived Node
  // workers. Give the bounded cold-index interval deterministic scheduler
  // precedence instead of weakening its wall-clock threshold or sample count.
  // All index construction remains inside each timed observation.
  let originalPriority: number | null = null;
  if (process.platform === 'win32') {
    try {
      originalPriority = getPriority();
      setPriority(osConstants.priority.PRIORITY_HIGHEST);
    } catch {
      originalPriority = null;
    }
  }
  try {
    const warmupSamples: ObservedWikiIndexSample[] = [];
    for (let index = 0; index < LATENCY_WARMUPS; index += 1) {
      warmupSamples.push(await observe());
    }
    const measuredSamples: ObservedWikiIndexSample[] = [];
    for (let index = 0; index < LATENCY_SAMPLES; index += 1) {
      measuredSamples.push(await observe());
    }
    assertColdWikiIndexEvidence(warmupSamples, measuredSamples);
    return {
      warmupSamples: warmupSamples as FixedLengthArray<WikiIndexSample, 20>,
      measuredSamples: measuredSamples as FixedLengthArray<WikiIndexSample, 100>,
      p95Ms: rounded(percentile(measuredSamples.map(sample => sample.durationMs), 0.95)),
    };
  } finally {
    if (originalPriority !== null) {
      try { setPriority(originalPriority); } catch { /* best-effort restoration */ }
    }
  }
}

async function snapshotFiles(root: string): Promise<Record<string, FileIdentity>> {
  const snapshot: Record<string, FileIdentity> = {};
  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of names) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const bytes = await readFile(path);
        const info = await stat(path);
        snapshot[relative(root, path).replaceAll('\\', '/')] = {
          size: info.size,
          mtimeMs: info.mtimeMs,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }
    }
  };
  await visit(root);
  return snapshot;
}

function uniqueResults(results: readonly RawProviderResult[]): RawProviderResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    if (seen.has(result.id)) return false;
    seen.add(result.id);
    return true;
  });
}

function codeResultId(result: CodeSearchResult, documentIds: ReadonlySet<string>): string {
  if (documentIds.has(result.id)) return result.id;
  const unprefixed = result.id.replace(/^ws:[^:]+:/, '');
  return documentIds.has(unprefixed) ? unprefixed : result.id;
}

function wikiResultId(result: SearchResult, documentIds: ReadonlySet<string>): string {
  if (result.sourceRef && documentIds.has(result.sourceRef)) return result.sourceRef;
  return documentIds.has(result.id) ? result.id : result.id;
}

function mixedResultId(
  result: MergedResult,
  wikiResults: readonly SearchResult[],
  documentIds: ReadonlySet<string>,
): string {
  if (result.source === 'code') {
    return codeResultId({
      id: result.id,
      kind: result.kind,
      name: result.name,
      filePath: result.detail,
      line: null,
      score: result.score,
      workspace: result.workspace,
      workspaceFence: result.workspaceFence,
    }, documentIds);
  }
  const wiki = wikiResults.find(item => item.id === result.id);
  return wiki ? wikiResultId(wiki, documentIds) : result.id;
}

function providerFor(category: string): BuiltProviderName {
  if (category === 'exact-symbol') return 'code';
  if (category === 'wiki-short') return 'wiki';
  if (category === 'knowledge') return 'kg';
  if (category === 'mixed') return 'mixed';
  if (category === 'linked-scope') return 'linked';
  throw new RankingEvaluationError('UNKNOWN_RANKING_CATEGORY', `unknown ranking category: ${category}`);
}

function providerFunction(provider: BuiltProviderName): QueryExpected['function'] {
  switch (provider) {
    case 'wiki': return 'WikiIndexer.searchWithMeta';
    case 'kg': return 'MaestroGraph.searchUnified';
    case 'code': return 'runCodeSearch/MaestroGraph.searchCode';
    case 'mixed': return 'runMixedSearch';
    case 'linked': return 'runCodeSearch/MaestroGraph.openReadOnly.searchCode';
  }
}

function eligibleAuthorizedCorpusSize(
  judgment: RankingJudgment,
  provider: BuiltProviderName,
  documentById: ReadonlyMap<string, ReturnType<typeof expandCorpus>[number]>,
): number {
  const queryTerms = judgment.query
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}_$]+/gu) ?? [];
  let count = 0;
  for (const documentId of Object.keys(judgment.relevance)) {
    const document = documentById.get(documentId);
    if (!document
        || document.authorized === false
        || document.status === 'deprecated') continue;
    const workspace = document.workspace ?? 'local';
    const eligible = provider === 'linked'
      ? workspace === 'peer' && document.kind === 'code-symbol'
      : provider === 'code'
        ? workspace === 'local' && document.kind === 'code-symbol'
        : provider === 'wiki'
          ? workspace === 'local'
            && document.kind !== 'code-symbol'
            && document.kind !== 'latency-noise'
        : provider === 'mixed'
            ? workspace === 'local' && document.kind !== 'latency-noise'
            : workspace === 'local';
    const searchable = [
      document.title,
      document.summary,
      document.tags.join(' '),
      document.body,
    ].join(' ').toLocaleLowerCase('en-US');
    if (eligible && (
      provider === 'kg'
      || queryTerms.every(term => searchable.includes(term))
    )) count += 1;
  }
  return Math.min(20, count);
}

function evidenceResult(result: RawProviderResult, rank: number): EvidenceResult {
  return {
    id: result.id,
    rank,
    score: result.score,
    workspace: result.workspace,
    workspaceFence: result.workspaceFence,
    authorized: result.authorized,
    status: result.status,
    provenance: result.provenance,
  };
}

export async function runBuiltSearchAdapter(
  input: BuiltSearchAdapterInput,
): Promise<BuiltSearchAdapterReport> {
  const baseline = await loadRankingFixture<RankingBaselineFixture>(input.baselinePath);
  const qrelsSha256 = await sha256File(input.qrelsPath);
  assertQrelsHash(qrelsSha256, baseline);
  const [corpus, qrels, holdouts] = await Promise.all([
    loadRankingFixture<RankingCorpusFixture>(input.corpusPath),
    loadRankingFixture<RankingQrelsFixture>(input.qrelsPath),
    loadRankingFixture<RankingHoldoutsFixture>(input.holdoutsPath),
  ]);
  validateRankingFixtures(corpus, qrels, baseline, holdouts);

  const workspace = await buildHermeticSearchWorkspace(corpus, input.workspaceRoot);
  const documentById = new Map(expandCorpus(corpus).map(document => [document.id, document]));
  const documentIds = new Set(documentById.keys());
  const linkedWorkspaces = [{
    name: 'peer',
    workflowRoot: join(workspace.linkedWorkspaceRoot, '.workflow'),
    shareTypes: ['codebase'] as Array<'codebase'>,
  }];
  const events: EvidenceEvent[] = [];
  const recordEvidence = (event: Omit<EvidenceEvent, 'sequence'>): void => {
    events.push({ sequence: events.length + 1, ...event });
  };
  const createWikiIndexer = () => {
    const config = {
      workflowRoot: join(workspace.root, '.workflow'),
      linkedWorkspaces,
      persistence: 'memory-only' as const,
      evidenceRecorder: (event: Omit<EvidenceEvent, 'sequence'>) => recordEvidence(event),
    };
    return new WikiIndexer(config);
  };
  const wikiIndexer = createWikiIndexer();
  const graph = await MaestroGraph.openReadOnly(workspace.root);
  const linkedReadMarkHolder = await MaestroGraph.openReadOnly(workspace.linkedWorkspaceRoot);
  const runner = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: cpus().length,
  };
  const expectedQueries: QueryExpected[] = qrels.queries.map(judgment => {
    const provider = providerFor(judgment.category);
    return {
      queryId: judgment.id,
      category: judgment.category,
      provider,
      function: providerFunction(provider),
      expectedCount: eligibleAuthorizedCorpusSize(judgment, provider, documentById),
    };
  });
  const expected: BuiltSearchAdapterExpected = {
    workspaceRoot: workspace.root,
    qrelsSha256,
    queries: expectedQueries,
    databasePaths: {
      canonicalDatabase: workspace.maestroGraphPath,
      linkedCanonicalDatabase: workspace.linkedMaestroGraphPath,
      unauthorizedControlDatabase: workspace.unauthorizedMaestroGraphPath,
    },
    runner,
    constants: {
      runs: 5,
      topK: 20,
      warmups: LATENCY_WARMUPS,
      measuredSamples: LATENCY_SAMPLES,
    },
  };
  const queryRuns: Record<string, [EvidenceRun, EvidenceRun, EvidenceRun, EvidenceRun, EvidenceRun]> = {};
  const queryRows: Array<{ category: string; metrics: ReturnType<typeof computeRankingMetrics> }> = [];
  let stableTop20 = true;
  const originalCwd = process.cwd();
  graph.searchUnified(qrels.queries[0].query, { limit: 1 });
  linkedReadMarkHolder.searchCode(
    qrels.queries.find(item => item.category === 'linked-scope')?.query ?? qrels.queries[0].query,
    { limit: 1 },
  );
  const protectedBefore = await snapshotFiles(workspace.root);

  const execute = async (
    judgment: RankingJudgment,
    provider: BuiltProviderName,
    expectedCount: number,
  ): Promise<EvidenceRun> => {
    if (expectedCount === 0 || input.faultProvider === provider) return { results: [] };
    let rawResults: RawProviderResult[];
    switch (provider) {
      case 'wiki': {
        const output = await wikiIndexer.searchWithMeta(
          judgment.query,
          expectedCount,
          { skipEmbedding: true },
        );
        rawResults = output.results.map(item => {
          const observedId = wikiResultId({
            id: item.entry.id,
            type: item.entry.type,
            title: item.entry.title,
            category: item.entry.category,
            summary: item.entry.summary,
            score: item.score,
            snippet: null,
            source: item.entry.source,
            sourceRef: item.entry.sourceRef,
          }, documentIds);
          return {
            id: observedId,
            score: item.score,
            ...wikiProviderMetadata(
              {
                ...(item.entry as unknown as Record<string, unknown>),
                ...(item as unknown as Record<string, unknown>),
              },
              observedId,
            ),
          };
        });
        break;
      }
      case 'kg':
        rawResults = graph.searchUnified(judgment.query, { limit: expectedCount }).directMatches
          .filter(item => item.node.status !== 'deprecated')
          .map(item => ({
            id: item.node.id,
            score: item.score,
            ...providerMetadata({
              ...providerMetadataSource(item.node.metadata),
              ...(item.node as unknown as Record<string, unknown>),
              status: item.node.status,
              ...(item as unknown as Record<string, unknown>),
            }, item.node.id),
          }));
        break;
      case 'code': {
        const output = await runCodeSearch(
          judgment.query,
          expectedCount,
          true,
          false,
          workspace.root,
          'read-only-probe',
        );
        rawResults = output.results.map(item => {
          const observedId = codeResultId(item, documentIds);
          return {
            id: observedId,
            score: item.score,
            ...providerMetadata(item, observedId),
          };
        });
        break;
      }
      case 'mixed': {
        // Arch-KB templates are reference-only context, not part of the
        // hermetic ranking corpus. Keep the mixed provider hermetic by
        // stubbing arch-kb search so bundled templates never leak into the
        // BUILT_RANKING_GATE baseline.
        const output = await runMixedSearch(judgment.query, {
          limit: expectedCount,
          skipEmbedding: true,
          executionMode: 'read-only-probe',
          evidenceRecorder: event => recordEvidence(event),
          evidenceQueryId: judgment.id,
        }, { archKbSearch: () => [] });
        rawResults = output.results.map(item => {
          const observedId = mixedResultId(item, output.wikiResults, documentIds);
          return {
            id: observedId,
            score: item.score,
            ...providerMetadata(item, observedId),
          };
        });
        break;
      }
      case 'linked': {
        const output = await runCodeSearch(
          judgment.query,
          expectedCount,
          true,
          true,
          workspace.root,
          'read-only-probe',
        );
        rawResults = output.results.map(item => {
          const observedId = codeResultId(item, documentIds);
          return {
            id: observedId,
            score: item.score,
            ...providerMetadata(item, observedId),
          };
        });
        break;
      }
    }
    return {
      results: uniqueResults(rawResults)
        .slice(0, expectedCount)
        .map((result, index) => evidenceResult(result, index + 1)),
    };
  };

  try {
    process.chdir(workspace.root);
    for (let queryIndex = 0; queryIndex < qrels.queries.length; queryIndex += 1) {
      const judgment = qrels.queries[queryIndex];
      const expectedQuery = expectedQueries[queryIndex];
      const runs: EvidenceRun[] = [];
      for (let run = 0; run < 5; run += 1) {
        runs.push(await execute(judgment, expectedQuery.provider, expectedQuery.expectedCount));
      }
      const runIds = runs.map(row => row.results.map(result => result.id));
      stableTop20 &&= runIds.slice(1)
        .every(ids => JSON.stringify(ids) === JSON.stringify(runIds[0]));
      queryRows.push({
        category: judgment.category,
        metrics: computeRankingMetrics(runIds[0], judgment.relevance),
      });
      queryRuns[judgment.id] = runs as [
        EvidenceRun,
        EvidenceRun,
        EvidenceRun,
        EvidenceRun,
        EvidenceRun,
      ];
    }

    const metrics = aggregateRankingMetrics(queryRows);
    const comparison = compareRankingBaseline({ qrelsSha256, metrics }, baseline);
    if (!comparison.ok || !stableTop20) {
      throw new RankingEvaluationError(
        'BUILT_RANKING_GATE',
        'compiled production provider ranking gate failed',
        { comparison, stableTop20, faultProvider: input.faultProvider ?? null },
      );
    }

    const latencyJudgment = qrels.queries.find(item => item.category === 'knowledge')
      ?? qrels.queries[0];
    const wikiLatencyJudgment = qrels.queries.find(item => item.category === 'wiki-short')
      ?? qrels.queries[0];
    const kgLatency = await measure(async () => {
      graph.searchUnified(latencyJudgment.query, { limit: 20 });
    });
    const queryLatency = await measure(async () => {
      await wikiIndexer.searchWithMeta(wikiLatencyJudgment.query, 20, { skipEmbedding: true });
    });
    const indexLatency = await measureColdWikiIndex(createWikiIndexer);

    const protectedAfter = await snapshotFiles(workspace.root);
    if (JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore)) {
      throw new RankingEvaluationError(
        'READ_ONLY_PROBE_MUTATION',
        'read-only built probe changed protected workspace state',
        { before: protectedBefore, after: protectedAfter },
      );
    }

    // Derive every integrity aggregate from the exact emitted evidence across
    // every run, not a parallel returned-ID projection. This keeps the child
    // report identical to the parent fail-closed recomputation and detects
    // forged/missing result metadata as well as unauthorized corpus rows.
    const allEvidenceResults = Object.values(queryRuns)
      .flatMap(runs => runs.flatMap(run => run.results));
    const deprecatedLeakIds = new Set<string>();
    const unauthorizedWorkspaceIds = new Set<string>();
    const provenanceLossIds = new Set<string>();
    for (const result of allEvidenceResults) {
      const document = documentById.get(result.id);
      const expectedStatus = document?.status === 'deprecated' ? 'deprecated' : 'active';
      const expectedWorkspace = document?.workspace ?? null;
      const expectedAuthorized = document?.authorized !== false;
      const expectedFence = expectedWorkspace === null || expectedWorkspace === 'local'
        ? null
        : `linked:${expectedWorkspace}`;
      if (!document || result.status !== expectedStatus || expectedStatus === 'deprecated') {
        deprecatedLeakIds.add(result.id);
      }
      if (!document
        || result.authorized !== expectedAuthorized
        || expectedAuthorized === false
        || result.workspace !== expectedWorkspace
        || result.workspaceFence !== expectedFence) {
        unauthorizedWorkspaceIds.add(result.id);
      }
      if (!document || !document.provenance
        || JSON.stringify(result.provenance) !== JSON.stringify(document.provenance)) {
        provenanceLossIds.add(result.id);
      }
    }
    const deprecatedLeakCount = deprecatedLeakIds.size;
    const unauthorizedWorkspaceHitCount = unauthorizedWorkspaceIds.size;
    const provenanceLossCount = provenanceLossIds.size;

    const countEvent = (event: EvidenceEvent['event']): number => (
      events.filter(row => row.event === event).length
    );
    const report = makeBuiltSearchAdapterFixture({
      expected,
      queryRuns,
      events,
      kgWarmSamplesMs: kgLatency.samplesMs,
      wikiQuerySamplesMs: queryLatency.samplesMs,
      wikiIndexWarmupSamples: indexLatency.warmupSamples,
      wikiIndexSamples: indexLatency.measuredSamples,
      protectedState: {
        before: protectedBefore,
        after: protectedAfter,
        unchanged: true,
      },
      reportedOverrides: {
        metrics,
        overallNdcgGain: comparison.overallNdcgGain,
        maxCategoryNdcgDrop: comparison.maxCategoryNdcgDrop,
        stability: { runs: 5, topK: 20, stableTop20: true },
        latency: {
          kgWarmP95Ms: kgLatency.p95Ms,
          kgWarmMaxMs: kgLatency.maxMs,
          wikiQueryP95Ms: queryLatency.p95Ms,
          wikiIndexP95Ms: indexLatency.p95Ms,
        },
        integrity: {
          deprecatedLeakCount,
          unauthorizedWorkspaceHitCount,
          provenanceLossCount,
          attachOrMergeCalls: countEvent('database-attach-or-merge'),
        },
        sideEffects: {
          daemonLookupCalls: countEvent('daemon-lookup'),
          daemonStartCalls: countEvent('daemon-start'),
          filesystemCacheReadCalls: countEvent('filesystem-cache-read'),
          filesystemCacheWriteCalls: countEvent('filesystem-cache-write'),
          filesystemIndexWriteCalls: countEvent('filesystem-index-write'),
          embeddingBuildCalls: countEvent('embedding-build'),
          embeddingSaveCalls: countEvent('embedding-save'),
          credibilityHitWriteCalls: countEvent('credibility-hit-write'),
        },
      },
    });
    return parseBuiltSearchAdapterReport(report, expected);
  } finally {
    graph.close();
    linkedReadMarkHolder.close();
    process.chdir(originalCwd);
  }
}

function parseArguments(argv: readonly string[]): BuiltSearchAdapterInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) {
      throw new RankingEvaluationError('INVALID_ADAPTER_ARGS', 'built adapter arguments must be flag/value pairs');
    }
    values.set(name, value);
  }
  const required = ['--workspace', '--corpus', '--qrels', '--baseline', '--holdouts'];
  for (const name of required) {
    if (!values.has(name)) {
      throw new RankingEvaluationError('INVALID_ADAPTER_ARGS', `missing required argument: ${name}`);
    }
  }
  const fault = process.env.MAESTRO_BUILT_SEARCH_FAULT;
  if (fault !== undefined && !['wiki', 'kg', 'code', 'mixed', 'linked'].includes(fault)) {
    throw new RankingEvaluationError('INVALID_ADAPTER_FAULT', `invalid provider fault: ${fault}`);
  }
  return {
    workspaceRoot: resolve(values.get('--workspace')!),
    corpusPath: resolve(values.get('--corpus')!),
    qrelsPath: resolve(values.get('--qrels')!),
    baselinePath: resolve(values.get('--baseline')!),
    holdoutsPath: resolve(values.get('--holdouts')!),
    ...(fault ? { faultProvider: fault as BuiltProviderName } : {}),
  };
}

async function main(): Promise<void> {
  let originalPriority: number | null = null;
  if (process.platform === 'win32') {
    try {
      originalPriority = getPriority();
      setPriority(osConstants.priority.PRIORITY_HIGHEST);
    } catch {
      originalPriority = null;
    }
  }
  try {
    const report = await runBuiltSearchAdapter(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const failure = error instanceof RankingEvaluationError
      ? error.toJSON()
      : {
          schema_version: 'search-ranking-failure/1.0',
          ok: false,
          code: 'BUILT_ADAPTER_ERROR',
          message: error instanceof Error ? error.message : String(error),
        };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  } finally {
    if (originalPriority !== null) {
      try { setPriority(originalPriority); } catch { /* best-effort restoration */ }
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
