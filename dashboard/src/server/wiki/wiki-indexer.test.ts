import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WikiIndexer } from './wiki-indexer.js';
import { buildGraph, detectOrphans, detectHubs, computeHealth } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, tokenize } from './search.js';
import { WikiWriter, WikiWriteError } from './writer.js';

let tmpRoot: string;

async function write(rel: string, body: string): Promise<void> {
  const abs = join(tmpRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf-8');
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
      `---\ntitle: Spec One\ntags:\n  - auth\n---\n# Spec One\nAbout [[spec-two]]`,
    );
    await write(
      'specs/two.md',
      `---\ntitle: Spec Two\n---\n# Spec Two\nRefs [[spec-one]]`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const ids = index.entries.map((d) => d.id).sort();
    expect(ids).toContain('spec-one');
    expect(ids).toContain('spec-two');
    expect(index.byId['spec-one'].tags).toEqual(['auth']);
    expect(index.backlinks['spec-one']).toContain('spec-two');
    expect(index.backlinks['spec-two']).toContain('spec-one');
  });

  it('filters by type and tag', async () => {
    await write('specs/a.md', `---\ntitle: A\ntags:\n  - x\n---\n# A`);
    await write('specs/b.md', `---\ntitle: B\ntags:\n  - y\n---\n# B`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const xTagged = await indexer.query({ type: 'spec', tag: 'x' });
    expect(xTagged.map((d) => d.id)).toEqual(['spec-a']);
  });
});

describe('graph-analysis', () => {
  it('detects orphans as entries with no in and no out edges', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\nLinks [[b]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B`);
    await write('specs/c.md', `---\ntitle: C\n---\n# C`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const orphans = detectOrphans(graph, index.entries);

    expect(orphans).toContain('spec-c');
    expect(orphans).not.toContain('spec-a');
    expect(orphans).not.toContain('spec-b');
  });

  it('reports broken links', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[does-not-exist]]`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    expect(graph.brokenLinks).toEqual(
      expect.arrayContaining([{ sourceId: 'spec-a', target: 'does-not-exist' }]),
    );
  });

  it('ranks hubs by incoming link count', async () => {
    await write('specs/hub.md', `---\ntitle: Hub\n---\n# Hub`);
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[hub]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B\n[[hub]]`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const hubs = detectHubs(graph, 5);
    expect(hubs[0]).toEqual({ id: 'spec-hub', inDegree: 2 });
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
    expect(results[0].docId).toBe('spec-auth');
  });

  it('returns empty for stop-word-only query', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    expect(searchBM25(inv, 'the and or')).toEqual([]);
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
    expect(entry.id).toBe('spec-new-spec');
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
    await write('specs/s.md', `---\ntitle: S\n---\n# S\norig`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    try {
      await writer.update('spec-s', {
        body: 'updated',
        expectedHash: 'deadbeef',
      });
      expect.fail('expected CONFLICT');
    } catch (err) {
      expect(err).toBeInstanceOf(WikiWriteError);
      expect((err as WikiWriteError).code).toBe('CONFLICT');
    }
  });

  it('updates existing spec preserving frontmatter', async () => {
    await write('specs/s.md', `---\ntitle: Old\ntags:\n  - a\n---\n# Old\nbody`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.update('spec-s', {
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
    await writer.remove('spec-gone');
    const index = await indexer.get();
    expect(index.byId['spec-gone']).toBeUndefined();
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
