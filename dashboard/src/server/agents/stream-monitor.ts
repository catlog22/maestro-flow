// ---------------------------------------------------------------------------
// StreamMonitor — heartbeat-based stale connection detection (AionUi pattern)
// ---------------------------------------------------------------------------

/**
 * Monitors stream activity and fires a callback when no activity is detected
 * for longer than `maxSilenceMs`. Prevents zombie processes from hanging
 * indefinitely when the CLI child process stops producing output.
 *
 * Default silence window is 10 minutes: long write-mode tasks (large builds,
 * test suites) can legitimately produce no stdout for minutes. Callers may
 * override via the constructor (threaded from `--timeout` / cli-tools.json).
 */
/** Default stale-stream silence window (10 min) — single source of truth. */
export const DEFAULT_STREAM_TIMEOUT_MS = 600_000;

export class StreamMonitor {
  private lastActivity = Date.now();
  private readonly maxSilence: number;
  private timer: ReturnType<typeof setInterval>;
  private fired = false;

  constructor(
    private readonly onStale: () => void,
    maxSilenceMs = DEFAULT_STREAM_TIMEOUT_MS,
    checkIntervalMs = 10_000,
  ) {
    this.maxSilence = maxSilenceMs;
    this.timer = setInterval(() => {
      if (!this.fired && Date.now() - this.lastActivity > this.maxSilence) {
        this.fired = true;
        this.onStale();
      }
    }, checkIntervalMs);
  }

  /** Call on every stream activity (line received, entry emitted, etc.) */
  heartbeat(): void {
    this.lastActivity = Date.now();
    this.fired = false;
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
