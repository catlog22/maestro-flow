// Shared constants for maestro hooks

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Read nerdFont preference from config. Default: true (Nerd Font enabled) */
function readNerdFontConfig(): boolean {
  // Env override takes priority
  if (process.env.MAESTRO_NERD_FONT === '0') return false;
  if (process.env.MAESTRO_NERD_FONT === '1') return true;

  // Config file
  try {
    const configPath = join(
      process.env.MAESTRO_HOME || join(homedir(), '.maestro'),
      'config.json',
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (cfg.statusline?.nerdFont === true) return true;
      if (cfg.statusline?.nerdFont === false) return false;
    }
  } catch { /* ignore */ }

  return false; // default: Unicode (safe for all environments)
}

const _nerdFont = readNerdFontConfig();

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

/** Spec keyword injection dedup bridge file prefix in os.tmpdir() */
export const SPEC_KW_BRIDGE_PREFIX = 'maestro-spec-kw-';

/** Max ms to wait for stdin before exiting (Windows pipe safety) */
export const STDIN_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Statusline icons — Nerd Font (default) with Unicode fallback
// ---------------------------------------------------------------------------

const ICONS_NERD = {
  model:     '\uF0E7',     //  nf-fa-bolt
  milestone: '\uF11E',     //  nf-fa-flag_checkered
  phase:     '\u25C6',     // ◆ BLACK DIAMOND
  coord:     '\u{F044C}',  // 󰑌 nf-md-check_circle_outline
  task:      '\uEACB',     //  nf-cod-terminal_cmd
  team:      '\u{F0849}',  // 󰡉 nf-md-account_group
  dir:       '\uEA83',     //  nf-cod-folder
  git:       '\uE725',     //  nf-dev-git_branch
  ctx:       '\uF201',     //  nf-fa-line_chart
} as const;

const ICONS_UNICODE = {
  model:     '\u270E',    // ✎ pencil
  milestone: '\u2691',    // ⚑ flag
  phase:     '\u25C6',    // ◆ diamond
  coord:     '\u2699',    // ⚙ gear
  task:      '\u25B8',    // ▸ triangle
  team:      '\u{1F465}', // 👥 people
  dir:       '\u25A0',    // ■ square
  git:       '\u2387',    // ⎇ branch (alternative key symbol)
  ctx:       '\u25D4',    // ◔ circle with quarter
} as const;

export const ICONS = _nerdFont ? ICONS_NERD : ICONS_UNICODE;

/** Git status icons */
export const GIT_ICONS = {
  clean:    '✓',
  dirty:    '△',
  conflict: '⚠',
  ahead:    '↑',
  behind:   '↓',
} as const;

// ---------------------------------------------------------------------------
// Context thresholds for statusline bar color
// ---------------------------------------------------------------------------

export type CtxLevel = 'ok' | 'warn' | 'alert' | 'crit';

export function getCtxLevel(usedPct: number): CtxLevel {
  if (usedPct < 50) return 'ok';
  if (usedPct < 65) return 'warn';
  if (usedPct < 80) return 'alert';
  return 'crit';
}

// ---------------------------------------------------------------------------
// ANSI helpers (true-color / 24-bit)
// ---------------------------------------------------------------------------

export function ansiBg(rgb: readonly [number, number, number]): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export function ansiFg(rgb: readonly [number, number, number]): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export const ANSI_RESET = '\x1b[0m';
export const ANSI_DIM = '\x1b[2m';
export const ANSI_BOLD = '\x1b[1m';
export const ANSI_CYAN = '\x1b[36m';
export const ANSI_BLINK = '\x1b[5m';

// ---------------------------------------------------------------------------
// Segment colors — colored text on transparent background
// ---------------------------------------------------------------------------

/** Segment accent colors — used as foreground on transparent background */
export const TEXT_COLORS = {
  model:     [86, 182, 194]  as const,   // cyan
  milestone: [224, 175, 104] as const,   // warm gold
  phase:     [166, 209, 137] as const,   // soft green
  coord:     [137, 180, 250] as const,   // light blue
  task:      [205, 214, 244] as const,   // white-ish
  team:      [203, 166, 247] as const,   // lavender
  dir:       [249, 226, 175] as const,   // yellow
  git:       [166, 227, 161] as const,   // green
  ctxOk:     [166, 227, 161] as const,   // green
  ctxWarn:   [249, 226, 175] as const,   // yellow
  ctxAlert:  [250, 179, 135] as const,   // peach
  ctxCrit:   [243, 139, 168] as const,   // red/pink
  separator: [88, 91, 112]   as const,   // dim gray for |
} as const;

// Legacy face exports (kept for context-monitor compatibility)
export const FACES = {
  happy:    '^_^',
  neutral:  '-_-',
  alert:    'O_O',
  critical: 'X_X',
} as const;

export type FaceLevel = keyof typeof FACES;

export function getFaceLevel(usedPct: number): FaceLevel {
  if (usedPct < 50) return 'happy';
  if (usedPct < 65) return 'neutral';
  if (usedPct < 80) return 'alert';
  return 'critical';
}

export const FACE_COLORS: Record<FaceLevel, string> = {
  happy:    '\x1b[32m',
  neutral:  '\x1b[33m',
  alert:    '\x1b[38;5;208m',
  critical: '\x1b[5;31m',
};
