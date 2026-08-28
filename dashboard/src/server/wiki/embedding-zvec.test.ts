import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEmbeddingIndex,
  loadEmbeddingIndex,
  saveEmbeddingIndex,
  validateEmbeddingApiConfig,
  vectorSearchZvec,
  type EmbeddingIndex,
} from './embedding.js';

const zvec = await import('@zvec/zvec').catch(() => null);
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-zvec-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Embedding persistence validation', () => {
  it('validates bounded API dimensions, batch size, and concurrency', () => {
    const base = { baseUrl: 'https://embedding.test/v1', apiKey: 'secret', model: 'test' };
    expect(validateEmbeddingApiConfig({ ...base, dimensions: 1536, batchSize: 64, concurrency: 8 }))
      .toMatchObject({ dimensions: 1536, batchSize: 64, concurrency: 8 });
    for (const invalid of [
      { dimensions: 0 }, { dimensions: 1.5 }, { dimensions: 65_537 },
      { batchSize: 0 }, { batchSize: 257 },
      { concurrency: 0 }, { concurrency: 65 },
    ]) {
      expect(validateEmbeddingApiConfig({ ...base, ...invalid })).toBeNull();
    }
  });

  it('honors an already-aborted build signal before initializing a model pipeline', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildEmbeddingIndex([], null, undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('round-trips the binary format without a packed whole-index copy', async () => {
    const dir = makeTempDir();
    const index: EmbeddingIndex = {
      modelId: 'binary-model',
      dimension: 2,
      docIds: ['a#0', 'b#0'],
      vectors: [new Float32Array([1, 2]), new Float32Array([3, 4])],
      contentHashes: ['ha', 'hb'],
      chunkDocIds: ['a', 'b'],
      builtAt: 1,
    };
    await saveEmbeddingIndex(index, dir);
    const loaded = loadEmbeddingIndex(dir);
    expect(loaded?.docIds).toEqual(index.docIds);
    expect(loaded?.contentHashes).toEqual(index.contentHashes);
    expect(Array.from(loaded!.vectors[1])).toEqual([3, 4]);
  });

  it('does not replace a published index when save starts aborted', async () => {
    const dir = makeTempDir();
    const original: EmbeddingIndex = {
      modelId: 'original', dimension: 2, docIds: ['a'],
      vectors: [new Float32Array([1, 0])], builtAt: 1,
    };
    await saveEmbeddingIndex(original, dir);
    const controller = new AbortController();
    controller.abort();
    await expect(saveEmbeddingIndex({
      ...original,
      modelId: 'replacement',
      vectors: [new Float32Array([0, 1])],
    }, dir, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadEmbeddingIndex(dir)?.modelId).toBe('original');
  });

  it('stats and rejects oversized binary and zvec sidecar files before reading them', () => {
    const dir = makeTempDir();
    const makeSparse = (path: string, bytes: number) => {
      const fd = openSync(path, 'w');
      try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
    };

    makeSparse(join(dir, 'embedding-index.bin'), 512 * 1024 * 1024 + 1);
    expect(loadEmbeddingIndex(dir)).toBeNull();

    rmSync(join(dir, 'embedding-index.bin'));
    mkdirSync(join(dir, 'embedding.zvec'));
    makeSparse(join(dir, 'embedding.zvec.meta.json'), 64 * 1024 * 1024 + 1);
    expect(loadEmbeddingIndex(dir)).toBeNull();
  });

  it('bounds and validates legacy JSON and SQLite migrations before materializing vectors', () => {
    const dir = makeTempDir();
    const legacyJson = join(dir, 'embedding-index.json');
    const makeSparse = (path: string, bytes: number) => {
      const fd = openSync(path, 'w');
      try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
    };

    makeSparse(legacyJson, 64 * 1024 * 1024 + 1);
    expect(loadEmbeddingIndex(dir)).toBeNull();
    rmSync(legacyJson);

    writeFileSync(legacyJson, JSON.stringify({
      modelId: 'legacy-json', dimension: 2, docIds: ['a'], vectors: ['AAAAAA=='], builtAt: 1,
    }));
    expect(loadEmbeddingIndex(dir)).toBeNull();
    rmSync(legacyJson);

    const dbPath = join(dir, 'embedding-index.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE vectors (doc_id TEXT, vector BLOB)');
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('modelId', 'legacy-sqlite');
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('dimension', '2');
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('builtAt', '1');
      db.prepare('INSERT INTO vectors (doc_id, vector) VALUES (?, ?)').run('a', new Uint8Array(4));
    } finally {
      db.close();
    }
    expect(loadEmbeddingIndex(dir)).toBeNull();
  });

  it('rejects impossible binary metadata and truncated vector payloads', () => {
    const dir = makeTempDir();
    const binPath = join(dir, 'embedding-index.bin');
    const writePacked = (meta: Record<string, unknown>, docIds: string[], payload: Buffer) => {
      const metaBytes = Buffer.from(JSON.stringify(meta));
      const docIdBytes = Buffer.from(JSON.stringify(docIds));
      const metaLength = Buffer.alloc(4);
      const docIdLength = Buffer.alloc(4);
      metaLength.writeUInt32LE(metaBytes.length);
      docIdLength.writeUInt32LE(docIdBytes.length);
      writeFileSync(binPath, Buffer.concat([metaLength, metaBytes, docIdLength, docIdBytes, payload]));
    };

    writePacked({ modelId: 'bad', dimension: 65_536, count: 10_000_000, builtAt: 1 }, [], Buffer.alloc(0));
    expect(loadEmbeddingIndex(dir)).toBeNull();

    writePacked({ modelId: 'bad', dimension: 2, count: 1, builtAt: 1 }, ['a'], Buffer.alloc(4));
    expect(loadEmbeddingIndex(dir)).toBeNull();
  });
});

describe.skipIf(!zvec)('Zvec embedding persistence', () => {
  it('uses safe internal IDs while preserving original chunk IDs', async () => {
    const dir = makeTempDir();
    const docIds = ['spec:project/auth#0', '知识/说明#1'];
    const index: EmbeddingIndex = {
      modelId: 'test-model',
      dimension: 3,
      docIds,
      vectors: [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])],
      chunkDocIds: ['spec:project/auth', '知识/说明'],
      builtAt: 1,
    };

    await saveEmbeddingIndex(index, dir);

    const meta = JSON.parse(readFileSync(join(dir, 'embedding.zvec.meta.json'), 'utf-8'));
    expect(meta).toMatchObject({ docIds, zvecIdEncoding: 'sha256' });

    const collection = zvec!.ZVecOpen(join(dir, 'embedding.zvec'), { readOnly: true });
    try {
      const internalId = createHash('sha256').update(docIds[0]).digest('hex');
      const fetched = collection.fetchSync({ ids: [internalId], includeVector: false, outputFields: ['docId'] });
      expect(fetched[internalId]?.fields.docId).toBe(docIds[0]);
    } finally {
      collection.closeSync();
    }

    const loaded = loadEmbeddingIndex(dir);
    expect(loaded?.docIds).toEqual(docIds);
    expect(Array.from(loaded!.vectors[0])).toEqual([1, 0, 0]);
    expect(Array.from(loaded!.vectors[1])).toEqual([0, 1, 0]);

    const results = await vectorSearchZvec(new Float32Array([1, 0, 0]), dir, 2);
    expect(results[0]?.docId).toBe(docIds[0]);
  });

  it('falls back to the binary index when the Zvec sidecar and collection disagree', async () => {
    const dir = makeTempDir();
    const index: EmbeddingIndex = {
      modelId: 'test-model',
      dimension: 2,
      docIds: ['spec:project:auth#0'],
      vectors: [new Float32Array([0.5, 0.5])],
      builtAt: 1,
    };
    await saveEmbeddingIndex(index, dir);

    const metaPath = join(dir, 'embedding.zvec.meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.docIds = ['tampered:missing#0'];
    writeFileSync(metaPath, JSON.stringify(meta));

    const loaded = loadEmbeddingIndex(dir);
    expect(loaded?.docIds).toEqual(index.docIds);
    expect(Array.from(loaded!.vectors[0])).toEqual([0.5, 0.5]);
  });

  it('falls back to binary when zvec vector dimensions disagree with metadata', async () => {
    const dir = makeTempDir();
    const index: EmbeddingIndex = {
      modelId: 'test-model',
      dimension: 2,
      docIds: ['spec:project:auth#0'],
      vectors: [new Float32Array([0.25, 0.75])],
      builtAt: 1,
    };
    await saveEmbeddingIndex(index, dir);
    const metaPath = join(dir, 'embedding.zvec.meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.dimension = 3;
    writeFileSync(metaPath, JSON.stringify(meta));

    const loaded = loadEmbeddingIndex(dir);
    expect(loaded?.dimension).toBe(2);
    expect(Array.from(loaded!.vectors[0])).toEqual([0.25, 0.75]);
  });

  it('loads legacy collections whose sidecar has no ID encoding marker', () => {
    const dir = makeTempDir();
    const collectionPath = join(dir, 'embedding.zvec');
    const schema = new zvec!.ZVecCollectionSchema({
      name: 'embedding',
      vectors: {
        name: 'embedding',
        dataType: zvec!.ZVecDataType.VECTOR_FP32,
        dimension: 2,
        indexParams: {
          indexType: zvec!.ZVecIndexType.FLAT,
          metricType: zvec!.ZVecMetricType.COSINE,
        },
      },
      fields: [{ name: 'docId', dataType: zvec!.ZVecDataType.STRING }],
    });
    const collection = zvec!.ZVecCreateAndOpen(collectionPath, schema);
    try {
      collection.upsertSync([{
        id: 'legacy-doc#0',
        vectors: { embedding: new Float32Array([0.25, 0.75]) },
        fields: { docId: 'legacy-doc#0' },
      }]);
    } finally {
      collection.closeSync();
    }
    writeFileSync(join(dir, 'embedding.zvec.meta.json'), JSON.stringify({
      modelId: 'legacy-model',
      dimension: 2,
      builtAt: 1,
      docIds: ['legacy-doc#0'],
    }));

    const loaded = loadEmbeddingIndex(dir);
    expect(loaded?.docIds).toEqual(['legacy-doc#0']);
    expect(Array.from(loaded!.vectors[0])).toEqual([0.25, 0.75]);
  });
});
