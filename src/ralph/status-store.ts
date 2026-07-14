// ---------------------------------------------------------------------------
// Status store — ralph session resolution via standard SessionStore.
// Backward-compatible API surface for cmd-*.ts callers.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionStore } from '../run/store.js';
import {
  resolveRalphSession,
  type ResolvedRalphSession,
} from './session-adapter.js';

export type { ResolvedRalphSession };

export { resolveRalphSession };

export function workflowRoot(): string {
  return resolve(process.cwd());
}

/**
 * List ralph-engine sessions sorted by mtime DESC.
 * Returns session IDs from `.workflow/sessions/`.
 */
export function listRalphSessions(projectRoot: string): string[] {
  const store = new SessionStore(projectRoot);
  if (!existsSync(store.sessionsRoot)) return [];

  const entries: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of readdirSync(store.sessionsRoot)) {
    const dir = join(store.sessionsRoot, name);
    const sessionFile = join(dir, 'session.json');
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(sessionFile)) continue;
      entries.push({ name, mtimeMs: statSync(sessionFile).mtimeMs });
    } catch { /* skip */ }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const result: string[] = [];
  for (const e of entries) {
    try {
      const bundle = store.readBundle(e.name);
      if (bundle.session.orchestration.engine === 'ralph') {
        result.push(e.name);
      }
    } catch { /* skip corrupt */ }
  }
  return result;
}
