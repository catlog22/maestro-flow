// Shared constants for maestro hooks

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Statusline config reader
// ---------------------------------------------------------------------------

interface StatuslineConfig {
  nerdFont: boolean;
  theme: string;
}

function readStatuslineConfig(): StatuslineConfig {
  let nerdFont = false;
  let theme = 'notion';

  // Env overrides
  if (process.env.MAESTRO_NERD_FONT === '1') nerdFont = true;
  else if (process.env.MAESTRO_NERD_FONT === '0') nerdFont = false;
  if (process.env.MAESTRO_STATUSLINE_THEME) theme = process.env.MAESTRO_STATUSLINE_THEME;

  // Config file
  try {
    const configPath = join(
      process.env.MAESTRO_HOME || join(homedir(), '.maestro'),
      'config.json',
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (cfg.statusline?.nerdFont === true) nerdFont = true;
      if (cfg.statusline?.nerdFont === false && !process.env.MAESTRO_NERD_FONT) nerdFont = false;
      if (cfg.statusline?.theme && !process.env.MAESTRO_STATUSLINE_THEME) theme = cfg.statusline.theme;
    }
  } catch { /* ignore */ }

  return { nerdFont, theme };
}

const _slConfig = readStatuslineConfig();

/** Ignore bridge metrics older than this (seconds) */
export const STALE_SECONDS = 60;

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
  git:       '\u2387',    // ⎇ branch
  ctx:       '\u25D4',    // ◔ circle with quarter
} as const;

export const ICONS = _slConfig.nerdFont ? ICONS_NERD : ICONS_UNICODE;

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
// Color themes
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

interface ThemeColors {
  model:     RGB;
  milestone: RGB;
  phase:     RGB;
  coord:     RGB;
  task:      RGB;
  team:      RGB;
  dir:       RGB;
  git:       RGB;
  ctxOk:     RGB;
  ctxWarn:   RGB;
  ctxAlert:  RGB;
  ctxCrit:   RGB;
  separator: RGB;
}

/** All available themes */
export const THEMES: Record<string, ThemeColors> = {
  notion: {
    model:     [86, 182, 194],
    milestone: [224, 175, 104],
    phase:     [166, 209, 137],
    coord:     [137, 180, 250],
    task:      [205, 214, 244],
    team:      [203, 166, 247],
    dir:       [249, 226, 175],
    git:       [166, 227, 161],
    ctxOk:     [166, 227, 161],
    ctxWarn:   [249, 226, 175],
    ctxAlert:  [250, 179, 135],
    ctxCrit:   [243, 139, 168],
    separator: [88, 91, 112],
  },
  cyberpunk: {
    model:     [0, 255, 204],
    milestone: [255, 85, 85],
    phase:     [255, 204, 0],
    coord:     [138, 43, 226],
    task:      [220, 220, 220],
    team:      [255, 130, 255],
    dir:       [0, 200, 255],
    git:       [57, 255, 20],
    ctxOk:     [57, 255, 20],
    ctxWarn:   [255, 204, 0],
    ctxAlert:  [255, 140, 0],
    ctxCrit:   [255, 50, 50],
    separator: [60, 60, 80],
  },
  pastel: {
    model:     [150, 200, 230],
    milestone: [240, 180, 160],
    phase:     [180, 220, 180],
    coord:     [190, 180, 230],
    task:      [220, 210, 200],
    team:      [210, 180, 210],
    dir:       [220, 200, 170],
    git:       [180, 220, 180],
    ctxOk:     [160, 210, 170],
    ctxWarn:   [240, 210, 150],
    ctxAlert:  [240, 180, 140],
    ctxCrit:   [230, 150, 150],
    separator: [160, 160, 170],
  },
  nord: {
    model:     [136, 192, 208],
    milestone: [208, 135, 112],
    phase:     [163, 190, 140],
    coord:     [129, 161, 193],
    task:      [216, 222, 233],
    team:      [180, 142, 173],
    dir:       [235, 203, 139],
    git:       [163, 190, 140],
    ctxOk:     [163, 190, 140],
    ctxWarn:   [235, 203, 139],
    ctxAlert:  [208, 135, 112],
    ctxCrit:   [191, 97, 106],
    separator: [76, 86, 106],
  },
  monokai: {
    model:     [102, 217, 239],
    milestone: [249, 38, 114],
    phase:     [166, 226, 46],
    coord:     [174, 129, 255],
    task:      [248, 248, 242],
    team:      [253, 151, 31],
    dir:       [230, 219, 116],
    git:       [166, 226, 46],
    ctxOk:     [166, 226, 46],
    ctxWarn:   [230, 219, 116],
    ctxAlert:  [253, 151, 31],
    ctxCrit:   [249, 38, 114],
    separator: [117, 113, 94],
  },
};

/** Available theme names for install UI */
export const THEME_NAMES = Object.keys(THEMES) as string[];

/** Active theme colors — used as foreground on transparent background */
export const TEXT_COLORS: ThemeColors = THEMES[_slConfig.theme] ?? THEMES.notion;

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
