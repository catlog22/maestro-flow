import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

import { SessionStore } from '../run/store.js';
import { assertSafePathSegment } from '../run/ids.js';
import { getProjectRoot } from '../utils/path-validator.js';

export interface TeamWorkPath {
  dir: string;
  scope: 'run' | 'legacy';
  runId?: string;
  sessionId?: string;
}

export interface TeamWorkLocation {
  id: string;
  rootDir: string;
  stateDir: string;
  scope: 'run' | 'legacy';
  runId?: string;
  sessionId?: string;
}

/**
 * Resolve team-private runtime state for a Run.
 *
 * New callers pass the canonical Run ID and land in `{run_dir}/work/team`.
 * Unknown IDs retain the legacy `.workflow/.team/<id>` location so existing
 * team sessions remain readable and resumable during the migration window.
 */
export function resolveTeamWorkPath(
  scopeId: string,
  projectRoot = getProjectRoot(),
): TeamWorkPath {
  assertSafePathSegment(scopeId, 'team Run ID');
  const store = new SessionStore(projectRoot);

  try {
    const found = store.findRun(scopeId);
    return {
      dir: join(store.runDir(found.sessionId, scopeId), 'work', 'team'),
      scope: 'run',
      runId: scopeId,
      sessionId: found.sessionId,
    };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Run not found:')) {
      throw error;
    }
    return {
      dir: join(projectRoot, '.workflow', '.team', scopeId),
      scope: 'legacy',
    };
  }
}

export function resolveTeamWorkDir(scopeId: string, projectRoot = getProjectRoot()): string {
  return resolveTeamWorkPath(scopeId, projectRoot).dir;
}

/**
 * Enumerate canonical Run-scoped team state with a read-only legacy fallback.
 * Duplicate Run IDs are retained so callers can fail closed instead of
 * implicitly selecting the first directory returned by the filesystem.
 */
export function listTeamWorkLocations(
  workflowRoot = join(getProjectRoot(), '.workflow'),
): TeamWorkLocation[] {
  const locations: TeamWorkLocation[] = [];
  const canonicalIds = new Set<string>();
  const sessionsDir = join(workflowRoot, 'sessions');

  if (existsSync(sessionsDir)) {
    for (const sessionEntry of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const runsDir = join(sessionsDir, sessionEntry.name, 'runs');
      if (!existsSync(runsDir)) continue;

      for (const runEntry of readdirSync(runsDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue;
        const rootDir = join(runsDir, runEntry.name);
        const stateDir = join(rootDir, 'work', 'team');
        if (!existsSync(stateDir)) continue;
        canonicalIds.add(runEntry.name);
        locations.push({
          id: runEntry.name,
          rootDir,
          stateDir,
          scope: 'run',
          runId: runEntry.name,
          sessionId: sessionEntry.name,
        });
      }
    }
  }

  const legacyDir = join(workflowRoot, '.team');
  if (existsSync(legacyDir)) {
    for (const entry of readdirSync(legacyDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || canonicalIds.has(entry.name)) continue;
      const stateDir = join(legacyDir, entry.name);
      locations.push({
        id: entry.name,
        rootDir: stateDir,
        stateDir,
        scope: 'legacy',
      });
    }
  }

  return locations;
}

/** Resolve one explicit locator. Ambiguity is an error, never array index 0. */
export function findExactTeamWorkLocation(
  scopeId: string,
  workflowRoot = join(getProjectRoot(), '.workflow'),
): TeamWorkLocation | null {
  assertSafePathSegment(scopeId, 'team Run ID');
  const matches = listTeamWorkLocations(workflowRoot).filter((location) => location.id === scopeId);
  if (matches.length > 1) {
    throw new Error(`Ambiguous team Run locator: ${scopeId} matched ${matches.length} locations`);
  }
  return matches[0] ?? null;
}
