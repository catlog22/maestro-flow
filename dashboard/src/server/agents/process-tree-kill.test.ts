import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { killProcessTree } from './process-tree-kill.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const realPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function fakeKiller() {
  return { on: vi.fn(), unref: vi.fn() };
}

describe('killProcessTree', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeKiller());
  });

  afterEach(() => {
    setPlatform(realPlatform);
    vi.restoreAllMocks();
  });

  it('no-ops on undefined or non-positive pid', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    killProcessTree(undefined, 'SIGTERM');
    killProcessTree(0, 'SIGKILL');
    killProcessTree(-5, 'SIGTERM');
    expect(spawnMock).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  describe('Windows', () => {
    beforeEach(() => setPlatform('win32'));

    it('SIGTERM → taskkill /PID <pid> /T (no /F)', () => {
      killProcessTree(12345, 'SIGTERM');
      expect(spawnMock).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '12345', '/T'],
        expect.objectContaining({ windowsHide: true, stdio: 'ignore' }),
      );
    });

    it('SIGKILL → taskkill /PID <pid> /T /F', () => {
      killProcessTree(12345, 'SIGKILL');
      expect(spawnMock).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '12345', '/T', '/F'],
        expect.any(Object),
      );
    });

    it('falls back to process.kill when taskkill spawn throws', () => {
      spawnMock.mockImplementation(() => { throw new Error('ENOENT'); });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      killProcessTree(777, 'SIGKILL');
      expect(killSpy).toHaveBeenCalledWith(777, 'SIGKILL');
    });
  });

  describe('POSIX', () => {
    beforeEach(() => setPlatform('linux'));

    it('signals the process group (negative pid)', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      killProcessTree(4321, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('falls back to single-process kill when group kill fails', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
        if (pid < 0) throw new Error('ESRCH');
        return true;
      });
      killProcessTree(4321, 'SIGKILL');
      expect(killSpy).toHaveBeenNthCalledWith(1, -4321, 'SIGKILL');
      expect(killSpy).toHaveBeenNthCalledWith(2, 4321, 'SIGKILL');
    });

    it('swallows errors when the process is already gone', () => {
      vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
      expect(() => killProcessTree(4321, 'SIGTERM')).not.toThrow();
    });
  });
});
