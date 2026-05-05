import { watch, type FSWatcher as ChokidarWatcher } from 'chokidar';

import type { StateManager } from './state-manager.js';
import type { DashboardEventBus } from './event-bus.js';
import { SSE_EVENT_TYPES } from '../../shared/constants.js';

// ---------------------------------------------------------------------------
// FSWatcher — chokidar-based file watcher for .workflow/ directory
// ---------------------------------------------------------------------------

const REBUILD_DELAY_MS = 5_000;

export class FSWatcher {
  private watcher: ChokidarWatcher | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-file debounce timers keyed by absolute path */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly workflowRoot: string,
    private readonly stateManager: StateManager,
    private readonly eventBus: DashboardEventBus,
    private readonly debounceMs: number = 150,
  ) {}

  /** Start watching .workflow/ for relevant file changes */
  start(): void {
    if (this.watcher) return;

    const patterns = [
      `${this.workflowRoot}/state.json`,
      `${this.workflowRoot}/phases/*/index.json`,
      `${this.workflowRoot}/phases/*/.task/TASK-*.json`,
      `${this.workflowRoot}/phases/*/verification.json`,
      `${this.workflowRoot}/phases/*/validation.json`,
      `${this.workflowRoot}/phases/*/review.json`,
      `${this.workflowRoot}/phases/*/plan.json`,
      `${this.workflowRoot}/phases/*/uat.md`,
      `${this.workflowRoot}/scratch/*/index.json`,
      // Wiki index sources — unified /api/wiki endpoint
      `${this.workflowRoot}/project.md`,
      `${this.workflowRoot}/roadmap.md`,
      `${this.workflowRoot}/specs/*.md`,
      `${this.workflowRoot}/phases/*/*.md`,
      `${this.workflowRoot}/memory/*.md`,
      `${this.workflowRoot}/issues/*.jsonl`,
      `${this.workflowRoot}/learning/*.jsonl`,
      // Collab — member profiles and activity log
      `${this.workflowRoot}/collab/members/*.json`,
      `${this.workflowRoot}/collab/activity.jsonl`,
      // CSV Wave — async delegate task execution tracking
      `${this.workflowRoot}/.csv-wave/**/*.csv`,
    ];

    this.watcher = watch(patterns, {
      ignoreInitial: true,
      persistent: true,
      // Use polling on Windows as fallback for reliability
      usePolling: process.platform === 'win32',
      interval: 200,
    });

    this.watcher.on('add', (path) => this.handleChange(path));
    this.watcher.on('change', (path) => this.handleChange(path));
    this.watcher.on('unlink', (path) => this.handleChange(path));

    this.watcher.on('error', (error) => {
      console.error('FSWatcher error:', error);
      this.eventBus.emit(SSE_EVENT_TYPES.WATCHER_ERROR, String(error));
      this.scheduleFullRebuild();
    });
  }

  /** Stop watching and clean up */
  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handleChange(filePath: string): void {
    // Per-file debounce: reset timer on each event for the same file
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      if (isWikiPath(filePath)) {
        this.eventBus.emit('wiki:invalidated', { at: Date.now(), path: filePath });
      }
      this.stateManager.applyFileChange(filePath).catch((err: unknown) => {
        console.error(`Failed to apply file change for ${filePath}:`, err);
        this.scheduleFullRebuild();
      });
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  // ---- Wiki-path detection -------------------------------------------------

  // Helper used inside debounced callback — see isWikiPath below.

  private scheduleFullRebuild(): void {
    // Avoid stacking rebuild timers
    if (this.rebuildTimer) return;

    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.stateManager.buildInitialState().catch((err: unknown) => {
        console.error('Full state rebuild failed:', err);
      });
    }, REBUILD_DELAY_MS);
  }
}

/**
 * Detect whether a changed file should invalidate the wiki index.
 * Covers project/roadmap root markdowns, specs, phase markdowns, memory,
 * and JSONL sources under issues/ and learning/.
 */
function isWikiPath(absPath: string): boolean {
  const p = absPath.replace(/\\/g, '/');
  if (p.endsWith('/project.md') || p.endsWith('/roadmap.md')) return true;
  if (/\/specs\/[^/]+\.md$/.test(p)) return true;
  if (/\/phases\/[^/]+\/[^/]+\.md$/.test(p)) return true;
  if (/\/memory\/[^/]+\.md$/.test(p)) return true;
  if (/\/issues\/[^/]+\.jsonl$/.test(p)) return true;
  if (/\/learning\/[^/]+\.jsonl$/.test(p)) return true;
  return false;
}
