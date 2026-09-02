import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transformers = vi.hoisted(() => {
  const dispose = vi.fn(async () => undefined);
  const runner = Object.assign(
    vi.fn(async () => ({ data: new Float32Array([1, 0]), dims: [1, 2] })),
    { dispose },
  );
  return {
    dispose,
    runner,
    pipeline: vi.fn(async () => runner),
    env: {},
  };
});

vi.mock('#maestro-transformers', () => ({
  pipeline: transformers.pipeline,
  env: transformers.env,
}));

import { disposeEmbeddingPipeline, embedQuery } from './embedding.js';

const originalDevice = process.env.MAESTRO_EMBEDDING_DEVICE;

describe('embedding pipeline lifecycle', () => {
  beforeEach(() => {
    process.env.MAESTRO_EMBEDDING_DEVICE = 'cpu';
    transformers.dispose.mockClear();
    transformers.runner.mockClear();
    transformers.pipeline.mockClear();
  });

  afterEach(async () => {
    await disposeEmbeddingPipeline();
    if (originalDevice === undefined) delete process.env.MAESTRO_EMBEDDING_DEVICE;
    else process.env.MAESTRO_EMBEDDING_DEVICE = originalDevice;
  });

  it('disposes a loaded pipeline once and permits a later reload', async () => {
    await expect(embedQuery('first')).resolves.toEqual(new Float32Array([1, 0]));
    expect(transformers.pipeline).toHaveBeenCalledTimes(1);

    await Promise.all([disposeEmbeddingPipeline(), disposeEmbeddingPipeline()]);
    expect(transformers.dispose).toHaveBeenCalledTimes(1);

    await expect(embedQuery('second')).resolves.toEqual(new Float32Array([1, 0]));
    expect(transformers.pipeline).toHaveBeenCalledTimes(2);
  });
});
