/**
 * state-schema.ts — Canonical state.json v2 types, derivation, migration, and I/O.
 *
 * Single source of truth for the `.workflow/state.json` schema.
 * All hooks, tools, and workflows should import from here.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Local-time ISO 8601 string with timezone offset, e.g. "2026-04-24T14:30:00+08:00" */
function localISO(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectStatus = 'idle' | 'active' | 'executing' | 'completed';
export type ArtifactType = 'analyze' | 'plan' | 'execute' | 'verify' | 'brainstorm' | 'spec' | 'review' | 'debug' | 'test';
export type ArtifactScope = 'milestone' | 'phase' | 'adhoc' | 'standalone';
export type ArtifactStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ArtifactEntry {
  id: string;
  type: ArtifactType;
  milestone: string | null;
  phase: number | null;
  scope: ArtifactScope;
  path: string;
  status: ArtifactStatus;
  depends_on: string | string[] | null;
  harvested: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface MilestoneEntry {
  id: string;
  name: string;
  title: string;
  status: 'pending' | 'active' | 'completed';
  phases: number[];
}

export interface DeferredItem {
  id?: string;
  severity?: string;
  fix_direction?: string;
  description?: string;
}

export interface MilestoneHistoryEntry {
  id: string;
  name: string;
  slug?: string;
  status: string;
  completed_at: string | null;
  phases?: number[];
  audit_verdict?: string | null;
  force_completed?: boolean;
  archive_path?: string | null;
  archived_artifacts?: ArtifactEntry[];
}

export interface StateJsonV2 {
  version: '2.0';
  project_name: string | null;
  status: ProjectStatus;
  current_milestone: string | null;
  current_task_id: string | null;
  milestones: MilestoneEntry[];
  artifacts: ArtifactEntry[];
  accumulated_context: {
    key_decisions: string[];
    blockers: string[];
    deferred: Array<DeferredItem | string>;
  };
  transition_history: unknown[];
  milestone_history: MilestoneHistoryEntry[];
  last_updated: string;
}

export interface PhasesSummary {
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
}

// ---------------------------------------------------------------------------
// Derivation functions — replace stored current_phase / phases_summary
// ---------------------------------------------------------------------------

/**
 * Derive the "current phase" from artifact registry.
 * Priority: phase with in_progress artifact → first phase without completed execute.
 */
export function deriveCurrentPhase(state: StateJsonV2): number | null {
  const milestone = state.milestones?.find(m =>
    m.name === state.current_milestone || m.id === state.current_milestone,
  );
  if (!milestone?.phases?.length) return null;

  // Phase with in_progress work → current
  for (const p of milestone.phases) {
    if (state.artifacts.some(a =>
      a.phase === p
      && a.milestone === state.current_milestone
      && a.status === 'in_progress',
    )) return p;
  }

  // First phase without completed execute
  for (const p of milestone.phases) {
    if (!state.artifacts.some(a =>
      a.type === 'execute'
      && a.phase === p
      && a.milestone === state.current_milestone
      && a.status === 'completed',
    )) return p;
  }

  return null; // all phases done
}

/**
 * Derive phases_summary from artifact registry.
 */
export function derivePhasesSummary(state: StateJsonV2): PhasesSummary {
  const milestone = state.milestones?.find(m =>
    m.name === state.current_milestone || m.id === state.current_milestone,
  );
  if (!milestone?.phases?.length) {
    return { total: 0, completed: 0, in_progress: 0, pending: 0 };
  }

  const total = milestone.phases.length;
  let completed = 0;
  let in_progress = 0;

  for (const p of milestone.phases) {
    const arts = state.artifacts.filter(a =>
      a.phase === p && a.milestone === state.current_milestone,
    );
    if (arts.some(a => a.type === 'execute' && a.status === 'completed')) {
      completed++;
    } else if (arts.length > 0) {
      in_progress++;
    }
  }

  return { total, completed, in_progress, pending: total - completed - in_progress };
}

// ---------------------------------------------------------------------------
// Artifact ID generation
// ---------------------------------------------------------------------------

const TYPE_PREFIX: Record<ArtifactType, string> = {
  analyze: 'ANL',
  plan: 'PLN',
  execute: 'EXC',
  verify: 'VRF',
  brainstorm: 'BST',
  spec: 'SPC',
  review: 'REV',
  debug: 'DBG',
  test: 'TST',
};

export function nextArtifactId(artifacts: ArtifactEntry[], type: ArtifactType): string {
  const prefix = TYPE_PREFIX[type];
  let max = 0;
  for (const a of artifacts) {
    if (!a.id.startsWith(prefix + '-')) continue;
    const n = parseInt(a.id.slice(prefix.length + 1), 10);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Migration: v1 → v2
// ---------------------------------------------------------------------------

interface V1State {
  version?: string;
  project_name?: string;
  current_milestone?: string;
  current_phase?: number;
  status?: string;
  phases_summary?: { total: number; completed: number; in_progress: number; pending: number };
  milestones?: Array<{
    name: string;
    title?: string;
    phases?: number[];
    id?: string;
    status?: string;
  }>;
  artifacts?: ArtifactEntry[];
  accumulated_context?: StateJsonV2['accumulated_context'];
  transition_history?: unknown[];
  milestone_history?: unknown[];
  last_updated?: string;
  current_task_id?: string | null;
  [key: string]: unknown;
}

/**
 * Build artifact entries from legacy phases/ directory structure.
 * Scans .workflow/phases/{NN}-{slug}/ for analysis.md, plan.json, .summaries/, verification.json.
 */
function harvestLegacyPhaseArtifacts(workflowRoot: string, currentMilestone: string | null): ArtifactEntry[] {
  const phasesDir = join(workflowRoot, 'phases');
  if (!existsSync(phasesDir)) return [];

  const entries: ArtifactEntry[] = [];
  let idCounters: Record<string, number> = { ANL: 0, PLN: 0, EXC: 0, VRF: 0 };
  const now = localISO();

  let dirs: string[];
  try { dirs = readdirSync(phasesDir); } catch { return []; }

  for (const d of dirs) {
    const match = d.match(/^(\d+)-(.+)$/);
    if (!match) continue;
    const phaseNum = parseInt(match[1], 10);
    const slug = match[2];
    const phaseDir = join(phasesDir, d);

    // Check what artifacts exist in this phase dir
    const hasAnalysis = existsSync(join(phaseDir, 'analysis.md'));
    const hasPlan = existsSync(join(phaseDir, 'plan.json'));
    const hasSummaries = existsSync(join(phaseDir, '.summaries'));
    const hasVerification = existsSync(join(phaseDir, 'verification.json'));

    // Legacy paths are relative to .workflow/
    const legacyPath = `phases/${d}`;

    if (hasAnalysis) {
      idCounters.ANL++;
      const anlId = `ANL-${String(idCounters.ANL).padStart(3, '0')}`;
      entries.push({
        id: anlId,
        type: 'analyze',
        milestone: currentMilestone,
        phase: phaseNum,
        scope: 'phase',
        path: legacyPath,
        status: 'completed',
        depends_on: null,
        harvested: true,
        created_at: now,
        completed_at: now,
      });
    }

    if (hasPlan) {
      idCounters.PLN++;
      const plnId = `PLN-${String(idCounters.PLN).padStart(3, '0')}`;
      const anlId = idCounters.ANL > 0 ? `ANL-${String(idCounters.ANL).padStart(3, '0')}` : null;
      entries.push({
        id: plnId,
        type: 'plan',
        milestone: currentMilestone,
        phase: phaseNum,
        scope: 'phase',
        path: legacyPath,
        status: 'completed',
        depends_on: anlId,
        harvested: hasSummaries,
        created_at: now,
        completed_at: now,
      });
    }

    if (hasSummaries) {
      idCounters.EXC++;
      const excId = `EXC-${String(idCounters.EXC).padStart(3, '0')}`;
      const plnId = idCounters.PLN > 0 ? `PLN-${String(idCounters.PLN).padStart(3, '0')}` : null;
      entries.push({
        id: excId,
        type: 'execute',
        milestone: currentMilestone,
        phase: phaseNum,
        scope: 'phase',
        path: legacyPath,
        status: 'completed',
        depends_on: plnId,
        harvested: true,
        created_at: now,
        completed_at: now,
      });
    }

    if (hasVerification) {
      idCounters.VRF++;
      const vrfId = `VRF-${String(idCounters.VRF).padStart(3, '0')}`;
      const excId = idCounters.EXC > 0 ? `EXC-${String(idCounters.EXC).padStart(3, '0')}` : null;
      entries.push({
        id: vrfId,
        type: 'verify',
        milestone: currentMilestone,
        phase: phaseNum,
        scope: 'phase',
        path: legacyPath,
        status: 'completed',
        depends_on: excId ? [excId] : null,
        harvested: true,
        created_at: now,
        completed_at: now,
      });
    }
  }

  return entries;
}

/**
 * Normalize v1 status string to v2 enum.
 */
function normalizeStatus(old: string | undefined): ProjectStatus {
  if (!old) return 'idle';
  if (old === 'idle') return 'idle';
  if (old.includes('executing')) return 'executing';
  if (old === 'completed') return 'completed';
  if (old === 'active') return 'active';
  // "phase_N_pending", "verifying", etc → active
  return 'active';
}

/**
 * Migrate v1 state.json to v2. Optionally harvests legacy phases/ artifacts.
 */
export function migrateV1toV2(raw: V1State, workflowRoot?: string): StateJsonV2 {
  const currentMilestone = (raw.current_milestone as string) ?? null;

  // Enrich milestones with id + status
  const milestones: MilestoneEntry[] = (raw.milestones ?? []).map((m, i) => ({
    id: m.id ?? `M${i + 1}`,
    name: m.name,
    title: m.title ?? m.name,
    status: m.status as MilestoneEntry['status']
      ?? (m.name === currentMilestone ? 'active' : 'pending'),
    phases: m.phases ?? [],
  }));

  // Start with any existing artifacts from state.json
  let artifacts: ArtifactEntry[] = Array.isArray(raw.artifacts) ? [...raw.artifacts] : [];

  // Harvest from legacy phases/ if workflowRoot provided and no artifacts exist yet
  if (artifacts.length === 0 && workflowRoot) {
    artifacts = harvestLegacyPhaseArtifacts(workflowRoot, currentMilestone);
  }

  return {
    version: '2.0',
    project_name: (raw.project_name as string) ?? null,
    status: normalizeStatus(raw.status),
    current_milestone: currentMilestone,
    current_task_id: raw.current_task_id ?? null,
    milestones,
    artifacts,
    accumulated_context: raw.accumulated_context ?? {
      key_decisions: [],
      blockers: [],
      deferred: [],
    },
    transition_history: raw.transition_history ?? [],
    milestone_history: (raw.milestone_history ?? []) as MilestoneHistoryEntry[],
    last_updated: raw.last_updated ?? localISO(),
  };
}

// ---------------------------------------------------------------------------
// I/O helpers — atomic read/write
// ---------------------------------------------------------------------------

/**
 * Read state.json from a workspace. Auto-migrates v1 to v2 in memory (does not write back).
 * Returns null if file doesn't exist.
 */
export function readStateJson(workflowRoot: string): StateJsonV2 | null {
  const statePath = join(workflowRoot, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    if (raw.version === '2.0') return raw as StateJsonV2;
    // Auto-migrate v1
    return migrateV1toV2(raw, join(workflowRoot, '.workflow'));
  } catch {
    return null;
  }
}

/**
 * Write state.json atomically (write-tmp + rename).
 */
export function writeStateJson(workflowRoot: string, state: StateJsonV2): void {
  const statePath = join(workflowRoot, '.workflow', 'state.json');
  const tmpPath = statePath + '.tmp';

  state.last_updated = localISO();

  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, statePath);
}

/**
 * Read, migrate if needed, and write back v2 state.json.
 * Returns the migrated state. Use this for one-shot migration.
 */
export function migrateStateFile(workflowRoot: string): StateJsonV2 | null {
  const statePath = join(workflowRoot, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  let raw: V1State;
  try {
    raw = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }

  if (raw.version === '2.0') return raw as unknown as StateJsonV2;

  const v2 = migrateV1toV2(raw, join(workflowRoot, '.workflow'));
  writeStateJson(workflowRoot, v2);
  return v2;
}
