// M6 — coordinator-tracker reads lifecycle / phase / passed_gates from
// session/1.1's orchestration.position first, falling back to ralph-meta.json for
// un-migrated 1.0 sessions. Drives the public readMaestroSession over a real
// on-disk session directory.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMaestroSession } from './coordinator-tracker.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-tracker-'));
  roots.push(path);
  return path;
}

/** Write a ralph-engine session.json + optional ralph-meta.json under a session dir. */
function writeSession(
  workspaceRoot: string,
  sessionId: string,
  sessionJson: Record<string, unknown>,
  ralphMeta?: Record<string, unknown>,
): void {
  const dir = join(workspaceRoot, '.workflow', 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify(sessionJson), 'utf8');
  if (ralphMeta) writeFileSync(join(dir, 'ralph-meta.json'), JSON.stringify(ralphMeta), 'utf8');
}

function baseSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 's1',
    intent: 'do the thing',
    status: 'running',
    orchestration: {
      engine: 'ralph',
      quality_mode: 'standard',
      auto_mode: false,
      chain: [
        { step_id: 'step-000-a', command: 'analyze', status: 'sealed', decision_ref: null },
        { step_id: 'step-001-b', command: 'plan', status: 'running', decision_ref: null },
      ],
      decision_points: [],
      ...(overrides.orchestration as object ?? {}),
    },
  };
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('coordinator-tracker double-source', () => {
  it('reads lifecycle / phase / passed_gates from orchestration.position (1.1)', () => {
    const workspace = root();
    writeSession(workspace, 's1', baseSession({
      orchestration: {
        engine: 'ralph',
        quality_mode: 'standard',
        auto_mode: false,
        chain: [
          { step_id: 'step-000-a', command: 'analyze', status: 'sealed', decision_ref: null },
          { step_id: 'step-001-b', command: 'plan', status: 'running', decision_ref: null },
        ],
        decision_points: [],
        position: {
          lifecycle: 'plan',
          phase: 2,
          phase_is_new: false,
          milestone: 'M-2',
          planning_mode: 'unified',
          passed_gates: ['scope', 'analyze'],
          scope_verdict: 'medium',
        },
      },
    }), {
      // Stale ralph-meta present — must be ignored in favour of position.
      lifecycle_position: 'STALE',
      phase: 99,
      passed_gates: ['STALE'],
    });

    const data = readMaestroSession(workspace);
    expect(data).not.toBeNull();
    expect(data?.lifecycle_position).toBe('plan');
    expect(data?.phase).toBe(2);
    expect(data?.passed_gates).toEqual(['scope', 'analyze']);
  });

  it('falls back to ralph-meta.json when no position block (1.0)', () => {
    const workspace = root();
    writeSession(workspace, 's1', baseSession(), {
      lifecycle_position: 'verify',
      phase: 3,
      passed_gates: ['scope', 'plan', 'execute'],
    });

    const data = readMaestroSession(workspace);
    expect(data?.lifecycle_position).toBe('verify');
    expect(data?.phase).toBe(3);
    expect(data?.passed_gates).toEqual(['scope', 'plan', 'execute']);
  });

  it('degrades gracefully when neither position nor ralph-meta exist', () => {
    const workspace = root();
    writeSession(workspace, 's1', baseSession());
    const data = readMaestroSession(workspace);
    expect(data).not.toBeNull();
    expect(data?.lifecycle_position).toBeUndefined();
    expect(data?.phase).toBeNull();
    expect(data?.passed_gates).toBeUndefined();
  });
});
