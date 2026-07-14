import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

interface LockRecord {
  token: string;
  pid: number;
  createdAt: number;
}

export interface FileLockOptions {
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

/** Crash-safe cross-process lock for MaestroGraph write operations. */
export class FileLock {
  constructor(
    private readonly lockPath: string,
    private readonly options: FileLockOptions = {},
  ) {}

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    const retryMs = this.options.retryMs ?? 100;
    const staleMs = this.options.staleMs ?? 10 * 60_000;
    const startedAt = Date.now();
    const record: LockRecord = {
      token: randomUUID(),
      pid: process.pid,
      createdAt: Date.now(),
    };

    mkdirSync(dirname(this.lockPath), { recursive: true });
    while (!this.tryAcquire(record)) {
      this.removeStaleLock(staleMs);
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out acquiring MaestroGraph lock: ${this.lockPath}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryMs));
    }

    try {
      return await fn();
    } finally {
      this.release(record.token);
    }
  }

  private tryAcquire(record: LockRecord): boolean {
    try {
      const fd = openSync(this.lockPath, 'wx');
      try {
        writeFileSync(fd, JSON.stringify(record), 'utf8');
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  private removeStaleLock(staleMs: number): void {
    if (!existsSync(this.lockPath)) return;
    try {
      const raw = readFileSync(this.lockPath, 'utf8');
      const record = JSON.parse(raw) as Partial<LockRecord>;
      const ageMs = Date.now() - (record.createdAt ?? statSync(this.lockPath).mtimeMs);
      if (ageMs < staleMs || this.isProcessAlive(record.pid)) return;
      unlinkSync(this.lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private isProcessAlive(pid: number | undefined): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private release(token: string): void {
    try {
      const record = JSON.parse(readFileSync(this.lockPath, 'utf8')) as Partial<LockRecord>;
      if (record.token === token) unlinkSync(this.lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        process.stderr.write(`[MaestroGraph] Failed to release lock ${this.lockPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }
}
