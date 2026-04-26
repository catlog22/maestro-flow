/**
 * Skill Context Hook — UserPromptSubmit
 *
 * When a user invokes a workflow skill (e.g., `/maestro-execute 2`),
 * injects current workflow state, phase artifact tree, and prior
 * phase outcomes into the session context.
 *
 * Uses `additionalContext` (not `updatedInput`) to avoid interfering
 * with skill expansion.
 *
 * Supports artifact registry (state.json.artifacts → scratch dirs) with
 * fallback to legacy phases/ directory structure.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkspace } from './workspace.js';
import { readCoordBridge, buildNextStepHint, type CoordBridgeData } from './coordinator-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillMatch {
  skill: string;
  phaseNum?: number;
  raw: string;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

interface WorkflowState {
  version?: string;
  current_milestone?: string;
  current_phase?: number;                // v1 compat — v2 derives from artifacts
  current_task_id?: string | null;
  status?: string;
  phases_summary?: { total: number; completed: number; in_progress: number; pending: number }; // v1 compat
  milestones?: Array<{ id?: string; name: string; phases?: number[]; status?: string }>;
  accumulated_context?: {
    key_decisions?: string[];
    deferred?: Array<{ id?: string; severity?: string; description?: string; fix_direction?: string } | string>;
  };
  transition_history?: Array<{ type: string; from_phase: number | null; to_phase: number | null; milestone: string; transitioned_at: string; trigger?: string; force?: boolean; snapshot?: { phases_completed: number; phases_total: number; deferred_count: number; verification_status: string; learnings_count: number } }>;
  artifacts?: ArtifactEntry[];
  [key: string]: unknown;
}

interface PhaseIndex {
  phase?: number;
  title?: string;
  slug?: string;
  status?: string;
  verification?: { status?: string; gaps?: Array<{ description?: string; severity?: string }> };
  learnings?: { patterns?: Array<{ content?: string }>; pitfalls?: Array<{ content?: string }> };
  execution?: { tasks_total?: number; tasks_completed?: number };
  [key: string]: unknown;
}

interface ArtifactEntry {
  id: string;
  type: string;
  milestone?: string | null;
  phase?: number | null;
  scope?: string;
  path?: string;
  status: string;
  depends_on?: string | string[] | null;
  harvested?: boolean;
  error_context?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

export interface SkillContextInput {
  user_prompt?: string;
  cwd?: string;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Skill invocation patterns
// ---------------------------------------------------------------------------

const SKILL_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\/maestro-execute\s+(\d+)/, skill: 'maestro-execute' },
  { pattern: /\/maestro-plan\s+(\d+)/, skill: 'maestro-plan' },
  { pattern: /\/maestro-verify\s+(\d+)/, skill: 'maestro-verify' },
  { pattern: /\/maestro-analyze\s+(\d+)/, skill: 'maestro-analyze' },
  { pattern: /\/maestro-milestone-audit(?:\s+(\d+))?/, skill: 'maestro-milestone-audit' },
  { pattern: /\/quality-review\s+(\d+)/, skill: 'quality-review' },
  { pattern: /\/quality-test\s+(\d+)/, skill: 'quality-test' },
  { pattern: /\/maestro(?:\s|$)/, skill: 'maestro' },
  { pattern: /\/maestro-coordinate(?:\s|$)/, skill: 'maestro-coordinate' },
  { pattern: /\/maestro-link-coordinate(?:\s|$)/, skill: 'maestro-link-coordinate' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a user prompt for workflow skill invocation.
 * Returns null if no skill pattern is matched.
 */
export function parseSkillInvocation(prompt: string): SkillMatch | null {
  for (const { pattern, skill } of SKILL_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      const phaseNum = match[1] ? parseInt(match[1], 10) : undefined;
      return { skill, phaseNum, raw: match[0] };
    }
  }
  return null;
}

/**
 * Evaluate skill context and return workflow state + artifact tree.
 * Returns null if no skill invocation detected or no workflow exists.
 */
export function evaluateSkillContext(data: SkillContextInput): HookOutput | null {
  const prompt = data.user_prompt ?? '';
  if (!prompt) return null;

  const skill = parseSkillInvocation(prompt);
  if (!skill) return null;

  const cwd = resolveWorkspace(data);
  if (!cwd) return null;
  const statePath = join(cwd, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  let state: WorkflowState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }

  const sections: string[] = [];

  // Section 0: Coordinator session context (for /maestro, /maestro-coordinate, /maestro-link-coordinate)
  const COORDINATOR_SKILLS = ['maestro', 'maestro-coordinate', 'maestro-link-coordinate'];
  if (COORDINATOR_SKILLS.includes(skill.skill) && data.session_id) {
    const coordBridge = readCoordBridge(data.session_id);
    if (coordBridge) {
      const hint = buildNextStepHint(coordBridge);
      if (hint) sections.push(hint);
    }
  }

  // Section 1: Workflow state summary
  const stateSection = buildStateSection(state, skill);
  if (stateSection) sections.push(stateSection);

  // Section 2: Phase artifact tree
  const phaseNum = skill.phaseNum ?? deriveCurrentPhaseLocal(state);
  if (phaseNum) {
    const treeSection = buildArtifactTree(cwd, phaseNum, state);
    if (treeSection) sections.push(treeSection);
  }

  // Section 3: Prior phase outcomes
  const outcomesSection = buildOutcomesSection(cwd, state, phaseNum ?? undefined);
  if (outcomesSection) sections.push(outcomesSection);

  if (sections.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: sections.join('\n\n'),
    },
  };
}

// ---------------------------------------------------------------------------
// Derive helpers (inline to avoid import — hooks must be self-contained .js)
// ---------------------------------------------------------------------------

function deriveCurrentPhaseLocal(state: WorkflowState): number | null {
  // v1 fallback
  if (state.current_phase !== undefined) return state.current_phase;
  // v2: derive from artifacts
  const arts = state.artifacts;
  if (!arts?.length) return null;
  const milestone = state.milestones?.find(m => m.name === state.current_milestone || m.id === state.current_milestone);
  if (!milestone?.phases?.length) return null;
  for (const p of milestone.phases) {
    if (arts.some(a => a.phase === p && a.milestone === state.current_milestone && a.status === 'in_progress')) return p;
  }
  for (const p of milestone.phases) {
    if (!arts.some(a => a.type === 'execute' && a.phase === p && a.milestone === state.current_milestone && a.status === 'completed')) return p;
  }
  return null;
}

function derivePhasesSummaryLocal(state: WorkflowState): { total: number; completed: number; in_progress: number; pending: number } {
  // v1 fallback
  if (state.phases_summary) return state.phases_summary;
  // v2: derive from artifacts
  const milestone = state.milestones?.find(m => m.name === state.current_milestone || m.id === state.current_milestone);
  if (!milestone?.phases?.length) return { total: 0, completed: 0, in_progress: 0, pending: 0 };
  const total = milestone.phases.length;
  let completed = 0, in_progress = 0;
  const arts = state.artifacts ?? [];
  for (const p of milestone.phases) {
    const phaseArts = arts.filter(a => a.phase === p && a.milestone === state.current_milestone);
    if (phaseArts.some(a => a.type === 'execute' && a.status === 'completed')) { completed++; continue; }
    if (phaseArts.length > 0) { in_progress++; }
  }
  return { total, completed, in_progress, pending: total - completed - in_progress };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildStateSection(state: WorkflowState, skill: SkillMatch): string | null {
  const parts: string[] = [`## Workflow Context for ${skill.skill}`];

  if (state.current_milestone) parts.push(`Milestone: ${state.current_milestone}`);
  const curPhase = deriveCurrentPhaseLocal(state);
  if (curPhase !== null) {
    const summary = derivePhasesSummaryLocal(state);
    const progress = summary.total > 0 ? `${summary.completed}/${summary.total} completed` : '';
    parts.push(`Phase: ${curPhase} ${progress ? `(${progress})` : ''}`);
  }
  if (state.status) parts.push(`Status: ${state.status}`);

  const decisions = state.accumulated_context?.key_decisions;
  if (decisions && decisions.length > 0) {
    parts.push(`Key decisions: ${decisions.length}`);
  }

  const deferred = state.accumulated_context?.deferred;
  if (deferred && deferred.length > 0) {
    parts.push(`Deferred items: ${deferred.length}`);
  }

  const history = state.transition_history;
  if (history && history.length > 0) {
    const last = history[history.length - 1];
    parts.push(`Last transition: ${last.type} ${last.milestone} (${last.transitioned_at})`);
  }

  return parts.length > 1 ? parts.join(' | ') : null;
}

function buildArtifactTree(cwd: string, phaseNum: number, state?: WorkflowState): string | null {
  // Try artifact registry first (scratch-based)
  const registryResult = buildArtifactTreeFromRegistry(cwd, phaseNum, state);
  if (registryResult) return registryResult;

  // Fallback: legacy phases/ directory
  return buildArtifactTreeLegacy(cwd, phaseNum);
}

function buildArtifactTreeFromRegistry(cwd: string, phaseNum: number, state?: WorkflowState): string | null {
  const artifacts = state?.artifacts;
  if (!artifacts || artifacts.length === 0) {
    // Try loading from state.json if not passed
    try {
      const statePath = join(cwd, '.workflow', 'state.json');
      if (!existsSync(statePath)) return null;
      const loaded = JSON.parse(readFileSync(statePath, 'utf8'));
      if (!Array.isArray(loaded?.artifacts) || loaded.artifacts.length === 0) return null;
      return buildArtifactTreeFromRegistry(cwd, phaseNum, loaded);
    } catch {
      return null;
    }
  }

  // Find plan artifacts for this phase (they contain .task/ and .summaries/)
  const planArtifacts = artifacts.filter(
    a => a.type === 'plan' && a.phase === phaseNum && a.path,
  );
  if (planArtifacts.length === 0) return null;

  // Use the latest plan artifact
  const latest = planArtifacts[planArtifacts.length - 1];
  const scratchDir = join(cwd, '.workflow', latest.path!);
  if (!existsSync(scratchDir)) return null;

  return buildDirTree(scratchDir, `## Phase ${phaseNum} Artifacts (.workflow/${latest.path}/)`);
}

function buildArtifactTreeLegacy(cwd: string, phaseNum: number): string | null {
  const phasesDir = join(cwd, '.workflow', 'phases');
  if (!existsSync(phasesDir)) return null;

  // Find phase directory by number prefix
  let phaseDir: string | null = null;
  let phaseDirName = '';
  try {
    const dirs = readdirSync(phasesDir);
    const prefix = String(phaseNum).padStart(2, '0');
    for (const d of dirs) {
      if (d.startsWith(`${prefix}-`)) {
        phaseDir = join(phasesDir, d);
        phaseDirName = d;
        break;
      }
    }
  } catch {
    return null;
  }

  if (!phaseDir || !existsSync(phaseDir)) return null;

  return buildDirTree(phaseDir, `## Phase ${phaseNum} Artifacts (.workflow/phases/${phaseDirName}/)`);
}

/**
 * Build a tree listing of a directory's contents (shared by registry and legacy paths).
 * Lists top-level files, .task/ entries with status, and .summaries/ count.
 */
function buildDirTree(dir: string, header: string): string | null {
  const lines: string[] = [header];

  try {
    const entries = readdirSync(dir);
    const files = entries.filter(e => !e.startsWith('.') && e !== '.task' && e !== '.summaries' && e !== '.process');
    if (files.length > 0) {
      lines.push(files.join(' | '));
    }

    // List .task/ directory with status annotations
    const taskDir = join(dir, '.task');
    if (existsSync(taskDir)) {
      const taskSection = buildTaskListing(taskDir);
      if (taskSection) lines.push(taskSection);
    }

    // List .summaries/ if it exists
    const summariesDir = join(dir, '.summaries');
    if (existsSync(summariesDir)) {
      const summaryFiles = readdirSync(summariesDir).filter(f => f.endsWith('.md'));
      if (summaryFiles.length > 0) {
        lines.push(`.summaries/ (${summaryFiles.length} files)`);
      }
    }
  } catch {
    return null;
  }

  return lines.join('\n');
}

function buildTaskListing(taskDir: string): string | null {
  try {
    const taskFiles = readdirSync(taskDir)
      .filter(f => f.startsWith('TASK-') && f.endsWith('.json'))
      .slice(0, 20); // Cap at 20

    if (taskFiles.length === 0) return null;

    let completed = 0;
    let pending = 0;
    let inProgress = 0;
    const taskStatuses: string[] = [];

    for (const f of taskFiles) {
      const taskId = f.replace('.json', '');
      try {
        // Read only enough to get status
        const content = readFileSync(join(taskDir, f), 'utf8');
        const task = JSON.parse(content);
        const status = task.status ?? 'pending';

        if (status === 'completed') { completed++; taskStatuses.push(`${taskId} ✓`); }
        else if (status === 'in_progress') { inProgress++; taskStatuses.push(`${taskId} →`); }
        else { pending++; taskStatuses.push(`${taskId} …`); }
      } catch {
        pending++;
        taskStatuses.push(`${taskId} ?`);
      }
    }

    const summary = `.task/ (${taskFiles.length} tasks: ${completed} completed${inProgress ? `, ${inProgress} in_progress` : ''}${pending ? `, ${pending} pending` : ''})`;
    return `${summary}\n  ${taskStatuses.join(' | ')}`;
  } catch {
    return null;
  }
}

function buildOutcomesSection(cwd: string, state: WorkflowState, targetPhase?: number): string | null {
  const parts: string[] = [];

  // Deferred items (high severity, top 5)
  const deferred = state.accumulated_context?.deferred;
  if (deferred && deferred.length > 0) {
    const highItems = deferred
      .filter(d => typeof d === 'object' && (d.severity === 'high' || d.severity === 'critical'))
      .slice(0, 5);

    if (highItems.length > 0) {
      const lines = highItems.map(d => {
        if (typeof d === 'object') {
          return `- [${d.severity}] ${d.description}${d.fix_direction ? ` → ${d.fix_direction}` : ''}`;
        }
        return `- ${d}`;
      });
      parts.push(`## Deferred Items (${deferred.length} total, showing high/critical)\n${lines.join('\n')}`);
    }
  }

  // Prior completed phase learnings + verification gaps
  if (targetPhase && targetPhase > 1) {
    const priorIndex = loadPhaseIndex(cwd, targetPhase - 1, state);
    if (priorIndex) {
      // Verification gaps
      const gaps = priorIndex.verification?.gaps;
      if (gaps && gaps.length > 0) {
        const gapLines = gaps.slice(0, 3).map(g => `- ${g.description ?? 'Unknown gap'}`);
        parts.push(`## Verification Gaps (Phase ${targetPhase - 1})\n${gapLines.join('\n')}`);
      }

      // Learnings
      const learnings = priorIndex.learnings;
      if (learnings) {
        const items: string[] = [];
        if (learnings.patterns) {
          items.push(...learnings.patterns.slice(0, 3).map(p => `- [pattern] ${p.content ?? p}`));
        }
        if (learnings.pitfalls) {
          items.push(...learnings.pitfalls.slice(0, 2).map(p => `- [pitfall] ${p.content ?? p}`));
        }
        if (items.length > 0) {
          parts.push(`## Prior Phase Learnings (Phase ${targetPhase - 1})\n${items.join('\n')}`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load phase index — tries artifact registry (verification.json in scratch dir)
 * first, falls back to legacy phases/ directory.
 */
function loadPhaseIndex(cwd: string, phaseNum: number, state?: WorkflowState): PhaseIndex | null {
  // Try artifact registry: find verification data from plan scratch dir
  const registryResult = loadPhaseIndexFromRegistry(cwd, phaseNum, state);
  if (registryResult) return registryResult;

  // Fallback: legacy phases/ directory
  return loadPhaseIndexLegacy(cwd, phaseNum);
}

function loadPhaseIndexFromRegistry(cwd: string, phaseNum: number, state?: WorkflowState): PhaseIndex | null {
  const artifacts = state?.artifacts;
  if (!artifacts || artifacts.length === 0) return null;

  // Find completed plan artifact for this phase (verification.json is appended there by verify)
  const planArtifacts = artifacts.filter(
    a => a.type === 'plan' && a.phase === phaseNum && a.path,
  );
  if (planArtifacts.length === 0) return null;

  const latest = planArtifacts[planArtifacts.length - 1];
  const scratchDir = join(cwd, '.workflow', latest.path!);

  // Try to load verification.json (written by verify step)
  try {
    const verifyPath = join(scratchDir, 'verification.json');
    if (existsSync(verifyPath)) {
      const verification = JSON.parse(readFileSync(verifyPath, 'utf8'));
      return { phase: phaseNum, status: 'completed', verification };
    }
  } catch { /* ignore */ }

  // Try to load index.json if it exists in scratch dir
  try {
    const indexPath = join(scratchDir, 'index.json');
    if (existsSync(indexPath)) {
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    }
  } catch { /* ignore */ }

  return null;
}

function loadPhaseIndexLegacy(cwd: string, phaseNum: number): PhaseIndex | null {
  const phasesDir = join(cwd, '.workflow', 'phases');
  if (!existsSync(phasesDir)) return null;

  try {
    const dirs = readdirSync(phasesDir);
    const prefix = String(phaseNum).padStart(2, '0');
    for (const d of dirs) {
      if (d.startsWith(`${prefix}-`)) {
        const indexPath = join(phasesDir, d, 'index.json');
        if (existsSync(indexPath)) {
          return JSON.parse(readFileSync(indexPath, 'utf8'));
        }
      }
    }
  } catch {
    // Silently fail
  }
  return null;
}
