import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  open: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn,
}));
vi.mock('../../graph/kg/engine.js', () => ({ MaestroGraph: { open: mocks.open } }));
vi.mock('../hook-logger.js', () => ({ logHookError: vi.fn(), logHookWarn: vi.fn() }));

import { evaluateKgSync } from '../kg-sync-hook.js';

describe('KG sync worker entry', () => {
  let project: string;
  let originalArgv: string[];
  const sessionId = 'worker-entry-regression';

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'maestro-kg-worker-entry-')));
    mkdirSync(join(project, '.workflow', 'kg'), { recursive: true });
    writeFileSync(join(project, '.workflow', 'kg', 'maestro.db'), 'fixture');
    originalArgv = process.argv;
    vi.stubEnv('MAESTRO_KG_SYNC_WORKER', undefined);
    vi.stubEnv('MAESTRO_KG_SYNC_WORKER_TOKEN', undefined);
    vi.clearAllMocks();
    mocks.spawn.mockReturnValue({
      pid: process.pid,
      stdin: { end: vi.fn() },
      unref: vi.fn(),
    });
    mocks.open.mockRejectedValue(new Error('inline worker fixture'));
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    rmSync(project, { recursive: true, force: true });
  });

  async function expectDelegated(entry: string): Promise<void> {
    process.argv = [process.execPath, entry, 'hooks', 'run', 'kg-sync'];
    expect(await evaluateKgSync(project, sessionId)).toMatchObject({ reason: 'delegated' });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [realpathSync(entry), 'hooks', 'run', 'kg-sync'],
      expect.objectContaining({ cwd: project, detached: true, stdio: ['pipe', 'ignore', 'ignore'] }),
    );
  }

  it.runIf(process.platform !== 'win32')('delegates an extensionless npm symlink instead of syncing inline', async () => {
    const entry = join(project, 'maestro.js');
    const link = join(project, 'maestro');
    writeFileSync(entry, '// CLI fixture\n');
    symlinkSync(entry, link);
    await expectDelegated(link);
  });

  it.each(['js', 'mjs', 'cjs'])('keeps direct .%s entries delegated', async (extension) => {
    const entry = join(project, `maestro.${extension}`);
    writeFileSync(entry, '// CLI fixture\n');
    await expectDelegated(entry);
  });

  it.each(['missing', 'unsupported', 'absent'])('uses inline fallback when the entry is %s', async (kind) => {
    const entry = join(project, kind === 'unsupported' ? 'maestro.ts' : 'missing.js');
    if (kind === 'unsupported') writeFileSync(entry, '// source fixture\n');
    process.argv = kind === 'absent' ? [process.execPath] : [process.execPath, entry];

    expect(await evaluateKgSync(project, sessionId)).toMatchObject({ reason: 'sync-error' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledOnce();
  });
});
