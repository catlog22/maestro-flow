/**
 * Spec Analytics — Injection logging and statistics
 *
 * Records every spec injection call (spec-injector, keyword-spec-injector,
 * spec-injection-plugin) and CLI endpoint usage. Provides aggregated
 * statistics for improvement analysis.
 *
 * Design:
 * - Reuses jsonl-log.ts (appendLine, readAll, tailLast, rotateIfLarge)
 * - Synchronous, never throws — safe for hot-path hooks
 * - Config cached with 30s TTL to avoid repeated file reads
 * - Auto-rotation at configurable max file size
 */

import { join } from 'node:path';
import { statSync } from 'node:fs';
import { appendLine, readAll, tailLast, rotateIfLarge } from '../utils/jsonl-log.js';
import type { SpecAnalyticsConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InjectionSource = 'spec-injector' | 'keyword-spec-injector' | 'spec-injection-plugin';

export interface SpecInjectionLogEntry {
  id: string;
  timestamp: string;
  source: InjectionSource;
  agentType?: string;
  promptSnippet?: string;
  categories: string[];
  specCount: number;
  budgetAction?: string;
  contentLength: number;
  inject: boolean;
  reason?: string;
  // Keyword-specific
  matchedKeywords?: string[];
  matchedEntryIds?: string[];
  matchedEntries?: number;
  totalPromptKeywords?: number;
  dedupFilteredCount?: number;
  searchSource?: 'daemon' | 'indexer' | 'keyword' | 'none';
  // Domain-specific
  domainTermsMatched?: number;
  // Plugin-specific
  inferredCategory?: string;
}

export interface CliEndpointLogEntry {
  id: string;
  timestamp: string;
  command: string;
  args: Record<string, unknown>;
}

export interface HookInvocationLogEntry {
  id: string;
  timestamp: string;
  hookName: string;
  pluginName?: string;
  nodeId?: string;
  durationMs?: number;
  outcome?: string;
  data?: Record<string, unknown>;
}

export type AnalyticsLogEntry =
  | ({ type: 'injection' } & SpecInjectionLogEntry)
  | ({ type: 'cli' } & CliEndpointLogEntry)
  | ({ type: 'hook' } & HookInvocationLogEntry);

export interface SpecAnalyticsSummary {
  totalInjections: number;
  successfulInjections: number;
  failedInjections: number;
  hitRate: number;

  bySource: Record<string, { total: number; injected: number }>;
  byAgentType: Record<string, { total: number; injected: number }>;
  byCategory: Record<string, number>;
  byBudgetAction: Record<string, number>;

  keywordStats: {
    totalMatches: number;
    topKeywords: Array<{ keyword: string; count: number }>;
    avgMatchedPerPrompt: number;
    dedupFilteredTotal: number;
  };

  cliStats: Record<string, number>;

  hookStats: {
    totalInvocations: number;
    byHook: Record<string, number>;
    byPlugin: Record<string, number>;
    avgDurationMs: number;
  };

  timeRange: { earliest: string; latest: string };
  totalEntries: number;
  logFileSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LOG_PATH = '.workflow/spec-analytics.jsonl';
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_ARCHIVE_DIR = '.workflow/archive';
const ROTATION_CHECK_INTERVAL = 50;
const CONFIG_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _seq = 0;
let _cachedConfig: { config: SpecAnalyticsConfig; projectPath: string; timestamp: number } | null = null;

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(projectPath: string, explicit?: SpecAnalyticsConfig): SpecAnalyticsConfig {
  if (explicit) return explicit;

  const now = Date.now();
  if (_cachedConfig && _cachedConfig.projectPath === projectPath && (now - _cachedConfig.timestamp) < CONFIG_CACHE_TTL_MS) {
    return _cachedConfig.config;
  }

  try {
    // Lazy import to avoid circular dependency
    const { readFileSync, existsSync } = require('node:fs');
    const configPath = join(projectPath, '.workflow', 'config.json');
    if (!existsSync(configPath)) {
      const defaultConfig: SpecAnalyticsConfig = { enabled: true };
      _cachedConfig = { config: defaultConfig, projectPath, timestamp: now };
      return defaultConfig;
    }
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const config: SpecAnalyticsConfig = raw?.specInjection?.analytics ?? { enabled: true };
    _cachedConfig = { config, projectPath, timestamp: now };
    return config;
  } catch {
    return { enabled: true };
  }
}

function resolveLogPath(projectPath: string, config: SpecAnalyticsConfig): string {
  return join(projectPath, config.logPath ?? DEFAULT_LOG_PATH);
}

function resolveArchiveDir(projectPath: string): string {
  return join(projectPath, DEFAULT_ARCHIVE_DIR);
}

// ---------------------------------------------------------------------------
// Auto-rotation
// ---------------------------------------------------------------------------

function maybeRotate(logPath: string, archiveDir: string, maxSize: number): void {
  if (Math.random() >= (1 / ROTATION_CHECK_INTERVAL)) return;
  rotateIfLarge(logPath, maxSize, archiveDir);
}

// ---------------------------------------------------------------------------
// Public API — Logging
// ---------------------------------------------------------------------------

/**
 * Log a spec injection event. Synchronous, never throws.
 */
export function logInjectionEvent(
  projectPath: string,
  entry: Omit<SpecInjectionLogEntry, 'id' | 'timestamp'>,
  config?: SpecAnalyticsConfig,
): void {
  try {
    const resolved = resolveConfig(projectPath, config);
    if (!resolved.enabled) return;

    const logPath = resolveLogPath(projectPath, resolved);
    const archiveDir = resolveArchiveDir(projectPath);

    const fullEntry: AnalyticsLogEntry = {
      type: 'injection',
      id: `SINJ-${Date.now()}-${++_seq}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    appendLine(logPath, fullEntry);
    maybeRotate(logPath, archiveDir, resolved.maxFileSize ?? DEFAULT_MAX_SIZE);
  } catch {
    // Swallow — hot path, never fail the host hook
  }
}

/**
 * Log a CLI endpoint call. Synchronous, never throws.
 */
export function logCliEndpoint(
  projectPath: string,
  command: string,
  args: Record<string, unknown>,
  config?: SpecAnalyticsConfig,
): void {
  try {
    const resolved = resolveConfig(projectPath, config);
    if (!resolved.enabled) return;

    const logPath = resolveLogPath(projectPath, resolved);
    const archiveDir = resolveArchiveDir(projectPath);

    const fullEntry: AnalyticsLogEntry = {
      type: 'cli',
      id: `CLI-${Date.now()}-${++_seq}`,
      timestamp: new Date().toISOString(),
      command,
      args,
    };

    appendLine(logPath, fullEntry);
    maybeRotate(logPath, archiveDir, resolved.maxFileSize ?? DEFAULT_MAX_SIZE);
  } catch {
    // Swallow
  }
}

/**
 * Log a workflow hook invocation. Synchronous, never throws.
 */
export function logHookInvocation(
  projectPath: string,
  entry: Omit<HookInvocationLogEntry, 'id' | 'timestamp'>,
  config?: SpecAnalyticsConfig,
): void {
  try {
    const resolved = resolveConfig(projectPath, config);
    if (!resolved.enabled) return;

    const logPath = resolveLogPath(projectPath, resolved);
    const archiveDir = resolveArchiveDir(projectPath);

    const fullEntry: AnalyticsLogEntry = {
      type: 'hook',
      id: `HOOK-${Date.now()}-${++_seq}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    appendLine(logPath, fullEntry);
    maybeRotate(logPath, archiveDir, resolved.maxFileSize ?? DEFAULT_MAX_SIZE);
  } catch {
    // Swallow
  }
}

// ---------------------------------------------------------------------------
// Public API — Reading
// ---------------------------------------------------------------------------

/**
 * Read all analytics entries.
 */
export function readAnalytics(projectPath: string, config?: SpecAnalyticsConfig): AnalyticsLogEntry[] {
  const resolved = resolveConfig(projectPath, config);
  const logPath = resolveLogPath(projectPath, resolved);
  return readAll<AnalyticsLogEntry>(logPath);
}

/**
 * Read last N analytics entries (efficient tail).
 */
export function readRecentAnalytics(projectPath: string, n: number, config?: SpecAnalyticsConfig): AnalyticsLogEntry[] {
  const resolved = resolveConfig(projectPath, config);
  const logPath = resolveLogPath(projectPath, resolved);
  return tailLast<AnalyticsLogEntry>(logPath, n);
}

/**
 * Get log file size in bytes. Returns 0 if file doesn't exist.
 */
export function getLogFileSize(projectPath: string, config?: SpecAnalyticsConfig): number {
  try {
    const resolved = resolveConfig(projectPath, config);
    const logPath = resolveLogPath(projectPath, resolved);
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

/**
 * Clear analytics log by rotating it to archive.
 */
export function clearAnalyticsLog(projectPath: string, config?: SpecAnalyticsConfig): string | null {
  const resolved = resolveConfig(projectPath, config);
  const logPath = resolveLogPath(projectPath, resolved);
  const archiveDir = resolveArchiveDir(projectPath);
  // Force rotation regardless of size
  return rotateIfLarge(logPath, 0, archiveDir);
}

// ---------------------------------------------------------------------------
// Public API — Statistics
// ---------------------------------------------------------------------------

/**
 * Compute aggregated statistics from log entries. Pure function, no IO.
 */
export function computeStats(entries: AnalyticsLogEntry[], logFileSize = 0): SpecAnalyticsSummary {
  const bySource: Record<string, { total: number; injected: number }> = {};
  const byAgentType: Record<string, { total: number; injected: number }> = {};
  const byCategory: Record<string, number> = {};
  const byBudgetAction: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  const cliCounts: Record<string, number> = {};
  const hookByName: Record<string, number> = {};
  const hookByPlugin: Record<string, number> = {};

  let totalInjections = 0;
  let successfulInjections = 0;
  let totalKeywordMatches = 0;
  let totalPromptKeywordsSum = 0;
  let dedupFilteredSum = 0;
  let keywordEvents = 0;
  let hookInvocations = 0;
  let hookDurationSum = 0;
  let hookDurationCount = 0;
  let earliest = '';
  let latest = '';

  for (const entry of entries) {
    // Track time range
    if (!earliest || entry.timestamp < earliest) earliest = entry.timestamp;
    if (!latest || entry.timestamp > latest) latest = entry.timestamp;

    if (entry.type === 'injection') {
      totalInjections++;
      if (entry.inject) successfulInjections++;

      // By source
      const src = entry.source;
      if (!bySource[src]) bySource[src] = { total: 0, injected: 0 };
      bySource[src].total++;
      if (entry.inject) bySource[src].injected++;

      // By agent type (fall back to source name for keyword/plugin entries)
      const agent = entry.agentType ?? entry.inferredCategory ?? `(${entry.source})`;
      if (!byAgentType[agent]) byAgentType[agent] = { total: 0, injected: 0 };
      byAgentType[agent].total++;
      if (entry.inject) byAgentType[agent].injected++;

      // By category
      if (entry.categories) {
        for (const cat of entry.categories) {
          byCategory[cat] = (byCategory[cat] ?? 0) + 1;
        }
      }

      // By budget action
      if (entry.budgetAction) {
        byBudgetAction[entry.budgetAction] = (byBudgetAction[entry.budgetAction] ?? 0) + 1;
      }

      // Keyword stats
      if (entry.matchedKeywords) {
        keywordEvents++;
        totalKeywordMatches += entry.matchedKeywords.length;
        for (const kw of entry.matchedKeywords) {
          keywordCounts[kw] = (keywordCounts[kw] ?? 0) + 1;
        }
      }
      if (entry.totalPromptKeywords != null) {
        totalPromptKeywordsSum += entry.totalPromptKeywords;
      }
      if (entry.dedupFilteredCount != null) {
        dedupFilteredSum += entry.dedupFilteredCount;
      }
    } else if (entry.type === 'cli') {
      cliCounts[entry.command] = (cliCounts[entry.command] ?? 0) + 1;
    } else if (entry.type === 'hook') {
      hookInvocations++;
      hookByName[entry.hookName] = (hookByName[entry.hookName] ?? 0) + 1;
      if (entry.pluginName) {
        hookByPlugin[entry.pluginName] = (hookByPlugin[entry.pluginName] ?? 0) + 1;
      }
      if (entry.durationMs != null) {
        hookDurationSum += entry.durationMs;
        hookDurationCount++;
      }
    }
  }

  // Top keywords (sorted descending, top 20)
  const topKeywords = Object.entries(keywordCounts)
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalInjections,
    successfulInjections,
    failedInjections: totalInjections - successfulInjections,
    hitRate: totalInjections > 0 ? (successfulInjections / totalInjections) * 100 : 0,
    bySource,
    byAgentType,
    byCategory,
    byBudgetAction,
    keywordStats: {
      totalMatches: totalKeywordMatches,
      topKeywords,
      avgMatchedPerPrompt: keywordEvents > 0 ? totalKeywordMatches / keywordEvents : 0,
      dedupFilteredTotal: dedupFilteredSum,
    },
    cliStats: cliCounts,
    hookStats: {
      totalInvocations: hookInvocations,
      byHook: hookByName,
      byPlugin: hookByPlugin,
      avgDurationMs: hookDurationCount > 0 ? hookDurationSum / hookDurationCount : 0,
    },
    timeRange: { earliest, latest },
    totalEntries: entries.length,
    logFileSize,
  };
}
