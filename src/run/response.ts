import {
  runErrorCodeSchema,
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

/** Prefer typed domain codes, then map legacy message-only errors deterministically. */
export function stableRunResponseErrorCode(error: unknown): RunResponseErrorCode {
  const typedCode = (error as { code?: unknown })?.code;
  const parsedCode = runErrorCodeSchema.safeParse(typedCode);
  if (parsedCode.success) return parsedCode.data;

  const message = error instanceof Error ? error.message : String(error);
  if (/Run not found/i.test(message)) return 'RUN_NOT_FOUND';
  if (/session not found/i.test(message)) return 'SESSION_NOT_FOUND';
  if (/ambiguous/i.test(message)) return 'SESSION_AMBIGUOUS';
  if (/lease (?:conflict|is owned)|owner epoch|lease id/i.test(message)) return 'LEASE_CONFLICT';
  if (/stale (?:identity|activity) revision/i.test(message)) return 'FENCE_CONFLICT';
  if (/unresolved escalated decision|unresolved failed chain step|expected "paused"/i.test(message)) return 'RESUME_REQUIRED';
  if (/running chain step/i.test(message)) return 'RUNNING_STEP';
  if (/decision point not found|decision .* is (?:already|not escalated)/i.test(message)) return 'DECISION_REQUIRED';
  if (/chain step not found/i.test(message)) return 'PICK_NOT_FOUND';
  if (/only pending steps|chain step .* is not failed/i.test(message)) return 'PICK_NOT_PENDING';
  if (/unsealed Runs|claimed requests|Session gates are not complete/i.test(message)) return 'SESSION_SEAL_BLOCKED';
  if (/(unknown|invalid).*platform|platform.*(unknown|invalid)/i.test(message)) return 'PLATFORM_INVALID';
  if (/platform.*(mismatch|conflict)/i.test(message)) return 'PLATFORM_CONFLICT';
  if (/contract.*drift/i.test(message)) return 'CONTRACT_DRIFT';
  if (/immutable/i.test(message)) return 'RUN_IMMUTABLE';
  if (/confirmation token not found|invalid confirmation token/i.test(message)) return 'TOKEN_INVALID';
  if (/expired/i.test(message)) return 'TOKEN_EXPIRED';
  if (/already consumed/i.test(message)) return 'TOKEN_REPLAYED';
  if (/request mismatch|different action or request/i.test(message)) return 'REQUEST_CONFLICT';
  if (/required|invalid|must be|cannot insert|at least one|only one block/i.test(message)) return 'INVALID_ARGUMENT';
  return 'INTERNAL_ERROR';
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
