import { relative } from 'node:path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { watchDisabledReason } from './watch-policy.js';

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.py', '.go', '.java', '.rs',
]);

const ALWAYS_IGNORE = ['.workflow', '.git', 'node_modules', 'dist', '.codegraph'];

export interface WatchOptions {
  debounceMs?: number;
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;
  onSyncError?: (error: Error) => void;
}

export interface PendingFile {
  path: string;
  firstSeenMs: number;
  lastSeenMs: number;
  indexing: boolean;
}

export class LockUnavailableError extends Error {
  constructor(message = 'File lock unavailable; another process is writing') {
    super(message);
    this.name = 'LockUnavailableError';
  }
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles = new Map<string, { firstSeenMs: number; lastSeenMs: number }>();
  private syncStartedMs = 0;
  private syncing = false;
  private stopped = false;
  private chokidarReady = false;

  private readonly projectRoot: string;
  private readonly debounceMs: number;
  private readonly syncFn: () => Promise<{ filesChanged: number; durationMs: number }>;
  private readonly onSyncComplete?: WatchOptions['onSyncComplete'];
  private readonly onSyncError?: WatchOptions['onSyncError'];

  constructor(
    projectRoot: string,
    syncFn: () => Promise<{ filesChanged: number; durationMs: number }>,
    options: WatchOptions = {},
  ) {
    this.projectRoot = projectRoot;
    this.syncFn = syncFn;
    this.debounceMs = options.debounceMs ?? 2000;
    this.onSyncComplete = options.onSyncComplete;
    this.onSyncError = options.onSyncError;
  }

  start(): boolean {
    if (this.watcher) return true;
    this.stopped = false;

    const disabledReason = watchDisabledReason(this.projectRoot);
    if (disabledReason) return false;

    try {
      this.watcher = watch(this.projectRoot, {
        ignored: (testPath: string) => this.shouldIgnore(testPath),
        ignoreInitial: true,
        persistent: true,
      });

      this.watcher.on('ready', () => {
        this.chokidarReady = true;
        this.pendingFiles.clear();
      });

      this.watcher.on('all', (_event: string, filePath: string) => {
        if (this.stopped) return;
        const normalized = relative(this.projectRoot, filePath).replace(/\\/g, '/');
        if (!this.isSourceFile(normalized)) return;

        if (this.chokidarReady) {
          const now = Date.now();
          const existing = this.pendingFiles.get(normalized);
          this.pendingFiles.set(normalized, {
            firstSeenMs: existing?.firstSeenMs ?? now,
            lastSeenMs: now,
          });
        }
        this.scheduleSync();
      });

      this.watcher.on('error', () => {});
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.pendingFiles.clear();
    this.chokidarReady = false;
  }

  isActive(): boolean {
    return this.watcher !== null && !this.stopped;
  }

  getPendingFiles(): PendingFile[] {
    const result: PendingFile[] = [];
    for (const [filePath, info] of this.pendingFiles) {
      result.push({
        path: filePath,
        firstSeenMs: info.firstSeenMs,
        lastSeenMs: info.lastSeenMs,
        indexing: this.syncing && this.syncStartedMs >= info.lastSeenMs,
      });
    }
    return result;
  }

  private shouldIgnore(testPath: string): boolean {
    const rel = relative(this.projectRoot, testPath).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel.startsWith('..')) return false;
    for (const ignored of ALWAYS_IGNORE) {
      if (rel === ignored || rel.startsWith(ignored + '/')) return true;
    }
    return false;
  }

  private isSourceFile(relPath: string): boolean {
    const dotIdx = relPath.lastIndexOf('.');
    if (dotIdx === -1) return false;
    return SOURCE_EXTS.has(relPath.slice(dotIdx));
  }

  private scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.syncing || this.stopped) return;
    this.syncStartedMs = Date.now();
    this.syncing = true;

    try {
      const result = await this.syncFn();
      for (const [filePath, info] of this.pendingFiles) {
        if (info.lastSeenMs <= this.syncStartedMs) this.pendingFiles.delete(filePath);
      }
      this.onSyncComplete?.(result);
    } catch (err) {
      if (!(err instanceof LockUnavailableError)) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.onSyncError?.(error);
      }
    } finally {
      this.syncing = false;
      if (this.pendingFiles.size > 0 && !this.stopped) this.scheduleSync();
    }
  }
}
