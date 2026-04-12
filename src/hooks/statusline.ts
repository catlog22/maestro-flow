/**
 * Maestro Statusline Hook
 *
 * Displays: model | phase | task | directory | ASCII-face context bar
 * Writes bridge file for context-monitor hook consumption.
 *
 * Input (stdin JSON from Claude Code):
 *   { model, workspace, session_id, context_window }
 *
 * Output (stdout): formatted statusline string
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import {
  AUTO_COMPACT_BUFFER_PCT,
  BRIDGE_PREFIX,
  FACES,
  FACE_COLORS,
  ANSI_RESET,
  ANSI_DIM,
  ANSI_BOLD,
  ANSI_CYAN,
  getFaceLevel,
} from './constants.js';
import { readCoordBridge, type CoordBridgeData } from './coordinator-tracker.js';
import { resolveSelf } from '../tools/team-members.js';
import { readRecentActivity, type ActivityEvent } from '../tools/team-activity.js';
import { findWorkspaceRoot } from './workspace.js';

interface StatuslineInput {
  model?: { display_name?: string };
  workspace?: { current_dir?: string };
  session_id?: string;
  context_window?: { remaining_percentage?: number };
}

interface BridgeData {
  session_id: string;
  remaining_percentage: number;
  used_pct: number;
  timestamp: number;
}

/** Normalize remaining% to usable context (accounts for autocompact buffer) */
function normalizeUsage(remaining: number): number {
  const usableRemaining = Math.max(
    0,
    ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100
  );
  return Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
}

/**
 * Build the context bar: face [=====-----] 62%
 */
function buildContextBar(usedPct: number): string {
  const level = getFaceLevel(usedPct);
  const face = FACES[level];
  const color = FACE_COLORS[level];
  const filled = Math.floor(usedPct / 10);
  const bar = '='.repeat(filled) + '-'.repeat(10 - filled);
  return ` ${color}${face} [${bar}] ${usedPct}%${ANSI_RESET}`;
}

/** Write bridge file for context-monitor to consume */
function writeBridge(session: string, remaining: number, usedPct: number): void {
  try {
    const bridgePath = join(tmpdir(), `${BRIDGE_PREFIX}${session}.json`);
    const data: BridgeData = {
      session_id: session,
      remaining_percentage: remaining,
      used_pct: usedPct,
      timestamp: Math.floor(Date.now() / 1000),
    };
    writeFileSync(bridgePath, JSON.stringify(data));
  } catch {
    // Silent fail — bridge is best-effort
  }
}

/** Read current in-progress task from Claude Code todos */
function readCurrentTask(session: string): string {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const todosDir = join(claudeDir, 'todos');
  if (!existsSync(todosDir)) return '';

  try {
    const files = readdirSync(todosDir)
      .filter((f) => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map((f) => ({ name: f, mtime: statSync(join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length > 0) {
      const todos = JSON.parse(readFileSync(join(todosDir, files[0].name), 'utf8'));
      const inProgress = todos.find((t: { status: string; activeForm?: string }) => t.status === 'in_progress');
      if (inProgress) return inProgress.activeForm || '';
    }
  } catch {
    // Silently fail
  }
  return '';
}

/** Read current phase from .workflow/state.json (using workspace resolver) */
function readPhase(dir: string): string {
  const root = findWorkspaceRoot(dir);
  if (!root) return '';
  const statePath = join(root, '.workflow', 'state.json');
  if (!existsSync(statePath)) return '';
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.current_phase) {
      let label = `P${state.current_phase}`;
      if (state.current_step) label += `.${state.current_step}`;
      return label;
    }
  } catch {
    // Silently fail
  }
  return '';
}

// ---------------------------------------------------------------------------
// Teammate activity segment (team-lite Wave 3B)
//
// Shows a compact summary of recent teammate activity in the statusline:
//   "\u{1F465} alice (P3/001) | bob (spec-auth) +2"
//
// Contract:
//   - Must be cheap (statusline runs on every refresh).
//   - Result is cached per-session for 10s in os.tmpdir().
//   - Must never throw — any error maps to empty string.
//   - Emits nothing if team mode is off or no teammate activity in 30m.
// ---------------------------------------------------------------------------

/** TTL for the per-session team segment cache. */
const TEAM_CACHE_TTL_MS = 10_000;

/** Recent-activity lookback window for the team segment. */
const TEAM_WINDOW_MIN = 30;

/** Max teammates rendered inline before collapsing to " +N". */
const TEAM_MAX_INLINE = 3;

interface TeamCacheFile {
  ts: number;
  segment: string;
}

function teamCachePath(session: string): string {
  return join(tmpdir(), `maestro-team-statusline-${session}.json`);
}

function writeTeamCache(path: string, segment: string): string {
  try {
    const data: TeamCacheFile = { ts: Date.now(), segment };
    writeFileSync(path, JSON.stringify(data));
  } catch {
    // Best-effort: cache write failure must not break statusline.
  }
  return segment;
}

/**
 * Collapse a task id to its short tail.
 *
 *   "TASK-001"          -> "001"
 *   "WFS-auth-refactor" -> "refactor"
 *   "plain"             -> "plain"
 */
function shortTaskId(taskId: string): string {
  const idx = taskId.lastIndexOf('-');
  if (idx < 0) return taskId;
  return taskId.slice(idx + 1) || taskId;
}

/**
 * Format a single teammate's inline label from their most recent event.
 *
 * Rules (in priority order):
 *   - phase_id + task_id -> "name (P{phase}/{short_task})"
 *   - phase_id only      -> "name (P{phase})"
 *   - target only        -> "name ({target})"
 *   - otherwise          -> "name"
 */
function formatTeammate(name: string, evt: ActivityEvent): string {
  if (typeof evt.phase_id === 'number' && typeof evt.task_id === 'string' && evt.task_id) {
    return `${name} (P${evt.phase_id}/${shortTaskId(evt.task_id)})`;
  }
  if (typeof evt.phase_id === 'number') {
    return `${name} (P${evt.phase_id})`;
  }
  if (typeof evt.target === 'string' && evt.target) {
    return `${name} (${evt.target})`;
  }
  return name;
}

/**
 * Build the teammate activity segment. Returns empty string if:
 *   - Team mode not enabled (no self record)
 *   - No recent teammate activity in the last 30 minutes (excluding self)
 *   - Any error (never throws)
 *
 * Result is cached per-session for 10 seconds via a JSON file in os.tmpdir().
 */
export function buildTeamSegment(session: string): string {
  try {
    // ---- Cache check ----
    const cachePath = teamCachePath(session);
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<TeamCacheFile>;
        if (
          cached &&
          typeof cached.ts === 'number' &&
          typeof cached.segment === 'string' &&
          Date.now() - cached.ts < TEAM_CACHE_TTL_MS
        ) {
          return cached.segment;
        }
      } catch {
        // Corrupt cache file — fall through and recompute.
      }
    }

    // ---- Team mode gate ----
    const self = resolveSelf();
    if (!self) return writeTeamCache(cachePath, '');

    // ---- Read recent activity ----
    const events = readRecentActivity(TEAM_WINDOW_MIN);
    if (events.length === 0) return writeTeamCache(cachePath, '');

    // Group by "user@host", keep the most recent event per teammate.
    // Exclude self (match on both user and host to avoid cross-host uid collision).
    const latest = new Map<string, ActivityEvent>();
    for (const evt of events) {
      if (!evt || typeof evt.user !== 'string' || typeof evt.host !== 'string') continue;
      if (evt.user === self.uid && evt.host === self.host) continue;
      const key = `${evt.user}@${evt.host}`;
      const prev = latest.get(key);
      if (!prev) {
        latest.set(key, evt);
        continue;
      }
      const prevT = Date.parse(prev.ts);
      const curT = Date.parse(evt.ts);
      if (!Number.isNaN(curT) && (Number.isNaN(prevT) || curT >= prevT)) {
        latest.set(key, evt);
      }
    }
    if (latest.size === 0) return writeTeamCache(cachePath, '');

    // Sort teammates newest-first so the 3 most active show up inline.
    const ordered = Array.from(latest.values()).sort((a, b) => {
      const ta = Date.parse(a.ts);
      const tb = Date.parse(b.ts);
      const sa = Number.isNaN(ta) ? 0 : ta;
      const sb = Number.isNaN(tb) ? 0 : tb;
      return sb - sa;
    });

    const inline = ordered.slice(0, TEAM_MAX_INLINE).map((evt) => formatTeammate(evt.user, evt));
    let body = inline.join(' | ');
    const extra = ordered.length - inline.length;
    if (extra > 0) body += ` +${extra}`;

    const segment = `\u{1F465} ${body}`;
    return writeTeamCache(cachePath, segment);
  } catch {
    // Hot path — never let statusline crash.
    return '';
  }
}

/**
 * Build coordinator progress segment from bridge file.
 * Returns e.g. "[3/6]verify" or "[P]review" (paused) or empty string.
 */
export function buildCoordinatorSegment(session: string): string {
  if (!session) return '';
  try {
    const bridge = readCoordBridge(session);
    if (!bridge) return '';

    const { status, steps_completed, steps_total, current_step } = bridge;
    if (status === 'completed' || status === 'failed') return '';

    const stepLabel = current_step?.skill ?? '';
    const isPaused = status === 'paused' || status === 'step_paused';
    const prefix = isPaused ? 'P' : `${steps_completed}/${steps_total}`;

    let seg = `[${prefix}]${stepLabel}`;
    if (bridge.coord_session_id) {
      const shortId = bridge.coord_session_id.slice(0, 12);
      seg += ` (${shortId})`;
    }
    return seg;
  } catch {
    return '';
  }
}

/** Main statusline handler — processes input and returns formatted string */
export function formatStatusline(data: StatuslineInput): string {
  const model = data.model?.display_name || 'Claude';
  const dir = data.workspace?.current_dir || process.cwd();
  const session = data.session_id || '';
  const remaining = data.context_window?.remaining_percentage;

  // Context bar + bridge write
  let ctx = '';
  if (remaining != null) {
    const usedPct = normalizeUsage(remaining);
    if (session) writeBridge(session, remaining, usedPct);
    ctx = buildContextBar(usedPct);
  }

  // Current task
  const task = session ? readCurrentTask(session) : '';

  // Phase from .workflow/
  const phase = readPhase(dir);

  // Coordinator progress
  const coord = session ? buildCoordinatorSegment(session) : '';

  // Teammate activity (team-lite Wave 3B)
  const team = session ? buildTeamSegment(session) : '';

  // Assemble segments
  const parts: string[] = [`${ANSI_DIM}${model}${ANSI_RESET}`];
  if (phase) parts.push(`${ANSI_CYAN}${phase}${ANSI_RESET}`);
  if (coord) parts.push(`${ANSI_CYAN}${coord}${ANSI_RESET}`);
  if (task)  parts.push(`${ANSI_BOLD}${task}${ANSI_RESET}`);
  if (team)  parts.push(`${ANSI_DIM}${team}${ANSI_RESET}`);
  parts.push(`${ANSI_DIM}${basename(dir)}${ANSI_RESET}`);

  return parts.join(' | ') + ctx;
}

/** Entry point — reads stdin JSON, writes formatted statusline to stdout */
export function runStatusline(): void {
  let input = '';
  const timeout = setTimeout(() => process.exit(0), 3000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    try {
      const data: StatuslineInput = JSON.parse(input);
      process.stdout.write(formatStatusline(data));
    } catch {
      // Silent fail
    }
  });
}
