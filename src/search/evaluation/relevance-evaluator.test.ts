import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#maestro-dashboard/wiki/wiki-indexer.js', async () => (
  vi.importActual('../../../dashboard/src/server/wiki/wiki-indexer.js')
));

import {
  assertNoQuerySpecialCases,
  assertStableTopK,
  computeKnownOrderBaselineMetrics,
  computeRankingMetrics,
  evaluateRanking,
  lexicalFixtureRanker,
  loadRankingFixture,
  RankingEvaluationError,
  scanQuerySpecialCases,
  sha256File,
  type RankingBaselineFixture,
  type RankingProvider,
  type RankingQrelsFixture,
  type RankingCorpusFixture,
} from './relevance-evaluator.js';
import {
  assertColdWikiIndexEvidence,
  runBuiltSearchAdapter,
  type BuiltSearchAdapterExpected,
  type BuiltSearchAdapterReport,
  type WikiIndexSample,
} from './built-search-adapter.js';
import { parseBuiltSearchAdapterReport } from '#built-search-adapter-contract';

const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const corpusPath = join(fixturesRoot, 'search-ranking-corpus.json');
const qrelsPath = join(fixturesRoot, 'search-ranking-qrels.json');
const baselinePath = join(fixturesRoot, 'search-ranking-baseline.json');
const holdoutsPath = join(fixturesRoot, 'search-ranking-holdouts.json');
const repoRoot = join(fixturesRoot, '..', '..', '..', '..');
const generateContractPath = join(repoRoot, 'scripts', 'generate-built-search-adapter-contract.mjs');
const contractSchemaPath = join(fixturesRoot, '..', 'built-search-adapter-contract.json');
const contractRuntimePath = join(repoRoot, 'shared', 'built-search-adapter-contract.mjs');
const contractDeclarationPath = join(repoRoot, 'shared', 'built-search-adapter-contract.d.mts');
const execFileAsync = promisify(execFile);

let testRoot: string;
let coldEvidenceRoot: string | null = null;
let coldEvidenceReportPromise: Promise<BuiltSearchAdapterReport> | null = null;

async function write(relativePath: string, body: string): Promise<string> {
  const path = join(testRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, 'utf8');
  return path;
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'search-ranking-evaluator-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true, maxRetries: 3 });
});

afterAll(async () => {
  if (coldEvidenceRoot) {
    await rm(coldEvidenceRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function getColdEvidenceReport(): Promise<BuiltSearchAdapterReport> {
  if (!coldEvidenceReportPromise) {
    coldEvidenceRoot = await mkdtemp(join(tmpdir(), 'search-ranking-cold-wiki-'));
    coldEvidenceReportPromise = runBuiltSearchAdapter({
      workspaceRoot: join(coldEvidenceRoot, 'workspace'),
      corpusPath,
      qrelsPath,
      baselinePath,
      holdoutsPath,
    });
  }
  return coldEvidenceReportPromise;
}

function coldWikiP95(samples: readonly WikiIndexSample[]): number {
  const durations = samples.map(sample => sample.durationMs)
    .sort((left, right) => left - right);
  return durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
}

function expectedForReport(report: BuiltSearchAdapterReport): BuiltSearchAdapterExpected {
  return {
    workspaceRoot: report.workspace.root,
    qrelsSha256: report.qrelsSha256,
    queries: report.evidence.queries.map(({
      queryId,
      category,
      provider,
      function: providerFunction,
      expectedCount,
    }) => ({
      queryId,
      category,
      provider,
      function: providerFunction,
      expectedCount,
    })),
    databasePaths: {
      canonicalDatabase: report.workspace.canonicalDatabase,
      linkedCanonicalDatabase: report.workspace.linkedCanonicalDatabase,
      unauthorizedControlDatabase: report.workspace.unauthorizedControlDatabase,
    },
    runner: report.runner,
    constants: { runs: 5, topK: 20, warmups: 20, measuredSamples: 100 },
  };
}

describe('ranking metric goldens', () => {
  it('returns exact ones for a perfect order', () => {
    const metrics = computeRankingMetrics(
      ['doc-3', 'doc-2', 'doc-1'],
      { 'doc-3': 3, 'doc-2': 2, 'doc-1': 1 },
    );

    expect(metrics).toEqual({ ndcgAt10: 1, mrrAt10: 1, recallAt20: 1 });
  });

  it('matches a hand-calculated known order', () => {
    const metrics = computeRankingMetrics(
      ['doc-2', 'irrelevant', 'doc-3', 'doc-1'],
      { 'doc-3': 3, 'doc-2': 2, 'doc-1': 1 },
    );
    const dcg = 3 + 7 / Math.log2(4) + 1 / Math.log2(5);
    const idcg = 7 + 3 / Math.log2(3) + 1 / Math.log2(4);

    expect(metrics.ndcgAt10).toBeCloseTo(dcg / idcg, 12);
    expect(metrics.mrrAt10).toBe(1);
    expect(metrics.recallAt20).toBe(1);
  });
});

describe('hash-fenced hermetic evaluator', () => {
  it('recomputes the frozen pre-change known-order baseline', async () => {
    const baseline = await loadRankingFixture<RankingBaselineFixture>(baselinePath);
    const qrels = await loadRankingFixture<RankingQrelsFixture>(qrelsPath);
    const recomputed = computeKnownOrderBaselineMetrics(qrels, baseline.knownOrder);

    expect(recomputed).toEqual(baseline.metrics);
    expect(recomputed.overall).toEqual({
      ndcgAt10: 0.6386973302411959,
      mrrAt10: 0.5,
      recallAt20: 1,
    });
    expect(recomputed.categories).toMatchObject({
      'exact-symbol': { ndcgAt10: 0.6309297535714575 },
      knowledge: { ndcgAt10: 0.6353821444486659 },
      'linked-scope': { ndcgAt10: 0.6309297535714575 },
      mixed: { ndcgAt10: 0.6653152460429406 },
      'wiki-short': { ndcgAt10: 0.6309297535714575 },
    });
  });

  it('emits stable machine JSON from a 2000-document temporary workspace', async () => {
    const productionPath = await write('production/search.ts', 'export const stableRanking = true;\n');
    const report = await evaluateRanking({
      workspaceRoot: join(testRoot, 'workspace'),
      corpusPath,
      qrelsPath,
      baselinePath,
      holdoutsPath,
      runs: 5,
      productionPaths: [productionPath],
    });

    expect(report.schema_version).toBe('search-ranking-report/1.0');
    expect(report.qrelsSha256).toBe(await sha256File(qrelsPath));
    expect(report.qrelsSha256Match).toBe(true);
    expect(report.overallNdcgGain).toBeCloseTo(0.3613026697588041, 12);
    expect(report.maxCategoryNdcgDrop).toBe(0);
    expect(report.categoryNdcgDeltas).toMatchObject({
      'exact-symbol': 0.36907024642854247,
      knowledge: 0.3646178555513341,
      'linked-scope': 0.36907024642854247,
      mixed: 0.33468475395705943,
      'wiki-short': 0.36907024642854247,
    });
    expect(report.qualityGate).toEqual({
      minOverallNdcgGain: 0.1,
      maxCategoryNdcgDrop: 0.02,
      pass: true,
    });
    expect(Object.keys(report.metrics.categories).sort()).toEqual([
      'exact-symbol',
      'knowledge',
      'linked-scope',
      'mixed',
      'wiki-short',
    ]);
    expect(report.stability.runs).toBe(5);
    expect(report.stability.stableTop20).toBe(true);
    expect(report.stability.queries.every(query => query.top20Runs.length === 5)).toBe(true);
    expect(report.latency).toMatchObject({
      warmups: 20,
      measuredSamples: 100,
      corpusSize: 2000,
    });
    expect(report.latency.p50Ms).toBeGreaterThanOrEqual(0);
    expect(report.latency.p95Ms).toBeGreaterThanOrEqual(report.latency.p50Ms);
    expect(report.latency.maxMs).toBeGreaterThanOrEqual(report.latency.p95Ms);
    expect(report.latency.runner.node).toBe(process.version);
    expect(report.scanner.querySpecialCaseHits).toBe(0);
    expect(report.integrity).toEqual({
      deprecatedLeakCount: 0,
      unauthorizedWorkspaceHitCount: 0,
      provenanceLossCount: 0,
      holdoutOverlapCount: 0,
    });
    expect(report.workspace.root.startsWith(join(testRoot, 'workspace'))).toBe(true);
    expect(report.workspace.maestroGraphPath).toBe(
      join(testRoot, 'workspace', '.workflow', 'kg', 'maestro.db'),
    );
  });

  it('normalizes equal scores with the stable ID tie-break', async () => {
    let reverse = false;
    const tiedRanker: RankingProvider = async (query, documents, limit) => {
      reverse = !reverse;
      const ranked = [...await lexicalFixtureRanker(query, documents, limit)];
      const tiedTail = documents
        .filter(document => document.kind === 'latency-noise')
        .slice(0, 2)
        .map(document => ({ id: document.id, score: -1 }));
      return [...ranked, ...(reverse ? tiedTail.reverse() : tiedTail)];
    };

    const report = await evaluateRanking({
      workspaceRoot: join(testRoot, 'tied-workspace'),
      corpusPath,
      qrelsPath,
      baselinePath,
      holdoutsPath,
      runs: 5,
      ranker: tiedRanker,
    });

    const firstQueryRuns = report.stability.queries[0].top20Runs;
    expect(firstQueryRuns.every(run => JSON.stringify(run) === JSON.stringify(firstQueryRuns[0]))).toBe(true);
    expect(firstQueryRuns[0].slice(-2)).toEqual(
      [...firstQueryRuns[0].slice(-2)].sort((left, right) => left.localeCompare(right)),
    );
  });

  it('hard-fails a deterministic candidate with no overall NDCG gain', async () => {
    const baseline = await loadRankingFixture<RankingBaselineFixture>(baselinePath);
    const qrels = await loadRankingFixture<RankingQrelsFixture>(qrelsPath);
    const queryIdByText = new Map(qrels.queries.map(query => [query.query, query.id]));
    const preChangeRanker: RankingProvider = query => {
      const queryId = queryIdByText.get(query);
      if (!queryId) return [];
      const order = baseline.knownOrder[queryId];
      return order.map((id, index) => ({ id, score: order.length - index }));
    };

    await expect(evaluateRanking({
      workspaceRoot: join(testRoot, 'no-gain-workspace'),
      corpusPath,
      qrelsPath,
      baselinePath,
      holdoutsPath,
      runs: 5,
      ranker: preChangeRanker,
    })).rejects.toThrow(/ranking quality gate failed/);
  });

  it('hard-fails a candidate whose category NDCG drops by more than two percent', async () => {
    const qrels = await loadRankingFixture<RankingQrelsFixture>(qrelsPath);
    const regressedQueries = new Set(
      qrels.queries.filter(query => query.category === 'wiki-short').slice(0, 2)
        .map(query => query.query),
    );
    const categoryRegressionRanker: RankingProvider = async (query, documents, limit) => (
      regressedQueries.has(query) ? [] : lexicalFixtureRanker(query, documents, limit)
    );

    let caught: unknown;
    try {
      await evaluateRanking({
        workspaceRoot: join(testRoot, 'category-drop-workspace'),
        corpusPath,
        qrelsPath,
        baselinePath,
        holdoutsPath,
        runs: 5,
        ranker: categoryRegressionRanker,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RankingEvaluationError);
    const failure = JSON.parse((caught as Error).message) as {
      code: string;
      details: { overallNdcgGain: number; maxCategoryNdcgDrop: number };
    };
    expect(failure.code).toBe('RANKING_QUALITY_GATE');
    expect(failure.details.overallNdcgGain).toBeGreaterThanOrEqual(0.1);
    expect(failure.details.maxCategoryNdcgDrop).toBeGreaterThan(0.02);
  });

  it('fails on one-byte qrels drift before building a workspace or calculating deltas', async () => {
    const driftedQrels = join(testRoot, 'drifted-qrels.json');
    const frozen = await readFile(qrelsPath, 'utf8');
    await writeFile(
      driftedQrels,
      frozen.replace('"AuthTokenValidator"', '"AuthTokenValidatoR"'),
      'utf8',
    );
    const workspaceRoot = join(testRoot, 'must-not-exist');

    let caught: unknown;
    try {
      await evaluateRanking({
        workspaceRoot,
        corpusPath,
        qrelsPath: driftedQrels,
        baselinePath,
        holdoutsPath,
        runs: 5,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RankingEvaluationError);
    expect((caught as Error).message).toContain('qrels hash mismatch');
    expect(JSON.parse((caught as Error).message)).toMatchObject({
      schema_version: 'search-ranking-failure/1.0',
      ok: false,
      code: 'QRELS_HASH_MISMATCH',
    });
    await expect(readFile(join(workspaceRoot, '.workflow', 'kg', 'maestro.db'))).rejects.toThrow();
  });
});

describe('stability and anti-special-case guards', () => {
  it('fails closed when a Top-20 run changes', () => {
    expect(() => assertStableTopK(
      [['doc-a', 'doc-b'], ['doc-b', 'doc-a']],
      'unstable-query',
    )).toThrow(/Top-20 ranking is unstable/);
  });

  it('keeps holdouts outside relative and absolute fixture query sets', async () => {
    const qrels = JSON.parse(await readFile(qrelsPath, 'utf8')) as {
      queries: Array<{ query: string }>;
    };
    const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as {
      absoluteQueries: Array<{ query: string }>;
    };
    const holdouts = JSON.parse(await readFile(holdoutsPath, 'utf8')) as {
      queries: Array<{ query: string; category: string }>;
    };
    const frozen = new Set(
      [...qrels.queries, ...corpus.absoluteQueries].map(item => item.query.toLowerCase()),
    );

    expect(holdouts.queries.some(item => frozen.has(item.query.toLowerCase()))).toBe(false);
    expect(holdouts.queries.filter(item => item.category === 'pi')).toHaveLength(2);
  });

  it('detects exact query literals and Pi ranking branches in production sources', async () => {
    const literalPath = await write(
      'faults/literal.ts',
      "export const preferredQuery = 'AuthTokenValidator';\n",
    );
    const branchPath = await write(
      'faults/branch.ts',
      "export function rank(query: string): number {\n  if (query.toLowerCase().includes('pi')) return 100;\n  return 0;\n}\n",
    );
    const scan = await scanQuerySpecialCases({
      queryFiles: [qrelsPath, holdoutsPath],
      productionPaths: [literalPath, branchPath],
    });

    expect(scan.hits.map(hit => hit.kind)).toEqual(
      expect.arrayContaining(['query-literal', 'pi-branch']),
    );
    await expect(assertNoQuerySpecialCases({
      queryFiles: [qrelsPath, holdoutsPath],
      productionPaths: [literalPath],
    })).rejects.toThrow(/production query special cases detected/);
    await expect(assertNoQuerySpecialCases({
      queryFiles: [qrelsPath, holdoutsPath],
      productionPaths: [branchPath],
    })).rejects.toThrow(/production query special cases detected/);
  });

  it('excludes tests, fixtures, and knowhow content from production scanning', async () => {
    await write('scan/search.test.ts', "export const query = 'AuthTokenValidator';\n");
    await write('scan/fixtures/query.ts', "export const query = 'AuthTokenValidator';\n");
    await write('scan/.workflow/knowhow/pi.ts', "if (query.includes('pi')) return 1;\n");
    await write(
      'scan/search.ts',
      'export class WikiIndexer {}\nexport function searchUnified(): boolean { return true; }\n',
    );

    const scan = await assertNoQuerySpecialCases({
      queryFiles: [qrelsPath, holdoutsPath],
      productionPaths: [join(testRoot, 'scan')],
    });

    expect(scan.querySpecialCaseHits).toBe(0);
    expect(scan.scannedFiles).toBe(1);
  });
});

describe('compiled production ranking adapter', () => {
  it('fails built verdict when a production provider regresses', async () => {
    const corpus = await loadRankingFixture<RankingCorpusFixture>(corpusPath);
    const qrels = await loadRankingFixture<RankingQrelsFixture>(qrelsPath);
    for (const judgment of qrels.queries) {
      const ids = (await lexicalFixtureRanker(judgment.query, corpus.documents, 20))
        .map(item => item.id);
      expect(ids.some(id => (judgment.relevance[id] ?? 0) > 0)).toBe(true);
    }

    await expect(runBuiltSearchAdapter({
      workspaceRoot: join(testRoot, 'provider-fault-workspace'),
      corpusPath,
      qrelsPath,
      baselinePath,
      holdoutsPath,
      faultProvider: 'wiki',
    })).rejects.toThrow(/compiled production provider ranking gate failed/);
  }, 300_000);

  it('derives built latency from real compiled operations', async () => {
    const adapterSource = await readFile(
      join(fixturesRoot, '..', 'built-search-adapter.ts'),
      'utf8',
    );
    expect(adapterSource).toMatch(
      /for \(let index = 0; index < LATENCY_WARMUPS; index \+= 1\) await operation\(\)/,
    );
    expect(adapterSource).toMatch(
      /for \(let index = 0; index < LATENCY_SAMPLES; index \+= 1\)/,
    );
    expect(adapterSource).toContain('graph.searchUnified(latencyJudgment.query, { limit: 20 })');
    expect(adapterSource).toContain(
      'wikiIndexer.searchWithMeta(wikiLatencyJudgment.query, 20, { skipEmbedding: true })',
    );
    expect(adapterSource).toContain('const indexer = createIndexer()');
    expect(adapterSource).toContain('getSearchIndexWithMeta');
    expect(adapterSource).not.toMatch(
      /rankPrepared|measurePreparedLatency|measureWikiLatency/,
    );
    expect(adapterSource).toContain('workspace: result.workspace');
    expect(adapterSource).toContain('authorized: result.authorized');
    expect(adapterSource).toContain('status: result.status');
    expect(adapterSource).toContain('provenance: result.provenance');
    expect(adapterSource).not.toContain('workspace: document?.workspace');
    expect(adapterSource).not.toContain('authorized: document?.authorized');
    expect(adapterSource).not.toContain('status: document?.status');
    expect(adapterSource).not.toContain('provenance: document?.provenance');
  });

  it('emits 20 and 100 raw cold Wiki observations', async () => {
    const report = await getColdEvidenceReport();
    const latency = report.evidence.latency;

    expect(latency.wikiIndexWarmupSamples).toHaveLength(20);
    expect(latency.wikiIndexSamples).toHaveLength(100);
    expect(latency.wikiIndexWarmupSamples.every(
      sample => sample.cacheState === 'cold-build',
    )).toBe(true);
    expect(latency.wikiIndexSamples.every(
      sample => sample.cacheState === 'cold-build',
    )).toBe(true);
    expect(latency.wikiIndexWarmupSamples.every(
      sample => Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
    )).toBe(true);
    expect(latency.wikiIndexSamples.every(
      sample => Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
    )).toBe(true);
  }, 300_000);

  it('computes cold Wiki P95 from raw measured samples', async () => {
    const report = await getColdEvidenceReport();
    const independentlyComputed = coldWikiP95(report.evidence.latency.wikiIndexSamples);

    expect(report.evidence.latency.wikiIndexSamples).toHaveLength(100);
    expect(report.reported.latency.wikiIndexP95Ms).toBe(independentlyComputed);
    expect(independentlyComputed).toBeLessThan(500);
  }, 300_000);

  it('rejects incomplete or warm Wiki evidence', async () => {
    const report = await getColdEvidenceReport();
    const warmups = report.evidence.latency.wikiIndexWarmupSamples;
    const measured = report.evidence.latency.wikiIndexSamples;
    expect(() => assertColdWikiIndexEvidence(warmups, measured)).not.toThrow();

    expect(() => assertColdWikiIndexEvidence(warmups.slice(1), measured))
      .toThrow(/unexpected sample count/);
    expect(() => assertColdWikiIndexEvidence(warmups, measured.slice(1)))
      .toThrow(/unexpected sample count/);
    expect(() => assertColdWikiIndexEvidence(
      [{ ...warmups[0], cacheState: 'cache-hit' }, ...warmups.slice(1)],
      measured,
    )).toThrow(/invalid or warm sample/);
    expect(() => assertColdWikiIndexEvidence(
      warmups,
      [{ ...measured[0], cacheState: 'cache-hit' }, ...measured.slice(1)],
    )).toThrow(/invalid or warm sample/);
  }, 120_000);

  it('enforces exact adapter raw evidence counts', async () => {
    const report = await getColdEvidenceReport();
    const expected = expectedForReport(report);
    expect(parseBuiltSearchAdapterReport(report, expected)).toEqual(report);
    expect(report.evidence.queries.every(query => query.runs.length === 5)).toBe(true);

    const firstQuery = report.evidence.queries[0];
    expect(firstQuery.expectedCount).toBeGreaterThan(0);
    expect(firstQuery.runs.every(
      run => run.results.length === firstQuery.expectedCount,
    )).toBe(true);

    const short = structuredClone(report);
    short.evidence.queries[0].runs[0].results.pop();

    const long = structuredClone(report);
    const firstResults = long.evidence.queries[0].runs[0].results;
    firstResults.push({
      ...firstResults[0],
      id: 'unexpected:extra-result',
      rank: firstResults.length + 1,
    });

    const duplicate = structuredClone(report);
    const duplicateResults = duplicate.evidence.queries[0].runs[0].results;
    if (duplicateResults.length === 1) {
      duplicateResults.push({ ...duplicateResults[0], rank: 2 });
    } else {
      duplicateResults[1] = {
        ...duplicateResults[1],
        id: duplicateResults[0].id,
      };
    }

    const wrongRank = structuredClone(report);
    wrongRank.evidence.queries[0].runs[0].results[0].rank = 2;

    const wrongQueryOrder = structuredClone(report);
    [
      wrongQueryOrder.evidence.queries[0],
      wrongQueryOrder.evidence.queries[1],
    ] = [
      wrongQueryOrder.evidence.queries[1],
      wrongQueryOrder.evidence.queries[0],
    ];

    const unstable = structuredClone(report);
    unstable.evidence.queries[0].runs[1].results[0].id = 'unexpected:reordered-result';

    const shortWarmups = structuredClone(report);
    shortWarmups.evidence.latency.wikiIndexWarmupSamples.pop();
    const shortSamples = structuredClone(report);
    shortSamples.evidence.latency.wikiIndexSamples.pop();

    for (const fault of [
      short,
      long,
      duplicate,
      wrongRank,
      wrongQueryOrder,
      unstable,
      shortWarmups,
      shortSamples,
    ]) {
      expect(() => parseBuiltSearchAdapterReport(fault, expected)).toThrow();
    }
  }, 120_000);

  it('rejects aggregate green with incomplete raw evidence', async () => {
    const report = await getColdEvidenceReport();
    const expected = expectedForReport(report);
    const faults: unknown[] = [];

    const missingResults = structuredClone(report) as unknown as {
      evidence: { queries: Array<{ runs: Array<{ results?: unknown[] }> }> };
    };
    delete missingResults.evidence.queries[0].runs[0].results;
    faults.push(missingResults);

    const missingEvents = structuredClone(report) as unknown as {
      evidence: { events?: unknown[] };
    };
    delete missingEvents.evidence.events;
    faults.push(missingEvents);

    const missingWarmups = structuredClone(report);
    missingWarmups.evidence.latency.wikiIndexWarmupSamples.pop();
    faults.push(missingWarmups);

    const missingSamples = structuredClone(report);
    missingSamples.evidence.latency.kgWarmSamplesMs.pop();
    faults.push(missingSamples);

    for (const fault of faults) {
      const rawFaultWithGreenAggregate = {
        ...(fault as object),
        reported: structuredClone(report.reported),
      };
      expect(() => parseBuiltSearchAdapterReport(rawFaultWithGreenAggregate, expected)).toThrow();
    }
    expect(parseBuiltSearchAdapterReport(report, expected).reported.stability.stableTop20)
      .toBe(true);
  }, 120_000);

  it('fails adapter contract byte and semantic drift', async () => {
    await expect(execFileAsync(process.execPath, [generateContractPath, '--check'], {
      cwd: repoRoot,
    })).resolves.toMatchObject({ stderr: '' });

    const driftRoot = join(testRoot, 'contract-drift');
    await mkdir(driftRoot, { recursive: true });
    const schema = await readFile(contractSchemaPath, 'utf8');
    const runtime = await readFile(contractRuntimePath, 'utf8');
    const declaration = await readFile(contractDeclarationPath, 'utf8');
    const driftSchemaPath = join(driftRoot, 'contract.json');
    const driftRuntimePath = join(driftRoot, 'contract.mjs');
    const driftDeclarationPath = join(driftRoot, 'contract.d.mts');
    await writeFile(
      driftSchemaPath,
      schema.replace('"title": "BuiltSearchAdapterReport"', '"title": "DriftedReport"'),
      'utf8',
    );
    await writeFile(driftRuntimePath, runtime, 'utf8');
    await writeFile(driftDeclarationPath, declaration, 'utf8');
    await expect(execFileAsync(process.execPath, [
      generateContractPath,
      '--check',
      '--schema',
      driftSchemaPath,
      '--runtime',
      driftRuntimePath,
      '--declaration',
      driftDeclarationPath,
    ], { cwd: repoRoot })).rejects.toThrow(/artifacts are stale/);

    const report = await getColdEvidenceReport();
    const expected = expectedForReport(report);
    for (const fault of [
      { ...report, unexpected: true },
      { ...report, schema_version: 'built-search-adapter/1.0' },
      { ...report, runner: { ...report.runner, platform: 'not-a-platform' } },
      { ...report, evidence: { ...report.evidence, events: null } },
    ]) {
      expect(() => parseBuiltSearchAdapterReport(fault, expected)).toThrow();
    }
  }, 120_000);
});
