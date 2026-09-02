import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tryDaemonSearch = vi.fn();
const readDaemonInfo = vi.fn<() => { pid: number; port: number; startedAt: string } | null>(() => null);
const isDaemonAlive = vi.fn(() => false);

vi.mock('../../search/daemon-client.js', () => ({
  tryDaemonSearch,
  readDaemonInfo,
  isDaemonAlive,
}));

import { searchWiki } from '../wiki-search-bridge.js';

describe('wiki search bridge lifecycle filtering', () => {
  beforeEach(() => {
    tryDaemonSearch.mockReset();
    readDaemonInfo.mockReset().mockReturnValue(null);
    isDaemonAlive.mockReset().mockReturnValue(false);
  });

  it('uses BM25 daemon search with a hook-bounded timeout', async () => {
    tryDaemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      results: [],
    });

    await searchWiki('D:/tmp/.workflow', 'knowledge');

    expect(tryDaemonSearch).toHaveBeenCalledWith(
      'D:/tmp/.workflow',
      'knowledge',
      10,
      true,
      {
        timeoutMs: 700,
        filters: { applicableRepoId: '__legacy__' },
      },
    );
  });

  it('allows callers to override daemon timeout and embedding mode', async () => {
    tryDaemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: true,
      results: [],
    });

    await searchWiki('D:/tmp/.workflow', 'knowledge', {
      daemonTimeoutMs: 75,
      skipEmbedding: false,
    });

    expect(tryDaemonSearch).toHaveBeenCalledWith(
      'D:/tmp/.workflow',
      'knowledge',
      10,
      false,
      {
        timeoutMs: 75,
        filters: { applicableRepoId: '__legacy__' },
      },
    );
  });

  it('skips local indexer fallback when no persisted search index exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-empty-wiki-'));
    try {
      tryDaemonSearch.mockResolvedValue(null);

      const result = await searchWiki(root, 'knowledge');

      expect(result).toEqual({ hits: [], source: 'none' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not duplicate a live daemon with the in-process indexer when it times out', async () => {
    // A live daemon owns the same index; paying seconds to rebuild it in-process
    // on the prompt hot path is the outcome this branch exists to prevent.
    readDaemonInfo.mockReturnValue({ pid: 1, port: 1234, startedAt: 'x' });
    isDaemonAlive.mockReturnValue(true);
    tryDaemonSearch.mockResolvedValue(null);

    const result = await searchWiki('D:/tmp/.workflow', 'knowledge');

    expect(result).toEqual({ hits: [], source: 'none' });
  });

  it('excludes deprecated and superseded daemon hits', async () => {
    tryDaemonSearch.mockResolvedValue({
      ok: true,
      embeddingUsed: false,
      results: [
        { entry: { id: 'knowhow-active', type: 'knowhow', title: 'Active', status: 'active' }, score: 8 },
        { entry: { id: 'knowhow-old', type: 'knowhow', title: 'Old', status: 'deprecated' }, score: 7 },
        { entry: { id: 'spec-old', type: 'spec', title: 'Old spec', ext: { status: 'superseded' } }, score: 6 },
      ],
    });

    const result = await searchWiki('D:/tmp/.workflow', 'knowledge', { limit: 10 });

    expect(result.source).toBe('daemon');
    expect(result.hits.map(hit => hit.id)).toEqual(['knowhow-active']);
  });
});
