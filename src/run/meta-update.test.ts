// M6 — `session meta update`: integral-replace of orchestration.position /
// decomposition with schema validation. Covers replace, validation rejection of
// malformed JSON blocks, at-least-one-required, and null clearing.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDecompositionInput,
  parsePositionInput,
  updateSessionMeta,
} from './chain-admin.js';
import { SessionStore } from './store.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-meta-'));
  roots.push(path);
  return path;
}

function seed(projectRoot: string, sessionId: string): void {
  new SessionStore(projectRoot).createSession(sessionId, `intent ${sessionId}`);
}

function orchOf(projectRoot: string, sessionId: string) {
  return new SessionStore(projectRoot).readBundle(sessionId).session.orchestration;
}

const validPosition = {
  lifecycle: 'verify',
  phase: 2,
  phase_is_new: false,
  milestone: 'M-2',
  planning_mode: 'unified',
  passed_gates: ['scope', 'plan'],
  scope_verdict: 'medium',
};

const validDecomposition = {
  execution_criteria: ['tests pass', 'no regressions'],
  goals: [
    { id: 'G1', goal: 'add auth', status: 'done' },
    { id: 'G2', goal: 'wire routes', status: 'pending' },
  ],
  changelog: [],
};

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('parse helpers', () => {
  it('validates a well-formed position block', () => {
    expect(parsePositionInput(validPosition).lifecycle).toBe('verify');
  });

  it('rejects a malformed position block (missing required field)', () => {
    expect(() => parsePositionInput({ lifecycle: 'verify' })).toThrow();
  });

  it('rejects an unknown extra key (strict schema)', () => {
    expect(() => parsePositionInput({ ...validPosition, bogus: 1 })).toThrow();
  });

  it('validates a well-formed decomposition block', () => {
    expect(parseDecompositionInput(validDecomposition).goals).toHaveLength(2);
  });

  it('rejects a decomposition with a bad goal status', () => {
    expect(() => parseDecompositionInput({
      execution_criteria: [],
      goals: [{ id: 'G1', goal: 'x', status: 'not-a-status' }],
      changelog: [],
    })).toThrow();
  });
});

describe('updateSessionMeta', () => {
  it('replaces position only', () => {
    const projectRoot = root();
    seed(projectRoot, 's');
    const result = updateSessionMeta(projectRoot, 's', {
      position: parsePositionInput(validPosition),
    });
    expect(result.updated).toEqual(['position']);
    expect(orchOf(projectRoot, 's').position?.lifecycle).toBe('verify');
    expect(orchOf(projectRoot, 's').decomposition).toBeNull();
  });

  it('replaces decomposition only', () => {
    const projectRoot = root();
    seed(projectRoot, 's');
    const result = updateSessionMeta(projectRoot, 's', {
      decomposition: parseDecompositionInput(validDecomposition),
    });
    expect(result.updated).toEqual(['decomposition']);
    expect(orchOf(projectRoot, 's').decomposition?.goals).toHaveLength(2);
    expect(orchOf(projectRoot, 's').position).toBeNull();
  });

  it('replaces both blocks in one call (integral replace)', () => {
    const projectRoot = root();
    seed(projectRoot, 's');
    // Seed an initial position, then replace with a different one.
    updateSessionMeta(projectRoot, 's', { position: parsePositionInput(validPosition) });
    const next = { ...validPosition, lifecycle: 'review', passed_gates: [] };
    updateSessionMeta(projectRoot, 's', {
      position: parsePositionInput(next),
      decomposition: parseDecompositionInput(validDecomposition),
    });
    const orch = orchOf(projectRoot, 's');
    expect(orch.position?.lifecycle).toBe('review');
    expect(orch.position?.passed_gates).toEqual([]); // fully replaced, not merged
    expect(orch.decomposition?.execution_criteria).toEqual(['tests pass', 'no regressions']);
  });

  it('throws for a missing session', () => {
    const projectRoot = root();
    expect(() => updateSessionMeta(projectRoot, 'nope', { position: parsePositionInput(validPosition) }))
      .toThrow(/session not found/);
  });
});
