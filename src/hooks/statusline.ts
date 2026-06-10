/**
 * Maestro Statusline Hook — Two-line colored text
 *
 * Line 1: Model | Coordinator | Task | Team | Dir+Git | Context
 * Line 2: Milestone ◆Phase | Session chain (ANL-001→PLN-001→EXC-001→VRF-001 ✓)
 *
 * Input (stdin JSON from Claude Code):
 *   { model, workspace, session_id, context_window }
 *
 * Output (stdout): formatted ANSI string (1 or 2 lines)
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  AUTO_COMPACT_BUFFER_PCT,
  BRIDGE_PREFIX,
  ANSI_RESET,
  ICONS,
  GIT_ICONS,
  TEXT_COLORS,
  ansiFg,
  getCtxLevel,
  STATUSLINE_LAYOUT,
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
  context_window?: {
    remaining_percentage?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
  cost?: {
    total_lines_added?: number;
    total_lines_removed?: number;
  };
}

interface BridgeData {
  session_id: string;
  remaining_percentage: number;
  used_pct: number;
  timestamp: number;
}

/** Segment key — maps to TEXT_COLORS */
type SegKey = 'model' | 'milestone' | 'phase' | 'coord' | 'task' | 'team' | 'dir' | 'ctxOk' | 'ctxWarn' | 'ctxAlert' | 'ctxCrit';

interface Segment {
  text: string;
  key: SegKey;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Colored text on transparent background, pipe separators */
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

function normalizeUsage(remaining: number): number {
  const usableRemaining = Math.max(
    0,
    ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100
  );
  return Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
}

function buildContextText(usedPct: number): string {
  const filled = Math.floor(usedPct / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  return `${ICONS.ctx} ${bar} ${usedPct}%`;
}

/** Format token count: 1234 → "1.2k", 123456 → "123k" */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

/** Build token usage text: "↑12k ↓3k Σ15k" */
function buildTokenText(input: number, output: number): string {
  return `↑${formatTokens(input)} ↓${formatTokens(output)} Σ${formatTokens(input + output)}`;
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
// Workflow state reader — v2 artifact chain model
// ---------------------------------------------------------------------------

interface ArtifactInfo {
  id: string;
  type: string;
  status: string;
  phase: number | null;
  path: string;
  depends_on: string | string[] | null;
  completed_at: string | null;
}

/** Latest completed_at timestamp (ms epoch) across a chain, or 0 if none parseable */
function chainCompletedAt(chain: ArtifactChain): number {
  let max = 0;
  for (const a of chain.artifacts) {
    if (!a.completed_at) continue;
    const t = Date.parse(a.completed_at);
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max;
}

/** Effective status of a chain: in_progress > failed > completed > pending */
function chainStatus(chain: ArtifactChain): 'in_progress' | 'failed' | 'completed' | 'pending' {
  if (chain.artifacts.some(a => a.status === 'in_progress')) return 'in_progress';
  if (chain.artifacts.some(a => a.status === 'failed')) return 'failed';
  if (chain.allCompleted) return 'completed';
  return 'pending';
}

/** The "active" artifact in a chain — the one whose type names the current step */
function activeArtifact(chain: ArtifactChain): ArtifactInfo {
  return (
    chain.artifacts.find(a => a.status === 'in_progress') ??
    chain.artifacts.find(a => a.status === 'failed') ??
    chain.artifacts[chain.artifacts.length - 1]
  );
}

/** A chain of artifacts linked by depends_on */
interface ArtifactChain {
  artifacts: ArtifactInfo[];
  allCompleted: boolean;
}

interface WorkflowInfo {
  milestone: string;
  currentPhase: number;
  currentStep: number;
  status: string;
  total: number;
  completed: number;
  inProgress: number;
  planned: number;
  workspaceRoot: string;
  chains: ArtifactChain[];         // dependency-linked artifact chains
  orphans: ArtifactInfo[];         // artifacts not in any chain (standalone)
  currentTaskId: string;
}

const emptyWf: WorkflowInfo = {
  milestone: '', currentPhase: 0, currentStep: 0, status: '',
  total: 0, completed: 0, inProgress: 0, planned: 0, workspaceRoot: '',
  chains: [], orphans: [], currentTaskId: '',
};

/**
 * Build dependency chains from artifacts.
 * Walk depends_on links: find roots (no depends_on), then follow forward.
 */
function buildChains(artifacts: ArtifactInfo[]): { chains: ArtifactChain[]; orphans: ArtifactInfo[] } {
  if (artifacts.length === 0) return { chains: [], orphans: [] };

  const byId = new Map<string, ArtifactInfo>();
  for (const a of artifacts) byId.set(a.id, a);

  // Build forward map: parent → children
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const a of artifacts) {
    const deps = a.depends_on;
    if (!deps) continue;
    const depIds = Array.isArray(deps) ? deps : [deps];
    for (const depId of depIds) {
      if (byId.has(depId)) {
        hasParent.add(a.id);
        const existing = children.get(depId) || [];
        existing.push(a.id);
        children.set(depId, existing);
      }
    }
  }

  // Roots: artifacts with no parent in this set
  const roots = artifacts.filter(a => !hasParent.has(a.id));
  const visited = new Set<string>();
  const chains: ArtifactChain[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const chain: ArtifactInfo[] = [];
    let current: string | undefined = root.id;

    while (current && !visited.has(current)) {
      visited.add(current);
      const art = byId.get(current);
      if (art) chain.push(art);
      // Follow first child (linear chain)
      const kids = children.get(current);
      current = kids?.[0];
    }

    if (chain.length > 0) {
      const allCompleted = chain.every(a => a.status === 'completed');
      chains.push({ artifacts: chain, allCompleted });
    }
  }

  // Orphans: not visited by any chain walk
  const orphans = artifacts.filter(a => !visited.has(a.id));

  return { chains, orphans };
}

/** Read milestone + artifact chains from .workflow/state.json */
function readWorkflowState(dir: string): WorkflowInfo {
  const root = findWorkspaceRoot(dir);
  if (!root) return emptyWf;
  const statePath = join(root, '.workflow', 'state.json');
  if (!existsSync(statePath)) return emptyWf;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const result: WorkflowInfo = { ...emptyWf, workspaceRoot: root };

    if (state.current_milestone) result.milestone = state.current_milestone;
    if (state.status) result.status = state.status;

    const rawArtifacts: Array<{ id?: string; type?: string; phase?: number; milestone?: string; status?: string; path?: string; depends_on?: string | string[] | null }> = Array.isArray(state.artifacts) ? state.artifacts : [];
    const milestone = Array.isArray(state.milestones)
      ? state.milestones.find((m: { name?: string; id?: string }) => m.name === state.current_milestone || m.id === state.current_milestone)
      : null;
    const phases: unknown[] = Array.isArray(milestone?.phases) ? milestone.phases : [];

    // Normalize phases — accept both number[] (v2.0) and Array<{id,status,...}> (v1.0)
    const rawPhases: Array<unknown> = phases;
    const phaseEntries: Array<{ id: number; status?: string }> = [];
    for (const p of rawPhases) {
      if (typeof p === 'number') phaseEntries.push({ id: p });
      else if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'number') {
        const obj = p as { id: number; status?: string };
        phaseEntries.push({ id: obj.id, status: obj.status });
      }
    }
    const phaseIds = phaseEntries.map(p => p.id);

    // Filter to current milestone artifacts
    const msArtifacts: ArtifactInfo[] = rawArtifacts
      .filter(a => a.milestone === state.current_milestone && a.id && a.type && a.status)
      .map(a => ({
        id: a.id!,
        type: a.type!,
        status: a.status!,
        phase: a.phase ?? null,
        path: a.path ?? '',
        depends_on: a.depends_on ?? null,
        completed_at: (a as { completed_at?: string }).completed_at ?? null,
      }));

    if (phaseIds.length > 0) {
      result.total = phaseIds.length;

      // Prefer v1.0 inline phase.status if present
      const hasInlineStatus = phaseEntries.some(p => typeof p.status === 'string');
      let completed = 0, inProgress = 0, planned = 0;

      if (hasInlineStatus) {
        for (const p of phaseEntries) {
          if (p.status === 'completed') completed++;
          else if (p.status === 'in-progress' || p.status === 'in_progress' || p.status === 'active') inProgress++;
        }
      } else {
        for (const p of phaseIds) {
          const phaseArts = msArtifacts.filter(a => a.phase === p);
          if (phaseArts.some(a => a.type === 'execute' && a.status === 'completed')) { completed++; continue; }
          if (phaseArts.some(a => a.type === 'plan' && a.status === 'completed')) { planned++; inProgress++; continue; }
          if (phaseArts.length > 0) { inProgress++; }
        }
      }
      result.completed = completed;
      result.inProgress = inProgress;
      result.planned = planned;

      // Current phase — prefer in-progress, then first non-completed
      if (hasInlineStatus) {
        const cur = phaseEntries.find(p => p.status === 'in-progress' || p.status === 'in_progress' || p.status === 'active')
          ?? phaseEntries.find(p => p.status !== 'completed');
        if (cur) result.currentPhase = cur.id;
      } else {
        for (const p of phaseIds) {
          if (msArtifacts.some(a => a.phase === p && a.status === 'in_progress')) {
            result.currentPhase = p; break;
          }
        }
        if (!result.currentPhase) {
          for (const p of phaseIds) {
            if (!msArtifacts.some(a => a.type === 'execute' && a.phase === p && a.status === 'completed')) {
              result.currentPhase = p; break;
            }
          }
        }
      }

      // Build chains (only if artifacts exist)
      if (msArtifacts.length > 0) {
        const { chains, orphans } = buildChains(msArtifacts);
        result.chains = chains;
        result.orphans = orphans;
      }

    } else if (state.phases_summary) {
      // v1 fallback
      const s = state.phases_summary;
      if (typeof s.total === 'number') result.total = s.total;
      if (typeof s.completed === 'number') result.completed = s.completed;
      if (typeof s.in_progress === 'number') result.inProgress = s.in_progress;
      if (state.current_phase) result.currentPhase = state.current_phase;
    }

    if (state.current_step) result.currentStep = state.current_step;
    if (state.current_task_id) result.currentTaskId = state.current_task_id;

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
  const parts: string[] = [];

  if (git.conflict) parts.push(GIT_ICONS.conflict);
  else if (git.dirty) parts.push(GIT_ICONS.dirty);

  if (git.ahead > 0) parts.push(`${GIT_ICONS.ahead}${git.ahead}`);
  if (git.behind > 0) parts.push(`${GIT_ICONS.behind}${git.behind}`);

  const suffix = parts.length > 0 ? ` ${parts.join('')}` : '';
  return `${ICONS.git} ${git.branch}${suffix}`;
}

// ---------------------------------------------------------------------------
// Teammate activity segment
// ---------------------------------------------------------------------------

const TEAM_CACHE_TTL_MS = 10_000;
const TEAM_WINDOW_MIN = 30;
const TEAM_MAX_INLINE = 3;

interface TeamCacheFile { ts: number; segment: string; }

function teamCachePath(session: string): string {
  return join(tmpdir(), `maestro-team-statusline-${session}.json`);
}

function writeTeamCache(path: string, segment: string): string {
  try {
    writeFileSync(path, JSON.stringify({ ts: Date.now(), segment } as TeamCacheFile));
  } catch { /* best-effort */ }
  return segment;
}

function shortTaskId(taskId: string): string {
  const idx = taskId.lastIndexOf('-');
  return idx < 0 ? taskId : (taskId.slice(idx + 1) || taskId);
}

function formatTeammate(name: string, evt: ActivityEvent): string {
  if (typeof evt.phase_id === 'number' && typeof evt.task_id === 'string' && evt.task_id) {
    return `${name} (P${evt.phase_id}/${shortTaskId(evt.task_id)})`;
  }
  if (typeof evt.phase_id === 'number') return `${name} (P${evt.phase_id})`;
  if (typeof evt.target === 'string' && evt.target) return `${name} (${evt.target})`;
  return name;
}

export function buildTeamSegment(session: string): string {
  try {
    const cachePath = teamCachePath(session);
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<TeamCacheFile>;
        if (cached && typeof cached.ts === 'number' && typeof cached.segment === 'string' && Date.now() - cached.ts < TEAM_CACHE_TTL_MS) {
          return cached.segment;
        }
      } catch { /* corrupt cache */ }
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
      if (!prev) { latest.set(key, evt); continue; }
      const prevT = Date.parse(prev.ts);
      const curT = Date.parse(evt.ts);
      if (!Number.isNaN(curT) && (Number.isNaN(prevT) || curT >= prevT)) latest.set(key, evt);
    }
    if (latest.size === 0) return writeTeamCache(cachePath, '');

    const ordered = Array.from(latest.values()).sort((a, b) => {
      const ta = Date.parse(a.ts); const tb = Date.parse(b.ts);
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });

    const inline = ordered.slice(0, TEAM_MAX_INLINE).map(evt => formatTeammate(evt.user, evt));
    let body = inline.join(' | ');
    const extra = ordered.length - inline.length;
    if (extra > 0) body += ` +${extra}`;

    return writeTeamCache(cachePath, `\u{1F465} ${body}`);
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Coordinator segment
// ---------------------------------------------------------------------------

export function buildCoordinatorSegment(session: string): string {
  if (!session) return '';
  try {
    const bridge = readCoordBridge(session);
    if (!bridge) return '';
    const { status, current_step, chain_name } = bridge;
    if (status === 'completed' || status === 'failed') return '';
    const isPaused = status === 'paused' || status === 'step_paused';

    // Use real step counts (excluding decision nodes) when available
    const total = bridge.steps_real ?? bridge.steps_total;
    const done = bridge.steps_real_completed ?? bridge.steps_completed;
    const progress = isPaused ? 'P' : `${done}/${total}`;

    const isRalph = bridge.source === 'ralph';
    const stepLabel = current_step?.skill ?? '';
    const parts: string[] = [];

    if (isRalph) {
      // Ralph: show lifecycle position + decision marker + quality mode
      parts.push('ralph');
      if (bridge.lifecycle_position) parts.push(bridge.lifecycle_position);
      else if (stepLabel) parts.push(stepLabel);
      if (bridge.decision_pending) parts.push('\u25C6');  // ◆ decision pending
      if (bridge.quality_mode && bridge.quality_mode !== 'standard') parts.push(bridge.quality_mode);
      // Quality gates progress
      if (bridge.passed_gates && bridge.passed_gates.length > 0) {
        parts.push(`\u2713${bridge.passed_gates.length}`);  // ✓N gates passed
      }
    } else {
      // Maestro: chain name + current step
      if (chain_name) parts.push(chain_name);
      if (stepLabel) parts.push(stepLabel);
    }

    return `${parts.join(' ')} [${progress}]`;
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Chain renderer — session chain for line 2+
// ---------------------------------------------------------------------------

/** Extract readable slug from artifact path */
function extractSlug(art: ArtifactInfo): string {
  const b = basename(art.path || '');
  // scratch/analyze-auth-2026-04-20 → auth
  // phases/01-auth-multi-tenant → auth-multi-tenant
  // scratch/20260421-review-P1-auth → auth
  return b
    .replace(/^\d+-/, '')                    // leading number prefix
    .replace(/^\d{8}-/, '')                  // YYYYMMDD- prefix
    .replace(/^(analyze|plan|execute|verify|brainstorm|spec|review|debug|test)-/, '') // type prefix
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')      // trailing date
    .replace(/-P\d+/, '')                    // -P1, -P2
    || art.type;
}

/** Render chain status-first: `slug ✓` or `slug ⚙ execute (3/4)` */
function renderChain(chain: ArtifactChain): string {
  const slug = extractSlug(chain.artifacts[0]);
  const slugLabel = ansiFg(TEXT_COLORS.task) + slug + ANSI_RESET;
  const status = chainStatus(chain);

  if (status === 'completed') {
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxOk)}✓${ANSI_RESET}`;
  }

  const active = activeArtifact(chain);
  const done = chain.artifacts.filter(a => a.status === 'completed').length;
  const total = chain.artifacts.length;
  const typeLabel = ansiFg(TEXT_COLORS.phase) + active.type + ANSI_RESET;

  if (status === 'failed') {
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxCrit)}✗${ANSI_RESET} ${typeLabel}`;
  }
  if (status === 'in_progress') {
    const progress = ansiFg(TEXT_COLORS.separator) + `(${done}/${total})` + ANSI_RESET;
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxWarn)}⚙${ANSI_RESET} ${typeLabel} ${progress}`;
  }
  // pending
  return `${slugLabel} ${ansiFg(TEXT_COLORS.separator)}○${ANSI_RESET} ${typeLabel}`;
}

/** Render orphan: same status-first style as chains */
function renderOrphan(art: ArtifactInfo): string {
  const slug = extractSlug(art);
  const slugLabel = ansiFg(TEXT_COLORS.task) + slug + ANSI_RESET;
  if (art.status === 'completed') {
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxOk)}✓${ANSI_RESET}`;
  }
  const typeLabel = ansiFg(TEXT_COLORS.phase) + art.type + ANSI_RESET;
  if (art.status === 'failed') {
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxCrit)}✗${ANSI_RESET} ${typeLabel}`;
  }
  if (art.status === 'in_progress') {
    return `${slugLabel} ${ansiFg(TEXT_COLORS.ctxWarn)}⚙${ANSI_RESET} ${typeLabel}`;
  }
  return `${slugLabel} ${ansiFg(TEXT_COLORS.separator)}○${ANSI_RESET} ${typeLabel}`;
}

// ---------------------------------------------------------------------------
// Filter & cap — keep line 2 focused on active work
// ---------------------------------------------------------------------------

const CHAIN_DONE_TTL_MS = 48 * 60 * 60 * 1000;  // 48h
const CHAIN_MAX = 3;

interface FilteredView {
  chains: ArtifactChain[];
  orphans: ArtifactInfo[];
  hidden: number;  // count of items dropped by ttl + cap
}

function statusRank(s: string): number {
  // in_progress > failed > completed > pending  (lower = higher priority)
  if (s === 'in_progress') return 0;
  if (s === 'failed')      return 1;
  if (s === 'completed')   return 2;
  return 3;
}

/** Drop stale completed items (>48h) and cap total to CHAIN_MAX */
function filterAndCapChains(chains: ArtifactChain[], orphans: ArtifactInfo[]): FilteredView {
  const now = Date.now();
  const totalIn = chains.length + orphans.length;

  // Drop expired completed chains
  const liveChains = chains.filter(c => {
    if (chainStatus(c) !== 'completed') return true;
    const ts = chainCompletedAt(c);
    return ts > 0 && now - ts < CHAIN_DONE_TTL_MS;
  });

  // Drop expired completed orphans
  const liveOrphans = orphans.filter(o => {
    if (o.status !== 'completed') return true;
    if (!o.completed_at) return false;  // unknown age + completed → drop
    const ts = Date.parse(o.completed_at);
    return !Number.isNaN(ts) && now - ts < CHAIN_DONE_TTL_MS;
  });

  // Sort: in_progress first, then failed, then completed by recency desc, pending last
  type Item = { kind: 'chain'; data: ArtifactChain } | { kind: 'orphan'; data: ArtifactInfo };
  const items: Item[] = [
    ...liveChains.map<Item>(c => ({ kind: 'chain', data: c })),
    ...liveOrphans.map<Item>(o => ({ kind: 'orphan', data: o })),
  ];

  items.sort((a, b) => {
    const sa = a.kind === 'chain' ? chainStatus(a.data) : a.data.status;
    const sb = b.kind === 'chain' ? chainStatus(b.data) : b.data.status;
    const rankDiff = statusRank(sa) - statusRank(sb);
    if (rankDiff !== 0) return rankDiff;
    // Same rank → recency desc
    const ta = a.kind === 'chain' ? chainCompletedAt(a.data) : (a.data.completed_at ? Date.parse(a.data.completed_at) : 0);
    const tb = b.kind === 'chain' ? chainCompletedAt(b.data) : (b.data.completed_at ? Date.parse(b.data.completed_at) : 0);
    return tb - ta;
  });

  const kept = items.slice(0, CHAIN_MAX);
  const droppedByCap = items.length - kept.length;
  const droppedByTtl = totalIn - items.length;

  return {
    chains: kept.filter(i => i.kind === 'chain').map(i => (i as { kind: 'chain'; data: ArtifactChain }).data),
    orphans: kept.filter(i => i.kind === 'orphan').map(i => (i as { kind: 'orphan'; data: ArtifactInfo }).data),
    hidden: droppedByCap + droppedByTtl,
  };
}

// ---------------------------------------------------------------------------
// Main formatter
// ---------------------------------------------------------------------------

/**
 * Main statusline handler.
 *
 * compact (default): Line 1 = all segments; Line 2 = workflow (if active)
 * expanded:          Line 1 = Model/Thinking/Coord/Task/Team
 *                    Line 2 = Dir+Git/Tokens/Context
 *                    Line 3 = workflow (if active)
 */
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

  // ---- Segment group A: Model | Coord | Task | Team ----
  const segA: Segment[] = [];
  segA.push({ key: 'model', text: `${ICONS.model} ${model}` });
  if (coord) segA.push({ key: 'coord', text: `${ICONS.coord} ${coord}` });
  if (task)  segA.push({ key: 'task',  text: `${ICONS.task} ${task}` });
  if (team)  segA.push({ key: 'team',  text: `${ICONS.team} ${team}` });

  // ---- Segment group B: Dir+Git | Tokens+Lines | Context ----
  const segB: Segment[] = [];

  let dirText = `${ICONS.dir} ${basename(dir)}`;
  if (git) dirText += `  ${formatGitSuffix(git)}`;
  segB.push({ key: 'dir', text: dirText });

  const inputTokens  = data.context_window?.total_input_tokens;
  const outputTokens = data.context_window?.total_output_tokens;
  const linesAdded   = data.cost?.total_lines_added   ?? 0;
  const linesRemoved = data.cost?.total_lines_removed ?? 0;

  const statParts: string[] = [];
  if (inputTokens != null && outputTokens != null && (inputTokens > 0 || outputTokens > 0)) {
    statParts.push(buildTokenText(inputTokens, outputTokens));
  }
  if (linesAdded > 0 || linesRemoved > 0) {
    const added   = ansiFg(TEXT_COLORS.ctxOk)  + `+${linesAdded}`   + ANSI_RESET;
    const removed = ansiFg(TEXT_COLORS.ctxCrit) + `-${linesRemoved}` + ANSI_RESET;
    statParts.push(`${added} ${removed}`);
  }
  if (statParts.length > 0) {
    segB.push({ key: 'task', text: statParts.join(' ') });
  }

  if (remaining != null) {
    const level  = getCtxLevel(usedPct);
    const ctxKey = `ctx${level.charAt(0).toUpperCase()}${level.slice(1)}` as SegKey;
    segB.push({ key: ctxKey, text: buildContextText(usedPct) });
  }

  // ---- Build rendered lines ----
  let line1: string;
  let line2: string | null = null;

  if (STATUSLINE_LAYOUT === 'expanded') {
    // expanded: two info lines before optional workflow line
    line1 = renderColoredText(segA);
    line2  = renderColoredText(segB);
  } else {
    // compact (default): merge both groups into one line
    line1 = renderColoredText([...segA, ...segB]);
  }

  // ---- Workflow line: Milestone ◆Phase | chains ----
  if (!wf.milestone) {
    return line2 !== null ? line1 + '\n' + line2 : line1;
  }

  const sep = ansiFg(TEXT_COLORS.separator) + ' | ' + ANSI_RESET;
  const dot = ansiFg(TEXT_COLORS.separator) + ' · ' + ANSI_RESET;

  let header = ansiFg(TEXT_COLORS.milestone) + `${ICONS.milestone} ${wf.milestone}` + ANSI_RESET;
  if (wf.total > 0) header += ansiFg(TEXT_COLORS.milestone) + ` ${wf.completed}/${wf.total}` + ANSI_RESET;
  if (wf.currentPhase) header += ' ' + ansiFg(TEXT_COLORS.phase) + `${ICONS.phase} P${wf.currentPhase}` + ANSI_RESET;

  const view = filterAndCapChains(wf.chains, wf.orphans);
  const chainParts: string[] = [];
  for (const chain of view.chains)   chainParts.push(renderChain(chain));
  for (const orphan of view.orphans) chainParts.push(renderOrphan(orphan));
  if (view.hidden > 0) chainParts.push(ansiFg(TEXT_COLORS.separator) + `+${view.hidden}` + ANSI_RESET);

  const workflowLine = chainParts.length === 0
    ? header
    : header + sep + chainParts.join(dot);

  if (line2 !== null) {
    return line1 + '\n' + line2 + '\n' + workflowLine;
  }
  return line1 + '\n' + workflowLine;
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
