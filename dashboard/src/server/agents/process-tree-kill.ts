// ---------------------------------------------------------------------------
// killProcessTree — cross-platform process-tree termination
// ---------------------------------------------------------------------------

/**
 * Terminates a process AND its entire descendant tree.
 *
 * Why this exists: adapters spawn CLIs via `shell: true` (cmd.exe wrapper) or
 * `npx`, so the real CLI is a grandchild. `child.kill()` only signals the
 * immediate child — on Windows it never reaches the grandchildren, leaking
 * orphaned `node`/CLI/MCP processes. This walks the whole tree:
 *
 * - Windows: `taskkill /PID <pid> /T` (recursively kill children).
 *   SIGKILL adds `/F` (force). Console apps can't be gracefully signalled on
 *   Windows, so SIGTERM is a best-effort polite taskkill, SIGKILL is forced.
 * - POSIX: `process.kill(-pid, signal)` signals the whole process group
 *   (requires the child spawned with `detached: true`). Falls back to a
 *   single-process kill if the group kill fails.
 *
 * Termination is always best-effort: every path is guarded so a failure here
 * never breaks adapter teardown.
 */
import { spawn } from 'node:child_process';

export function killProcessTree(
  pid: number | undefined,
  signal: 'SIGTERM' | 'SIGKILL',
): void {
  if (!pid || pid <= 0) return;

  if (process.platform === 'win32') {
    try {
      const args = ['/PID', String(pid), '/T'];
      if (signal === 'SIGKILL') args.push('/F');
      const killer = spawn('taskkill', args, {
        windowsHide: true,
        stdio: 'ignore',
      });
      // Detach so a slow taskkill never holds the event loop / parent open.
      killer.on('error', () => { /* taskkill missing — best-effort */ });
      killer.unref();
    } catch {
      // Last-resort single-process signal.
      try { process.kill(pid, signal); } catch { /* already gone */ }
    }
    return;
  }

  // POSIX: kill the process group (negative pid). Requires detached spawn.
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}
