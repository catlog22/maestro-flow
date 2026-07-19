import {
  runResponseSchema,
  type RunResponse,
  type RunResponseErrorCode,
} from './protocol-schemas.js';

export interface RunResponseBaseInput {
  operation: RunResponse['operation'];
  request_id?: string | null;
  locator?: RunResponse['locator'];
  next?: RunResponse['next'];
  replay?: RunResponse['replay'];
}

export function createRunResponseSuccess(
  input: RunResponseBaseInput & { result: unknown },
): RunResponse {
  return runResponseSchema.parse({
    schema_version: 'run-response/1.0',
    operation: input.operation,
    ok: true,
    exit_code: 0,
    request_id: input.request_id ?? null,
    locator: input.locator ?? null,
    result: input.result,
    next: input.next ?? null,
    error: null,
    replay: input.replay ?? null,
  });
}

export function createRunResponseError(
  input: RunResponseBaseInput & {
    exit_code: 1 | 2 | 3;
    code: RunResponseErrorCode;
    message: string;
    details?: Record<string, unknown>;
  },
): RunResponse {
  return runResponseSchema.parse({
    schema_version: 'run-response/1.0',
    operation: input.operation,
    ok: false,
    exit_code: input.exit_code,
    request_id: input.request_id ?? null,
    locator: input.locator ?? null,
    result: null,
    next: input.next ?? null,
    error: {
      code: input.code,
      message: input.message,
      details: input.details ?? {},
    },
    replay: input.replay ?? null,
  });
}

/** Validate before writing so machine mode never emits a partial envelope. */
export function emitRunResponse(response: RunResponse): void {
  const validated = runResponseSchema.parse(response);
  process.stdout.write(`${JSON.stringify(validated)}\n`);
  process.exitCode = validated.exit_code;
}

export { runResponseSchema, type RunResponse, type RunResponseErrorCode } from './protocol-schemas.js';
