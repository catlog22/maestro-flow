import { describe, expect, it } from 'vitest';
import {
  commandRunReadSchema,
  commandRunSchema,
  commandRunV11Schema,
  goalBindingSchema,
} from './schemas.js';

const hash = 'a'.repeat(64);

function legacyRun(): Record<string, unknown> {
  return {
    schema_version: 'command-run/1.0',
    session_id: 's',
    run_id: 'r1',
    sequence: 1,
    parent_run_id: null,
    command: {
      name: 'demo', version: '1.0', source_path: 'demo.md', content_hash: hash, resolved_prompt_hash: hash,
    },
    status: 'running',
    input: { args: [], consumes: [], context_identity_revision: 0 },
    gate_ids: [],
    output: { produces: [], primary_artifact_id: null, verdict: null },
    handoff: null,
    started_at: '2026-07-17T00:00:00.000Z',
    completed_at: null,
    sealed_at: null,
  };
}

describe('command Run schema compatibility', () => {
  it('strictly reads 1.0 and normalizes it for runtime use', () => {
    expect(commandRunReadSchema.parse(legacyRun()).schema_version).toBe('command-run/1.0');
    const normalized = commandRunSchema.parse(legacyRun());
    expect(normalized).toMatchObject({
      schema_version: 'command-run/1.1',
      chain_step_id: null,
      resolved_platform: 'claude',
      goal_binding: null,
      checkpoint_expectation: null,
      checkpoint: null,
      retry_fence: null,
      command: expect.not.objectContaining({ contract_hash: expect.anything() }),
    });
  });

  it('writes the 1.1 authority fields and rejects unknown fields at both versions', () => {
    const current = {
      ...legacyRun(),
      schema_version: 'command-run/1.1',
      chain_step_id: 'step-001-demo',
      resolved_platform: 'codex',
      goal_binding: null,
      checkpoint_expectation: null,
      checkpoint: null,
      retry_fence: null,
      command: { ...legacyRun().command as Record<string, unknown>, contract_hash: hash },
    };
    expect(commandRunV11Schema.parse(current)).toMatchObject({
      resolved_platform: 'codex',
      command: { contract_hash: hash },
    });
    expect(() => commandRunV11Schema.parse({ ...current, unexpected: true })).toThrow();
    expect(() => commandRunReadSchema.parse({ ...legacyRun(), resolved_platform: 'codex' })).toThrow();
  });

  it('accepts an observational Goal binding with a nullable external ID', () => {
    expect(goalBindingSchema.parse({
      provider: 'codex',
      external_id: null,
      step_goal_ref: 'G1',
      observed_status: 'active',
      observed_at: '2026-07-17T00:00:00.000Z',
    }).external_id).toBeNull();
    expect(() => goalBindingSchema.parse({
      provider: 'codex', external_id: null, step_goal_ref: null, observed_status: 'done', observed_at: 'now',
    })).toThrow();
  });
});
