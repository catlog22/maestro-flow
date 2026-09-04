import { describe, expect, it, vi } from 'vitest';

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonSearch: vi.fn(async () => ({
    ok: true,
    results: [],
    embeddingUsed: false,
    embeddingDocs: 0,
    filtersApplied: true,
  })),
  stopDaemon: vi.fn(),
  spawnDaemon: vi.fn(async () => {}),
  readDaemonInfo: vi.fn(() => null),
  isDaemonAlive: vi.fn(() => false),
  getDaemonPath: vi.fn(() => ''),
}));

import type { WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';
import {
  interleaveCodeProviders,
  mergeAndNormalize,
  runMixedSearch,
  runUnifiedSearch,
  type CodeSearchResult,
  type ScoredArchKbEntry,
  type SearchResult,
} from './search.js';

function wikiResult(id: string, score: number): SearchResult {
  return {
    id,
    type: 'knowhow' as WikiNodeType,
    title: id,
    category: 'coding',
    summary: `${id} summary`,
    score,
    snippet: null,
    source: { kind: 'virtual', path: `wiki/${id}.md` },
  };
}

function codeResult(id: string, score: number, name = id): CodeSearchResult {
  return {
    id,
    kind: 'module',
    name,
    filePath: `src/${id}.ts`,
    line: 1,
    score,
  };
}

function ranksById(results: ReturnType<typeof mergeAndNormalize>): Record<string, number> {
  return Object.fromEntries(results.map(result => [result.id, result.rank]));
}

function scoresById(results: ReturnType<typeof mergeAndNormalize>): Record<string, number> {
  return Object.fromEntries(results.map(result => [result.id, result.score]));
}

describe('mixed provider candidate pool', () => {
  it('records the actual daemon lookup branch without changing empty results', async () => {
    const events: Array<{ event: string; site: string; queryId: string | null }> = [];

    const results = await runUnifiedSearch('recorder sentinel', {
      limit: 5,
      skipEmbedding: true,
      evidenceRecorder: event => events.push(event),
      evidenceQueryId: 'recorder-query',
    });

    expect(results).toEqual([]);
    expect(events).toEqual([{
      event: 'daemon-lookup',
      site: 'runUnifiedSearch.tryDaemonSearch',
      queryId: 'recorder-query',
    }]);
  });

  it('calls each provider and merge once with the same bounded candidate limit', async () => {
    const wiki = Array.from({ length: 40 }, (_, index) => wikiResult(`wiki-${index}`, 40 - index));
    const code = Array.from({ length: 40 }, (_, index) => codeResult(`code-${index}`, 40 - index));
    const wikiSearch = vi.fn(async () => wiki);
    const codeSearch = vi.fn(async () => ({ results: code, status: 'ok' as const }));
    const merge = vi.fn(mergeAndNormalize);
    const archKbSearch = vi.fn(() => []);

    const outcome = await runMixedSearch(
      'plain terms',
      { limit: 7, skipEmbedding: true, includeLinkedCode: true },
      { wikiSearch, codeSearch, merge, archKbSearch },
    );

    expect(outcome.candidateLimit).toBe(60);
    expect(wikiSearch).toHaveBeenCalledOnce();
    expect(wikiSearch).toHaveBeenCalledWith(
      'plain terms',
      expect.objectContaining({ limit: 60, skipEmbedding: true }),
    );
    expect(codeSearch).toHaveBeenCalledOnce();
    expect(codeSearch).toHaveBeenCalledWith('plain terms', 60, true, true);
    expect(merge).toHaveBeenCalledOnce();
    expect(merge).toHaveBeenCalledWith(wiki, code, 7, 'plain terms');
    expect(outcome.results).toHaveLength(7);
  });

  it('caps both provider candidate limits at 500', async () => {
    const wikiSearch = vi.fn(async () => []);
    const codeSearch = vi.fn(async () => ({ results: [], status: 'ok' as const }));
    const archKbSearch = vi.fn(() => []);

    const outcome = await runMixedSearch(
      'plain terms',
      { limit: 200 },
      { wikiSearch, codeSearch, archKbSearch },
    );

    expect(outcome.candidateLimit).toBe(500);
    expect(wikiSearch).toHaveBeenCalledOnce();
    expect(wikiSearch).toHaveBeenCalledWith('plain terms', expect.objectContaining({ limit: 500 }));
    expect(codeSearch).toHaveBeenCalledOnce();
    expect(codeSearch).toHaveBeenCalledWith('plain terms', 500, undefined, false);
  });

  it('feeds saturated linked candidates into mixed fusion', async () => {
    const local = Array.from({ length: 4 }, (_, index) =>
      codeResult(`code:local-${index}`, 10 - index));
    const linked = [
      {
        ...codeResult('ws:ws-b:code:linked-b', 8),
        workspace: 'ws-b',
        workspaceFence: 'linked:ws-b',
      },
      {
        ...codeResult('ws:ws-a:code:linked-a', 9),
        workspace: 'ws-a',
        workspaceFence: 'linked:ws-a',
      },
    ];
    const selected = interleaveCodeProviders(local, linked, 4);
    const codeSearch = vi.fn(async () => ({ results: selected, status: 'ok' as const }));

    const outcome = await runMixedSearch(
      'plain terms',
      { limit: 4, skipEmbedding: true, includeLinkedCode: true },
      { wikiSearch: vi.fn(async () => []), codeSearch, archKbSearch: vi.fn(() => []) },
    );

    expect(outcome.codeOutcome.results.map(result => result.id)).toEqual([
      'code:local-0',
      'ws:ws-a:code:linked-a',
      'ws:ws-b:code:linked-b',
      'code:local-1',
    ]);
    expect(outcome.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^ws:[^:]+:.+/),
        workspace: expect.stringMatching(/^ws-[ab]$/),
        workspaceFence: expect.stringMatching(/^linked:ws-[ab]$/),
      }),
    ]));
  });

  it('preserves result, rank, and score behavior when an optional recorder is present', async () => {
    const wiki = [wikiResult('wiki-a', 10), wikiResult('wiki-b', 5)];
    const code = [codeResult('code-a', 8), codeResult('code-b', 4)];
    const wikiSearch = vi.fn(async () => wiki);
    const codeSearch = vi.fn(async () => ({ results: code, status: 'ok' as const }));
    const archKbSearch = vi.fn(() => []);
    const events: Array<{ event: string; site: string; queryId: string | null }> = [];

    const plain = await runMixedSearch(
      'plain terms',
      { limit: 4, skipEmbedding: true },
      { wikiSearch, codeSearch, archKbSearch },
    );
    const recorded = await runMixedSearch(
      'plain terms',
      {
        limit: 4,
        skipEmbedding: true,
        evidenceRecorder: event => events.push(event),
        evidenceQueryId: 'fixture-query',
      },
      { wikiSearch, codeSearch, archKbSearch },
    );

    expect(recorded.results).toEqual(plain.results);
    expect(ranksById(recorded.results)).toEqual(ranksById(plain.results));
    expect(scoresById(recorded.results)).toEqual(scoresById(plain.results));
    expect(events).toEqual([]);
    expect(wikiSearch).toHaveBeenLastCalledWith(
      'plain terms',
      expect.objectContaining({
        evidenceRecorder: expect.any(Function),
        evidenceQueryId: 'fixture-query',
      }),
    );
  });

  it('keeps the reserved wiki exploration slot after mixed truncation', async () => {
    const wiki = Array.from({ length: 5 }, (_, index) => ({
      ...wikiResult(`wiki-${index}`, 10 - index),
      selectionReason: index === 4 ? 'exploration' as const : 'diversity' as const,
    }));
    const code = Array.from({ length: 5 }, (_, index) =>
      codeResult(`code-${index}`, 10 - index));

    const results = mergeAndNormalize(wiki, code, 4, 'plain terms');
    expect(results).toContainEqual(expect.objectContaining({
      id: 'wiki-4',
      source: 'wiki',
      selectionReason: 'exploration',
    }));
  });
});

describe('legacy mixed rank and score contract', () => {
  const wiki = [wikiResult('wiki-a', 10), wikiResult('wiki-b', 5)];
  const code = [
    codeResult('code-a', 8, 'ZuluOmega'),
    codeResult('code-b', 4, 'ThetaGamma'),
  ];

  it('preserves default source weights and source-local scores', () => {
    const results = mergeAndNormalize(wiki, code, 10, 'plain terms');

    expect(ranksById(results)).toEqual({
      'wiki-a': 0.6,
      'code-a': 0.4,
      'wiki-b': 0.3,
      'code-b': 0.2,
    });
    expect(scoresById(results)).toEqual({
      'wiki-a': 1,
      'code-a': 1,
      'wiki-b': 0.5,
      'code-b': 0.5,
    });
  });

  it('preserves identifier and strong-code-match dynamic weights', () => {
    const identifier = mergeAndNormalize(wiki, code, 10, 'plain_identifier');
    expect(ranksById(identifier)).toEqual({
      'code-a': 0.6,
      'wiki-a': 0.4,
      'code-b': 0.3,
      'wiki-b': 0.2,
    });

    const strong = mergeAndNormalize(
      wiki,
      [codeResult('code-a', 8, 'AlphaCode'), codeResult('code-b', 4, 'OtherName')],
      10,
      'Alpha Code',
    );
    expect(ranksById(strong)).toEqual({
      'code-a': 0.5,
      'wiki-a': 0.5,
      'code-b': 0.25,
      'wiki-b': 0.25,
    });
  });

  it('uses average normalized positions for ties with deterministic source and id ordering', () => {
    const tied = mergeAndNormalize(
      [wikiResult('wiki-z', 10), wikiResult('wiki-a', 10)],
      [
        codeResult('code-z', 8, 'ZuluOmega'),
        codeResult('code-a', 8, 'ThetaGamma'),
      ],
      10,
      'plain terms',
    );

    expect(tied.map(result => result.id)).toEqual(['wiki-a', 'wiki-z', 'code-a', 'code-z']);
    expect(ranksById(tied)).toEqual({
      'wiki-a': 0.44999999999999996,
      'wiki-z': 0.44999999999999996,
      'code-a': 0.30000000000000004,
      'code-z': 0.30000000000000004,
    });
    for (const result of tied) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(result.rank)).toBe(true);
    }
  });

  it('keeps Arch-KB templates visible but below wiki and code matches', () => {
    const template: ScoredArchKbEntry = {
      entry: {
        id: 'arch-tpl-payment-system',
        type: 'template',
        title: 'Payment system architecture template',
        slug: 'payment-system',
        summary: 'Idempotency and reconciliation',
        keywords: ['payment', 'idempotency'],
        path: 'templates/payment-system/README.md',
        sections: ['Architecture overview'],
      },
      score: 20,
    };

    const results = mergeAndNormalize(
      [wikiResult('wiki-a', 10)],
      [codeResult('code-a', 8, 'PaymentService')],
      10,
      'payment',
      [template],
    );

    expect(results.map(result => result.id)).toEqual([
      'wiki-a',
      'code-a',
      'arch-tpl-payment-system',
    ]);
    expect(results[2]).toMatchObject({
      source: 'arch-kb',
      kind: 'template',
      detail: 'templates/payment-system/README.md  (maestro load --type template --id arch-tpl-payment-system)',
      openCommand: 'maestro load --type template --id arch-tpl-payment-system',
      searchCommand: 'maestro arch-kb search "payment" --type template',
      referenceOnly: true,
      projectRelated: false,
      sourceRef: 'templates/payment-system/README.md',
    });
    expect(results[2].rank).toBeLessThan(results[0].rank);
    expect(results[2].rank).toBeLessThan(results[1].rank);
  });

  it('keeps the default mixed fusion free of RRF and performs one final slice', () => {
    expect(runMixedSearch.toString()).not.toMatch(/\bRRF\b|reciprocal/i);
    expect(mergeAndNormalize.toString()).not.toMatch(/\bRRF\b|reciprocal/i);
    expect(mergeAndNormalize.toString().match(/\.slice\(/g)).toHaveLength(1);
    expect(runMixedSearch.toString()).not.toMatch(/\.slice\(/);
  });
});
