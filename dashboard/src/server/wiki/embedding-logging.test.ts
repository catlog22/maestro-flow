import { afterEach, describe, expect, it } from 'vitest';
import { configureOnnxRuntimeLogging, resolveOnnxLogLevel } from './embedding.js';

const originalLevel = process.env.MAESTRO_ONNX_LOG_LEVEL;

afterEach(() => {
  if (originalLevel === undefined) delete process.env.MAESTRO_ONNX_LOG_LEVEL;
  else process.env.MAESTRO_ONNX_LOG_LEVEL = originalLevel;
});

describe('ONNX Runtime logging', () => {
  it('suppresses benign provider warnings by default', async () => {
    delete process.env.MAESTRO_ONNX_LOG_LEVEL;
    const ort = await configureOnnxRuntimeLogging();
    expect(resolveOnnxLogLevel()).toBe('error');
    expect(ort.env.logLevel).toBe('error');
  });

  it('allows an explicit supported diagnostic level', async () => {
    process.env.MAESTRO_ONNX_LOG_LEVEL = 'warning';
    const ort = await configureOnnxRuntimeLogging();
    expect(ort.env.logLevel).toBe('warning');
  });
});
