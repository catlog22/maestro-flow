// Regression: runNext must refuse when step has no resolvable content.
// In the new model, sessions live in .workflow/sessions/{id}/session.json
// with orchestration.chain[] for step ordering.

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runNext } from '../cmd-next.js';

describe('runNext — refuses step with no content', () => {
  const sessionId = 'test-no-content';
  let tmpRoot: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpRoot = mkdtempSync(join(tmpdir(), 'ralph-next-'));
    const sessDir = join(tmpRoot, '.workflow', 'sessions', sessionId);
    mkdirSync(join(sessDir, 'runs'), { recursive: true });
    mkdirSync(join(sessDir, 'specs'), { recursive: true });
    mkdirSync(join(sessDir, 'knowhow'), { recursive: true });

    const session = {
      schema_version: 'session/1.0',
      session_id: sessionId,
      intent: 'test intent',
      status: 'running',
      identity_revision: 1,
      activity_revision: 0,
      active_run_id: null,
      latest_completed_run_id: null,
      boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: '' },
      orchestration: {
        engine: 'ralph',
        quality_mode: 'standard',
        auto_mode: false,
        chain: [
          { step_id: 'step-000-nonexistent', command: 'nonexistent-step-xyz', status: 'pending', run_id: null, inserted_by: 'build', decision_ref: null },
        ],
        decision_points: [],
      },
      requests: [],
      lifecycle: { sealed_at: null, seal_summary: null, promoted_spec_ids: [], promoted_knowhow_ids: [], forked_from: null },
      refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
    };
    const gates = { schema_version: 'gates/1.0', revision: 0, gates: {}, summary: { total: 0, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null } };
    const artifacts = { schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {} };
    const evidence = { schema_version: 'evidence/1.0', revision: 0, records: {} };

    writeFileSync(join(sessDir, 'session.json'), JSON.stringify(session, null, 2));
    writeFileSync(join(sessDir, 'gates.json'), JSON.stringify(gates, null, 2));
    writeFileSync(join(sessDir, 'artifacts.json'), JSON.stringify(artifacts, null, 2));
    writeFileSync(join(sessDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    writeFileSync(join(sessDir, 'events.ndjson'), '');
    writeFileSync(join(sessDir, 'context.md'), '# test\n');

    process.chdir(tmpRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns 1 when step command has no prepare or workflow content', async () => {
    const code = await runNext({ sessionId });
    expect(code).toBe(1);
  });
});
