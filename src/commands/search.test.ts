import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';

const { daemonSearch } = vi.hoisted(() => ({ daemonSearch: vi.fn() }));

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonSearch: daemonSearch,
  stopDaemon: vi.fn(),
  spawnDaemon: vi.fn(),
  readDaemonInfo: vi.fn(),
  isDaemonAlive: vi.fn(),
  getDaemonPath: vi.fn(),
}));

import {
  registerSearchCommand,
  runUnifiedSearch,
  selectDiverseKgResults,
  selectDiverseWikiCandidates,
} from './search.js';

function wikiEntry(id: string, tags: string[], overrides: Partial<WikiEntry> = {}): WikiEntry {
  return {
    id,
    type: 'knowhow',
    title: id,
    category: 'debug',
    summary: `${id} summary`,
    tags,
    status: 'completed',
    created: null,
    updated: null,
    related: [],
    source: { kind: 'virtual', path: `sessions/${id}/run.json` },
    body: `${id} searchable body`,
    raw: {},
    ext: { virtualKind: 'session-run' },
    scope: null,
    specCategory: null,
    createdBy: 'quality-debug',
    sourceRef: id,
    parent: null,
    ...overrides,
  };
}

describe('search tag facet', () => {
  beforeEach(() => {
    daemonSearch.mockReset();
    daemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      embeddingDocs: 0,
      filtersApplied: true,
      results: [
        { entry: wikiEntry('diagnosis-run', ['session', 'run', 'diagnosis']), score: 8 },
        { entry: wikiEntry('review-run', ['session', 'run', 'review-findings']), score: 7 },
      ],
    });
  });

  it('filters unified wiki results by exact tag', async () => {
    const results = await runUnifiedSearch('searchable', { tag: 'diagnosis', limit: 20, skipEmbedding: true });

    expect(results.map(result => result.id)).toEqual(['diagnosis-run']);
  });

  it('registers --tag and --kind (alias) as CLI options', () => {
    const program = new Command();
    registerSearchCommand(program);

    const search = program.commands.find(command => command.name() === 'search');
    expect(search?.options.some(option => option.long === '--tag')).toBe(true);
    expect(search?.options.some(option => option.long === '--kind')).toBe(true);
    expect(search?.options.some(option => option.long === '--wiki-only')).toBe(true);
    expect(search?.options.some(option => option.long === '--semantic')).toBe(true);
  });
});

describe('daemon latency fallback', () => {
  beforeEach(() => {
    daemonSearch.mockReset();
  });

  it('uses BM25 first and keeps it when semantic lookup times out', async () => {
    daemonSearch
      .mockResolvedValueOnce({
        ok: true,
        embeddingUsed: false,
        embeddingDocs: 0,
        filtersApplied: true,
        results: [{ entry: wikiEntry('fast-bm25', ['performance']), score: 5 }],
      })
      .mockResolvedValueOnce(null);

    const results = await runUnifiedSearch('searchable', { limit: 1 });

    expect(results.map(result => result.id)).toEqual(['fast-bm25']);
    expect(daemonSearch).toHaveBeenCalledTimes(2);
    expect(daemonSearch.mock.calls[0][3]).toBe(true);
    expect(daemonSearch.mock.calls[0][4]).toMatchObject({ timeoutMs: 1_000 });
    expect(daemonSearch.mock.calls[1][3]).toBe(false);
    expect(daemonSearch.mock.calls[1][4]).toMatchObject({ timeoutMs: 600 });
  });
});

describe('balanced wiki candidate selection', () => {
  it('collapses chunk families to two results before selection', () => {
    const candidates = [
      { entry: wikiEntry('guide-001', [], { parent: 'guide' }), score: 10 },
      { entry: wikiEntry('guide-002', [], { parent: 'guide' }), score: 9.9 },
      { entry: wikiEntry('guide-003', [], { parent: 'guide' }), score: 9.8 },
      { entry: wikiEntry('other', []), score: 9.7 },
    ];
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 4,
      applyCaps: false,
      diversity: 'off',
    });
    expect(selected.map(item => item.entry.id)).toEqual(['guide-001', 'guide-002', 'other']);
  });

  it('uses MMR to surface a distinct family before near-duplicate results', () => {
    const similar = (id: string) => wikiEntry(id, ['store'], {
      title: 'Canonical SessionStore atomic write',
      summary: 'SessionStore atomic write lock transaction',
      category: 'coding',
    });
    const candidates = [
      { entry: similar('store-a'), score: 10 },
      { entry: similar('store-b'), score: 9.9 },
      { entry: similar('store-c'), score: 9.8 },
      {
        entry: wikiEntry('search-diversity', ['retrieval'], {
          title: 'MMR retrieval diversity',
          summary: 'Broad knowledge exploration',
          category: 'learning',
        }),
        score: 9.7,
      },
    ];
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 4,
      applyCaps: false,
      diversity: 'balanced',
    });
    expect(selected[0].entry.id).toBe('store-a');
    expect(selected[1].entry.id).toBe('search-diversity');
    expect(selected[1].selectionReason).toBe('diversity');
  });

  it('keeps one result per document family in balanced mode', () => {
    const candidates = [
      { entry: wikiEntry('guide-001', [], { parent: 'guide' }), score: 10 },
      { entry: wikiEntry('guide-002', [], { parent: 'guide' }), score: 9.9 },
      { entry: wikiEntry('other', []), score: 9.8 },
    ];
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 3,
      applyCaps: false,
      diversity: 'balanced',
    });
    expect(selected.map(item => item.entry.id)).toEqual(['guide-001', 'other']);
  });

  it('reserves one relevance-floored slot for a lower-exposure family', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      entry: wikiEntry(`candidate-${index + 1}`, [], {
        title: `Distinct topic ${index + 1}`,
        summary: `Independent evidence ${index + 1}`,
      }),
      score: 10 - index * 0.4,
    }));
    const impressions = new Map(candidates.map((candidate, index) => [
      candidate.entry.id,
      index === 4 ? 0 : 100 - index,
    ]));
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 4,
      applyCaps: false,
      diversity: 'balanced',
      impressions,
    });
    expect(selected.at(-1)).toMatchObject({
      entry: { id: 'candidate-5' },
      selectionReason: 'exploration',
    });
    expect(selected.map(item => item.score)).toEqual(expect.arrayContaining([8.4]));
  });

  it('reserves exploration against the final mixed display size', () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      entry: wikiEntry(`mixed-${index + 1}`, [], {
        parent: `mixed-family-${index}-unique`,
        title: `Mixed candidate ${index + 1}`,
        summary: `Independent mixed evidence ${index + 1}`,
      }),
      score: 10 - index * 0.4,
    }));
    const impressions = new Map(candidates.map((candidate, index) => [
      candidate.entry.id,
      index === 7 ? 0 : 100,
    ]));
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 8,
      explorationLimit: 4,
      applyCaps: false,
      diversity: 'balanced',
      impressions,
    });
    expect(selected).toContainEqual(expect.objectContaining({
      entry: expect.objectContaining({ id: 'mixed-8' }),
      selectionReason: 'exploration',
    }));
  });

  it('selects a large candidate pool without cubic similarity recomputation', () => {
    const candidates = Array.from({ length: 400 }, (_, index) => ({
      entry: wikiEntry(`perf-${index}`, [`tag-${index % 17}`], {
        parent: `family-${index}-unique`,
        title: `Candidate topic ${index}`,
        summary: `Shared retrieval terms and distinct evidence ${index}`,
      }),
      score: 400 - index,
    }));
    const started = performance.now();
    const selected = selectDiverseWikiCandidates(candidates, {
      limit: 200,
      applyCaps: false,
      diversity: 'balanced',
    });
    expect(selected).toHaveLength(200);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('balanced KG candidate selection', () => {
  it('caps both source concentration and file families before fallback', () => {
    const candidate = (
      graphId: string,
      sourceType: string,
      filePath: string,
      score: number,
    ) => ({
      id: graphId,
      graphId,
      aliases: [],
      sourceType,
      kind: sourceType === 'codegraph' ? 'function' : 'knowhow_entry',
      name: graphId,
      definition: '',
      filePath,
      score,
      category: 'arch',
      status: 'active',
      selectionReason: 'diversity' as const,
    });
    const selected = selectDiverseKgResults([
      candidate('code:a', 'codegraph', 'src/a.ts', 10),
      candidate('code:b', 'codegraph', 'src/a.ts', 9.9),
      candidate('code:c', 'codegraph', 'src/c.ts', 9.8),
      candidate('code:d', 'codegraph', 'src/d.ts', 9.7),
      candidate('knowhow:a', 'knowhow', '.workflow/knowhow/a.md', 9.6),
      candidate('spec:a', 'spec', '.workflow/specs/a.md', 9.5),
    ], 4);

    expect(selected.map(item => item.graphId)).toEqual([
      'code:a',
      'code:c',
      'knowhow:a',
      'spec:a',
    ]);
  });
});

describe('search session/run topology exposure', () => {
  beforeEach(() => {
    daemonSearch.mockReset();
    daemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      embeddingDocs: 0,
      filtersApplied: true,
      results: [
        {
          entry: wikiEntry('session-20260712-legacy', ['session', 'sealed'], {
            ext: { virtualKind: 'session', sessionId: '20260712-legacy', runCount: 2 },
            related: ['session-run-20260712-legacy-run-001', 'spec:project:legacy-promoted-rule'],
          }),
          score: 9,
        },
        {
          entry: wikiEntry('session-run-20260712-legacy-run-001', ['session', 'run', 'diagnosis'], {
            ext: { virtualKind: 'session-run', sessionId: '20260712-legacy', runId: 'RUN-001' },
            related: ['session-20260712-legacy'],
            parent: 'session-20260712-legacy',
          }),
          score: 8,
        },
        { entry: wikiEntry('plain-knowhow', ['pattern'], { ext: {} }), score: 7 },
      ],
    });
  });

  it('exposes sessionId/runId/runCount/related on run-mode entries only', async () => {
    const results = await runUnifiedSearch('legacy', { limit: 20, skipEmbedding: true });

    const session = results.find(result => result.id === 'session-20260712-legacy');
    expect(session?.sessionId).toBe('20260712-legacy');
    expect(session?.runCount).toBe(2);
    expect(session?.related).toEqual(['session-run-20260712-legacy-run-001', 'spec:project:legacy-promoted-rule']);

    const run = results.find(result => result.id === 'session-run-20260712-legacy-run-001');
    expect(run?.sessionId).toBe('20260712-legacy');
    expect(run?.runId).toBe('RUN-001');
    expect(run?.related).toEqual(['session-20260712-legacy']);

    const plain = results.find(result => result.id === 'plain-knowhow');
    expect(plain?.sessionId).toBeUndefined();
    expect(plain?.related).toBeUndefined();
  });
});
