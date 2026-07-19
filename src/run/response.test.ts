import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRunResponseError,
  createRunResponseSuccess,
  emitRunResponse,
  runResponseSchema,
} from './response.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('run-response/1.0', () => {
  it('parses and emits a success envelope with exit 0', () => {
    const response = createRunResponseSuccess({
      operation: 'next',
      locator: { session_id: 's', run_id: 'r' },
      result: { run_id: 'r' },
    });
    expect(runResponseSchema.parse(response)).toMatchObject({ ok: true, exit_code: 0 });
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    emitRunResponse(response);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual(response);
    expect(process.exitCode).toBe(0);
  });

  it('parses a stable error envelope and rejects exit/code drift', () => {
    const response = createRunResponseError({
      operation: 'next',
      exit_code: 2,
      code: 'DECISION_REQUIRED',
      message: 'decision required',
      details: { point_id: 'DP-1' },
    });
    expect(response).toMatchObject({ ok: false, exit_code: 2, error: { code: 'DECISION_REQUIRED' } });
    expect(() => runResponseSchema.parse({ ...response, exit_code: 0 })).toThrow();
    expect(() => runResponseSchema.parse({
      ...response,
      error: { code: 'UNSTABLE_CODE', message: 'bad', details: {} },
    })).toThrow();
    for (const exit_code of [1, 2, 3] as const) {
      expect(createRunResponseError({
        operation: 'next',
        exit_code,
        code: exit_code === 3 ? 'RUNNING_STEP' : 'INTERNAL_ERROR',
        message: `exit ${exit_code}`,
      }).exit_code).toBe(exit_code);
    }
  });
});
