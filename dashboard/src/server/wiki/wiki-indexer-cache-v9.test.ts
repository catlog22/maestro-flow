import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WikiIndexer,
  resolveWikiIndexerRole,
  wikiIndexerRoleFromPersistence,
} from './wiki-indexer.js';
import { searchBM25Planned } from './search.js';

let root: string;
const originalCompiledPostings = process.env.MAESTRO_SEARCH_COMPILED_POSTINGS;

async function seed(): Promise<void> {
  await mkdir(join(root, 'specs'), { recursive: true });
  await writeFile(
    join(root, 'specs', 'cache-v9.md'),
    '---\ntitle: Compiled cache sentinel\ntags:\n  - cache\n---\n# Compiled cache sentinel\nCompiled postings remain optional.\n',
  );
}

async function readCache(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(root, 'search-cache.json'), 'utf8')) as Record<string, any>;
}

async function waitForCacheVersion(version: number): Promise<Record<string, any>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const cache = await readCache();
      if (cache.version === version) return cache;
    } catch { /* publication is still in flight */ }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for search-cache v${version}`);
}

async function publish(compiled: boolean): Promise<{ indexer: WikiIndexer; cache: Record<string, any> }> {
  process.env.MAESTRO_SEARCH_COMPILED_POSTINGS = compiled ? '1' : '0';
  const indexer = new WikiIndexer({ workflowRoot: root, role: 'publisher', includeCliSessions: false });
  await indexer.get();
  const cache = await waitForCacheVersion(compiled ? 9 : 8);
  return { indexer, cache };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-cache-v9-'));
  await seed();
  delete process.env.MAESTRO_SEARCH_COMPILED_POSTINGS;
});

afterEach(async () => {
  if (originalCompiledPostings === undefined) delete process.env.MAESTRO_SEARCH_COMPILED_POSTINGS;
  else process.env.MAESTRO_SEARCH_COMPILED_POSTINGS = originalCompiledPostings;
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('WikiIndexer ownership roles', () => {
  it('preserves persistence compatibility aliases and explicit role precedence', () => {
    expect(wikiIndexerRoleFromPersistence(undefined)).toBe('publisher');
    expect(wikiIndexerRoleFromPersistence('filesystem')).toBe('publisher');
    expect(wikiIndexerRoleFromPersistence('read-only')).toBe('reader');
    expect(wikiIndexerRoleFromPersistence('memory-only')).toBe('hermetic');
    expect(resolveWikiIndexerRole({ persistence: 'read-only' })).toBe('reader');
    expect(resolveWikiIndexerRole({ persistence: 'filesystem', role: 'hermetic' })).toBe('hermetic');

    expect(new WikiIndexer({ workflowRoot: root }).getRole()).toBe('publisher');
    expect(new WikiIndexer({ workflowRoot: root, persistence: 'read-only' }).getRole()).toBe('reader');
    expect(new WikiIndexer({ workflowRoot: root, persistence: 'memory-only' }).getRole()).toBe('hermetic');
  });

  it('keeps reader and hermetic instances zero-write', async () => {
    for (const role of ['reader', 'hermetic'] as const) {
      const evidence: Array<{ event: string }> = [];
      const indexer = new WikiIndexer({
        workflowRoot: root,
        role,
        includeCliSessions: false,
        evidenceRecorder: event => evidence.push(event),
      });
      const index = await indexer.get();
      expect(index.byId['spec:project:cache-v9']).toBeDefined();
      await indexer.getSearchIndex();
      await indexer.close();
      await expect(readFile(join(root, 'search-cache.json'))).rejects.toThrow();
      await expect(readFile(join(root, 'wiki-index.json'))).rejects.toThrow();
      expect(evidence.some(event => event.event.endsWith('write'))).toBe(false);
    }
  });
});

describe('WikiIndexer search-cache compatibility and compiled postings', () => {
  it('reads a v8 cache without a compiled index', async () => {
    const { indexer } = await publish(false);
    await indexer.close();
    expect((await readCache()).version).toBe(8);

    const reader = new WikiIndexer({ workflowRoot: root, role: 'reader', includeCliSessions: false });
    const subject = reader as unknown as { buildIndexCandidate: () => Promise<never> };
    subject.buildIndexCandidate = async () => { throw new Error('v8 cache should load'); };
    const loaded = await reader.get();
    expect(loaded.byId['spec:project:cache-v9']).toBeDefined();
    const search = await reader.getSearchIndexWithMeta();
    expect(search.cacheState).toBe('cold-build');
    await reader.close();
  });

  it('reuses a v9 compiled index and produces identical postings scores', async () => {
    const { indexer, cache } = await publish(true);
    const canonical = await indexer.getSearchIndex();
    const expected = searchBM25Planned(canonical, 'compiled cache', 10);
    await indexer.close();
    expect(cache.version).toBe(9);
    expect(cache.compiled).toMatchObject({
      schemaVersion: 'bm25f/1',
      generation: cache.generatedAt,
      sourceFingerprint: cache.sourceFingerprint,
    });

    const reader = new WikiIndexer({ workflowRoot: root, role: 'reader', includeCliSessions: false });
    const loaded = await reader.getSearchIndexWithMeta();
    expect(loaded.cacheState).toBe('cache-hit');
    expect(searchBM25Planned(loaded.index, 'compiled cache', 10)).toEqual(expected);
    await reader.close();
  });

  it('does not activate persisted compiled postings after the feature is disabled', async () => {
    const { indexer } = await publish(true);
    await indexer.close();
    process.env.MAESTRO_SEARCH_COMPILED_POSTINGS = '0';

    const reader = new WikiIndexer({ workflowRoot: root, role: 'reader', includeCliSessions: false });
    const loaded = await reader.getSearchIndexWithMeta();
    expect(loaded.cacheState).toBe('cold-build');
    expect(searchBM25Planned(loaded.index, 'compiled cache', 10).map(result => result.docId))
      .toContain('spec:project:cache-v9');
    await reader.close();
  });

  it('falls back to canonical entries when only compiled postings are corrupt', async () => {
    const { indexer } = await publish(true);
    await indexer.close();
    const path = join(root, 'search-cache.json');
    const cache = await readCache();
    cache.compiled.fieldPostings = [['compiled cache', [{
      docId: 'not-a-canonical-doc-id',
      fieldTfs: { title: 1, summary: 0, tags: 0, body: 0 },
    }]]];
    delete cache.compiled.docIdFingerprint;
    delete cache.compiled.configFingerprint;
    await writeFile(path, JSON.stringify(cache));

    const reader = new WikiIndexer({ workflowRoot: root, role: 'reader', includeCliSessions: false });
    const loaded = await reader.getSearchIndexWithMeta();
    expect(loaded.cacheState).toBe('cold-build');
    expect((await reader.searchWithMeta('compiled cache', 5, { skipEmbedding: true })).results
      .map(result => result.entry.id)).toContain('spec:project:cache-v9');
    await reader.close();
  });

  it.each([
    ['generation', (compiled: Record<string, any>, cache: Record<string, any>) => {
      compiled.generation = cache.generatedAt + 1;
    }],
    ['config', (compiled: Record<string, any>) => {
      compiled.docConfigKeys[0][1] = 'kg';
      delete compiled.configFingerprint;
    }],
    ['doc-id', (compiled: Record<string, any>) => {
      const id = compiled.fieldLengths[0][0];
      compiled.fieldLengths[0][0] = `${id}-stale`;
      compiled.docConfigKeys[0][0] = `${id}-stale`;
      delete compiled.docIdFingerprint;
      delete compiled.configFingerprint;
    }],
  ])('rejects compiled %s mismatch while preserving canonical output', async (_kind, mutate) => {
    const { indexer } = await publish(true);
    await indexer.close();
    const path = join(root, 'search-cache.json');
    const cache = await readCache();
    mutate(cache.compiled, cache);
    await writeFile(path, JSON.stringify(cache));

    const reader = new WikiIndexer({ workflowRoot: root, role: 'reader', includeCliSessions: false });
    const loaded = await reader.getSearchIndexWithMeta();
    expect(loaded.cacheState).toBe('cold-build');
    const results = await reader.searchWithMeta('compiled cache', 5, { skipEmbedding: true });
    expect(results.results.map(result => result.entry.id)).toContain('spec:project:cache-v9');
    await reader.close();
  });
});
