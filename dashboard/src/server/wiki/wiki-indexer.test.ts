import { mkdtemp, mkdir, open, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WikiIndexer } from './wiki-indexer.js';
import { createRuntimeSessionFixture } from './__fixtures__/runtime-session.js';
import { buildGraph, detectOrphans, detectHubs, computeHealth } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, tokenize } from './search.js';
import { WikiWriter, WikiWriteError } from './writer.js';

let tmpRoot: string;

async function write(rel: string, body: string): Promise<void> {
  const abs = join(tmpRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf-8');
}

function withoutCliSessions(indexer: WikiIndexer): WikiIndexer {
  const subject = indexer as unknown as {
    includeCliSessions: boolean;
    scanCliSessions: () => Promise<[]>;
  };
  subject.includeCliSessions = false;
  subject.scanCliSessions = async () => [];
  return indexer;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wiki-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
});

describe('WikiIndexer', () => {
  it('indexes files across workflow subtrees', async () => {
    await write(
      'project.md',
      `---\ntitle: Project\n---\n# Project\nBody`,
    );
    await write(
      'specs/one.md',
      `---\ntitle: Spec One\ntags:\n  - auth\n---\n# Spec One\nAbout [[Spec Two]]`,
    );
    await write(
      'specs/two.md',
      `---\ntitle: Spec Two\n---\n# Spec Two\nRefs [[Spec One]]`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const ids = index.entries.map((d) => d.id).sort();
    expect(ids).toContain('spec:project:one');
    expect(ids).toContain('spec:project:two');
    expect(index.byId['spec:project:one'].tags).toEqual(['auth']);
    expect(index.backlinks['spec:project:one']).toContain('spec:project:two');
    expect(index.backlinks['spec:project:two']).toContain('spec:project:one');
  });

  it('invalidates a warm index when an optional source path appears', async () => {
    await write('specs/existing.md', '---\ntitle: Existing\n---\n# Existing');
    const indexer = withoutCliSessions(new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'memory-only',
    }));

    const first = await indexer.get();
    expect(first.entries.some(entry => entry.type === 'project')).toBe(false);

    await write('project.md', '---\ntitle: New project\n---\n# New project\nWarm invalidation sentinel.');
    const afterProject = await indexer.get();
    expect(afterProject.entries.some(entry => entry.type === 'project'
      && entry.title === 'New project')).toBe(true);

    await write('knowhow/new.md', '---\ntitle: New knowhow\n---\n# New knowhow');
    const afterDirectory = await indexer.get();
    expect(afterDirectory.entries.some(entry => entry.title === 'New knowhow')).toBe(true);
  });

  it('filters by type and tag', async () => {
    await write('specs/a.md', `---\ntitle: A\ntags:\n  - x\n---\n# A`);
    await write('specs/b.md', `---\ntitle: B\ntags:\n  - y\n---\n# B`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const xTagged = await indexer.query({ type: 'spec', tag: 'x' });
    expect(xTagged.map((d) => d.id)).toEqual(['spec:project:a']);
  });

  it('maps deprecated/superseded status and surfaces it into ext', async () => {
    await write('knowhow/TIP-dead.md', `---\ntitle: Dead tip\nstatus: deprecated\n---\n# Dead tip\nBody`);
    await write('knowhow/DCS-old.md', `---\ntitle: Old decision\nstatus: superseded\n---\n# Old decision\nBody`);

    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.byId['knowhow-tip-dead'].status).toBe('deprecated');
    expect(index.byId['knowhow-tip-dead'].ext.status).toBe('deprecated');
    expect(index.byId['knowhow-dcs-old'].status).toBe('deprecated');
    expect(index.byId['knowhow-dcs-old'].ext.status).toBe('deprecated');
  });

  it('prefers canonical MaestroGraph data and falls back to the legacy graph', async () => {
    await mkdir(join(tmpRoot, 'kg'), { recursive: true });
    await write('codebase/knowledge-graph.json', JSON.stringify({
      nodes: [{ id: 'legacy', type: 'class', name: 'Legacy Only', summary: '', tags: [] }],
      edges: [],
    }));
    const db = new DatabaseSync(join(tmpRoot, 'kg', 'maestro.db'));
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        source_type TEXT NOT NULL,
        definition TEXT,
        body TEXT,
        category TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE edges (source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL);
      INSERT INTO nodes VALUES (
        'domain:canonical', 'domain_term', 'Canonical Node', NULL,
        'domain', 'from sqlite', NULL, NULL, 1
      );
    `);
    db.close();

    const canonical = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
    expect(canonical.entries.some(entry => entry.title === 'Canonical Node')).toBe(true);
    expect(canonical.entries.some(entry => entry.title === 'Legacy Only')).toBe(false);

    await rm(join(tmpRoot, 'kg', 'maestro.db'));
    const fallback = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
    expect(fallback.entries.some(entry => entry.title === 'Legacy Only')).toBe(true);
  });

  it('fills the result limit after deprecated filtering and parent caps', async () => {
    for (let index = 0; index < 6; index++) {
      await write(
        `specs/shared-${index}.md`,
        `---\ntitle: Ranking shared ${index}\nparent: shared-parent\n---\n` +
        `# Ranking shared ${index}\nRanking ranking ranking shared candidate.`,
      );
    }
    for (let index = 0; index < 4; index++) {
      await write(
        `specs/distinct-${index}.md`,
        `---\ntitle: Ranking distinct ${index}\nparent: distinct-parent-${index}\n---\n` +
        `# Ranking distinct ${index}\nRanking candidate.`,
      );
    }
    await write(
      'specs/deprecated.md',
      '---\ntitle: Ranking deprecated\nstatus: deprecated\n---\n' +
      '# Ranking deprecated\nRanking ranking ranking ranking ranking.',
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });

    const first = await indexer.searchWithMeta('ranking', 5, { skipEmbedding: true });
    const second = await indexer.searchWithMeta('ranking', 5, { skipEmbedding: true });
    const ids = first.results.map(result => result.entry.id);
    const shared = first.results.filter(result => result.entry.parent === 'shared-parent');

    expect(first.results).toHaveLength(5);
    expect(shared).toHaveLength(2);
    expect(ids).not.toContain('spec:project:deprecated');
    expect(second.results.map(result => result.entry.id)).toEqual(ids);
  });

  it('applies facets before ranking truncation and can include deprecated entries', async () => {
    for (let index = 0; index < 70; index++) {
      await write(
        `knowhow/TIP-noise-${index}.md`,
        `---\ntitle: Facet ranking noise ${index}\ntype: tip\ncategory: debug\n---\n` +
        '# Facet ranking noise\nFacet ranking ranking ranking ranking noise.',
      );
    }
    await write(
      'specs/architecture-constraints.md',
      `---\ncategory: arch\n---\n
<spec-entry category="arch" keywords="facet,atomic" date="2026-07-28" sid="S-facet-target" title="Atomic facet target">

### Atomic facet target

Facet ranking target.

</spec-entry>

<spec-entry category="arch" keywords="facet,legacy" date="2026-07-27" sid="S-facet-legacy" title="Legacy facet target" status="deprecated">

### Legacy facet target

Facet ranking legacy target.

</spec-entry>`,
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });

    const active = await indexer.searchWithMeta('facet ranking', 5, {
      skipEmbedding: true,
      filters: { type: 'spec', category: 'arch' },
    });
    expect(active.results.map(result => result.entry.title)).toContain('Atomic facet target');
    expect(active.results.map(result => result.entry.title)).not.toContain('Legacy facet target');

    const historical = await indexer.searchWithMeta('facet ranking legacy', 5, {
      skipEmbedding: true,
      filters: { type: 'spec', category: 'arch', includeDeprecated: true },
    });
    expect(historical.results.map(result => result.entry.title)).toContain('Legacy facet target');
  });

  it('keeps memory-only search independent from filesystem caches and indexes', async () => {
    await write(
      'specs/memory-only.md',
      '---\ntitle: Memory only sentinel\n---\n# Memory only sentinel\nHermetic in memory search.',
    );
    const staleArtifacts = [
      'search-cache.json',
      'wiki-index.json',
      'embedding-index.json',
      'embedding-index.bin',
    ];
    for (const path of staleArtifacts) await write(path, `stale:${path}`);
    const before = Object.fromEntries(await Promise.all(staleArtifacts.map(async path => {
      const info = await stat(join(tmpRoot, path));
      return [path, { bytes: await readFile(join(tmpRoot, path)), mtimeMs: info.mtimeMs }];
    })));

    const evidenceEvents: Array<{ event: string; site: string; queryId: null }> = [];
    const indexer = new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'memory-only',
      evidenceRecorder: event => evidenceEvents.push(event),
    });
    const firstIndex = await indexer.getSearchIndexWithMeta();
    const secondIndex = await indexer.getSearchIndexWithMeta();
    const result = await indexer.searchWithMeta('memory sentinel', 5);

    expect(firstIndex.cacheState).toBe('cold-build');
    expect(secondIndex).toEqual({ index: firstIndex.index, cacheState: 'cache-hit' });
    expect(result.results.map(item => item.entry.id)).toContain('spec:project:memory-only');
    expect(result.embeddingUsed).toBe(false);
    for (const path of staleArtifacts) {
      const info = await stat(join(tmpRoot, path));
      expect(await readFile(join(tmpRoot, path))).toEqual(before[path].bytes);
      expect(info.mtimeMs).toBe(before[path].mtimeMs);
    }
    await expect(readFile(join(tmpRoot, 'search-cache.json.tmp'))).rejects.toThrow();
    await expect(readFile(join(tmpRoot, 'embedding-index.db'))).rejects.toThrow();
    expect(evidenceEvents).toEqual([]);
  });

  it('lets read-only consumers reuse filesystem caches without publishing', async () => {
    await write(
      'specs/read-only.md',
      '---\ntitle: Read-only sentinel\n---\n# Read-only sentinel\nCache reuse without publication.',
    );
    const writer = withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot }));
    await writer.get();
    const artifacts = ['search-cache.json', 'wiki-index.json'];
    await expect.poll(async () => Promise.all(artifacts.map(path => stat(join(tmpRoot, path))
      .then(() => true, () => false)))).toEqual([true, true]);
    await writer.close();

    const before = Object.fromEntries(await Promise.all(artifacts.map(async path => {
      const info = await stat(join(tmpRoot, path));
      return [path, { bytes: await readFile(join(tmpRoot, path)), mtimeMs: info.mtimeMs }];
    })));
    const evidenceEvents: Array<{ event: string; site: string; queryId: null }> = [];
    const reader = new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'read-only',
      includeCliSessions: false,
      evidenceRecorder: event => evidenceEvents.push(event),
    });
    const result = await reader.searchWithMeta('read-only sentinel', 5, { skipEmbedding: true });
    await reader.close();

    expect(result.results.map(item => item.entry.id)).toContain('spec:project:read-only');
    expect(evidenceEvents.map(event => event.event)).toContain('filesystem-cache-read');
    expect(evidenceEvents).not.toContainEqual(expect.objectContaining({ event: 'filesystem-cache-write' }));
    expect(evidenceEvents).not.toContainEqual(expect.objectContaining({ event: 'filesystem-index-write' }));
    for (const path of artifacts) {
      const info = await stat(join(tmpRoot, path));
      expect(await readFile(join(tmpRoot, path))).toEqual(before[path].bytes);
      expect(info.mtimeMs).toBe(before[path].mtimeMs);
    }
  });

  it('rejects a search cache whose companion wiki index is missing', async () => {
    await write(
      'specs/paired-cache.md',
      '---\ntitle: Paired cache sentinel\n---\n# Paired cache sentinel',
    );
    const writer = withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot }));
    await writer.get();
    await expect.poll(() => stat(join(tmpRoot, 'wiki-index.json'))
      .then(() => true, () => false)).toBe(true);
    await writer.close();
    await rm(join(tmpRoot, 'wiki-index.json'));

    const reader = new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'read-only',
      includeCliSessions: false,
    });
    const subject = reader as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const originalBuild = subject.buildIndexCandidate.bind(reader);
    let builds = 0;
    subject.buildIndexCandidate = async () => {
      builds++;
      return originalBuild();
    };

    const index = await reader.get();
    await reader.close();
    expect(builds).toBe(1);
    expect(index.byId['spec:project:paired-cache']).toBeDefined();
  });

  it('invalidates a persisted cache when workspace configuration changes', async () => {
    await write('config.json', JSON.stringify({ linkedWorkspaces: [] }));
    await write('specs/config-cache.md', '---\ntitle: Config cache sentinel\n---\n# Config cache sentinel');
    const writer = withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot }));
    await writer.get();
    await expect.poll(() => stat(join(tmpRoot, 'search-cache.json'))
      .then(() => true, () => false)).toBe(true);
    await writer.close();

    await write('config.json', JSON.stringify({ linkedWorkspaces: [{ name: 'renamed' }] }));
    const reader = new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'read-only',
      includeCliSessions: false,
    });
    const subject = reader as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const originalBuild = subject.buildIndexCandidate.bind(reader);
    let builds = 0;
    subject.buildIndexCandidate = async () => {
      builds++;
      return originalBuild();
    };

    await reader.get();
    await reader.close();
    expect(builds).toBe(1);
  });

  it('coalesces invalidation during rebuild and only publishes the latest generation', async () => {
    await write('specs/old.md', '---\ntitle: Old generation\n---\n# Old generation');
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' });
    const subject = indexer as unknown as {
      scanFiles: () => Promise<unknown[]>;
    };
    const originalScanFiles = subject.scanFiles.bind(indexer);
    let scanCalls = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
    const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
    subject.scanFiles = async () => {
      scanCalls++;
      const entries = await originalScanFiles();
      if (scanCalls === 1) {
        markFirstStarted();
        await firstRelease;
      }
      return entries;
    };

    const firstGet = indexer.get();
    await firstStarted;
    await write('specs/latest.md', '---\ntitle: Latest generation\n---\n# Latest generation');
    indexer.invalidate();
    const secondGet = indexer.get();
    await Promise.resolve();
    expect(scanCalls).toBe(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([firstGet, secondGet]);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.byId['spec:project:latest']).toBeDefined();
    expect(scanCalls).toBe(2);
  });

  it('retries automatically when a source changes between pre/post scan snapshots', async () => {
    await write('specs/racing.md', '---\ntitle: Before scan edit\n---\n# Before scan edit');
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' });
    const subject = indexer as unknown as { scanFiles: () => Promise<unknown[]> };
    const originalScanFiles = subject.scanFiles.bind(indexer);
    let scanCalls = 0;
    subject.scanFiles = async () => {
      scanCalls++;
      const entries = await originalScanFiles();
      if (scanCalls === 1) {
        await write('specs/racing.md', '---\ntitle: After scan edit\n---\n# After scan edit');
      }
      return entries;
    };

    const index = await indexer.get();
    expect(scanCalls).toBe(2);
    expect(index.byId['spec:project:racing'].title).toBe('After scan edit');
  });

  it('prevents a stale process from winning protected cache publication', async () => {
    await write('specs/publication.md', '---\ntitle: Old publication\n---\n# Old publication');
    const stale = withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot }));
    const subject = stale as unknown as {
      prepareIndex: (index: unknown) => Promise<string>;
    };
    const originalPrepareIndex = subject.prepareIndex.bind(stale);
    let releaseStale!: () => void;
    let markStalePrepared!: () => void;
    const stalePrepared = new Promise<void>(resolve => { markStalePrepared = resolve; });
    const staleRelease = new Promise<void>(resolve => { releaseStale = resolve; });
    subject.prepareIndex = async index => {
      const temp = await originalPrepareIndex(index);
      markStalePrepared();
      await staleRelease;
      return temp;
    };

    await stale.get();
    await stalePrepared;
    await write('specs/publication.md', '---\ntitle: Current publication\n---\n# Current publication');
    await withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot })).get();
    await expect.poll(async () => {
      try {
        const cache = JSON.parse(await readFile(join(tmpRoot, 'search-cache.json'), 'utf-8'));
        return cache.entries.find((entry: { id: string }) => entry.id === 'spec:project:publication')?.title;
      } catch { return null; }
    }).toBe('Current publication');

    releaseStale();
    await new Promise(resolve => setTimeout(resolve, 50));
    const finalCache = JSON.parse(await readFile(join(tmpRoot, 'search-cache.json'), 'utf-8'));
    expect(finalCache.entries.find((entry: { id: string }) => entry.id === 'spec:project:publication')?.title)
      .toBe('Current publication');
  });

  it('keeps an aborted embedding generation single-flight until its replacement starts', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const subject = indexer as unknown as {
      loadOrBuildEmbeddings: (signal?: AbortSignal) => Promise<{
        modelId: string;
        dimension: number;
        docIds: string[];
        vectors: Float32Array[];
        builtAt: number;
      }>;
    };
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let firstSignal: AbortSignal | undefined;
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
    const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
    subject.loadOrBuildEmbeddings = async signal => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      const call = calls;
      if (call === 1) {
        firstSignal = signal;
        markFirstStarted();
        await firstRelease;
      }
      active--;
      return {
        modelId: `generation-${call}`,
        dimension: 2,
        docIds: [`doc-${call}`],
        vectors: [new Float32Array([call, 0])],
        builtAt: call,
      };
    };

    const firstGet = indexer.getEmbeddingIndex();
    await firstStarted;
    indexer.invalidate();
    const secondGet = indexer.getEmbeddingIndex();
    await Promise.resolve();
    expect(firstSignal?.aborted).toBe(true);
    expect(calls).toBe(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([firstGet, secondGet]);
    expect(firstResult).toBe(secondResult);
    expect(firstResult?.modelId).toBe('generation-2');
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('close aborts and joins the active background embedding flight', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const subject = indexer as unknown as {
      loadOrBuildEmbeddings: (signal?: AbortSignal) => Promise<null>;
    };
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    let releaseBuild!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseBuild = resolve; });
    subject.loadOrBuildEmbeddings = async signal => {
      observedSignal = signal;
      markStarted();
      await release;
      return null;
    };

    const build = indexer.getEmbeddingIndex();
    await started;
    const closing = indexer.close();
    expect(observedSignal?.aborted).toBe(true);
    let closed = false;
    void closing.then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);

    releaseBuild();
    await expect(Promise.all([build, closing])).resolves.toEqual([null, undefined]);
    await expect(indexer.getEmbeddingIndex()).resolves.toBeNull();
  });

  it('reports real search-index cache state across reuse and invalidation', async () => {
    await write(
      'specs/cache-state.md',
      '---\ntitle: Cache state sentinel\n---\n# Cache state sentinel\nCold index evidence.',
    );
    const indexer = new WikiIndexer({
      workflowRoot: tmpRoot,
      persistence: 'memory-only',
    });

    const first = await indexer.getSearchIndexWithMeta();
    const second = await indexer.getSearchIndexWithMeta();
    expect(first.cacheState).toBe('cold-build');
    expect(second).toEqual({ index: first.index, cacheState: 'cache-hit' });
    await expect(indexer.getSearchIndex()).resolves.toBe(first.index);

    indexer.invalidate();
    const rebuilt = await indexer.getSearchIndexWithMeta();
    expect(rebuilt.cacheState).toBe('cold-build');
    expect(rebuilt.index).not.toBe(first.index);
  });

  it('records actual filesystem cache/index branch events', async () => {
    await write(
      'specs/event-evidence.md',
      '---\ntitle: Event evidence\n---\n# Event evidence\nBranch-site recorder.',
    );
    const writeEvents: Array<{ event: string; site: string; queryId: null }> = [];
    const writer = new WikiIndexer({
      workflowRoot: tmpRoot,
      evidenceRecorder: event => writeEvents.push(event),
    });

    await writer.get();
    await expect.poll(async () => {
      try {
        await stat(join(tmpRoot, 'wiki-index.json'));
        await stat(join(tmpRoot, 'search-cache.json'));
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
    expect(writeEvents).toEqual(expect.arrayContaining([
      {
        event: 'filesystem-cache-write',
        site: 'WikiIndexer.persistSearchCache.createWriteStream',
        queryId: null,
      },
      {
        event: 'filesystem-index-write',
        site: 'WikiIndexer.persistIndex.writeFile',
        queryId: null,
      },
    ]));

    const readEvents: Array<{ event: string; site: string; queryId: null }> = [];
    const reader = new WikiIndexer({
      workflowRoot: tmpRoot,
      evidenceRecorder: event => readEvents.push(event),
    });
    await reader.get();
    expect(readEvents).toContainEqual({
      event: 'filesystem-cache-read',
      site: 'WikiIndexer.tryLoadSearchCache.readFile',
      queryId: null,
    });
  });

  it('rejects malformed search-cache entries at runtime and rebuilds from source', async () => {
    await write('specs/runtime-cache.md', '---\ntitle: Runtime cache source\n---\n# Runtime cache source');
    const writer = withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot }));
    await writer.get();
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(tmpRoot, 'search-cache.json'), 'utf-8')).entries.length; }
      catch { return -1; }
    }).toBeGreaterThan(0);

    const cachePath = join(tmpRoot, 'search-cache.json');
    const cache = JSON.parse(await readFile(cachePath, 'utf-8'));
    cache.entries = [{ ...cache.entries[0], type: 'not-a-wiki-type' }];
    await writeFile(cachePath, JSON.stringify(cache));

    const rebuilt = await withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot })).get();
    expect(rebuilt.byId['spec:project:runtime-cache']?.title).toBe('Runtime cache source');
  });

  it('rejects an oversized search cache by stat before allocating its payload', async () => {
    const cachePath = join(tmpRoot, 'search-cache.json');
    const handle = await open(cachePath, 'w');
    try { await handle.truncate(128 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await write('specs/capped-cache.md', '---\ntitle: Capped cache source\n---\n# Capped cache source');

    const index = await withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot })).get();
    expect(index.byId['spec:project:capped-cache']).toBeDefined();
  });
});

describe('WikiIndexer ref links keep knowhow type prefix', () => {
  it('spec-entry ref resolves to the prefixed container id (no broken link)', async () => {
    // Container id keeps the prefix: knowhow-rcp-... — the ref target must match.
    await write(
      'knowhow/RCP-stripe-min-amount-stripe-minimum-guard.md',
      `---\ntitle: Stripe minimum guard\n---\n# Stripe minimum guard\nBody`,
    );
    // QRF is not in the old strip-list — used to coincidentally work; must stay correct.
    await write(
      'knowhow/QRF-linked-listings-fast-path.md',
      `---\ntitle: Linked listings fast path\n---\n# Linked listings\nBody`,
    );
    await write(
      'specs/payments.md',
      `---\ntitle: Payments\n---\n# Payments\n\n` +
        `<spec-entry title="Stripe min amount guard" type="coding" ` +
        `ref="knowhow/RCP-stripe-min-amount-stripe-minimum-guard.md">\n` +
        `### Stripe min amount guard\nEnforce Stripe minimum charge amount.\n</spec-entry>\n\n` +
        `<spec-entry title="Linked listings fast path" type="coding" ` +
        `ref="knowhow/QRF-linked-listings-fast-path.md">\n` +
        `### Linked listings fast path\nFast path for linked listings.\n</spec-entry>\n`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const rcpSub = index.entries.find((e) => e.type === 'spec' && e.title === 'Stripe min amount guard');
    expect(rcpSub?.related).toContain('knowhow-rcp-stripe-min-amount-stripe-minimum-guard');
    expect(index.byId['knowhow-rcp-stripe-min-amount-stripe-minimum-guard']).toBeDefined();

    const qrfSub = index.entries.find((e) => e.type === 'spec' && e.title === 'Linked listings fast path');
    expect(qrfSub?.related).toContain('knowhow-qrf-linked-listings-fast-path');
    expect(index.byId['knowhow-qrf-linked-listings-fast-path']).toBeDefined();

    const broken = buildGraph(index).brokenLinks.map((b) => b.target);
    expect(broken).not.toContain('knowhow-stripe-min-amount-stripe-minimum-guard');
    expect(broken).not.toContain('knowhow-rcp-stripe-min-amount-stripe-minimum-guard');
    expect(broken).not.toContain('knowhow-qrf-linked-listings-fast-path');
  });

  it('knowhow-entry ref resolves to the prefixed container id (no broken link)', async () => {
    await write(
      'knowhow/REF-payment-architecture.md',
      `---\ntitle: Payment architecture\n---\n# Payment architecture\nBody`,
    );
    await write(
      'knowhow/KNW-session-notes.md',
      `---\ntitle: Session notes\n---\n# Session notes\n\n` +
        `<knowhow-entry title="See payment arch" type="reference" ` +
        `ref="knowhow/REF-payment-architecture.md">\n` +
        `### See payment arch\nRelated reference.\n</knowhow-entry>\n`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const sub = index.entries.find((e) => e.title === 'See payment arch');
    expect(sub?.related).toContain('knowhow-ref-payment-architecture');
    expect(index.byId['knowhow-ref-payment-architecture']).toBeDefined();

    const broken = buildGraph(index).brokenLinks.map((b) => b.target);
    expect(broken).not.toContain('knowhow-payment-architecture');
    expect(broken).not.toContain('knowhow-ref-payment-architecture');
  });
});

describe('graph-analysis', () => {
  it('detects orphans as entries with no in and no out edges', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\nLinks [[B]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B`);
    await write('specs/c.md', `---\ntitle: C\n---\n# C`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const orphans = detectOrphans(graph, index.entries);

    expect(orphans).toContain('spec:project:c');
    expect(orphans).not.toContain('spec:project:a');
    expect(orphans).not.toContain('spec:project:b');
  });

  it('reports broken links', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[does-not-exist]]`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    expect(graph.brokenLinks).toEqual(
      expect.arrayContaining([{ sourceId: 'spec:project:a', target: 'does-not-exist' }]),
    );
  });

  it('ranks hubs by incoming link count', async () => {
    await write('specs/hub.md', `---\ntitle: Hub\n---\n# Hub`);
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[Hub]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B\n[[Hub]]`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const hubs = detectHubs(graph, 5);
    expect(hubs[0]).toEqual({ id: 'spec:project:hub', inDegree: 2 });
  });

  it('computes health score with penalties', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[missing]]`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const health = computeHealth(index, graph);
    expect(health.score).toBeLessThan(100);
    expect(health.totals.brokenLinks).toBe(1);
  });
});

describe('search (BM25)', () => {
  it('tokenizes lowercase and drops stop words', () => {
    expect(tokenize('The Quick Brown Fox')).toEqual(['quick', 'brown', 'fox']);
  });

  it('ranks exact title match first', async () => {
    await write('specs/auth.md', `---\ntitle: Authentication Guide\n---\n# Auth\nJWT bearer tokens`);
    await write('specs/misc.md', `---\ntitle: Misc\n---\n# Misc\nNothing about auth here`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    const results = searchBM25(inv, 'authentication');
    expect(results[0].docId).toBe('spec:project:auth');
  }, 15_000);

  it('returns empty for stop-word-only query', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    expect(searchBM25(inv, 'the and or')).toEqual([]);
  });

  it('emits CJK 2/3-grams', () => {
    const tokens = tokenize('用户认证');
    // 2-grams: 用户, 户认, 认证 ; 3-grams: 用户认, 户认证
    expect(tokens).toEqual(expect.arrayContaining(['用户', '户认', '认证', '用户认', '户认证']));
    // No 4-gram explosion
    expect(tokens.every((t) => t.length <= 3)).toBe(true);
  });

  it('mixed CJK + Latin tokenization', () => {
    const tokens = tokenize('用户auth流程');
    expect(tokens).toEqual(expect.arrayContaining(['用户', 'auth', '流程']));
  });

  it('CJK BM25 matches partial substrings (regression: previously failed)', async () => {
    await write('specs/auth.md', `---\ntitle: 用户认证流程\n---\n# 认证\n关于用户的 JWT 认证`);
    await write('specs/misc.md', `---\ntitle: 杂项\n---\n# 杂项\n无关内容`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    const results = searchBM25(inv, '认证');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toContain('auth');
  });
});

describe('WikiWriter', () => {
  it('creates a new spec markdown file', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.create({
      type: 'spec',
      slug: 'new-spec',
      title: 'Fresh Spec',
      body: '# Fresh Spec\nHello',
    });
    expect(entry.id).toBe('spec:project:new-spec');
    expect(entry.source.path).toBe('specs/new-spec.md');
  });

  it('rejects slug with traversal attempts', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({
        type: 'spec',
        slug: '../../../etc/hosts',
        title: 'evil',
        body: 'x',
      }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('returns 409 on stale expectedHash', async () => {
    // Use knowhow path for body-update hash test (spec body updates are blocked)
    await write('knowhow/KNW-s.md', `---\ntitle: S\n---\n# S\norig`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    try {
      await writer.update('knowhow-knw-s', {
        body: 'updated',
        expectedHash: 'deadbeef',
      });
      expect.fail('expected CONFLICT');
    } catch (err) {
      expect(err).toBeInstanceOf(WikiWriteError);
      expect((err as WikiWriteError).code).toBe('CONFLICT');
    }
  });

  it('updates existing entry preserving frontmatter', async () => {
    // Use knowhow path for body-update test (spec body updates are blocked)
    await write('knowhow/KNW-s.md', `---\ntitle: Old\ntags:\n  - a\n---\n# Old\nbody`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.update('knowhow-knw-s', {
      title: 'New',
      body: 'new body',
    });
    expect(entry.title).toBe('New');
    expect(entry.tags).toEqual(['a']);
  });

  it('removes an existing spec file', async () => {
    await write('specs/gone.md', `---\ntitle: Gone\n---\n# Gone`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await writer.remove('spec:project:gone');
    const index = await indexer.get();
    expect(index.byId['spec:project:gone']).toBeUndefined();
  });

  it('rejects writes on virtual entries', async () => {
    await mkdir(join(tmpRoot, 'issues'), { recursive: true });
    await writeFile(
      join(tmpRoot, 'issues', 'current.jsonl'),
      JSON.stringify({ id: 'I1', title: 'Test Issue', status: 'open' }) + '\n',
      'utf-8',
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const virtualId = index.entries.find((d) => d.source.kind === 'virtual')?.id;
    expect(virtualId).toBeDefined();
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(writer.update(virtualId!, { body: 'x' })).rejects.toThrow(WikiWriteError);
  });
});

describe('virtual adapters: codebase doc-index', () => {
  it('emits component / feature / requirement / ADR virtual entries with stable ids', async () => {
    await write(
      'codebase/doc-index.json',
      JSON.stringify({
        version: '1.0',
        project: 'test',
        last_updated: '2026-05-24T00:00:00.000Z',
        components: [
          { id: 'TC-001', name: 'AuthService', type: 'service', code_locations: ['src/auth/service.ts'], feature_ids: ['FT-001'], symbols: ['login', 'logout'] },
        ],
        features: [
          { id: 'FT-001', name: 'Authentication', status: 'active', component_ids: ['TC-001'], requirement_ids: ['REQ-001'], phase: null },
        ],
        requirements: [
          { id: 'REQ-001', title: 'User login', priority: 'must', feature_id: 'FT-001', status: 'pending', acceptance_criteria: ['Returns JWT'] },
        ],
        architecture_decisions: [
          { id: 'ADR-001', title: 'Use JWT', component_ids: ['TC-001'], decision: 'Adopt JWT', rationale: 'Stateless' },
        ],
      }),
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const ids = index.entries.map((d) => d.id);

    expect(ids).toContain('codebase-comp-tc-001');
    expect(ids).toContain('codebase-feat-ft-001');
    expect(ids).toContain('codebase-req-req-001');
    expect(ids).toContain('codebase-adr-adr-001');

    const comp = index.byId['codebase-comp-tc-001'];
    expect(comp.type).toBe('knowhow');
    expect(comp.category).toBe('arch');
    expect(comp.source.kind).toBe('virtual');
    expect(comp.source.path).toBe('codebase/tech-registry/authservice.md');
    expect(comp.related).toContain('codebase-feat-ft-001');

    const req = index.byId['codebase-req-req-001'];
    expect(req.category).toBe('review');
    expect(req.parent).toBe('codebase-feat-ft-001');

    // Backlink: ADR → component via related[]
    expect(index.backlinks['codebase-comp-tc-001']).toContain('codebase-adr-adr-001');
  });

  it('survives missing doc-index.json silently', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('codebase-'))).toEqual([]);
  });

  it('survives malformed doc-index.json without throwing', async () => {
    await write('codebase/doc-index.json', 'not json');
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('codebase-'))).toEqual([]);
  });
});

describe('virtual adapters: run-mode sessions', () => {
  const SESSION_ID = '20260713-search';
  const SESSION_ENTRY_ID = 'session-20260713-search';
  const DEBUG_RUN_ID = 'RUN-002';
  const ANALYZE_RUN_ID = 'RUN-005';
  const REVIEW_RUN_ID = 'RUN-010';
  const DRAFT_RUN_ID = 'RUN-007';

  const runEntryId = (runId: string): string => `session-run-20260713-search-${runId.toLowerCase()}`;

  function v11Run(
    runId: string,
    command: string,
    status: 'running' | 'sealed',
    primary: string | null,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema_version: 'run/1.1',
      run_id: runId,
      parent_run_id: null,
      command,
      status,
      goal: null,
      input: { args: [], consumes: [] },
      gates: [],
      primary,
      handoff: null,
      started_at: '2026-07-13T00:00:00.000Z',
      ended_at: status === 'sealed' ? '2026-07-13T01:00:00.000Z' : null,
      ...overrides,
    };
  }

  async function writeRunModeFixture(sessionStatus: 'running' | 'sealed' | 'archived' = 'sealed'): Promise<void> {
    await write('specs/run-indexing-rule.md', [
      '---',
      'title: Run indexing rule',
      'status: active',
      'category: coding',
      `sourceRef: "${SESSION_ID}/${REVIEW_RUN_ID}"`,
      '---',
      '# Run indexing rule',
      'A promoted rule with session provenance.',
    ].join('\n'));

    await write('sessions/20260713-search/session.json', JSON.stringify({
      schema_version: 'session/1.1',
      session_id: SESSION_ID,
      intent: 'Optimize Maestro Search indexing',
      status: sessionStatus,
      revision: 7,
      active_run_id: sessionStatus === 'running' ? DRAFT_RUN_ID : null,
      boundary_contract: {
        in_scope: ['wiki index'], out_of_scope: [], constraints: [], definition_of_done: 'Searchable sealed Runs',
      },
      gates: [],
      orchestration: {
        engine: 'manual', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [],
      },
      requests: [],
      lifecycle: {
        sealed_at: sessionStatus === 'running' ? null : '2026-07-13T02:00:00.000Z',
        seal_summary: 'Session seal fallback summary',
        promoted: sessionStatus === 'running' ? [] : ['spec:project:run-indexing-rule'],
        forked_from: null,
      },
    }));
    await write('sessions/20260713-search/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.1',
      artifacts: {
        'ART-debug-notes': {
          kind: 'notes', role: 'attachment', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/notes.json', hash: '0'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-diagnosis': {
          kind: 'diagnosis', role: 'primary', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/diagnosis.json', hash: 'a'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-analysis': {
          kind: 'findings', role: 'primary', run_id: ANALYZE_RUN_ID,
          path: 'runs/20260713-005-analyze/outputs/findings.json', hash: 'b'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-review': {
          kind: 'review-findings', role: 'primary', run_id: REVIEW_RUN_ID,
          path: 'runs/20260713-010-review/outputs/review-findings.json', hash: 'c'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-draft': {
          kind: 'draft-notes', role: 'attachment', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/draft-notes.json', hash: 'd'.repeat(64),
          status: 'draft', replaces: null,
        },
        'ART-running': {
          kind: 'running-output', role: 'primary', run_id: DRAFT_RUN_ID,
          path: 'runs/20260713-007-test/outputs/running-output.json', hash: 'e'.repeat(64),
          status: 'sealed', replaces: null,
        },
      },
      aliases: {
        'latest-debug': 'ART-diagnosis',
        'current-analysis': 'ART-analysis',
        'latest-review': 'ART-review',
        'draft-notes': 'ART-draft',
      },
    }));

    // Write Run directories in reverse sequence order. The adapter must choose
    // the latest sealed Run by the NNN directory sequence, not readdir order.
    await write('sessions/20260713-search/runs/20260713-010-review/run.json', JSON.stringify(v11Run(
      REVIEW_RUN_ID,
      'quality-review',
      'sealed',
      'ART-review',
      {
        gates: [
          { id: 'GATE-010-01', title: 'Legacy browser proof', blocking: false, status: 'waived', check: { type: 'manual', prompt: 'Verify browser' }, waiver: 'CI has no browser (qa-bot @ 2026-07-13)' },
          { id: 'GATE-010-02', title: 'Unit tests', blocking: true, status: 'passed', check: { type: 'command', argv: ['npm', 'test'], expect_exit: 0 }, waiver: null },
        ],
        handoff: {
          verdict: 'ready_with_concerns', summary: 'Review handoff fallback', constraints: [], decisions: [],
          concerns: [], artifact_refs: ['ART-review'], next: [],
        },
        started_at: '2026-07-13T01:30:00.000Z', ended_at: '2026-07-13T02:00:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-010-review/outputs/review-findings.json', JSON.stringify({
      summary: 'Latest review artifact summary', findings: [{ severity: 'low', title: 'No regression' }],
    }));
    await write('sessions/20260713-search/runs/20260713-010-review/report.md', [
      '---',
      'summary: Review projection fallback',
      '---',
      'Inline producer reference {{aref:latest-debug#/diagnosis/0/summary}}.',
      'Unknown reference {{aref:missing-alias#/ignored}}.',
      '',
      '```aref',
      'source: ART-analysis',
      'pointer: /findings',
      'as: table',
      '```',
      '',
      '```aref',
      'source: draft-notes',
      'pointer: /notes',
      'as: list',
      '```',
    ].join('\n'));

    await write('sessions/20260713-search/runs/20260713-005-analyze/run.json', JSON.stringify(v11Run(
      ANALYZE_RUN_ID,
      'analyze',
      'sealed',
      'ART-analysis',
      {
        handoff: {
          verdict: 'ready', summary: 'Analysis handoff fallback', constraints: [], decisions: [],
          concerns: [], artifact_refs: ['ART-analysis'], next: [],
        },
        started_at: '2026-07-13T01:00:00.000Z', ended_at: '2026-07-13T01:20:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-005-analyze/outputs/findings.json', JSON.stringify({
      summary: 'Analysis artifact summary', findings: [{ summary: 'Intermediate evidence' }],
    }));

    await write('sessions/20260713-search/runs/20260713-002-debug/run.json', JSON.stringify(v11Run(
      DEBUG_RUN_ID,
      'quality-debug',
      'sealed',
      'ART-diagnosis',
      {
        handoff: {
          verdict: 'ready',
          summary: 'Debug handoff fallback',
          constraints: [
            { text: 'Preserve locked search semantics', status: 'locked' },
            { text: 'Explore optional telemetry', status: 'open' },
          ],
          decisions: [
            { text: 'Adopt zephyrdecisionneedle for exact discovery', status: 'accepted' },
            { text: 'Discard rejecteddecisionneedle entirely', status: 'rejected' },
          ],
          concerns: ['Embedding fallback remains observable'],
          artifact_refs: ['ART-diagnosis'],
          next: [],
        },
        started_at: '2026-07-13T00:10:00.000Z', ended_at: '2026-07-13T00:40:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/diagnosis.json', JSON.stringify({
      summary: 'Typed diagnosis is the preferred summary', diagnosis: [{ summary: 'Nested diagnosis evidence' }],
    }));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/notes.json', JSON.stringify({
      summary: 'Secondary attachment must not replace the primary summary',
    }));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/draft-notes.json', JSON.stringify({
      summary: 'MUST NOT INDEX DRAFT ARTIFACT',
    }));

    await write('sessions/20260713-search/runs/20260713-007-test/run.json', JSON.stringify(v11Run(
      DRAFT_RUN_ID,
      'quality-test',
      'running',
      'ART-running',
      { started_at: '2026-07-13T01:25:00.000Z' },
    )));
    await write('sessions/20260713-search/runs/20260713-007-test/outputs/running-output.json', JSON.stringify({
      summary: 'MUST NOT INDEX RUNNING RUN',
    }));
  }

  async function writeCategoryFixture(): Promise<Map<string, string>> {
    const cases = new Map<string, string>([
      ['grill', 'arch'], ['maestro-grill', 'arch'],
      ['brainstorm', 'arch'], ['maestro-brainstorm', 'arch'],
      ['blueprint', 'arch'], ['maestro-blueprint', 'arch'],
      ['roadmap', 'arch'], ['maestro-roadmap', 'arch'],
      ['analyze', 'arch'], ['maestro-analyze', 'arch'],
      ['plan', 'coding'], ['maestro-plan', 'coding'],
      ['execute', 'coding'], ['maestro-execute', 'coding'],
      ['verify', 'review'], ['review', 'review'], ['quality-review', 'review'],
      ['test', 'test'], ['quality-test', 'test'], ['auto-test', 'test'], ['quality-auto-test', 'test'],
      ['debug', 'debug'], ['quality-debug', 'debug'],
      ['retrospective', 'learning'], ['quality-retrospective', 'learning'],
    ]);
    await write('sessions/category-map/session.json', JSON.stringify({
      schema_version: 'session/1.1', session_id: 'category-map', intent: 'Category mapping', status: 'sealed',
      revision: 1, active_run_id: null,
      boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: 'All categories mapped' },
      gates: [], orchestration: { engine: 'manual', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [] },
      requests: [], lifecycle: { sealed_at: '2026-07-13T03:00:00.000Z', seal_summary: null, promoted: [], forked_from: null },
    }));
    await write('sessions/category-map/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.1', artifacts: {}, aliases: {},
    }));
    let sequence = 1;
    for (const command of cases.keys()) {
      const seq = String(sequence).padStart(3, '0');
      const runId = `RUN-CAT-${seq}`;
      await write(`sessions/category-map/runs/20260713-${seq}-${command}/run.json`, JSON.stringify(v11Run(
        runId, command, 'sealed', null, { ended_at: `2026-07-13T03:${seq.slice(-2)}:00.000Z` },
      )));
      sequence++;
    }
    return cases;
  }

  async function writeLegacyRunModeFixture(): Promise<void> {
    await write('specs/legacy-promoted-rule.md', [
      '---',
      'title: Legacy promoted rule',
      'status: active',
      'category: coding',
      '---',
      '# Legacy promoted rule',
      'A rule promoted from a v1.0 session.',
    ].join('\n'));

    await write('sessions/20260712-legacy/session.json', JSON.stringify({
      schema_version: 'session/1.0',
      session_id: '20260712-legacy',
      intent: 'Legacy schema indexing',
      status: 'sealed',
      identity_revision: 1,
      activity_revision: 3,
      active_run_id: null,
      latest_completed_run_id: 'RUN-001',
      boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: 'Sealed legacy run searchable' },
      orchestration: { engine: 'manual', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [] },
      requests: [],
      lifecycle: {
        sealed_at: '2026-07-12T05:00:00.000Z',
        seal_summary: 'Legacy seal summary',
        promoted_spec_ids: ['project:legacy-promoted-rule'],
        promoted_knowhow_ids: [],
        forked_from: null,
      },
      refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
    }));
    await write('sessions/20260712-legacy/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.0',
      revision: 4,
      artifacts: {
        'ART-legacy-diagnosis': {
          kind: 'diagnosis', role: 'primary', producer_run_id: 'RUN-001',
          relative_path: 'runs/20260712-001-quality-debug/outputs/diagnosis.json',
          media_type: 'application/json', schema_version: 'diagnosis/1',
          content_hash: 'a'.repeat(64), size: 100, status: 'sealed', derived_from: [], replaces: null,
        },
      },
      aliases: { 'latest-diagnosis': 'ART-legacy-diagnosis' },
    }));
    await write('sessions/20260712-legacy/gates.json', JSON.stringify({
      schema_version: 'gates/1.0',
      revision: 2,
      gates: {
        'GATE-001': {
          key: 'legacy-browser', title: 'Legacy browser proof', scope: 'exit', run_id: 'RUN-001',
          required: true, blocking: false, applicable_modes: ['standard'], status: 'waived',
          check: { type: 'manual', prompt: 'Verify browser' }, evidence_refs: [],
          waiver: { reason: 'CI has no browser', approved_by: 'qa-bot', approved_at: '2026-07-12' },
        },
        'GATE-002': {
          key: 'unit-tests', title: 'Unit tests', scope: 'exit', run_id: 'RUN-001',
          required: true, blocking: true, applicable_modes: ['standard'], status: 'passed',
          check: { type: 'command', argv: ['npm', 'test'], expect_exit: 0 }, evidence_refs: [],
          waiver: null,
        },
      },
      summary: { total: 2, passed: 1, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null },
    }));

    await write('sessions/20260712-legacy/runs/20260712-001-quality-debug/run.json', JSON.stringify({
      schema_version: 'command-run/1.0',
      session_id: '20260712-legacy', run_id: 'RUN-001', sequence: 1, parent_run_id: null,
      command: {
        name: 'quality-debug', version: '1.0.0', source_path: 'commands/quality-debug.md',
        content_hash: 'f'.repeat(64), resolved_prompt_hash: 'f'.repeat(64),
      },
      status: 'sealed',
      input: { args: [], consumes: [], context_identity_revision: 1 },
      gate_ids: ['GATE-001', 'GATE-002'],
      output: { produces: ['ART-legacy-diagnosis'], primary_artifact_id: 'ART-legacy-diagnosis', verdict: 'ready' },
      handoff: {
        schema_version: 'command-handoff/1.0', producer_run_id: 'RUN-001', command: 'quality-debug',
        verdict: 'ready', summary: 'Legacy handoff fallback',
        constraints: [
          { id: 'C1', status: 'locked', text: 'Keep legacy adapter read-only' },
          { id: 'C2', status: 'open', text: 'Open telemetry question' },
        ],
        decisions: [
          { id: 'D1', status: 'accepted', text: 'Adopt legacynormalizationneedle for dual-schema reads' },
          { id: 'D2', status: 'rejected', text: 'Discard legacyrejectedneedle entirely' },
        ],
        concerns: ['Legacy sessions must stay searchable'],
        artifact_refs: ['ART-legacy-diagnosis'], next: [], details: {},
      },
      started_at: '2026-07-12T04:00:00.000Z',
      completed_at: '2026-07-12T04:30:00.000Z',
      sealed_at: '2026-07-12T04:45:00.000Z',
    }));
    await write('sessions/20260712-legacy/runs/20260712-001-quality-debug/outputs/diagnosis.json', JSON.stringify({
      summary: 'Legacy diagnosis artifact summary',
    }));

    await write('sessions/20260712-legacy/runs/20260712-002-analyze/run.json', JSON.stringify({
      schema_version: 'command-run/1.0',
      session_id: '20260712-legacy', run_id: 'RUN-002', sequence: 2, parent_run_id: null,
      command: {
        name: 'analyze', version: '1.0.0', source_path: 'commands/analyze.md',
        content_hash: 'f'.repeat(64), resolved_prompt_hash: 'f'.repeat(64),
      },
      status: 'completed',
      input: { args: [], consumes: [], context_identity_revision: 1 },
      gate_ids: [],
      output: { produces: [], primary_artifact_id: null, verdict: 'ready' },
      handoff: null,
      started_at: '2026-07-12T04:50:00.000Z',
      completed_at: '2026-07-12T04:55:00.000Z',
      sealed_at: null,
    }));
  }

  it('indexes v1.0 sealed sessions through the legacy normalization path', async () => {
    await writeLegacyRunModeFixture();
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();

    const session = index.byId['session-20260712-legacy'];
    const run = index.byId['session-run-20260712-legacy-run-001'];
    expect(session).toBeDefined();
    expect(run).toBeDefined();
    // completed-but-unsealed v1.0 runs stay out of the index
    expect(index.byId['session-run-20260712-legacy-run-002']).toBeUndefined();

    expect(run.title).toBe('quality-debug RUN-001');
    expect(run.category).toBe('debug');
    expect(run.updated).toBe('2026-07-12T04:45:00.000Z');
    expect(run.summary).toContain('Legacy diagnosis artifact summary');
    expect(run.summary).toContain('Adopt legacynormalizationneedle for dual-schema reads');
    expect(run.body).toContain('## 决策');
    expect(run.body).not.toContain('legacyrejectedneedle');
    expect(run.body).toContain('## 约束');
    expect(run.body).toContain('Keep legacy adapter read-only');
    expect(run.body).not.toContain('Open telemetry question');
    expect(run.body).toContain('## 关注点');
    expect(run.body).toContain('Legacy sessions must stay searchable');
    expect(run.body).toContain('## 豁免');
    expect(run.body).toContain('CI has no browser (qa-bot @ 2026-07-12)');
    expect(run.body).not.toContain('Unit tests');
    expect(run.tags).toEqual(expect.arrayContaining(['quality-debug', 'verdict:ready', 'constraint', 'diagnosis']));
    expect(run.ext.artifactIds).toEqual(['ART-legacy-diagnosis']);

    expect(session.summary).toContain('Legacy diagnosis artifact summary');
    expect(session.related).toEqual(expect.arrayContaining([
      'session-run-20260712-legacy-run-001', 'spec:project:legacy-promoted-rule',
    ]));
    expect(index.byId['spec:project:legacy-promoted-rule'].related).toContain('session-20260712-legacy');
  });

  it('indexes the canonical command-run/1.1 writer shape and invalidates old search caches', async () => {
    const sessionId = '20260718-runtime-shape';
    const runId = '20260718-001-quality-review';
    await write('specs/runtime-promoted-rule.md', [
      '---',
      'title: Runtime promoted rule',
      'status: active',
      'category: review',
      '---',
      '# Runtime promoted rule',
      'Canonical SessionStore promotion target.',
    ].join('\n'));
    await write(`sessions/${sessionId}/session.json`, JSON.stringify({
      schema_version: 'session/1.1', session_id: sessionId, intent: 'Runtime writer fixture', status: 'sealed',
      identity_revision: 1, activity_revision: 5, active_run_id: null, latest_completed_run_id: runId,
      boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: 'Searchable' },
      orchestration: { engine: 'coordinator', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [] },
      requests: [],
      lifecycle: {
        sealed_at: '2026-07-18T10:00:00.000Z', seal_summary: 'Runtime writer sealed',
        promoted_spec_ids: ['project:runtime-promoted-rule'], promoted_knowhow_ids: [], forked_from: null,
      },
      refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
    }));
    await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 1,
      artifacts: {
        'ART-runtime-review': {
          kind: 'review-findings', role: 'primary', producer_run_id: runId,
          relative_path: `runs/${runId}/outputs/review-findings.json`, media_type: 'application/json',
          schema_version: 'review-findings/1.0', content_hash: 'a'.repeat(64), size: 64,
          status: 'sealed', derived_from: [], replaces: null,
        },
      },
      aliases: { 'latest-review': 'ART-runtime-review' },
    }));
    await write(`sessions/${sessionId}/gates.json`, JSON.stringify({
      schema_version: 'gates/1.0', revision: 1,
      gates: {
        'GATE-runtime-browser': {
          key: 'browser', title: 'Runtime browser proof', scope: 'exit', run_id: runId,
          required: true, blocking: false, applicable_modes: ['standard'], status: 'waived',
          check: { type: 'manual', prompt: 'Verify browser' }, evidence_refs: [],
          waiver: { reason: 'Headless environment', approved_by: 'qa', approved_at: '2026-07-18' },
        },
      },
      summary: { total: 1, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null },
    }));
    await write(`sessions/${sessionId}/runs/${runId}/run.json`, JSON.stringify({
      schema_version: 'command-run/1.1', session_id: sessionId, run_id: runId, sequence: 1,
      parent_run_id: null, chain_step_id: null, resolved_platform: 'codex', goal_binding: null,
      checkpoint_expectation: null, checkpoint: null, retry_fence: null,
      command: {
        name: 'quality-review', version: '1.0', source_path: '.claude/commands/quality-review.md',
        content_hash: 'b'.repeat(64), resolved_prompt_hash: 'c'.repeat(64), contract_hash: 'd'.repeat(64),
      },
      status: 'sealed', input: { args: ['--strict'], consumes: [], context_identity_revision: 1 },
      gate_ids: ['GATE-runtime-browser'],
      output: { produces: ['ART-runtime-review'], primary_artifact_id: 'ART-runtime-review', verdict: 'ready_with_concerns' },
      handoff: {
        schema_version: 'command-handoff/1.0', producer_run_id: runId, command: 'quality-review',
        verdict: 'ready_with_concerns', summary: 'Runtime handoff', constraints: [], decisions: [],
        concerns: ['Keep gate provenance'], artifact_refs: ['ART-runtime-review'], next: [], details: {},
      },
      started_at: '2026-07-18T09:00:00.000Z', completed_at: '2026-07-18T09:30:00.000Z',
      sealed_at: '2026-07-18T09:40:00.000Z',
    }));
    await write(`sessions/${sessionId}/runs/${runId}/outputs/review-findings.json`, JSON.stringify({
      summary: 'Runtime-shaped review summary',
    }));
    await write('search-cache.json', JSON.stringify({ version: 1, generatedAt: 1, mtimeSnapshot: [], entries: [] }));

    const index = await withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot })).get();
    const session = index.byId[`session-${sessionId}`];
    const run = index.byId[`session-run-${sessionId}-${runId.toLowerCase()}`];
    expect(session.ext.runCount).toBe(1);
    expect(session.related).toContain('spec:project:runtime-promoted-rule');
    expect(index.byId['spec:project:runtime-promoted-rule'].related).toContain(`session-${sessionId}`);
    expect(run.title).toBe(`quality-review ${runId}`);
    expect(run.body).toContain('Headless environment (qa @ 2026-07-18)');
    expect(run.tags).toContain('gate:waived');
    expect(run.ext.gateSummary).toEqual({ total: 1, waived: 1, failed: 0, blocked: 0 });

    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(tmpRoot, 'search-cache.json'), 'utf-8')).version; }
      catch { return null; }
    }, { timeout: 5_000 }).toBe(6);
  }, 10_000);

  it('projects terminal session/3.0 and sealed run/3.0 history with promotion backlinks', async () => {
    const sessionId = '20260816-v3-wiki';
    const runId = 'run-v3-wiki';
    await write('specs/v3-index-rule.md', [
      '# V3 index rule',
      '',
      '<spec-entry category="arch" sid="S-v3-index-rule" title="V3 index rule">',
      'Index terminal v3 Session and Run history.',
      '</spec-entry>',
    ].join('\n'));
    await write(`sessions/${sessionId}/session.json`, JSON.stringify({
      schema_version: 'session/3.0', session_id: sessionId,
      objective: 'Index terminal v3 knowledge history', definition_of_done: 'Wiki projection is searchable',
      status: 'completed', orchestration_revision: 3, activity_revision: 3,
      chain: [], decisions: [], active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
      created_at: '2026-08-16T01:00:00.000Z', updated_at: '2026-08-16T02:00:00.000Z',
      completed_at: '2026-08-16T02:00:00.000Z', archived_at: null,
    }));
    await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 1,
      artifacts: {
        'ART-V3': {
          artifact_id: 'ART-V3', kind: 'verification', media_type: 'application/json', role: 'primary',
          status: 'sealed', producer_run_id: runId, relative_path: `runs/${runId}/outputs/verification.json`,
        },
      },
      aliases: { 'latest-verification': 'ART-V3' },
    }));
    await write(`sessions/${sessionId}/runs/${runId}/run.json`, JSON.stringify({
      schema_version: 'run/3.0', run_id: runId, session_id: sessionId, step_id: 'step-v3',
      parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'verify', args: [], goal: null,
      status: 'sealed', revision: 2, actor_id: 'tester', input_refs: [], output_refs: ['ART-V3'],
      primary_artifact_id: 'ART-V3', verdict: 'done_with_concerns', summary: 'Verified v3 index projection',
      created_at: '2026-08-16T01:00:00.000Z', started_at: '2026-08-16T01:10:00.000Z',
      ended_at: '2026-08-16T01:50:00.000Z', sealed_at: '2026-08-16T01:51:00.000Z',
    }));
    await write(`sessions/${sessionId}/runs/${runId}/report.md`, [
      '---',
      'verdict: done_with_concerns',
      'summary: Verified v3 index projection',
      'constraints:',
      '  - text: Preserve v3 authority',
      '    status: locked',
      'decisions:',
      '  - text: Project v3 history through Wiki',
      '    status: accepted',
      'concerns: []',
      'next: []',
      '---',
      '## Verification',
      'The v3 projection body remains loadable.',
    ].join('\n'));
    await write(`sessions/${sessionId}/runs/${runId}/outputs/verification.json`, JSON.stringify({
      summary: 'Verified v3 index projection', verdict: 'PASS',
    }));
    await write(`sessions/${sessionId}/runs/${runId}/knowledge-delta.json`, JSON.stringify({
      schema_version: 'run-knowledge-delta/1.0', session_id: sessionId, run_id: runId,
      revision: 1, updated_at: '2026-08-16T01:59:00.000Z', inputs: [],
      candidates: [{ status: 'pending', target: 'spec', promoted_id: null }],
    }));

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const beforePromotion = await indexer.get();
    const promotedSpecBefore = beforePromotion.entries.find(entry => entry.ext?.sid === 'S-v3-index-rule');
    expect(promotedSpecBefore).toBeDefined();
    expect(beforePromotion.byId[`session-${sessionId}`].related).not.toContain(promotedSpecBefore!.id);

    await new Promise(resolve => setTimeout(resolve, 25));
    await write(`sessions/${sessionId}/runs/${runId}/knowledge-delta.json`, JSON.stringify({
      schema_version: 'run-knowledge-delta/1.0', session_id: sessionId, run_id: runId,
      revision: 2, updated_at: '2026-08-16T02:00:00.000Z', inputs: [],
      candidates: [{ status: 'promoted', target: 'spec', promoted_id: 'S-v3-index-rule' }],
    }));

    const index = await indexer.get();
    const session = index.byId[`session-${sessionId}`];
    const run = index.byId[`session-run-${sessionId}-${runId}`];
    expect(session).toMatchObject({
      title: 'Index terminal v3 knowledge history', status: 'completed',
      ext: expect.objectContaining({ runCount: 1, lifecycleStatus: 'completed' }),
    });
    expect(run).toMatchObject({
      title: `verify ${runId}`, status: 'completed',
      ext: expect.objectContaining({ artifactIds: ['ART-V3'] }),
    });
    expect(run.summary).toContain('Verified v3 index projection');
    expect(run.tags).toContain('constraint');
    expect(run.body).toContain('Project v3 history through Wiki');
    expect(run.body).toContain('The v3 projection body remains loadable.');
    const promotedSpec = index.entries.find(entry => entry.ext?.sid === 'S-v3-index-rule');
    expect(promotedSpec).toBeDefined();
    expect(session.related).toContain(promotedSpec!.id);
    expect(promotedSpec!.related).toContain(`session-${sessionId}`);
  });

  it('selects the latest sealed v3 Run by terminal timestamp instead of directory order', async () => {
    const sessionId = 'v3-latest-run-order';
    await write(`sessions/${sessionId}/session.json`, JSON.stringify({
      schema_version: 'session/3.0', session_id: sessionId,
      objective: 'Select latest Run by terminal timestamp', definition_of_done: 'newest terminal Run wins',
      status: 'completed', orchestration_revision: 2, activity_revision: 2,
      chain: [], decisions: [], active_run_ids: [], artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
      created_at: '2026-08-16T00:00:00.000Z', updated_at: '2026-08-16T03:00:00.000Z',
      completed_at: '2026-08-16T03:00:00.000Z', archived_at: null,
    }));
    await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
    }));
    const writeRun = async (runId: string, summary: string, endedAt: string) => {
      await write(`sessions/${sessionId}/runs/${runId}/run.json`, JSON.stringify({
        schema_version: 'run/3.0', run_id: runId, session_id: sessionId, step_id: 'step-v3',
        parent_run_id: null, retry_of_run_id: null, attempt: 1, command: 'verify', args: [], goal: null,
        status: 'sealed', revision: 1, actor_id: 'tester', input_refs: [], output_refs: [],
        primary_artifact_id: null, verdict: 'done', summary,
        created_at: '2026-08-16T00:00:00.000Z', started_at: '2026-08-16T00:10:00.000Z',
        ended_at: endedAt, sealed_at: endedAt,
      }));
      await write(`sessions/${sessionId}/runs/${runId}/report.md`, `# ${summary}\n\n${summary}\n`);
    };
    await writeRun('z-old-by-name', 'Older terminal Run', '2026-08-16T01:00:00.000Z');
    await writeRun('a-new-by-time', 'Newest terminal Run', '2026-08-16T02:00:00.000Z');

    const index = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
    expect(index.byId[`session-${sessionId}`]).toMatchObject({
      summary: 'Newest terminal Run',
      body: expect.stringContaining('Newest terminal Run'),
    });
  });

  it('maps terminal v3 Session states and excludes open Sessions and unsealed Runs', async () => {
    for (const [status, expected] of [
      ['completed', 'completed'], ['archived', 'archived'], ['failed', 'blocked'],
    ] as const) {
      const sessionId = `v3-${status}`;
      await write(`sessions/${sessionId}/session.json`, JSON.stringify({
        schema_version: 'session/3.0', session_id: sessionId, objective: `${status} v3 Session`,
        status, created_at: '2026-08-16T00:00:00.000Z', updated_at: '2026-08-16T01:00:00.000Z',
        completed_at: status === 'completed' ? '2026-08-16T01:00:00.000Z' : null,
        archived_at: status === 'archived' ? '2026-08-16T01:00:00.000Z' : null,
      }));
      await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
        schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
      }));
      const index = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
      expect(index.byId[`session-${sessionId}`]?.status).toBe(expected);
    }
    await write('sessions/v3-open/session.json', JSON.stringify({
      schema_version: 'session/3.0', session_id: 'v3-open', objective: 'open v3 Session', status: 'open',
    }));
    await write('sessions/v3-open/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
    }));
    await write('sessions/v3-completed/runs/unsealed/run.json', JSON.stringify({
      schema_version: 'run/3.0', run_id: 'unsealed', session_id: 'v3-completed',
      command: 'analyze', status: 'completed',
    }));
    const index = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
    expect(index.byId['session-v3-open']).toBeUndefined();
    expect(index.entries.some(entry => entry.sourceRef === 'unsealed')).toBe(false);
  });

  it('indexes session and command-run schemas 1.0 through 1.3', async () => {
    const fixture = createRuntimeSessionFixture(join(tmpRoot, 'runtime-source'));
    const sessionVersions = ['session/1.0', 'session/1.1', 'session/1.2', 'session/1.3'] as const;
    const runVersions = ['command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3'] as const;
    const expectedSessionIds: string[] = [];
    const expectedRunIds: string[] = [];

    for (let index = 0; index < sessionVersions.length; index++) {
      const suffix = String(index).padStart(2, '0');
      const sessionId = `20260719-schema-${suffix}`;
      const runId = `20260719-${String(index + 1).padStart(3, '0')}-wiki-runtime-fixture`;
      const session = structuredClone(fixture.session);
      session.schema_version = sessionVersions[index];
      session.session_id = sessionId;
      session.latest_completed_run_id = runId;
      if (sessionVersions[index] !== 'session/1.3') delete session.topic_identity;
      if (sessionVersions[index] === 'session/1.0' || sessionVersions[index] === 'session/1.1') {
        delete session.intent_identity;
        delete session.provenance;
        delete session.ralph_authority;
      }

      const run = structuredClone(fixture.run);
      run.schema_version = runVersions[index];
      run.session_id = sessionId;
      run.run_id = runId;
      run.gate_ids = [];
      run.output = { produces: [], primary_artifact_id: null, verdict: 'ready' };
      const handoff = run.handoff as Record<string, unknown> | null;
      if (handoff) handoff.producer_run_id = runId;
      const input = run.input as Record<string, unknown>;
      if (runVersions[index] !== 'command-run/1.3') delete input.reuse_assessments;
      if (runVersions[index] === 'command-run/1.0' || runVersions[index] === 'command-run/1.1') {
        delete run.contract_snapshot;
        delete run.guidance_snapshot;
        delete run.creation_decision;
        delete run.creation_provenance;
        delete run.transition;
      }
      if (runVersions[index] === 'command-run/1.0') {
        delete run.chain_step_id;
        delete run.resolved_platform;
        delete run.goal_binding;
        delete run.checkpoint_expectation;
        delete run.checkpoint;
        delete run.retry_fence;
      }

      await write(`sessions/${sessionId}/session.json`, JSON.stringify(session));
      await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
        schema_version: 'artifacts/1.1', artifacts: {}, aliases: {},
      }));
      await write(`sessions/${sessionId}/gates.json`, JSON.stringify({
        schema_version: 'gates/1.0', revision: 0, gates: {},
        summary: { total: 0, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null },
      }));
      await write(`sessions/${sessionId}/runs/${runId}/run.json`, JSON.stringify(run));
      expectedSessionIds.push(`session-${sessionId}`);
      expectedRunIds.push(`session-run-${sessionId}-${runId}`);
    }

    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    for (const id of expectedSessionIds) expect(index.byId[id], id).toBeDefined();
    for (const id of expectedRunIds) expect(index.byId[id], id).toBeDefined();
    expect(index.entries.filter(entry => entry.ext.virtualKind === 'session-run')).toHaveLength(4);
  });

  it('projects a SessionStore runtime 1.3 fixture with summary, kind, and provenance', async () => {
    const fixture = createRuntimeSessionFixture(join(tmpRoot, 'runtime-project'));
    const index = await new WikiIndexer({
      workflowRoot: fixture.workflowRoot,
      persistence: 'memory-only',
    }).get();
    const session = index.byId[`session-${fixture.sessionId}`];
    const run = index.byId[`session-run-${fixture.sessionId}-${fixture.runId}`];

    expect(fixture.session.schema_version).toBe('session/1.3');
    expect(fixture.run.schema_version).toBe('command-run/1.3');
    expect(session.ext.runCount).toBe(1);
    expect(run.summary).toContain(fixture.summary);
    expect(run.tags).toContain(fixture.kind);
    expect(run.sourceRef).toBe(fixture.runId);
    expect(run.related).toContain(`session-${fixture.sessionId}`);
  }, 20_000);

  it('invalidates v2 search cache and persists v6', async () => {
    await write('specs/cache-v3.md', '---\ntitle: Cache v3\n---\n# Cache v3\nProjection cache sentinel.');
    await write('search-cache.json', JSON.stringify({
      version: 2, generatedAt: 1, mtimeSnapshot: [], entries: [],
    }));

    const index = await withoutCliSessions(new WikiIndexer({ workflowRoot: tmpRoot })).get();
    expect(index.byId['spec:project:cache-v3']).toBeDefined();
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(tmpRoot, 'search-cache.json'), 'utf-8')).version; }
      catch { return null; }
    }, { timeout: 5_000 }).toBe(6);
  }, 10_000);

  it('indexes v1.1 sealed Runs with structured handoff, kinds, provenance, aref edges, and waivers', async () => {
    await writeRunModeFixture();
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();

    const session = index.byId[SESSION_ENTRY_ID];
    const debugRun = index.byId[runEntryId(DEBUG_RUN_ID)];
    const analyzeRun = index.byId[runEntryId(ANALYZE_RUN_ID)];
    const reviewRun = index.byId[runEntryId(REVIEW_RUN_ID)];
    const promotedSpec = index.byId['spec:project:run-indexing-rule'];
    expect(session).toBeDefined();
    expect(debugRun).toBeDefined();
    expect(analyzeRun).toBeDefined();
    expect(reviewRun).toBeDefined();
    expect(index.byId[runEntryId(DRAFT_RUN_ID)]).toBeUndefined();

    expect(session.summary).toBe('Latest review artifact summary');
    expect(session.related).toEqual(expect.arrayContaining([
      runEntryId(DEBUG_RUN_ID), runEntryId(ANALYZE_RUN_ID), runEntryId(REVIEW_RUN_ID),
      'spec:project:run-indexing-rule',
    ]));
    expect(promotedSpec.related).toContain(SESSION_ENTRY_ID);

    expect(debugRun.summary).toContain('Typed diagnosis is the preferred summary');
    expect(debugRun.summary).toContain('Adopt zephyrdecisionneedle for exact discovery');
    expect(debugRun.summary).not.toContain('rejecteddecisionneedle');
    expect(debugRun.body).toContain('## 决策');
    expect(debugRun.body).toContain('Adopt zephyrdecisionneedle for exact discovery');
    expect(debugRun.body).not.toContain('Discard rejecteddecisionneedle entirely');
    expect(debugRun.body).toContain('## 约束');
    expect(debugRun.body).toContain('Preserve locked search semantics');
    expect(debugRun.body).not.toContain('Explore optional telemetry');
    expect(debugRun.body).toContain('## 关注点');
    expect(debugRun.body).toContain('Embedding fallback remains observable');
    expect(debugRun.body).toContain('Nested diagnosis evidence');
    expect(debugRun.body).not.toContain('MUST NOT INDEX DRAFT ARTIFACT');
    expect(debugRun.tags).toEqual(expect.arrayContaining(['quality-debug', 'verdict:ready', 'constraint', 'diagnosis']));
    expect(debugRun.category).toBe('debug');
    expect(debugRun.ext.kinds).toEqual(['diagnosis', 'notes']);
    expect(debugRun.ext.artifactIds).toEqual(['ART-diagnosis', 'ART-debug-notes']);

    expect(analyzeRun.category).toBe('arch');
    expect(analyzeRun.ext.kinds).toEqual(['findings']);
    expect(reviewRun.category).toBe('review');
    expect(reviewRun.tags).toEqual(expect.arrayContaining(['verdict:ready_with_concerns', 'review-findings']));
    expect(reviewRun.ext.kinds).toEqual(['review-findings']);
    expect(reviewRun.ext.arefArtifactIds).toEqual(['ART-diagnosis', 'ART-analysis']);
    expect(reviewRun.related).toEqual(expect.arrayContaining([runEntryId(DEBUG_RUN_ID), runEntryId(ANALYZE_RUN_ID)]));
    expect(index.backlinks[runEntryId(DEBUG_RUN_ID)]).toContain(runEntryId(REVIEW_RUN_ID));
    expect(index.backlinks[runEntryId(ANALYZE_RUN_ID)]).toContain(runEntryId(REVIEW_RUN_ID));
    expect(reviewRun.body).toContain('## 豁免');
    expect(reviewRun.body).toContain('Legacy browser proof');
    expect(reviewRun.body).toContain('CI has no browser');
    expect(reviewRun.body).not.toContain('Unit tests');
    expect(reviewRun.source.path).toBe('sessions/20260713-search/runs/20260713-010-review/run.json');
  });

  it('finds a Run by an accepted decision-only term', async () => {
    await writeRunModeFixture();
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const result = await indexer.searchWithMeta('zephyrdecisionneedle', 10, { skipEmbedding: true });
    expect(result.results.map(item => item.entry.id)).toContain(runEntryId(DEBUG_RUN_ID));
    expect(result.results[0]?.entry.id).toBe(runEntryId(DEBUG_RUN_ID));
  });

  it('maps every supported Run command to its search category', async () => {
    const cases = await writeCategoryFixture();
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    for (const [command, category] of cases) {
      const entry = index.entries.find(item => item.ext.virtualKind === 'session-run' && item.ext.command === command);
      expect(entry?.category, command).toBe(category);
    }
  });

  it('skips an unsealed session even when a child run claims sealed', async () => {
    await writeRunModeFixture('running');
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.entries.filter(e => e.source.path.startsWith('sessions/'))).toEqual([]);
  });

  it('skips a sealed session with an unsupported artifact registry instead of indexing empty Run shells', async () => {
    await writeRunModeFixture();
    await write('sessions/20260713-search/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/2.0', artifacts: {}, aliases: {},
    }));

    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.entries.filter(e => e.source.path.startsWith('sessions/'))).toEqual([]);
  });

  it('rejects unknown Session and Run schema versions', async () => {
    for (const schemaVersion of ['session/1.4', 'session/9.9']) {
      await write(`sessions/${schemaVersion.replace('/', '-')}/session.json`, JSON.stringify({
        schema_version: schemaVersion,
        session_id: schemaVersion,
        intent: 'Unsupported Session schema',
        status: 'sealed',
      }));
    }
    const sessionId = '20260719-unknown-runs';
    await write(`sessions/${sessionId}/session.json`, JSON.stringify({
      schema_version: 'session/1.3', session_id: sessionId, intent: 'Reject unknown Run schemas', status: 'sealed',
      lifecycle: { sealed_at: '2026-07-19T10:00:00.000Z', seal_summary: 'Unknown Runs stay hidden', promoted: [] },
    }));
    await write(`sessions/${sessionId}/artifacts.json`, JSON.stringify({
      schema_version: 'artifacts/1.1', artifacts: {}, aliases: {},
    }));
    for (const schemaVersion of ['command-run/1.4', 'command-run/9.9']) {
      const runId = schemaVersion.replace('/', '-');
      await write(`sessions/${sessionId}/runs/${runId}/run.json`, JSON.stringify({
        schema_version: schemaVersion, run_id: runId, command: { name: 'review' }, status: 'sealed',
      }));
    }

    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.byId[`session-${sessionId}`]?.ext.runCount).toBe(0);
    expect(index.entries.filter(entry => entry.source.path.includes('session-1.4'))).toEqual([]);
    expect(index.entries.filter(entry => entry.source.path.includes('session-9.9'))).toEqual([]);
    expect(index.entries.some(entry => entry.sourceRef === 'command-run-1.4')).toBe(false);
    expect(index.entries.some(entry => entry.sourceRef === 'command-run-9.9')).toBe(false);
  });

  it('exposes linked Session history only through explicit session sharing and fences fork/resume', async () => {
    const linkedRoot = await mkdtemp(join(tmpdir(), 'wiki-linked-session-'));
    try {
      const linkedSessionId = '20260718-linked';
      const linkedRunId = '20260718-001-review';
      const linkedWrite = async (rel: string, body: string): Promise<void> => {
        const abs = join(linkedRoot, rel);
        await mkdir(join(abs, '..'), { recursive: true });
        await writeFile(abs, body, 'utf-8');
      };
      await linkedWrite(`sessions/${linkedSessionId}/session.json`, JSON.stringify({
        schema_version: 'session/1.1', session_id: linkedSessionId, intent: 'Linked session', status: 'sealed',
        lifecycle: { sealed_at: '2026-07-18T10:00:00.000Z', seal_summary: 'Linked summary', promoted: [] },
      }));
      await linkedWrite(`sessions/${linkedSessionId}/artifacts.json`, JSON.stringify({
        schema_version: 'artifacts/1.1', artifacts: {}, aliases: {},
      }));
      await linkedWrite(`sessions/${linkedSessionId}/runs/${linkedRunId}/run.json`, JSON.stringify({
        schema_version: 'run/1.1', run_id: linkedRunId, command: 'review', status: 'sealed',
        gates: [], handoff: { summary: 'Linked run' }, started_at: '2026-07-18T09:00:00.000Z',
        ended_at: '2026-07-18T10:00:00.000Z',
      }));

      const hidden = await new WikiIndexer({
        workflowRoot: tmpRoot,
        linkedWorkspaces: [{ name: 'peer', workflowRoot: linkedRoot, shareTypes: ['knowhow'] }],
      }).get();
      expect(hidden.entries.some(entry => entry.source.workspace === 'peer' && entry.ext.virtualKind === 'session')).toBe(false);

      const shared = await new WikiIndexer({
        workflowRoot: tmpRoot,
        linkedWorkspaces: [{ name: 'peer', workflowRoot: linkedRoot, shareTypes: ['session'] }],
      }).get();
      const linkedSession = shared.entries.find(entry => entry.ext.virtualKind === 'session');
      expect(linkedSession?.source.workspace).toBe('peer');
      expect(linkedSession?.scope).toBe('linked');
      expect(linkedSession?.ext).toMatchObject({
        workspaceFence: 'linked:peer', sharedVia: 'explicit-session-share',
        forkAuthorized: false, resumeAuthorized: false,
      });
    } finally {
      await rm(linkedRoot, { recursive: true, force: true });
    }
  });

  it('does not follow local or linked knowhow directory symlinks', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'wiki-outside-'));
    const linkedRoot = await mkdtemp(join(tmpdir(), 'wiki-linked-'));
    try {
      await writeFile(join(outsideRoot, 'secret.md'), '---\ntitle: Outside secret\n---\nsymlink-secret-sentinel', 'utf-8');
      await mkdir(join(tmpRoot, 'knowhow'), { recursive: true });
      await mkdir(join(linkedRoot, 'knowhow'), { recursive: true });
      try {
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        await symlink(outsideRoot, join(tmpRoot, 'knowhow', 'outside'), linkType);
        await symlink(outsideRoot, join(linkedRoot, 'knowhow', 'outside'), linkType);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const index = await new WikiIndexer({
        workflowRoot: tmpRoot,
        linkedWorkspaces: [{ name: 'peer', workflowRoot: linkedRoot, shareTypes: ['knowhow'] }],
      }).get();

      expect(index.entries.some(entry => entry.body.includes('symlink-secret-sentinel'))).toBe(false);
      expect(index.entries.some(entry => entry.source.workspace === 'peer' && entry.title === 'Outside secret')).toBe(false);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
      await rm(linkedRoot, { recursive: true, force: true });
    }
  });

  it('realpath-fences non-knowhow source families from out-of-root symlink reads', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'wiki-outside-families-'));
    try {
      await writeFile(join(outsideRoot, 'project.md'), '---\ntitle: Outside project sentinel\n---\n# Outside project sentinel');
      await writeFile(join(outsideRoot, 'issues.jsonl'), JSON.stringify({
        id: 'outside', title: 'Outside issue sentinel', description: 'must not index',
      }));
      await writeFile(join(outsideRoot, 'glossary.json'), JSON.stringify({
        terms: [{ id: 'outside', canonical: 'Outside domain sentinel', definition: 'must not index' }],
      }));
      await writeFile(join(outsideRoot, 'doc-index.json'), JSON.stringify({
        components: [{ id: 'outside', name: 'Outside codebase sentinel' }],
      }));
      await mkdir(join(tmpRoot, 'issues'), { recursive: true });
      await mkdir(join(tmpRoot, 'domain'), { recursive: true });
      await mkdir(join(tmpRoot, 'codebase'), { recursive: true });
      try {
        await symlink(join(outsideRoot, 'project.md'), join(tmpRoot, 'project.md'), 'file');
        await symlink(join(outsideRoot, 'issues.jsonl'), join(tmpRoot, 'issues', 'outside.jsonl'), 'file');
        await symlink(join(outsideRoot, 'glossary.json'), join(tmpRoot, 'domain', 'glossary.json'), 'file');
        await symlink(join(outsideRoot, 'doc-index.json'), join(tmpRoot, 'codebase', 'doc-index.json'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const index = await new WikiIndexer({ workflowRoot: tmpRoot, persistence: 'memory-only' }).get();
      expect(index.entries.some(entry => entry.title.includes('Outside'))).toBe(false);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('preserves archived lifecycle status', async () => {
    await writeRunModeFixture('archived');
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.byId['session-20260713-search'].status).toBe('archived');
  });

  it('invalidates the cached index when a nested session artifact changes in place', async () => {
    await writeRunModeFixture();
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const first = await indexer.get();
    expect(first.byId[runEntryId(DEBUG_RUN_ID)].summary).toContain('preferred');

    await new Promise(resolve => setTimeout(resolve, 20));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/diagnosis.json', JSON.stringify({
      summary: 'Updated nested diagnosis summary',
    }));
    const refreshed = await indexer.get();
    expect(refreshed.byId[runEntryId(DEBUG_RUN_ID)].summary).toContain('Updated nested diagnosis summary');
  });
});
