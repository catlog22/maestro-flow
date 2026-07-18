import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readStoredTeamSessionClassificationAt } from '../team-msg.js';
import { findExactTeamWorkLocation, listTeamWorkLocations } from '../team-run-paths.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createRunState(
  workflowRoot: string,
  sessionId: string,
  runId: string,
  runStatus: string,
  sidecar: Record<string, unknown>,
) {
  const rootDir = join(workflowRoot, 'sessions', sessionId, 'runs', runId);
  const stateDir = join(rootDir, 'work', 'team');
  mkdirSync(join(stateDir, '.msg'), { recursive: true });
  writeFileSync(join(rootDir, 'run.json'), JSON.stringify({ run_id: runId, status: runStatus }));
  writeFileSync(join(stateDir, 'team-session.json'), JSON.stringify(sidecar));
  return { rootDir, stateDir };
}

describe('team lifecycle runtime adapters', () => {
  it('enumerates canonical state before legacy and rejects duplicate exact Run IDs', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-lifecycle-adapter-'));
    roots.push(projectRoot);
    const workflowRoot = join(projectRoot, '.workflow');
    createRunState(workflowRoot, 'session-a', 'run-duplicate', 'running', { status: 'active' });
    createRunState(workflowRoot, 'session-b', 'run-duplicate', 'running', { status: 'active' });
    mkdirSync(join(workflowRoot, '.team', 'legacy-only'), { recursive: true });

    const locations = listTeamWorkLocations(workflowRoot);
    expect(locations.filter((location) => location.id === 'run-duplicate')).toHaveLength(2);
    expect(locations.some((location) => location.id === 'legacy-only' && location.scope === 'legacy')).toBe(true);
    expect(() => findExactTeamWorkLocation('run-duplicate', workflowRoot)).toThrow(/Ambiguous/);
  });

  it('reconciles Run, sidecar, task, message, and legacy activity evidence', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-lifecycle-adapter-'));
    roots.push(projectRoot);
    const workflowRoot = join(projectRoot, '.workflow');
    const location = createRunState(workflowRoot, 'session-a', 'run-a', 'sealed', {
      status: 'active',
      updated_at: '2026-07-17T08:00:00.000Z',
      active_workers: ['persisted-only'],
    });
    writeFileSync(join(location.stateDir, '.msg', 'meta.json'), JSON.stringify({
      status: 'active',
      updated_at: '2026-07-17T08:00:00.000Z',
    }));

    const classification = readStoredTeamSessionClassificationAt(
      { stateDir: location.stateDir, runRootDir: location.rootDir },
      {
        now: '2026-07-17T12:00:00.000Z',
        staleTtlMs: 60 * 60 * 1_000,
        liveBrokerMembers: 0,
        livenessKnown: true,
      },
    );

    expect(classification).toMatchObject({
      lifecycle: 'completed',
      health: 'inconsistent',
      live: false,
      cleanupEligible: false,
    });
    expect(classification.reasons).toContain('persisted active workers are not live evidence');
  });
});
