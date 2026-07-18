import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTeamRoutes } from './teams.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('team routes Run storage', () => {
  it('discovers team state and outputs under a canonical Run', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-routes-'));
    roots.push(projectRoot);
    const workflowRoot = join(projectRoot, '.workflow');
    const runId = '20260717-001-team-testing';
    const runDir = join(workflowRoot, 'sessions', 'session-a', 'runs', runId);
    const teamDir = join(runDir, 'work', 'team');
    mkdirSync(join(teamDir, '.msg'), { recursive: true });
    mkdirSync(join(runDir, 'outputs'), { recursive: true });
    writeFileSync(join(teamDir, 'team-session.json'), JSON.stringify({
      team_name: 'testing',
      task_description: 'Run-scoped team',
      roles: ['coordinator', 'executor'],
    }));
    writeFileSync(join(teamDir, '.msg', 'meta.json'), JSON.stringify({
      status: 'active',
      created_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T00:01:00.000Z',
    }));
    writeFileSync(join(teamDir, '.msg', 'messages.jsonl'), `${JSON.stringify({
      id: 'MSG-001', from: 'executor', to: 'coordinator', type: 'task_complete', summary: 'done',
    })}\n`);
    writeFileSync(join(runDir, 'outputs', 'test-report.md'), '# Test report\n');

    const app = createTeamRoutes(workflowRoot);
    const listResponse = await app.request('/api/teams/sessions');
    expect(listResponse.status).toBe(200);
    const sessions = await listResponse.json() as Array<{ sessionId: string; messageCount: number }>;
    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: runId, messageCount: 1 }),
    ]));

    const detailResponse = await app.request(`/api/teams/sessions/${runId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as { files: Array<{ path: string }> };
    expect(detail.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'outputs/test-report.md' }),
      expect.objectContaining({ path: 'work/team/team-session.json' }),
    ]));

    const fileResponse = await app.request(`/api/teams/sessions/${runId}/files/outputs/test-report.md`);
    expect(fileResponse.status).toBe(200);
    expect(await fileResponse.text()).toBe('# Test report\n');
  });
});
