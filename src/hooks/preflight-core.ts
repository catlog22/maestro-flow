// ---------------------------------------------------------------------------
// Preflight Core — Pure conflict detection logic shared between CLI and hooks.
//
// Extracted from `src/commands/collab.ts` so that both the `maestro collab
// preflight` command and the PreToolUse guard can reuse the same algorithm.
// ---------------------------------------------------------------------------

import { resolveSelf, type MemberRecord } from '../tools/team-members.js';
import { readRecentActivity, type ActivityEvent } from '../tools/team-activity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  exitCode: 0 | 1 | 2;
  warnings: string[];
  conflicts: Array<{
    user: string;
    host: string;
    action: string;
    ts: string;
    relative: string;
  }>;
}

export interface PreflightDeps {
  getSelf?: () => MemberRecord | null;
  getActivity?: (mins: number) => ActivityEvent[];
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/**
 * Pure preflight logic — detects whether other team members are active on
 * the given phase within a look-back window.
 *
 * Algorithm:
 *   1. If no self → exit 0 (team mode off is a safe no-op).
 *   2. Fetch recent activity (30 min window, clock tolerance handled by
 *      team-activity module).
 *   3. Filter: same phase, different user.
 *   4. Deduplicate by `user@host` keeping the most recent event.
 *   5. Emit one warning line per unique teammate.
 *
 * `force` affects ONLY the exit code — warnings are still returned so
 * callers can display them.
 */
export function runPreflight(
  phase: number,
  opts: { force?: boolean },
  deps?: PreflightDeps,
): PreflightResult {
  const getSelf = deps?.getSelf ?? resolveSelf;
  const getActivity = deps?.getActivity ?? readRecentActivity;
  const now = deps?.now ?? Date.now;

  const self = getSelf();
  if (!self) {
    return { exitCode: 0, warnings: [], conflicts: [] };
  }

  const events = getActivity(30);
  const filtered = events.filter(
    (e) => e.phase_id === phase && e.user !== self.uid,
  );

  // Dedupe by user@host, keep the most recent.
  const latest = new Map<string, ActivityEvent>();
  for (const e of filtered) {
    const key = `${e.user}@${e.host}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(e.ts) > Date.parse(prev.ts)) {
      latest.set(key, e);
    }
  }

  if (latest.size === 0) {
    return { exitCode: 0, warnings: [], conflicts: [] };
  }

  const nowMs = now();
  const warnings: string[] = [];
  const conflicts: PreflightResult['conflicts'] = [];

  // Stable order: most recent first.
  const rows = Array.from(latest.values()).sort(
    (a, b) => Date.parse(b.ts) - Date.parse(a.ts),
  );
  for (const e of rows) {
    const rel = relTime(e.ts, nowMs);
    warnings.push(
      `\u26a0 ${e.user}@${e.host} is active on phase ${phase} ` +
        `(last: ${e.action}, ${rel} ago)`,
    );
    conflicts.push({
      user: e.user,
      host: e.host,
      action: e.action,
      ts: e.ts,
      relative: rel,
    });
  }

  return {
    exitCode: opts.force ? 0 : 1,
    warnings,
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relTime(ts: string, now: number): string {
  const ms = now - new Date(ts).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min === 1) return '1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
