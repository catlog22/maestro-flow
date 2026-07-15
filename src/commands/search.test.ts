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

function wikiEntry(id: string, tags: string[]): WikiEntry {
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
