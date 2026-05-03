/**
 * Coordinator Tracker — Unified progress tracking for maestro coordinators
 *
 * Tracks session state across three coordinator types:
 *   A) maestro & ralph — reads .workflow/.maestro/status.json (source field distinguishes)
 *   B) maestro-link-coordinate — captures coord session_id from Bash output,
 *      reads .workflow/.maestro/walker-state.json
 *
 * Bridge file: {tmpdir}/maestro-coord-{cc_session_id}.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { COORD_BRIDGE_PREFIX } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoordinatorType = 'maestro' | 'ralph' | 'maestro-link-coordinate';

export interface CoordStep {
  index: number;
  skill: string;
  args: string;
}

export interface CoordBridgeData {
  session_id: string;
  coord_session_id?: string;
  maestro_session_id?: string;
  coordinator: CoordinatorType;
  source?: 'maestro' | 'ralph';
  chain_name: string;
  intent: string;
  phase: number | null;
  steps_total: number;
  steps_completed: number;
  /** Real step counts excluding decision nodes (ralph sessions inflate totals with decision nodes) */
  steps_real?: number;
  steps_real_completed?: number;
  current_step: CoordStep | null;
  next_step: CoordStep | null;
  remaining_steps: Array<{ skill: string; args: string }>;
  status: string;
  auto_mode?: boolean;
  /** Ralph-specific: current lifecycle position (e.g., "verify", "post-review") */
  lifecycle_position?: string;
  /** Ralph-specific: quality pipeline mode ("full" | "standard" | "quick") */
  quality_mode?: string;
  /** Ralph-specific: true when current step is a decision node awaiting evaluation */
  decision_pending?: boolean;
  /** Ralph-specific: quality gates already passed */
  passed_gates?: string[];
  updated_at: number;
}

/** Parsed output from `maestro coordinate start/next` JSON */
export interface CoordinateCliOutput {
  session_id: string;
  status: string;
  graph_id: string;
  current_node: string;
  steps_completed: number;
  steps_failed: number;
  history: Array<{ node_id: string; outcome?: string; summary?: string }>;
}

// ---------------------------------------------------------------------------
// A: Read .workflow/.maestro/*/status.json (maestro & ralph)
// ---------------------------------------------------------------------------

interface MaestroStatusJson {
  session_id?: string;
  intent?: string;
  chain_name?: string;
  phase?: number;
  auto_mode?: boolean;
  source?: 'maestro' | 'ralph';
  lifecycle_position?: string;
  quality_mode?: string;
  passed_gates?: string[];
  steps?: Array<{
    index?: number;
    skill?: string;
    args?: string;
    type?: 'skill' | 'cli' | 'decision';
    status?: string;
  }>;
  current_step?: number;
  status?: string;
}

/**
 * Scan .workflow/.maestro/ for the most recently modified status.json.
 * Returns parsed bridge data or null if none found.
 */
export function readMaestroSession(workspaceRoot: string): CoordBridgeData | null {
  const maestroDir = join(workspaceRoot, '.workflow', '.maestro');
  if (!existsSync(maestroDir)) return null;

  try {
    const sessions = readdirSync(maestroDir)
      .map(name => {
        const statusPath = join(maestroDir, name, 'status.json');
        if (!existsSync(statusPath)) return null;
        try {
          return { name, mtime: statSync(statusPath).mtimeMs, path: statusPath };
        } catch { return null; }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (sessions.length === 0) return null;

    const raw: MaestroStatusJson = JSON.parse(readFileSync(sessions[0].path, 'utf8'));
    return parseMaestroStatus(raw, sessions[0].mtime, sessions[0].name);
  } catch {
    return null;
  }
}

function parseMaestroStatus(raw: MaestroStatusJson, mtime: number, dirName?: string): CoordBridgeData | null {
  const steps = raw.steps ?? [];
  const currentIdx = raw.current_step ?? 0;
  const isRalph = raw.source === 'ralph';

  // All steps count (includes decision nodes)
  const completed = steps.filter(s => s.status === 'completed').length;

  // Real step counts — exclude decision nodes for accurate progress
  const realSteps = steps.filter(s => s.type !== 'decision');
  const realCompleted = realSteps.filter(s => s.status === 'completed').length;

  // Detect decision pending state
  const currentStepRaw = steps[currentIdx];
  const decisionPending = isRalph && currentStepRaw?.type === 'decision' &&
    (currentStepRaw.status === 'running' || currentStepRaw.status === 'pending');

  const currentStep = currentStepRaw
    ? { index: currentIdx, skill: currentStepRaw.skill ?? '', args: currentStepRaw.args ?? '' }
    : null;

  const nextIdx = currentIdx + 1;
  const nextStep = steps[nextIdx]
    ? { index: nextIdx, skill: steps[nextIdx].skill ?? '', args: steps[nextIdx].args ?? '' }
    : null;

  const remaining = steps.slice(nextIdx).map(s => ({
    skill: s.skill ?? '',
    args: s.args ?? '',
  }));

  return {
    session_id: '',
    maestro_session_id: raw.session_id ?? dirName ?? undefined,
    coordinator: isRalph ? 'ralph' : 'maestro',
    source: raw.source,
    chain_name: raw.chain_name ?? '',
    intent: raw.intent ?? '',
    phase: raw.phase ?? null,
    steps_total: steps.length,
    steps_completed: completed,
    steps_real: realSteps.length,
    steps_real_completed: realCompleted,
    current_step: currentStep,
    next_step: nextStep,
    remaining_steps: remaining,
    status: raw.status ?? 'unknown',
    auto_mode: raw.auto_mode ?? false,
    lifecycle_position: isRalph ? raw.lifecycle_position : undefined,
    quality_mode: isRalph ? raw.quality_mode : undefined,
    decision_pending: decisionPending || undefined,
    passed_gates: isRalph ? raw.passed_gates : undefined,
    updated_at: Math.floor(mtime),
  };
}

// ---------------------------------------------------------------------------
// B: Parse coordinate CLI output (maestro-link-coordinate)
// ---------------------------------------------------------------------------

/**
 * Parse Bash tool output for coordinate session JSON.
 * Looks for JSON containing "session_id":"coord-..." pattern.
 * Returns parsed output or null if not coordinate output.
 */
export function parseCoordinateOutput(toolOutput: string): CoordinateCliOutput | null {
  if (!toolOutput || !toolOutput.includes('"session_id"')) return null;

  // Find JSON object in output (may be preceded by stderr lines)
  const jsonStart = toolOutput.indexOf('{');
  if (jsonStart < 0) return null;

  try {
    const parsed = JSON.parse(toolOutput.slice(jsonStart));
    if (typeof parsed.session_id !== 'string' || !parsed.session_id.startsWith('coord-')) {
      return null;
    }
    return {
      session_id: parsed.session_id,
      status: parsed.status ?? 'unknown',
      graph_id: parsed.graph_id ?? '',
      current_node: parsed.current_node ?? '',
      steps_completed: parsed.steps_completed ?? 0,
      steps_failed: parsed.steps_failed ?? 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return null;
  }
}

/**
 * Read walker-state.json for a specific coordinate session.
 * Resolves next node from the chain graph.
 */
export function readWalkerState(workspaceRoot: string, coordSessionId: string): CoordBridgeData | null {
  const coordDir = join(workspaceRoot, '.workflow', '.maestro');
  const statePath = join(coordDir, coordSessionId, 'walker-state.json');
  if (!existsSync(statePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    const history: Array<{ node_id: string; node_type?: string; outcome?: string }> =
      Array.isArray(raw.history) ? raw.history : [];

    const commandNodes = history.filter(h => h.node_type === 'command');
    const completed = commandNodes.filter(h => h.outcome === 'success').length;

    // Count total command nodes in graph to estimate steps_total
    const graphId: string = raw.graph_id ?? '';
    const currentNode: string = raw.current_node ?? '';

    // Resolve next step from chain graph
    const nextNode = resolveNextNode(workspaceRoot, graphId, currentNode);

    return {
      session_id: '',
      coord_session_id: coordSessionId,
      coordinator: 'maestro-link-coordinate',
      chain_name: graphId,
      intent: raw.intent ?? '',
      phase: raw.context?.project?.current_phase ?? null,
      steps_total: countGraphCommands(workspaceRoot, graphId),
      steps_completed: completed,
      current_step: currentNode ? { index: completed, skill: currentNode, args: '' } : null,
      next_step: nextNode ? { index: completed + 1, skill: nextNode.skill, args: nextNode.args } : null,
      remaining_steps: nextNode ? [{ skill: nextNode.skill, args: nextNode.args }] : [],
      status: raw.status ?? 'unknown',
      auto_mode: raw.auto_mode ?? false,
      updated_at: Math.floor(statSync(statePath).mtimeMs),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chain graph resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the next command node from a chain graph JSON file.
 * Follows `node.next` edges, skipping decision/gate/eval nodes.
 */
export function resolveNextNode(
  workspaceRoot: string,
  graphId: string,
  currentNode: string,
): { skill: string; args: string } | null {
  const graph = loadChainGraph(workspaceRoot, graphId);
  if (!graph) return null;

  const node = graph.nodes?.[currentNode];
  if (!node) return null;

  // Follow next edge, skip non-command nodes
  let nextId: string | undefined = node.next;
  for (let i = 0; i < 10 && nextId; i++) {
    const next = graph.nodes?.[nextId];
    if (!next) break;
    if (next.type === 'command') {
      return { skill: next.cmd ?? nextId, args: next.args ?? '' };
    }
    // Decision/gate/eval/terminal — try following default edge
    if (next.type === 'decision' && Array.isArray(next.edges)) {
      const defaultEdge = next.edges.find((e: { default?: boolean }) => e.default);
      nextId = defaultEdge?.target ?? next.edges[0]?.target;
    } else if (next.type === 'terminal') {
      break;
    } else {
      nextId = next.next;
    }
  }
  return null;
}

/** Count total command nodes in a chain graph. */
function countGraphCommands(workspaceRoot: string, graphId: string): number {
  const graph = loadChainGraph(workspaceRoot, graphId);
  if (!graph?.nodes) return 0;
  return Object.values(graph.nodes as Record<string, { type?: string }>).filter(n => n.type === 'command').length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadChainGraph(workspaceRoot: string, graphId: string): any | null {
  if (!graphId) return null;

  // Try local chains/ first, then global ~/.maestro/chains/
  const localPath = join(workspaceRoot, 'chains', `${graphId}.json`);
  const globalPath = join(homedir(), '.maestro', 'chains', `${graphId}.json`);

  for (const p of [localPath, globalPath]) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* skip */ }
    }
  }

  // Try singles/ subdirectory
  const localSingles = join(workspaceRoot, 'chains', 'singles', `${graphId}.json`);
  const globalSingles = join(homedir(), '.maestro', 'chains', 'singles', `${graphId}.json`);
  for (const p of [localSingles, globalSingles]) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* skip */ }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bridge file I/O
// ---------------------------------------------------------------------------

function bridgePath(sessionId: string): string {
  return join(tmpdir(), `${COORD_BRIDGE_PREFIX}${sessionId}.json`);
}

/** Write bridge file to tmpdir. */
export function writeCoordBridge(sessionId: string, data: CoordBridgeData): void {
  try {
    writeFileSync(bridgePath(sessionId), JSON.stringify(data));
  } catch {
    // Best-effort — bridge write must not break hook
  }
}

/** Read bridge file from tmpdir. Returns null if missing/corrupt. */
export function readCoordBridge(sessionId: string): CoordBridgeData | null {
  const p = bridgePath(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Latest session resolver
// ---------------------------------------------------------------------------

/**
 * Pick the most recently updated session across maestro and coordinate types.
 * Compares file mtime to determine which is newest.
 */
export function readLatestSession(
  workspaceRoot: string,
  existingBridge?: CoordBridgeData | null,
): CoordBridgeData | null {
  const maestro = readMaestroSession(workspaceRoot);
  const coord = readLatestCoordinateSession(workspaceRoot);

  const candidates = [maestro, coord, existingBridge ?? null].filter(
    (c): c is CoordBridgeData => c !== null,
  );

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.updated_at - a.updated_at)[0];
}

/** Find the latest walker-state.json across all coordinate sessions. */
function readLatestCoordinateSession(workspaceRoot: string): CoordBridgeData | null {
  const coordDir = join(workspaceRoot, '.workflow', '.maestro');
  if (!existsSync(coordDir)) return null;

  try {
    const sessions = readdirSync(coordDir)
      .filter(name => name.startsWith('coord-'))
      .map(name => {
        // Try walker-state.json (link-coordinate) then status.json
        for (const file of ['walker-state.json', 'status.json']) {
          const statePath = join(coordDir, name, file);
          if (existsSync(statePath)) {
            try { return { name, mtime: statSync(statePath).mtimeMs, file }; } catch { /* skip */ }
          }
        }
        return null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (sessions.length === 0) return null;

    const latest = sessions[0];
    if (latest.file === 'walker-state.json') {
      return readWalkerState(workspaceRoot, latest.name);
    }
    // status.json uses same format as maestro status.json
    const raw = JSON.parse(readFileSync(join(coordDir, latest.name, 'status.json'), 'utf8'));
    return parseMaestroStatus(raw, latest.mtime, latest.name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Next-step hint builder
// ---------------------------------------------------------------------------

/**
 * Build a "next step" hint string for additionalContext injection.
 * Returns null if session is completed/failed or has no next step.
 */
export function buildNextStepHint(data: CoordBridgeData): string | null {
  const isPaused = data.status === 'paused' || data.status === 'step_paused';
  if (!isPaused && data.status !== 'running') return null;
  if (!data.next_step) return null;

  const progress = `[${data.steps_completed}/${data.steps_total}]`;
  const lastSkill = data.current_step?.skill ?? '(unknown)';
  const nextSkill = data.next_step.skill;
  const nextArgs = data.next_step.args ? ` ${data.next_step.args}` : '';

  const lines = [
    `## Coordinator Session Active`,
    `Chain: ${data.chain_name} ${progress} | Status: ${data.status}`,
    `Last: ${lastSkill}`,
    `Next: ${nextSkill}${nextArgs}`,
  ];

  if (data.remaining_steps.length > 1) {
    const remaining = data.remaining_steps.slice(1, 4).map(s => s.skill).join(' → ');
    lines.push(`Then: ${remaining}${data.remaining_steps.length > 4 ? ' …' : ''}`);
  }

  // Resume hint — ralph uses /maestro-ralph continue, others use /maestro -c
  if (data.coord_session_id) {
    lines.push(`Resume: /maestro-link-coordinate -c ${data.coord_session_id}`);
  } else if (data.source === 'ralph') {
    lines.push(`Resume: /maestro-ralph continue`);
  } else {
    lines.push(`Resume: /maestro -c`);
  }

  return lines.join('\n');
}
