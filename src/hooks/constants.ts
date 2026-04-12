// Shared constants for maestro hooks

/** Remaining context % at which WARNING is emitted */
export const WARNING_THRESHOLD = 35;

/** Remaining context % at which CRITICAL is emitted */
export const CRITICAL_THRESHOLD = 25;

/** Ignore bridge metrics older than this (seconds) */
export const STALE_SECONDS = 60;

/** Minimum tool uses between repeated warnings */
export const DEBOUNCE_CALLS = 5;

/** Claude Code reserves ~16.5% for autocompact buffer */
export const AUTO_COMPACT_BUFFER_PCT = 16.5;

/** Bridge file prefix in os.tmpdir() */
export const BRIDGE_PREFIX = 'maestro-ctx-';

/** Delegate notification file prefix in os.tmpdir() */
export const NOTIFY_PREFIX = 'maestro-notify-';

/** Coordinator tracker bridge file prefix in os.tmpdir() */
export const COORD_BRIDGE_PREFIX = 'maestro-coord-';

/** Max ms to wait for stdin before exiting (Windows pipe safety) */
export const STDIN_TIMEOUT_MS = 3000;

/**
 * ASCII faces by severity level.
 *
 *   ^_^  — plenty of context (used < 50%)
 *   -_-  — getting used      (used 50–65%)
 *   O_O  — running low       (used 65–80%)
 *   X_X  — critical          (used >= 80%)
 */
export const FACES = {
  happy:    '^_^',
  neutral:  '-_-',
  alert:    'O_O',
  critical: 'X_X',
} as const;

export type FaceLevel = keyof typeof FACES;

/** Map used% to face level */
export function getFaceLevel(usedPct: number): FaceLevel {
  if (usedPct < 50) return 'happy';
  if (usedPct < 65) return 'neutral';
  if (usedPct < 80) return 'alert';
  return 'critical';
}

/** ANSI color codes by face level */
export const FACE_COLORS: Record<FaceLevel, string> = {
  happy:    '\x1b[32m',       // green
  neutral:  '\x1b[33m',       // yellow
  alert:    '\x1b[38;5;208m', // orange
  critical: '\x1b[5;31m',     // blinking red
};

export const ANSI_RESET = '\x1b[0m';
export const ANSI_DIM = '\x1b[2m';
export const ANSI_BOLD = '\x1b[1m';
export const ANSI_CYAN = '\x1b[36m';
