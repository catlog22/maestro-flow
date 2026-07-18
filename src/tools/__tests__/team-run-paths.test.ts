import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRun } from '../../run/runtime.js';
import { handler as teamMsgHandler } from '../team-msg.js';
import { resolveTeamWorkPath } from '../team-run-paths.js';

const roots: string[] = [];
let previousProjectRoot: string | undefined;

afterEach(() => {
  if (previousProjectRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
  else process.env.MAESTRO_PROJECT_ROOT = previousProjectRoot;
  previousProjectRoot = undefined;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('team Run path resolver', () => {
  it('binds a canonical Run ID to run_dir/work/team', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-run-paths-'));
    roots.push(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'team-test',
      intent: 'team path resolver',
    });

    expect(resolveTeamWorkPath(created.run_id, projectRoot)).toEqual({
      dir: join(resolve(projectRoot, created.run_dir), 'work', 'team'),
      scope: 'run',
      runId: created.run_id,
      sessionId: created.session_id,
    });
  });

  it('keeps unknown legacy team session IDs readable', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-run-paths-'));
    roots.push(projectRoot);

    expect(resolveTeamWorkPath('legacy-team', projectRoot)).toEqual({
      dir: join(projectRoot, '.workflow', '.team', 'legacy-team'),
      scope: 'legacy',
    });
  });

  it('persists team messages under the Run work directory', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-run-paths-'));
    roots.push(projectRoot);
    previousProjectRoot = process.env.MAESTRO_PROJECT_ROOT;
    process.env.MAESTRO_PROJECT_ROOT = projectRoot;
    const created = createRun({
      projectRoot,
      command: 'team-test',
      intent: 'team message Run storage',
    });

    const result = await teamMsgHandler({
      operation: 'log',
      session_id: created.run_id,
      from: 'worker',
      to: 'coordinator',
      summary: 'stored in Run',
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(resolve(projectRoot, created.run_dir), 'work', 'team', '.msg', 'messages.jsonl'))).toBe(true);
    expect(existsSync(join(projectRoot, '.workflow', '.team', created.run_id))).toBe(false);
  });

  it('rejects path traversal before resolving a fallback', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'team-run-paths-'));
    roots.push(projectRoot);

    expect(() => resolveTeamWorkPath('../escape', projectRoot)).toThrow();
  });
});
