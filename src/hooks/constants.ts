// Shared constants for maestro hooks

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Read statusline config from maestro config file.
 * Falls back to env vars, then defaults.
 */
function readStatuslineConfig(): { style: 'powerline' | 'text'; nerdFont: boolean } {
  // 1. Try maestro config file
  try {
    const configPath = join(
      process.env.MAESTRO_HOME || join(homedir(), '.maestro'),
      'config.json',
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (cfg.statusline) {
        return {
          style: cfg.statusline.style === 'powerline' ? 'powerline' : 'text',
          nerdFont: cfg.statusline.nerdFont === true,
        };
      }
    }
  } catch { /* ignore */ }

  // 2. Fall back to env vars
  const envStyle = process.env.MAESTRO_STATUSLINE_STYLE?.toLowerCase();
  const style = (envStyle === 'powerline' || envStyle === 'pl') ? 'powerline' : 'text';
  const nerdFont = process.env.MAESTRO_NERD_FONT === '1';
  return { style, nerdFont };
}

const _slConfig = readStatuslineConfig();

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

// ---------------------------------------------------------------------------
// Powerline statusline — Notion-inspired muted palette
// ---------------------------------------------------------------------------

/** Powerline right-arrow separator (E0B0 needs Powerline font, fallback to triangle) */
export const PL_SEP = _slConfig.nerdFont ? '\uE0B0' : '\u25B6';

/** Icon sets — Nerd Font (rich) vs Unicode (safe fallback) */
const ICONS_NERD = {
  model:     '\u{F0BA9}',  // 󰮩 nf-md-robot
  milestone: '\u{F0F4E}',  // 󰽎 nf-md-flag_checkered
  phase:     '\uF0E3',     //  nf-oct-milestone
  coord:     '\u{F044C}',  // 󰑌 nf-md-check_circle_outline
  task:      '\uEACB',     //  nf-cod-terminal_cmd
  team:      '\u{F0849}',  // 󰡉 nf-md-account_group
  dir:       '\uEA83',     //  nf-cod-folder
  git:       '\uE725',     //  nf-dev-git_branch
  ctx:       '\u{F0425}',  // 󰐥 nf-md-gauge
} as const;

const ICONS_UNICODE = {
  model:     '\u270E',  // ✎ pencil
  milestone: '\u2691',  // ⚑ flag
  phase:     '\u25C6',  // ◆ diamond
  coord:     '\u2699',  // ⚙ gear
  task:      '\u25B8',  // ▸ triangle
  team:      '\u{1F465}', // 👥 people
  dir:       '\u25A0',  // ■ square
  git:       '\u25C6',  // ◆ diamond (git branch)
  ctx:       '\u25D4',  // ◔ circle with quarter
} as const;

/** Select icon set based on config */
export const ICONS = _slConfig.nerdFont ? ICONS_NERD : ICONS_UNICODE;

/** Git status icons */
export const GIT_ICONS = {
  clean:    '✓',
  dirty:    '●',
  conflict: '⚠',
  ahead:    '↑',
  behind:   '↓',
} as const;

/**
 * RGB background colors — muted Notion-inspired palette.
 * Each entry: [R, G, B]
 */
export const SEGMENT_BG = {
  model:     [63, 75, 91]    as const,  // slate
  milestone: [160, 82, 45]  as const,  // warm brown
  phase:     [180, 142, 46]  as const,  // gold (muted)
  coord:     [58, 126, 200]  as const,  // blue
  task:      [55, 55, 60]    as const,  // charcoal
  team:      [123, 94, 167]  as const,  // purple
  dir:       [45, 134, 89]   as const,  // green
  ctxOk:    [45, 134, 89]   as const,  // green  (0–49%)
  ctxWarn:  [180, 142, 46]  as const,  // gold   (50–64%)
  ctxAlert: [200, 122, 42]  as const,  // orange (65–79%)
  ctxCrit:  [196, 64, 64]   as const,  // red    (80%+)
} as const;

/** Foreground color per segment: white or dark */
const WHITE = [255, 255, 255] as const;
const DARK  = [30, 30, 30]    as const;
const LIGHT = [224, 224, 224] as const;

export const SEGMENT_FG = {
  model:     WHITE,
  milestone: WHITE,
  phase:     DARK,
  coord:     WHITE,
  task:      LIGHT,
  team:      WHITE,
  dir:       WHITE,
  ctxOk:    WHITE,
  ctxWarn:  DARK,
  ctxAlert: WHITE,
  ctxCrit:  WHITE,
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
// Rendering mode: "powerline" (bg+arrows) or "text" (colored text + pipes)
// Set via MAESTRO_STATUSLINE_STYLE env var. Default: text
// ---------------------------------------------------------------------------

export type StatuslineStyle = 'powerline' | 'text';

export function getStatuslineStyle(): StatuslineStyle {
  return _slConfig.style;
}

/**
 * Text-mode segment colors — used as foreground on transparent background.
 * Each color is the "accent" for that segment type.
 */
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
