// createRalphSession delegation — after M4 the adapter builds sessions via the
// generic createChainSession. These tests lock the ralph-facing behavior:
// explicit session id used verbatim, engine=ralph, pre-built chain/decision_points
// overlaid, quality/auto/boundary honored, and ralph-meta.json written.

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRalphSession,
  readMeta,
  resolveRalphSession,
  type ChainStep,
} from '../session-adapter.js';
import { SessionStore } from '../../run/store.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'create-ralph-'));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

function chain(): ChainStep[] {
  return [
    { step_id: 'step-000-analyze', command: 'analyze', status: 'pending', run_id: null, inserted_by: 'build', decision_ref: null },
    { step_id: 'step-001-execute', command: 'execute', status: 'pending', run_id: null, inserted_by: 'build', decision_ref: null },
  ];
}

describe('createRalphSession (delegates to createChainSession)', () => {
  it('creates a ralph session with the explicit id, engine, chain and meta', () => {
    const id = 'ralph-20260716-101010';
    const result = createRalphSession(root, id, 'do the ralph thing', {
      qualityMode: 'full',
      autoMode: true,
      chain: chain(),
      decisionPoints: [
        { point_id: 'post-execute', after_step_id: 'step-001-execute', status: 'pending', retry_count: 0, max_retries: 2, evidence_ref: null },
      ],
      meta: { lifecycle_position: 'execute', milestone: 'M1' },
    });

    expect(result.sessionId).toBe(id);
    const store = new SessionStore(root);
    const session = store.readBundle(id).session;
    expect(session.orchestration.engine).toBe('ralph');
    expect(session.orchestration.quality_mode).toBe('full');
    expect(session.orchestration.auto_mode).toBe(true);
    expect(session.orchestration.chain).toHaveLength(2);
    expect(session.orchestration.chain[0].step_id).toBe('step-000-analyze');
    expect(session.orchestration.decision_points).toHaveLength(1);
    expect(session.intent).toBe('do the ralph thing');

    // ralph-meta.json still written alongside session.json
    expect(existsSync(join(result.sessionDir, 'ralph-meta.json'))).toBe(true);
    const meta = readMeta(result.sessionDir);
    expect(meta.lifecycle_position).toBe('execute');
    expect(meta.milestone).toBe('M1');
    expect(JSON.parse(readFileSync(join(result.sessionDir, 'ralph-meta.json'), 'utf-8')).lifecycle_position).toBe('execute');
  });

  it('defaults quality_mode/auto_mode and writes an empty chain when none given', () => {
    const id = 'ralph-20260716-111111';
    const result = createRalphSession(root, id, 'minimal');
    const store = new SessionStore(root);
    const session = store.readBundle(id).session;
    expect(session.orchestration.quality_mode).toBe('standard');
    expect(session.orchestration.auto_mode).toBe(false);
    expect(session.orchestration.chain).toHaveLength(0);
    expect(result.meta.lifecycle_position).toBe('analyze');
  });

  it('fails closed when an explicit legacy metadata file is malformed', () => {
    const id = 'ralph-20260716-121212';
    const result = createRalphSession(root, id, 'corrupt legacy metadata');
    writeFileSync(join(result.sessionDir, 'ralph-meta.json'), '{broken', 'utf-8');

    expect(() => readMeta(result.sessionDir)).toThrow(/invalid legacy ralph-meta\.json/);
    expect(() => resolveRalphSession(root, id)).toThrow(/invalid legacy ralph-meta\.json/);
  });

  it('rejects known legacy metadata fields with invalid runtime types', () => {
    const id = 'ralph-20260716-131313';
    const result = createRalphSession(root, id, 'invalid legacy lease');
    writeFileSync(join(result.sessionDir, 'ralph-meta.json'), JSON.stringify({
      lifecycle_position: 'execute',
      phase: null,
      milestone: 'M1',
      execution_owner: 'ralph-execute',
      owner_epoch: 'not-a-number',
      lease_id: 'lease-1',
    }), 'utf-8');

    expect(() => readMeta(result.sessionDir)).toThrow(/owner_epoch/);
  });

  it('rejects an invalid pre-built chain before allocating a Session', () => {
    const id = 'ralph-20260716-141414';
    expect(() => createRalphSession(root, id, 'invalid chain', {
      chain: [{
        step_id: 'step-000-decision',
        command: 'decision',
        status: 'pending',
        run_id: null,
        inserted_by: 'test',
        decision_ref: 'missing-point',
      }],
    })).toThrow(/decision_ref has no matching decision point/);
    expect(new SessionStore(root).sessionExists(id)).toBe(false);
  });
});
