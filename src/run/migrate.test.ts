// session/1.1 migration + schema compat.
// Covers: session/1.0 read→write round-trip is lossless (version bumps to 1.1,
// original fields survive); migrateSession folds ralph-meta into orchestration;
// idempotency; running-step rejection; step_details → chain step mapping;
// completion_*/context are never carried; verification_ledger stays in ralph-meta.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionStateSchema } from './schemas.js';
import { SessionStore } from './store.js';
import { migrateSession } from './migrate.js';

let tmpRoot: string;

function sessionDir(sessionId: string): string {
  return join(tmpRoot, '.workflow', 'sessions', sessionId);
}

interface WriteSessionOpts {
  version?: 'session/1.0' | 'session/1.1';
  engine?: string;
  chain?: unknown[];
  status?: string;
}

function writeSession(sessionId: string, opts: WriteSessionOpts = {}): void {
  const dir = sessionDir(sessionId);
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const session = {
    schema_version: opts.version ?? 'session/1.0',
    session_id: sessionId,
    intent: 'test intent',
    status: opts.status ?? 'running',
    identity_revision: 1,
    activity_revision: 0,
    active_run_id: null,
    latest_completed_run_id: null,
    boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: '' },
    orchestration: {
      engine: opts.engine ?? 'ralph',
      quality_mode: 'standard',
      auto_mode: false,
      chain: opts.chain ?? [],
      decision_points: [],
    },
    requests: [],
    lifecycle: { sealed_at: null, seal_summary: null, promoted_spec_ids: [], promoted_knowhow_ids: [], forked_from: null },
    refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
  };
  const gates = { schema_version: 'gates/1.0', revision: 0, gates: {}, summary: { total: 0, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null } };
  const artifacts = { schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {} };
  const evidence = { schema_version: 'evidence/1.0', revision: 0, records: {} };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2));
  writeFileSync(join(dir, 'gates.json'), JSON.stringify(gates, null, 2));
  writeFileSync(join(dir, 'artifacts.json'), JSON.stringify(artifacts, null, 2));
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(dir, 'events.ndjson'), '');
  writeFileSync(join(dir, 'context.md'), '# test\n');
}

function writeRalphMeta(sessionId: string, meta: unknown): void {
  writeFileSync(join(sessionDir(sessionId), 'ralph-meta.json'), JSON.stringify(meta, null, 2));
}

function readSessionRaw(sessionId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sessionDir(sessionId), 'session.json'), 'utf-8'));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'session-migrate-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('session/1.0 read compatibility', () => {
  it('parses a session/1.0 file and materializes null orchestration blocks', () => {
    const sessionId = 'compat-read';
    writeSession(sessionId, { version: 'session/1.0' });
    const store = new SessionStore(tmpRoot);
    const session = store.readBundle(sessionId).session;
    expect(session.schema_version).toBe('session/1.0');
    expect(session.orchestration.position).toBeNull();
    expect(session.orchestration.decomposition).toBeNull();
    expect(session.orchestration.lease).toBeNull();
    expect(session.orchestration.executor).toBeNull();
  });

  it('round-trips session/1.0 → 1.1 losslessly (original fields survive, version bumps)', () => {
    const sessionId = 'compat-roundtrip';
    const chain = [
      { step_id: 'step-000-analyze', command: 'maestro-analyze', status: 'completed', run_id: 'run-1', inserted_by: 'build', decision_ref: null },
    ];
    writeSession(sessionId, { version: 'session/1.0', chain });
    const store = new SessionStore(tmpRoot);
    // Any mutation triggers write-back at session/1.1.
    store.update(sessionId, (draft) => { draft.session.activity_revision++; return null; });

    const raw = readSessionRaw(sessionId);
    expect(raw.schema_version).toBe('session/1.1');
    expect(raw.intent).toBe('test intent');
    const orch = raw.orchestration as Record<string, unknown>;
    const writtenChain = orch.chain as Array<Record<string, unknown>>;
    expect(writtenChain[0].step_id).toBe('step-000-analyze');
    expect(writtenChain[0].command).toBe('maestro-analyze');
    expect(writtenChain[0].run_id).toBe('run-1');
    // Re-parse to confirm the written file is schema-valid.
    expect(() => sessionStateSchema.parse(raw)).not.toThrow();
  });
});

describe('migrateSession', () => {
  const fullChain = [
    { step_id: 'step-000-analyze', command: 'maestro-analyze', status: 'completed', run_id: 'run-1', inserted_by: 'build', decision_ref: null },
    { step_id: 'step-001-plan', command: 'maestro-plan', status: 'pending', run_id: null, inserted_by: 'build', decision_ref: null },
  ];

  const fullMeta = {
    lifecycle_position: 'plan',
    phase: 2,
    phase_is_new: true,
    milestone: 'M-alpha',
    planning_mode: 'unified',
    passed_gates: ['entry', 'scope'],
    scope_verdict: 'medium',
    execution_criteria: ['builds green', 'tests pass'],
    task_decomposition: [
      { id: 'G1', goal: 'ship migrate', status: 'pending' },
    ],
    goal_changelog: [
      {
        id: 'CHG-001', timestamp: '2026-07-16T00:00:00Z', change_type: 'add', reason: 'init',
        before: { goals: [] }, after: { goals: [{ id: 'G1', goal: 'ship migrate' }] },
      },
    ],
    execution_owner: 'ralph-execute',
    owner_epoch: 3,
    lease_id: 'lease-xyz',
    platform: 'claude',
    cli_tool: 'claude',
    context: { plan_dir: '/tmp/plan', analyze_macro_id: 'AM-1' },
    protocol_version: '2',
    verification_ledger: [
      { authority: 'verify', dimension: 'unit', subject_ids: ['G1'], evidence_hashes: {}, scope_hash: 'h', verdict: 'pass', confidence: 'high', risk_ceiling: 'low', created_at: '2026-07-16T00:00:00Z' },
    ],
    step_details: {
      'step-000-analyze': {
        args: '--depth deep', stage: 'analysis', goal_ref: 'G1', retry_count: 1, max_retries: 3,
        completion_status: 'DONE', completion_summary: 'analysis done', completion_evidence: 'evi.md',
      },
      'step-001-plan': {
        args: '', stage: 'plan', goal_ref: null,
      },
    },
  };

  it('folds ralph-meta into orchestration blocks and maps step_details onto chain steps', () => {
    const sessionId = 'migrate-full';
    writeSession(sessionId, { version: 'session/1.0', chain: fullChain });
    writeRalphMeta(sessionId, fullMeta);

    const result = migrateSession(tmpRoot, sessionId);
    expect(result.status).toBe('migrated');
    expect(result.had_ralph_meta).toBe(true);
    expect(result.mapped_steps).toBe(2);

    const session = new SessionStore(tmpRoot).readBundle(sessionId).session;
    expect(session.schema_version).toBe('session/1.1');

    expect(session.orchestration.position).toEqual({
      lifecycle: 'plan', phase: 2, phase_is_new: true, milestone: 'M-alpha',
      planning_mode: 'unified', passed_gates: ['entry', 'scope'], scope_verdict: 'medium',
    });
    expect(session.orchestration.decomposition?.execution_criteria).toEqual(['builds green', 'tests pass']);
    expect(session.orchestration.decomposition?.goals[0].id).toBe('G1');
    expect(session.orchestration.decomposition?.changelog[0].id).toBe('CHG-001');
    expect(session.orchestration.lease).toEqual({ owner: 'ralph-execute', epoch: 3, id: 'lease-xyz' });
    expect(session.orchestration.executor).toEqual({ platform: 'claude', cli_tool: 'claude' });

    const step0 = session.orchestration.chain[0];
    expect(step0.args).toBe('--depth deep');
    expect(step0.stage).toBe('analysis');
    expect(step0.goal_ref).toBe('G1');
    expect(step0.retry).toEqual({ count: 1, max: 3 });
    const step1 = session.orchestration.chain[1];
    expect(step1.stage).toBe('plan');
    expect(step1.goal_ref).toBeNull();
    // No retry_count/max_retries in detail → defaults (count 0, max 2).
    expect(step1.retry).toEqual({ count: 0, max: 2 });
  });

  it('does not carry completion_* or context onto the session', () => {
    const sessionId = 'migrate-excludes';
    writeSession(sessionId, { version: 'session/1.0', chain: fullChain });
    writeRalphMeta(sessionId, fullMeta);
    migrateSession(tmpRoot, sessionId);

    const raw = JSON.stringify(readSessionRaw(sessionId));
    expect(raw).not.toContain('completion_status');
    expect(raw).not.toContain('completion_summary');
    expect(raw).not.toContain('completion_evidence');
    expect(raw).not.toContain('analyze_macro_id');
    expect(raw).not.toContain('plan_dir');
    expect(raw).not.toContain('protocol_version');
  });

  it('leaves verification_ledger in ralph-meta.json untouched', () => {
    const sessionId = 'migrate-ledger';
    writeSession(sessionId, { version: 'session/1.0', chain: fullChain });
    writeRalphMeta(sessionId, fullMeta);
    migrateSession(tmpRoot, sessionId);

    const meta = JSON.parse(readFileSync(join(sessionDir(sessionId), 'ralph-meta.json'), 'utf-8'));
    expect(Array.isArray(meta.verification_ledger)).toBe(true);
    expect(meta.verification_ledger[0].authority).toBe('verify');
    // Session file never gains a verification_ledger key.
    expect(readSessionRaw(sessionId).verification_ledger).toBeUndefined();
  });

  it('is idempotent — second migrate is a no-op', () => {
    const sessionId = 'migrate-idempotent';
    writeSession(sessionId, { version: 'session/1.0', chain: fullChain });
    writeRalphMeta(sessionId, fullMeta);

    const first = migrateSession(tmpRoot, sessionId);
    expect(first.status).toBe('migrated');
    const second = migrateSession(tmpRoot, sessionId);
    expect(second.status).toBe('already-migrated');
    expect(second.mapped_steps).toBe(0);
  });

  it('rejects a session with a running chain step', () => {
    const sessionId = 'migrate-running';
    const chain = [
      { step_id: 'step-000-execute', command: 'maestro-execute', status: 'running', run_id: 'run-9', inserted_by: 'build', decision_ref: null },
    ];
    writeSession(sessionId, { version: 'session/1.0', chain });
    writeRalphMeta(sessionId, fullMeta);
    expect(() => migrateSession(tmpRoot, sessionId)).toThrow(/running chain step/);
  });

  it('bumps version only when no ralph-meta is present', () => {
    const sessionId = 'migrate-versiononly';
    writeSession(sessionId, { version: 'session/1.0', engine: 'manual', chain: [] });
    const result = migrateSession(tmpRoot, sessionId);
    expect(result.status).toBe('version-only');
    expect(result.had_ralph_meta).toBe(false);
    expect(readSessionRaw(sessionId).schema_version).toBe('session/1.1');
    // Second run recognizes it as already migrated.
    expect(migrateSession(tmpRoot, sessionId).status).toBe('already-migrated');
  });
});
