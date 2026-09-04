import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transformers = vi.hoisted(() => {
  const runner = Object.assign(
    vi.fn(async (batch: string[]) => ({
      data: new Float32Array(batch.length * 384).fill(0).map((_, index) => index % 384 === 0 ? 1 : 0),
      dims: [batch.length, 384],
    })),
    { dispose: vi.fn(async () => undefined) },
  );
  return { runner, pipeline: vi.fn(async () => runner), env: {} };
});

vi.mock('#maestro-transformers', () => ({
  pipeline: transformers.pipeline,
  env: transformers.env,
}));

import {
  buildEmbeddingIndex,
  disposeEmbeddingPipeline,
  loadEmbeddingIndex,
  saveEmbeddingIndex,
  splitDocToChunks,
} from './embedding.js';
import { STRUCTURED_FRAGMENT_POLICY_CHECKSUM } from './structured-fragments.js';

const originalFlag = process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS;
const originalDevice = process.env.MAESTRO_EMBEDDING_DEVICE;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('structured embedding artifact lifecycle', () => {
  beforeEach(() => {
    process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS = '1';
    process.env.MAESTRO_EMBEDDING_DEVICE = 'cpu';
    transformers.runner.mockClear();
    transformers.pipeline.mockClear();
  });

  afterEach(async () => {
    await disposeEmbeddingPipeline();
    if (originalFlag === undefined) delete process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS;
    else process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS = originalFlag;
    if (originalDevice === undefined) delete process.env.MAESTRO_EMBEDDING_DEVICE;
    else process.env.MAESTRO_EMBEDDING_DEVICE = originalDevice;
  });

  it('emits structured evidence while preserving parent ids and policy fence', async () => {
    const docs = [{
      id: 'knowhow-long', title: 'Long', summary: 'Summary', tags: ['cache'],
      body: '# Root\n' + Array.from({ length: 100 }, (_, i) => `line ${i} with semantic context`).join('\n'),
    }];
    const chunks = splitDocToChunks(docs[0]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.fragment?.parentId === 'knowhow-long')).toBe(true);
    const index = await buildEmbeddingIndex(docs);
    expect(index.policyChecksum).toBe(STRUCTURED_FRAGMENT_POLICY_CHECKSUM);
    expect(index.fragments).toHaveLength(index.docIds.length);
    expect(index.fragments?.map(fragment => fragment.fragmentId)).toEqual(index.docIds);
    expect(index.chunkDocIds).toEqual(index.fragments?.map(fragment => fragment.parentId));
  });

  it('persists fragment evidence and the policy checksum as an artifact fence', async () => {
    const fragment = splitDocToChunks({ id: 'wiki-persisted', title: 'Persisted', summary: '', tags: [], body: '# Heading\nbody' })[0].fragment!;
    const dir = mkdtempSync(join(tmpdir(), 'maestro-structured-embedding-'));
    tempDirs.push(dir);
    await saveEmbeddingIndex({
      modelId: 'structured-test',
      dimension: 2,
      docIds: [fragment.fragmentId],
      vectors: [new Float32Array([1, 0])],
      contentHashes: ['parent-hash'],
      chunkDocIds: [fragment.parentId],
      fragments: [fragment],
      policyChecksum: STRUCTURED_FRAGMENT_POLICY_CHECKSUM,
      builtAt: 1,
    }, dir);
    const sidecarPath = join(dir, 'embedding.zvec.meta.json');
    if (existsSync(sidecarPath)) {
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
      expect(sidecar.policyChecksum).toBe(STRUCTURED_FRAGMENT_POLICY_CHECKSUM);
    }
    expect(loadEmbeddingIndex(dir)?.fragments?.[0]).toEqual(fragment);
  });

  it('reuses unchanged vectors and invalidates a mismatched policy artifact', async () => {
    const docs = [{ id: 'wiki-one', title: 'One', summary: '', tags: [], body: '# Heading\nbody' }];
    const first = await buildEmbeddingIndex(docs);
    const callsAfterFirst = transformers.runner.mock.calls.length;
    const second = await buildEmbeddingIndex(docs, first);
    expect(transformers.runner.mock.calls.length).toBe(callsAfterFirst);
    const stale = { ...first, policyChecksum: '0'.repeat(64) };
    await buildEmbeddingIndex(docs, stale);
    expect(transformers.runner.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(second.fragments?.[0].parentId).toBe('wiki-one');
  });
});
