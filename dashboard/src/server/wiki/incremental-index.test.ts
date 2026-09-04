import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildInvertedIndex } from './search.js';
import { WikiIndexer } from './wiki-indexer.js';
import {
  buildSourceManifest,
  diffSourceManifests,
  type SourceManifest,
} from './source-manifest.js';
import {
  applyIncrementalIndex,
  buildDeterministicWikiIndex,
  type IncrementalIndexState,
} from './incremental-index.js';

let root: string;
const previousEnv = process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;

async function put(path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function restoreEnv(): void {
  if (previousEnv === undefined) delete process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;
  else process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = previousEnv;
}

afterEach(async () => {
  restoreEnv();
  await rm(root, { recursive: true, force: true });
});

describe('file-source incremental index', () => {
  it('reports deterministic add/modify/delete/rename deltas', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-incremental-manifest-'));
    await put('specs/one.md', '---\ntitle: One\n---\nOne');
    await put('knowhow/tip.md', '---\ntitle: Tip\n---\nTip');
    const before = await buildSourceManifest(root);

    await rename(join(root, 'specs/one.md'), join(root, 'specs/renamed.md'));
    await put('knowhow/tip.md', '---\ntitle: Changed tip\n---\nChanged');
    await put('specs/new.md', '---\ntitle: New\n---\nNew');
    const after = await buildSourceManifest(root);
    const changes = diffSourceManifests(before, after);

    expect(changes.map(change => change.kind)).toEqual(['modify', 'add', 'rename']);
    expect(changes.find(change => change.kind === 'rename')).toMatchObject({
      previousPath: 'specs/one.md',
      path: 'specs/renamed.md',
    });
  });

  it('keeps incremental results equivalent to a clean full rebuild', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-incremental-equivalence-'));
    await put('project.md', '---\ntitle: Project\n---\n[[One]]');
    await put('specs/one.md', '---\ntitle: One\n---\nOne body');
    await put('knowhow/tip.md', '---\ntitle: Tip\n---\nTip body');
    await put('domain/glossary.json', JSON.stringify({ terms: [{ id: 'one', canonical: 'One term', definition: 'Term body' }] }));
    await put('issues/issues.jsonl', JSON.stringify({ id: 'I-1', title: 'Issue one', description: 'Issue body', status: 'open' }) + '\n');
    await put('codebase/doc-index.json', JSON.stringify({ version: '1.0', project: 'test', components: [{ id: 'C-1', name: 'Component' }] }));

    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const incremental = new WikiIndexer({ workflowRoot: root, persistence: 'memory-only', includeCliSessions: false });
    let fullBuilds = 0;
    const internal = incremental as unknown as {
      buildIndexCandidate: () => Promise<unknown>;
    };
    const originalBuild = internal.buildIndexCandidate.bind(incremental);
    internal.buildIndexCandidate = async () => {
      fullBuilds++;
      return originalBuild();
    };
    await incremental.get();
    expect(fullBuilds).toBe(1);

    await rename(join(root, 'specs/one.md'), join(root, 'specs/renamed.md'));
    await put('knowhow/tip.md', '---\ntitle: Updated tip\n---\nUpdated body [[One term]]');
    await put('specs/added.md', '---\ntitle: Added\n---\nAdded body');
    await put('domain/glossary.json', JSON.stringify({ terms: [{ id: 'one', canonical: 'Updated term', definition: 'Updated body' }] }));
    await put('issues/issues.jsonl', JSON.stringify({ id: 'I-1', title: 'Updated issue', description: 'Updated body', status: 'open' }) + '\n');
    await put('codebase/doc-index.json', JSON.stringify({ version: '1.0', project: 'test', components: [{ id: 'C-1', name: 'Updated component' }] }));
    await rm(join(root, 'project.md'));
    const actual = await incremental.get();
    expect(fullBuilds).toBe(1);

    delete process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX;
    const full = await new WikiIndexer({ workflowRoot: root, persistence: 'memory-only', includeCliSessions: false }).get();
    const shape = (value: typeof actual) => value.entries.map(entry => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      status: entry.status,
      related: entry.related,
      source: entry.source,
      body: entry.body,
      ext: entry.ext,
      scope: entry.scope,
      category: entry.category,
      specCategory: entry.specCategory,
      createdBy: entry.createdBy,
      sourceRef: entry.sourceRef,
      parent: entry.parent,
    }));
    expect(shape(actual)).toEqual(shape(full));
    expect(actual.backlinks).toEqual(full.backlinks);
  });

  it('forces the existing full rebuild for non-covered session files', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-incremental-fallback-'));
    await put('specs/one.md', '---\ntitle: One\n---\nOne');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const indexer = new WikiIndexer({ workflowRoot: root, persistence: 'memory-only', includeCliSessions: false });
    let fullBuilds = 0;
    const internal = indexer as unknown as { buildIndexCandidate: () => Promise<unknown> };
    const originalBuild = internal.buildIndexCandidate.bind(indexer);
    internal.buildIndexCandidate = async () => { fullBuilds++; return originalBuild(); };
    await indexer.get();
    await put('sessions/new/session.json', JSON.stringify({ schema_version: 'session/1.3', session_id: 'new', status: 'open' }));
    await indexer.get();
    expect(fullBuilds).toBe(2);
  });

  it('persists and reloads a generation-fenced source manifest', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-incremental-persist-'));
    await put('specs/one.md', '---\ntitle: One\n---\nOne');
    process.env.MAESTRO_SEARCH_INCREMENTAL_INDEX = '1';
    const writer = new WikiIndexer({ workflowRoot: root, includeCliSessions: false });
    await writer.get();
    const manifestPath = join(root, 'wiki-source-manifest.json');
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(manifestPath, 'utf8')); }
      catch { return null; }
    }).toMatchObject({ version: 1, entries: [{ path: 'specs/one.md', sourceKind: 'spec', entryIds: ['spec:project:one'] }] });
    await writer.close();
    const reader = new WikiIndexer({ workflowRoot: root, includeCliSessions: false });
    const loaded = await reader.get();
    expect(loaded.byId['spec:project:one']).toBeDefined();
    await reader.close();
  });

  it('does not mutate or publish a previous generation when aborted', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-incremental-abort-'));
    await put('specs/one.md', '---\ntitle: One\n---\nOne');
    const manifest = await buildSourceManifest(root, { generation: 1 });
    const entry = {
      id: 'spec:project:one',
      type: 'spec' as const,
      title: 'One',
      summary: 'One',
      tags: [],
      status: 'active' as const,
      created: '2020-01-01T00:00:00.000Z',
      updated: '2020-01-01T00:00:00.000Z',
      related: [],
      source: { kind: 'file' as const, path: 'specs/one.md' },
      body: 'One',
      ext: {},
      scope: 'project' as const,
      category: null,
      specCategory: null,
      createdBy: null,
      sourceRef: null,
      parent: null,
    };
    const index = buildDeterministicWikiIndex([entry], 1);
    const previous: IncrementalIndexState = {
      index,
      searchIndex: buildInvertedIndex(index.entries),
      manifest,
      generation: 1,
    };
    await put('specs/one.md', '---\ntitle: Changed\n---\nChanged');
    const current = await buildSourceManifest(root);
    const controller = new AbortController();
    const promise = applyIncrementalIndex({
      previous,
      currentManifest: current,
      signal: controller.signal,
      loadSource: async () => {
        controller.abort(new Error('stop'));
        return [];
      },
    });
    await expect(promise).rejects.toThrow('stop');
    expect(previous.index).toBe(index);
    expect(previous.index.entries[0].title).toBe('One');
  });
});
