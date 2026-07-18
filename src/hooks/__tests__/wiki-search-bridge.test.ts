import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryDaemonSearch = vi.fn();

vi.mock('../../search/daemon-client.js', () => ({ tryDaemonSearch }));

import { searchWiki } from '../wiki-search-bridge.js';

describe('wiki search bridge lifecycle filtering', () => {
  beforeEach(() => {
    tryDaemonSearch.mockReset();
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
