import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInvertedIndex } from './search.js';
import {
  CLI_SESSION_RECONCILIATION_INTERVAL_MS,
  WikiIndexer,
  cliSessionStoreFingerprint,
} from './wiki-indexer.js';
import {
  buildSourceManifest,
  diffSourceManifests,
  sourceManifestFingerprint,
  type SourceManifest,
  type SourceManifestEntry,
} from './source-manifest.js';
import {
  applyIncrementalIndex,
  buildDeterministicWikiIndex,
  type IncrementalIndexState,
} from './incremental-index.js';
import type { WikiEntry } from './wiki-types.js';

let root: string;
const previousIncrementalEnv = process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;

async function put(path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function waitForPublication(workflowRoot: string, generation: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const [index, cache, manifest] = await Promise.all([
        readFile(join(workflowRoot, 'wiki-index.json'), 'utf8').then(raw => JSON.parse(raw) as { generatedAt?: number }),
        readFile(join(workflowRoot, 'search-cache.json'), 'utf8').then(raw => JSON.parse(raw) as { generatedAt?: number }),
        readFile(join(workflowRoot, 'wiki-source-manifest.json'), 'utf8').then(raw => JSON.parse(raw) as { generation?: number }),
      ]);
      if (index.generatedAt === generation && cache.generatedAt === generation && manifest.generation === generation) return;
    } catch {
      // Publication is intentionally atomic and may be between temp files.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  throw new Error(`timed out waiting for generation ${generation} publication`);
}

function entryFor(path: string, title: string, body = title): WikiEntry {
  const stem = path.split('/').pop()!.replace(/\.md$/i, '');
  return {
    id: `spec:project:${stem}`,
    type: 'spec',
    title,
    summary: body,
    tags: [],
    status: 'active',
    created: '2020-01-01T00:00:00.000Z',
    updated: '2020-01-01T00:00:00.000Z',
    related: [],
    source: { kind: 'file', path },
    body,
    ext: {},
    scope: 'project',
    category: null,
    specCategory: null,
    createdBy: null,
    sourceRef: null,
    parent: null,
  };
}

function manifestFor(entries: SourceManifestEntry[], generation = 0): SourceManifest {
  return {
    version: 1,
    root: resolve(root),
    generation,
    entries,
    sourceFingerprint: sourceManifestFingerprint({ entries }),
  };
}

function sourceEntry(path: string, contentHash: string, mtimeMs: number, entryIds: string[] = []): SourceManifestEntry {
  return {
    path,
    sourceKind: 'spec',
    size: contentHash.length,
    mtimeMs,
    contentHash,
    entryIds,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-freshness-incremental-'));
  delete process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;
});

afterEach(async () => {
  vi.useRealTimers();
  if (previousIncrementalEnv === undefined) delete process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;
  else process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = previousIncrementalEnv;
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('Todo #8 transcript freshness and reconciliation', () => {
  it('changes the bounded head/tail fingerprint when a transcript is appended with mtime preserved', async () => {
    const claudeProject = join(root, 'claude-project');
    const codexRoot = join(root, 'codex');
    await mkdir(claudeProject, { recursive: true });
    const transcript = join(claudeProject, 'session.jsonl');
    const initial = `${JSON.stringify({ type: 'session_meta', payload: { cwd: root } })}\n${'x'.repeat(500)}\n`;
    await writeFile(transcript, initial, 'utf8');

    const fixedMtime = new Date(Date.now() - 1_000);
    await utimes(transcript, fixedMtime, fixedMtime);
    const beforeStat = await stat(transcript);
    const before = await cliSessionStoreFingerprint(claudeProject, codexRoot, root);

    await appendFile(transcript, `${'tail-event '.repeat(100)}\n`, 'utf8');
    await utimes(transcript, fixedMtime, fixedMtime);
    const afterStat = await stat(transcript);
    const after = await cliSessionStoreFingerprint(claudeProject, codexRoot, root);

    expect(afterStat.mtimeMs).toBeCloseTo(beforeStat.mtimeMs, 0);
    expect(afterStat.size).toBeGreaterThan(beforeStat.size);
    expect(after).not.toBe(before);
  });

  it('changes the transcript fingerprint when discovered membership is added or deleted', async () => {
    const claudeProject = join(root, 'claude-project');
    const codexRoot = join(root, 'codex');
    await mkdir(claudeProject, { recursive: true });
    const before = await cliSessionStoreFingerprint(claudeProject, codexRoot, root);
    const transcript = join(claudeProject, 'new-session.jsonl');
    await writeFile(transcript, `${JSON.stringify({ type: 'session_meta', payload: { cwd: root } })}\n${'x'.repeat(500)}`, 'utf8');
    const afterAdd = await cliSessionStoreFingerprint(claudeProject, codexRoot, root);
    await rm(transcript);
    const afterDelete = await cliSessionStoreFingerprint(claudeProject, codexRoot, root);
    expect(afterAdd).not.toBe(before);
    expect(afterDelete).not.toBe(afterAdd);
    expect(afterDelete).not.toBe(before);
  });

  it('detects covered discovered-file membership add and delete without a full rebuild', async () => {
    await put('specs/initial.md', '---\ntitle: Initial\n---\nInitial body');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const indexer = new WikiIndexer({ workflowRoot: root, role: 'hermetic', includeCliSessions: false });
    let fullBuilds = 0;
    const internal = indexer as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const build = internal.buildIndexCandidate.bind(indexer);
    internal.buildIndexCandidate = async () => { fullBuilds++; return build(); };

    try {
      await indexer.get();
      await put('specs/added.md', '---\ntitle: Added\n---\nAdded body');
      expect((await indexer.get()).byId['spec:project:added']).toBeDefined();
      await rm(join(root, 'specs/initial.md'));
      const afterDelete = await indexer.get();
      expect(afterDelete.byId['spec:project:initial']).toBeUndefined();
      expect(fullBuilds).toBe(1);
    } finally {
      await indexer.close();
    }
  });

  it('uses an unref reconciliation timer no slower than five minutes and closes it', async () => {
    expect(CLI_SESSION_RECONCILIATION_INTERVAL_MS).toBeGreaterThan(0);
    expect(CLI_SESSION_RECONCILIATION_INTERVAL_MS).toBeLessThanOrEqual(5 * 60_000);

    const indexer = new WikiIndexer({ workflowRoot: root, role: 'publisher', includeCliSessions: true });
    const internal = indexer as unknown as {
      reconciliationTimer: (NodeJS.Timeout & { hasRef?: () => boolean }) | null;
    };
    try {
      expect(internal.reconciliationTimer).not.toBeNull();
      expect(internal.reconciliationTimer?.hasRef?.()).toBe(false);
    } finally {
      await indexer.close();
    }
    expect(internal.reconciliationTimer).toBeNull();
  });
});

describe('Todo #8 incremental publisher integration', () => {
  it('publishes add/modify/delete/rename incrementally, survives restart, and has no deleted leakage', async () => {
    await put('specs/one.md', '---\ntitle: One\n---\nOne body');
    await put('specs/two.md', '---\ntitle: Two\n---\nTwo body');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const publisher = new WikiIndexer({ workflowRoot: root, role: 'publisher', includeCliSessions: false });
    let fullBuilds = 0;
    const internal = publisher as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const build = internal.buildIndexCandidate.bind(publisher);
    internal.buildIndexCandidate = async () => { fullBuilds++; return build(); };

    let current = await publisher.get();
    expect(current.byId['spec:project:one']).toBeDefined();
    await waitForPublication(root, current.generatedAt);
    await put('specs/one.md', '---\ntitle: One changed\n---\nChanged body');
    current = await publisher.get();
    expect(current.byId['spec:project:one']?.title).toBe('One changed');
    await waitForPublication(root, current.generatedAt);

    await put('specs/three.md', '---\ntitle: Three\n---\nThree body');
    current = await publisher.get();
    expect(current.byId['spec:project:three']).toBeDefined();
    await waitForPublication(root, current.generatedAt);

    await rm(join(root, 'specs/two.md'));
    current = await publisher.get();
    expect(current.byId['spec:project:two']).toBeUndefined();
    await waitForPublication(root, current.generatedAt);

    await rename(join(root, 'specs/three.md'), join(root, 'specs/renamed.md'));
    current = await publisher.get();
    expect(current.byId['spec:project:three']).toBeUndefined();
    expect(current.byId['spec:project:renamed']).toBeDefined();
    expect(fullBuilds).toBe(1);

    await waitForPublication(root, current.generatedAt);
    await publisher.close();

    const restarted = new WikiIndexer({ workflowRoot: root, role: 'publisher', includeCliSessions: false });
    const reloaded = await restarted.get();
    expect(reloaded.byId['spec:project:two']).toBeUndefined();
    expect(reloaded.byId['spec:project:three']).toBeUndefined();
    expect(reloaded.byId['spec:project:renamed']).toBeDefined();

    delete process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;
    const fullIndexer = new WikiIndexer({ workflowRoot: root, role: 'publisher', includeCliSessions: false });
    const full = await fullIndexer.get();
    const shape = (index: typeof full) => index.entries.map(entry => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      summary: entry.summary,
      body: entry.body,
      source: entry.source,
      related: entry.related,
      ext: entry.ext,
    }));
    expect(shape(reloaded)).toEqual(shape(full));
    expect(reloaded.backlinks).toEqual(full.backlinks);
    await restarted.close();
    await fullIndexer.close();
  });

  it('fences a stale incremental candidate after invalidation', async () => {
    await put('specs/fenced.md', '---\ntitle: Before\n---\nBefore body');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const indexer = new WikiIndexer({ workflowRoot: root, role: 'hermetic', includeCliSessions: false });
    let fullBuilds = 0;
    const internal = indexer as unknown as {
      buildIndexCandidate: () => Promise<unknown>;
      scanIncrementalSource: (...args: unknown[]) => Promise<readonly WikiEntry[]>;
    };
    const build = internal.buildIndexCandidate.bind(indexer);
    internal.buildIndexCandidate = async () => { fullBuilds++; return build(); };
    await indexer.get();

    await put('specs/fenced.md', '---\ntitle: After\n---\nAfter body');
    const entered = new Promise<void>(resolveEntered => {
      const original = internal.scanIncrementalSource.bind(indexer);
      internal.scanIncrementalSource = async (...args: unknown[]) => {
        resolveEntered();
        await gate;
        return original(...args);
      };
    });
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolveGate => { releaseGate = resolveGate; });
    const pending = indexer.get();
    await entered;
    indexer.invalidate();
    releaseGate();

    const result = await pending;
    expect(result.byId['spec:project:fenced']?.title).toBe('After');
    expect(fullBuilds).toBe(2);
    await indexer.close();
  });
});

describe('Todo #8 pure manifest/diff/apply replay', () => {
  it('replays 1000 deterministic modifications with bounded pure-layer work', async () => {
    const initialHash = '0'.repeat(64);
    const initialSource = sourceEntry('specs/replay.md', initialHash, 1, ['spec:project:replay']);
    const initialManifest = manifestFor([initialSource]);
    const initialIndex = buildDeterministicWikiIndex([entryFor('specs/replay.md', 'Replay 0', 'body 0')], 1);
    const makeState = (): IncrementalIndexState => ({
      index: initialIndex,
      searchIndex: buildInvertedIndex(initialIndex.entries),
      manifest: initialManifest,
      generation: 1,
    });

    const replay = async (): Promise<{ title: string; body: string; sourceFingerprint: string; events: number; elapsedMs: number }> => {
      let state = makeState();
      const started = performance.now();
      for (let event = 1; event <= 1_000; event++) {
        const hash = event.toString(16).padStart(64, '0');
        const previous = state.manifest.entries[0];
        const current = sourceEntry('specs/replay.md', hash, event + 1, ['spec:project:replay']);
        const manifest = manifestFor([current]);
        const changes = diffSourceManifests(state.manifest, manifest);
        expect(changes).toHaveLength(1);
        expect(changes[0].kind).toBe('modify');
        const result = await applyIncrementalIndex({
          previous: state,
          currentManifest: manifest,
          changes,
          generation: event + 2,
          loadSource: async source => [entryFor(source.path, `Replay ${event}`, `body ${event}`)],
        });
        expect(result.status).toBe('updated');
        if (result.status !== 'updated') throw new Error('unreachable');
        state = result.state;
        expect(state.index.entries).toHaveLength(1);
        expect(state.index.byId['spec:project:replay']).toBeDefined();
        expect(previous.contentHash).not.toBe(current.contentHash);
      }
      const elapsedMs = performance.now() - started;
      const final = state.index.byId['spec:project:replay'];
      return {
        title: final.title,
        body: final.body,
        sourceFingerprint: state.manifest.sourceFingerprint,
        events: 1_000,
        elapsedMs,
      };
    };

    const first = await replay();
    const second = await replay();
    expect(first.events).toBe(1_000);
    expect(first.title).toBe('Replay 1000');
    expect(first.body).toBe('body 1000');
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(first.title).toBe(second.title);
    expect(first.body).toBe(second.body);
    // This is a pure in-memory replay (no scanner or transcript loading); keep
    // accidental quadratic regressions visible without making normal CI tight.
    expect(first.elapsedMs + second.elapsedMs).toBeLessThan(15_000);
  }, 30_000);

  it.each([
    ['session', 'sessions/new/session.json'],
    ['KG', 'codebase/knowledge-graph.json'],
    ['unknown', 'misc/new-source.txt'],
  ])('returns fallback for non-covered %s manifest changes', async (_label, path) => {
    const oldSource = sourceEntry('specs/stable.md', '1'.repeat(64), 1, ['spec:project:stable']);
    const previousManifest = manifestFor([oldSource]);
    const index = buildDeterministicWikiIndex([entryFor('specs/stable.md', 'Stable')], 1);
    const currentSource: SourceManifestEntry = {
      ...sourceEntry(path, '2'.repeat(64), 2),
      sourceKind: 'unsupported',
    };
    const currentManifest = manifestFor([oldSource, currentSource]);
    const previous: IncrementalIndexState = {
      index,
      searchIndex: buildInvertedIndex(index.entries),
      manifest: previousManifest,
      generation: 1,
    };
    const result = await applyIncrementalIndex({
      previous,
      currentManifest,
      changes: diffSourceManifests(previousManifest, currentManifest),
      loadSource: async () => [],
    });
    expect(result.status).toBe('fallback');
    expect(result.status === 'fallback' && result.reason).toBe('non-covered source changed');
  });

  it('forces full rebuilds when Session, KG, or linked workspace files change', async () => {
    await put('specs/stable.md', '---\ntitle: Stable\n---\nStable body');
    const linkedRoot = await mkdtemp(join(tmpdir(), 'wiki-linked-freshness-'));
    await mkdir(join(linkedRoot, 'specs'), { recursive: true });
    await writeFile(join(linkedRoot, 'specs/linked.md'), '---\ntitle: Linked\n---\nLinked body', 'utf8');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const indexer = new WikiIndexer({
      workflowRoot: root,
      role: 'hermetic',
      includeCliSessions: false,
      linkedWorkspaces: [{ name: 'other', workflowRoot: linkedRoot, shareTypes: ['spec'] }],
    });
    let fullBuilds = 0;
    const internal = indexer as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const build = internal.buildIndexCandidate.bind(indexer);
    internal.buildIndexCandidate = async () => { fullBuilds++; return build(); };
    try {
      await indexer.get();
      await put('sessions/new/session.json', JSON.stringify({ schema_version: 'session/1.3', session_id: 'new', status: 'open' }));
      await indexer.get();
      await put('codebase/knowledge-graph.json', JSON.stringify({ nodes: [], edges: [] }));
      await indexer.get();
      await writeFile(join(linkedRoot, 'specs/linked.md'), '---\ntitle: Linked changed\n---\nChanged', 'utf8');
      const changed = await indexer.get();
      expect(changed.byId['spec:project:stable']).toBeDefined();
      expect(changed.entries.some(entry => entry.title === 'Linked changed')).toBe(true);
      expect(fullBuilds).toBe(4);
    } finally {
      await indexer.close();
      await rm(linkedRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
