/**
 * Maestro Statusline Hook — Powerline × Notion style
 *
 * Renders a Nerd-Font Powerline statusline with muted Notion-inspired colors.
 * Segments are conditionally shown — empty segments are omitted for a clean line.
 *
 * Segments (left → right):
 *   Model | Phase | Coordinator | Task | Team | Directory+Git | Context bar
 *
 * Input (stdin JSON from Claude Code):
 *   { model, workspace, session_id, context_window }
 *
 * Output (stdout): formatted Powerline string
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  AUTO_COMPACT_BUFFER_PCT,
  BRIDGE_PREFIX,
  ANSI_RESET,
  PL_SEP,
  ICONS,
  GIT_ICONS,
  SEGMENT_BG,
  SEGMENT_FG,
  TEXT_COLORS,
  ansiBg,
  ansiFg,
  getCtxLevel,
  getStatuslineStyle,
  type CtxLevel,
} from './constants.js';
import { readCoordBridge } from './coordinator-tracker.js';
import { resolveSelf } from '../tools/team-members.js';
import { readRecentActivity, type ActivityEvent } from '../tools/team-activity.js';
import { findWorkspaceRoot } from './workspace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Segment key — maps to TEXT_COLORS for colored-text mode */
type SegKey = 'model' | 'milestone' | 'phase' | 'coord' | 'task' | 'team' | 'dir' | 'ctxOk' | 'ctxWarn' | 'ctxAlert' | 'ctxCrit';

interface Segment {
  text: string;
  key: SegKey;
  bg: readonly [number, number, number];
  fg: readonly [number, number, number];
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Powerline mode: colored background segments with arrow separators.
 */
function renderPowerline(segments: Segment[]): string {
  if (segments.length === 0) return '';

  let out = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    out += ansiBg(seg.bg) + ansiFg(seg.fg) + ` ${seg.text} `;

    if (i < segments.length - 1) {
      out += ansiFg(seg.bg) + ansiBg(segments[i + 1].bg) + PL_SEP;
    } else {
      out += ANSI_RESET + ansiFg(seg.bg) + PL_SEP + ANSI_RESET;
    }
  }
  return out;
}

/**
 * Colored-text mode: colored text on transparent background, pipe separators.
 * Similar style to CCometixLine reference.
 */
function renderColoredText(segments: Segment[]): string {
  if (segments.length === 0) return '';

  const sepColor = ansiFg(TEXT_COLORS.separator);
  const sep = `${sepColor} | ${ANSI_RESET}`;

  const parts = segments.map((seg) => {
    const colorKey = seg.key as keyof typeof TEXT_COLORS;
    const color = TEXT_COLORS[colorKey] ?? TEXT_COLORS.model;
    return `${ansiFg(color)}${seg.text}${ANSI_RESET}`;
  });

  return parts.join(sep);
}

// ---------------------------------------------------------------------------
// Context usage
// ---------------------------------------------------------------------------

/** Normalize remaining% to usable context (accounts for autocompact buffer) */
function normalizeUsage(remaining: number): number {
  const usableRemaining = Math.max(
    0,
    ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100
  );
  return Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
}

/** Build context bar text: "icon ██████░░░░ 62%" */
function buildContextText(usedPct: number): string {
  const filled = Math.floor(usedPct / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  return `${ICONS.ctx} ${bar} ${usedPct}%`;
}

/** Get context segment colors by level */
function getCtxColors(level: CtxLevel): {
  bg: readonly [number, number, number];
  fg: readonly [number, number, number];
} {
  const map = {
    ok:    { bg: SEGMENT_BG.ctxOk,    fg: SEGMENT_FG.ctxOk },
    warn:  { bg: SEGMENT_BG.ctxWarn,  fg: SEGMENT_FG.ctxWarn },
    alert: { bg: SEGMENT_BG.ctxAlert, fg: SEGMENT_FG.ctxAlert },
    crit:  { bg: SEGMENT_BG.ctxCrit,  fg: SEGMENT_FG.ctxCrit },
  };
  return map[level];
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Workflow state reader
// ---------------------------------------------------------------------------

interface WorkflowInfo {
  milestone: string;         // e.g., "MVP" or ""
  currentPhase: number;      // e.g., 2 or 0
  currentStep: number;       // e.g., 1 or 0
  status: string;            // e.g., "phase_2_pending"
  total: number;             // total phases
  completed: number;         // completed phases
  inProgress: number;        // in-progress phases
  planned: number;           // phases with plan artifacts (scratch/P{n}/plan.json)
  workspaceRoot: string;     // workspace root path
}

const emptyWf: WorkflowInfo = {
  milestone: '', currentPhase: 0, currentStep: 0, status: '',
  total: 0, completed: 0, inProgress: 0, planned: 0, workspaceRoot: '',
};

/** Read milestone + phase progress from .workflow/state.json */
function readWorkflowState(dir: string): WorkflowInfo {
  const root = findWorkspaceRoot(dir);
  if (!root) return emptyWf;
  const statePath = join(root, '.workflow', 'state.json');
  if (!existsSync(statePath)) return emptyWf;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const result: WorkflowInfo = { ...emptyWf, workspaceRoot: root };

    if (state.current_milestone) result.milestone = state.current_milestone;
    if (state.current_phase) result.currentPhase = state.current_phase;
    if (state.current_step) result.currentStep = state.current_step;
    if (state.status) result.status = state.status;

    if (state.phases_summary) {
      const s = state.phases_summary;
      if (typeof s.total === 'number') result.total = s.total;
      if (typeof s.completed === 'number') result.completed = s.completed;
      if (typeof s.in_progress === 'number') result.inProgress = s.in_progress;
    }

    // Count how many phases have plan artifacts
    if (result.total > 0) {
      let planned = 0;
      for (let p = 1; p <= result.total; p++) {
        const planPath = join(root, '.workflow', 'scratch', `P${p}`, 'plan.json');
        if (existsSync(planPath)) planned++;
      }
      result.planned = planned;
    }

    return result;
  } catch {
    return emptyWf;
  }
}

// ---------------------------------------------------------------------------
// Git segment
// ---------------------------------------------------------------------------

interface GitInfo {
  branch: string;
  dirty: boolean;
  conflict: boolean;
  ahead: number;
  behind: number;
}

function readGitInfo(dir: string): GitInfo | null {
  try {
    const opts = { cwd: dir, timeout: 2000, stdio: 'pipe' as const };
    const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    if (!branch) return null;

    const statusOut = execSync('git status --porcelain -uno', opts).toString();
    const dirty = statusOut.length > 0;
    const conflict = statusOut.split('\n').some((l) => l.startsWith('UU') || l.startsWith('AA'));

    let ahead = 0;
    let behind = 0;
    try {
      const ab = execSync('git rev-list --left-right --count HEAD...@{upstream}', opts).toString().trim();
      const parts = ab.split(/\s+/);
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream or detached — ignore
    }

    return { branch, dirty, conflict, ahead, behind };
  } catch {
    return null;
  }
}

function formatGitSuffix(git: GitInfo): string {
  let status = '';
  if (git.conflict) status += GIT_ICONS.conflict;
  else if (git.dirty) status += GIT_ICONS.dirty;
  else status += GIT_ICONS.clean;

  if (git.ahead > 0) status += `${GIT_ICONS.ahead}${git.ahead}`;
  if (git.behind > 0) status += `${GIT_ICONS.behind}${git.behind}`;

  return `${ICONS.git} ${git.branch} ${status}`;
}

// ---------------------------------------------------------------------------
// Teammate activity segment (team-lite Wave 3B)
// ---------------------------------------------------------------------------

const TEAM_CACHE_TTL_MS = 10_000;
const TEAM_WINDOW_MIN = 30;
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
    // Best-effort
  }
  return segment;
}

function shortTaskId(taskId: string): string {
  const idx = taskId.lastIndexOf('-');
  if (idx < 0) return taskId;
  return taskId.slice(idx + 1) || taskId;
}

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

export function buildTeamSegment(session: string): string {
  try {
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
        // Corrupt cache — recompute
      }
    }

    const self = resolveSelf();
    if (!self) return writeTeamCache(cachePath, '');

    const events = readRecentActivity(TEAM_WINDOW_MIN);
    if (events.length === 0) return writeTeamCache(cachePath, '');

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

    const ordered = Array.from(latest.values()).sort((a, b) => {
      const ta = Date.parse(a.ts);
      const tb = Date.parse(b.ts);
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });

    const inline = ordered.slice(0, TEAM_MAX_INLINE).map((evt) => formatTeammate(evt.user, evt));
    let body = inline.join(' | ');
    const extra = ordered.length - inline.length;
    if (extra > 0) body += ` +${extra}`;

    const segment = `\u{1F465} ${body}`;
    return writeTeamCache(cachePath, segment);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Coordinator segment
// ---------------------------------------------------------------------------

export function buildCoordinatorSegment(session: string): string {
  if (!session) return '';
  try {
    const bridge = readCoordBridge(session);
    if (!bridge) return '';

    const { status, steps_completed, steps_total, current_step, chain_name } = bridge;
    if (status === 'completed' || status === 'failed') return '';

    const isPaused = status === 'paused' || status === 'step_paused';
    const progress = isPaused ? 'P' : `${steps_completed}/${steps_total}`;
    const stepLabel = current_step?.skill ?? '';

    // chain_name → stepLabel [progress]
    const parts: string[] = [];
    if (chain_name) parts.push(chain_name);
    if (stepLabel) parts.push(stepLabel);
    return `${parts.join(' ')} [${progress}]`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main formatter
// ---------------------------------------------------------------------------

/** Main statusline handler — processes input and returns Powerline string */
export function formatStatusline(data: StatuslineInput): string {
  const model = data.model?.display_name || 'Claude';
  const dir = data.workspace?.current_dir || process.cwd();
  const session = data.session_id || '';
  const remaining = data.context_window?.remaining_percentage;

  // ---- Collect data ----
  const wf    = readWorkflowState(dir);
  const coord = session ? buildCoordinatorSegment(session) : '';
  const task  = session ? readCurrentTask(session) : '';
  const team  = session ? buildTeamSegment(session) : '';
  const git   = readGitInfo(dir);

  let usedPct = 0;
  if (remaining != null) {
    usedPct = normalizeUsage(remaining);
    if (session) writeBridge(session, remaining, usedPct);
  }

  // ---- Build segments ----
  const segments: Segment[] = [];

  // 1. Model
  segments.push({
    key: 'model',
    text: `${ICONS.model} ${model}`,
    bg: SEGMENT_BG.model,
    fg: SEGMENT_FG.model,
  });

  // 2. Milestone (conditional — shown when workflow has milestones)
  if (wf.milestone) {
    let msText = `${ICONS.milestone} ${wf.milestone}`;
    if (wf.total > 0) msText += ` ${wf.completed}/${wf.total}`;
    segments.push({
      key: 'milestone',
      text: msText,
      bg: SEGMENT_BG.milestone,
      fg: SEGMENT_FG.milestone,
    });
  }

  // 3. Phase (conditional — shows current phase + status detail)
  if (wf.currentPhase) {
    let phaseText = `${ICONS.phase} P${wf.currentPhase}`;
    if (wf.currentStep) phaseText += `.${wf.currentStep}`;

    const tags: string[] = [];
    if (wf.planned > 0) tags.push(`${wf.planned}plan`);
    if (wf.inProgress > 0) tags.push(`${wf.inProgress}run`);
    if (tags.length > 0) phaseText += ` [${tags.join(' ')}]`;

    segments.push({
      key: 'phase',
      text: phaseText,
      bg: SEGMENT_BG.phase,
      fg: SEGMENT_FG.phase,
    });
  }

  // 4. Coordinator + chain (conditional)
  if (coord) {
    segments.push({
      key: 'coord',
      text: `${ICONS.coord} ${coord}`,
      bg: SEGMENT_BG.coord,
      fg: SEGMENT_FG.coord,
    });
  }

  // 5. Task (conditional)
  if (task) {
    segments.push({
      key: 'task',
      text: `${ICONS.task} ${task}`,
      bg: SEGMENT_BG.task,
      fg: SEGMENT_FG.task,
    });
  }

  // 6. Team (conditional)
  if (team) {
    segments.push({
      key: 'team',
      text: `${ICONS.team} ${team}`,
      bg: SEGMENT_BG.team,
      fg: SEGMENT_FG.team,
    });
  }

  // 7. Directory + Git
  let dirText = `${ICONS.dir} ${basename(dir)}`;
  if (git) dirText += `  ${formatGitSuffix(git)}`;
  segments.push({
    key: 'dir',
    text: dirText,
    bg: SEGMENT_BG.dir,
    fg: SEGMENT_FG.dir,
  });

  // 8. Context bar (conditional — only when data available)
  if (remaining != null) {
    const level = getCtxLevel(usedPct);
    const colors = getCtxColors(level);
    const ctxKey = `ctx${level.charAt(0).toUpperCase()}${level.slice(1)}` as SegKey;
    segments.push({
      key: ctxKey,
      text: buildContextText(usedPct),
      bg: colors.bg,
      fg: colors.fg,
    });
  }

  // ---- Render ----
  const style = getStatuslineStyle();
  return style === 'powerline' ? renderPowerline(segments) : renderColoredText(segments);
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
