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

import { registerSearchCommand, runUnifiedSearch } from './search.js';

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

describe('search artifact kind facet', () => {
  beforeEach(() => {
    daemonSearch.mockReset();
    daemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      embeddingDocs: 0,
      results: [
        { entry: wikiEntry('diagnosis-run', ['session', 'run', 'diagnosis']), score: 8 },
        { entry: wikiEntry('review-run', ['session', 'run', 'review-findings']), score: 7 },
      ],
    });
  });

  it('filters unified wiki results by exact artifact kind tag', async () => {
    const results = await runUnifiedSearch('searchable', { kind: 'diagnosis', limit: 20, skipEmbedding: true });

    expect(results.map(result => result.id)).toEqual(['diagnosis-run']);
  });

  it('registers --kind as a CLI option', () => {
    const program = new Command();
    registerSearchCommand(program);

    const search = program.commands.find(command => command.name() === 'search');
    expect(search?.options.some(option => option.long === '--kind')).toBe(true);
  });
});

describe('search session/run topology exposure', () => {
  beforeEach(() => {
    daemonSearch.mockReset();
    daemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      embeddingDocs: 0,
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
