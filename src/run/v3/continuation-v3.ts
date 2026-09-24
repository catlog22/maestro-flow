import { z } from 'zod';

export const v3ContinuationOperationSchema = z.enum([
  'brief', 'check', 'complete', 'next', 'run-decide', 'session-complete',
]);
export type V3ContinuationOperation = z.infer<typeof v3ContinuationOperationSchema>;

export const v3RequiredCallerFieldSchema = z.enum([
  'participant', 'actor', 'request_id', 'reason', 'verdict',
]);
export type V3RequiredCallerField = z.infer<typeof v3RequiredCallerFieldSchema>;

export const v3ContinuationMetadataSchema = z.object({
  operation: v3ContinuationOperationSchema,
  locator: z.object({
    session_id: z.string().min(1),
    run_id: z.string().min(1).nullable(),
  }).strict(),
  revision_requirements: z.object({
    expected_orchestration_revision: z.number().int().nonnegative().nullable(),
    expected_run_revision: z.number().int().nonnegative().nullable(),
  }).strict(),
  required_caller_fields: z.array(v3RequiredCallerFieldSchema),
}).strict();
export type V3ContinuationMetadata = z.infer<typeof v3ContinuationMetadataSchema>;

export const v3TaskContractSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  goal: z.string().min(1).nullable(),
  input_refs: z.array(z.string().min(1)),
}).strict();
export type V3TaskContract = Readonly<{
  command: string;
  args: readonly string[];
  goal: string | null;
  input_refs: readonly string[];
}>;

export interface V3NextContract {
  next: {
    suggest_only: true;
    command: string;
    reason: string;
  };
  continuation: V3ContinuationMetadata;
}

// Caller flags other than --actor carry safe defaults (--participant falls
// back to --actor, --request-id derives from the invocation, --reason defaults
// to cli:<command>), so emitted commands only require the actor identity.
const MUTATION_CALLER_TEMPLATE = '--actor <actor-id>';
const MUTATION_CALLER_FIELDS: V3RequiredCallerField[] = [
  'actor',
];

function metadata(input: {
  operation: V3ContinuationOperation;
  sessionId: string;
  runId?: string | null;
  orchestrationRevision?: number | null;
  runRevision?: number | null;
  mutation?: boolean;
  additionalCallerFields?: readonly V3RequiredCallerField[];
}): V3ContinuationMetadata {
  return v3ContinuationMetadataSchema.parse({
    operation: input.operation,
    locator: { session_id: input.sessionId, run_id: input.runId ?? null },
    revision_requirements: {
      expected_orchestration_revision: input.orchestrationRevision ?? null,
      expected_run_revision: input.runRevision ?? null,
    },
    required_caller_fields: input.mutation
      ? [...MUTATION_CALLER_FIELDS, ...(input.additionalCallerFields ?? [])]
      : [],
  });
}

export function v3BriefCommand(sessionId: string, runId: string): string {
  return `maestro run brief ${runId} --session ${sessionId} --json`;
}

export function v3CompleteNext(input: {
  sessionId: string;
  runId: string;
  orchestrationRevision: number;
  runRevision: number;
  reason: string;
}): V3NextContract {
  return {
    next: {
      suggest_only: true,
      command: `maestro run complete ${input.runId} --session ${input.sessionId} ${MUTATION_CALLER_TEMPLATE} `
        + `--expected-run-revision ${input.runRevision} `
        + `--expected-orchestration-revision ${input.orchestrationRevision} --verdict done --advance --json`,
      reason: input.reason,
    },
    continuation: metadata({
      operation: 'complete', sessionId: input.sessionId, runId: input.runId,
      orchestrationRevision: input.orchestrationRevision, runRevision: input.runRevision, mutation: true,
    }),
  };
}

export function v3RunNext(input: {
  sessionId: string;
  orchestrationRevision: number;
  reason: string;
}): V3NextContract {
  return {
    next: {
      suggest_only: true,
      command: `maestro run next --session ${input.sessionId} ${MUTATION_CALLER_TEMPLATE} `
        + `--expected-orchestration-revision ${input.orchestrationRevision} --json`,
      reason: input.reason,
    },
    continuation: metadata({
      operation: 'next', sessionId: input.sessionId,
      orchestrationRevision: input.orchestrationRevision, mutation: true,
    }),
  };
}

export function v3SessionCompleteNext(input: {
  sessionId: string;
  orchestrationRevision: number;
  reason: string;
}): V3NextContract {
  return {
    next: {
      suggest_only: true,
      command: `maestro session complete --session ${input.sessionId} ${MUTATION_CALLER_TEMPLATE} `
        + `--expected-orchestration-revision ${input.orchestrationRevision} --json`,
      reason: input.reason,
    },
    continuation: metadata({
      operation: 'session-complete', sessionId: input.sessionId,
      orchestrationRevision: input.orchestrationRevision, mutation: true,
    }),
  };
}

export function v3DecideNext(input: {
  sessionId: string;
  pointId: string;
  orchestrationRevision: number;
  reason: string;
}): V3NextContract {
  return {
    next: {
      suggest_only: true,
      command: `maestro run decide ${input.pointId} --session ${input.sessionId} ${MUTATION_CALLER_TEMPLATE} `
        + `--expected-orchestration-revision ${input.orchestrationRevision} --verdict <verdict> --json`,
      reason: input.reason,
    },
    continuation: metadata({
      operation: 'run-decide', sessionId: input.sessionId,
      orchestrationRevision: input.orchestrationRevision, mutation: true,
      additionalCallerFields: ['verdict'],
    }),
  };
}

export function v3CheckNext(input: {
  sessionId: string;
  runId: string;
  reason: string;
}): V3NextContract {
  return {
    next: {
      suggest_only: true,
      command: `maestro run check ${input.runId} --session ${input.sessionId} --json`,
      reason: input.reason,
    },
    continuation: metadata({ operation: 'check', sessionId: input.sessionId, runId: input.runId }),
  };
}
