import { describe, expect, it } from 'vitest';

import {
  v3ContinuationMetadataSchema,
  v3DecideNext,
  v3RunNext,
  v3TaskContractSchema,
} from './continuation-v3.js';

describe('v3 continuation contracts', () => {
  it('renders exact mutation authority and validates the structured metadata', () => {
    const contract = v3RunNext({
      sessionId: 'session-1', orchestrationRevision: 7, reason: 'dispatch the next Run',
    });
    expect(contract.next.command).toBe(
      'maestro run next --session session-1 --actor <actor-id> '
      + '--expected-orchestration-revision 7 --json',
    );
    expect(v3ContinuationMetadataSchema.parse(contract.continuation)).toEqual({
      operation: 'next',
      locator: { session_id: 'session-1', run_id: null },
      revision_requirements: { expected_orchestration_revision: 7, expected_run_revision: null },
      required_caller_fields: ['actor'],
    });
  });

  it('keeps re-decision verdict caller-owned', () => {
    const contract = v3DecideNext({
      sessionId: 'session-1', pointId: 'gate-1', orchestrationRevision: 8,
      reason: 'resolve the gate',
    });
    expect(contract.next.command).toBe(
      'maestro run decide gate-1 --session session-1 --actor <actor-id> '
      + '--expected-orchestration-revision 8 '
      + '--verdict <verdict> --json',
    );
    expect(contract.continuation.required_caller_fields).toEqual([
      'actor', 'verdict',
    ]);
  });

  it('keeps task and continuation nested contracts strict', () => {
    expect(v3TaskContractSchema.parse({
      command: 'implement', args: ['domain text'], goal: 'ship', input_refs: ['ART-1'],
    })).toEqual({ command: 'implement', args: ['domain text'], goal: 'ship', input_refs: ['ART-1'] });
    expect(() => v3TaskContractSchema.parse({
      command: 'implement', args: [], goal: null, input_refs: [], unknown: true,
    })).toThrow();
    expect(() => v3ContinuationMetadataSchema.parse({
      operation: 'next',
      locator: { session_id: 'session-1', run_id: null, execution_id: 'legacy' },
      revision_requirements: { expected_orchestration_revision: 7, expected_run_revision: null },
      required_caller_fields: ['actor'],
    })).toThrow();
  });
});
