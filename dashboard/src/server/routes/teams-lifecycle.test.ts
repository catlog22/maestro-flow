import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTeamRoutes } from './teams.js';

const NOW = '2026-07-17T12:00:00.000Z';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFixture(
  runId: string,
  options: { runStatus?: string; teamStatus?: string; updatedAt?: string } = {},
) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'team-route-lifecycle-'));
  roots.push(projectRoot);
  const workflowRoot = join(projectRoot, '.workflow');
  const runDir = join(workflowRoot, 'sessions', `session-${runId}`, 'runs', runId);
  const teamDir = join(runDir, 'work', 'team');
  mkdirSync(join(teamDir, '.msg'), { recursive: true });
  mkdirSync(join(runDir, 'outputs'), { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    run_id: runId,
    status: options.runStatus ?? 'running',
  }));
  writeFileSync(join(runDir, 'outputs', 'result.md'), '# preserved\n');
  writeFileSync(join(teamDir, 'team-session.json'), JSON.stringify({
    status: options.teamStatus ?? 'active',
    updated_at: options.updatedAt ?? '2026-07-17T08:00:00.000Z',
  }));
  writeFileSync(join(teamDir, '.msg', 'meta.json'), JSON.stringify({
    status: options.teamStatus ?? 'active',
    created_at: '2026-07-17T07:00:00.000Z',
    updated_at: options.updatedAt ?? '2026-07-17T08:00:00.000Z',
  }));
  return { workflowRoot, runDir, teamDir };
}

function createApp(workflowRoot: string, live = 0) {
  return createTeamRoutes(workflowRoot, {
    now: () => NOW,
    staleTtlMs: 60 * 60 * 1_000,
    inspectLiveBrokerMembers: () => ({ count: live, known: true }),
  });
}

describe('team lifecycle route safety', () => {
  it('never cleans stale_candidate, including confirmed force requests', async () => {
    const fixture = createFixture('run-stale');
    const app = createApp(fixture.workflowRoot);

    const dryRun = await app.request('/api/teams/sessions/run-stale', { method: 'DELETE' });
    expect(dryRun.status).toBe(200);
    expect(await dryRun.json()).toMatchObject({
      dryRun: true,
      eligible: false,
      classification: { lifecycle: 'active', health: 'stale_candidate' },
    });

    const forced = await app.request('/api/teams/sessions/run-stale?confirm=true&force=true', { method: 'DELETE' });
    expect(forced.status).toBe(409);
    expect(existsSync(fixture.teamDir)).toBe(true);
  });

  it('requires audited abandon and a separate confirmed cleanup while preserving Run authority', async () => {
    const fixture = createFixture('run-abandon');
    const app = createApp(fixture.workflowRoot);

    const abandonDryRun = await app.request('/api/teams/sessions/run-abandon/abandon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(await abandonDryRun.json()).toMatchObject({ dryRun: true, eligible: true });

    const abandoned = await app.request('/api/teams/sessions/run-abandon/abandon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, actor: 'operator', reason: 'verified stale work' }),
    });
    expect(abandoned.status).toBe(200);
    expect(await abandoned.json()).toMatchObject({
      transition: 'abandoned',
      cleanupPerformed: false,
      classification: { lifecycle: 'abandoned', cleanupEligible: true },
    });
    expect(existsSync(fixture.teamDir)).toBe(true);

    const cleanupDryRun = await app.request('/api/teams/sessions/run-abandon', { method: 'DELETE' });
    expect(await cleanupDryRun.json()).toMatchObject({ dryRun: true, eligible: true });
    expect(existsSync(fixture.teamDir)).toBe(true);

    const cleaned = await app.request('/api/teams/sessions/run-abandon?confirm=true', { method: 'DELETE' });
    expect(cleaned.status).toBe(200);
    expect(existsSync(fixture.teamDir)).toBe(false);
    expect(existsSync(join(fixture.runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(fixture.runDir, 'outputs', 'result.md'))).toBe(true);
  });

  it('cleans completed team state only after confirmation and preserves completed Run outputs', async () => {
    const fixture = createFixture('run-completed', {
      runStatus: 'completed',
      teamStatus: 'completed',
    });
    const app = createApp(fixture.workflowRoot);

    const cleaned = await app.request('/api/teams/sessions/run-completed?confirm=true', { method: 'DELETE' });
    expect(cleaned.status).toBe(200);
    expect(await cleaned.json()).toMatchObject({ ok: true, preservedRunRoot: true });
    expect(existsSync(fixture.teamDir)).toBe(false);
    expect(existsSync(join(fixture.runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(fixture.runDir, 'outputs', 'result.md'))).toBe(true);
  });

  it('refuses abandon when a live broker member or non-terminal task exists', async () => {
    const liveFixture = createFixture('run-live');
    const liveApp = createApp(liveFixture.workflowRoot, 1);
    const liveResponse = await liveApp.request('/api/teams/sessions/run-live/abandon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, actor: 'operator', reason: 'should fail' }),
    });
    expect(liveResponse.status).toBe(409);

    const taskFixture = createFixture('run-task');
    mkdirSync(join(taskFixture.teamDir, 'tasks'), { recursive: true });
    writeFileSync(join(taskFixture.teamDir, 'tasks', 'ATASK-001.json'), JSON.stringify({
      session_id: 'run-task',
      id: 'ATASK-001',
      title: 'pending work',
      description: '',
      status: 'in_progress',
      priority: 'medium',
      reporter: 'worker',
      check_log: [],
      created_at: '2026-07-17T08:00:00.000Z',
      updated_at: '2026-07-17T08:00:00.000Z',
      updated_by: 'worker',
    }));
    const taskApp = createApp(taskFixture.workflowRoot);
    const taskResponse = await taskApp.request('/api/teams/sessions/run-task/abandon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, actor: 'operator', reason: 'should fail' }),
    });
    expect(taskResponse.status).toBe(409);
  });

  it('returns a ranking without implicit locator-less selection and honors exact Run ID', async () => {
    const first = createFixture('run-a', { updatedAt: '2026-07-17T11:30:00.000Z' });
    const second = createFixture('run-b', { updatedAt: '2026-07-17T11:45:00.000Z' });
    const workflowRoot = first.workflowRoot;

    // Move the second Run into the same workflow tree for enumeration.
    const target = join(workflowRoot, 'sessions', 'session-run-b', 'runs', 'run-b');
    mkdirSync(join(target, '..'), { recursive: true });
    const secondRun = second.runDir;
    const { cpSync } = await import('node:fs');
    cpSync(secondRun, target, { recursive: true });

    const app = createApp(workflowRoot);
    const manual = await app.request('/api/teams/resume-candidates');
    expect(await manual.json()).toMatchObject({ selected: null, requiresUserSelection: true, reason: 'manual_selection' });

    const exact = await app.request('/api/teams/resume-candidates?run_id=run-a');
    const exactBody = await exact.json() as { selected: { runId: string } | null; candidates: Array<{ runId?: string }> };
    expect(exactBody.selected?.runId).toBe('run-a');
    expect(exactBody.candidates[0].runId).toBe('run-a');
  });
});
