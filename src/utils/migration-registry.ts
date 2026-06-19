/**
 * migration-registry.ts — Versioned migration framework for .workflow/ artifacts.
 *
 * Migrations are registered by source→target version pairs.
 * The runner detects the current version from state.json and applies
 * all pending migrations in sequence.
 *
 * Usage:
 *   import { registry, runPendingMigrations } from './migration-registry.js';
 *   registry.register({ from: '1.0', to: '2.0', name: '...', migrate: fn });
 *   const results = runPendingMigrations(workflowRoot);
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationDef {
  /** Source version this migration applies to */
  from: string;
  /** Target version after migration */
  to: string;
  /** Human-readable name */
  name: string;
  /** Description of what changes */
  description: string;
  /** The migration function. Receives workflowRoot, returns summary. */
  migrate: (workflowRoot: string) => MigrationResult;
}

export interface MigrationResult {
  success: boolean;
  summary: string;
  changes: string[];
}

export interface MigrationPlan {
  currentVersion: string;
  targetVersion: string;
  steps: MigrationDef[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class MigrationRegistry {
  private migrations: MigrationDef[] = [];

  register(def: MigrationDef): void {
    // Prevent duplicate registration
    if (this.migrations.some(m => m.from === def.from && m.to === def.to)) return;
    this.migrations.push(def);
  }

  /** Get all registered migrations sorted by version chain */
  getAll(): readonly MigrationDef[] {
    return this.migrations;
  }

  /** Build the migration chain from current version to latest */
  buildPlan(currentVersion: string): MigrationPlan | null {
    const chain: MigrationDef[] = [];
    let version = currentVersion;

    for (let i = 0; i < 20; i++) { // safety limit
      const next = this.migrations.find(m => m.from === version);
      if (!next) break;
      chain.push(next);
      version = next.to;
    }

    if (chain.length === 0) return null;

    return {
      currentVersion,
      targetVersion: version,
      steps: chain,
    };
  }

  /** Get the latest version any migration targets */
  getLatestVersion(): string {
    if (this.migrations.length === 0) return '1.0';
    // Walk the chain to find the terminal version
    const targets = new Set(this.migrations.map(m => m.to));
    const sources = new Set(this.migrations.map(m => m.from));
    for (const t of targets) {
      if (!sources.has(t)) return t; // terminal node
    }
    return this.migrations[this.migrations.length - 1].to;
  }
}

export const registry = new MigrationRegistry();

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Detect current workflow version from state.json */
export function detectVersion(workflowRoot: string): string | null {
  const statePath = join(workflowRoot, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    return raw.version ?? '1.0';
  } catch {
    return null;
  }
}

/** Plan pending migrations without executing */
export function planMigrations(workflowRoot: string): MigrationPlan | null {
  const current = detectVersion(workflowRoot);
  if (!current) return null;
  return registry.buildPlan(current);
}

/** Execute all pending migrations in sequence */
export function runPendingMigrations(workflowRoot: string): {
  plan: MigrationPlan | null;
  results: Array<{ step: MigrationDef; result: MigrationResult }>;
} {
  const plan = planMigrations(workflowRoot);
  if (!plan) return { plan: null, results: [] };

  const results: Array<{ step: MigrationDef; result: MigrationResult }> = [];

  for (const step of plan.steps) {
    const result = step.migrate(join(workflowRoot, '.workflow'));
    results.push({ step, result });
    if (!result.success) break; // stop on failure
  }

  // Write target version to state.json after successful migration
  const allSucceeded = results.every(r => r.result.success);
  if (allSucceeded && results.length > 0) {
    const statePath = join(workflowRoot, '.workflow', 'state.json');
    try {
      const existing = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
      existing.version = plan.targetVersion;
      writeFileSync(statePath, JSON.stringify(existing, null, 2) + '\n');
    } catch {
      // Best-effort version write — migration already applied
    }
  }

  return { plan, results };
}

// ---------------------------------------------------------------------------
// Migration auto-loading
// ---------------------------------------------------------------------------

/**
 * Load all migrations from src/migrations/index.ts.
 * Call this once at CLI entrypoint to populate the registry.
 * Migrations are decoupled — add new files to src/migrations/ and register in index.ts.
 */
export async function loadMigrations(): Promise<void> {
  try {
    await import('../migrations/index.js');
  } catch {
    // migrations module not available (e.g., running from compiled .js without migrations)
  }
}
