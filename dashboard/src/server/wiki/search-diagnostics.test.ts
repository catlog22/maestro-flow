import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WikiIndexer } from './wiki-indexer.js';

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

describe('WikiIndexer request diagnostics', () => {
  it('records cache/index/search phases through the request-local sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-diagnostics-'));
    roots.push(root);
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(
      join(root, 'specs', 'diagnostic.md'),
      '---\ntitle: Diagnostic sentinel\n---\n# Diagnostic sentinel\nrequest-local body',
      'utf8',
    );
    const events: Array<{ phase: string; durationMs: number }> = [];
    const fallbacks: Array<{ source: string; reason: string }> = [];
    const diagnostics = {
      requestId: '12345678-1234-4123-8123-123456789abc',
      recordPhase: (phase: string, durationMs: number) => events.push({ phase, durationMs }),
      recordFallback: (source: string, reason: string) => fallbacks.push({ source, reason }),
      setProvider: () => undefined,
      setCacheState: () => undefined,
      setEmbedding: () => undefined,
      setResultCount: () => undefined,
      merge: () => undefined,
      snapshot: () => ({
        schemaVersion: 'maestro-search-diagnostics/1.0',
        requestId: '12345678-1234-4123-8123-123456789abc',
        durationMs: 1,
        phases: events,
        fallbacks,
      }),
    };
    const indexer = new WikiIndexer({
      workflowRoot: root,
      persistence: 'memory-only',
      includeCliSessions: false,
    });
    const result = await indexer.searchWithMeta('request-local', 5, {
      skipEmbedding: true,
      diagnostics,
    });
    await indexer.close();

    expect(result.results.map(item => item.entry.title)).toContain('Diagnostic sentinel');
    expect(result.diagnostics).toMatchObject({
      requestId: '12345678-1234-4123-8123-123456789abc',
      phases: expect.any(Array),
    });
    expect(events.map(event => event.phase)).toEqual(expect.arrayContaining([
      'index-load',
      'search-index',
      'bm25-search',
    ]));
    expect(events.every(event => event.durationMs >= 0)).toBe(true);
    expect(fallbacks).toEqual(expect.arrayContaining([{ source: 'cache', reason: 'miss' }]));
  });
});
