// ---------------------------------------------------------------------------
// KnowledgeGuard — PreToolUse on file-write tools
//
// Turns the Knowledge Gate from prose into a visible signal (fail-open,
// never blocks):
//
// 1. Direct writes to `.workflow/specs/` or `.workflow/knowhow/` bypass the
//    stage → review → promote pipeline — warn.
// 2. Writes to project files with no recent `maestro search` recorded — warn.
//    Recency comes from `.workflow/learning/maestro-search.jsonl` (written by
//    `recordSearchUsage` in the search command); anything older than the
//    configured window counts as "this turn has not searched".
//
// Writes inside `.workflow/` other than specs/knowhow are Maestro's own
// state (sessions, scratchpad) and never warn. Any evaluation error is
// swallowed — the guard is advisory and must not break tool calls.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeGuardResult {
  warnings: string[];
}

export interface KnowledgeGuardConfig {
  /** Master switch. Default: true */
  enabled: boolean;
  /** A `maestro search` older than this many minutes counts as absent. Default: 30 */
  windowMin: number;
}

export interface KnowledgeGuardDeps {
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: KnowledgeGuardConfig = {
  enabled: true,
  windowMin: 30,
};

/**
 * Load guard config from `.workflow/config.json` → `knowledgeGate` section.
 * Returns defaults on any error.
 */
export function loadKnowledgeGuardConfig(projectRoot: string): KnowledgeGuardConfig {
  try {
    const configPath = join(projectRoot, '.workflow', 'config.json');
    if (!existsSync(configPath)) return DEFAULT_CONFIG;
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const gate = raw?.knowledgeGate;
    if (!gate) return DEFAULT_CONFIG;
    return {
      enabled: gate.enabled !== false,
      windowMin: typeof gate.window_min === 'number' && gate.window_min > 0
        ? gate.window_min
        : DEFAULT_CONFIG.windowMin,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a file-write for knowledge-gate compliance.
 * Pure after construction — takes explicit deps for testability. Never throws.
 */
export function evaluateKnowledgeGuard(
  projectRoot: string,
  filePath: string,
  config?: Partial<KnowledgeGuardConfig>,
  deps?: KnowledgeGuardDeps,
): KnowledgeGuardResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return { warnings: [] };

  try {
    const normalized = filePath.replace(/\\/g, '/');

    // 1. Direct knowledge writes bypass stage → review → promote.
    if (normalized.includes('.workflow/specs/') || normalized.includes('.workflow/knowhow/')) {
      return {
        warnings: [
          `[KnowledgeGuard] Direct writes to .workflow/specs|knowhow bypass the knowledge pipeline. ` +
          'Use `maestro knowledge stage` (inside a Run/session) or `maestro spec add` / `maestro knowhow add` instead.',
        ],
      };
    }

    // Maestro's own state (sessions, scratchpad, learning) is not project source.
    if (normalized.includes('.workflow/')) return { warnings: [] };

    // 2. Project file: require a recent `maestro search`.
    if (hasRecentSearch(projectRoot, cfg.windowMin, deps?.now?.() ?? Date.now())) {
      return { warnings: [] };
    }
    return {
      warnings: [
        `[KnowledgeGuard] Knowledge Gate: no \`maestro search\` recorded in the last ${cfg.windowMin} min. ` +
        'Run `maestro search "<1-3 task keywords>" --json` before modifying project files.',
      ],
    };
  } catch {
    return { warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEARCH_USAGE_FILE = join('.workflow', 'learning', 'maestro-search.jsonl');
const SEARCH_USAGE_COMMAND = 'maestro-search';

/**
 * True when `.workflow/learning/maestro-search.jsonl` records a search within
 * the window. Missing/unreadable file or unparseable timestamp → false
 * (that is exactly the "never searched" case the guard exists to surface).
 */
function hasRecentSearch(projectRoot: string, windowMin: number, nowMs: number): boolean {
  const file = join(projectRoot, SEARCH_USAGE_FILE);
  if (!existsSync(file)) return false;
  const raw = readFileSync(file, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { command?: string; lastUsed?: string };
      if (row.command !== SEARCH_USAGE_COMMAND || !row.lastUsed) continue;
      const ts = Date.parse(row.lastUsed);
      if (!Number.isNaN(ts) && nowMs - ts <= windowMin * 60_000) return true;
    } catch {
      // Skip malformed lines — other rows may still be valid.
    }
  }
  return false;
}
